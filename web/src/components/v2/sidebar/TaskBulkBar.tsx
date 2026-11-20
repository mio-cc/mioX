"use client";

/**
 * 侧栏多选模式：勾选状态 + 「已选 N 条」工具条 + 批量暂停 / 恢复 / 归档 / 删除 / 改分类。
 * 本文件同时导出 `useTaskMultiSelect`（勾选状态与维护规则）和 `TaskBulkBar`（工具条与三个弹窗）。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:406-451`（多选状态、
 *   跨翻页保留、任务消失后收敛）、`:842-901`（「已选 N 个」工具条与各批量按钮）、
 *   `:547-567`（行内 pause/resume 走单任务接口）、`:689-744`（批量归档 = archiveTasks；
 *   批量暂停/恢复 = controlTasksBatch，上限 100）、`:616-673`（批量删除：逐条 deleteTask 并汇总
 *   成功/失败）、`:2016-2141`（删除选项五个 Checkbox，默认全不勾，另有「全部删除」）、
 *   `:1478-1521`（归档二次确认）、`:2293-2365`（批量删除二次确认 + 实时进度）、
 *   `:2218-2290`（批量改分类的目标选择）、`:247-257`（可暂停 / 可恢复 / 可归档的状态门控）。
 * DSH 依据：DSH 无侧栏多选，按总表 §4「侧栏多选」扩展；弹窗用 `Modal`（`tone="warning"`）、
 *   勾选框用 `Checkbox`、小按钮用 `Button size="sm"`，样式只用 `--dsw-*` 变量。
 * 对照表行：P1:A15（批量归档）、P1:A16（批量选择）、P1:A18（删除选项）、
 *   P1:A20（恢复任务）、P1:A21（批量暂停 / 恢复）。
 *
 * 数据：全部写操作走 `@/v2/data/task-actions.ts` 的一对一转发（api.ts:365 / :368 / :383 / :334），
 * 组件里不出现 `api` / `fetch`（总表红线 4）。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  IconArchiveOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { DeleteTaskOptions, Task, TaskCategory } from "@/lib/types";
import { toast } from "../settings/Toast";
import {
  archiveTasks,
  controlTasksBatch,
  deleteTaskDetails,
  deleteTasksSequentially,
  emptyDeleteTaskOptions,
  listTaskCategories,
  moveTasksCategory,
  taskArchivable,
  taskControlAction,
  type DeleteTaskCounts,
} from "@/v2/data/task-actions";
import css from "./TaskBulkBar.module.css";

/** 一次批量控制 / 改分类的上限：旧页 `page.tsx:712-715`、`:751-754` 都是 100。 */
const BATCH_LIMIT = 100;

/** 删除选项在界面上的顺序、中文名与后果说明（旧页 `page.tsx:2083-2137`）。 */
const DELETE_OPTION_FIELDS: readonly {
  key: keyof DeleteTaskOptions;
  label: string;
  hint: string;
}[] = [
  { key: "delete_assets", label: "关联资产", hint: "删除仅属于这些任务的资产；共享资产只解除任务关联。" },
  { key: "delete_traffic", label: "关联流量", hint: "按关联资产的主机名删除；仍被其他任务引用的共享主机流量会保留。" },
  { key: "delete_files", label: "任务文件", hint: "删除任务工作目录里的上传文件、命令输出和其他产物。" },
  { key: "delete_findings", label: "关联漏洞", hint: "永久删除这些任务产生的独立漏洞记录与漏洞报告。" },
  {
    key: "delete_llm_records",
    label: "LLM 请求/响应记录",
    hint: "永久删除这些任务录制的 LLM 请求、响应、Token 与错误详情。",
  },
];

/** 多选状态：开关 + 已选集合 + 维护规则。 */
export interface TaskMultiSelect {
  /** 多选模式是否打开。 */
  active: boolean;
  /** 打开 / 关闭多选模式；关闭时清空选择。 */
  setActive: (next: boolean) => void;
  /** 已勾选的任务 id。 */
  ids: ReadonlySet<string>;
  /** 勾选 / 取消勾选一个任务。 */
  toggle: (id: string, next: boolean) => void;
  /** 清空选择（工具条上的「取消选择」）。 */
  clear: () => void;
  /** 删除 / 归档成功后把若干 id 从选择里去掉。 */
  forget: (ids: readonly string[]) => void;
}

/**
 * 侧栏任务多选状态。
 *
 * 勾选跨排序 / 折叠保留（旧页 `page.tsx:406-416` 的口径），只在任务真的从 `GET /tasks` 消失
 * （被删或后端不再返回）时自动收敛，避免已不存在的 id 被带进批量请求。
 * @param tasks - 当前任务列表；`null` 表示还没读到（此时不收敛）。
 * @returns 多选状态与操作。
 */
export function useTaskMultiSelect(tasks: readonly Task[] | null): TaskMultiSelect {
  const [active, setActiveState] = React.useState(false);
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const tids = React.useMemo(() => tasks, [tasks]);

  React.useEffect(() => {
    if (tids === null) return;
    setIds((current) => {
      if (current.size === 0) return current;
      const live = new Set(tids.map((task) => task.id));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [tids]);

  const setActive = React.useCallback((next: boolean) => {
    setActiveState(next);
    if (!next) setIds(new Set<string>());
  }, []);

  const toggle = React.useCallback((id: string, next: boolean) => {
    setIds((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);

  const clear = React.useCallback(() => setIds(new Set<string>()), []);

  const forget = React.useCallback((gone: readonly string[]) => {
    setIds((current) => {
      if (gone.length === 0) return current;
      const copy = new Set(current);
      for (const id of gone) copy.delete(id);
      return copy;
    });
  }, []);

  return { active, setActive, ids, toggle, clear, forget };
}

/** 一条操作结果：成功条数 + 失败明细（失败明细原样来自后端）。 */
interface OutcomeLine {
  ok: number;
  failed: { id: string; message: string }[];
}

/** 把失败明细压成一行「#id（原因）#id（原因）…等 N 个」。 */
function failedText(failed: readonly { id: string; message: string }[]): string {
  const head = failed
    .slice(0, 3)
    .map((item) => `#${item.id}（${item.message}）`)
    .join("；");
  return `${failed.length} 个失败：${head}${failed.length > 3 ? " 等" : ""}`;
}

export interface TaskBulkBarProps {
  /** 当前任务列表（已排序的展示顺序；工具条按它挑出选中项）。 */
  tasks: readonly Task[];
  /** 多选状态，来自 `useTaskMultiSelect`。 */
  selection: TaskMultiSelect;
  /** 批量操作成功后让调用方重读任务列表。 */
  onChanged: () => void;
}

/**
 * 「已选 N 条」工具条 + 批量操作弹窗。
 *
 * 五个动作全部落真实接口：
 * - 暂停 / 恢复：`controlTasksBatch`（api.ts:368），只对门控允许的任务发请求；
 * - 归档：`archiveTasks`（api.ts:383），先二次确认（旧页 `:1478-1521`）；
 * - 删除：逐条 `deleteTask`（api.ts:365）+ 五项清理选项 + 二次确认 + 实时进度（旧页 `:616-673`、`:2293-2365`）；
 * - 移动分类：`updateTasksCategory`（api.ts:334）。
 * 四态：列表没数据时工具条不出现（调用方负责空状态）；操作失败时在工具条里留下可读的红色结果行，
 * 不只依赖 toast（独立路由里 toast 不显示）。
 * @returns 工具条；未进入多选模式或没选任何任务时返回 null。
 */
export function TaskBulkBar({ tasks, selection, onChanged }: TaskBulkBarProps): React.ReactNode {
  const { active, ids, clear, forget } = selection;
  const [busyAction, setBusyAction] = React.useState<"pause" | "resume" | "archive" | null>(null);
  const [moveBusy, setMoveBusy] = React.useState(false);
  // 上一次批量操作的结果 / 失败原因；显示在工具条下面，直到下一次操作覆盖。
  const [message, setMessage] = React.useState<OutcomeLine | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);

  const selectedTasks = React.useMemo(() => tasks.filter((task) => ids.has(task.id)), [tasks, ids]);
  const pausableIds = React.useMemo(
    () => selectedTasks.filter((task) => taskControlAction(task.status) === "pause").map((task) => task.id),
    [selectedTasks],
  );
  const resumableIds = React.useMemo(
    () => selectedTasks.filter((task) => taskControlAction(task.status) === "resume").map((task) => task.id),
    [selectedTasks],
  );
  const archivableIds = React.useMemo(
    () => selectedTasks.filter((task) => taskArchivable(task.status, task.queued)).map((task) => task.id),
    [selectedTasks],
  );

  if (!active || ids.size === 0) return null;

  const runControl = (action: "pause" | "resume", target: readonly string[]): void => {
    if (target.length === 0 || busyAction !== null) return;
    if (target.length > BATCH_LIMIT) {
      setErrorText(`一次最多控制 ${BATCH_LIMIT} 个任务（当前 ${target.length} 个）`);
      return;
    }
    setBusyAction(action);
    setErrorText(null);
    controlTasksBatch([...target], action)
      .then((result) => {
        setBusyAction(null);
        const ok = result.items.filter((item) => item.ok);
        const failed = result.items.filter((item) => !item.ok);
        setMessage({ ok: ok.length, failed: failed.map((item) => ({ id: item.id, message: item.error ?? "状态已变化" })) });
        if (ok.length > 0) {
          const queued = ok.some((item) => item.queued === true);
          toast(
            action === "pause"
              ? `已暂停 ${ok.length} 个任务`
              : `已继续 ${ok.length} 个任务${queued ? "，部分任务已进入队列" : ""}`,
          );
        }
        if (failed.length > 0) toast(`${failed.length} 个任务操作失败：${failed[0]?.error ?? "状态已变化"}`);
        onChanged();
      })
      .catch((reason: unknown) => {
        setBusyAction(null);
        setErrorText(`${action === "pause" ? "批量暂停" : "批量恢复"}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const runArchive = (): void => {
    if (archivableIds.length === 0 || busyAction !== null) return;
    setBusyAction("archive");
    setErrorText(null);
    archiveTasks([...archivableIds])
      .then((result) => {
        setBusyAction(null);
        setArchiveOpen(false);
        const ok = result.items.filter((item) => item.ok);
        const failed = result.items.filter((item) => !item.ok);
        setMessage({ ok: ok.length, failed: failed.map((item) => ({ id: item.id, message: item.error ?? "状态已变化" })) });
        if (ok.length > 0) {
          toast(`已将 ${ok.length} 个任务加入归档队列`);
          forget(ok.map((item) => item.id));
        }
        if (failed.length > 0) toast(`${failed.length} 个任务无法归档`);
        onChanged();
      })
      .catch((reason: unknown) => {
        setBusyAction(null);
        setErrorText(`批量归档失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const runMove = (categoryId: number | null): Promise<void> => {
    if (moveBusy) return Promise.resolve();
    const targets = [...ids];
    if (targets.length > BATCH_LIMIT) {
      setErrorText(`一次最多修改 ${BATCH_LIMIT} 个任务的分类（当前 ${targets.length} 个）`);
      return Promise.resolve();
    }
    setMoveBusy(true);
    setErrorText(null);
    return moveTasksCategory(targets, categoryId === null ? undefined : categoryId)
      .then((result) => {
        setMoveBusy(false);
        setMoveOpen(false);
        const ok = result.items.filter((item) => item.ok);
        const failed = result.items.filter((item) => !item.ok);
        setMessage({ ok: ok.length, failed: failed.map((item) => ({ id: item.id, message: item.error ?? "任务已不存在" })) });
        const target = result.category === null ? "未分类" : `「${result.category.name}」`;
        if (ok.length > 0) {
          toast(`已将 ${ok.length} 个任务移动到${target}`);
          forget(ok.map((item) => item.id));
        }
        if (failed.length > 0) toast(`${failed.length} 个任务未能移动`);
        onChanged();
      })
      .catch((reason: unknown) => {
        setMoveBusy(false);
        setErrorText(`修改分类失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const onDeleteDone = (summary: { deleted: string[]; failed: { id: string; message: string }[]; counts: DeleteTaskCounts; warnings: string[] }): void => {
    setDeleteOpen(false);
    setMessage({ ok: summary.deleted.length, failed: summary.failed });
    if (summary.deleted.length > 0) {
      forget(summary.deleted);
      const details = deleteTaskDetails(summary.counts);
      const text = `已删除 ${summary.deleted.length} 个任务${details.length > 0 ? `（${details.join("，")}）` : ""}${
        summary.warnings.length > 0 ? `；部分外部数据清理未完成：${summary.warnings.join("；")}` : ""
      }`;
      toast(text);
    }
    if (summary.failed.length > 0) toast(`${summary.failed.length} 个任务删除失败`);
    onChanged();
  };

  const busy = busyAction !== null || moveBusy;

  return (
    <div className={css.bar} data-task-bulk-bar="" data-task-bulk-count={ids.size}>
      <div className={css.barHead}>
        <span className={css.count}>已选 {ids.size} 条</span>
        <Button variant="ghost" size="sm" className={css.cancel} disabled={busy} onClick={clear}>
          取消选择
        </Button>
      </div>
      <div className={css.actions}>
        {pausableIds.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            icon={<IconPauseOutlineRegular size={12} />}
            disabled={busy}
            data-task-bulk="pause"
            onClick={() => runControl("pause", pausableIds)}
          >
            {busyAction === "pause" ? "暂停中…" : `暂停 ${pausableIds.length}`}
          </Button>
        ) : null}
        {resumableIds.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            icon={<IconPlayOutlineRegular size={12} />}
            disabled={busy}
            data-task-bulk="resume"
            onClick={() => runControl("resume", resumableIds)}
          >
            {busyAction === "resume" ? "恢复中…" : `恢复 ${resumableIds.length}`}
          </Button>
        ) : null}
        {archivableIds.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            icon={<IconArchiveOutlineRegular size={12} />}
            disabled={busy}
            data-task-bulk="archive"
            onClick={() => setArchiveOpen(true)}
          >
            归档 {archivableIds.length}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          data-task-bulk="move"
          onClick={() => {
            setErrorText(null);
            setMoveOpen(true);
          }}
        >
          移动分类
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={<IconTrashOutlineRegular size={12} />}
          className={css.danger}
          disabled={busy}
          data-task-bulk="delete"
          onClick={() => setDeleteOpen(true)}
        >
          删除
        </Button>
      </div>
      {errorText !== null ? (
        <div className={css.stateError} role="alert">
          {errorText}
          <Button variant="ghost" size="sm" onClick={() => setErrorText(null)}>关闭</Button>
        </div>
      ) : null}
      {message !== null ? (
        <div
          className={`${message.failed.length > 0 ? css.stateError : css.stateOk}`}
          role={message.failed.length > 0 ? "alert" : "status"}
          data-task-bulk-result={message.ok}
          data-task-bulk-failed={message.failed.length}
        >
          <span>
            成功 {message.ok} 条
            {message.failed.length > 0 ? `，${failedText(message.failed)}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setMessage(null)}>关闭</Button>
        </div>
      ) : null}

      <Modal
        open={archiveOpen}
        onClose={() => {
          if (busyAction === null) setArchiveOpen(false);
        }}
        closeLabel="关闭"
        tone="warning"
        title={`归档 ${archivableIds.length} 个任务？`}
        description="归档会停止任务调度，把图谱、LLM 历史、文件以及独占资产和流量压缩到本地冷存储；归档后可在「已归档」中还原。运行中或尚未结束的任务必须先暂停。"
        footer={
          <>
            <Button variant="outline" disabled={busyAction !== null} onClick={() => setArchiveOpen(false)}>取消</Button>
            <Button variant="primary" disabled={busyAction !== null} onClick={runArchive}>
              {busyAction === "archive" ? "归档中…" : "确认归档"}
            </Button>
          </>
        }
      >
        <div className={css.subjects}>
          <span className={css.subjectsLabel}>将归档</span>
          <span className={css.subjectsList}>
            {selectedTasks
              .filter((task) => archivableIds.includes(task.id))
              .map((task) => `#${task.id}`)
              .join("、")}
          </span>
        </div>
      </Modal>

      <MoveCategoryDialog
        open={moveOpen}
        count={ids.size}
        busy={moveBusy}
        onClose={() => {
          if (!moveBusy) setMoveOpen(false);
        }}
        onMove={runMove}
      />

      <BulkDeleteDialog
        open={deleteOpen}
        ids={selectedTasks.map((task) => task.id)}
        onClose={() => setDeleteOpen(false)}
        onDone={onDeleteDone}
      />
    </div>
  );
}

/**
 * 批量删除弹窗（P1:A18 的选项在这里出现）。
 *
 * 后端没有批量删除接口，所以确认后逐条 `deleteTask` 串行执行并显示 `已完成/总数`，
 * 结束后由 `onDone` 汇总成功 / 失败条数（旧页 `page.tsx:616-673`、`:2293-2365`）。
 * @returns 二次确认弹窗。
 */
function BulkDeleteDialog({
  open,
  ids,
  onClose,
  onDone,
}: {
  open: boolean;
  ids: readonly string[];
  onClose: () => void;
  onDone: (summary: {
    deleted: string[];
    failed: { id: string; message: string }[];
    counts: DeleteTaskCounts;
    warnings: string[];
  }) => void;
}): React.ReactNode {
  const [options, setOptions] = React.useState<DeleteTaskOptions>(emptyDeleteTaskOptions);
  const [deleting, setDeleting] = React.useState(false);
  const [done, setDone] = React.useState(0);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  // 每次打开都回到「五项全不勾」并清空进度（旧页 `page.tsx:2305-2312`）。
  React.useEffect(() => {
    if (!open) return;
    setOptions(emptyDeleteTaskOptions());
    setDone(0);
    setErrorText(null);
  }, [open]);

  const checkedCount = DELETE_OPTION_FIELDS.filter((field) => options[field.key]).length;

  const run = (): void => {
    if (deleting) return;
    setDeleting(true);
    setDone(0);
    setErrorText(null);
    void deleteTasksSequentially(ids, options, (n) => setDone(n))
      .then((summary) => {
        setDeleting(false);
        onDone(summary);
      })
      .catch((reason: unknown) => {
        // deleteTasksSequentially 自己收每条失败，走到这里说明循环本身异常。
        setDeleting(false);
        setErrorText(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!deleting) onClose();
      }}
      closeLabel="关闭"
      tone="warning"
      title={`确认删除所选 ${ids.length} 个任务？`}
      description="这些任务的执行记录与探索链路会被永久删除；下方清理选项对所选任务统一生效，默认一条都不勾。"
      footer={
        <>
          <Button variant="outline" disabled={deleting} onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={deleting || ids.length === 0} onClick={run} data-task-bulk-delete-confirm="">
            {deleting ? `删除中 ${done}/${ids.length}` : `删除 ${ids.length} 个任务`}
          </Button>
        </>
      }
    >
      <div className={css.subjects}>
        <span className={css.subjectsLabel}>将删除</span>
        <span className={css.subjectsList}>
          {ids.slice(0, 30).map((id) => `#${id}`).join("、")}
          {ids.length > 30 ? ` …等 ${ids.length} 个` : ""}
        </span>
      </div>
      <div className={css.options} role="group" aria-label="同时清理关联数据">
        <div className={css.optionsHead}>
          <span className={css.optionsTitle}>同时清理关联数据</span>
          <span className={css.optionsCount}>{checkedCount === 0 ? "默认全不勾" : `已勾 ${checkedCount} 项`}</span>
        </div>
        <Checkbox
          checked={checkedCount === DELETE_OPTION_FIELDS.length}
          disabled={deleting}
          label="全部删除（勾选下面五项）"
          onChange={(next) => {
            setOptions({
              delete_assets: next,
              delete_traffic: next,
              delete_files: next,
              delete_findings: next,
              delete_llm_records: next,
            });
          }}
        />
        {DELETE_OPTION_FIELDS.map((field) => (
          <div className={css.option} key={field.key} data-task-delete-option={field.key}>
            <Checkbox
              checked={options[field.key]}
              disabled={deleting}
              label={field.label}
              onChange={(next) => setOptions((current) => ({ ...current, [field.key]: next }))}
            />
            <span className={css.optionHint}>{field.hint}</span>
          </div>
        ))}
      </div>
      {errorText !== null ? (
        <div className={css.stateError} role="alert">删除失败：{errorText}</div>
      ) : null}
    </Modal>
  );
}

/**
 * 批量改分类弹窗：候选分类来自 `GET /task-categories`（打开时才读），
 * 目标分类统一生效；「未分类」表示移出分类（旧页 `page.tsx:2218-2290`）。
 * @returns 目标分类选择弹窗，四态齐全（加载 / 失败可重试 / 没有分类 / 有分类）。
 */
function MoveCategoryDialog({
  open,
  count,
  busy,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onClose: () => void;
  onMove: (categoryId: number | null) => Promise<void>;
}): React.ReactNode {
  const [phase, setPhase] = React.useState<"loading" | "ready" | "offline">("loading");
  const [categories, setCategories] = React.useState<TaskCategory[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const [target, setTarget] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    void listTaskCategories().then((snapshot) => {
      if (!alive) return;
      setCategories(snapshot.categories);
      setError(snapshot.error);
      setPhase(snapshot.phase);
    });
    return () => {
      alive = false;
    };
  }, [open, tick]);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeLabel="关闭"
      title={`修改所选 ${count} 个任务的分类`}
      description="目标分类对所选任务统一生效；选「未分类」会把它们移出当前分类。"
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={busy || phase !== "ready"}
            onClick={() => {
              void onMove(target);
            }}
          >
            {busy ? "移动中…" : "移动"}
          </Button>
        </>
      }
    >
      {phase === "loading" ? (
        <div className={css.state}>加载分类…</div>
      ) : phase === "offline" ? (
        <div className={css.stateError} role="alert">
          读取分类失败：{error}
          <Button variant="outline" size="sm" onClick={() => setTick((n) => n + 1)}>重试</Button>
        </div>
      ) : (
        <div className={css.options} role="radiogroup" aria-label="目标分类">
          <label className={css.radioRow}>
            <input
              type="radio"
              name="bulk-category"
              checked={target === null}
              disabled={busy}
              onChange={() => setTarget(null)}
            />
            <span>未分类（移出当前分类）</span>
          </label>
          {categories.length === 0 ? (
            <div className={css.state}>暂无分类：可以只选「未分类」，或用分类管理新建分类后再移动。</div>
          ) : (
            categories.map((category) => (
              <label className={css.radioRow} key={category.id}>
                <input
                  type="radio"
                  name="bulk-category"
                  checked={target === category.id}
                  disabled={busy}
                  onChange={() => setTarget(category.id)}
                />
                <span>{category.name}</span>
                <span className={css.optionsCount}>{category.task_count}</span>
              </label>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
