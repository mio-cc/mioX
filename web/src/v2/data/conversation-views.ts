"use client";

/**
 * 会话视图 tab 的扩展注册表（「对话」「轨迹」之后的 tab）。
 * DSH 依据：ui-conversation/src/client/apply.ts:216,403（conversation.view 列表槽）、view-pins.ts:5。
 * 新增一个任务视图 = 往 EXTRA_VIEWS 里加一项，不改会话骨架文件。
 */
import type { ReactNode } from "react";

import { BroadcastView } from "@/components/v2/task-views/BroadcastView";
import { CoverageView } from "@/components/v2/task-views/CoverageView";
import { GraphView } from "@/components/v2/task-views/GraphView";
import { IntentsView } from "@/components/v2/task-views/IntentsView";
import { OverviewView } from "@/components/v2/task-views/OverviewView";
import { ReportView } from "@/components/v2/task-views/ReportView";
import { TaskAssetsView } from "@/components/v2/task-views/TaskAssetsView";
import { TaskFindingsView } from "@/components/v2/task-views/TaskFindingsView";
import { TaskModelView } from "@/components/v2/task-views/TaskModelView";
import { TeamBoardView } from "@/components/v2/task-views/TeamBoardView";
import type { Task } from "@/lib/types";

/** 一个任务视图 tab。 */
export interface TaskViewEntry {
  /** 视图 id，同时是 tab 的 key；不能是 "chat" 或 "trajectory"。 */
  readonly id: string;
  /** tab 上显示的中文。 */
  readonly label: string;
  /** 排序：数字越小越靠左；对话固定在最左，轨迹为 20，新视图从 30 起。 */
  readonly order: number;
  /** 视图内容；参数固定为当前选中的任务。 */
  readonly Component: (props: { task: Task }) => ReactNode;
}

const EXTRA_VIEWS: readonly TaskViewEntry[] = [
  // B11：任务概览（P1:C1–C5、P1:C7）
  { id: "overview", label: "概览", order: 25, Component: OverviewView },
  // A01：团队任务板（P1:C13–C15）
  { id: "team", label: "团队", order: 30, Component: TeamBoardView },
  // A02：意图列表与控制（P1:C8–C12）
  { id: "intents", label: "意图", order: 40, Component: IntentsView },
  // A03：报告与复测记录（P1:C18、P1:C19）
  { id: "report", label: "报告", order: 50, Component: ReportView },
  // A06：任务级模型与 token（P1:B16、B17、B30）
  { id: "model", label: "模型", order: 60, Component: TaskModelView },
  // C13：探索图（P1:C16、P2:L1）
  { id: "graph", label: "探索图", order: 70, Component: GraphView },
  // C14：任务内发现（P1:C17）
  { id: "findings", label: "发现", order: 80, Component: TaskFindingsView },
  // C15：任务资产（P1:C20–C22、P2:D14–D17）
  { id: "assets", label: "资产", order: 90, Component: TaskAssetsView },
  // C16：播报板（P1:C23、P2:L2）
  { id: "broadcast", label: "播报", order: 100, Component: BroadcastView },
  // C17：覆盖度（P1:C24、P2:L4、P2:L6）
  { id: "coverage", label: "覆盖度", order: 110, Component: CoverageView },
];

/**
 * 按 order 排序后的扩展视图。
 * @returns 视图列表（不含「对话」「轨迹」）。
 */
export function listTaskViews(): readonly TaskViewEntry[] {
  return EXTRA_VIEWS.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index)
    .map((row) => row.entry);
}

/**
 * 按 id 找扩展视图。
 * @param id - 视图 id。
 * @returns 视图，找不到时为 null。
 */
export function findTaskView(id: string): TaskViewEntry | null {
  return listTaskViews().find((entry) => entry.id === id) ?? null;
}
