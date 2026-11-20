"use client";

/**
 * 系统日志适配器：实时尾部（SSE）+ 历史日志（DB 分页）+ 纯函数（去重、过滤、计数、时间格式）。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/logs/page.tsx:67（EventSource `/api/logs/stream?since=0`）、
 *   :90（`/api/logs/history?before=<db_id>&limit=200`）、:119-140（过滤与 warn/error 计数）、:32-37（时间格式）。
 * DSH 依据：DSH 无日志页；实时尾部写法照抄 `v2/data/activity.ts:93-119`（EventSource + 去重 + 定长窗口），
 *   按「主区整页」扩展（总表 §4.1）。
 * 对照表行：P3:G1 P3:G2 P3:G3 P3:G4
 *
 * EventSource 只在本文件创建（总表红线 4：UI 组件不准取数）；组件卸载时本 hook 的
 * 清理函数会 `close()` 连接。历史请求经 `http<T>`（lib/api.ts:126）转发——`api.` 上没有日志方法。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { http, sseUrl } from "@/lib/api";
import type { LogLine } from "@/lib/types";

/** 保留的日志行上限：超出后丢最旧的（卡片 B12）。 */
export const LOGS_MAX_LINES = 2000;
/** 每次「加载更早」请求的历史行数（照旧页 page.tsx:89 的 limit=200）。 */
export const LOGS_HISTORY_PAGE = 200;
/** 日志级别筛选值；`all` 表示不过滤。 */
export type LogLevelFilter = "all" | LogLine["level"];

export type LogsPhase = "loading" | "ready" | "offline";

/** 一个日志行的本地形态：既有行没有 seq 时（DB 历史）用负数序号占位，`key` 用于 React 列表键。 */
export interface LogRow extends LogLine {
  /** 本地唯一键：有 db_id 用 db_id，否则用 seq。 */
  key: string;
}

/** `/logs/history` 的返回体（ARTEX/server/server.go:3013-3051）。 */
interface LogsHistoryPayload {
  items: LogLine[] | null;
  has_more: boolean;
}

export interface LogsState {
  phase: LogsPhase;
  /** 已收到的日志行（实时尾部 + 已加载的历史），最多 LOGS_MAX_LINES 行。 */
  lines: LogRow[];
  error: string | null;
  /** 实时尾部（EventSource）是否已连上。 */
  live: boolean;
  /** 是否还有更早的历史日志。 */
  hasMore: boolean;
  /** 正在加载历史日志。 */
  loadingOlder: boolean;
  /** 加载历史失败的原因（不影响实时尾部）。 */
  historyError: string | null;
  /** 暂停：暂停期间到达的行被丢弃，不进入窗口（照旧页 page.tsx:69 的口径）。 */
  paused: boolean;
  setPaused: (next: boolean) => void;
  /** 清空当前窗口（只清本地视图，不影响后端环形缓冲）。 */
  clear: () => void;
  /** 加载更早的历史日志。 */
  loadOlder: () => void;
  /** 重建实时连接（连接失败后的重试）。 */
  reconnect: () => void;
}

/** 把一行后端日志规整成本地形态。 */
function toRow(line: LogLine): LogRow {
  return { ...line, key: line.db_id ? `db:${line.db_id}` : `seq:${line.seq}` };
}

/** 合并两批日志：按 key 去重，实时尾部的行优先，超上限留最旧的丢弃。 */
function mergeRows(older: LogRow[], current: LogRow[]): LogRow[] {
  const seen = new Set<string>();
  const merged: LogRow[] = [];
  for (const row of [...older, ...current]) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    merged.push(row);
  }
  return merged.length > LOGS_MAX_LINES ? merged.slice(merged.length - LOGS_MAX_LINES) : merged;
}

/** 当前窗口里最小的 db_id，作为「加载更早」的游标（0 表示没有 DB 行）。 */
function minDbId(rows: LogRow[]): number {
  let min = 0;
  for (const row of rows) {
    if (row.db_id && (min === 0 || row.db_id < min)) min = row.db_id;
  }
  return min;
}

/**
 * 订阅系统日志：挂载时连上 SSE 实时尾部，并提供「加载更早」。
 * @returns 阶段、日志行、实时连接状态、历史分页状态与本地动作。
 */
export function useSystemLogs(): LogsState {
  const [phase, setPhase] = useState<LogsPhase>("loading");
  const [lines, setLines] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  // 暂停期间到达的行丢弃；回调里读 ref，避免重新订阅整条流。
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let source: EventSource | null = null;
    setPhase("loading");
    setError(null);
    setLive(false);
    setHasMore(false);
    if (typeof EventSource === "undefined") {
      setError("当前环境不支持 EventSource，无法订阅实时日志。");
      setPhase("offline");
      return;
    }
    try {
      source = new EventSource(sseUrl("/api/logs/stream?since=0"));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("offline");
      return;
    }
    source.onopen = () => {
      if (!alive) return;
      setLive(true);
      setPhase("ready");
    };
    // EventSource 自己会重连，断线只降级实时徽标，不把已有日志清掉。
    source.onerror = () => {
      if (!alive) return;
      setLive(false);
      setPhase((current) => (current === "ready" ? current : "offline"));
      setError((current) => (current === null ? "实时日志连接中断，正在自动重连。" : current));
    };
    source.onmessage = (event: MessageEvent<string>) => {
      if (!alive) return;
      if (pausedRef.current) return;
      let next: LogLine | null = null;
      try {
        next = JSON.parse(event.data) as LogLine;
      } catch {
        next = null;
      }
      if (next === null || typeof next.seq !== "number") return;
      const row = toRow(next);
      setLines((prev) => mergeRows([], [...prev, row]));
      setPhase("ready");
    };
    return () => {
      alive = false;
      source?.close();
    };
  }, [tick]);

  useEffect(() => {
    // 有 DB 行且最小 db_id > 1 才可能存在更早的历史（照旧页 page.tsx:81-83）。
    setHasMore(minDbId(lines) > 1);
  }, [lines]);

  const loadOlder = useCallback((): void => {
    if (loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setHistoryError(null);
    const before = minDbId(lines);
    const params = before > 0 ? `?before=${before}&limit=${LOGS_HISTORY_PAGE}` : `?limit=${LOGS_HISTORY_PAGE}`;
    http<LogsHistoryPayload>(`/logs/history${params}`)
      .then((value) => {
        const items = value.items ?? [];
        setLines((prev) => mergeRows(items.map(toRow), prev));
        setHasMore(value.has_more === true && items.length > 0);
      })
      .catch((reason: unknown) => {
        setHistoryError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      });
  }, [lines]);

  const clear = useCallback((): void => {
    setLines([]);
    setHasMore(false);
  }, []);

  /** 重建 SSE 连接（失败态「重试」）：旧连接由上一轮 effect 清理函数关闭。 */
  const reconnect = useCallback((): void => {
    setTick((n) => n + 1);
  }, []);

  return {
    phase,
    lines,
    error,
    live,
    hasMore,
    loadingOlder,
    historyError,
    paused,
    setPaused,
    clear,
    loadOlder,
    reconnect,
  };
}

/**
 * 按文本 / tag / 级别本地过滤日志（旧页 page.tsx:119-126 的口径：文本与 tag 都做小写子串匹配）。
 * @param rows - 当前窗口的全部行。
 * @param query - 过滤文本；空串表示不过滤。
 * @param level - 级别筛选；`all` 表示不过滤。
 * @returns 过滤后的行（保持原顺序）。
 */
export function filterLogRows(rows: LogRow[], query: string, level: LogLevelFilter): LogRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (level !== "all" && row.level !== level) return false;
    if (needle === "") return true;
    return row.text.toLowerCase().includes(needle) || row.tag.toLowerCase().includes(needle);
  });
}

/**
 * 统计 warn / error 行数与总数（旧页 page.tsx:132-140）。
 * @param rows - 当前窗口的全部行。
 * @returns 总数、warn 数与 error 数。
 */
export function countLogLevels(rows: LogRow[]): { total: number; warn: number; error: number } {
  let warn = 0;
  let error = 0;
  for (const row of rows) {
    if (row.level === "warn") warn++;
    else if (row.level === "error") error++;
  }
  return { total: rows.length, warn, error };
}

/**
 * 把后端时间戳格式化成 `YYYY-MM-DD HH:mm:ss`（旧页 page.tsx:32-37）。
 * @param ts - RFC3339 时间戳。
 * @returns 本地时间文本；非法时间返回空串。
 */
export function formatLogTime(ts: string): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/**
 * 正文里若重复了 `[tag]` 前缀就去掉（旧页 page.tsx:211-214）。
 * @param row - 一行日志。
 * @returns 用于显示的正文。
 */
export function logBody(row: LogRow): string {
  const prefix = `[${row.tag}]`;
  return row.tag !== "" && row.text.startsWith(prefix) ? row.text.slice(prefix.length).trimStart() : row.text;
}

export type { LogLine };
