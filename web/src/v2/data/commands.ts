"use client";

/**
 * 命令记录页（对照表 P2:G1–P2:G3）的适配器：工具执行历史的分页列表与各工具调用统计。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/function/commands/page.tsx:84-103（列表：page / size /
 * q / task 四个参数，翻页不重置）、:106-118（统计：沿用同一组 task/q 筛选、拉整个结果集）。
 * DSH 依据：DSH 无命令记录页，按「主区整页」扩展（总表 §4.1）；适配器写法照抄
 * `v2/data/findings-page.ts:96-149`（useFindingsPage）与 `:223-257`（useFindingStats）。
 *
 * 接口（已按 `lib/api.ts` 核对）：
 * - `api.commands({ task, q, page, size })` → `{ commands: CommandRecord[]; total: number }`
 *   （api.ts:1407-1414；page 从 0 起，size 默认 50）；
 * - `api.commandStats({ task, q })` → `{ stats: ToolStat[] }`（api.ts:1416-1421）。
 * 类型：`CommandRecord` types.ts:1470、`ToolStat` types.ts:1482。两者都只读，本文件不做写操作。
 *
 * 后端没有「worker 筛选」「只看错误」两个参数，所以两者都是**本地**筛选，作用在已经取到的
 * 那一页行上（不过滤时不改变任何请求参数）。统计接口同样没有错误过滤，因此统计表里的
 * 「只看错误」也只是本地高亮/过滤同一个统计快照。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { CommandRecord, ToolStat } from "@/lib/types";

/** 每页条数：卡片要求固定 50（api.ts:1412 的默认值也是 50）。 */
export const COMMANDS_PAGE_SIZE = 50;

/** 搜索框防抖（总表 §6：250ms）。 */
export const COMMANDS_SEARCH_DEBOUNCE_MS = 250;

export type CommandsPhase = "loading" | "ready" | "offline";

/** 列表 / 统计共用的后端筛选（两者都只认 task 与 q）。 */
export interface CommandsFilter {
  /** 任务 id；空串表示不带该参数。 */
  task: string;
  /** 后端搜索文本；空串表示不带该参数。 */
  query: string;
}

export interface CommandsState {
  phase: CommandsPhase;
  /** 当前页的行（后端返回的原始顺序）。 */
  items: CommandRecord[];
  /** 匹配筛选条件的总条数（跨页）。 */
  total: number;
  error: string | null;
  reload: () => void;
}

export interface CommandsStatsState {
  phase: CommandsPhase;
  /** 最近一次成功的统计快照；首次成功前为 null。 */
  stats: ToolStat[] | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一页工具执行记录。
 * @param params.page - 0 起的页游标。
 * @param params.task - 任务 id，空串不带该参数。
 * @param params.query - 后端搜索文本，空串不带该参数。
 * @returns 阶段、当前页行、匹配总数、错误与重新读取。
 */
export function useCommandRecords({
  page,
  task,
  query,
}: {
  page: number;
  task: string;
  query: string;
}): CommandsState {
  const [phase, setPhase] = useState<CommandsPhase>("loading");
  const [items, setItems] = useState<CommandRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .commands({
        page,
        size: COMMANDS_PAGE_SIZE,
        task: task === "" ? undefined : task,
        q: query === "" ? undefined : query,
      })
      .then((res) => {
        if (!alive) return;
        setItems(res.commands ?? []);
        setTotal(res.total ?? 0);
        setError(null);
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
  }, [page, task, query, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

/**
 * 读取各工具的调用次数（沿用列表的 task/q 筛选，统计整个结果集而不是当前页）。
 * @param params.task - 任务 id，空串不带该参数。
 * @param params.query - 后端搜索文本，空串不带该参数。
 * @returns 阶段、最近一次统计快照、错误与重新读取。
 */
export function useCommandStats({ task, query }: CommandsFilter): CommandsStatsState {
  const [phase, setPhase] = useState<CommandsPhase>("loading");
  const [stats, setStats] = useState<ToolStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .commandStats({
        task: task === "" ? undefined : task,
        q: query === "" ? undefined : query,
      })
      .then((res) => {
        if (!alive) return;
        setStats(res.stats ?? []);
        setError(null);
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
  }, [task, query, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, stats, error, reload };
}

/**
 * 把工具原始输入（后端存的是 JSON）转成展示文本：Bash 这类 `{"command": "..."}` 只取
 * 命令本体，其余工具显示格式化的 JSON（旧页 `function/commands/page.tsx:31-40`）。
 * @param raw - `CommandRecord.command` 原文。
 * @returns 可直接放进 `<pre>` 的文本。
 */
export function toolInputText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const command = (parsed as { command?: unknown }).command;
      if (typeof command === "string") return command;
      return JSON.stringify(parsed, null, 2);
    }
    return raw;
  } catch {
    // 不是 JSON：原样显示（后端也会存纯文本输入）。
    return raw;
  }
}

/**
 * 列表里的单行摘要：取第一行，超过 `maxLength` 就截断并加省略号
 * （旧页 `function/commands/page.tsx:42-47`）。
 * @param text - 已转好的输入文本。
 * @param maxLength - 摘要最大字符数。
 * @returns 单行摘要。
 */
export function commandSummary(text: string, maxLength = 80): string {
  const first = text.split("\n")[0] ?? "";
  if (first.length <= maxLength) return first;
  return `${first.slice(0, maxLength)}…`;
}

/**
 * 行时间：`MM-DD HH:mm:ss`（旧页 `function/commands/page.tsx:19-27`）。
 * @param ts - 后端 ISO 时间串。
 * @returns 格式化时间；解析失败时返回原串。
 */
export function formatCommandTime(ts: string): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return ts;
  return at.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 从统计快照里取出所有去重后的工具名，按名称排序（筛选下拉的选项来源，同样是真实数据）。
 * @param stats - `commandStats` 返回的统计行。
 * @returns 去重后的工具名列表。
 */
export function toolNames(stats: readonly ToolStat[] | null): string[] {
  if (stats === null) return [];
  return [...new Set(stats.map((row) => row.tool))].sort((a, b) => a.localeCompare(b));
}
