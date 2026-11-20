"use client";

/**
 * 任务前沿（frontier）与审计（audit）适配器（会话视图 tab「概览」内追加的两个区块，对照表 P2:L3、P2:L5）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/overview-tab.tsx:415-417（open / running / blocked
 * 计数）、:966-982（「需要关注」里的 `frontier 待领`）、:1045（「待领意图 · frontier 开放」）、
 * :1018-1033（意图行：状态徽章 + payload 文本）。
 * 审计（audit）在旧页面的详情 tab 里找不到渲染处（grep 旧页无 `api.audit`），字段口径取后端
 * `ARTEX/guard/guard.go:22-28,199-215` 与
 * `ARTEX/server/server.go:4143-4150`（entries 按时间升序、最多保留 2000 条、TS 是 unix 秒）。
 * DSH 依据：DSH 无任务前沿/审计页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：`api.frontier`（api.ts:635，GET `/exploration/frontier?task=&limit=`）、`api.audit`（api.ts:879，
 * GET `/audit?task=`）；类型 `TaskNode`（types.ts:426）、`AuditEntry`（types.ts:935）、`Audit`（types.ts:943）。
 *
 * 统计数字不在这里另开请求：概览 tab 已经由 `useOverviewSummary`（v2/data/task-overview.ts:45）取过
 * `api.stats`（api.ts:419），本单元把那份结果传给 `overviewStatsItems` 复用，避免同一份数据请求两次。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { AuditEntry, Stats, TaskNode } from "@/lib/types";
import { intentStateLabel, intentTitle, sessionTime } from "@/v2/data/sessions";

/** 前沿列表的请求条数上限（后端默认值就是 100，见 server/server.go:2036）。 */
export const FRONTIER_LIMIT = 100;

/** 审计记录最多显示多少条（旧页从未渲染过 audit，按「近期记录」只取末尾这些条）。 */
export const AUDIT_RECENT_LIMIT = 20;

/** 前端可见的意图状态（types.ts:421 IntentState）。 */
const INTENT_STATES: readonly string[] = [
  "open",
  "running",
  "paused",
  "done",
  "blocked",
  "exhausted",
  "stopped",
];

export type FrontierPhase = "loading" | "ready" | "offline";

/** 前沿列表状态。 */
export interface FrontierState {
  phase: FrontierPhase;
  /** 当前可领取的意图（后端 `Store.Frontier` 的结果，按优先级/创建顺序）。 */
  nodes: TaskNode[];
  error: string | null;
  /** 重新读取。 */
  reload: () => void;
}

/**
 * 读取一个任务当前可做的意图（前沿）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、前沿节点、错误与重新读取。
 */
export function useTaskFrontier(taskId: string | null): FrontierState {
  const [phase, setPhase] = useState<FrontierPhase>("loading");
  const [nodes, setNodes] = useState<TaskNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .frontier(taskId)
      .then((value) => {
        if (!alive) return;
        setNodes(value);
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
  return { phase, nodes, error, reload };
}

export type AuditPhase = "loading" | "ready" | "offline";

/** 审计记录状态。 */
export interface AuditState {
  phase: AuditPhase;
  /** 最近一次工具调用审计（已按时间倒序、截到 AUDIT_RECENT_LIMIT 条）。 */
  entries: AuditEntry[];
  /** 失败归因计数（`Audit.attributions`，后端 guard.go:184-192）。 */
  attributions: { key: string; count: number }[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个任务的工具调用审计（`GET /audit?task=`）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、审计记录、失败归因、错误与重新读取。
 */
export function useTaskAudit(taskId: string | null): AuditState {
  const [phase, setPhase] = useState<AuditPhase>("loading");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [attributions, setAttributions] = useState<{ key: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .audit(taskId)
      .then((value) => {
        if (!alive) return;
        const all = value.entries ?? [];
        // 后端按记录顺序（升序）返回，Recent 取末尾 N 条再倒序，最近的排在最前。
        const recent = all.slice(Math.max(0, all.length - AUDIT_RECENT_LIMIT)).reverse();
        const counts = value.attributions ?? {};
        setEntries(recent);
        setAttributions(
          Object.keys(counts)
            .map((key) => ({ key, count: counts[key] ?? 0 }))
            .sort((a, b) => b.count - a.count),
        );
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
  return { phase, entries, attributions, error, reload };
}

/** 前沿一行的显示字段。 */
export interface FrontierRow {
  id: string;
  /** 意图标题（payload.summary 优先，见 sessions.ts:108-118）。 */
  title: string;
  /** 原始 payload，用于 title 属性与展开。 */
  payload: string;
  /** 状态中文名（sessions.ts:121-140）。 */
  stateLabel: string;
  /** 后端原始状态值（Tag 配色用）。 */
  state: string;
  /** 后端原始 state 字段；不是已知意图状态值时为 `raw:<值>`。 */
  stateKey: string;
  /** 优先级 0..10（types.ts:430）。 */
  priority: number;
  /** 创建时间文本。 */
  created: string;
}

/**
 * 把前沿节点转成显示行。
 * @param nodes - `api.frontier` 的返回。
 * @returns 显示行；`type` 不是 intent 的节点按原状态值显示。
 */
export function frontierRows(nodes: readonly TaskNode[]): FrontierRow[] {
  return nodes.map((node) => {
    const known = INTENT_STATES.includes(node.state);
    return {
      id: node.id,
      title: intentTitle(node.payload, node.id),
      payload: node.payload ?? "",
      stateLabel: known ? intentStateLabel(node.state) : node.state === "" ? "未知" : node.state,
      state: node.state,
      stateKey: known ? node.state : `raw:${node.state}`,
      priority: node.priority ?? 0,
      created: sessionTime(node.ts),
    };
  });
}

/**
 * 意图状态对应的 Tag 色调（与 IntentsView.tsx:46-53 保持一致）。
 * @param stateKey - `frontierRows` 的 stateKey。
 * @returns Tag 的 tone。
 */
export function frontierStateTone(stateKey: string): "neutral" | "info" | "success" | "warning" | "danger" | "outline" {
  if (stateKey === "done") return "success";
  if (stateKey === "running") return "info";
  if (stateKey === "blocked") return "danger";
  if (stateKey === "paused" || stateKey === "stopped" || stateKey === "exhausted") return "warning";
  if (stateKey === "open") return "neutral";
  return "outline";
}

/** 统计数字的一格。 */
export interface OverviewStatItem {
  key: string;
  label: string;
  value: number;
}

/**
 * 把 `api.stats` 的计数扩成概览 tab 的统计格。
 * 字段名照 `Stats`（types.ts:1320-1327）：assets / findings_confirmed / engine_mode / llm_configured / roe_enabled。
 * @param stats - 概览 tab 已取到的统计；null 时无统计。
 * @param goals - 目标进度（来自任务本身，不用再请求）。
 * @returns 计数格；`engine_mode` 等状态字段不是数字，由组件按 Tag 单独显示。
 */
export function overviewStatsItems(stats: Stats | null, goals: { met: number; total: number }): OverviewStatItem[] {
  return [
    { key: "assets", label: "资产", value: stats === null ? 0 : stats.assets },
    { key: "findings_confirmed", label: "确认发现", value: stats === null ? 0 : stats.findings_confirmed },
    { key: "goals_met", label: "已达成目标", value: goals.met },
    { key: "goals_total", label: "目标总数", value: goals.total },
  ];
}

/**
 * 审计动作的中文名（后端 `action` 只有 allow / block，guard.go:25）。
 * @param action - 后端动作值。
 * @returns 中文名；未知值原样返回。
 */
export function auditActionLabel(action: string): string {
  if (action === "allow") return "放行";
  if (action === "block") return "拦截";
  return action === "" ? "未知" : action;
}

/**
 * 审计记录的时间文本（后端 `ts` 是 unix 秒，guard.go:23,202）。
 * @param ts - 后端 ts 字段（字符串形式的 unix 秒）。
 * @returns 本地时间文本；无法解析时为「—」。
 */
export function auditTimeText(ts: string | undefined): string {
  const raw = (ts ?? "").trim();
  if (raw === "") return "—";
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return raw;
  return new Date(seconds * 1000).toLocaleString("zh-CN");
}

// ---------------------------------------------------------------------------
// 活动流（P2:A11，「统计与审计」区块里的只读最近活动）
// ---------------------------------------------------------------------------

/** 活动流显示几条（旧页 dashboard/page.tsx:291 的 `recentActivity = activity.slice(0, 6)`）。 */
export const OVERVIEW_ACTIVITY_RECENT = 6;

/** 活动种类中文名（后端 `ActivityKind` 的五个取值，见 lib/api.ts 与旧页 dashboard/page.tsx 的 kindLabel）。 */
const ACTIVITY_KIND_LABEL: Record<string, string> = {
  tool_use: "工具调用",
  tool_result: "工具结果",
  text: "文本",
  thinking: "思考",
  result: "回合结果",
};

/**
 * 活动种类中文名（旧页 dashboard/page.tsx:896 的 `kindLabel(a)`）。
 * @param row - 一条活动（只读 `kind`）。
 * @returns 中文名；未知种类原样返回。
 */
export function activityKindLabel(row: { kind: string }): string {
  const label = ACTIVITY_KIND_LABEL[row.kind];
  return label === undefined ? row.kind : label;
}
