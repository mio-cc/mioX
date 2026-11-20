"use client";

/**
 * 任务分类与模板的适配器（C11 · P1:A26–A28）：侧栏分类分组、分类管理与任务模板都从这里取数。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/page.tsx:473-496（loadCategories）、
 *   :2742-3060（CategoryManagementSheet：新建 / 改名 / 删除，删除确认文案见 :3040-3042）、
 *   :2218-2280（MoveTasksCategoryDialog：单任务 / 批量改分类）、
 *   components/task-template-controls.tsx:143-199（模板新建 / 更新 / 删除）、:347-537（模板选择与应用）。
 * DSH 依据：DSH 无任务分类与模板，按总表 §4「侧栏分组 + 设置通用页」扩展。
 * 对照表行：P1:A26 P1:A27 P1:A28
 *
 * 读接口：api.taskCategories（api.ts:324）、api.taskTemplates（api.ts:339）。
 * 写接口一对一转发，不重试、不吞错误、不做乐观更新（总表 §5.3）：
 *   api.createTaskCategory（api.ts:328）、api.renameTaskCategory（api.ts:329）、
 *   api.deleteTaskCategory（api.ts:330）、api.updateTaskCategory（api.ts:331）、
 *   api.updateTasksCategory（api.ts:334）、api.createTaskTemplate（api.ts:340）、
 *   api.updateTaskTemplate（api.ts:343）、api.deleteTaskTemplate（api.ts:347）。
 *
 * 分类列表的读取复用 `@/v2/data/task-create` 的 `useTaskCategories`（同一个 GET，同一种阶段口径），
 * 本文件只追加：分组计算、写操作转发、模板读取与写操作。
 */
import { useCallback, useEffect, useState } from "react";

import type { Task, TaskCategory, TaskTemplate } from "@/lib/types";
import { api } from "@/lib/api";

/** 后端对分类名称的上限：`ARTEX/db/task_categories.go:14`（MaxTaskCategoryNameRunes = 80）。 */
export const TASK_CATEGORY_NAME_MAX = 80;

/** 后端对模板名称 / 正文的上限：`ARTEX/db/task_templates.go:16-17`（120 / 16000）。 */
export const TASK_TEMPLATE_NAME_MAX = 120;

/** 「未分类」分组在界面上的标题。 */
export const UNCATEGORIZED_LABEL = "未分类";

/** 侧栏的一个分类分组。 */
export interface TaskCategoryGroup {
  /** 稳定的 React key；未分类分组用 `none`。 */
  key: string;
  /** 分组标题（分类名，或「未分类」）。 */
  name: string;
  /** 分类 id；未分类为 null。 */
  categoryId: number | null;
  /** 该分组下的任务。 */
  tasks: Task[];
}

/**
 * 按 `Task.category_name` 把任务分进各分类分组（总表派工：分组渲染按它）。
 * @param tasks - 已排好序的任务列表（分组内保持传入顺序）。
 * @param categories - `GET /task-categories` 的返回；用于显示「后端有分类但当前没有任务」的空分组，
 *   以及把任务按 category_id 归组（任务自带的 category_name 为准，缺失时回落到这里的名字）。
 * @returns 分类分组（按后端返回顺序）+ 末尾的「未分类」分组（仅在确有未分类任务时出现）。
 */
export function groupTasksByCategory(
  tasks: readonly Task[],
  categories: readonly TaskCategory[],
): TaskCategoryGroup[] {
  const byId = new Map<number, TaskCategoryGroup>();
  const groups: TaskCategoryGroup[] = [];
  for (const category of categories) {
    const group: TaskCategoryGroup = {
      key: String(category.id),
      name: category.name,
      categoryId: category.id,
      tasks: [],
    };
    byId.set(category.id, group);
    groups.push(group);
  }
  const uncategorized: TaskCategoryGroup = {
    key: "none",
    name: UNCATEGORIZED_LABEL,
    categoryId: null,
    tasks: [],
  };
  // 后端已知分类里没有、但任务自带 category_id 的情况（分类列表读取失败 / 刚被别处改名）：
  // 用任务上的 category_name 现开一个分组，名字拿不到就退回「未分类」，不编造名字。
  const orphans = new Map<string, TaskCategoryGroup>();
  for (const task of tasks) {
    if (task.category_id === undefined || task.category_id === null) {
      uncategorized.tasks.push(task);
      continue;
    }
    const known = byId.get(task.category_id);
    if (known !== undefined) {
      known.tasks.push(task);
      continue;
    }
    const orphanKey = `id:${task.category_id}`;
    let orphan = orphans.get(orphanKey);
    if (orphan === undefined) {
      const name = task.category_name !== undefined && task.category_name !== "" ? task.category_name : UNCATEGORIZED_LABEL;
      orphan = { key: orphanKey, name, categoryId: task.category_id, tasks: [] };
      orphans.set(orphanKey, orphan);
      groups.push(orphan);
    }
    orphan.tasks.push(task);
  }
  if (uncategorized.tasks.length > 0) groups.push(uncategorized);
  return groups;
}

/**
 * 新建任务分类。
 * @param name - 分类名（后端会压空白并做同名冲突检查，冲突返回 409「分类名称已存在」）。
 * @returns 后端返回的新分类（`task_count` 为 0）。
 */
export function createTaskCategory(name: string): Promise<TaskCategory> {
  return api.createTaskCategory(name);
}

/**
 * 重命名任务分类。
 * @param id - 分类 id。
 * @param name - 新名称。
 * @returns 后端返回的分类（`task_count` 为受影响任务数）。
 */
export function renameTaskCategory(id: number, name: string): Promise<TaskCategory> {
  return api.renameTaskCategory(id, name);
}

/**
 * 删除任务分类。
 *
 * 真实后端行为（已核对，删除确认文案据此书写）：`ARTEX/db/task_categories.go:149-158` 的
 * `DeleteTaskCategory` 删除分类行，受影响任务经 `tasks.category_id ON DELETE SET NULL`
 * 外键移入「未分类」；`ARTEX/server/manager.go:940-959` 同步把内存里的任务 `CategoryID` 清空、
 * `CategoryName` 清空。任务本身、它的发现、资产、会话都不会被删除。
 * @param id - 分类 id。
 * @returns 后端返回被删除的分类 id（`{ deleted: <id> }`，api.ts:330）。
 */
export function deleteTaskCategory(id: number): Promise<{ deleted: number }> {
  return api.deleteTaskCategory(id);
}

/**
 * 把单个任务改到某个分类（`PATCH /tasks/{id}/category`）。
 * @param taskId - 任务 id。
 * @param categoryId - 目标分类 id；不传 / undefined 表示移出分类（后端收到 null）。
 * @returns 后端返回更新后的任务。
 */
export function moveTaskToCategory(taskId: string, categoryId?: number): Promise<Task> {
  return api.updateTaskCategory(taskId, categoryId);
}

/**
 * 批量把任务改到某个分类（`POST /tasks/category/batch`）。
 * @param taskIds - 任务 id 列表（后端上限见 `db.MaxTaskCategoryBatchSize`）。
 * @param categoryId - 目标分类 id；不传 / undefined 表示全部移出分类。
 * @returns 每项的成功 / 失败原因，以及目标分类（移出分类时为 null）。
 */
export function moveTasksToCategory(
  taskIds: string[],
  categoryId?: number,
): Promise<Awaited<ReturnType<typeof api.updateTasksCategory>>> {
  return api.updateTasksCategory(taskIds, categoryId);
}

export type TaskTemplatesPhase = "loading" | "ready" | "offline";

export interface TaskTemplatesState {
  phase: TaskTemplatesPhase;
  templates: TaskTemplate[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取任务模板列表（`GET /task-templates`，api.ts:339）。
 * @returns 阶段、模板、错误与重新读取。
 */
export function useTaskTemplates(): TaskTemplatesState {
  const [phase, setPhase] = useState<TaskTemplatesPhase>("loading");
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskTemplates()
      .then((rows) => {
        if (!alive) return;
        setTemplates(rows);
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
  return { phase, templates, error, reload };
}

/**
 * 新建任务模板。
 * @param input - 名称 / 描述 / 目标必填，分类与任务级拦截规则可选（字段形状同 `TaskTemplate`）。
 * @returns 后端返回的新模板。
 */
export function createTaskTemplate(
  input: Pick<TaskTemplate, "name" | "description" | "goal" | "category_id" | "intercept_rules">,
): Promise<TaskTemplate> {
  return api.createTaskTemplate(input);
}

/**
 * 更新任务模板（只发送传进来的字段）。
 * @param id - 模板 id。
 * @param input - 要改的字段。
 * @returns 后端返回的模板。
 */
export function updateTaskTemplate(
  id: number,
  input: Partial<Pick<TaskTemplate, "name" | "description" | "goal" | "category_id" | "intercept_rules">>,
): Promise<TaskTemplate> {
  return api.updateTaskTemplate(id, input);
}

/**
 * 删除任务模板。已由该模板创建的任务不受影响（模板是复制语义，不保持关联）。
 * @param id - 模板 id。
 * @returns `{ deleted: <id> }`（api.ts:347）。
 */
export function deleteTaskTemplate(id: number): Promise<{ deleted: number }> {
  return api.deleteTaskTemplate(id);
}
