"use client";

/**
 * Agent 触发器（P3 调度）的适配器：一个自定义 Agent 的触发器列表
 * (GET /agents/{key}/triggers)、新建 (POST)、改（PATCH /triggers/{id}）、
 * 删（DELETE /triggers/{id}），外加工具调用触发用的工具目录 (GET /tools)。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/agents/page.tsx 里的 AgentEditor
 * 触发器页签，组件 ARTEX/web/src/components/agent-editor.tsx:776,785-902,1159
 * （条件摘要 :904-913、6 种条件字段 :1006-1098）。
 * DSH 依据：DSH 无触发器（近似 schedule_create 定时任务），按设置分节扩展。
 * 对照表行：P3:A12
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { AgentTrigger } from "@/lib/types";

/** 新建 / 编辑表单提交的字段：就是 AgentTrigger 去掉后端自己填的 id / agent_key / last_fire。 */
export type AgentTriggerInput = Omit<AgentTrigger, "id" | "agent_key" | "last_fire">;

export type AgentTriggersPhase = "idle" | "loading" | "ready" | "offline";

export interface AgentTriggersState {
  phase: AgentTriggersPhase;
  triggers: AgentTrigger[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个 Agent 的触发器列表。
 * @param agentKey - Agent key；null 时不请求。
 * @returns 阶段、触发器列表、错误、重新读取。
 */
export function useAgentTriggers(agentKey: string | null): AgentTriggersState {
  const [phase, setPhase] = useState<AgentTriggersPhase>("idle");
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (agentKey === null) {
      setPhase("idle");
      setTriggers([]);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .agentTriggers(agentKey)
      .then((value) => {
        if (!alive) return;
        setTriggers(value);
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
  }, [agentKey, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, triggers, error, reload };
}

export type AgentToolCatalogPhase = "loading" | "ready" | "offline";

export interface AgentToolCatalogState {
  phase: AgentToolCatalogPhase;
  tools: { key: string; description: string }[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取工具目录（GET /tools），给「工具调用时触发」的工具多选提供真实候选。
 * @returns 阶段、工具 key + 描述、错误、重新读取。
 */
export function useTriggerToolCatalog(): AgentToolCatalogState {
  const [phase, setPhase] = useState<AgentToolCatalogPhase>("loading");
  const [tools, setTools] = useState<{ key: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .tools()
      .then((value) => {
        if (!alive) return;
        setTools(value.map((tool) => ({ key: tool.key, description: tool.description })));
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
  return { phase, tools, error, reload };
}

/**
 * 新建一个触发器（POST /agents/{key}/triggers）。注意：enabled 以入参为准，
 * 本文件不替调用方打开触发（触发器会定时拉起运行）。
 * @param agentKey - Agent key。
 * @param input - 6 种条件与各自的消息体。
 * @returns 后端返回的新触发器；失败时抛出带后端信息的 Error。
 */
export function createAgentTrigger(agentKey: string, input: AgentTriggerInput): Promise<AgentTrigger> {
  return api.createTrigger(agentKey, input);
}

/**
 * 保存一个触发器的修改（PATCH /triggers/{id}）。整条覆盖，enabled 以入参为准。
 * @param id - 触发器 id。
 * @param input - 6 种条件与各自的消息体。
 */
export async function updateAgentTrigger(id: number, input: AgentTriggerInput): Promise<void> {
  await api.updateTrigger(id, input);
}

/**
 * 删除一个触发器（DELETE /triggers/{id}）。
 * @param id - 触发器 id。
 */
export async function deleteAgentTrigger(id: number): Promise<void> {
  await api.deleteTrigger(id);
}

/**
 * 列表行上的一键启停：把该条触发器的现有字段原样回传，只翻转 enabled。
 * @param trigger - 列表里那一行（字段全部来自后端）。
 * @param enabled - 目标启用态。
 */
export async function setAgentTriggerEnabled(trigger: AgentTrigger, enabled: boolean): Promise<void> {
  await api.updateTrigger(trigger.id, {
    enabled,
    interval_sec: trigger.interval_sec,
    on_finding: trigger.on_finding,
    on_goal_met: trigger.on_goal_met,
    on_task_timeout: trigger.on_task_timeout,
    on_tool_call: trigger.on_tool_call,
    on_task_create: trigger.on_task_create,
    interval_message: trigger.interval_message,
    finding_message: trigger.finding_message,
    goal_message: trigger.goal_message,
    task_timeout_message: trigger.task_timeout_message,
    tool_call_message: trigger.tool_call_message,
    task_create_message: trigger.task_create_message,
    tool_names: trigger.tool_names,
  });
}

/**
 * 条件摘要（照旧页面 agent-editor.tsx:904-913）：把打开的条件拼成一句话。
 * @param trigger - 一行触发器。
 * @returns 如「每 60s · 发现 finding」；一个条件都没开时返回「（无条件）」。
 */
export function triggerConditionSummary(trigger: AgentTrigger): string {
  const parts: string[] = [];
  if (trigger.interval_sec > 0) parts.push(`每 ${trigger.interval_sec}s`);
  if (trigger.on_finding) parts.push("发现 finding");
  if (trigger.on_goal_met) parts.push("目标达成");
  if (trigger.on_task_timeout) parts.push("任务超时");
  if (trigger.on_tool_call) parts.push(`工具调用(${trigger.tool_names.length})`);
  if (trigger.on_task_create) parts.push("任务创建");
  return parts.join(" · ") === "" ? "（无条件）" : parts.join(" · ");
}

/**
 * 最后触发时间：后端 last_fire 缺省 = 从未触发。
 * @param value - last_fire 原值。
 * @returns 本地时间文本，或「从未触发」。
 */
export function formatLastFire(value: string | undefined): string {
  if (value === undefined || value === "") return "从未触发";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString("zh-CN");
}
