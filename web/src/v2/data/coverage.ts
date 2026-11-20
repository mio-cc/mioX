"use client";

/**
 * 覆盖度适配器（会话视图 tab「覆盖度」，对照表 P1:C24、P2:L4、P2:L6）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/coverage-graph-tab.tsx:459-516（图数据与节点抽屉）、
 * _tabs/overview-tab.tsx:704-736（资产测试覆盖度计数与按类型分布）。
 * DSH 依据：DSH 无覆盖图；按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 这里只做取数与纯函数整理：
 *   - `api.taskCoverage(id)`（api.ts:421）→ 覆盖度计数（无资产库时后端可能 503）；
 *   - `api.taskCoverageGraph(id)`（api.ts:431）→ `CoverageGraphData`（types.ts:325）；
 *   - `api.taskAssetRefs(id, assetId)`（api.ts:527）→ `CoverageAssetRefs`（types.ts:339）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { CoverageAssetRef, CoverageAssetRefs, CoverageGraphData, CoverageGraphNode } from "@/lib/types";

export type CoveragePhase = "loading" | "ready" | "offline";

/** `api.taskCoverage` 的返回类型（api.ts:421-429 原样抄录）。 */
export interface TaskCoverageSummary {
  /** 资产覆盖度功能是否开启；false 时其余字段为零值。 */
  enabled: boolean;
  scope_rows: number;
  denominator: number;
  tested: number;
  pct: number | null;
  by_type: { type: string; total: number; tested: number }[];
}

export interface TaskCoverageState {
  phase: CoveragePhase;
  /** 成功时为最近一次成功的结果，加载中与失败时为 null。 */
  data: TaskCoverageSummary | null;
  error: string | null;
  /** 手动重读一次。 */
  reload: () => void;
}

export interface CoverageGraphState {
  phase: CoveragePhase;
  /** 成功时为最近一次成功的图，加载中与失败时为 null。 */
  data: CoverageGraphData | null;
  error: string | null;
  reload: () => void;
}

export interface CoverageAssetRefsState {
  phase: CoveragePhase;
  /** 成功时为最近一次成功的结果，加载中与失败时为 null。 */
  data: CoverageAssetRefs | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读一个任务的资产覆盖度计数。
 * 没有资产库时后端会 503（旧页 overview-tab.tsx:381-390 单列这个请求，失败不影响别的区块），
 * 这里按「失败可重试」处理：进 offline 阶段并给出错误，绝不把它当成空数据。
 * @param taskId - 任务 id；null 时不请求（保持 loading）。
 * @returns 阶段、计数、错误与重新读取。
 */
export function useTaskCoverage(taskId: string | null): TaskCoverageState {
  const [phase, setPhase] = useState<CoveragePhase>("loading");
  const [data, setData] = useState<TaskCoverageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    setData(null);
    api
      .taskCoverage(taskId)
      .then((value) => {
        if (!alive) return;
        setData(value);
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

/**
 * 读一个任务的资产覆盖图。
 * @param taskId - 任务 id；null 时不请求（保持 loading）。
 * @param coverageEnabled - 覆盖度功能是否开启；关闭时照旧页 coverage-graph-tab.tsx:483-485
 *   仍出图，但抹平 tested 状态，不显示已测高亮。
 * @returns 阶段、图数据、错误与重新读取。
 */
export function useTaskCoverageGraph(taskId: string | null, coverageEnabled: boolean): CoverageGraphState {
  const [phase, setPhase] = useState<CoveragePhase>("loading");
  const [data, setData] = useState<CoverageGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    setData(null);
    api
      .taskCoverageGraph(taskId)
      .then((value) => {
        if (!alive) return;
        const nodes: CoverageGraphNode[] = coverageEnabled
          ? (value.nodes ?? [])
          : (value.nodes ?? []).map((node) => ({ ...node, tested: false }));
        setData({ nodes, edges: value.edges ?? [] });
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
  }, [taskId, coverageEnabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, data, error, reload };
}

/**
 * 读某个资产在本任务里关联的意图 / 事实 / 发现（覆盖图节点侧栏用）。
 * @param taskId - 任务 id；null 时不请求（保持 loading）。
 * @param assetId - 资产 id；null 表示没有选中资产，不请求。
 * @returns 阶段、引用列表、错误与重新读取。
 */
export function useCoverageAssetRefs(taskId: string, assetId: number | null): CoverageAssetRefsState {
  const [phase, setPhase] = useState<CoveragePhase>("loading");
  const [data, setData] = useState<CoverageAssetRefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (assetId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    setData(null);
    api
      .taskAssetRefs(taskId, assetId)
      .then((value) => {
        if (!alive) return;
        setData({
          intents: value.intents ?? [],
          facts: value.facts ?? [],
          findings: value.findings ?? [],
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
  }, [taskId, assetId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, data, error, reload };
}

/** 覆盖图节点类型（`types.ts:303` 的真实取值）。 */
export type CoverageKind = CoverageGraphNode["kind"];

/** 节点类型 → 中文（旧页 coverage-graph-tab.tsx:39-47 的 label）。 */
const KIND_LABEL: Record<CoverageKind, string> = {
  company: "公司",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  service: "服务",
  app: "App",
  endpoint: "端点",
};

/** 图例里按固定顺序列出的类型（旧页 coverage-graph-tab.tsx:664 用 Object.keys(kindMeta) 顺序）。 */
export const COVERAGE_KINDS: readonly CoverageKind[] = [
  "company",
  "root_domain",
  "subdomain",
  "ip",
  "service",
  "app",
  "endpoint",
];

/**
 * 节点类型的中文名。
 * @param kind - 后端节点类型。
 * @returns 中文名；未知取值原样返回。
 */
export function coverageKindLabel(kind: string): string {
  return KIND_LABEL[kind as CoverageKind] ?? kind;
}

/**
 * 节点的测试状态文案（旧页 coverage-graph-tab.tsx:350-360）。
 * @param node - 后端节点。
 * @returns 中文状态。
 */
export function coverageTestStateLabel(node: CoverageGraphNode): string {
  if (!node.in_scope) return "范围外（连接节点）";
  return node.tested ? "已测试" : "未测试";
}

/**
 * 覆盖度百分比取整（旧页 overview-tab.tsx:715 的 `Math.round(pct * 100) + "%"`）。
 * @param pct - 后端给出的 0–1 比例；null 表示无数据。
 * @returns 形如 `73%` 的文本；无数据时为 `—`。
 */
export function coveragePercentText(pct: number | null): string {
  if (pct === null) return "—";
  return `${Math.round(pct * 100)}%`;
}

/** 一个节点的引用分组，用于侧栏按意图 / 事实 / 发现分块显示。 */
export interface CoverageRefGroup {
  /** 区块标题。 */
  title: string;
  /** 该组的引用。 */
  items: CoverageAssetRef[];
}

/**
 * 把资产引用拆成三个区块（旧页 coverage-graph-tab.tsx:375-381）。
 * @param refs - 后端返回的引用集合。
 * @returns 固定三个区块；没有内容的区块由组件自行跳过。
 */
export function coverageRefGroups(refs: CoverageAssetRefs): CoverageRefGroup[] {
  return [
    { title: "关联意图", items: refs.intents },
    { title: "关联事实", items: refs.facts },
    { title: "关联发现", items: refs.findings },
  ];
}
