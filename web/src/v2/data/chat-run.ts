"use client";

/**
 * Backend run state of one task's chat turn.
 *
 * `POST /api/chat` answers `202 {"mode":"llm","status":"accepted"}`: the turn runs
 * asynchronously, so the accepted response marks the start of a run rather than its
 * result. The backend owns that fact and exposes it as `GET /api/tasks/{id}/chat/status`
 * (`{running: boolean}`), so this adapter polls that endpoint until the turn settles and
 * exposes the stop call that terminates it through the same task. The conversation area
 * keeps following the turn through its own SSE tail (`activity.ts`); stopping a turn
 * never clears it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";

/** Poll cadence: the status endpoint is cheap and a turn lasts seconds. */
const POLL_MS = 1300;
/** Consecutive status failures tolerated before the poll loop gives up. */
const MAX_POLL_FAILURES = 2;

export interface ChatRunState {
  /** True while the backend reports the task's turn as running. */
  running: boolean;
  /** Begin following a turn whose request was just accepted. */
  start: () => void;
  /** Ask the backend to stop the turn; resolves once the request was accepted. */
  stop: () => Promise<void>;
  /** Last status or stop failure, or null once a later read succeeds. */
  error: string | null;
}

/**
 * Follow one task's backend chat turn.
 * @param taskId - selected task, or null when nothing is open.
 * @returns the running flag, the start/stop actions and the last error.
 */
export function useChatRun(taskId: string | null): ChatRunState {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskRef = useRef<string | null>(taskId);
  /** Invalidates an in-flight status read and its scheduled successor. */
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Bump the sequence: anything still awaiting or scheduled becomes a no-op. */
  const supersede = useCallback((): number => {
    seqRef.current += 1;
    clearTimer();
    return seqRef.current;
  }, [clearTimer]);

  /** Read the backend state once; schedule the next read while the turn runs. */
  const check = useCallback((seq: number, failures = 0): void => {
    const id = taskRef.current;
    if (id === null || seq !== seqRef.current) return;
    api.chatStatus(id)
      .then((status) => {
        if (seq !== seqRef.current) return;
        if (!status.running) {
          setRunning(false);
          return;
        }
        setRunning(true);
        timerRef.current = setTimeout(() => check(seq, 0), POLL_MS);
      })
      .catch((reason: unknown) => {
        if (seq !== seqRef.current) return;
        // A single dropped read must not strand a Stop button on a finished turn:
        // retry through the tolerated window, then report and settle.
        if (failures + 1 < MAX_POLL_FAILURES) {
          timerRef.current = setTimeout(() => check(seq, failures + 1), POLL_MS);
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setRunning(false);
      });
  }, []);

  // Mount and task switch: rebind the poll to the selected task and restore a turn
  // that was already running before the page attached.
  useEffect(() => {
    taskRef.current = taskId;
    const seq = supersede();
    setRunning(false);
    setError(null);
    if (taskId === null) return;
    check(seq);
    return () => {
      supersede();
    };
  }, [taskId, check, supersede]);

  const start = useCallback((): void => {
    if (taskRef.current === null) return;
    const seq = supersede();
    setError(null);
    // The backend answered "accepted", so the turn is running until the status
    // endpoint says otherwise; showing Stop immediately matches that fact.
    setRunning(true);
    check(seq);
  }, [check, supersede]);

  /**
   * Ask the backend to stop the running turn. Resolves once the stop request was
   * accepted; the following status read owns the return to the idle state.
   * @returns a promise that rejects with the request failure message.
   */
  const stop = useCallback(async (): Promise<void> => {
    const id = taskRef.current;
    if (id === null) return;
    // Restart the poll loop so a read follows the stop immediately.
    const seq = supersede();
    try {
      await api.stopChat(id);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (seq === seqRef.current) {
        setError(message);
        // The stop never reached the backend, so the turn is still live and its
        // end must still flip the seat back to Send. Resume the poll the request
        // was about to replace.
        check(seq);
      }
      throw new Error(message);
    }
    if (seq === seqRef.current) setError(null);
    check(seq);
  }, [check, supersede]);

  return { running, start, stop, error };
}
