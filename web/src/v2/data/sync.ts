"use client";

/**
 * 资产同步整页（主区整页 `sync`）的适配器：ScopeSentry 数据源状态、项目 / 任务两个维度的
 * 分页列表、数据源地址与密钥的保存，以及「同步选中」的执行。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/sync/page.tsx:59-73（状态读取）、
 * :109-135（创建占位数据源 / 保存并启用）、:237-249（项目或任务列表：page / size / search，
 * 翻页时清空选择）、:268-288（同步：dimension / targets / asset_types / create_company，
 * 成功后取结果摘要）、:454-485（结果摘要的字段口径）。
 * DSH 依据：DSH 无资产同步页，按「主区整页」扩展（总表 §4.1、§4）。
 * 对照表行：P2:H1 P2:H2 P2:H3 P2:H4
 *
 * 接口（已按 `lib/api.ts` 核对）：
 * - `api.ssStatus()` → `{ exists; configured; enabled; reachable; url?; tools }`（api.ts:1234-1237）；
 * - `api.ssDatasource({ url?, api_key? })` → `{ id; enabled }`（api.ts:1238-1239，空 body = 建占位，
 *   有 url / api_key = 保存并启用）；
 * - `api.ssProjects(page = 1, size = 50, search = "")` → `{ projects: SSProject[]; tag: Record<string, number> }`
 *   （api.ts:1240-1243）；`api.ssTasks(page = 1, size = 50, search = "")` → `SSTask[]`（api.ts:1244-1247）；
 * - `api.ssSync({ dimension, targets, asset_types, create_company?, page_size? })` →
 *   `{ synced: Record<string, number>; companies: string[] | null; warnings: string[] | null;
 *   errors: string[] | null }`（api.ts:1248-1260）。
 * 类型：`SSProject` types.ts:1441、`SSTask` types.ts:1449。
 *
 * 后端口径（只读核对，未改）：`ARTEX/server/sync_scopesentry.go:74-113` 的 status 在「已配置且已启用」
 * 时才做一次 12 秒的可达性探测；`:298` 的 synced 固定是 subdomain / app / service / ip 四个计数；
 * `:329-334` 只认 subdomain / service / app 三种入参，未知类型记进 warnings；`:351-355` 有企业时重建归属。
 * 后端**没有**「预览」接口，也没有新增 / 更新 / 跳过三类计数，所以本适配器不提供预览数字，
 * 结果只显示后端真有的字段（见 overlay note 与 100c）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { SSProject, SSTask } from "@/lib/types";

/** 每页条数：卡片与旧页 page.tsx:242-246 都用 50（api.ts:1240 的默认值也是 50）。 */
export const SS_PAGE_SIZE = 50;

/** 搜索框防抖（总表 §6：250ms）。 */
export const SS_SEARCH_DEBOUNCE_MS = 250;

/** 同步维度：项目按 ObjectID 选，任务按任务名选（旧页 page.tsx:252 的 idOf）。 */
export type SsDimension = "project" | "task";

/** 后端只认这三种资产类型（sync_scopesentry.go:330 的映射表）。 */
export type SsAssetType = "subdomain" | "service" | "app";

export const SS_ASSET_TYPES: readonly { key: SsAssetType; label: string }[] = [
  { key: "subdomain", label: "子域名" },
  { key: "service", label: "服务" },
  { key: "app", label: "App" },
];

/** 同步结果里各计数的中文名（后端固定返回 subdomain / app / service / ip，见 sync_scopesentry.go:298）。 */
export const SS_SYNCED_LABEL: Readonly<Record<string, string>> = {
  subdomain: "子域名",
  service: "服务",
  app: "App",
  ip: "IP",
};

export type SsPhase = "loading" | "ready" | "offline";

/** `api.ssStatus()` 的返回形状（api.ts:1234-1237）；types.ts 里没有为它单独定义一个类型。 */
export interface SsStatus {
  exists: boolean;
  configured: boolean;
  enabled: boolean;
  reachable: boolean;
  url?: string;
  tools: string[];
}

export interface SsStatusState {
  phase: SsPhase;
  /** 最近一次成功的状态快照；首次成功前为 null。 */
  status: SsStatus | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取 ScopeSentry 数据源状态（旧页 page.tsx:59-73）。
 * 前端不做任何推断：exists / configured / enabled / reachable 全部按后端返回值显示。
 * @returns 阶段、状态快照、错误与重新读取。
 */
export function useSsStatus(): SsStatusState {
  const [phase, setPhase] = useState<SsPhase>("loading");
  const [status, setStatus] = useState<SsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .ssStatus()
      .then((value) => {
        if (!alive) return;
        setStatus({ ...value, tools: value.tools ?? [] });
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
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, status, error, reload };
}

export interface SsListState {
  phase: SsPhase;
  /** 当前页项目（维度为 project 时）。 */
  projects: SSProject[];
  /** 项目标签的计数表（api.ts:1241 的 tag，后端原样返回的 `Record<string, number>`）。 */
  tags: Record<string, number>;
  /** 当前页任务（维度为 task 时）。 */
  tasks: SSTask[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一页项目或任务（旧页 page.tsx:237-249：维度切换即重新请求，page 从 1 起）。
 * @param params.dimension - 项目维度 / 任务维度。
 * @param params.page - 1 起的页码，照 api.ts:1240 / :1244 的 page 参数。
 * @param params.search - 后端搜索词；空串表示不传。
 * @param params.enabled - 是否真的请求；数据源未就绪时传 false，不打扰后端（旧页 :77-85）。
 * @returns 阶段、当前维度的行、标签计数、错误与重新读取。
 */
export function useSsList({
  dimension,
  page,
  search,
  enabled = true,
}: {
  dimension: SsDimension;
  page: number;
  search: string;
  enabled?: boolean;
}): SsListState {
  const [phase, setPhase] = useState<SsPhase>("loading");
  const [projects, setProjects] = useState<SSProject[]>([]);
  const [tags, setTags] = useState<Record<string, number>>({});
  const [tasks, setTasks] = useState<SSTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setProjects([]);
      setTasks([]);
      setTags({});
      setError(null);
      setPhase("loading");
      return;
    }
    let alive = true;
    setPhase("loading");
    const request =
      dimension === "project"
        ? api
            .ssProjects(page, SS_PAGE_SIZE, search)
            .then((res) => {
              if (!alive) return;
              setProjects(res.projects ?? []);
              setTags(res.tag ?? {});
              setTasks([]);
            })
        : api.ssTasks(page, SS_PAGE_SIZE, search).then((res) => {
            if (!alive) return;
            setTasks(res ?? []);
            setProjects([]);
            setTags({});
          });
    request
      .then(() => {
        if (!alive) return;
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
  }, [dimension, page, search, enabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, projects, tags, tasks, error, reload };
}

/** 一行的选择键：项目用 id（ObjectID），任务用 name（旧页 page.tsx:252 的 idOf）。 */
export function ssTargetKey(dimension: SsDimension, row: SSProject | SSTask): string {
  return dimension === "project" ? (row as SSProject).id : (row as SSTask).name;
}

/**
 * 保存数据源地址与密钥并启用（旧页 page.tsx:122-135）。
 * 一对一转发，不做重试、不吞错误；界面上的忙碌与失败文案由组件自己管。
 * @param url - MCP 地址；空串表示不改地址只改密钥。
 * @param apiKey - API Key；空串表示保留原值（后端 `sync_scopesentry.go:142-145`）。
 * @returns 后端返回的 id 与最终启用态。
 */
export function saveSsDatasource(url: string, apiKey: string): Promise<{ id: number; enabled: boolean }> {
  const body: { url?: string; api_key?: string } = {};
  if (url !== "") body.url = url;
  if (apiKey !== "") body.api_key = apiKey;
  return api.ssDatasource(body);
}

export type SsSyncResult = Awaited<ReturnType<typeof api.ssSync>>;

/**
 * 执行一次同步（旧页 page.tsx:268-288）。
 * 骨干是后端真实写入：调用方必须先用 `tone="warning"` 的 Modal 二次确认（总表 §5.5）。
 * @param params.dimension - 项目维度 / 任务维度。
 * @param params.targets - 选中的项目 ObjectID 或任务名（不能为空）。
 * @param params.assetTypes - 要拉取的资产类型（不能为空）。
 * @param params.createCompany - 是否按项目建立企业并写入资产范围（仅项目维度有意义）。
 * @returns 后端的同步结果：synced 计数、企业名、warnings、errors。
 */
export function runSsSync({
  dimension,
  targets,
  assetTypes,
  createCompany,
}: {
  dimension: SsDimension;
  targets: readonly string[];
  assetTypes: readonly SsAssetType[];
  createCompany: boolean;
}): Promise<SsSyncResult> {
  return api.ssSync({
    dimension,
    targets: [...targets],
    asset_types: [...assetTypes],
    create_company: dimension === "project" ? createCompany : false,
  });
}

/**
 * 结果的合计入库条数：把后端 `synced` 的各计数相加（旧页 page.tsx:281-282 的口径）。
 * @param result - 同步结果；null 时返回 0。
 * @returns 后端报告的所有计数之和。
 */
export function ssSyncedTotal(result: SsSyncResult | null): number {
  if (result === null) return 0;
  return Object.values(result.synced ?? {}).reduce((sum, value) => sum + value, 0);
}
