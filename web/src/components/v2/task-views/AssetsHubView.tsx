"use client";

/**
 * 「资产」容器视图（U2）：任务资产 | 覆盖度（原「资产 / 覆盖度」两个 tab；
 * 覆盖度本就是「资产测试覆盖度」，CoverageView.tsx:292）。
 */
import type { ReactNode } from "react";

import type { Task } from "@/lib/types";

import { CoverageView } from "./CoverageView";
import { TaskAssetsView } from "./TaskAssetsView";
import { pickSub, ViewSwitch } from "./ViewSwitch";

const OPTIONS = [
  { value: "tasks", label: "任务资产", data: { "data-view-sub-option": "tasks" } },
  { value: "coverage", label: "覆盖度", data: { "data-view-sub-option": "coverage" } },
] as const;

/**
 * 渲染资产容器。
 * @param props.task - 当前任务。
 * @param props.sub - `?view=assets.<sub>`。
 * @returns 容器视图。
 */
export function AssetsHubView({ task, sub }: { task: Task; sub?: string }): ReactNode {
  const value = pickSub(sub, OPTIONS);
  return (
    <ViewSwitch container="assets" label="资产视图" value={value} options={OPTIONS}>
      {value === "coverage" ? <CoverageView task={task} /> : <TaskAssetsView task={task} />}
    </ViewSwitch>
  );
}
