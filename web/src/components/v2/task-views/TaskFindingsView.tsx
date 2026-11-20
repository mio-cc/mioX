"use client";

/**
 * 任务内发现（会话视图 tab「发现」，对照表 P1:C17）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/findings-tab.tsx:43-138（行：标题、
 * 严重度、继承只读行、状态下拉、时间、证据展开、详情入口）、:190-222（列表与空态）。
 * DSH 依据：DSH 无任务内发现页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：数据走 `v2/data/task-findings.ts` 的 `useTaskFindingsPage`（`api.findingsPage`，api.ts:637）；
 * 改状态走同一模块的 `setFindingStatus`（`api.setFindingStatus`，api.ts:760）。
 */
import { type ReactNode, useEffect, useState } from "react";

import type { Finding, FindingStatus, Task } from "@/lib/types";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag, type TagTone } from "@/vendor/dsh/primitives/Tag";
import {
  findingStatusLabel,
  formatFindingTime,
  severityLabel,
  STATUS_FILTER_ORDER,
} from "@/v2/data/findings-page";
import {
  findingReadOnly,
  findingWriteId,
  setFindingStatus,
  TASK_FINDINGS_PAGE_SIZE,
  useTaskFindingsPage,
} from "@/v2/data/task-findings";

import css from "./TaskFindingsView.module.css";

/** 状态筛选取值：`all` 或后端的 9 种处置状态。 */
type StatusFilter = "all" | FindingStatus;

/** 状态筛选的分段选项（全部 + 后端 9 种，顺序照 STATUS_FILTER_ORDER）。 */
const STATUS_FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  ...STATUS_FILTER_ORDER.map((status) => ({ value: status as StatusFilter, label: findingStatusLabel(status) })),
];

/** 行内改状态的选项（9 种处置状态，不含「全部」）。 */
const STATUS_WRITE_OPTIONS: readonly { value: FindingStatus; label: string }[] = STATUS_FILTER_ORDER.map(
  (status) => ({ value: status, label: findingStatusLabel(status) }),
);

/**
 * 严重等级对应的 Tag 色调。
 * @param severity - 后端严重等级。
 * @returns Tag 的 tone。
 */
function severityTone(severity: string): TagTone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "neutral";
  return "outline";
}

/**
 * 打开某个漏洞的详情（真实 SPA 导航：改地址后通知 Shell 重新读取 `?page=`）。
 * 写法照抄 `components/v2/task-views/ReportView.tsx:38-44` 的 `openFindingDetail`。
 * @param id - 漏洞 id。
 */
function openFindingDetail(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  url.searchParams.set("finding", id);
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * 一行的标题：优先漏洞名称，否则漏洞类型（旧页 findings-tab.tsx:25-29）。
 * @param finding - 后端发现行。
 * @returns 显示名。
 */
function rowTitle(finding: Finding): string {
  const name = finding.name?.trim() ?? "";
  if (name !== "") return name;
  const vulnclass = finding.vulnclass?.trim() ?? "";
  return vulnclass === "" ? "未分类" : vulnclass;
}

/**
 * 渲染任务内发现视图。
 * @param props.task - 当前选中的任务。
 * @returns 发现列表（含状态筛选、行内改状态、详情入口、分页与四种状态）。
 */
export function TaskFindingsView({ task }: { task: Task }): ReactNode {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const state = useTaskFindingsPage(task.id, page, status);

  // 换任务或换筛选时回到第一页，避免停在一个不存在的页码上。
  useEffect(() => {
    setPage(1);
  }, [task.id, status]);

  const pageCount = Math.max(1, Math.ceil(state.total / TASK_FINDINGS_PAGE_SIZE));

  // 行内改状态：一次只允许一行在写。
  const [savingId, setSavingId] = useState<string | null>(null);
  const [writeFailure, setWriteFailure] = useState<string | null>(null);

  /**
   * 改一行的处理状态；成功后 toast 并刷新列表，失败时把后端原因写在页面上。
   * @param row - 被改的发现行。
   * @param next - 目标处置状态。
   */
  const changeStatus = (row: Finding, next: FindingStatus): void => {
    if (findingReadOnly(row) || next === row.status || savingId !== null) return;
    const id = findingWriteId(row);
    setSavingId(id);
    setWriteFailure(null);
    setFindingStatus(id, next)
      .then(() => {
        setSavingId(null);
        toast(`已标记为「${findingStatusLabel(next)}」`);
        state.reload();
      })
      .catch((reason: unknown) => {
        setSavingId(null);
        setWriteFailure(
          `修改处理状态失败：${reason instanceof Error ? reason.message : String(reason)}`,
        );
      });
  };

  return (
    <div className={css.wrap} data-task-findings="">
      <div className={css.toolbar}>
        <span className={css.filterLabel}>状态</span>
        <div className={css.filterBar} data-task-findings-filter="">
          <SegmentedControl<StatusFilter>
            id="task-findings-status"
            label="按处理状态筛选"
            value={status}
            options={STATUS_FILTER_OPTIONS}
            onChange={setStatus}
          />
        </div>
        <span className={css.count} data-task-findings-count="">
          {state.phase === "ready" ? `${state.total} 条` : state.phase === "loading" ? "读取中…" : "读取失败"}
        </span>
        <Button variant="outline" size="sm" onClick={state.reload} data-task-findings-refresh="">
          刷新
        </Button>
      </div>

      {writeFailure === null ? null : (
        <div className={css.stateError} role="alert" data-task-findings-write-error="">
          {writeFailure}
        </div>
      )}

      {state.phase === "loading" ? (
        <div className={css.state} data-task-findings-state="loading">
          加载发现…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert" data-task-findings-state="offline">
          <span>发现读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-task-findings-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && state.items.length === 0 ? (
        <div className={css.empty} data-task-findings-state="empty">
          <Tag tone="neutral">暂无发现</Tag>
          <span>
            {status === "all"
              ? "本任务及直接关联任务暂无确认发现。"
              : "本任务没有这个状态的发现，换个状态看看。"}
          </span>
        </div>
      ) : null}

      {state.phase === "ready" && state.items.length > 0 ? (
        <>
          <ul className={css.list} data-task-findings-rows="">
            {state.items.map((row) => {
              const id = findingWriteId(row);
              const readOnly = findingReadOnly(row);
              const writing = savingId === id;
              return (
                <li key={row.finding_id ?? row.id} className={css.row} data-task-finding={id} data-status={row.status}>
                  <div className={css.rowMain}>
                    <div className={css.rowHead}>
                      <span className={css.rowTitle} title={rowTitle(row)}>
                        {rowTitle(row)}
                      </span>
                      <Tag tone={severityTone(row.severity)}>{severityLabel(row.severity)}</Tag>
                      {readOnly ? (
                        <Tag tone="quiet" className={css.tagQuiet}>
                          继承 · 只读
                        </Tag>
                      ) : null}
                    </div>
                    {row.summary === "" ? null : <span className={css.rowSummary}>{row.summary}</span>}
                  </div>
                  <div className={css.rowMeta}>
                    {readOnly ? (
                      <Tag tone="outline" className={css.statusTag}>
                        {findingStatusLabel(row.status)}
                      </Tag>
                    ) : (
                      <SelectMenu
                        ariaLabel={`处理状态：${rowTitle(row)}`}
                        value={row.status}
                        disabled={savingId !== null}
                        onChange={(value) => changeStatus(row, value as FindingStatus)}
                        options={STATUS_WRITE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                      />
                    )}
                    {writing ? <span className={css.saving}>保存中…</span> : null}
                    <span className={css.time}>{formatFindingTime(row.ts)}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openFindingDetail(id)}
                      data-task-finding-open={id}
                    >
                      打开详情
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <footer className={css.pager} data-task-findings-pager="">
            <span data-task-findings-page-info="">
              第 {page} / {pageCount} 页 · 共 {state.total} 条
            </span>
            <span className={css.pagerActions}>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                data-task-findings-page="prev"
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                data-task-findings-page="next"
              >
                下一页
              </Button>
            </span>
          </footer>
        </>
      ) : null}
    </div>
  );
}
