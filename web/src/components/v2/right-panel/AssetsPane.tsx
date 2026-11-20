"use client";

/**
 * 右栏「资产」页签（单元 C23，对照表 P1:E8 的资产部分）。
 * 旧页面依据：ARTEX/web/src/components/layout/right-panel.tsx:23-31（右栏六个页签含「资产」）、
 * :311-342（`AssetsTab`：没有打开任务时的空态、加载态、「资产 N 项」头行计数、每行名称 + 摘要）、
 * :101-127（`api.taskAssets(taskId, "", 20)`）、:162-172（行标签与摘要）。
 * DSH 依据：DSH 无任务资产视图，按「右栏 tab 扩展」实现（100-实施计划总表 §4 决策表：和某一个任务
 * 有关、属于辅助信息 → 右栏 tab）。页体沿用同目录 `Panes.tsx` 的 `FindingsPane` 写法：
 * 38px 头行 + 一段滚动区 + 四种状态，chrome 走 `pane-chrome.tsx` 与 `Panes.module.css`。
 * 数据：`v2/data/right-panel-assets.ts` 的 `useRightPanelAssets`（`api.taskAssets`，api.ts:586）。
 * 点行：真实 SPA 导航到主区资产整页 `?page=assets`（`openAssetsPage`），不画任何假入口。
 */
import * as React from "react";

import type { Asset, Task } from "@/lib/types";
import { assetTypeLabel } from "@/v2/data/assets-page";
import {
  RIGHT_PANEL_ASSET_LIMIT,
  openAssetsPage,
  rightPanelAssetLabel,
  rightPanelAssetMeta,
  useRightPanelAssets,
} from "@/v2/data/right-panel-assets";
import {
  IconDatabaseOutlineRegular,
  IconNewChatOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Tag } from "@/vendor/dsh/primitives/Tag";

import { EmptyState, LoadingRows, PaneHeader, ToolButton } from "./pane-chrome";
import css from "./Panes.module.css";

/**
 * 一行的类型标签色调：类型是分类事实，不是状态，所以统一 `outline`，
 * 与 `FindingsPane` 里只有严重度才上色的口径一致。
 */
const TYPE_TONE = "outline" as const;

export interface AssetsPaneProps {
  /** 当前选中任务；null/undefined 时显示「先选择一个任务」。 */
  readonly task?: Task | null;
}

/**
 * 右栏资产页签：当前任务前 20 条资产，按类型标签 + 名称展示。
 * @param props.task - 当前选中的任务。
 * @returns the page.
 */
export function AssetsPane({ task = null }: AssetsPaneProps): React.ReactNode {
  const taskId = task === null || task === undefined ? null : String(task.id);
  const state = useRightPanelAssets(taskId);
  const assets: readonly Asset[] = state.assets;
  const truncated = state.total > assets.length;

  return (
    <div className={css.page}>
      <PaneHeader
        actions={(
          <ToolButton label="刷新任务资产" onClick={state.reload}>
            <IconRefreshOutlineRegular size={15} />
          </ToolButton>
        )}
      >
        <span className={css.count}>
          {taskId === null
            ? "资产"
            : state.phase === "ready"
              ? `资产 ${state.total} 项`
              : "资产"}
        </span>
        {state.phase === "ready" && truncated ? (
          <span className={css.count}>只列前 {RIGHT_PANEL_ASSET_LIMIT} 项</span>
        ) : null}
      </PaneHeader>

      {taskId === null ? (
        <EmptyState
          icon={<IconNewChatOutlineRegular size={26} />}
          title="先选择一个任务"
          hint="在左侧会话列表选中任务后，这里列出它关联的资产"
        />
      ) : null}

      {taskId !== null && state.phase === "loading" ? <LoadingRows count={5} /> : null}

      {taskId !== null && state.phase === "offline" ? (
        <EmptyState
          icon={<IconWarningOutlineRegular size={26} />}
          title="未连接后端（任务资产不可用）"
          hint={state.error === null ? "GET /assets?task_id= 读取失败，后端恢复后点刷新重试" : `读取失败：${state.error}`}
        />
      ) : null}

      {taskId !== null && state.phase === "ready" && assets.length === 0 ? (
        <EmptyState
          icon={<IconDatabaseOutlineRegular size={26} />}
          title="该任务还没有关联资产"
          hint="Agent 探测到资产，或从资产页把资产附加到任务后，会出现在这里"
        />
      ) : null}

      {taskId !== null && state.phase === "ready" && assets.length > 0 ? (
        <div className={css.scroll}>
          <ul className={css.list}>
            {assets.map((asset) => {
              const meta = rightPanelAssetMeta(asset);
              return (
                <li key={asset.id} className={css.listItem}>
                  <button
                    type="button"
                    className={css.row}
                    data-rp-asset={asset.id}
                    title={`在资产页查看 ${rightPanelAssetLabel(asset)}`}
                    onClick={openAssetsPage}
                  >
                    <span className={css.rowTop}>
                      <Tag tone={TYPE_TONE}>{assetTypeLabel(asset.type)}</Tag>
                      <span className={css.rowTitle}>{rightPanelAssetLabel(asset)}</span>
                    </span>
                    <span className={css.rowMeta}>
                      #{asset.id}
                      {meta === "" ? "" : ` · ${meta}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
