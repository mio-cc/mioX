"use client";

/**
 * Adapter for the intercept rules shown in settings.
 * Reads go through GET /intercept/rules; writes through
 * POST/PUT/DELETE /intercept/rules and POST /intercept/rules/{id}/toggle
 * (api.ts:1317-1324). Components get plain data and callbacks, never `fetch`.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { InterceptRule } from "@/lib/types";

export type RulesPhase = "loading" | "ready" | "offline";

/** The payload the backend accepts on create/update (server owns id/timestamps). */
export type InterceptRuleInput = Omit<InterceptRule, "id" | "created_at" | "updated_at">;

export interface RulesState {
  phase: RulesPhase;
  rules: InterceptRule[];
  error: string | null;
  reload: () => void;
}

/**
 * Read the intercept rules once.
 * @returns phase, rules and a reload callback.
 */
export function useInterceptRules(): RulesState {
  const [phase, setPhase] = useState<RulesPhase>("loading");
  const [rules, setRules] = useState<InterceptRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .interceptRules()
      .then((value) => {
        if (!alive) return;
        // The api client unwraps `{ rules }` into an array.
        setRules(value);
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
  return { phase, rules, error, reload };
}

export function createInterceptRule(input: InterceptRuleInput): Promise<InterceptRule> {
  return api.createInterceptRule(input);
}

export function updateInterceptRule(id: number, input: InterceptRuleInput): Promise<InterceptRule> {
  return api.updateInterceptRule(id, input);
}

export function deleteInterceptRule(id: number): Promise<void> {
  return api.deleteInterceptRule(id).then(() => undefined);
}

export function toggleInterceptRule(id: number, enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
  return api.toggleInterceptRule(id, enabled);
}
