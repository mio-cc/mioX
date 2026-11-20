"use client";

/**
 * 团队任务板适配器（对照表 P1:C13–C15）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/team-tab.tsx:57-336
 * DSH 依据：ui-conversation 无团队板；参考 TeamBoard 语义（旧页注释 TeamBoard.tsx:29-38,68,86）。
 * 这里只做取数与转发：读 GET /tasks/{id}/team（api.ts:312-313），写 api.ts:314-323。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { TeamTask, TeamTaskProgress } from "@/lib/types";

export type TeamBoardPhase = "loading" | "ready" | "offline";

/** 空进度：与后端同形，界面不必再判空（旧页 team-tab.tsx:33）。 */
export const EMPTY_PROGRESS: TeamTaskProgress = { total: 0, completed: 0, active: 0, pending: 0, blocked: 0 };

export interface TeamBoardState {
  phase: TeamBoardPhase;
  /** 团队任务行，按后端返回顺序。 */
  tasks: TeamTask[];
  /** 顶部进度摘要。 */
  progress: TeamTaskProgress;
  error: string | null;
  /** 重新读取看板。 */
  reload: () => void;
}

/**
 * 读取一个任务的团队任务板。
 * @param taskId - 任务 id；null 时不请求（保持 loading）。
 * @returns 阶段、行、进度、错误与重新读取。
 */
export function useTeamBoard(taskId: string | null): TeamBoardState {
  const [phase, setPhase] = useState<TeamBoardPhase>("loading");
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [progress, setProgress] = useState<TeamTaskProgress>(EMPTY_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .teamBoard(taskId)
      .then((value) => {
        if (!alive) return;
        setTasks(value.tasks);
        setProgress(value.progress);
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
  return { phase, tasks, progress, error, reload };
}

/** 状态中文（旧页 team-tab.tsx:27-31）。 */
const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

/**
 * 状态显示文案。
 * @param status - 后端状态；未知值原样返回。
 * @returns 中文状态。
 */
export function teamStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * 状态对应的 Tag 色调。
 * @param status - 后端状态。
 * @returns Tag 的 tone。
 */
export function teamStatusTone(status: string): "neutral" | "info" | "success" | "outline" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "pending") return "neutral";
  return "outline";
}

/**
 * 进度摘要：只显示非零项，用 `\u2002·\u2002` 连接（旧页 team-tab.tsx:39-45）。
 * @param progress - 后端进度。
 * @returns 摘要文本，全零时为空串。
 */
export function progressLabel(progress: TeamTaskProgress): string {
  return [
    ...(progress.completed > 0 ? [`${progress.completed} 已完成`] : []),
    ...(progress.active > 0 ? [`${progress.active} 进行中`] : []),
    ...(progress.pending > 0 ? [`${progress.pending} 待处理`] : []),
  ].join("\u2002·\u2002");
}

/**
 * 依赖展示文案：#id 标题（状态）；已被删掉的依赖只留 #id（旧页 team-tab.tsx:48-55）。
 * @param ids - 依赖的任务 id。
 * @param tasks - 当前看板行，用于查标题。
 * @returns 依赖文案。
 */
export function dependencyText(ids: readonly number[], tasks: readonly TeamTask[]): string {
  return ids
    .map((id) => {
      const target = tasks.find((item) => item.id === id);
      return target ? `#${id} ${target.subject}（${teamStatusLabel(target.status)}）` : `#${id}`;
    })
    .join("、");
}

/**
 * 新建一条团队任务。
 * @param taskId - 任务 id。
 * @param input - 标题、可选说明、可选依赖。
 * @returns 后端返回的新行。
 */
export function createTeamTask(
  taskId: string,
  input: { subject: string; detail?: string; dependsOn?: number[] },
): Promise<TeamTask> {
  return api.createTeamTask(taskId, input.subject, input.detail, input.dependsOn);
}

/**
 * 认领一条团队任务。
 * @param id - 团队任务 id。
 * @param owner - 认领人标识；旧页固定为 `operator`（team-tab.tsx:98）。
 * @returns 更新后的行。
 */
export function claimTeamTask(id: number, owner = "operator"): Promise<TeamTask> {
  return api.claimTeamTask(id, owner);
}

/**
 * 标记一条团队任务为完成。
 * @param id - 团队任务 id。
 * @returns 更新后的行。
 */
export function completeTeamTask(id: number): Promise<TeamTask> {
  return api.completeTeamTask(id);
}

/**
 * 删除一条团队任务。
 * @param id - 团队任务 id。
 * @returns 后端删除结果。
 */
export function deleteTeamTask(id: number): Promise<{ status: string }> {
  return api.deleteTeamTask(id);
}

/**
 * 把一条手动添加的任务派发成意图，交给 worker 领取。
 * @param id - 团队任务 id。
 * @returns 后端返回的意图 id 与状态。
 */
export function dispatchTeamTask(id: number): Promise<{ intent_id: number; status: string }> {
  return api.dispatchTeamTask(id);
}
