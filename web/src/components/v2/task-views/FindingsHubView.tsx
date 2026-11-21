"use client";

/**
 * 「发现」容器视图（U2）：列表 | 报告（原「发现 / 报告」两个 tab）。
 * 右栏「在发现视图打开」写 `?view=findings&hl=<id>`，落在默认子视图「列表」，
 * TaskFindingsView 照常读 `hl` 高亮。
 */
import type { ReactNode } from "react";

import type { Task } from "@/lib/types";

import { ReportView } from "./ReportView";
import { TaskFindingsView } from "./TaskFindingsView";
import { pickSub, ViewSwitch } from "./ViewSwitch";

const OPTIONS = [
  { value: "list", label: "列表", data: { "data-view-sub-option": "list" } },
  { value: "report", label: "报告", data: { "data-view-sub-option": "report" } },
] as const;

/**
 * 渲染发现容器。
 * @param props.task - 当前任务。
 * @param props.sub - `?view=findings.<sub>`。
 * @returns 容器视图。
 */
export function FindingsHubView({ task, sub }: { task: Task; sub?: string }): ReactNode {
  const value = pickSub(sub, OPTIONS);
  return (
    <ViewSwitch container="findings" label="发现视图" value={value} options={OPTIONS}>
      {value === "report" ? <ReportView task={task} /> : <TaskFindingsView task={task} />}
    </ViewSwitch>
  );
}
