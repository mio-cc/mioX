"use client";

/**
 * 右栏「资产」页签的取数适配器（对照表 P1:E8 的资产页签部分，单元 C23）。
 * 旧页面依据：ARTEX/web/src/components/layout/right-panel.tsx:23-31（右栏六个页签的任务/资产/证据）、
 * :311-342（`AssetsTab`：无任务空态、加载态、`data.assets.length` 计数、每行「名称 + 类型等摘要」）、
 * :101-127（`api.taskAssets(taskId, "", 20)`：右栏只取前 20 条）、:162-172（行标签与摘要行）。
 * DSH 依据：DSH 无任务资产页，按「右栏 tab 扩展」实现（100-实施计划总表 §4「和某一个任务有关、
 * 属于辅助信息」→ 右栏 tab），页体质感照抄同目录 `Panes.tsx` 的 `FindingsPane`（38px 头行 + 一段滚动区）。
 * 接口：`api.taskAssets`（api.ts:586-589，参数 `(taskId, type="", limit=50, offset=0)`，
 * 返回 `{ assets: Asset[], total }`）。
 *
 * 为什么单独一个模块：C15 的 `v2/data/task-assets.ts` 是会话视图「资产」tab 的分页 + DSL 搜索适配器，
 * 右栏只需要「本任务前 N 条 + 按类型的计数」，请求形状不同（固定 offset 0、不搜索），
 * 所以不往 C15 文件里加第二种 hook，另开本模块，只复用它的类型常量 `TASK_ASSET_TYPES`。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Asset } from "@/lib/types";

/** 右栏一次读取的条数：旧右栏也是 20（right-panel.tsx:113）。 */
export const RIGHT_PANEL_ASSET_LIMIT = 20;

export type RightPanelAssetsPhase = "loading" | "ready" | "offline";

export interface RightPanelAssetsState {
  phase: RightPanelAssetsPhase;
  /** 本任务前 20 条资产（后端按类型归类返回）。 */
  assets: Asset[];
  /** 后端给的本任务资产总数（可能大于 `assets.length`）。 */
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * 读取当前任务的资产前 20 条（`GET /assets?task_id=&limit=20&offset=0`）。
 * @param taskId - 任务 id；null（未选中任务）时不请求，阶段停在 `ready` 且列表为空。
 * @returns 阶段、行、总数、错误与重新读取。
 */
export function useRightPanelAssets(taskId: string | null): RightPanelAssetsState {
  const [phase, setPhase] = useState<RightPanelAssetsPhase>("loading");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // 换任务就是换列表：旧任务的行不能留在新任务下面。
    setAssets([]);
    setTotal(0);
    setError(null);
    if (taskId === null) {
      setPhase("ready");
      return undefined;
    }
    let alive = true;
    setPhase("loading");
    api
      .taskAssets(taskId, "", RIGHT_PANEL_ASSET_LIMIT, 0)
      .then((value) => {
        if (!alive) return;
        setAssets(value.assets);
        setTotal(value.total);
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
  return { phase, assets, total, error, reload };
}

/**
 * 一个资产在右栏行里的显示名（旧页 right-panel.tsx:162-164 的 `assetLabel`）：
 * 依次取 domain / url / app_name / ip / c_segment，都没有时退回 `#id`。
 * @param asset - 后端资产行。
 * @returns 行标题。
 */
export function rightPanelAssetLabel(asset: Asset): string {
  return asset.domain || asset.url || asset.app_name || asset.ip || asset.c_segment || `#${asset.id}`;
}

/**
 * 一个资产在右栏行里的摘要（旧页 right-panel.tsx:166-172 的 `assetMetaLine`，去掉原始英文类型，
 * 类型由调用方用 `assetTypeLabel` 翻成中文）：端口、开放端口数、子域名或应用名。
 * @param asset - 后端资产行。
 * @returns 以「 · 」连接的摘要；没有任何附加字段时为空串。
 */
export function rightPanelAssetMeta(asset: Asset): string {
  const parts: string[] = [];
  if (asset.port !== undefined && asset.port > 0) parts.push(`端口 ${asset.port}`);
  if (asset.open_ports !== undefined && asset.open_ports.length > 0) parts.push(`${asset.open_ports.length} 个开放端口`);
  // `Asset` 没有独立的 subdomain 字段：子域行的域名放在 `domain`（types.ts:239），由行标题承担。
  if (asset.app_name !== undefined && asset.app_name !== "" && asset.app_name !== asset.domain) {
    parts.push(asset.app_name);
  }
  return parts.join(" · ");
}

/**
 * 真实 SPA 导航到主区「资产」整页（改 `?page=` 后通知 Shell 重新读取，
 * 写法照抄 `v2/data/dashboard.ts:747-753` 与 `components/v2/task-views/TaskFindingsView.tsx:66-72`）。
 * 右栏页签点行用它：右栏是辅助信息，明细在主区资产页看。
 */
export function openAssetsPage(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "assets");
  url.searchParams.delete("finding");
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
