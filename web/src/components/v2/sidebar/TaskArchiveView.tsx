"use client";

/**
 * 侧栏归档箱（C12）：分页 + 搜索 + 处理状态筛选，行上还原 / 永久删除 / 重试，勾选后批量还原 /
 * 批量永久删除。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:1651-1789`（`TaskArchivesPanel`：
 *   搜索框 `:1795-1806`、状态筛选 `:1807-1832`、总数 `:1833`、勾选工具条 `:1834-1856`、
 *   加载 / 空 / 表格三态 `:1858-1868`、行 `:1893-1997`、分页 `:2005-2008`）、
 *   `:1603-1649`（`ArchiveDeleteDialog`：「永久删除 N 个任务归档？」+ 归档包大小 + 数据量快照，
 *   不可恢复）、`:1724-1751`（还原：单条走 `restoreTaskArchive`，多条走 `restoreTaskArchives`，
 *   按 `ArchiveBatchItem` 汇总）、`:1753-1777`（永久删除：单条 `deleteTaskArchive` / 多条
 *   `deleteTaskArchives`）、`:1779-1789`（失败重试：归档失败重发 `archiveTask(task_id)`），
 *   切换入口 `:783-788`（「当前任务 / 已归档」两个页签）。
 * DSH 依据：DSH 没有归档箱，也没有分页组件（`项目解析/dsh-upstream/packages/client/ui-primitives`），
 *   按总表 §4「侧栏」扩展；切换用 `SegmentedControl`（`DashboardCharts.tsx:426` 的用法）、
 *   行用 `Tag`、危险操作用 `Modal tone="warning"`（总表 §5.5）、搜索框用 `Input` + 250ms 防抖、
 *   状态筛选用 `SelectMenu`。样式只用 `--dsw-*` 变量。
 * 对照表行：P1:A2、P1:A22、P1:A23、P1:A24、P1:A25。
 *
 * 数据：全部经 `@/v2/data/task-archives.ts`（组件里不出现 `api` / `fetch`，总表红线 4）。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconArchiveOffOutlineRegular,
  IconArchiveOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  IconUnarchiveOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { TaskArchive } from "@/lib/types";
import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { toast } from "../settings/Toast";
import {
  ARCHIVE_PAGE_SIZE,
  ARCHIVE_SEARCH_DEBOUNCE_MS,
  ARCHIVE_STATE_LABEL,
  ARCHIVE_STATE_OPTIONS,
  archiveCompressionLabel,
  archiveDataTotal,
  archiveDate,
  archiveDeletable,
  archiveProcessing,
  archiveRestorable,
  archiveRetryable,
  archiveSelectable,
  archiveStateTone,
  archiveTaskAgain,
  archiveTitle,
  deleteTaskArchive,
  deleteTaskArchives,
  formatArchiveBytes,
  parseArchiveStateFilter,
  restoreTaskArchive,
  restoreTaskArchives,
  summarizeArchiveBatch,
  taskArchiveStatus,
  useTaskArchives,
  type ArchiveBatchSummary,
  type ArchiveFailure,
} from "@/v2/data/task-archives";
import css from "./ArchiveBin.module.css";

/** 侧栏的两个视图：当前任务 / 已归档（旧页 page.tsx:783-788 的两个页签）。 */
export type TaskListView = "current" | "archived";

/** 「当前 / 已归档」切换的分段选项。 */
const VIEW_OPTIONS: readonly { value: TaskListView; label: string }[] = [
  { value: "current", label: "当前" },
  { value: "archived", label: "已归档" },
];

/** 失败明细压成一行（最多列 3 条，其余只给条数）。 */
function failedText(failed: readonly ArchiveFailure[]): string {
  const head = failed
    .slice(0, 3)
    .map((item) => `#${item.id}（${item.message}）`)
    .join("；");
  return `${failed.length} 个失败：${head}${failed.length > 3 ? " 等" : ""}`;
}

export interface TaskListSwitchProps {
  /** 当前视图。 */
  value: TaskListView;
  /** 切换视图（纯本地状态，由调用方持有）。 */
  onChange: (next: TaskListView) => void;
  /** 写入进行中时锁住切换，避免把正在跑的动作留在看不见的视图里。 */
  disabled?: boolean;
}

/**
 * 「当前 / 已归档」视图切换（P1:A2）。
 *
 * 独立导出是因为 `/v2/shell` 的接线由主脑统一做：Shell 只需持有 `TaskListView` 并在
 * `archived` 时渲染 `TaskArchiveView`（两者都在本文件里）。
 * @param props.value - 当前视图。
 * @param props.onChange - 切换回调。
 * @param props.disabled - 是否锁住。
 * @returns 分段控件。
 */
export function TaskListSwitch({ value, onChange, disabled = false }: TaskListSwitchProps): React.ReactNode {
  return (
    <div className={css.switchBar} data-task-list-view={value}>
      <SegmentedControl<TaskListView>
        id="task-list-view"
        label="任务列表视图"
        value={value}
        options={VIEW_OPTIONS}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

export interface TaskArchiveViewProps {
  /** 列表被外部改动后（还原 / 删除让任务重新出现在「当前」里）通知调用方重读任务列表。 */
  onChanged?: () => void;
}

/**
 * 渲染侧栏归档箱。
 * @param props.onChanged - 还原 / 删除成功后重读当前任务列表。
 * @returns 工具条（搜索 + 状态筛选 + 总数 + 刷新）、勾选工具条、列表、分页与两个弹窗。
 */
export function TaskArchiveView({ onChanged }: TaskArchiveViewProps): React.ReactNode {
  const [queryDraft, setQueryDraft] = React.useState("");
  const search = useDebouncedValue(queryDraft.trim(), ARCHIVE_SEARCH_DEBOUNCE_MS);
  const [stateFilter, setStateFilter] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);

  // 搜索词或筛选项变化后回第 1 页（旧页 page.tsx:1799-1802、:1809-1812）。
  const appliedState = parseArchiveStateFilter(stateFilter);
  const filterKey = `${search}\u0000${stateFilter}`;
  const lastFilterKey = React.useRef(filterKey);
  React.useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);

  const list = useTaskArchives({ open: true, page, search, state: appliedState });
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(() => new Set<number>());
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [batch, setBatch] = React.useState<ArchiveBatchSummary | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = React.useState<TaskArchive[] | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // W-4：还原完成探测。还原是后端异步队列（行先进 restore_queued/restoring），跑完后
  // 归档出列、任务回「当前」视图；`GET /task-archives/{id}` 的 404「归档不存在」在旧页
  // 语义里（page.tsx:1672-1690）就是完成信号。轮询只跟 pending 的 id，空集不排定时器，
  // 上限 10 分钟防呆（超过就停探测，列表行还在，用户手动刷新也能看到终态）。
  const [pendingRestore, setPendingRestore] = React.useState<ReadonlySet<number>>(() => new Set<number>());
  const restoreProbeStart = React.useRef(0);

  const trackRestore = (ids: readonly number[]): void => {
    if (ids.length === 0) return;
    setPendingRestore((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  };

  React.useEffect(() => {
    if (pendingRestore.size === 0) return;
    if (restoreProbeStart.current === 0) restoreProbeStart.current = Date.now();
    if (Date.now() - restoreProbeStart.current > 10 * 60 * 1000) {
      restoreProbeStart.current = 0;
      setPendingRestore(new Set<number>());
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      const ids = [...pendingRestore];
      void Promise.allSettled(ids.map((id) => taskArchiveStatus(id))).then((results) => {
        if (!alive) return;
        const done = new Set<number>();
        for (let index = 0; index < ids.length; index += 1) {
          const result = results[index];
          if (result.status === "fulfilled" && result.value === null) done.add(ids[index]);
        }
        if (done.size === 0) return;
        setPendingRestore((current) => {
          const next = new Set([...current].filter((id) => !done.has(id)));
          if (next.size === 0) restoreProbeStart.current = 0;
          return next;
        });
        list.reload();
        onChanged?.();
        toast(`${done.size} 个归档已完成还原，任务回到「当前」列表`);
      });
    }, 2000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // pendingRestore 逐轮收敛：done 后集合变小，effect 重排下一轮；空集自然停表。
  }, [pendingRestore, list, onChanged]);

  const pageCount = Math.max(1, Math.ceil(list.total / ARCHIVE_PAGE_SIZE));

  // 当前页变了就把已选收敛到这一页里还存在的行（旧页 page.tsx:1672-1675 同口径）。
  const items = list.items;
  const itemIdsKey = items.map((item) => item.id).join(",");
  React.useEffect(() => {
    const visible = new Set(itemIdsKey === "" ? [] : itemIdsKey.split(",").map(Number));
    setSelected((current) => {
      if (current.size === 0) return current;
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [itemIdsKey]);

  // 删掉最后一页的最后一条之后，总页数会缩水，自动退回上一页。
  React.useEffect(() => {
    if (list.phase !== "ready") return;
    if (page > 1 && page > pageCount) setPage(pageCount);
  }, [list.phase, page, pageCount]);

  const selectable = React.useMemo(() => items.filter((item) => archiveSelectable(item.state)), [items]);
  const selectedRows = React.useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const restorableRows = selectedRows.filter((item) => archiveRestorable(item.state));
  const deletableRows = selectedRows.filter((item) => archiveDeletable(item.state));
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));

  const toggleRow = (id: number, next: boolean): void => {
    setSelected((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  };

  /** 一批动作完成后的统一收尾：清空选择、重读归档箱与任务列表。 */
  const afterWrite = (summary: ArchiveBatchSummary): void => {
    setSelected(new Set());
    setBatch(summary);
    list.reload();
    onChanged?.();
  };

  /** 单条还原（P1:A23）：旧页对单条走 `restoreTaskArchive`（page.tsx:1728-1737）。 */
  const restoreOne = (row: TaskArchive): void => {
    if (busyId !== null || !archiveRestorable(row.state)) return;
    setBusyId(row.id);
    setErrorText(null);
    restoreTaskArchive(row.id)
      .then(() => {
        setBusyId(null);
        toast(`已将任务「${archiveTitle(row)}」加入还原队列`);
        afterWrite({ ok: [row.id], failed: [] });
        trackRestore([row.id]);
      })
      .catch((reason: unknown) => {
        setBusyId(null);
        setErrorText(`还原失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  /** 失败重试（P1:A25）：按失败类型重发归档 / 还原 / 删除（旧页 page.tsx:1779-1789）。 */
  const retryOne = (row: TaskArchive): void => {
    if (busyId !== null || !archiveRetryable(row.state)) return;
    setBusyId(row.id);
    setErrorText(null);
    const request =
      row.state === "archive_failed"
        ? archiveTaskAgain(String(row.task_id))
        : row.state === "restore_failed"
          ? restoreTaskArchive(row.id)
          : deleteTaskArchive(row.id);
    request
      .then(() => {
        setBusyId(null);
        toast("已重新加入处理队列");
        afterWrite({ ok: [row.id], failed: [] });
        if (row.state === "restore_failed") trackRestore([row.id]);
      })
      .catch((reason: unknown) => {
        setBusyId(null);
        setErrorText(`重试失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  /** 批量还原（P1:A23）：勾选行里可还原的走批量接口（api.ts:386）。 */
  const restoreSelected = (): void => {
    if (busyId !== null || restorableRows.length === 0) return;
    const ids = restorableRows.map((item) => item.id);
    setBusyId(-1);
    setErrorText(null);
    const request =
      ids.length === 1
        ? restoreTaskArchive(ids[0]).then(() => summarizeArchiveBatch([{ id: String(ids[0]), ok: true, queued: true, archive_id: ids[0] }]))
        : restoreTaskArchives(ids).then((value) => summarizeArchiveBatch(value.items));
    request
      .then((summary) => {
        setBusyId(null);
        if (summary.ok.length > 0) toast(`已将 ${summary.ok.length} 个任务加入还原队列`);
        if (summary.failed.length > 0) toast(`${summary.failed.length} 个任务无法还原`);
        afterWrite(summary);
        trackRestore(summary.ok);
      })
      .catch((reason: unknown) => {
        setBusyId(null);
        setErrorText(`还原失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  /** 批量永久删除（P1:A24）：确认后调用（单条走单条接口，多条走批量接口）。 */
  const deleteConfirmed = (targets: readonly TaskArchive[]): void => {
    if (deleting || targets.length === 0) return;
    const ids = targets.map((item) => item.id);
    setDeleting(true);
    setErrorText(null);
    const request =
      ids.length === 1
        ? deleteTaskArchive(ids[0]).then(() => summarizeArchiveBatch([{ id: String(ids[0]), ok: true, queued: true, archive_id: ids[0] }]))
        : deleteTaskArchives(ids).then((value) => summarizeArchiveBatch(value.items));
    request
      .then((summary) => {
        setDeleting(false);
        setDeleteTargets(null);
        if (summary.ok.length > 0) toast(`已将 ${summary.ok.length} 个归档加入永久删除队列`);
        if (summary.failed.length > 0) toast(`${summary.failed.length} 个归档无法删除`);
        afterWrite(summary);
      })
      .catch((reason: unknown) => {
        setDeleting(false);
        setErrorText(`永久删除失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const busy = busyId !== null || deleting;
  const deleteRows = deleteTargets ?? [];
  const deleteBytes = deleteRows.reduce((sum, item) => sum + item.compressed_size, 0);
  const deleteRowsCount = deleteRows.reduce((sum, item) => sum + archiveDataTotal(item), 0);

  return (
    <div className={css.wrap} data-task-archive-view="">
      <div className={css.toolbar}>
        <Input
          className={css.searchField}
          icon={<IconSearchOutlineRegular size={13} />}
          value={queryDraft}
          aria-label="搜索归档任务"
          placeholder="搜索任务名称 / 描述 / ID"
          onChange={(event) => setQueryDraft(event.currentTarget.value)}
          data-task-archive-search=""
        />
        <SelectMenu
          value={stateFilter}
          options={ARCHIVE_STATE_OPTIONS}
          ariaLabel="按处理状态筛选归档"
          disabled={busy}
          onChange={setStateFilter}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={list.phase === "loading"}
          title="重新读取归档列表"
          onClick={list.reload}
          icon={<IconRefreshOutlineRegular size={12} />}
          data-task-archive-action="reload"
        >
          刷新
        </Button>
      </div>

      <div className={css.metaRow}>
        <span className={css.count} data-task-archive-total="">
          {list.phase === "ready" ? `${list.total} 个归档` : list.phase === "loading" ? "读取中…" : "读取失败"}
        </span>
        {list.phase === "ready" && list.total > 0 ? (
          <Checkbox
            checked={allSelected}
            disabled={busy || selectable.length === 0}
            label={allSelected ? "取消全选本页" : "全选本页"}
            onChange={(next) => {
              setSelected(next ? new Set(selectable.map((item) => item.id)) : new Set<number>());
            }}
          />
        ) : null}
      </div>

      {selectedRows.length > 0 ? (
        <div className={css.selBar} data-task-archive-selected={selectedRows.length}>
          <span className={css.selCount}>已选 {selectedRows.length} 个</span>
          {restorableRows.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              icon={<IconUnarchiveOutlineRegular size={12} />}
              onClick={restoreSelected}
              data-task-archive-action="restore-batch"
            >
              {busyId === -1 ? "还原中…" : `还原 ${restorableRows.length}`}
            </Button>
          ) : null}
          {deletableRows.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className={css.danger}
              disabled={busy}
              icon={<IconTrashOutlineRegular size={12} />}
              onClick={() => setDeleteTargets(deletableRows)}
              data-task-archive-action="delete-batch"
            >
              永久删除 {deletableRows.length}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set<number>())}>
            取消选择
          </Button>
        </div>
      ) : null}

      {errorText === null ? null : (
        <div className={css.stateError} role="alert" data-task-archive-error="">
          <span>{errorText}</span>
          <Button variant="ghost" size="sm" onClick={() => setErrorText(null)}>
            关闭
          </Button>
        </div>
      )}

      {batch === null ? null : (
        <div
          className={batch.failed.length > 0 ? css.stateError : css.stateOk}
          role={batch.failed.length > 0 ? "alert" : "status"}
          data-task-archive-result={batch.ok.length}
          data-task-archive-failed={batch.failed.length}
        >
          <span>
            成功 {batch.ok.length} 条{batch.failed.length > 0 ? `，${failedText(batch.failed)}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setBatch(null)}>
            关闭
          </Button>
        </div>
      )}

      {list.phase === "loading" ? (
        <div className={css.state} data-task-archive-state="loading">
          加载归档…
        </div>
      ) : null}

      {list.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-task-archive-state="offline">
          <span>读取归档失败：{list.error}</span>
          <Button variant="outline" size="sm" onClick={list.reload} data-task-archive-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {list.phase === "ready" && items.length === 0 ? (
        <div className={css.empty} data-task-archive-state="empty">
          <span className={css.emptyIcon} aria-hidden="true">
            <IconArchiveOutlineRegular size={18} />
          </span>
          <span className={css.emptyTitle}>
            {search === "" && appliedState === null ? "暂无任务归档" : "没有匹配的归档"}
          </span>
          <span className={css.emptyText}>
            {search === "" && appliedState === null
              ? "在「当前」列表里，暂停或已结束的任务可通过行菜单「归档会话」放到这里。"
              : "换个关键词或把处理状态改回「全部状态」再看。"}
          </span>
        </div>
      ) : null}

      {list.phase === "ready" && items.length > 0 ? (
        <ul className={css.list} data-task-archive-rows="">
          {items.map((row) => {
            const processing = archiveProcessing(row.state);
            const canRestore = archiveRestorable(row.state);
            const canDelete = archiveDeletable(row.state);
            const canRetry = archiveRetryable(row.state);
            const rowBusy = busyId === row.id;
            return (
              <li className={css.row} key={row.id} data-task-archive-row={row.id} data-state={row.state}>
                <div className={css.rowCheck}>
                  <Checkbox
                    checked={selected.has(row.id)}
                    disabled={busy || processing}
                    label={`选择归档 #${row.task_id}`}
                    onChange={(next) => toggleRow(row.id, next)}
                  />
                </div>
                <div className={css.rowMain}>
                  <span className={css.rowTitle} title={archiveTitle(row)}>
                    {archiveTitle(row)}
                  </span>
                  <span className={css.rowSub} title={row.task_description}>
                    #{row.task_id} · {row.category_name ?? "未分类"} · {archiveDate(row)}
                  </span>
                  <span className={css.rowMetaLine}>
                    {archiveCompressionLabel(row)}
                    <span className={css.dot}>·</span>
                    {archiveDataTotal(row).toLocaleString()} 条数据
                    {row.error !== undefined && row.error !== "" ? (
                      <span className={css.rowError}>{row.error}</span>
                    ) : null}
                    {[...new Set(row.warnings ?? [])].map((warning) => (
                      <span className={css.rowWarn} key={warning}>
                        {warning}
                      </span>
                    ))}
                  </span>
                  {processing ? (
                    <span className={css.rowProgress} data-task-archive-progress={row.progress}>
                      {row.phase} · {row.progress}%
                    </span>
                  ) : null}
                </div>
                <div className={css.rowAside}>
                  <Tag tone={archiveStateTone(row.state)}>{ARCHIVE_STATE_LABEL[row.state]}</Tag>
                  <span className={css.rowActions}>
                    {canRestore ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label="还原任务"
                        title="还原任务"
                        icon={<IconUnarchiveOutlineRegular size={12} />}
                        onClick={() => restoreOne(row)}
                        data-task-archive-action={`restore-${row.id}`}
                      />
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label="永久删除归档"
                        title="永久删除"
                        icon={<IconArchiveOffOutlineRegular size={12} />}
                        onClick={() => setDeleteTargets([row])}
                        data-task-archive-action={`delete-${row.id}`}
                      />
                    ) : null}
                    {canRetry ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label="重试上一次失败的操作"
                        title="重试"
                        icon={<IconRefreshOutlineRegular size={12} />}
                        onClick={() => retryOne(row)}
                        data-task-archive-action={`retry-${row.id}`}
                      />
                    ) : null}
                  </span>
                  {rowBusy ? <span className={css.saving}>处理中…</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {list.phase === "ready" && list.total > 0 ? (
        <footer className={css.pager} data-task-archive-pager="">
          <span data-task-archive-page-info="">
            第 {page} / {pageCount} 页 · 共 {list.total} 条
          </span>
          <span className={css.pagerActions}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              data-task-archive-page="prev"
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || page >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              data-task-archive-page="next"
            >
              下一页
            </Button>
          </span>
        </footer>
      ) : null}

      <Modal
        open={deleteTargets !== null}
        onClose={() => {
          if (!deleting) setDeleteTargets(null);
        }}
        closeLabel="关闭"
        tone="warning"
        title={`永久删除 ${deleteRows.length} 个任务归档？`}
        description={`将永久删除约 ${formatArchiveBytes(deleteBytes)} 的归档包及 ${deleteRowsCount.toLocaleString()} 条关联数据快照。此操作不可恢复。`}
        footer={
          <>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteTargets(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={deleting || deleteRows.length === 0}
              onClick={() => deleteConfirmed(deleteRows)}
              data-task-archive-delete-confirm=""
            >
              {deleting ? "删除中…" : "永久删除"}
            </Button>
          </>
        }
      >
        <div className={css.subjects}>
          <span className={css.subjectsLabel}>将删除</span>
          <span className={css.subjectsList}>
            {deleteRows
              .map((item) => `#${item.task_id} ${archiveTitle(item)}`)
              .slice(0, 20)
              .join("、")}
            {deleteRows.length > 20 ? ` …等 ${deleteRows.length} 个` : ""}
          </span>
        </div>
      </Modal>
    </div>
  );
}
