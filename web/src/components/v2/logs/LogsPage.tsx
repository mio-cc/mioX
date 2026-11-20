"use client";

/**
 * 系统日志页（对照表 P3:G1–P3:G4）：实时尾部、加载更早、文本 / tag 过滤、warn / error 计数、暂停滚动。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/logs/page.tsx:67（SSE 实时尾部）、:90（加载更早的历史日志）、
 *   :151（文本 / tag 过滤输入框与级别按钮）、:182（warn / error 计数）、:169-176（暂停 / 清空）。
 * DSH 依据：DSH 无日志页，按「主区整页」扩展（总表 §4.1）；外壳与工具条几何照抄
 *   `components/v2/workspace/WorkspacePage.tsx:108-198`，开关用 `vendor Switch`，标签用 `vendor Tag`。
 * 主区整页的 body 不带参数、自己通过 `v2/data/` 取数；EventSource 只在 `v2/data/logs.ts` 里创建。
 * 对照表行：P3:G1 P3:G2 P3:G3 P3:G4
 */
import { type ReactNode, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPauseOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  countLogLevels,
  filterLogRows,
  formatLogTime,
  logBody,
  useSystemLogs,
  type LogLevelFilter,
  type LogRow,
} from "@/v2/data/logs";

import css from "./logs.module.css";

/** 级别筛选按钮（照旧页 page.tsx:157 的四档）。 */
const LEVEL_FILTERS: readonly { value: LogLevelFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "info", label: "info" },
  { value: "warn", label: "warn" },
  { value: "error", label: "error" },
];

/** 距离底部多少像素内算「跟随滚动」（照旧页 page.tsx:189 的 40px）。 */
const STICK_THRESHOLD = 40;

/** 级别徽标的色调。 */
function levelTone(level: LogRow["level"]): "quiet" | "warning" | "danger" {
  if (level === "error") return "danger";
  if (level === "warn") return "warning";
  return "quiet";
}

/**
 * 渲染系统日志页。
 * @returns 页头、工具条（过滤 / 级别 / 暂停 / 清空 / 计数）与日志列表。
 */
export function LogsPage(): ReactNode {
  const state = useSystemLogs();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LogLevelFilter>("all");
  const settledQuery = useDebouncedValue(query, 250);

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 用户是否停在底部：停在底部时新行自动滚到末尾，向上翻历史时不打扰。
  const stick = useRef(true);
  // 「加载更早」前的列表高度；插入后按高度差还原视口，避免内容跳动。
  const pendingRestore = useRef<number | null>(null);

  const filtered = useMemo(() => filterLogRows(state.lines, settledQuery, level), [state.lines, settledQuery, level]);
  const counts = useMemo(() => countLogLevels(state.lines), [state.lines]);

  // 暂停期间不滚动（照旧页 page.tsx:128-130）。
  useEffect(() => {
    if (state.paused || !stick.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [filtered, state.paused]);

  // 顶部插入更早的历史后，保持用户正在看的那一行不动。
  useEffect(() => {
    const el = listRef.current;
    if (el === null || pendingRestore.current === null) return;
    const delta = el.scrollHeight - pendingRestore.current;
    pendingRestore.current = null;
    if (delta > 0) el.scrollTop += delta;
  }, [filtered]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }, []);

  const onLoadOlder = useCallback((): void => {
    const el = listRef.current;
    pendingRestore.current = el === null ? null : el.scrollHeight;
    state.loadOlder();
  }, [state]);

  const onClear = useCallback((): void => {
    state.clear();
  }, [state]);

  return (
    <div data-data-page="logs" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>系统日志</h1>
          <p className={css.lead}>后端实时日志流（planner / worker / 数据库 / 流量 …），保留最近 2000 行。</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="系统日志动作" data-logs-toolbar="">
          <Tag tone={state.live ? "success" : "neutral"}>{state.live ? "实时已连接" : "实时未连接"}</Tag>
          {state.live ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={state.reconnect}
              icon={<IconRefreshOutlineRegular size={13} />}
              data-logs-action="reconnect"
            >
              重新连接
            </Button>
          )}
        </div>
      </header>

      <div className={css.filterBar} role="toolbar" aria-label="系统日志筛选" data-logs-filters="">
        <Input
          icon={<IconSearchOutlineRegular size={14} />}
          value={query}
          aria-label="过滤日志文本或 tag"
          placeholder="过滤（文本 / tag）…"
          onChange={(event) => setQuery(event.currentTarget.value)}
          data-logs-filter-input=""
        />
        <div className={css.levelGroup} role="group" aria-label="日志级别">
          {LEVEL_FILTERS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={level === item.value ? "primary" : "outline"}
              aria-pressed={level === item.value}
              onClick={() => setLevel(item.value)}
              data-logs-level={item.value}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className={css.pauseGroup}>
          <Switch
            checked={state.paused}
            onChange={state.setPaused}
            label="暂停滚动"
            title="暂停时不接收新日志，也不自动滚动"
          />
          <span className={css.pauseLabel}>{state.paused ? "已暂停" : "跟随滚动"}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onClear}
          disabled={state.lines.length === 0}
          icon={<IconTrashOutlineRegular size={13} />}
          data-logs-action="clear"
        >
          清空
        </Button>
      </div>

      <div className={css.summary} data-logs-summary="">
        <span className={css.summaryTotal}>{counts.total} 行</span>
        <span className={css.summaryWarn}>{counts.warn} 警告</span>
        <span className={css.summaryError}>{counts.error} 错误</span>
        {filtered.length === counts.total ? null : (
          <span className={css.summaryFiltered}>筛出 {filtered.length} 行</span>
        )}
      </div>

      {state.historyError === null ? null : (
        <p className={css.errorLine} role="alert" data-logs-history-error="">
          加载更早日志失败：{state.historyError}
        </p>
      )}

      {state.phase === "loading" ? (
        <div className={css.state} data-logs-state="loading">
          正在连接实时日志…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-logs-state="offline">
          <span>读取失败：{state.error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={state.reconnect}
            icon={<IconRefreshOutlineRegular size={13} />}
            data-logs-action="retry"
          >
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {state.hasMore ? (
            <div className={css.olderRow}>
              <Button
                size="sm"
                variant="outline"
                disabled={state.loadingOlder}
                onClick={onLoadOlder}
                data-logs-action="load-older"
              >
                {state.loadingOlder ? "加载中…" : "加载更早"}
              </Button>
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <div className={css.empty} data-logs-state="empty">
              <IconPauseOutlineRegular size={20} />
              <span className={css.emptyTitle}>{state.lines.length === 0 ? "暂无日志" : "没有匹配的日志"}</span>
              <span className={css.emptyText}>
                {state.lines.length === 0
                  ? "后端还没有输出日志；有新的日志行时会实时出现在这里。"
                  : "当前文本 / 级别筛选下没有日志，可以清空过滤条件再看。"}
              </span>
            </div>
          ) : (
            <div ref={listRef} className={css.list} onScroll={onScroll} data-logs-rows="">
              {filtered.map((row) => (
                <div key={row.key} className={css.row} data-logs-row={row.key} data-logs-level={row.level}>
                  <span className={css.dot} data-level={row.level} aria-hidden="true" />
                  <span className={css.time}>{formatLogTime(row.ts)}</span>
                  <Tag tone={levelTone(row.level)} className={css.levelTag}>
                    {row.level}
                  </Tag>
                  {row.tag === "" ? null : (
                    <Tag tone="neutral" className={css.tag}>
                      {row.tag}
                    </Tag>
                  )}
                  <span className={css.text}>{logBody(row)}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
