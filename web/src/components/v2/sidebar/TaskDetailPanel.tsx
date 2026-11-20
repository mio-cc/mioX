"use client";

/**
 * 侧栏任务详情面板（P1:A31）。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:1287-1291`（「查看任务详情」
 *   打开 `/function/tasks/detail?id=`）、`:1183-1284`（详情页里的字段：编号、名称、描述、
 *   目标、状态、目标进度、发现分档、在途、创建时间、运行时长、token）。
 * DSH 依据：DSH 无独立任务详情路由，任务详情就是会话视图；按总表 §4「侧栏」扩展成侧栏
 *   内的详情面板（`/v2/shell?page=shell&task=<id>` 深链会选中该任务并打开本面板）。
 * 对照表行：P1:A31。
 *
 * 数据：单个任务用 `api.task`（api.ts:280，经 `v2/data/task-detail.ts` 转发）读权威快照；
 * 拿不到时退回列表里那一行（同一份 `GET /tasks` 数据），并在页面上写明用的是哪个来源。
 * 写操作（重命名 / 置顶）沿用 `v2/data/task-actions.ts` 的已有封装，一对一转发。
 */
import * as React from "react";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconCloseOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { Task } from "@/lib/types";
import { getTaskDetail, type TaskDetailPhase } from "@/v2/data/task-detail";
import { pinTask, renameTask } from "@/v2/data/task-actions";
import {
  findingsBreakdown,
  formatTaskDuration,
  goalsProgressText,
  taskActivityUnix,
  taskDisplayName,
  taskDurationSeconds,
  taskIsPinned,
  taskStatusTone,
  TASK_STATUS_LABEL,
} from "@/v2/data/tasks";
import css from "./TaskDetailPanel.module.css";

/** unix 秒 → 本地时间文案；0 / 缺省返回 `—`。 */
function formatUnix(unix: number | undefined): string {
  if (unix === undefined || unix <= 0) return "—";
  return new Date(unix * 1000).toLocaleString();
}

/** ISO 串 → 本地时间文案；空串返回 `—`。 */
function formatIso(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "—";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

export interface TaskDetailPanelProps {
  /** 要显示的任务 id。 */
  taskId: string;
  /** 列表里那一行（权威快照还没到 / 读失败时的回退来源）。 */
  fallback: Task | null;
  /** 关闭面板。 */
  onClose: () => void;
  /** 写操作成功后让调用方重读列表。 */
  onChanged: () => void;
}

/**
 * 渲染一个任务的详情。
 * @returns 详情面板（含加载 / 失败可重试 / 无数据 / 有数据四态）。
 */
export function TaskDetailPanel({ taskId, fallback, onClose, onChanged }: TaskDetailPanelProps): React.ReactNode {
  const [detail, setDetail] = React.useState<Task | null>(null);
  const [phase, setPhase] = React.useState<TaskDetailPhase>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [writeError, setWriteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    getTaskDetail(taskId)
      .then((value) => {
        if (!alive) return;
        setDetail(value);
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
  }, [taskId, tick]);

  const reload = (): void => setTick((n) => n + 1);
  // 权威快照优先，读不到就用列表行（同一份接口数据），两者都没有就是「无数据」。
  const task = detail ?? fallback;
  const source = detail !== null ? "GET /tasks/{id}" : fallback !== null ? "GET /tasks 列表行" : null;

  if (task === null) {
    return (
      <section className={css.panel} aria-label="任务详情">
        <header className={css.head}>
          <span className={css.title}>任务详情</span>
          <button type="button" className={css.close} aria-label="关闭任务详情" onClick={onClose}>
            <IconCloseOutlineRegular size={12} />
          </button>
        </header>
        {phase === "loading" ? (
          <div className={css.state}>加载中…</div>
        ) : (
          <div className={css.stateError} role="alert">
            读取失败：{error}
            <Button variant="outline" size="sm" onClick={reload}>重试</Button>
          </div>
        )}
      </section>
    );
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const findings = findingsBreakdown(task);
  const pinned = taskIsPinned(task);
  const trimmed = draft.trim();
  const renameBlocked = busy || trimmed === "" || trimmed === (task.name ?? "");

  const openRename = (): void => {
    setWriteError(null);
    setDraft(task.name ?? "");
    setRenaming(true);
  };

  const saveRename = (): void => {
    setBusy(true);
    setWriteError(null);
    renameTask(task.id, trimmed)
      .then(() => {
        setBusy(false);
        setRenaming(false);
        reload();
        onChanged();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setWriteError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const togglePin = (): void => {
    setBusy(true);
    setWriteError(null);
    pinTask(task.id, !pinned)
      .then(() => {
        setBusy(false);
        reload();
        onChanged();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setWriteError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <section className={css.panel} aria-label="任务详情" data-task-detail-id={task.id}>
      <header className={css.head}>
        <span className={css.title}>任务详情</span>
        {source !== null ? <span className={css.source}>{source}</span> : null}
        <button type="button" className={css.close} aria-label="关闭任务详情" onClick={onClose}>
          <IconCloseOutlineRegular size={12} />
        </button>
      </header>

      {phase === "offline" ? (
        <div className={css.stateError} role="alert">
          权威快照读取失败：{error}（下面显示的是列表行里的同一份字段）
          <Button variant="outline" size="sm" onClick={reload}>重试</Button>
        </div>
      ) : null}

      <div className={css.body}>
        <div className={css.row}>
          <span className={css.label}>名称</span>
          <span className={css.value}>
            {taskDisplayName(task)}
            {pinned ? <Tag tone="info" className={css.inlineTag}>已置顶</Tag> : null}
            {task.active === true ? <Tag tone="success" className={css.inlineTag}>活动任务</Tag> : null}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>编号</span>
          <span className={`${css.value} ${css.mono}`}>#{task.id}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>状态</span>
          <span className={css.value}>
            <Tag tone={taskStatusTone(task.status)}>{TASK_STATUS_LABEL[task.status]}</Tag>
            {task.paused === true ? <Tag tone="warning" className={css.inlineTag}>已暂停</Tag> : null}
            {task.queued === true ? <Tag tone="info" className={css.inlineTag}>排队中</Tag> : null}
            {task.stalled === true ? <Tag tone="danger" className={css.inlineTag}>停滞</Tag> : null}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>描述</span>
          <span className={css.value}>{task.description}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>目标</span>
          <span className={css.value}>{task.goal === "" ? "—" : task.goal}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>目标进度</span>
          <span className={css.value}>{goalsProgressText(task)}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>发现</span>
          <span className={css.value}>
            {findings === null
              ? "—"
              : findings.total === 0
                ? "0"
                : `严重 ${findings.critical} · 高 ${findings.high} · 中 ${findings.medium} · 低 ${findings.low}`}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>在途意图</span>
          <span className={css.value}>{task.in_flight !== undefined && task.in_flight > 0 ? task.in_flight : "0"}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>创建时间</span>
          <span className={css.value}>{formatUnix(task.created_unix) === "—" ? formatIso(task.created_at) : formatUnix(task.created_unix)}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>完成时间</span>
          <span className={css.value}>{formatUnix(task.completed_unix) === "—" ? formatIso(task.completed_at) : formatUnix(task.completed_unix)}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>运行时长</span>
          <span className={css.value}>{formatTaskDuration(taskDurationSeconds(task, nowUnix))}</span>
        </div>
        <div className={css.row}>
          <span className={css.label}>最近活动</span>
          <span className={css.value}>
            {formatUnix(taskActivityUnix(task)) === "—" ? "—" : formatUnix(taskActivityUnix(task))}
          </span>
        </div>
        <div className={css.row}>
          <span className={css.label}>Token</span>
          <span className={css.value}>
            {task.tokens === undefined
              ? "—"
              : `入 ${task.tokens.input_tokens} · 缓 ${task.tokens.cache_read_tokens} · 出 ${task.tokens.output_tokens}`}
          </span>
        </div>
        {task.category_name !== undefined && task.category_name !== "" ? (
          <div className={css.row}>
            <span className={css.label}>分类</span>
            <span className={css.value}>{task.category_name}</span>
          </div>
        ) : null}
      </div>

      {writeError !== null ? (
        <div className={css.stateError} role="alert">操作失败：{writeError}</div>
      ) : null}

      <footer className={css.actions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={openRename}>重命名</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={togglePin}>
          {pinned ? "取消置顶" : "置顶"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || phase === "loading"} onClick={reload}>刷新</Button>
      </footer>

      <Modal
        open={renaming}
        onClose={() => { if (!busy) setRenaming(false); }}
        closeLabel="关闭"
        title="重命名任务"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setRenaming(false)}>取消</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={saveRename}>重命名</Button>
          </>
        }
      >
        <input
          className={css.input}
          value={draft}
          aria-label="任务名称"
          autoFocus
          disabled={busy}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !renameBlocked) saveRename();
          }}
        />
      </Modal>
    </section>
  );
}
