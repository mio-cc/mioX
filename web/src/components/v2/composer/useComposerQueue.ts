"use client";

/**
 * Page-level composer queue: hold drafts while a turn runs, then send them one at
 * a time after the run settles.
 *
 * Why a queue at all: `POST /api/chat` answers 409 while the task's agent is busy
 * (`server/server.go` chat handler: 主 Agent 正在处理上一条消息，请稍候) and the
 * backend exposes no steer/insert channel that would place a message into the
 * running turn. Sending is therefore serialized in the client:
 *   1. while `running` (or a manual send is in flight) Enter / the primary seat
 *      enqueue the draft instead of POSTing;
 *   2. the head item is POSTed once the status poll reports idle again
 *      (`chatRun.running` true -> false), which starts the next turn;
 *   3. the remaining items wait for that new turn to settle, preserving order.
 *
 * Difference from DSH: DSH's queue is a durable Host-side inbox
 * (`ui-conversation/src/client/queue/QueueDock.tsx` renders it from the `inbox`
 * projection with `next-turn` / `next-step` delivery windows, edit and steer
 * actions, and survival across reloads). This queue is browser-memory React
 * state: page-level, text-only, dropped on refresh/navigation, with no edit and
 * no steer. Steer is not stubbed here because the backend has no such channel;
 * a queued row only ever becomes the next turn.
 *
 * Failure handling: a failed auto-send (409 because the backend is still busy,
 * transport error, ...) marks that row `error` and surfaces the message through
 * the composer notice. The row is kept so the user can remove it explicitly;
 * the hook never silently drops a message and never auto-retries.
 */
import * as React from "react";

import { sendChat } from "@/v2/data/chat-send";
import { turnEffortFor } from "@/v2/data/turn-effort";

/** Lifecycle of one queued submission inside this browser page. */
export type QueuedSubmissionStatus = "queued" | "sending" | "error";

/** One text-only submission waiting for its turn. */
export interface QueuedSubmission {
  /** Page-local row id; never sent to the backend. */
  readonly id: string;
  /** Plain-text body, exactly what `POST /api/chat` receives. */
  readonly text: string;
  /** Task the draft was queued for; a row only flushes on its own task. */
  readonly taskId: string;
  readonly status: QueuedSubmissionStatus;
  /** Backend/transport failure message, kept on the row once `status` is `error`. */
  readonly error: string | null;
}

/**
 * Inputs the queue needs from the composer; all live values are read through refs.
 *
 * Stop semantics: DSH cancels with `keepInbox: true`
 * (`api/session-controller/src/commands.ts:538`; `docs/subsystems/core.md:351-356`),
 * so a user stop aborts the turn but leaves pending rows waiting for a later turn
 * instead of sending them. `stopRequested` carries that fact: the run-end edge that
 * follows a stop holds the queue; the next explicit send (or a new run that settles
 * normally) releases it.
 */
export interface ComposerQueueOptions {
  /** Open task, or null when nothing is selected (a queue cannot flush then). */
  readonly taskId: string | null;
  /** Backend run state of the open task, owned by the shell's single poll. */
  readonly running: boolean;
  /** A manual `POST /api/chat` is in flight; an idle status read is not a boundary yet. */
  readonly sending: boolean;
  /** Begin following the turn a successful auto-send just started. */
  readonly startRun: () => void;
  /** Notified after an auto-send was accepted, so the owner can reload the tail. */
  readonly onSent?: () => void;
  /** Report/clear the auto-send failure notice. */
  readonly onError: (message: string | null) => void;
}

/** Why the queue is not draining right now, for the dock's status line. */
export type ComposerQueueHold = "none" | "stopped";

/** Queue state and the two user gestures on it. */
export interface ComposerQueue {
  readonly items: readonly QueuedSubmission[];
  /** True while the hook's automatic POST is in flight (the queue is busy). */
  readonly flushing: boolean;
  /** `stopped` after a user stop: rows are kept and wait for the next send. */
  readonly hold: ComposerQueueHold;
  /** Append a draft for the open task; empty text is ignored. */
  enqueue: (text: string) => void;
  /** Drop one row; a row the hook is currently sending stays until it settles. */
  remove: (id: string) => void;
  /** Record a user stop so the following run end keeps the rows (DSH `keepInbox`). */
  noteStop: () => void;
  /** Release a stop hold; the next idle edge drains the head row again. */
  release: () => void;
}

let nextQueuedId = 0;

/**
 * Read the draft text and move it into the queue.
 * @param text - trimmed draft text; an empty string queues nothing.
 * @param taskId - task the row belongs to.
 * @returns a new queued row.
 */
function makeRow(text: string, taskId: string): QueuedSubmission {
  nextQueuedId += 1;
  return { id: `queued-${nextQueuedId}`, text, taskId, status: "queued", error: null };
}

/**
 * Own the browser-side submission queue for one composer.
 * @param options - run state, the open task, and the send/notify callbacks.
 * @returns the queued rows plus enqueue/remove.
 */
export function useComposerQueue(options: ComposerQueueOptions): ComposerQueue {
  const [items, setItems] = React.useState<readonly QueuedSubmission[]>([]);
  const [flushing, setFlushing] = React.useState(false);
  const [hold, setHold] = React.useState<ComposerQueueHold>("none");
  const holdRef = React.useRef<ComposerQueueHold>("none");

  // One mutable mirror so effects and async continuations read the newest rows
  // without re-subscribing on every state change.
  const itemsRef = React.useRef<readonly QueuedSubmission[]>([]);
  const taskRef = React.useRef<string | null>(options.taskId);
  const prevRunningRef = React.useRef(options.running);
  const sendingRef = React.useRef(options.sending);
  const flushingRef = React.useRef(false);
  const startRef = React.useRef(options.startRun);
  const sentRef = React.useRef(options.onSent);
  const errorRef = React.useRef(options.onError);

  taskRef.current = options.taskId;
  sendingRef.current = options.sending;
  startRef.current = options.startRun;
  sentRef.current = options.onSent;
  errorRef.current = options.onError;

  /** Write rows through the mirror first, so a following effect sees them. */
  const commit = React.useCallback(
    (update: (current: readonly QueuedSubmission[]) => readonly QueuedSubmission[]): void => {
      const next = update(itemsRef.current);
      itemsRef.current = next;
      setItems(next);
    },
    [],
  );

  /**
   * Send the head row when the page is idle and that row belongs to the open
   * task. The ref lock makes StrictMode's doubled effects and any duplicate
   * render harmless: at most one POST is in flight per settled turn.
   */
  const flush = React.useCallback((): void => {
    if (flushingRef.current) return;
    if (holdRef.current === "stopped") return;
    const taskId = taskRef.current;
    if (taskId === null) return;
    const head = itemsRef.current[0];
    if (head === undefined || head.status !== "queued" || head.taskId !== taskId) return;
    flushingRef.current = true;
    setFlushing(true);
    errorRef.current(null);
    commit((current) => current.map((row) => (row.id === head.id ? { ...row, status: "sending" } : row)));
    void sendChat(head.text, head.taskId, [], undefined, turnEffortFor(head.taskId) || undefined)
      .then(() => {
        // 202 accepted: the row has become a real turn, so it leaves the queue.
        commit((current) => current.filter((row) => row.id !== head.id));
        // Follow that turn through the shell's poll; the next row waits for the
        // next true -> false edge instead of racing into the busy backend.
        startRef.current();
        sentRef.current?.();
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        // Keep the row (visible with its error) instead of dropping the message.
        commit((current) =>
          current.map((row) => (row.id === head.id ? { ...row, status: "error", error: message } : row)),
        );
        errorRef.current(message);
      })
      .finally(() => {
        flushingRef.current = false;
        setFlushing(false);
      });
  }, [commit]);

  // Run-ended flush: the status poll's true -> false edge is the delivery window
  // this backend offers, so the head row goes out exactly on that edge.
  React.useEffect(() => {
    const previous = prevRunningRef.current;
    prevRunningRef.current = options.running;
    if (!previous || options.running) return;
    if (options.sending) return;
    flush();
  }, [options.running, options.sending, flush]);

  // Idle fallback: a row can also be queued during the sending window, so if the
  // send failed before a turn ever started, an idle queue head still drains.
  // `flushing`/`sending` gate this so it never races a live request.
  React.useEffect(() => {
    if (options.running || options.sending) return;
    flush();
  }, [options.running, options.sending, items, flush]);

  const enqueue = React.useCallback(
    (text: string): void => {
      const body = text.trim();
      const taskId = taskRef.current;
      if (body === "" || taskId === null) return;
      commit((current) => [...current, makeRow(body, taskId)]);
    },
    [commit],
  );

  const remove = React.useCallback(
    (id: string): void => {
      commit((current) => current.filter((row) => row.id !== id || row.status === "sending"));
    },
    [commit],
  );

  const noteStop = React.useCallback((): void => {
    holdRef.current = "stopped";
    setHold("stopped");
  }, []);

  const release = React.useCallback((): void => {
    if (holdRef.current === "none") return;
    holdRef.current = "none";
    setHold("none");
  }, []);

  // A hold is per task: switching away releases it, so another task's rows are
  // never pinned by a stop that happened elsewhere.
  React.useEffect(() => {
    holdRef.current = "none";
    setHold("none");
  }, [options.taskId]);

  return { items, flushing, hold, enqueue, remove, noteStop, release };
}

/** Shared notice copy for a draft that still carries attachments while busy. */
export const QUEUE_ATTACHMENT_NOTICE = "运行中暂不支持附件排队";
