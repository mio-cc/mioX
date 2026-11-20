"use client";

/**
 * 探索图适配器（会话视图 tab「探索图」，对照表 P1:C16、P2:L1）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/graph-tab.tsx（探索图页签，@antv/g6 渲染）
 * DSH 依据：DSH 无探索图；按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 这里只做取数与纯函数整理：读 GET /exploration/graph（api.ts:795）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Edge, ExploreKind, TaskNode } from "@/lib/types";

import { intentStateLabel } from "./sessions";

export type ExplorationGraphPhase = "loading" | "ready" | "offline";

export interface ExplorationGraphData {
  /** 后端返回的节点，顺序原样保留。 */
  nodes: TaskNode[];
  /** 后端返回的边，顺序原样保留。 */
  edges: Edge[];
}

export interface ExplorationGraphState {
  phase: ExplorationGraphPhase;
  /** 成功时为 `{ nodes, edges }`，加载中与失败时为 null。 */
  data: ExplorationGraphData | null;
  error: string | null;
  /** 重新读取。 */
  reload: () => void;
}

/**
 * 读取一个任务的探索图。
 * @param taskId - 任务 id；null 时不请求（保持 loading）。
 * @returns 阶段、图数据、错误与重新读取。
 */
export function useExplorationGraph(taskId: string | null): ExplorationGraphState {
  const [phase, setPhase] = useState<ExplorationGraphPhase>("loading");
  const [data, setData] = useState<ExplorationGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .explorationGraph(taskId)
      .then((value) => {
        if (!alive) return;
        setData({ nodes: value.nodes, edges: value.edges });
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
  return { phase, data, error, reload };
}

/** 节点类型中文（`types.ts:419` 的 ExploreKind）。 */
const KIND_LABEL: Record<string, string> = {
  task: "任务",
  begin: "起点",
  goal: "目标",
  intent: "意图",
  fact: "事实",
  finding: "漏洞",
  hint: "提示",
  digest: "摘要",
};

/**
 * 节点类型中文。
 * @param kind - 后端节点类型；未知值原样返回。
 * @returns 中文类型名。
 */
export function exploreKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/**
 * 节点标题：优先 payload 里的 summary / text / goal，否则 `类型 #id`。
 * 取 payload.summary 的写法与 `v2/data/sessions.ts:108` 的 intentTitle 一致。
 * @param node - 后端节点。
 * @returns 一行文本（最长 40 字）。
 */
export function explorationNodeTitle(node: TaskNode): string {
  const kind = exploreKindLabel(node.type);
  const payload = node.payload ?? "";
  if (payload !== "") {
    try {
      const parsed = JSON.parse(payload) as { summary?: unknown; text?: unknown; goal?: unknown };
      const text =
        typeof parsed.summary === "string"
          ? parsed.summary
          : typeof parsed.text === "string"
            ? parsed.text
            : typeof parsed.goal === "string"
              ? parsed.goal
              : "";
      if (text.trim() !== "") return `${kind}：${text.trim().slice(0, 40)}`;
    } catch {
      const trimmed = payload.trim();
      if (trimmed !== "") return `${kind}：${trimmed.slice(0, 40)}`;
    }
  }
  return `${kind} #${node.id}`;
}

/** 探索图的过滤档位（本地过滤已取回的图，不发请求）。 */
export type ExplorationFilter = "all" | "intent" | "finding";

/**
 * 按档位保留节点：只看意图只留 `intent`，只看漏洞只留 `finding`。
 * @param nodes - 后端节点。
 * @param filter - 过滤档位。
 * @returns 保留的节点。
 */
export function filterExplorationNodes(nodes: readonly TaskNode[], filter: ExplorationFilter): TaskNode[] {
  if (filter === "all") return [...nodes];
  const kind: ExploreKind = filter;
  return nodes.filter((node) => node.type === kind);
}

/**
 * 按节点集合裁剪边：两端都在保留集合里的边才留下。
 * @param edges - 后端边。
 * @param kept - 保留的节点。
 * @returns 保留的边。
 */
export function filterExplorationEdges(edges: readonly Edge[], kept: readonly TaskNode[]): Edge[] {
  const ids = new Set(kept.map((node) => node.id));
  return edges.filter((edge) => ids.has(edge.src) && ids.has(edge.dst));
}

/**
 * 节点状态对应的 Tag 色调（状态取值见 `types.ts:420-423` 的 Goal/Intent/Finding/Hint State）。
 * @param state - 后端状态；未知值用 outline。
 * @returns Tag 的 tone。
 */
export function exploreStateTone(state: string): "neutral" | "info" | "success" | "warning" | "danger" | "outline" {
  if (state === "" || state === "abandoned" || state === "dismissed" || state === "consumed") return "neutral";
  if (state === "met" || state === "done") return "success";
  if (state === "running" || state === "active") return "info";
  if (state === "paused" || state === "exhausted") return "warning";
  if (state === "blocked" || state === "confirmed") return "danger";
  if (state === "open" || state === "stopped") return "neutral";
  return "outline";
}

/**
 * 状态显示文案（沿用会话车道的中文状态文案）。
 * @param state - 后端状态。
 * @returns 中文状态；空串返回「未知」。
 */
export function exploreStateLabel(state: string): string {
  if (state === "") return "未知";
  if (state === "met") return "已达成";
  if (state === "abandoned") return "已放弃";
  if (state === "confirmed") return "已确认";
  if (state === "dismissed") return "已忽略";
  if (state === "active") return "有效";
  if (state === "consumed") return "已用";
  return intentStateLabel(state);
}
