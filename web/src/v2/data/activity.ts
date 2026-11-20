"use client";

/** Adapter for one task's activity stream, feeding the conversation area. */
import { useCallback, useEffect, useRef, useState } from "react";

import { api, sseUrl } from "@/lib/api";
import { MOCK } from "@/lib/mock/enabled";
import type { Activity } from "@/lib/types";

export type ActivityPhase = "idle" | "loading" | "ready" | "offline";

export interface ActivityState {
  phase: ActivityPhase;
  activities: Activity[];
  error: string | null;
  /** True while the live tail (SSE) is attached to this task. */
  live: boolean;
  reload: () => void;
}

/**
 * The flat activity log is ascending, and `GET /exploration/activity` only returns
 * `limit` rows *after* `since` — so a single `limit: 200` request lands on the
 * oldest rows of a long task and the conversation freezes hours behind. Walk the
 * cursor forward instead, keeping only the trailing window the conversation mounts.
 */
const PAGE = 400;
const MAX_ROWS = 800;
const MAX_PAGES = 60;

async function loadTail(taskId: string): Promise<{ rows: Activity[]; cursor: number }> {
  let since = 0;
  let rows: Activity[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    // Sequential cursor walk: page N+1 needs page N's cursor, so no Promise.all.
    const value = await api.activity(taskId, { since, limit: PAGE });
    rows = rows.concat(value.items);
    if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS);
    if (value.items.length === 0 || value.cursor <= since) break;
    since = value.cursor;
    if (value.items.length < PAGE) break;
  }
  return { rows, cursor: since };
}

/**
 * Read a task's activity stream, newest window first, then follow it live.
 *
 * The chat endpoint answers `202 accepted` (the turn runs asynchronously), so a
 * one-shot fetch when the draft is cleared can never show the reply. Attaching the
 * task's SSE tail means the user message, the model's answer and every tool step
 * appear as the engine writes them — the same contract the legacy DSH workspace
 * uses (`activityHistory(...).snapshotCursor` → `/activity/stream?since=`).
 *
 * @param taskId - selected task, or null when nothing is open.
 * @returns phase (`idle` without a task), activities, live flag and a reload callback.
 */
export function useActivities(taskId: string | null): ActivityState {
  const [phase, setPhase] = useState<ActivityPhase>("idle");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [tick, setTick] = useState(0);
  const renderedTask = useRef<string | null>(null);

  useEffect(() => {
    if (taskId === null) {
      renderedTask.current = null;
      setPhase("idle");
      setActivities([]);
      setLive(false);
      return;
    }
    let alive = true;
    let source: EventSource | null = null;
    // A reload of the same task must not flash the loading placeholder: that
    // unmounts the lane and its scroll position (a reader leafing back through
    // history would be thrown to the floor). Only a task switch re-enters loading.
    if (renderedTask.current !== taskId) {
      renderedTask.current = taskId;
      setPhase("loading");
    }
    setLive(false);
    loadTail(taskId)
      .then(({ rows, cursor }) => {
        if (!alive) return;
        // `GET /exploration/activity` wraps the list: { items, cursor }.
        setActivities(rows);
        setPhase("ready");
        if (MOCK || typeof EventSource === "undefined") return;
        // History holds seq <= cursor; the stream replays seq > cursor and then
        // pushes live rows, so the two halves meet without a gap.
        source = new EventSource(
          sseUrl(`/api/exploration/activity/stream?task=${encodeURIComponent(taskId)}&since=${cursor}`),
        );
        source.onopen = () => {
          if (alive) setLive(true);
        };
        // EventSource reconnects on its own (Last-Event-ID resumes at the last row),
        // so a drop only downgrades the badge until the browser re-attaches.
        source.onerror = () => {
          if (alive) setLive(false);
        };
        source.onmessage = (event: MessageEvent<string>) => {
          if (!alive) return;
          let next: Activity | null = null;
          try {
            next = JSON.parse(event.data) as Activity;
          } catch {
            next = null;
          }
          if (next === null || typeof next.seq !== "number") return;
          const row = next;
          setActivities((prev) => {
            if (prev.some((item) => item.seq === row.seq)) return prev;
            const merged = [...prev, row].sort((a, b) => a.seq - b.seq);
            return merged.length > MAX_ROWS ? merged.slice(merged.length - MAX_ROWS) : merged;
          });
        };
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
      source?.close();
    };
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, activities, error, live, reload };
}
