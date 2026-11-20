"use client";

/**
 * 任务级模型绑定与用量适配器（对照表 P1:B16、B17、B30）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/legacy-detail.tsx（任务级 LLM 绑定与解析）、
 * task-workspace-dsh.tsx:3393（任务累计 token）。
 * 接口：api.ts:411 taskLLMResolution、:1438 tokensByModel（按模型）、:782 tokenStats（合计）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { ModelTokenStat, TaskLLMResolutions, TokenTotal } from "@/lib/types";

export type TaskLlmPhase = "loading" | "ready" | "offline";

export interface TaskLlmState {
  phase: TaskLlmPhase;
  /** 三个角色的当前生效模型解析结果；null 表示还没读成功。 */
  resolution: TaskLLMResolutions | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取任务三个角色（主 Agent / Planner / Worker）当前生效的模型。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、解析结果、错误与重新读取。
 */
export function useTaskLlmResolution(taskId: string | null): TaskLlmState {
  const [phase, setPhase] = useState<TaskLlmPhase>("loading");
  const [resolution, setResolution] = useState<TaskLLMResolutions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskLLMResolution(taskId)
      .then((value) => {
        if (!alive) return;
        setResolution(value);
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, resolution, error, reload };
}

/** 生效来源的中文说明（后端 `TaskLLMResolution.source`）。 */
const SOURCE_LABEL: Record<string, string> = {
  task_chain: "任务绑定链",
  agent_binding: "Agent 绑定",
  global_profile: "全局模型",
  environment: "环境变量",
  global: "全局默认",
};

/**
 * 生效来源文案。
 * @param source - 后端 source 字段。
 * @returns 中文说明。
 */
export function resolutionSourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

export type TaskTokensPhase = "loading" | "ready" | "offline";

export interface TaskTokensState {
  phase: TaskTokensPhase;
  /** 整任务合计用量。 */
  total: TokenTotal | null;
  /** 按模型的用量（后端 `GET /llm/records/by-model?task=`）。 */
  byModel: ModelTokenStat[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取任务的 token 用量：合计 + 按模型。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、合计、按模型明细、错误与重新读取。
 */
export function useTaskTokens(taskId: string | null): TaskTokensState {
  const [phase, setPhase] = useState<TaskTokensPhase>("loading");
  const [total, setTotal] = useState<TokenTotal | null>(null);
  const [byModel, setByModel] = useState<ModelTokenStat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    Promise.all([api.tokenStats(taskId), api.tokensByModel(taskId)])
      .then(([stats, models]) => {
        if (!alive) return;
        setTotal(stats.total);
        setByModel(models.models);
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, total, byModel, error, reload };
}
