"use client";

/**
 * Adapter for one task's goal — the operator's single `/goal <objective>`
 * target, fed to the composer's goal bar.
 *
 * The strip renders only while a snapshot is present, so the shell needs the
 * snapshot itself: the sidebar's task list (`GET /tasks`) does not carry it
 * (the DTO field is filled by `GET /tasks/{id}` only, server/server.go:1858-1863),
 * and there is no goal push channel on this backend (DSH projects the goal
 * through its live projection; ARTeX has no equivalent). The hook therefore
 * reads `GET /tasks/{id}/goal` itself and re-reads on a page-lifetime timer —
 * the same trick the shell already uses for the running-task chip
 * (`Shell.tsx:527`), because the goal can change from another surface (the
 * `/goal` command turn is written server-side by `taskGoalSet`).
 *
 * Backend semantics that matter to the UI (server/task_goal_api.go):
 *   - :118-140 `POST /tasks/{id}/goal` creates or replaces the goal and writes
 *     the human `/goal <objective>` turn into the transcript; it does not start
 *     a run.
 *   - :159-189 `PATCH` rewrites the objective with `revision` as a compare-and-set
 *     precondition (a stale snapshot is answered 409, not silently applied).
 *   - :192-225 `pause`/`resume` only flip `phase`; :229-246 `clear` deletes the row.
 *   - A goal never drives a turn by itself: only `phase=active` changes what the
 *     *next* planner/chat turn is told (`agent/mainagent.go:214-227`).
 *
 * Every export forwards to `@/lib/api`: same arguments, same promise, same
 * rejection. Nothing is retried, swallowed or reshaped (`task-actions.ts:1-8`
 * has the same contract).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { GoalSnapshot } from "@/lib/types";

/** Read cadence for a goal that another surface may change. */
const POLL_MS = 3_000;

/** Phase of the read, mirroring `useTasks` so a page can render loading/offline. */
export type TaskGoalPhase = "idle" | "loading" | "ready" | "offline";

/** Outcome of one goal mutation, in the form the goal bar renders (`GoalBar.tsx:62-72`). */
export interface GoalActionResult {
  readonly ok: boolean;
  /** Present when `ok` is false; `message` is the backend's error text verbatim. */
  readonly error?: { readonly code: string; readonly message: string };
}

/** The four mutations a present goal offers (creation belongs to the `/goal` command). */
export interface GoalActions {
  /** Save an edited objective; `revision` comes from the loaded snapshot (CAS). */
  edit(objective: string): Promise<GoalActionResult>;
  pause(): Promise<GoalActionResult>;
  resume(): Promise<GoalActionResult>;
  clear(): Promise<GoalActionResult>;
}

export interface TaskGoalState {
  readonly phase: TaskGoalPhase;
  /** `null` means the task has no goal, so the strip renders nothing. */
  readonly goal: GoalSnapshot | null;
  /** Read failure; mutation failures travel back through `GoalActionResult`. */
  readonly error: string | null;
  /** Re-read now (also cancels an in-flight read). */
  reload: () => void;
  readonly actions: GoalActions;
}

/** Read a task's goal: `null` when the task has none. */
export function getTaskGoal(taskId: string): Promise<GoalSnapshot | null> {
  return api.taskGoal(taskId);
}

/**
 * Create or replace the task's goal (equivalent to the `/goal <objective>` command).
 * @param taskId - task id.
 * @param objective - the new objective; the backend normalizes/validates it.
 * @returns the stored snapshot.
 */
export function setTaskGoal(taskId: string, objective: string): Promise<GoalSnapshot | null> {
  return api.setTaskGoal(taskId, objective);
}

/**
 * Rewrite the objective.
 * @param taskId - task id.
 * @param objective - the new objective text.
 * @param revision - snapshot revision used as the CAS precondition; `0` opts out.
 * @returns the updated snapshot (revision incremented).
 */
export function editTaskGoal(taskId: string, objective: string, revision?: number): Promise<GoalSnapshot | null> {
  return api.editTaskGoal(taskId, objective, revision);
}

/** Set `phase=paused`; only an active goal reaches the system prompt. */
export function pauseTaskGoal(taskId: string): Promise<GoalSnapshot | null> {
  return api.pauseTaskGoal(taskId);
}

/** Set `phase=active`. */
export function resumeTaskGoal(taskId: string): Promise<GoalSnapshot | null> {
  return api.resumeTaskGoal(taskId);
}

/** Delete the goal; the next read answers `null` and the strip disappears. */
export function clearTaskGoal(taskId: string): Promise<{ ok: boolean; cleared: boolean }> {
  return api.clearTaskGoal(taskId);
}

/** Backend errors are plain `Error`s: the message is the server's text, sometimes `METHOD path: status`. */
function failure(reason: unknown): GoalActionResult {
  const message = reason instanceof Error ? reason.message : String(reason);
  const status = /\b([1-5]\d\d)\b/.exec(message);
  return { ok: false, error: { code: status?.[1] ?? "error", message } };
}

/** Snapshot equality: the poll must not republish an unchanged goal (no new render, no draft reset). */
function sameGoal(a: GoalSnapshot | null, b: GoalSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.revision === b.revision &&
    a.phase === b.phase &&
    a.objective === b.objective
  );
}

/**
 * Read one task's goal and expose its mutations.
 * @param taskId - selected task, or null when nothing is open.
 * @returns phase, snapshot, read error, a reload callback and the four mutations.
 */
export function useTaskGoal(taskId: string | null): TaskGoalState {
  const [phase, setPhase] = useState<TaskGoalPhase>("idle");
  const [goal, setGoal] = useState<GoalSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const goalRef = useRef<GoalSnapshot | null>(null);
  const taskRef = useRef<string | null>(taskId);
  /** Invalidates reads that started before a task switch or a mutation. */
  const seqRef = useRef(0);
  const renderedTaskRef = useRef<string | null>(null);

  const apply = useCallback((next: GoalSnapshot | null): void => {
    goalRef.current = next;
    setGoal((current) => (sameGoal(current, next) ? current : next));
  }, []);

  const read = useCallback(
    async (id: string, seq: number): Promise<void> => {
      try {
        const next = await api.taskGoal(id);
        if (seq !== seqRef.current) return;
        apply(next);
        setError(null);
        setPhase("ready");
      } catch (reason: unknown) {
        if (seq !== seqRef.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      }
    },
    [apply],
  );

  useEffect(() => {
    taskRef.current = taskId;
    seqRef.current += 1;
    if (taskId === null) {
      renderedTaskRef.current = null;
      goalRef.current = null;
      setGoal(null);
      setError(null);
      setPhase("idle");
      return;
    }
    // A reload of the same task keeps the snapshot on screen (only a task switch
    // re-enters loading), so the strip does not flicker while polling.
    if (renderedTaskRef.current !== taskId) {
      renderedTaskRef.current = taskId;
      setPhase("loading");
    }
    const seq = seqRef.current;
    void read(taskId, seq);
    const timer = setInterval(() => {
      void read(taskId, seqRef.current);
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [taskId, tick, read]);

  const reload = useCallback((): void => {
    setTick((n) => n + 1);
  }, []);

  const run = useCallback(
    async (action: (id: string, revision: number) => Promise<GoalSnapshot | null>): Promise<GoalActionResult> => {
      const id = taskRef.current;
      if (id === null) return { ok: false, error: { code: "no-task", message: "未选择任务" } };
      // Invalidate an in-flight read: its response may predate this write.
      seqRef.current += 1;
      const seq = seqRef.current;
      try {
        const next = await action(id, goalRef.current?.revision ?? 0);
        if (seq === seqRef.current) {
          apply(next);
          setError(null);
          setPhase("ready");
        }
        return { ok: true };
      } catch (reason: unknown) {
        return failure(reason);
      }
    },
    [apply],
  );

  const actions: GoalActions = {
    edit: (objective: string) =>
      run((id, revision) => editTaskGoal(id, objective, revision === 0 ? undefined : revision)),
    pause: () => run((id) => pauseTaskGoal(id)),
    resume: () => run((id) => resumeTaskGoal(id)),
    clear: () =>
      run(async (id) => {
        await clearTaskGoal(id);
        return null;
      }),
  };

  return { phase, goal, error, reload, actions };
}
