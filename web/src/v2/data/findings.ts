"use client";

/** Adapter for the findings list shown in the right panel. */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Finding } from "@/lib/types";

export type FindingsPhase = "loading" | "ready" | "offline";

export interface FindingsState {
  phase: FindingsPhase;
  findings: Finding[] | null;
  error: string | null;
  reload: () => void;
}

/**
 * Read findings once.
 * @param task - optional task id to scope the query.
 * @returns phase, findings and a reload callback.
 */
export function useFindings(task?: string): FindingsState {
  const [phase, setPhase] = useState<FindingsPhase>("loading");
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .findings(task)
      .then((value) => {
        if (!alive) return;
        // `GET /exploration/findings` returns a bare array (unlike /tasks).
        setFindings(value);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [task, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, findings, error, reload };
}
