"use client";

/** Adapter for the LLM failover pool status. */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { LLMPoolStatus } from "@/lib/types";

/**
 * Clear one profile's breaker so the next call retries it immediately.
 * Only called from an explicit user action; omitted id clears every breaker.
 * @param id - profile id.
 * @returns the pool status after the reset.
 */
export async function resetLlmPoolMember(id?: string): Promise<LLMPoolStatus> {
  return api.resetLLMPool(id);
}

export type PoolPhase = "loading" | "ready" | "offline";

export interface PoolState {
  phase: PoolPhase;
  pool: LLMPoolStatus | null;
  error: string | null;
  reload: () => void;
}

/**
 * Read the pool status once.
 * @returns phase, pool payload and a reload callback.
 */
export function useLlmPool(): PoolState {
  const [phase, setPhase] = useState<PoolPhase>("loading");
  const [pool, setPool] = useState<LLMPoolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .llmPool()
      .then((value) => {
        if (!alive) return;
        setPool(value);
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
  return { phase, pool, error, reload };
}
