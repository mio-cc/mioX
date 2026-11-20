"use client";

/**
 * 记忆（W-1）：后端跨任务记忆 CRUD 的适配器——前后端都一直没有这个界面。
 *
 * 后端事实（接线排查 2026-11-20 核实，`ARTEX/server/memory.go`）：
 * - `GET /memories` 支持 `q / kind / scope / task / tag / limit` 查询；**命中即
 *   `TouchMemories` 计数**，所以「列表即召回」，hits 是真实的读取次数；
 * - `POST /memories` 返回 201+实体；`PATCH /memories/{id}` 返回实体或 404「memory not found」；
 *   `DELETE /memories/{id}` 返回 `{status:"deleted"}`；
 * - `db.Memory` 字段：id、scope（"global"|"task"，缺省回填 global）、task_id?、
 *   kind（闭集 note/lesson/technique/target）、title、content、tags[]、hits、created_at、updated_at。
 *
 * `lib/api.ts`/`lib/types.ts` 是红线不能改，所以沿用仓库既有先例
 * （`v2/data/side-questions.ts:17` 的 `http` 直调），类型在本文件内声明。
 * 本文件是唯一取数处：组件里不出现 `http` / `api`（总表红线 4）。
 */
import { useCallback, useEffect, useState } from "react";

import { http } from "@/lib/api";

/** 记忆种类（后端 `db/memories.go` 常量的闭集，不造新值）。 */
export type MemoryKind = "note" | "lesson" | "technique" | "target";

/** 后端一条记忆（`db.Memory` 的直译，只收展示与写入需要的字段）。 */
export interface Memory {
  readonly id: number;
  readonly scope: "global" | "task";
  readonly task_id?: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly hits: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** kind 的中文名（界面分组与新建下拉用）。 */
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  note: "笔记",
  lesson: "教训",
  technique: "技巧",
  target: "目标",
};

/** 新建/编辑的写载荷；scope 固定 global（本页只做全局记忆的整理入口，`task` 记
 *  由 agent 运行时自建，展示时按 task_id 关联，不提供伪造入口）。 */
export interface MemoryDraft {
  kind: MemoryKind;
  title: string;
  content: string;
  tags: readonly string[];
}

export type MemoryPhase = "loading" | "ready" | "offline";

export interface MemoriesState {
  phase: MemoryPhase;
  items: readonly Memory[];
  error: string | null;
  reload: () => void;
}

/** 空态判定复用：与后端一致把空标签数组归一成无标签。 */
function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  return Array.isArray(tags) ? tags.filter((tag) => tag.trim() !== "") : [];
}

/**
 * 读取全局记忆（`GET /memories`，命中即计数）。
 * @param params.search - 关键词（后端 `q` 语义：标题/正文/标签全文）；空串不传。
 * @param params.kind - 种类筛选；null 表示全部。
 * @param params.limit - 后端返回上限；默认 200（记忆是精集，不是流）。
 * @returns 四态与重读。
 */
export function useMemories({ search = "", kind = null }: { search?: string; kind?: MemoryKind | null }): MemoriesState {
  const [phase, setPhase] = useState<MemoryPhase>("loading");
  const [items, setItems] = useState<readonly Memory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    const qs = new URLSearchParams();
    if (search !== "") qs.set("q", search);
    if (kind !== null) qs.set("kind", kind);
    qs.set("limit", "200");
    http<{ memories?: Memory[] }>(`/memories?${qs.toString()}`, { method: "GET" })
      .then((value) => {
        if (!alive) return;
        setItems(Array.isArray(value?.memories) ? value.memories : []);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setItems([]);
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
    // search/kind 走查询参数而不是本地过滤：后端 `q` 本来就是全文检索。
  }, [search, kind, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, error, reload };
}

/**
 * 新建一条全局记忆（`POST /memories`，201+实体）。
 * @param draft - 种类 / 标题 / 正文 / 标签。
 * @returns 新建的记忆。
 */
export function createMemory(draft: MemoryDraft): Promise<Memory> {
  return http<Memory>("/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "global",
      kind: draft.kind,
      title: draft.title,
      content: draft.content,
      tags: [...normalizeTags(draft.tags)],
    }),
  });
}

/**
 * 改写一条记忆（`PATCH /memories/{id}`；404 时后端报「memory not found」）。
 * @param id - 记忆 id。
 * @param draft - 新的种类 / 标题 / 正文 / 标签。
 * @returns 改后的记忆。
 */
export function updateMemory(id: number, draft: MemoryDraft): Promise<Memory> {
  return http<Memory>(`/memories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: draft.kind,
      title: draft.title,
      content: draft.content,
      tags: [...normalizeTags(draft.tags)],
    }),
  });
}

/**
 * 删除一条记忆（`DELETE /memories/{id}` 返回 `{status:"deleted"}`）。
 * @param id - 记忆 id。
 */
export function deleteMemory(id: number): Promise<{ status: string }> {
  return http<{ status: string }>(`/memories/${id}`, { method: "DELETE" });
}
