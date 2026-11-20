"use client";

/**
 * Adapter for the task list behind the sidebar. Same contract as `useSettings`:
 * one phase, one value, one reload — so a page can render loading, offline and
 * ready without branching on transport details.
 *
 * C09（P1:A30、P1:A31、P1:D13、P1:E7）只在本文件**追加**导出：侧栏所需的排序
 * （置顶优先，旧页 `page.tsx:281-305` `compareTasks`）、本地拖动顺序
 * （`P1:A30` 只存 localStorage，键名 `v2.tasks.order`）、活动任务写入
 * （`P1:D13` → `api.setActive`（api.ts:417））与行内字段的纯计算
 * （状态 / 目标进度 / 发现分档 / 时长 / token / 置顶 / 活动，旧页
 * `page.tsx:1216-1284`）。已有的 `useTasks` 一行未改。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Task, TaskStatus } from "@/lib/types";

export type TasksPhase = "loading" | "ready" | "offline";

export interface TasksState {
  phase: TasksPhase;
  tasks: Task[] | null;
  error: string | null;
  reload: () => void;
}

/**
 * Read the task list once.
 * A missing backend reports `offline` rather than throwing: the sidebar must
 * still render a usable shell.
 * @returns phase, tasks and a reload callback.
 */
export function useTasks(): TasksState {
  const [phase, setPhase] = useState<TasksPhase>("loading");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .tasks()
      .then((value) => {
        if (!alive) return;
        // `GET /tasks` wraps the list: { tasks, active }.
        setTasks(value.tasks);
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
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, tasks, error, reload };
}

// ─────────────────────────────────────────────────────────────────────────────
// C09 · 行内字段（P1:A30）与列表排序（P1:A31）
// ─────────────────────────────────────────────────────────────────────────────

/** 任务状态的中文名，照旧页 `page.tsx:232-241` 的 `STATUS_OPTIONS`。 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  created: "已创建",
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
  timeout: "已超时",
};

/** 状态在侧栏行上的色调（`Tag` 的 tone 取值）。 */
export type TaskStatusTone = "success" | "info" | "warning" | "danger" | "neutral";

const TASK_STATUS_TONE: Record<TaskStatus, TaskStatusTone> = {
  created: "neutral",
  queued: "info",
  running: "info",
  paused: "warning",
  done: "success",
  failed: "danger",
  timeout: "danger",
};

/**
 * 状态对应的 Tag 色调。
 * @param status - 后端状态。
 * @returns 色调名。
 */
export function taskStatusTone(status: TaskStatus): TaskStatusTone {
  return TASK_STATUS_TONE[status] ?? "neutral";
}

/**
 * 置顶判定，照旧页 `page.tsx:267-269`（`pinned` 为真，或有 `pinned_at`）。
 * @param task - 任务。
 * @returns 是否置顶。
 */
export function taskIsPinned(task: Task): boolean {
  return task.pinned === true || (task.pinned !== false && task.pinned_at != null);
}

/** 后端状态是否属于终态（`done` / `failed` / `timeout`），照旧页 `page.tsx:250-251`。 */
const TERMINAL_STATUSES = new Set<TaskStatus>(["done", "failed", "timeout"]);

/**
 * 后端状态到 7 种状态的稳定排序权重，照旧页 `TASK_STATUS_RANK`（`page.tsx:232-241,265`）。
 * 只为排序用；`TASK_STATUS_LABEL` 的键顺序即旧页选项顺序。
 */
const TASK_STATUS_RANK: Record<TaskStatus, number> = {
  created: 0,
  queued: 1,
  running: 2,
  paused: 3,
  done: 4,
  failed: 5,
  timeout: 6,
};

/**
 * 创建时间（unix 秒），照旧页 `page.tsx:275-279`：优先 `created_unix`，否则解析 `created_at`。
 * @param task - 任务。
 * @returns unix 秒；无法解析时为 0。
 */
function taskCreatedUnix(task: Task): number {
  if (task.created_unix !== undefined && task.created_unix > 0) return task.created_unix;
  const parsed = Date.parse(task.created_at);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/**
 * 运行时长（秒），照旧页 `page.tsx` 的 `taskDuration`：未完成的用现在减创建，已完成的用完成减创建。
 * @param task - 任务。
 * @param nowUnix - 当前 unix 秒（由调用方传入，避免每行各取一次时间）。
 * @returns 秒数；不足 0 时为 0。
 */
export function taskDurationSeconds(task: Task, nowUnix: number): number {
  const start = taskCreatedUnix(task);
  if (start <= 0) return 0;
  const end =
    task.completed_unix !== undefined && task.completed_unix > 0
      ? task.completed_unix
      : TERMINAL_STATUSES.has(task.status)
        ? start
        : nowUnix;
  return Math.max(0, end - start);
}

/**
 * 时长的紧凑写法（`2h 05m` 这类），旧页 `fmtDuration` 的显示口径。
 * @param seconds - 秒。
 * @returns 文案；0 秒返回 `—`。
 */
export function formatTaskDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * 目标进度文案，照旧页 `page.tsx:1216-1222`：`goals_total` 为 0 时显示 `—`。
 * @param task - 任务。
 * @returns `已达成/总数` 或 `—`。
 */
export function goalsProgressText(task: Task): string {
  const total = task.goals_total ?? 0;
  if (total <= 0) return "—";
  return `${task.goals_met ?? 0}/${total}`;
}

/**
 * 已登记发现的四档计数，照旧页 `page.tsx:1223-1243`；没有该字段时返回 null（不画）。
 * @param task - 任务。
 * @returns `{ critical, high, medium, low, total }` 或 null。
 */
export function findingsBreakdown(
  task: Task,
): { critical: number; high: number; medium: number; low: number; total: number } | null {
  const findings = task.findings;
  if (findings === undefined) return null;
  const { critical, high, medium, low } = findings;
  return { critical, high, medium, low, total: critical + high + medium + low };
}

/**
 * 最近活动时间（unix 秒），`last_activity_unix` 缺失时退回创建时间；都没有返回 0（不画）。
 * @param task - 任务。
 * @returns unix 秒。
 */
export function taskActivityUnix(task: Task): number {
  if (task.last_activity_unix !== undefined && task.last_activity_unix > 0) return task.last_activity_unix;
  return taskCreatedUnix(task);
}

/**
 * 任务在侧栏里可显示的标题：`name` 优先，空则用描述（与 `tasks-map.ts` 同一口径）。
 * @param task - 任务。
 * @returns 单行标题。
 */
export function taskDisplayName(task: Task): string {
  const name = task.name ?? "";
  return name.trim() !== "" ? name.trim() : task.description;
}

/** 侧栏可选的排序字段，照旧页 `TaskSortField`（`page.tsx:259-261`）。 */
export type TaskSortField = "id" | "created" | "duration" | "status";

export type TaskSortDirection = "asc" | "desc";

export interface TaskSortPreference {
  field: TaskSortField;
  direction: TaskSortDirection;
}

/** 排序字段的中文名（侧栏「排序方式」菜单）。 */
export const TASK_SORT_FIELD_LABEL: Record<TaskSortField, string> = {
  id: "编号",
  created: "创建时间",
  duration: "运行时长",
  status: "状态",
};

/** 同 id 时的兜底比较（数字感知），照旧页 `compareTaskIDs`（`page.tsx:271-273`）。 */
function compareTaskIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * 单个任务的比较器，照旧页 `compareTasks`（`page.tsx:281-305`）：置顶恒在前，
 * 同为置顶时按 `pinned_at` 倒序，其余按所选字段与方向，最后 id 倒序兜底。
 * @param left - 左任务。
 * @param right - 右任务。
 * @param preference - 排序字段与方向。
 * @param nowUnix - 当前 unix 秒（`duration` 用到）。
 * @returns 负 / 零 / 正。
 */
export function compareTasks(
  left: Task,
  right: Task,
  preference: TaskSortPreference,
  nowUnix: number,
): number {
  const leftPinned = taskIsPinned(left);
  const rightPinned = taskIsPinned(right);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  if (leftPinned && (left.pinned_at ?? "") !== (right.pinned_at ?? "")) {
    return (right.pinned_at ?? "").localeCompare(left.pinned_at ?? "");
  }

  let compared = 0;
  switch (preference.field) {
    case "created":
      compared = taskCreatedUnix(left) - taskCreatedUnix(right);
      break;
    case "duration":
      compared = taskDurationSeconds(left, nowUnix) - taskDurationSeconds(right, nowUnix);
      break;
    case "status":
      compared = (TASK_STATUS_RANK[left.status] ?? 0) - (TASK_STATUS_RANK[right.status] ?? 0);
      break;
    default:
      compared = compareTaskIds(left.id, right.id);
  }
  if (compared !== 0) return preference.direction === "asc" ? compared : -compared;
  return -compareTaskIds(left.id, right.id);
}

/**
 * 排序整份任务列表（不改入参），置顶行恒在最前。
 * @param tasks - 后端返回的任务。
 * @param preference - 排序字段与方向。
 * @param nowUnix - 当前 unix 秒。
 * @returns 新数组。
 */
export function sortTasks(
  tasks: readonly Task[],
  preference: TaskSortPreference,
  nowUnix: number,
): Task[] {
  return [...tasks].sort((left, right) => compareTasks(left, right, preference, nowUnix));
}

// ─────────────────────────────────────────────────────────────────────────────
// P1:A30 · 拖动排序（只存 localStorage，键名 `v2.tasks.order`）
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage 里存本地任务顺序的键（卡片指定）。 */
export const TASK_ORDER_STORAGE_KEY = "v2.tasks.order";

/**
 * 读取本地顺序。localStorage 不可用（隐私模式 / 服务端）或内容损坏时返回空数组，
 * 侧栏按后端顺序渲染。
 * @returns 任务 id 数组。
 */
export function readTaskOrder(): string[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TASK_ORDER_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item !== "" && !ids.includes(item)) ids.push(item);
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * 写入本地顺序。写不进去（隐私模式 / 配额）就返回 false，界面仍按内存里的顺序显示。
 * @param ids - 任务 id 数组。
 * @returns 是否写入了 localStorage。
 */
export function writeTaskOrder(ids: readonly string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(TASK_ORDER_STORAGE_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

/**
 * 把一次拖动结果落成本地顺序：`draggedId` 移到 `beforeId` 之前（`beforeId` 为 null 表示移到末尾）。
 * 没在顺序里的任务保持原有相对位置、追加在后面，保证每个任务都有确定位置。
 * @param current - 当前顺序（可能为空，表示完全按后端顺序）。
 * @param visibleIds - 当前实际渲染出来的任务 id，按后端 + 排序后的顺序。
 * @param draggedId - 被拖动的任务 id。
 * @param beforeId - 落点之前的任务 id；null = 移到这些任务之后。
 * @returns 新的完整顺序。
 */
export function reorderTaskIds(
  current: readonly string[],
  visibleIds: readonly string[],
  draggedId: string,
  beforeId: string | null,
): string[] {
  // 先把「当前顺序」投影到可见集合上，丢掉已不存在 / 被筛掉的 id。
  const visible = new Set(visibleIds);
  const projected = current.filter((id) => visible.has(id));
  for (const id of visibleIds) if (!projected.includes(id)) projected.push(id);
  // 拖动过的任务先摘出来，再插到落点之前（或末尾）。
  const without = projected.filter((id) => id !== draggedId);
  if (beforeId === null || !without.includes(beforeId)) return [...without, draggedId];
  const at = without.indexOf(beforeId);
  return [...without.slice(0, at), draggedId, ...without.slice(at)];
}

/**
 * 按本地顺序重排任务：本地顺序里有的按它的位置排，没记录的排在后面并保持传入顺序。
 * @param tasks - 已按「置顶 + 排序字段」排好的任务。
 * @param order - 本地顺序（`readTaskOrder()`）。
 * @returns 新数组。
 */
export function applyTaskOrder(tasks: readonly Task[], order: readonly string[]): Task[] {
  if (order.length === 0) return [...tasks];
  const rank = new Map<string, number>();
  order.forEach((id, index) => rank.set(id, index));
  const known: Task[] = [];
  const unknown: Task[] = [];
  for (const task of tasks) {
    if (rank.has(task.id)) known.push(task);
    else unknown.push(task);
  }
  known.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
  return [...known, ...unknown];
}

// ─────────────────────────────────────────────────────────────────────────────
// P1:D13 · 设置当前活动任务（后端 active 跟随）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把某个任务设为后端的活动任务（`POST /active`）。
 * 一对一转发：不重试、不吞错误，调用方自己决定怎么提示。
 * @param id - 任务 id。
 * @returns 后端回报的 active id。
 */
export function setActiveTask(id: string): Promise<{ active: string }> {
  return api.setActive(id);
}

/** 活动任务写入的阶段。 */
export type ActiveTaskPhase = "idle" | "ready" | "syncing" | "offline";

export interface ActiveTaskState {
  phase: ActiveTaskPhase;
  /** 最近一次写入失败的原因（`phase === "offline"` 时有值）。 */
  error: string | null;
  /** 已写入后端的运动任务 id（只作为写入成功的证据，界面不据此判断选中）。 */
  syncedId: string | null;
}

/**
 * 把「选中任务」同步到后端：`active` 变化时（且后端列表里确有该行）写一次 `POST /active`。
 *
 * 为什么先看列表：`active` 可能来自 `GET /tasks` 的 auto-select 或才被删掉的行，
 * 这些都不是用户手势，不该写后端；只有真实存在且已被选中的 id 才写。
 * @param active - 当前选中的任务 id（`null` 表示未选）。
 * @param taskIds - 后端列表里的任务 id（`null` 表示列表还没读到）。
 * @returns 写入阶段、失败原因与已同步的 id。
 */
export function useActiveTaskSync(active: string | null, taskIds: readonly string[] | null): ActiveTaskState {
  const [phase, setPhase] = useState<ActiveTaskPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [syncedId, setSyncedId] = useState<string | null>(null);
  const seqRef = useRef(0);
  // 依赖数组元素个数必须固定（总表 §5.2），且调用方每次渲染都会新建 `taskIds`：
  // 用拼接串做依赖，只有「列表里真实存在的 id 集合」变了才重写。
  const idKey = taskIds === null ? "" : taskIds.join("\u0000");

  useEffect(() => {
    if (active === null || idKey === "") return;
    if (!idKey.split("\u0000").includes(active)) return;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setPhase("syncing");
    setActiveTask(active)
      .then(() => {
        if (seq !== seqRef.current) return;
        setSyncedId(active);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (seq !== seqRef.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
  }, [active, idKey]);

  return { phase, error, syncedId };
}
