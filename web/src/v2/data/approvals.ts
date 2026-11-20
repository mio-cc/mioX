"use client";

/** Adapter for the intercept layer's pending approval requests. */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { InterceptPending } from "@/lib/types";

export type ApprovalsPhase = "loading" | "ready" | "offline";

export interface ApprovalsState {
  phase: ApprovalsPhase;
  pending: InterceptPending[];
  error: string | null;
  reload: () => void;
}

/**
 * Read pending approvals once.
 * @returns phase, pending rows and a reload callback.
 */
export function useApprovals(): ApprovalsState {
  const [phase, setPhase] = useState<ApprovalsPhase>("loading");
  const [pending, setPending] = useState<InterceptPending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .interceptPending()
      .then((value) => {
        if (!alive) return;
        // The client already unwraps { pending } into an array.
        setPending(value);
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
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, pending, error, reload };
}

/**
 * Answer one pending intercept request.
 * Forwarded verbatim: the pane keeps its own busy state and toast, and a
 * rejection reaches it unchanged.
 * @param id - pending request id.
 * @param decision - `allowed` or `denied`; the backend records the verdict.
 * @returns `{ ok: true }` once the decision was recorded.
 */
export function decideApproval(id: number, decision: "allowed" | "denied"): Promise<{ ok: boolean }> {
  return api.interceptDecide(id, decision);
}
