"use client";

/**
 * 任务资产适配器（会话视图 tab「资产」，对照表 P1:C20、P1:C21、P1:C22、P2:D14、P2:D15、P2:D16、P2:D17）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/assets-tab.tsx:342-707（列表：类型页签 +
 * 计数 + 分页 + DSL 搜索、:389-393 两个取数并发、:436-449 移出任务、:680-704 移出二次确认）、
 * :270-340（`api.registerTaskAssetScopes` 登记测试范围）、:1050-1067 之外的 `taskIntentAssets`（意图资产每 5 秒轮询）。
 * DSH 依据：DSH 无任务资产页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：`api.taskAssets`（api.ts:586）、`api.searchTaskAssets`（api.ts:592）、`api.assetCounts`（api.ts:581，
 * 传 task_id 即本任务计数）、`api.attachTaskAssets`（api.ts:596）、`api.detachTaskAsset`（api.ts:603）、
 * `api.registerTaskAssetScopes`（api.ts:601）、`api.taskIntentAssets`（api.ts:604）。
 *
 * 为什么有两个写入口：`POST /tasks/{id}/assets` 同一个接口由后端按请求体形状分流——
 * 带 `scope` 是「登记测试范围」（走 `registerTaskAssetScopes`），带 `asset_ids` + `source_summary`
 * 是「附加已有资产到任务」（走 `attachTaskAssets`）。两个函数各做一对一转发，不合并。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type {
  Asset,
  CompanyScopeRule,
  IntentAsset,
  NewAssetType,
  TaskAssetMutation,
  TaskAssetScopeMutation,
} from "@/lib/types";

/** 每页条数（卡片 C15：50 / 页；旧页默认也是 50，assets-tab.tsx:349）。 */
export const TASK_ASSETS_PAGE_SIZE = 50;

/** 资产类型页签，顺序与旧页一致（assets-tab.tsx:59-66）。 */
export const TASK_ASSET_TYPES: readonly NewAssetType[] = [
  "root_domain",
  "ip",
  "subdomain",
  "app",
  "service",
  "endpoint",
];

/** 后端 `/assets` 单页上限（server/assets.go:314-317，旧页 200 上限同源）。 */
const ASSET_MAX_PAGE_SIZE = 200;

export type TaskAssetsPhase = "loading" | "ready" | "offline";

export interface TaskAssetsPageState {
  phase: TaskAssetsPhase;
  /** 本页的行；后端按类型返回。 */
  assets: Asset[];
  /** 当前类型 + DSL 条件下的总条数。 */
  total: number;
  error: string | null;
  reload: () => void;
}

export interface TaskAssetsPageQuery {
  /** 任务 id；null 时不请求。 */
  taskId: string | null;
  /** 资产类型页签。 */
  type: NewAssetType;
  /** 已按 250ms 防抖收敛的 DSL 文本；"" 表示不搜索。 */
  dsl: string;
  /** 0 基页码。 */
  page: number;
  /** 每页条数，超过后端上限时按上限请求。 */
  size: number;
}

/**
 * 读取一个任务的资产分页（有 DSL 时走搜索接口，两者都强制 task_id 过滤）。
 * @param query - 任务、类型、DSL、页码与每页条数。
 * @returns 阶段、行、总数、错误与重新读取。
 */
export function useTaskAssetsPage({ taskId, type, dsl, page, size }: TaskAssetsPageQuery): TaskAssetsPageState {
  const [phase, setPhase] = useState<TaskAssetsPhase>("loading");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // 旧响应可能晚到，只有最新一次请求能写状态。
  const requestRef = useRef(0);

  useEffect(() => {
    if (taskId === null) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    const limit = Math.min(size, ASSET_MAX_PAGE_SIZE);
    const offset = page * limit;
    setPhase("loading");
    const load =
      dsl.trim() === ""
        ? api.taskAssets(taskId, type, limit, offset)
        : api.searchTaskAssets(taskId, dsl.trim(), type, limit, offset);
    load
      .then((value) => {
        if (requestRef.current !== request) return;
        setAssets(value.assets);
        setTotal(value.total);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (requestRef.current !== request) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setAssets([]);
        setTotal(0);
        setPhase("offline");
      });
    return () => {
      // 组件卸载或参数变化：旧请求的结果一律丢弃。
      if (requestRef.current === request) requestRef.current = request + 1;
    };
  }, [taskId, type, dsl, page, size, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, assets, total, error, reload };
}

/** DSL 搜索里可以用的字段名，顺序照旧页补全表（asset-dsl-search.tsx:14-200）。 */
export const ASSET_DSL_FIELDS: readonly string[] = [
  "domain",
  "ip",
  "url",
  "root_domain",
  "page_title",
  "icp",
  "service_name",
  "app_name",
  "bundle_id",
  "category",
  "app_icp",
  "method",
];

/**
 * 搜索框下方的 DSL 语法提示（纯文案，不参与取数）。
 * @returns 一行说明，例如 `domain ==a.com 且 ip=10.  还可用：…`。
 */
export function assetDslHint(): string {
  return `支持 domain/ip/url 等字段，运算符 = 模糊、== 精确、!= 排除，可用 && 组合。字段：${ASSET_DSL_FIELDS.join("、")}`;
}

export interface TaskAssetCountsState {
  phase: TaskAssetsPhase;
  /** 按资产类型的计数（`GET /assets/counts?task_id=`）。 */
  counts: Record<string, number>;
  /** 各类型之和 = 本任务关联的资产总数（旧页 assets-tab.tsx:464）。 */
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * 读取本任务按资产类型的计数（页签后面的数字与总数）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、计数、合计与重新读取。
 */
export function useTaskAssetCounts(taskId: string | null): TaskAssetCountsState {
  const [phase, setPhase] = useState<TaskAssetsPhase>("loading");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    api
      .assetCounts(taskId)
      .then((value) => {
        if (!alive) return;
        setCounts(value ?? {});
        setError(null);
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
  const total = Object.values(counts).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return { phase, counts, total, error, reload };
}

export interface TaskIntentAssetsState {
  phase: TaskAssetsPhase;
  /** 意图资产（只读展示）。 */
  assets: IntentAsset[];
  error: string | null;
  reload: () => void;
}

/** 意图资产的轮询间隔，与旧页一致（sessions-tab.tsx:1062 的 5000ms）。 */
const INTENT_ASSETS_POLL_MS = 5000;

/**
 * 读取本任务的意图资产（只读）。
 * 轮询失败时保留上一次的结果，只把错误挂出来，下一轮自动重试（旧页同样只吞错误不报）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、意图资产、错误与重新读取。
 */
export function useTaskIntentAssets(taskId: string | null): TaskIntentAssetsState {
  const [phase, setPhase] = useState<TaskAssetsPhase>("loading");
  const [assets, setAssets] = useState<IntentAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    const load = (): void => {
      api
        .taskIntentAssets(taskId)
        .then((value) => {
          if (!alive) return;
          setAssets(value);
          setError(null);
          setPhase("ready");
        })
        .catch((reason: unknown) => {
          if (!alive) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          // 已经有数据时保留旧值，避免轮询抖动把列表清空。
          setPhase((current) => (current === "ready" ? current : "offline"));
        });
    };
    load();
    const timer = window.setInterval(load, INTENT_ASSETS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, assets, error, reload };
}

/**
 * 把一个任务的已有资产附加到任务（`POST /tasks/{id}/assets`，带 asset_ids + source_summary）。
 * 只做一对一转发：不重试、不吞错误、不做乐观更新。
 * @param taskId - 任务 id。
 * @param assetIds - 要附加的资产 id 列表（≥1）。
 * @param sourceSummary - 附加说明，必填（写进资产的 `task_source_summary`）。
 * @returns 后端的 requested / attached / existing 计数。
 */
export function attachTaskAssets(
  taskId: string,
  assetIds: number[],
  sourceSummary: string,
): Promise<TaskAssetMutation> {
  return api.attachTaskAssets(taskId, assetIds, sourceSummary);
}

/**
 * 把一个资产从任务分离（`DELETE /tasks/{id}/assets/{assetId}`）。
 * @param taskId - 任务 id。
 * @param assetId - 要分离的资产 id。
 * @returns 后端的 detached 计数。
 */
export function detachTaskAsset(taskId: string, assetId: number): Promise<{ detached: number }> {
  return api.detachTaskAsset(taskId, assetId);
}

/**
 * 登记任务的测试范围（`POST /tasks/{id}/assets`，带 scope 规则）。
 * 域名 / IP 会创建或复用全局资产，CIDR、ICP、关键词只作为 Agent 范围上下文（旧页 assets-tab.tsx:312）。
 * @param taskId - 任务 id。
 * @param scope - 结构化范围规则（`CompanyScopeRule[]`，元素形如 `{ kind, value }`）。
 * @returns 后端的 requested / assets_linked / assets_existing / scopes_added / scopes_existing 计数。
 */
export function registerTaskAssetScopes(
  taskId: string,
  scope: CompanyScopeRule[],
): Promise<TaskAssetScopeMutation> {
  return api.registerTaskAssetScopes(taskId, scope);
}
