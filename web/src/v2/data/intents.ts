"use client";

/**
 * 意图（探索图 intent 节点）适配器（对照表 P1:C8–C12）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/overview-tab.tsx:316-348,354-363（列表与重跑）、
 * sessions-tab.tsx:586-632（暂停/恢复/取消）、sessions-tab.tsx:1534（给 worker 发消息）。
 * 接口：api.ts:781 intents、:413 rerunIntent、:416 rerunBlocked、:391 controlIntent、:404 sendWorkerMessage。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { TaskNode } from "@/lib/types";

export type IntentsPhase = "loading" | "ready" | "offline";

export interface IntentsState {
  phase: IntentsPhase;
  /** 后端按创建顺序返回的意图节点。 */
  intents: TaskNode[];
  error: string | null;
  /** 重新读取。 */
  reload: () => void;
}

/**
 * 读取一个任务的意图列表。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、意图、错误与重新读取。
 */
export function useIntents(taskId: string | null): IntentsState {
  const [phase, setPhase] = useState<IntentsPhase>("loading");
  const [intents, setIntents] = useState<TaskNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .intents(taskId)
      .then((rows) => {
        if (!alive) return;
        setIntents(rows);
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
  return { phase, intents, error, reload };
}

/** 可重跑的状态（旧页 overview-tab.tsx:324-335 只对未跑完的意图置回 open）。 */
const RERUNNABLE = new Set(["blocked", "exhausted", "stopped"]);

/**
 * 这条意图是否可以重跑。
 * @param state - 后端意图状态。
 * @returns 可重跑为 true。
 */
export function isRerunnable(state: string): boolean {
  return RERUNNABLE.has(state);
}

/**
 * 重跑一条意图：置回 open，worker 会重新认领、从头再跑。
 * @param taskId - 任务 id。
 * @param intentId - 意图节点 id。
 * @returns 后端返回的重开结果。
 */
export function rerunIntent(taskId: string, intentId: string): Promise<{ id: string; reopened: number }> {
  return api.rerunIntent(taskId, intentId);
}

/**
 * 批量重跑本任务全部 blocked 意图。
 * @param taskId - 任务 id。
 * @returns 后端返回的重开结果。
 */
export function rerunBlocked(taskId: string): Promise<{ id: string; reopened: number }> {
  return api.rerunBlocked(taskId);
}

/**
 * 暂停 / 恢复 / 取消一条意图。
 * @param taskId - 任务 id。
 * @param intentId - 意图节点 id。
 * @param action - pause / resume / cancel。
 * @param reason - 取消原因（cancel 时后端要求非空）。
 * @param mode - 取消方式：soft（默认，置 deleted 并记录原因）/ hard（真删除，级联独占子孙）。
 * @returns 后端返回的新状态，hard 取消时带删除计数。
 */
export function controlIntent(
  taskId: string,
  intentId: string,
  action: "pause" | "resume" | "cancel",
  reason?: string,
  mode?: "soft" | "hard",
): Promise<{
  id: number;
  state: "paused" | "open" | "deleted" | "";
  deleted?: { intents: number; facts: number; findings: number; activities: number };
}> {
  return api.controlIntent(taskId, intentId, action, reason, mode);
}

/**
 * 给一条 worker 意图发一条消息。
 * @param taskId - 任务 id。
 * @param intentId - 意图节点 id。
 * @param message - 消息正文。
 * @param requestId - 去重用的客户端请求 id；省略时现场生成一个。
 * @returns 后端返回的受理结果。
 */
export function sendWorkerMessage(
  taskId: string,
  intentId: string,
  message: string,
  requestId?: string,
): Promise<{ id: number; state: "running"; accepted: true; request_id: string }> {
  return api.sendWorkerMessage(taskId, intentId, message, requestId ?? crypto.randomUUID());
}
