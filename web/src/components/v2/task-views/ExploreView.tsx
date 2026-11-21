"use client";

/**
 * 「探索」容器视图（U2）：意图 | 图 | 时间线。
 * 三者同源（exploration 节点），原来是「意图 / 探索图 / 播报」三个 tab（.tmp/d6-ia-inventory.md §2.5）。
 */
import type { ReactNode } from "react";

import type { Task } from "@/lib/types";

import { BroadcastView } from "./BroadcastView";
import { GraphView } from "./GraphView";
import { IntentsView } from "./IntentsView";
import { pickSub, ViewSwitch } from "./ViewSwitch";

const OPTIONS = [
  { value: "intents", label: "意图", data: { "data-view-sub-option": "intents" } },
  { value: "graph", label: "图", data: { "data-view-sub-option": "graph" } },
  { value: "timeline", label: "时间线", data: { "data-view-sub-option": "timeline" } },
] as const;

/**
 * 渲染探索容器。
 * @param props.task - 当前任务。
 * @param props.sub - `?view=explore.<sub>`。
 * @returns 容器视图。
 */
export function ExploreView({ task, sub }: { task: Task; sub?: string }): ReactNode {
  const value = pickSub(sub, OPTIONS);
  return (
    <ViewSwitch container="explore" label="探索视图" value={value} options={OPTIONS}>
      {value === "graph" ? <GraphView task={task} /> : value === "timeline" ? <BroadcastView task={task} /> : <IntentsView task={task} />}
    </ViewSwitch>
  );
}
