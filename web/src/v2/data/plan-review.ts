"use client";

/**
 * Plan mode state for the /v2 conversation: one source for the composer's plan
 * capsule, the header ModeMenu row, the review dock and the right-panel card.
 *
 * Backend facts (read-only here):
 *   - `tasks.plan_mode` is toggled by `PATCH /tasks/{id}/plan-mode {on}`; a write
 *     drops the agent bundle, so a running turn keeps the old mode and the next
 *     turn uses the new one (`server/server.go` setTaskPlanMode). There is no push
 *     for `plan_mode`, so the snapshot is re-read.
 *   - A submitted plan waits in `intercept_pending` with `tool_name=exit_plan_mode`
 *     and `tool_input={title, plan}` (`intercept/plan_review.go` AskPlanReview).
 *     `GET /tasks/{id}` may also carry `pending_plan_review_id` once the backend
 *     adds it; without it the pending list is filtered by task.
 *   - The decision goes through `POST /intercept/pending/{id}/plan-review`
 *     (approve / keep_planning / dismiss); a settled row answers 409.
 *
 * Store: one entry per task id (no cross-task state). An entry polls every
 * 4 seconds while at least one component subscribes and the page is visible,
 * and refreshes once when the page becomes visible again.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { api } from "@/lib/api";
import type { InterceptPending, Task } from "@/lib/types";

/** Poll period while subscribed and visible; never faster than the goal strip's 3s. */
const POLL_MS = 4000;

/** Tool name that marks a pending row as a plan review (`intercept.ExitPlanModeTool`). */
export const PLAN_REVIEW_TOOL = "exit_plan_mode";

/** One pending plan review. */
export interface PendingPlanReview {
  /** `intercept_pending.id`, the id the decision endpoint takes. */
  readonly id: number;
  readonly taskId: string;
  /** Plan heading (first `#` line). */
  readonly title: string;
  /** Full Markdown plan. */
  readonly plan: string;
  readonly createdAt: string;
}

export type PlanModePhase = "idle" | "loading" | "ready" | "offline";

/** Snapshot of one task's plan state. */
export interface PlanModeSnapshot {
  readonly phase: PlanModePhase;
  /** `null` until the first read lands. */
  readonly planMode: boolean | null;
  /** Oldest undecided plan review of the task, or null. */
  readonly review: PendingPlanReview | null;
  /** A plan-mode write is in flight. */
  readonly busy: boolean;
  /** Last read failure. */
  readonly error: string | null;
}

/** Outcome recorded for a decided plan review. */
export type PlanOutcome = "approved" | "revise" | "dismissed";

/** Decision sent to the review endpoint. */
export type PlanDecision = "approve" | "keep_planning" | "dismiss";

/** Result of one review decision. */
export type PlanDecisionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly conflict: boolean; readonly message: string };

const IDLE: PlanModeSnapshot = { phase: "idle", planMode: null, review: null, busy: false, error: null };

interface Entry {
  snap: PlanModeSnapshot;
  readonly listeners: Set<() => void>;
  timer: number | null;
  generation: number;
}

const entries = new Map<string, Entry>();
/** Task id whose composer is on screen; the header ModeMenu follows it. */
let foreground: string | null = null;
const foregroundListeners = new Set<() => void>();

function entryOf(taskId: string): Entry {
  let entry = entries.get(taskId);
  if (entry === undefined) {
    entry = { snap: IDLE, listeners: new Set(), timer: null, generation: 0 };
    entries.set(taskId, entry);
  }
  return entry;
}

function publish(taskId: string, patch: Partial<PlanModeSnapshot>): void {
  const entry = entryOf(taskId);
  entry.snap = { ...entry.snap, ...patch };
  for (const listener of entry.listeners) listener();
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Turn one pending row into a review, or null when it is not a plan review.
 * @param row - intercept pending row.
 * @returns the review.
 */
export function reviewFromPending(row: InterceptPending): PendingPlanReview | null {
  if (row.tool_name !== PLAN_REVIEW_TOOL) return null;
  const input = (row.tool_input ?? {}) as Record<string, unknown>;
  const plan = typeof input.plan === "string" ? input.plan : "";
  const title =
    typeof input.title === "string" && input.title.trim() !== "" ? input.title.trim() : planTitleOf(plan) || "未命名计划";
  return { id: row.id, taskId: row.task_id ?? "", title, plan, createdAt: row.created_at };
}

/**
 * The plan's heading: the first `# ` line, without the marker.
 * @param markdown - plan Markdown.
 * @returns the heading, or "".
 */
export function planTitleOf(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const match = /^\s*#\s+(.+?)\s*#*\s*$/.exec(line);
    if (match !== null) return match[1];
  }
  return "";
}

/** Read the task and the pending list once and publish the result. */
async function refresh(taskId: string): Promise<void> {
  const entry = entryOf(taskId);
  const generation = ++entry.generation;
  if (entry.snap.phase === "idle") publish(taskId, { phase: "loading" });
  try {
    const [task, pending] = await Promise.all([
      api.task(taskId) as Promise<Task & { pending_plan_review_id?: number | null }>,
      api.interceptPending().catch(() => null),
    ]);
    if (generation !== entry.generation) return;
    const rows = (pending ?? [])
      .filter((row) => row.status === "pending" && row.task_id === taskId)
      .map(reviewFromPending)
      .filter((review): review is PendingPlanReview => review !== null)
      .sort((left, right) => left.id - right.id);
    const hinted = typeof task.pending_plan_review_id === "number" ? task.pending_plan_review_id : null;
    let review = hinted === null ? (rows[0] ?? null) : (rows.find((row) => row.id === hinted) ?? null);
    if (review === null && hinted !== null && hinted > 0) {
      // The task names a review the list did not carry: read that row directly.
      const one = await api.interceptGetOne(hinted).catch(() => null);
      if (generation !== entry.generation) return;
      review = one !== null && one.status === "pending" ? reviewFromPending(one) : null;
    }
    publish(taskId, { phase: "ready", planMode: task.plan_mode === true, review, error: null });
  } catch (reason: unknown) {
    if (generation !== entry.generation) return;
    publish(taskId, { phase: entry.snap.planMode === null ? "offline" : "ready", error: messageOf(reason) });
  }
}

function startPolling(taskId: string): void {
  const entry = entryOf(taskId);
  if (entry.timer !== null) return;
  entry.timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh(taskId);
  }, POLL_MS);
}

function stopPolling(taskId: string): void {
  const entry = entries.get(taskId);
  if (entry === undefined || entry.timer === null) return;
  window.clearInterval(entry.timer);
  entry.timer = null;
}

function onVisible(): void {
  if (document.visibilityState !== "visible") return;
  for (const [taskId, entry] of entries) if (entry.listeners.size > 0) void refresh(taskId);
}

let visibilityBound = false;

function subscribe(taskId: string, listener: () => void): () => void {
  const entry = entryOf(taskId);
  entry.listeners.add(listener);
  if (!visibilityBound && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
    visibilityBound = true;
  }
  if (entry.listeners.size === 1) {
    void refresh(taskId);
    startPolling(taskId);
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) stopPolling(taskId);
  };
}

/** Re-read one task's plan state now (after a send, a decision, a toggle). */
export function reloadPlanState(taskId: string): void {
  void refresh(taskId);
}

/**
 * Write the task's plan mode; the snapshot follows the backend's answer.
 * @param taskId - task id.
 * @param on - wanted state.
 * @returns the stored value; rejects with the backend error.
 */
export async function writePlanMode(taskId: string, on: boolean): Promise<boolean> {
  publish(taskId, { busy: true });
  try {
    const result = await api.setTaskPlanMode(taskId, on);
    publish(taskId, { busy: false, planMode: result.plan_mode === true, phase: "ready" });
    return result.plan_mode === true;
  } catch (reason: unknown) {
    publish(taskId, { busy: false });
    throw reason;
  }
}

/** A settled review answers 409 with `intercept.ErrAlreadyDecided`'s text. */
function isConflict(message: string): boolean {
  return /\b409\b/.test(message) || message.includes("已处理");
}

/**
 * Answer one plan review, then refresh every task that showed it.
 * @param reviewId - pending id.
 * @param decision - approve / keep_planning / dismiss.
 * @param feedback - revision notes for keep_planning.
 * @returns ok, or the failure with a 409 flag.
 */
export async function decidePlanReview(
  reviewId: number,
  decision: PlanDecision,
  feedback = "",
): Promise<PlanDecisionResult> {
  let result: PlanDecisionResult;
  try {
    await api.interceptPlanReview(reviewId, decision, feedback.trim());
    result = { ok: true };
  } catch (reason: unknown) {
    const message = messageOf(reason);
    result = { ok: false, conflict: isConflict(message), message };
  }
  if (result.ok) {
    outcomes.set(reviewId, decision === "approve" ? "approved" : decision === "keep_planning" ? "revise" : "dismissed");
    for (const listener of outcomeListeners) listener();
  }
  for (const [taskId, entry] of entries) {
    if (entry.snap.review?.id === reviewId) publish(taskId, { review: null });
    if (entry.listeners.size > 0) void refresh(taskId);
  }
  return result;
}

/**
 * Read the recorded outcome of a decided review (`GET /intercept/history/{id}`).
 * @param reviewId - pending id.
 * @returns the outcome; `null` while undecided or unknown.
 */
export async function fetchPlanOutcome(reviewId: number): Promise<PlanOutcome | null> {
  const detail = await api.interceptDetail(reviewId);
  if (detail.status === "pending") return null;
  const action: string = detail.audit?.effective_action ?? "";
  if (action === "plan_approve") return "approved";
  if (action === "plan_keep") return "revise";
  if (action === "plan_dismiss") return "dismissed";
  return detail.status === "allowed" ? "approved" : "dismissed";
}

/** Settled outcomes are final, so one read per review id is enough. */
const outcomes = new Map<number, PlanOutcome>();
const outcomeListeners = new Set<() => void>();
const outcomeReads = new Set<number>();

function readOutcome(reviewId: number): void {
  if (outcomes.has(reviewId) || outcomeReads.has(reviewId)) return;
  outcomeReads.add(reviewId);
  void fetchPlanOutcome(reviewId)
    .then((outcome) => {
      if (outcome === null) return;
      outcomes.set(reviewId, outcome);
      for (const listener of outcomeListeners) listener();
    })
    .catch(() => undefined)
    .finally(() => outcomeReads.delete(reviewId));
}

/**
 * Recorded outcome of one plan review.
 * @param reviewId - pending id, or null when the plan has no review row.
 * @param pending - the review is still open (from the task's plan state); while true nothing is read.
 * @returns the outcome, or null while pending/unknown.
 */
export function usePlanOutcome(reviewId: number | null, pending: boolean): PlanOutcome | null {
  const outcome = useSyncExternalStore(
    (listener) => {
      outcomeListeners.add(listener);
      return () => outcomeListeners.delete(listener);
    },
    () => (reviewId === null ? null : (outcomes.get(reviewId) ?? null)),
    () => null,
  );
  useEffect(() => {
    if (reviewId === null || pending) return;
    readOutcome(reviewId);
  }, [reviewId, pending]);
  return outcome;
}

/** Plan state of one task plus its actions. */
export interface PlanModeState extends PlanModeSnapshot {
  /** Write `on` (default: the opposite of the current value). Rejects on failure. */
  readonly set: (on?: boolean) => Promise<boolean>;
  readonly reload: () => void;
}

const noop = (): (() => void) => () => {};

/**
 * Subscribe to one task's plan state.
 * @param taskId - task id; `null` renders the idle snapshot.
 * @param options.foreground - mark this task as the one on screen (the composer does).
 * @returns the snapshot and its actions.
 */
export function usePlanMode(taskId: string | null, options: { foreground?: boolean } = {}): PlanModeState {
  const snap = useSyncExternalStore(
    taskId === null ? noop : (listener) => subscribe(taskId, listener),
    () => (taskId === null ? IDLE : entryOf(taskId).snap),
    () => IDLE,
  );
  const isForeground = options.foreground === true;
  useEffect(() => {
    if (!isForeground) return;
    foreground = taskId;
    for (const listener of foregroundListeners) listener();
    return () => {
      if (foreground !== taskId) return;
      foreground = null;
      for (const listener of foregroundListeners) listener();
    };
  }, [isForeground, taskId]);
  const set = useCallback(
    (on?: boolean): Promise<boolean> => {
      if (taskId === null) return Promise.reject(new Error("先选择一个任务"));
      const next = on ?? entryOf(taskId).snap.planMode !== true;
      return writePlanMode(taskId, next);
    },
    [taskId],
  );
  const reload = useCallback(() => {
    if (taskId !== null) void refresh(taskId);
  }, [taskId]);
  return { ...snap, set, reload };
}

/**
 * Task id whose composer is on screen (the header ModeMenu has no task prop).
 * @returns the id, or null when no composer is mounted.
 */
export function useForegroundPlanTask(): string | null {
  return useSyncExternalStore(
    (listener) => {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    () => foreground,
    () => null,
  );
}
