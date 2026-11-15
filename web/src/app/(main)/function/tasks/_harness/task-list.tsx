"use client";

import * as React from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Archive,
  RotateCcw,
  Trash2,
  ChevronDown,
  Inbox,
  Loader2,
  Pause,
  Pin,
  Play,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import type { Task, TaskArchive, TaskCategory, TaskStatus } from "@/lib/types";

import styles from "./task-list.module.css";

const POLL_MS = 8000;
const PAGE_SIZE = 20;

type StatusFilter = TaskStatus | "all";

const STATUS_LABEL: Record<string, string> = {
  created: "待开始",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  timeout: "超时",
  paused: "已暂停",
  queued: "排队中",
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "running", label: "运行中" },
  { value: "created", label: "待开始" },
  { value: "done", label: "已完成" },
  { value: "paused", label: "已暂停" },
  { value: "failed", label: "失败" },
  { value: "timeout", label: "超时" },
];

type SortKey = "updated" | "created" | "id";
const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "updated", label: "最近活动" },
  { value: "created", label: "创建时间" },
  { value: "id", label: "ID" },
];

/** Minimal single-select popover: no native <select>, keyboard reachable. */
function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ value: T; label: string }>;
  readonly onChange: (next: T) => void;
  readonly testId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  React.useEffect(() => {
    if (!open) return;
    setCursor(Math.max(0, options.findIndex((option) => option.value === value)));
    const frame = window.requestAnimationFrame(() => listRef.current?.focus());
    const onDocDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDocDown);
    };
  }, [open, options, value]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        type="button"
        className={styles.pickerTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
      >
        <span className={styles.pickerValue}>{current.label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={listRef}
          className={styles.pickerMenu}
          role="listbox"
          tabIndex={0}
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((i) => Math.min(options.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              commit(cursor);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              className={styles.pickerOption}
              data-active={index === cursor ? "true" : "false"}
              onMouseEnter={() => setCursor(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function statusTone(task: Task): string {
  if (task.paused) return styles.tonePaused;
  switch (task.status) {
    case "running":
      return styles.toneRunning;
    case "done":
      return styles.toneDone;
    case "failed":
    case "timeout":
      return styles.toneError;
    default:
      return styles.toneIdle;
  }
}

function statusText(task: Task): string {
  if (task.paused) return "已暂停";
  return STATUS_LABEL[task.status] ?? task.status;
}

function displayName(task: Task): string {
  return task.name?.trim() || task.description?.trim() || `任务 #${task.id}`;
}

function relativeTime(unix: number): string {
  if (!unix) return "—";
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function HarnessTaskList() {
  const router = useRouter();
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [categories, setCategories] = React.useState<TaskCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [category, setCategory] = React.useState("all");
  const [sort, setSort] = React.useState<SortKey>("updated");
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState<string>("");

  // 会话记录管理：当前 / 已归档。归档是"移出列表但可恢复"，所以它必须有独立视图，
  // 否则归档完就再也找不到了。
  const [view, setView] = React.useState<"active" | "archived">("active");
  const [archives, setArchives] = React.useState<TaskArchive[]>([]);
  const [archivesLoading, setArchivesLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([
        api.tasks(),
        api.taskCategories().catch(() => [] as TaskCategory[]),
      ]);
      setTasks(list.tasks);
      setCategories(cats);
      setError("");
    } catch (err) {
      setError((err as Error).message || "任务列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const categoryOptions = React.useMemo(
    () => [
      { value: "all", label: "全部分类" },
      { value: "none", label: "未分类" },
      ...categories.map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [categories],
  );

  // 归档视图的数据源与动作：列表走 /task-archives，恢复后回到当前列表。
  const loadArchives = React.useCallback(async () => {
    setArchivesLoading(true);
    try {
      const result = await api.taskArchives({ page: 1, size: 100, q: query.trim() });
      setArchives(result.items);
    } catch (err) {
      toast.error((err as Error).message || "加载归档失败");
    } finally {
      setArchivesLoading(false);
    }
  }, [query]);

  React.useEffect(() => {
    if (view === "archived") void loadArchives();
  }, [view, loadArchives]);

  const restoreArchive = async (item: TaskArchive) => {
    if (busy) return;
    setBusy(`archive-${item.id}`);
    try {
      await api.restoreTaskArchive(item.id);
      toast.success("已恢复，任务会回到当前列表");
      await loadArchives();
      await load();
    } catch (err) {
      toast.error((err as Error).message || "恢复失败");
    } finally {
      setBusy("");
    }
  };

  const purgeArchive = async (item: TaskArchive) => {
    if (busy) return;
    // 永久删除不可恢复，必须二次确认。
    if (!window.confirm(`永久删除归档「${item.task_name || item.task_id}」？归档包与关联快照都会被删除，无法恢复。`)) return;
    setBusy(`archive-${item.id}`);
    try {
      await api.deleteTaskArchive(item.id);
      toast.success("已永久删除");
      await loadArchives();
    } catch (err) {
      toast.error((err as Error).message || "删除失败");
    } finally {
      setBusy("");
    }
  };

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (status !== "all" && task.status !== status) return false;
        if (category === "none" && task.category_id != null) return false;
        if (category !== "all" && category !== "none" && String(task.category_id ?? "") !== category) return false;
        if (!needle) return true;
        return [task.id, task.name, task.description, task.goal]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        if (sort === "id") return Number(b.id) - Number(a.id);
        if (sort === "created") return (b.created_unix ?? 0) - (a.created_unix ?? 0);
        return (b.last_activity_unix ?? b.created_unix ?? 0) - (a.last_activity_unix ?? a.created_unix ?? 0);
      });
  }, [tasks, query, status, category, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  React.useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const togglePause = async (task: Task) => {
    if (busy) return;
    setBusy(task.id);
    try {
      await api.controlTask(task.id, task.paused ? "resume" : "pause");
      toast.success(task.paused ? "已恢复" : "已暂停");
      await load();
    } catch (err) {
      toast.error((err as Error).message || "操作失败");
    } finally {
      setBusy("");
    }
  };

  const archive = async (task: Task) => {
    if (busy) return;
    setBusy(task.id);
    try {
      await api.archiveTask(task.id);
      toast.success("已加入归档队列");
      await load();
    } catch (err) {
      toast.error((err as Error).message || "归档失败");
    } finally {
      setBusy("");
    }
  };

  const togglePin = async (task: Task) => {
    if (busy) return;
    setBusy(task.id);
    try {
      await api.pinTask(task.id, !task.pinned);
      await load();
    } catch (err) {
      toast.error((err as Error).message || "置顶失败");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={styles.root} data-testid="harness-task-list">
      <header className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title}>任务</h1>
          <span className={styles.count}>{filtered.length} / {tasks.length}</span>
        </div>
        <div className={styles.headActions}>
          <button type="button" className={styles.refresh} onClick={() => void load()} aria-label="刷新" title="刷新">
            <RotateCw size={14} aria-hidden="true" />
          </button>
          <Link href="/function/tasks/new" className={styles.primary}>
            <Plus size={14} aria-hidden="true" />
            新建任务
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={14} className={styles.searchIcon} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、描述、目标或 ID"
            aria-label="搜索任务"
            data-testid="task-search"
          />
          {query ? (
            <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="清空搜索">
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <Picker label="状态筛选" value={status} options={STATUS_OPTIONS} onChange={setStatus} testId="task-status-filter" />
        <Picker label="分类筛选" value={category} options={categoryOptions} onChange={setCategory} testId="task-category-filter" />
        <Picker label="排序" value={sort} options={SORT_OPTIONS} onChange={setSort} testId="task-sort" />
        <div className={styles.viewSwitch} role="group" aria-label="当前 / 已归档">
          <button
            type="button"
            className={styles.viewTab}
            data-active={view === "active" || undefined}
            data-testid="tasks-view-active"
            onClick={() => setView("active")}
          >
            当前
          </button>
          <button
            type="button"
            className={styles.viewTab}
            data-active={view === "archived" || undefined}
            data-testid="tasks-view-archived"
            onClick={() => setView("archived")}
          >
            已归档
          </button>
        </div>
      </div>

      <div className={styles.listWrap}>
        {view === "archived" ? (
          archivesLoading ? (
            <div className={styles.state}><Loader2 size={16} className={styles.spin} aria-hidden="true" /> 加载归档…</div>
          ) : archives.length === 0 ? (
            <div className={styles.empty} data-testid="archives-empty">
              <span className={styles.emptyIcon}><Archive size={18} strokeWidth={1.7} aria-hidden="true" /></span>
              <span className={styles.emptyTitle}>还没有归档</span>
              <span className={styles.emptyText}>在当前列表里归档任务后，会出现在这里，可随时恢复。</span>
            </div>
          ) : (
            <ul className={styles.list} data-testid="archive-rows">
              {archives.map((item) => (
                <li key={item.id} className={styles.row} data-archive-id={item.id}>
                  <span className={`${styles.dot} ${styles.dotDone}`} aria-hidden="true" />
                  <span className={styles.rowMain}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowName}>{item.task_name || item.task_id}</span>
                      <span className={styles.rowStatus}>已归档</span>
                    </span>
                    <span className={styles.rowMeta}>归档于 {new Date(item.created_at).toLocaleString()}</span>
                  </span>
                  <span className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.rowAction}
                      title="恢复到当前列表"
                      data-testid="archive-restore"
                      disabled={busy === `archive-${item.id}`}
                      onClick={() => void restoreArchive(item)}
                    >
                      <RotateCcw size={12} aria-hidden="true" /> 恢复
                    </button>
                    <button
                      type="button"
                      className={styles.rowAction}
                      title="永久删除（不可恢复）"
                      data-testid="archive-purge"
                      disabled={busy === `archive-${item.id}`}
                      onClick={() => void purgeArchive(item)}
                    >
                      <Trash2 size={12} aria-hidden="true" /> 永久删除
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
        {view === "active" ? (
          <>
        {loading ? (
          <div className={styles.state}><Loader2 size={16} className={styles.spin} aria-hidden="true" /> 加载中…</div>
        ) : error ? (
          <div className={styles.stateError}>
            {error}
            <button type="button" className={styles.retry} onClick={() => void load()}>重试</button>
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Inbox size={18} strokeWidth={1.7} aria-hidden="true" /></span>
            <span className={styles.emptyTitle}>{tasks.length === 0 ? "还没有任务" : "没有匹配的任务"}</span>
            <span className={styles.emptyText}>
              {tasks.length === 0 ? "新建一个任务，描述目标与范围即可开始。" : "换个关键词或清除筛选试试。"}
            </span>
            {tasks.length === 0 ? (
              <Link href="/function/tasks/new" className={styles.primary}>
                <Plus size={14} aria-hidden="true" /> 新建任务
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className={styles.list} data-testid="task-rows">
            {rows.map((task) => {
              const goalsTotal = task.goals_total ?? 0;
              const goalsMet = task.goals_met ?? 0;
              const pct = goalsTotal > 0 ? Math.round((goalsMet / goalsTotal) * 100) : 0;
              const findings =
                (task.findings?.critical ?? 0) + (task.findings?.high ?? 0) + (task.findings?.medium ?? 0) + (task.findings?.low ?? 0);
              return (
                <li key={task.id} className={styles.row} data-task-id={task.id}>
                  <Link href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`} className={styles.rowLink}>
                    <span className={`${styles.dot} ${statusTone(task)}`} aria-hidden="true" />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTop}>
                        <span className={styles.rowName}>{displayName(task)}</span>
                        {task.pinned ? <Pin size={11} className={styles.pinIcon} aria-label="已置顶" /> : null}
                        <span className={styles.rowStatus}>{statusText(task)}</span>
                      </span>
                      <span className={styles.rowSub}>{task.goal?.trim() || task.description?.trim() || "—"}</span>
                    </span>
                    <span className={styles.rowMetrics}>
                      <span className={styles.metric} title="目标进度">
                        {goalsMet}/{goalsTotal}
                      </span>
                      <span className={styles.metric} title="发现数">
                        {findings} 发现
                      </span>
                      <span className={styles.metric} title="最近活动">
                        {relativeTime(task.last_activity_unix ?? task.created_unix ?? 0)}
                      </span>
                    </span>
                    <span className={styles.rowProgress} aria-hidden="true">
                      <span className={styles.rowProgressBar} style={{ width: `${pct}%` }} />
                    </span>
                  </Link>
                  <span className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void togglePause(task)}
                      disabled={busy === task.id}
                      title={task.paused ? "恢复" : "暂停"}
                      aria-label={task.paused ? "恢复任务" : "暂停任务"}
                      data-action="toggle-pause"
                    >
                      {task.paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void togglePin(task)}
                      disabled={busy === task.id}
                      title={task.pinned ? "取消置顶" : "置顶"}
                      aria-label={task.pinned ? "取消置顶" : "置顶任务"}
                      data-action="toggle-pin"
                    >
                      <Pin size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => void archive(task)}
                      disabled={busy === task.id}
                      title="归档"
                      aria-label="归档任务"
                      data-action="archive"
                    >
                      <Archive size={13} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
          </>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <footer className={styles.footer}>
          <span className={styles.footerInfo}>
            第 {safePage} / {pageCount} 页 · 共 {filtered.length} 条
          </span>
          <span className={styles.footerActions}>
            <button type="button" className={styles.pageBtn} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              上一页
            </button>
            <button type="button" className={styles.pageBtn} disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
              下一页
            </button>
          </span>
        </footer>
      ) : null}
    </div>
  );
}
