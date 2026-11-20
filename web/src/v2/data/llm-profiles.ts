"use client";

/** Adapter for the configured LLM profiles behind the composer's model picker. */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { LLMProfile } from "@/lib/types";

/** Writable subset of one profile; omitted fields keep the stored value. */
export type LlmProfileDraft = Parameters<typeof api.saveLLMProfile>[0];

/**
 * Create or update one LLM profile. Only called from an explicit user action.
 * @param draft - profile fields; `id` set means update that profile.
 * @returns the profile id the backend stored/updated.
 */
export async function saveLlmProfile(draft: LlmProfileDraft): Promise<number> {
  const result = await api.saveLLMProfile(draft);
  return result.id;
}

/**
 * Delete one LLM profile. Only called from an explicit user action.
 * @param id - profile id.
 */
export async function deleteLlmProfile(id: string): Promise<void> {
  await api.deleteLLMProfile(id);
}

/**
 * Make one profile the globally active model. This switches what every
 * unbound Agent uses, so it only runs from a dedicated button.
 * @param id - profile id to activate.
 */
export async function activateLlmProfile(id: string): Promise<void> {
  await api.activateLLMProfile(id);
}

/** One real send/receive round against a provider endpoint. */
export interface LlmProbeInput {
  provider: string;
  model: string;
  baseUrl: string;
  /** Blank keeps the stored key: `profileId` makes the backend reuse it. */
  apiKey: string;
  proxy?: string;
  /** Stored thinking_type ("" = send nothing). */
  thinkingType?: string;
  /** Stored reasoning_effort ("" = send nothing). */
  reasoningEffort?: string;
  profileId?: number;
  streaming?: boolean;
  /** Non-empty = also send this session header on the probe request. */
  sessionHeaderKey?: string;
}

/** What the endpoint answered, plus the measured round trip. */
export interface LlmProbeResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  model?: string;
  reply?: string;
}

/**
 * Send one real request to the configured endpoint. This transmits the key to
 * an external URL, so it only runs from the explicit 测试连接 button.
 * @param input - the draft the probe should use.
 * @returns ok flag, the endpoint reply and latency, or its error message.
 */
export async function testLlmConnection(input: LlmProbeInput): Promise<LlmProbeResult> {
  const result = await api.testLLM(
    input.provider,
    input.model,
    input.baseUrl,
    input.apiKey,
    input.proxy ?? "",
    input.thinkingType ?? "",
    input.reasoningEffort ?? "",
    input.profileId,
    input.streaming ?? true,
    input.sessionHeaderKey ?? "",
  );
  return {
    ok: result.ok === true,
    error: result.error,
    latencyMs: result.latency_ms,
    model: result.model,
    reply: result.reply,
  };
}

/**
 * Ask a provider endpoint for its model catalog. This sends the configured
 * credentials to that endpoint, so it only runs from an explicit user action.
 * @param provider - API format/provider the endpoint speaks.
 * @param baseUrl - endpoint base URL.
 * @param apiKey - credential to send (blank = whatever the endpoint allows).
 * @param proxy - optional per-profile proxy the request must use.
 * @param profileId - set = reuse that profile's stored key when `apiKey` is blank.
 * @returns success flag, an error message when the endpoint rejected it, and the model ids.
 */
export async function fetchLlmModels(
  provider: string,
  baseUrl: string,
  apiKey: string,
  proxy = "",
  profileId?: number,
): Promise<{ ok: boolean; error?: string; models: string[] }> {
  const result = await api.fetchLLMModels(provider, baseUrl, apiKey, proxy, profileId);
  return { ok: result.ok === true, error: result.error, models: result.models ?? [] };
}

/**
 * Format a profile's `context_window_k` for the capacity input.
 * The backend unit is thousands of tokens, so 1000 renders as `1M`.
 * @param k - context window in thousands of tokens (0/undefined = unset).
 * @returns display text ("" when unset).
 */
export function formatContextWindow(k: number | undefined): string {
  if (k === undefined || k <= 0) return "";
  return k % 1000 === 0 ? `${k / 1000}M` : `${k}K`;
}

/**
 * Parse the capacity input back into `context_window_k`.
 * Accepts `1M`, `256K` and raw totals (rounded to thousands).
 * @param text - user input.
 * @returns thousands of tokens, or null when the text is not a positive number.
 */
export function parseContextWindow(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  const match = /^(\d+(?:\.\d+)?)\s*([MK])?$/i.exec(value);
  if (match === null) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (match[2] ?? "").toUpperCase();
  if (unit === "M") return Math.round(n * 1000);
  if (unit === "K") return Math.round(n);
  return Math.round(n / 1000);
}

/**
 * Format a profile's `max_tokens` for the capacity input (`1024` = 1K unit).
 * @param tokens - max output tokens (0/undefined = server default).
 * @returns display text ("" when unset).
 */
export function formatMaxTokens(tokens: number | undefined): string {
  if (tokens === undefined || tokens <= 0) return "";
  return tokens % 1024 === 0 ? `${tokens / 1024}K` : String(tokens);
}

/**
 * Parse the max-output-tokens input.
 * Accepts `128K`, `1M` (1024-based) and raw token counts.
 * @param text - user input.
 * @returns token count, or null when the text is not a positive number.
 */
export function parseMaxTokens(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  const match = /^(\d+(?:\.\d+)?)\s*([KM])?$/i.exec(value);
  if (match === null) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (match[2] ?? "").toUpperCase();
  if (unit === "M") return Math.round(n * 1024 * 1024);
  if (unit === "K") return Math.round(n * 1024);
  return Math.round(n);
}

export type ProfilesPhase = "loading" | "ready" | "offline";

export interface ProfilesState {
  phase: ProfilesPhase;
  profiles: LLMProfile[];
  error: string | null;
  reload: () => void;
}

/**
 * Read the LLM profiles once.
 * @returns phase, profiles and a reload callback.
 */
export function useLlmProfiles(): ProfilesState {  const [phase, setPhase] = useState<ProfilesPhase>("loading");
  const [profiles, setProfiles] = useState<LLMProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .llmProfiles()
      .then((value) => {
        if (!alive) return;
        // `GET /llm/profiles` unwraps to a bare array in the api client.
        setProfiles(value);
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
  return { phase, profiles, error, reload };
}

/** 当前激活的直接配置（`GET /llm`）。`configured=false` 表示一条都没配。 */
export interface ActiveLlm {
  configured: boolean;
  provider: string;
  model: string;
  base_url: string;
}

export interface ActiveLlmState {
  phase: ProfilesPhase;
  llm: ActiveLlm | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取当前激活模型的直接配置（P3:B6 的「关于 → 当前模型」行用）。
 * `/llm/profiles` 不返回哪条是激活态，所以走 `GET /llm` 的 configured/provider/model。
 * @returns 阶段、配置、错误与重新读取。
 */
export function useActiveLlm(): ActiveLlmState {
  const [phase, setPhase] = useState<ProfilesPhase>("loading");
  const [llm, setLlm] = useState<ActiveLlm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .getLLM()
      .then((value) => {
        if (!alive) return;
        setLlm({
          configured: value.configured,
          provider: value.provider,
          model: value.model,
          base_url: value.base_url,
        });
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
  return { phase, llm, error, reload };
}
