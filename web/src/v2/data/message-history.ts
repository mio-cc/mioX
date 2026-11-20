"use client";

/**
 * Adapter for older conversation history (scroll-up paging).
 *
 * The live window is read by `activity.ts` through the forward-only activity feed
 * (`GET /exploration/activity?since=`), which cannot walk backwards. The reverse
 * pager (`GET /exploration/activity/history?before=`) is per session, while the
 * conversation column renders every lane of the task in one transcript, so one
 * page here asks each lane for its own rows below the cutoff and merges them by
 * activity id. Ids are global to the task (`Activity.seq` is the row id), which
 * makes the per-lane pages share one cutoff and meet the window without gaps.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Activity } from "@/lib/types";

/** Rows requested per lane per page. */
const LANE_PAGE = 200;

/** Session keys of one task: main-agent segments, the planner, and every worker intent. */
const sessionCache = new Map<string, Promise<string[]>>();

/**
 * List the session keys the task's rows are recorded under.
 *
 * `main` sessions come from the segment list (bare `main` means the current
 * segment, which would silently drop earlier segments from history), the planner
 * is the fixed `plan` key, and each worker intent is one `intent:<id>` session.
 * @param taskId - task whose lanes are needed.
 * @returns session keys, cached per task.
 */
export function activitySessions(taskId: string): Promise<string[]> {
  const cached = sessionCache.get(taskId);
  if (cached !== undefined) return cached;
  const loading = Promise.all([
    api.mainSessions(taskId).then((value) => value.sessions.map((session) => `main:${session.seq}`)),
    api.intents(taskId).then((intents) => intents.map((intent) => `intent:${intent.id}`)),
  ])
    .then(([mains, intents]) => {
      const keys = [...new Set([...mains, "plan", ...intents])];
      return keys;
    })
    .catch((reason: unknown) => {
      sessionCache.delete(taskId);
      throw reason;
    });
  sessionCache.set(taskId, loading);
  return loading;
}

/**
 * Drop the cached lane list of one task, or of every task.
 *
 * Adding a main-agent segment changes the task's lane set, and a cached list
 * would keep paging only the segments that existed before
 * (`POST /exploration/main-sessions` is what invalidates it).
 * @param taskId - task to forget; omit to forget all tasks.
 */
export function resetActivitySessions(taskId?: string): void {
  if (taskId === undefined) sessionCache.clear();
  else sessionCache.delete(taskId);
}

export interface OlderPage {
  readonly items: Activity[];
  readonly earliest: number;
  readonly hasMore: boolean;
}

/**
 * Read one page of rows older than `before`, across every lane of the task — or
 * of a single lane when `lane` is given (P1-B7 lane switch: a lane view must not
 * page rows of the other lanes).
 * @param taskId - task being read.
 * @param before - activity id cutoff; rows must have a smaller id.
 * @param lane - optional session key; omitted = every lane of the task.
 * @returns merged rows below the cutoff, the new earliest id, and whether older rows remain.
 */
export async function loadOlderHistory(taskId: string, before: number, lane?: string): Promise<OlderPage> {
  const sessions = lane === undefined ? await activitySessions(taskId) : [lane];
  const pages = await Promise.all(
    sessions.map((session) => api.activityHistory(taskId, session, before, LANE_PAGE)),
  );
  const seen = new Set<number>();
  const items: Activity[] = [];
  for (const page of pages) {
    for (const row of page.items) {
      if (row.seq >= before || seen.has(row.seq)) continue;
      seen.add(row.seq);
      items.push(row);
    }
  }
  items.sort((a, b) => a.seq - b.seq);
  return {
    items,
    earliest: items.length > 0 ? items[0].seq : before,
    hasMore: pages.some((page) => page.hasMore),
  };
}

export interface OlderHistoryState {
  /** Older rows, ascending; prepend them to the live window. */
  readonly older: Activity[];
  /** Whether another page exists (or has not been ruled out yet). */
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  /** Request the next older page; ignored while one is in flight. */
  readonly load: () => void;
}

/**
 * Paging state for the conversation's older history.
 * @param taskId - selected task, or null while nothing is open.
 * @param oldestSeq - smallest activity id in the live window; the page cutoff.
 * @param lane - optional lane key (P1-B7): when set, pages are read from that
 * session only, so a single-lane view cannot absorb another lane's rows.
 * @returns the loaded older rows and the paging state/actions.
 */
export function useOlderHistory(taskId: string | null, oldestSeq: number, lane: string | null = null): OlderHistoryState {
  const [older, setOlder] = useState<Activity[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const latest = useRef({ taskId, oldestSeq, older, lane });
  latest.current = { taskId, oldestSeq, older, lane };

  // A task switch — or a lane switch, which is a different transcript — drops
  // the pages of the previous one.
  useEffect(() => {
    setOlder([]);
    setHasMore(true);
    setLoading(false);
    setError(null);
    busy.current = false;
  }, [taskId, lane]);

  const load = useCallback(() => {
    const state = latest.current;
    if (state.taskId === null || busy.current || !hasMore) return;
    const before = Math.min(
      state.oldestSeq > 0 ? state.oldestSeq : Number.MAX_SAFE_INTEGER,
      state.older.length > 0 ? state.older[0].seq : Number.MAX_SAFE_INTEGER,
    );
    if (before === Number.MAX_SAFE_INTEGER) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    loadOlderHistory(state.taskId, before, state.lane ?? undefined)
      .then((page) => {
        // A lane/task switch while the page was in flight makes it stale: its
        // rows belong to another transcript.
        if (latest.current.taskId !== state.taskId || latest.current.lane !== state.lane) return;
        setOlder((prev) => {
          const seen = new Set(prev.map((row) => row.seq));
          const merged = [...page.items.filter((row) => !seen.has(row.seq)), ...prev];
          return merged.sort((a, b) => a.seq - b.seq);
        });
        setHasMore(page.hasMore);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [hasMore]);

  return { older, hasMore, loading, error, load };
}
