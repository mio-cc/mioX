"use client";

/**
 * 新建任务用到的适配器（对照表 P1:A6–A11）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/new/page.tsx:420-534（模型/分类/目录/覆盖度）、
 * new/dir-picker.tsx:23-154（目录浏览）。
 * 接口：api.ts:324 taskCategories、:361 fsDirs、:348 updateTaskLLMProfiles；建任务本身用
 * v2/data/task-actions.ts 的 createTask（它已转发 api.createTask 的全部字段）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { TaskCategory } from "@/lib/types";

export type CategoriesPhase = "loading" | "ready" | "offline";

export interface CategoriesState {
  phase: CategoriesPhase;
  categories: TaskCategory[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取任务分类列表（新建任务的可选分类）。
 * @returns 阶段、分类、错误与重新读取。
 */
export function useTaskCategories(): CategoriesState {
  const [phase, setPhase] = useState<CategoriesPhase>("loading");
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskCategories()
      .then((rows) => {
        if (!alive) return;
        setCategories(rows);
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
  return { phase, categories, error, reload };
}

/** 目录浏览结果，与 `GET /fs/dirs` 同形；缺省字段补空。 */
export interface DirListing {
  /** 当前列出的绝对路径。 */
  path: string;
  /** 上一级路径；空串表示没有上一级。 */
  parent: string;
  /** 可直接跳转的根目录。 */
  roots: { name: string; path: string }[];
  /** 当前目录下的子目录。 */
  entries: { name: string; path: string }[];
}

/**
 * 列出服务器上的一个目录（新建任务选工作目录用）。
 * @param path - 绝对路径；空串表示列出根目录。
 * @returns 当前目录、上一级、根列表与子目录。
 */
export function listDirs(path: string): Promise<DirListing> {
  return api.fsDirs(path === "" ? undefined : path).then((value) => ({
    path: value.path ?? "",
    parent: value.parent ?? "",
    roots: value.roots ?? [],
    entries: value.entries ?? [],
  }));
}

/**
 * 任务级模型绑定（含指定生效模型）。`createTask` 只接受模型 id 列表，生效模型要创建后再写一次。
 * @param taskId - 任务 id。
 * @param profileIds - 绑定到该任务的 profile id 列表。
 * @param activeProfileId - 生效的 profile id；不传表示不指定。
 * @returns 后端返回的任务 id 与生效模型。
 */
export function bindTaskProfiles(
  taskId: string,
  profileIds: number[],
  activeProfileId?: number,
): Promise<Awaited<ReturnType<typeof api.updateTaskLLMProfiles>>> {
  return api.updateTaskLLMProfiles(taskId, profileIds, activeProfileId);
}
