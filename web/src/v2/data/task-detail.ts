"use client";

/**
 * 单个任务的详情读取（P1:A31）。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:1287-1291` 的
 *   「查看任务详情」跳到 `/function/tasks/detail?id=`，详情页读 `GET /tasks/{id}`。
 * DSH 依据：DSH 无任务详情路由，任务详情即会话视图；本适配器只提供侧栏详情面板所需的一次读。
 * 对照表行：P1:A31。
 *
 * 一对一转发 `api.task`（api.ts:280 → `GET /tasks/{id}`）：不重试、不缓存、不吞错误。
 */
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";

/** 详情读取的阶段，与 `useTasks` 同口径，供面板区分加载 / 就绪 / 离线。 */
export type TaskDetailPhase = "loading" | "ready" | "offline";

/**
 * 读一个任务的权威快照。
 * @param id - 任务 id。
 * @returns 后端返回的任务；失败时抛出带后端信息的 Error。
 */
export function getTaskDetail(id: string): Promise<Task> {
  return api.task(id);
}
