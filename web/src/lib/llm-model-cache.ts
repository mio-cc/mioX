"use client";

import { getLocalStorageValue, removeLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

export interface LLMModelCache {
  models: string[];
  updatedAt: number;
}

const CACHE_PREFIX = "artex_llm_models:";
const MAX_MODELS = 2000;

function defaultBaseURL(provider: string): string {
  if (provider === "anthropic") return "https://api.anthropic.com";
  return "https://api.openai.com/v1";
}

function normalizeBaseURL(provider: string, baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, "");
  if (trimmed) return trimmed;
  return defaultBaseURL(provider);
}

function cacheKey(provider: string, baseURL: string): string {
  return `${CACHE_PREFIX}${provider}:${normalizeBaseURL(provider, baseURL)}`;
}

function sanitizeModels(models: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const item of models) {
    const model = item.trim();
    if (model) unique.add(model);
  }
  return [...unique].sort((a, b) => a.localeCompare(b)).slice(0, MAX_MODELS);
}

/** Read the remembered model list for one API endpoint. */
export function loadLLMModelCache(provider: string, baseURL: string): LLMModelCache | null {
  const raw = getLocalStorageValue(cacheKey(provider, baseURL));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LLMModelCache>;
    if (!Array.isArray(parsed.models)) return null;
    const models = sanitizeModels(parsed.models.filter((item): item is string => typeof item === "string"));
    if (models.length === 0) return null;
    return { models, updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0 };
  } catch {
    return null;
  }
}

/** Remember a successful model list fetch for this provider + Base URL. */
export function saveLLMModelCache(provider: string, baseURL: string, models: readonly string[]): LLMModelCache | null {
  const next = sanitizeModels(models);
  if (next.length === 0) return null;
  const value: LLMModelCache = { models: next, updatedAt: Date.now() };
  setLocalStorageValue(cacheKey(provider, baseURL), JSON.stringify(value));
  return value;
}

export function clearLLMModelCache(provider: string, baseURL: string): void {
  removeLocalStorageValue(cacheKey(provider, baseURL));
}

export function formatModelCacheTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}