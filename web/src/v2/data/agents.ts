"use client";

/**
 * Adapter for the configured agent presets: the list (GET /agents), one agent's
 * detail (GET /agents/{key}) and the custom-agent meta CRUD (POST/PATCH/DELETE),
 * plus the per-agent editor writes the detail page owns — prompt versions,
 * wrapup prompts, run config, prompt preview and MCP/skill visibility.
 * Every call here is a real backend request; nothing is cached or invented.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Agent, AgentDetail } from "@/lib/types";

export type AgentsPhase = "loading" | "ready" | "offline";

export interface AgentsState {
  phase: AgentsPhase;
  agents: Agent[];
  error: string | null;
  reload: () => void;
}

/** The backend's key rule (`ARTEX/server/server_mgmt.go:65` reAgentKey). */
export const AGENT_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Fields the create form owns; everything else about an agent is out of scope. */
export interface AgentInput {
  key: string;
  name: string;
  description: string;
}

/**
 * Read the agent presets once.
 * @returns phase, agents and a reload callback.
 */
export function useAgents(): AgentsState {
  const [phase, setPhase] = useState<AgentsPhase>("loading");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .agents()
      .then((value) => {
        if (!alive) return;
        // The api client already unwraps `{ agents }` into an array.
        setAgents(value);
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
  return { phase, agents, error, reload };
}

export type AgentDetailPhase = "idle" | "loading" | "ready" | "offline";

export interface AgentDetailState {
  phase: AgentDetailPhase;
  detail: AgentDetail | null;
  error: string | null;
}

/**
 * Read one agent's detail once per key.
 * @param key agent key, or null to stay idle (no request).
 * @returns phase, the AgentDetail payload and an error message.
 */
export function useAgentDetail(key: string | null): AgentDetailState {
  const [phase, setPhase] = useState<AgentDetailPhase>("idle");
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (key === null) {
      setPhase("idle");
      setDetail(null);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    setDetail(null);
    setError(null);
    api
      .getAgent(key)
      .then((value) => {
        if (!alive) return;
        setDetail(value);
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
  }, [key]);

  return { phase, detail, error };
}

/** Create a custom conversational agent (POST /agents). Builtin agents cannot be created. */
export async function createAgent(input: AgentInput): Promise<Agent> {
  return api.createAgent(input.key, input.name, input.description);
}

/** Rename a custom agent and/or rewrite its description (PATCH /agents/{key}). */
export async function updateAgentMeta(key: string, name: string, description: string): Promise<void> {
  await api.updateAgent(key, name, description);
}

/** Delete a custom agent (DELETE /agents/{key}); the backend rejects builtin keys. */
export async function deleteAgent(key: string): Promise<void> {
  await api.deleteAgent(key);
}

/**
 * One agent's full editor payload, read through a single GET /agents/{key}.
 * The backend already returns prompt + variables + versions + visibility inside
 * that response (`ARTEX/server/server_mgmt.go` handleGetAgent), so the editor
 * never issues per-tab reads.
 */
export interface AgentEditorState {
  phase: AgentDetailPhase;
  detail: AgentDetail | null;
  error: string | null;
  reload: () => void;
}

/**
 * Read one agent's editor payload and keep a reload callback.
 * @param key agent key, or null to stay idle (no request).
 * @returns phase, the AgentDetail payload, an error message and reload.
 */
export function useAgentEditor(key: string | null): AgentEditorState {
  const [phase, setPhase] = useState<AgentDetailPhase>("idle");
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === null) {
      setPhase("idle");
      setDetail(null);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .getAgent(key)
      .then((value) => {
        if (!alive) return;
        setDetail(value);
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
  }, [key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, detail, error, reload };
}

/**
 * Save the system prompt as a new version (PUT /agents/{key}/prompt).
 * @param key agent key.
 * @param template prompt body; an empty body clears the override.
 * @param note version note shown in the history list.
 * @returns the version number the backend assigned.
 */
export async function savePrompt(key: string, template: string, note = ""): Promise<number> {
  const result = await api.saveAgentPrompt(key, template, note);
  return result.version;
}

/**
 * Drop the saved prompt and fall back to the built-in default (POST .../prompt/reset).
 * @param key agent key.
 * @returns the version number created by the reset.
 */
export async function resetPrompt(key: string): Promise<number> {
  const result = await api.resetAgentPrompt(key);
  return result.version;
}

/**
 * Render the given prompt body through the backend variable substitution.
 * The endpoint renders only; it never calls a model.
 * @param key agent key.
 * @param template prompt body to render.
 * @returns the rendered text plus a backend-reported render error, if any.
 */
export async function previewPrompt(
  key: string,
  template: string,
): Promise<{ rendered: string; error: string | null }> {
  const result = await api.previewAgentPrompt(key, template);
  return { rendered: result.rendered, error: result.error ?? null };
}

/**
 * Save the per-run wrapup prompt and its turn budget (PUT /agents/{key}/wrapup).
 * @param key agent key.
 * @param prompt wrapup body; empty clears the override.
 * @param maxTurns wrapup turn budget; 0 uses the built-in default.
 */
export async function saveWrapup(key: string, prompt: string, maxTurns: number): Promise<void> {
  await api.saveAgentWrapup(key, prompt, maxTurns);
}

/** Reset the per-run wrapup prompt to the built-in default (POST .../wrapup/reset). */
export async function resetWrapup(key: string): Promise<void> {
  await api.resetAgentWrapup(key);
}

/**
 * Save the task-timeout wrapup prompt (PUT /agents/{key}/wrapup/task-timeout).
 * @param key agent key.
 * @param prompt wrapup body; empty clears the override.
 * @param maxTurns wrapup turn budget; 0 uses the built-in default.
 */
export async function saveTaskTimeoutWrapup(key: string, prompt: string, maxTurns: number): Promise<void> {
  await api.saveAgentTaskTimeoutWrapup(key, prompt, maxTurns);
}

/** Reset the task-timeout wrapup prompt (POST .../wrapup/task-timeout/reset). */
export async function resetTaskTimeoutWrapup(key: string): Promise<void> {
  await api.resetAgentTaskTimeoutWrapup(key);
}

/**
 * Fields PUT /agents/{key}/config accepts. An omitted key is left untouched, so
 * a form only sends the fields it actually shows.
 */
export interface AgentConfigPatch {
  llm_profile_id?: number | null;
  max_turns?: number;
  run_seconds?: number;
  web_search?: boolean;
  interactive_shell?: boolean;
  trigger_run_mode?: "serial" | "parallel";
  trigger_merge_mode?: "by_task" | "all" | "none";
  trigger_max_parallel?: number;
}

/** Persist a run-config patch (PUT /agents/{key}/config); applies immediately. */
export async function saveAgentConfig(key: string, patch: AgentConfigPatch): Promise<void> {
  await api.saveAgentConfig(key, patch);
}

/**
 * Replace an agent's MCP/skill visibility (PUT /agents/{key}/visibility).
 * @param key agent key.
 * @param mcp visible MCP server ids.
 * @param skill visible skill names.
 */
export async function saveVisibility(key: string, mcp: number[], skill: string[]): Promise<void> {
  await api.setAgentVisibility(key, mcp, skill);
}
