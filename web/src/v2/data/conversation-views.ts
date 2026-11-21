"use client";

/**
 * 会话视图 tab 的扩展注册表（「对话」之后的 tab）。
 * DSH 依据：ui-conversation/src/client/apply.ts:216,403（conversation.view 列表槽）、view-pins.ts:5。
 *
 * D6 / U2（.tmp/d6-ia-inventory.md §4.2）：12 个 tab 收敛为 5 个主视图 + 更多。
 * 同源数据只给一个视图，不同呈现做成视图内子切换（`?view=<容器>.<子>`）：
 *   概览 ▸ 状态 | 配置（吸收原「模型」）
 *   探索 ▸ 意图 | 图 | 时间线（原「意图 / 探索图 / 播报」）
 *   发现 ▸ 列表 | 报告（原「发现 / 报告」）
 *   资产 ▸ 任务资产 | 覆盖度（原「资产 / 覆盖度」）
 *   更多 ▸ 轨迹、团队（团队仅团队模式）
 * 旧 id 全部经 {@link resolveViewAlias} 落到新位置，旧深链不坏。
 */
import type { ReactNode } from "react";

import { AssetsHubView } from "@/components/v2/task-views/AssetsHubView";
import { ExploreView } from "@/components/v2/task-views/ExploreView";
import { FindingsHubView } from "@/components/v2/task-views/FindingsHubView";
import { OverviewView } from "@/components/v2/task-views/OverviewView";
import { TeamBoardView } from "@/components/v2/task-views/TeamBoardView";
import type { Task } from "@/lib/types";

/** 一个任务视图 tab。 */
export interface TaskViewEntry {
  /** 视图 id（容器 id），同时是 tab 的 key；不能是 "chat" 或 "trajectory"。 */
  readonly id: string;
  /** tab 上显示的中文。 */
  readonly label: string;
  /** 排序：数字越小越靠左；对话固定在最左。 */
  readonly order: number;
  /** main = tab 行常驻；more = 只在「更多视图」菜单里。 */
  readonly placement: "main" | "more";
  /** 只在条件成立时出现（团队视图仅团队模式）。 */
  readonly when?: (task: Task) => boolean;
  /** 视图内容；`sub` 是 `?view=<id>.<sub>` 的子视图（缺省 = 容器默认子视图）。 */
  readonly Component: (props: { task: Task; sub?: string }) => ReactNode;
}

const EXTRA_VIEWS: readonly TaskViewEntry[] = [
  { id: "overview", label: "概览", order: 25, placement: "main", Component: OverviewView },
  { id: "explore", label: "探索", order: 40, placement: "main", Component: ExploreView },
  { id: "findings", label: "发现", order: 50, placement: "main", Component: FindingsHubView },
  { id: "assets", label: "资产", order: 60, placement: "main", Component: AssetsHubView },
  // 团队：仅团队模式出现（未开启时原来是一整页空态，.tmp/d6-ia-inventory.md §4.2）。
  {
    id: "team",
    label: "团队",
    order: 90,
    placement: "more",
    when: (task) => task.team_mode === true,
    Component: TeamBoardView,
  },
];

/**
 * 按 order 排序后的扩展视图。
 * @param task - 当前任务；给出时按 `when` 过滤（不给 = 全部，用于解析深链）。
 * @returns 视图列表（不含「对话」「轨迹」）。
 */
export function listTaskViews(task?: Task | null): readonly TaskViewEntry[] {
  return EXTRA_VIEWS.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => task === undefined || task === null || entry.when === undefined || entry.when(task))
    .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index)
    .map((row) => row.entry);
}

/**
 * 按容器 id 找扩展视图（`explore.graph` 这类带子视图的 id 取点号前的容器）。
 * @param id - 视图 id。
 * @returns 视图，找不到时为 null。
 */
export function findTaskView(id: string): TaskViewEntry | null {
  const container = splitViewId(id).container;
  return EXTRA_VIEWS.find((entry) => entry.id === container) ?? null;
}

/**
 * 拆 `<容器>.<子>`。
 * @param id - 视图 id。
 * @returns 容器 id 与子视图 id（没有时为 undefined）。
 */
export function splitViewId(id: string): { container: string; sub?: string } {
  const dot = id.indexOf(".");
  if (dot < 0) return { container: id };
  const sub = id.slice(dot + 1);
  return sub === "" ? { container: id.slice(0, dot) } : { container: id.slice(0, dot), sub };
}

/**
 * 旧 tab id → 新位置（U2 合并前的 12 个 tab，以及 U1 预留的写法都在这里收口）。
 */
const VIEW_ALIASES: Readonly<Record<string, string>> = {
  intents: "explore.intents",
  graph: "explore.graph",
  broadcast: "explore.timeline",
  report: "findings.report",
  model: "overview.config",
  coverage: "assets.coverage",
  "findings.list": "findings.list",
  "assets.tasks": "assets.tasks",
};

/**
 * 把深链里的任意视图 id 解析成可渲染的视图 id（容器或 `容器.子`）。
 * @param id - 地址里的原始 id（如 `graph`、`explore.graph`、`overview`）。
 * @returns 可渲染的 id；`chat` / `trajectory` 原样，未知回落 `chat`。
 */
export function resolveViewAlias(id: string): string {
  if (id === "chat" || id === "trajectory") return id;
  const aliased = VIEW_ALIASES[id] ?? id;
  return findTaskView(aliased) === null ? "chat" : aliased;
}
