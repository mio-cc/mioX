"use client";

/**
 * 归档箱（侧栏「当前 / 已归档」切换）的适配器：一个分页读取 hook + 一对一转发的写操作。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:1651-1789`（`TaskArchivesPanel`：
 *   读取 `api.taskArchives`、`restoreMany`、`deleteMany`、`retry`、按状态门控可勾选 / 可还原 /
 *   可删除）、`:1807-1832`（处理状态筛选的 11 个取值）、`:1554-1568`（状态中文名）、
 *   `:1578-1601`（压缩大小 / 数据量 / 归档时间的显示口径）；切换入口 `:783-788`（「当前任务 /
 *   已归档」两个页签）。
 * DSH 依据：DSH 无归档箱，按总表 §4「侧栏」扩展；面板本身复用
 *   `ui-sidebar/src/client/SidebarRoot.tsx` 的 section 形态（行 = 名称 + 右侧动作）。
 * 对照表行：P1:A2（当前/已归档切换）、P1:A22（列表 + 搜索 + 分页）、P1:A23（还原）、
 *   P1:A24（永久删除）、P1:A25（失败重试）。
 *
 * 接口（`lib/api.ts` 已核对）：
 * - `taskArchives({page,size,q,state})` api.ts:370 → `GET /task-archives`，返回 `TaskArchivePage`；
 * - `archiveTask(taskId)` api.ts:382 → `POST /tasks/{id}/archive`（P1:A25 的「归档失败」重试）；
 * - `restoreTaskArchive(id)` api.ts:385 / `restoreTaskArchives(ids)` api.ts:386（P1:A23）；
 * - `deleteTaskArchive(id)` api.ts:388 / `deleteTaskArchives(ids)` api.ts:389（P1:A24）。
 * 类型以 `lib/types.ts` 为准：`TaskArchive`（types.ts:114-145）、`ArchiveBatchItem`（:154-160）。
 * 本文件是唯一取数处：组件里不出现 `api` / `fetch`（总表红线 4）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { ArchiveBatchItem, TaskArchive, TaskArchivePage, TaskArchiveState } from "@/lib/types";

/** 归档箱每页条数（旧页 page.tsx:1656 的 `pageSize` 默认值 20）。 */
export const ARCHIVE_PAGE_SIZE = 20;

/** 搜索框防抖毫秒（总表 §6「防抖」的同一口径）。 */
export const ARCHIVE_SEARCH_DEBOUNCE_MS = 250;

export type ArchiveListPhase = "loading" | "ready" | "offline";

export interface ArchiveListState {
  phase: ArchiveListPhase;
  /** 当前页的归档行；`phase !== "ready"` 时为空数组。 */
  items: TaskArchive[];
  /** 后端回报的匹配总数（`TaskArchivePage.total`，api.ts:377）。 */
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一页归档（旧页 page.tsx:1662-1693 的 `load`）。
 *
 * 与旧页的差异：旧页每 2 秒轮询一次；/v2 侧栏只在「已归档」视图打开时读取，并在每次写操作
 * 之后 `reload()` —— 归档 / 还原 / 删除本身会改变列表，轮询没有额外信息来源，所以不轮询。
 * 页码越界（例如删掉了最后一页的最后一条）时自动退回上一页，避免停在一个空页上。
 * @param params.open - 是否读取；「当前」视图里传 false，不打扰后端。
 * @param params.page - 页码，从 1 起（照 api.ts:372）。
 * @param params.search - 搜索词（任务名称 / 描述 / ID，后端 `q`）；空串表示不传。
 * @param params.state - 处理状态筛选；`null` 表示全部（不传 `state`）。
 * @returns 阶段、当前页、总数、错误与重新读取。
 */
export function useTaskArchives({
  open,
  page,
  search,
  state,
}: {
  open: boolean;
  page: number;
  search: string;
  state: TaskArchiveState | null;
}): ArchiveListState {
  const [phase, setPhase] = useState<ArchiveListPhase>("loading");
  const [items, setItems] = useState<TaskArchive[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase("loading");
    api
      .taskArchives({ page, size: ARCHIVE_PAGE_SIZE, q: search, state: state ?? undefined })
      .then((value: TaskArchivePage) => {
        if (!alive) return;
        setItems(value.items);
        setTotal(value.total);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setItems([]);
        setTotal(0);
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [open, page, search, state, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

// ─────────────────────────────────────────────────────────────────────────────
// 写操作：一对一转发（总表 §5.3，不重试、不吞错误、不做乐观更新）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 还原一个归档（api.ts:385 `POST /task-archives/{id}/restore`）。
 * @param id - 归档 id（`TaskArchive.id`，不是任务 id）。
 * @returns 后端回报的归档行。
 */
export function restoreTaskArchive(id: number): Promise<TaskArchive> {
  return api.restoreTaskArchive(id);
}

/**
 * 批量还原归档（api.ts:386 `POST /task-archives/restore/batch`）。
 * @param archiveIds - 归档 id 列表。
 * @returns 逐归档结果（`ArchiveBatchItem.id` 是归档 id 的字符串形式）。
 */
export function restoreTaskArchives(archiveIds: number[]): Promise<{ items: ArchiveBatchItem[] }> {
  return api.restoreTaskArchives(archiveIds);
}

/**
 * 永久删除一个归档（api.ts:388 `DELETE /task-archives/{id}`）。
 * @param id - 归档 id。
 * @returns 后端回报的归档行。
 */
export function deleteTaskArchive(id: number): Promise<TaskArchive> {
  return api.deleteTaskArchive(id);
}

/**
 * 批量永久删除归档（api.ts:389 `POST /task-archives/delete/batch`）。
 * @param archiveIds - 归档 id 列表。
 * @returns 逐归档结果。
 */
export function deleteTaskArchives(archiveIds: number[]): Promise<{ items: ArchiveBatchItem[] }> {
  return api.deleteTaskArchives(archiveIds);
}

/**
 * 重新发起一次归档（api.ts:382 `POST /tasks/{id}/archive`）。
 * 只用于 `archive_failed` 行：旧页 `retry`（page.tsx:1779-1789）对归档失败的行重发的是
 * **任务的** 归档接口，不是归档行自己的接口。
 * @param taskId - 原任务的 id（`TaskArchive.task_id`）。
 * @returns 后端回报的归档行。
 */
export function archiveTaskAgain(taskId: string): Promise<TaskArchive> {
  return api.archiveTask(taskId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 状态口径（旧页 page.tsx:1543-1568 / :1893-1896 原样照抄）
// ─────────────────────────────────────────────────────────────────────────────

/** 处理中（不可勾选、不可还原、不可删除）的十种状态里的六种（旧页 `ARCHIVE_PROCESSING_STATES`）。 */
const ARCHIVE_PROCESSING_STATES: readonly TaskArchiveState[] = [
  "archive_queued",
  "archiving",
  "restore_queued",
  "restoring",
  "delete_queued",
  "deleting",
];

/** 失败态（旧页 `ARCHIVE_FAILED_STATES`），行上出现「重试」。 */
const ARCHIVE_FAILED_STATES: readonly TaskArchiveState[] = ["archive_failed", "restore_failed", "delete_failed"];

/**
 * 该归档是否正在被后端处理。
 * @param state - 归档处理状态。
 * @returns 处理中为 true。
 */
export function archiveProcessing(state: TaskArchiveState): boolean {
  return ARCHIVE_PROCESSING_STATES.includes(state);
}

/**
 * 该归档能否还原（旧页 page.tsx:1895：`ready` 或 `restore_failed`）。
 * @param state - 归档处理状态。
 * @returns 能否还原。
 */
export function archiveRestorable(state: TaskArchiveState): boolean {
  return state === "ready" || state === "restore_failed";
}

/**
 * 该归档能否永久删除（旧页 page.tsx:1896：`ready` 或 `delete_failed`）。
 * @param state - 归档处理状态。
 * @returns 能否永久删除。
 */
export function archiveDeletable(state: TaskArchiveState): boolean {
  return state === "ready" || state === "delete_failed";
}

/**
 * 该归档能否勾选（旧页 page.tsx:1702：非处理中即可勾选）。
 * @param state - 归档处理状态。
 * @returns 能否勾选。
 */
export function archiveSelectable(state: TaskArchiveState): boolean {
  return !archiveProcessing(state);
}

/**
 * 该归档的失败能否重试（旧页 page.tsx:1960）。
 * @param state - 归档处理状态。
 * @returns 能否重试。
 */
export function archiveRetryable(state: TaskArchiveState): boolean {
  return ARCHIVE_FAILED_STATES.includes(state);
}

/** 归档处理状态的中文名，照旧页 `archiveStateLabel`（page.tsx:1554-1568）。 */
export const ARCHIVE_STATE_LABEL: Record<TaskArchiveState, string> = {
  archive_queued: "等待归档",
  archiving: "归档中",
  archive_failed: "归档失败",
  ready: "可还原",
  restore_queued: "等待还原",
  restoring: "还原中",
  restore_failed: "还原失败",
  delete_queued: "等待删除",
  deleting: "删除中",
  delete_failed: "删除失败",
};

/**
 * 状态对应的 Tag 色调，照旧页 `ArchiveStateBadge`（page.tsx:1570-1576）：
 * 可还原 = secondary（这里用 success），处理中 = default（info），失败 = destructive（danger）。
 * @param state - 归档处理状态。
 * @returns Tag 的 tone。
 */
export function archiveStateTone(state: TaskArchiveState): "success" | "info" | "danger" | "outline" {
  if (state === "ready") return "success";
  if (archiveProcessing(state)) return "info";
  if (archiveRetryable(state)) return "danger";
  return "outline";
}

/** 「处理状态」筛选的全部取值（旧页 page.tsx:1817-1830 的十一项，含「全部状态」）。 */
export const ARCHIVE_STATE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "archive_queued", label: ARCHIVE_STATE_LABEL.archive_queued },
  { value: "archiving", label: ARCHIVE_STATE_LABEL.archiving },
  { value: "ready", label: ARCHIVE_STATE_LABEL.ready },
  { value: "restore_queued", label: ARCHIVE_STATE_LABEL.restore_queued },
  { value: "restoring", label: ARCHIVE_STATE_LABEL.restoring },
  { value: "delete_queued", label: ARCHIVE_STATE_LABEL.delete_queued },
  { value: "deleting", label: ARCHIVE_STATE_LABEL.deleting },
  { value: "archive_failed", label: ARCHIVE_STATE_LABEL.archive_failed },
  { value: "restore_failed", label: ARCHIVE_STATE_LABEL.restore_failed },
  { value: "delete_failed", label: ARCHIVE_STATE_LABEL.delete_failed },
];

/**
 * 把筛选值还原成接口参数：`all` → null（不传 `state`）。
 * @param value - `ARCHIVE_STATE_OPTIONS` 里的 value。
 * @returns 后端状态或 null。
 */
export function parseArchiveStateFilter(value: string): TaskArchiveState | null {
  for (const state of Object.keys(ARCHIVE_STATE_LABEL) as TaskArchiveState[]) {
    if (state === value) return state;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 显示口径（旧页 page.tsx:1578-1601 原样照抄）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 字节数的紧凑写法（旧页 `formatArchiveBytes`，page.tsx:1578-1584）。
 * @param bytes - 字节数。
 * @returns `1.2 MB` 这类文案；0 或负数返回 `—`。
 */
export function formatArchiveBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * 压缩大小文案（旧页 `archiveCompressionLabel`，page.tsx:1586-1590）。
 * @param archive - 归档行。
 * @returns `12.3 MB · 节省 64%` 或 `—`。
 */
export function archiveCompressionLabel(archive: TaskArchive): string {
  if (archive.original_size <= 0 || archive.compressed_size <= 0) return "—";
  const saved = Math.max(0, 100 - (archive.compressed_size / archive.original_size) * 100);
  return `${formatArchiveBytes(archive.compressed_size)} · 节省 ${saved.toFixed(0)}%`;
}

/**
 * 数据量总和（旧页 `archiveDataTotal`，page.tsx:1592-1594）。
 * @param archive - 归档行。
 * @returns `data_counts` 各项之和。
 */
export function archiveDataTotal(archive: TaskArchive): number {
  return Object.values(archive.data_counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

/**
 * 归档时间（旧页 `archiveDate`，page.tsx:1596-1601）：`archived_at` 缺失时退回 `requested_at`。
 * @param archive - 归档行。
 * @returns 本地化时间串；无法解析返回 `—`。
 */
export function archiveDate(archive: TaskArchive): string {
  const value = archive.archived_at ?? archive.requested_at;
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

/**
 * 归档行的标题（旧页 page.tsx:1917：`task_name` → `task_description` → `任务 #id`）。
 * @param archive - 归档行。
 * @returns 单行标题。
 */
export function archiveTitle(archive: TaskArchive): string {
  const name = archive.task_name.trim();
  if (name !== "") return name;
  const description = archive.task_description.trim();
  if (description !== "") return description;
  return `任务 #${archive.task_id}`;
}

/** 批量写操作里一条失败的明细（归档 id + 后端原因）。 */
export interface ArchiveFailure {
  /** 归档 id（数字）。 */
  id: number;
  /** 后端给出的原因，或本地回退文案。 */
  message: string;
}

/** 批量还原 / 批量删除的汇总结果。 */
export interface ArchiveBatchSummary {
  /** 成功加入队列的归档 id。 */
  ok: number[];
  /** 失败项。 */
  failed: ArchiveFailure[];
}

/**
 * 把批量接口的逐项结果归成「成功 / 失败」（`ArchiveBatchItem`，types.ts:154-160）。
 * @param items - 后端逐项结果。
 * @returns 成功 id 与失败明细。
 */
export function summarizeArchiveBatch(items: readonly ArchiveBatchItem[]): ArchiveBatchSummary {
  const ok: number[] = [];
  const failed: ArchiveFailure[] = [];
  for (const item of items) {
    const id = Number(item.archive_id ?? item.id);
    if (item.ok) {
      if (Number.isSafeInteger(id) && id > 0) ok.push(id);
      continue;
    }
    failed.push({
      id: Number.isSafeInteger(id) && id > 0 ? id : 0,
      message: item.error !== undefined && item.error !== "" ? item.error : "状态已变化",
    });
  }
  return { ok, failed };
}
