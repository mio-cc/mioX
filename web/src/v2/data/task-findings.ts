"use client";

/**
 * 任务内发现列表适配器（会话视图 tab「发现」，对照表 P1:C17）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/findings-tab.tsx:31-41（状态列表）、
 * :149-188（本任务 + 直接关联任务、按时间排序、`api.setFindingStatus` 改状态）、:190-222（列表与空态）。
 * DSH 依据：DSH 无任务内发现页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：`api.findingsPage`（api.ts:637，本任务 + 状态筛选 + 时间倒序 + 服务端分页）、
 * `api.setFindingStatus`（api.ts:760，`PATCH /exploration/findings/{id}`，成功返回整行）。
 *
 * 为什么用分页接口而不是 `api.findings(task)`（api.ts:636）：卡片要求每页 25 条，
 * 不分页的接口一次返回全部行；用同一个 `task_id` 参数走服务端分页，数据源仍是真实后端。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Finding, FindingStatus } from "@/lib/types";

/** 每页条数（卡片 C14：25 / 页）。 */
export const TASK_FINDINGS_PAGE_SIZE = 25;

/** 列表排序：时间倒序，与旧页默认一致（findings-tab.tsx:145 的 `desc`）。 */
export const TASK_FINDINGS_SORT = "time";

export type TaskFindingsPhase = "loading" | "ready" | "offline";

export interface TaskFindingsState {
  phase: TaskFindingsPhase;
  /** 本页的行；后端按时间倒序返回，原样使用。 */
  items: Finding[];
  /** 当前筛选条件下的总条数。 */
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个任务本页的发现（本任务 + 直接关联任务的只读行，后端用 `task_id` 决定）。
 * @param taskId - 任务 id；null 时不请求。
 * @param page - 1 基页码。
 * @param status - `all` = 不按状态筛选；其余为后端的 9 种处置状态之一。
 * @returns 阶段、行、总数、错误与重新读取。
 */
export function useTaskFindingsPage(
  taskId: string | null,
  page: number,
  status: "all" | FindingStatus,
): TaskFindingsState {
  const [phase, setPhase] = useState<TaskFindingsPhase>("loading");
  const [items, setItems] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .findingsPage({
        task: taskId,
        page,
        pageSize: TASK_FINDINGS_PAGE_SIZE,
        sort: TASK_FINDINGS_SORT,
        status,
      })
      .then((value) => {
        if (!alive) return;
        setItems(value.items ?? []);
        setTotal(value.total ?? 0);
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
  }, [page, status, taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

/**
 * 改一个发现的处理状态（api.ts:760，`PATCH /exploration/findings/{id}`）。
 * 只做一对一转发：不重试、不吞错误、不做乐观更新。
 * @param id - findings 表的行 id（`Finding.finding_id`，取不到时退回 `Finding.id`）。
 * @param status - 目标处置状态。
 * @returns 后端返回的整行。
 */
export function setFindingStatus(id: string, status: FindingStatus): Promise<Finding> {
  return api.setFindingStatus(id, status);
}

/**
 * 后端写状态用的行 id：优先 `finding_id`（老节点的行 id 可能缺失）。
 * @param finding - 后端返回的发现行。
 * @returns 可用于 PATCH 的 id。
 */
export function findingWriteId(finding: Finding): string {
  const standalone = finding.finding_id ?? "";
  return standalone !== "" ? standalone : finding.id;
}

/**
 * 这一行是否只读：继承自关联任务的发现只读（旧页 findings-tab.tsx:92、:170）。
 * @param finding - 后端返回的发现行。
 * @returns 只读时为 true。
 */
export function findingReadOnly(finding: Finding): boolean {
  return finding.inherited === true;
}
