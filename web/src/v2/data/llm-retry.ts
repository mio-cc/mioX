"use client";

/**
 * Adapter for the global LLM retry policy: five independent layers, each with
 * an attempt count and a fixed retry interval. Writes only happen from an
 * explicit save action in the settings dialog.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { LLMRetryPolicy } from "@/lib/types";

/** One editable layer of the policy, with the copy the settings row shows. */
export interface RetryLayer {
  key: keyof LLMRetryPolicy;
  label: string;
  hint: string;
}

/** The five layers the backend exposes (`LLMRetryPolicy`), in row order. */
export const RETRY_LAYERS: readonly RetryLayer[] = [
  { key: "connect", label: "建连重试", hint: "连接重置 / 超时 / 429 / 5xx，流开始前" },
  { key: "empty", label: "空响应重试", hint: "完成但没有任何内容（仅 openai 格式）" },
  { key: "stream", label: "安全窗口重试", hint: "未交付输出前的断流重放（同 provider）" },
  { key: "breaker", label: "轮询熔断", hint: "连续几次瞬时失败进入熔断，冷却固定时长" },
  { key: "intent", label: "意图重跑", hint: "worker 以 model_error 收场后整条意图重跑" },
] as const;

export type RetryPhase = "loading" | "ready" | "offline";

export interface RetryState {
  phase: RetryPhase;
  policy: LLMRetryPolicy | null;
  error: string | null;
  reload: () => void;
  /** Persist the whole policy; resolves to an error message when the write fails. */
  save: (next: LLMRetryPolicy) => Promise<string | null>;
}

/**
 * Read the global retry policy once.
 * @returns phase, the policy and reload/save callbacks.
 */
export function useLlmRetryPolicy(): RetryState {
  const [phase, setPhase] = useState<RetryPhase>("loading");
  const [policy, setPolicy] = useState<LLMRetryPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .llmRetryPolicy()
      .then((value) => {
        if (!alive) return;
        setPolicy(value);
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

  const save = useCallback(async (next: LLMRetryPolicy): Promise<string | null> => {
    try {
      const stored = await api.saveLLMRetryPolicy(next);
      setPolicy(stored);
      setPhase("ready");
      setError(null);
      return null;
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      return message;
    }
  }, []);

  return { phase, policy, error, reload, save };
}
