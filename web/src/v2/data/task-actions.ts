/**
 * Task mutations used by the shell and the sidebar dialogs.
 *
 * Every export is a direct forward to `@/lib/api`: same arguments, same request
 * body, same promise and same rejection. Nothing is retried, swallowed or
 * reshaped here — the components keep owning their own error handling, and the
 * transport stays in `lib/api.ts` where the ledger allows it.
 */
import { api } from "@/lib/api";
import type {
  ArchiveBatchItem,
  BatchControlItem,
  BatchCategoryItem,
  DeleteTaskOptions,
  DeleteTaskResult,
  Task,
  TaskCategory,
  TaskStatus,
} from "@/lib/types";

/** Payload of `POST /tasks`; derived from the client so the shape cannot drift. */
export type CreateTaskInput = Parameters<typeof api.createTask>[0];

/** Result of `GET /tasks`: the list plus the id the backend marks active. */
export type TaskListSnapshot = Awaited<ReturnType<typeof api.tasks>>;

/**
 * Read the task list once.
 * @returns the tasks (already ordered by the server) and the active task id.
 */
export function listTasks(): Promise<TaskListSnapshot> {
  return api.tasks();
}

/**
 * Pause a running task.
 * @param id - task id.
 * @returns the backend control result (`paused` / `queued` / `status`).
 */
export function pauseTask(id: string): Promise<{ id: string; paused: boolean; queued: boolean; status: string }> {
  return api.controlTask(id, "pause");
}

/**
 * Delete a task together with the parts selected in `options`.
 * @param id - task id.
 * @param options - which related records the backend should delete as well.
 * @returns the delete result reported by the backend.
 */
export function deleteTask(id: string, options: DeleteTaskOptions): Promise<DeleteTaskResult> {
  return api.deleteTask(id, options);
}

/**
 * Pin or unpin a task in the sidebar.
 * @param id - task id.
 * @param pinned - desired pinned state.
 * @returns the updated task.
 */
export function pinTask(id: string, pinned: boolean): Promise<Task> {
  return api.pinTask(id, pinned);
}

/**
 * Rename a task.
 * @param id - task id.
 * @param name - new display name (`""` clears it server-side).
 * @returns the updated task.
 */
export function renameTask(id: string, name: string): Promise<Task> {
  return api.renameTask(id, name);
}

/**
 * Archive several tasks in one request.
 * @param taskIds - task ids to archive.
 * @returns per-task archive outcome.
 */
export function archiveTasks(taskIds: string[]): Promise<{ items: ArchiveBatchItem[] }> {
  return api.archiveTasks(taskIds);
}

/**
 * Toggle the task's plan mode (recon-only until the plan is approved).
 * @param id - task id.
 * @param on - desired plan-mode state.
 * @returns the task id and its new `plan_mode`.
 */
export function setTaskPlanMode(id: string, on: boolean): Promise<{ id: string; plan_mode: boolean }> {
  return api.setTaskPlanMode(id, on);
}

/**
 * Set the task's permission preset.
 * @param id - task id.
 * @param level - preset id (`auto` plus the three DSH tiers).
 * @returns the task id and its new `permission_level`.
 */
export function setTaskPermissionLevel(id: string, level: string): Promise<{ id: string; permission_level: string }> {
  return api.setTaskPermissionLevel(id, level);
}

/**
 * Create a task from the new-session dialog.
 * @param input - same payload the api client takes (`description` and `goal` required).
 * @returns the created task.
 */
export function createTask(input: CreateTaskInput): Promise<Task> {
  return api.createTask(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// C10 · 批量与任务控制（P1:A15 P1:A16 P1:A18 P1:A20 P1:A21）
// 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:247-257`（可暂停 / 可恢复 / 可归档
//   的状态门控）、`:689-744`（批量归档与批量暂停 / 恢复）、`:618-673`（批量删除：逐条 deleteTask
//   并汇总）、`:2016-2030`（删除选项五个键，默认全 false）、`:747-780`（批量改分类）。
// DSH 依据：DSH 无侧栏多选与批量控制，按总表 §4「侧栏多选」扩展。
// 对照表行：P1:A15 P1:A16 P1:A18 P1:A20 P1:A21
//
// 本段只追加导出：写操作一对一转发（总表 §5.3），不重试、不吞错误、不做乐观更新。
// ─────────────────────────────────────────────────────────────────────────────

/** 可暂停的状态（旧页 `page.tsx:250` `PAUSABLE_STATUSES`，与后端 applyTaskControlWithCause 门控一致）。 */
const PAUSABLE_STATUSES: readonly TaskStatus[] = ["created", "queued", "running"];

/** 可归档的状态（旧页 `page.tsx:251` `ARCHIVABLE_STATUSES`）。 */
const ARCHIVABLE_STATUSES: readonly TaskStatus[] = ["paused", "done", "failed", "timeout"];

/**
 * 该状态下「暂停 / 恢复」应该发哪个动作；终态返回 null（旧页 `page.tsx:253-257`）。
 * @param status - 后端任务状态。
 * @returns `pause` / `resume` / `null`。
 */
export function taskControlAction(status: TaskStatus): "pause" | "resume" | null {
  if (status === "paused") return "resume";
  if (PAUSABLE_STATUSES.includes(status)) return "pause";
  return null;
}

/**
 * 该任务现在能否归档（旧页 `page.tsx:685`：可归档状态且没在排队）。
 * @param status - 后端任务状态。
 * @param queued - `Task.queued`。
 * @returns 能否归档。
 */
export function taskArchivable(status: TaskStatus, queued: boolean | undefined): boolean {
  return ARCHIVABLE_STATUSES.includes(status) && queued !== true;
}

/**
 * 恢复（resume）一个已暂停的任务（`POST /tasks/{id}/control`，api.ts:366）。
 * @param id - 任务 id。
 * @returns 后端控制结果（`paused` / `queued` / `status`）。
 */
export function resumeTask(id: string): Promise<{ id: string; paused: boolean; queued: boolean; status: string }> {
  return api.controlTask(id, "resume");
}

/**
 * 批量暂停 / 恢复（`POST /tasks/control/batch`，api.ts:368）。
 * @param taskIds - 任务 id 列表。
 * @param action - `pause` 或 `resume`。
 * @returns 逐任务的 `BatchControlItem`（id / ok / status / queued / error）。
 */
export function controlTasksBatch(
  taskIds: string[],
  action: "pause" | "resume",
): Promise<{ items: BatchControlItem[] }> {
  return api.controlTasksBatch(taskIds, action);
}

/** 删除选项的五个键，顺序即界面顺序（旧页 `page.tsx:2024-2030`）。 */
export const DELETE_TASK_OPTION_KEYS: readonly (keyof DeleteTaskOptions)[] = [
  "delete_assets",
  "delete_traffic",
  "delete_files",
  "delete_findings",
  "delete_llm_records",
];

/**
 * 五项都不勾的删除选项（旧页 `page.tsx:2016-2022` 的 `emptyDeleteOptions`）。
 * @returns 全 false 的选项对象。
 */
export function emptyDeleteTaskOptions(): DeleteTaskOptions {
  return {
    delete_assets: false,
    delete_traffic: false,
    delete_files: false,
    delete_findings: false,
    delete_llm_records: false,
  };
}

/** 批量删除里可累加的计数部分（旧页 `page.tsx:204-206` 的 `DeleteCounts`）。 */
export type DeleteTaskCounts = Omit<DeleteTaskResult, "deleted" | "cleanup_warning">;

/**
 * 把删除结果的计数翻译成中文片段（旧页 `page.tsx:208-217` 的 `deleteDetails`）。
 * @param counts - 单次或累加后的计数。
 * @returns 非零项的中文描述，全部为零时返回空数组。
 */
export function deleteTaskDetails(counts: DeleteTaskCounts): string[] {
  const details: string[] = [];
  if (counts.assets_deleted > 0) details.push(`删除资产 ${counts.assets_deleted} 条`);
  if (counts.assets_detached > 0) details.push(`解除共享资产关联 ${counts.assets_detached} 条`);
  if (counts.traffic_deleted > 0) details.push(`删除流量 ${counts.traffic_deleted} 条`);
  if (counts.files_deleted) details.push("删除任务文件");
  if (counts.findings_deleted > 0) details.push(`删除漏洞 ${counts.findings_deleted} 条`);
  if (counts.llm_records_deleted > 0) details.push(`删除 LLM 请求/响应记录 ${counts.llm_records_deleted} 条`);
  return details;
}

/** 批量删除的汇总结果。 */
export interface BulkDeleteSummary {
  /** 成功删除的任务 id。 */
  deleted: string[];
  /** 失败项：id + 后端给出的原因。 */
  failed: { id: string; message: string }[];
  /** 累加的计数（资产 / 流量 / 文件 / 发现 / LLM 记录）。 */
  counts: DeleteTaskCounts;
  /** 后端返回的清理告警（`cleanup_warning`），按任务收集。 */
  warnings: string[];
}

/**
 * 逐个删除任务并汇总结果。
 *
 * 后端没有批量删除接口（api.ts 只有 `deleteTask`，api.ts:365），所以旧页 `page.tsx:616-673` 也是
 * 串行逐条删：成功的从选中集移除，失败的保留以便重试，计数累加后一次性报告。
 * 这里照同一口径实现，不做并发、不重试单条失败。
 * @param taskIds - 要删除的任务 id（调用方决定顺序）。
 * @param options - 五项清理选项，对本次所有任务统一生效。
 * @param onProgress - 每处理完一条回调一次（已完成条数，含失败）。
 * @returns 成功 / 失败 / 计数 / 告警。
 */
export async function deleteTasksSequentially(
  taskIds: readonly string[],
  options: DeleteTaskOptions,
  onProgress?: (done: number) => void,
): Promise<BulkDeleteSummary> {
  const summary: BulkDeleteSummary = {
    deleted: [],
    failed: [],
    counts: {
      assets_deleted: 0,
      assets_detached: 0,
      traffic_deleted: 0,
      files_deleted: false,
      findings_deleted: 0,
      llm_records_deleted: 0,
    },
    warnings: [],
  };
  for (const id of taskIds) {
    try {
      const result = await api.deleteTask(id, options);
      summary.counts.assets_deleted += result.assets_deleted;
      summary.counts.assets_detached += result.assets_detached;
      summary.counts.traffic_deleted += result.traffic_deleted;
      summary.counts.files_deleted = summary.counts.files_deleted || result.files_deleted;
      summary.counts.findings_deleted += result.findings_deleted;
      summary.counts.llm_records_deleted += result.llm_records_deleted;
      if (result.cleanup_warning !== undefined && result.cleanup_warning !== "") {
        summary.warnings.push(`#${id}：${result.cleanup_warning}`);
      }
      summary.deleted.push(id);
    } catch (reason: unknown) {
      summary.failed.push({ id, message: reason instanceof Error ? reason.message : String(reason) });
    }
    onProgress?.(summary.deleted.length + summary.failed.length);
  }
  return summary;
}

/**
 * 批量把任务移到某个分类（`POST /tasks/category/batch`，api.ts:334，经
 * `v2/data/task-categories.ts` 的 `moveTasksToCategory` 同样是一对一转发；这里转出来给侧栏用）。
 * @param taskIds - 任务 id 列表。
 * @param categoryId - 目标分类 id；不传表示移出分类。
 * @returns 逐任务结果与目标分类。
 */
export function moveTasksCategory(
  taskIds: string[],
  categoryId?: number,
): Promise<{ items: BatchCategoryItem[]; category: TaskCategory | null }> {
  return api.updateTasksCategory(taskIds, categoryId);
}

export type TaskCategoryPhase = "loading" | "ready" | "offline";

/** 分类列表的一次读取结果；只为侧栏多选工具条的「批量改分类」提供候选。 */
export interface TaskCategoriesSnapshot {
  phase: TaskCategoryPhase;
  categories: TaskCategory[];
  error: string | null;
}

/**
 * 读一次任务分类列表（`GET /task-categories`，api.ts:324）。
 * 侧栏工具条只在用户打开「移动分类」时调用，不在渲染期请求。
 * @returns 阶段、分类、错误。
 */
export function listTaskCategories(): Promise<TaskCategoriesSnapshot> {
  return api
    .taskCategories()
    .then((categories) => ({ phase: "ready" as const, categories, error: null }))
    .catch((reason: unknown) => ({
      phase: "offline" as const,
      categories: [] as TaskCategory[],
      error: reason instanceof Error ? reason.message : String(reason),
    }));
}
