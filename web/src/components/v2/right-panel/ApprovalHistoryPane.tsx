"use client";

/**
 * 审批历史视图（右栏「审批」tab 的第二视图，对照表 P1:E2–E4、P3:I11）。
 * 旧页面依据：ARTEX/web/src/components/approval-records.tsx（列表 :40-129、详情字段子集）、
 * approval-execution-focus.tsx:1-140（执行链路）。
 * DSH 依据：DSH 无审批历史页，按右栏 pane tab 扩展（ui-sidebar-right/src/client/index.ts:246）。
 *
 * 只读：不调用任何写接口。后端 `intercept_pending` 表为空时显示空态文案。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { Activity, Task } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  approvalOriginLabel,
  approvalSource,
  approvalStatusLabel,
  approvalStatusTone,
  approvalSummary,
  approvalTime,
  useApprovalDetail,
  useApprovalExecution,
  useApprovalHistory,
  type ApprovalSourceFilter,
  type ApprovalStatusFilter,
} from "@/v2/data/approval-history";

import css from "./ApprovalHistory.module.css";

/** 每页条数选项（旧页 approval-records 的分页同样用 10/20/50）。 */
const SIZE_OPTIONS = [
  { value: "10", label: "10 / 页" },
  { value: "20", label: "20 / 页" },
  { value: "50", label: "50 / 页" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待审批" },
  { value: "allowed", label: "已允许" },
  { value: "denied", label: "已拒绝" },
  { value: "timeout", label: "已超时" },
];

const SOURCE_OPTIONS = [
  { value: "all", label: "全部来源" },
  { value: "rule", label: "规则判定" },
  { value: "model", label: "模型判定" },
  { value: "unknown", label: "未记录" },
];

/** 执行记录里一行活动的摘要（活动行的 worker / kind / summary 都是后端字段）。 */
function activityLine(row: Activity): string {
  const tool = row.tool !== undefined && row.tool !== "" ? `${row.tool} · ` : "";
  return `${row.worker} · ${row.kind} · ${tool}${row.summary}`;
}

/**
 * 展开后的详情：audit 字段 + 执行链路活动行。
 * @param props.id - 审批 id。
 * @param props.conversationId - 关联对话 id，用于定位执行。
 * @returns 详情块。
 */
function HistoryDetail({ id, conversationId }: { id: number; conversationId?: number }): ReactNode {
  const detail = useApprovalDetail(id);
  const execution = useApprovalExecution(id, conversationId);

  if (detail.phase === "loading") return <div className={css.state}>加载详情…</div>;
  if (detail.phase === "offline" || detail.detail === null) {
    return (
      <div className={css.stateError} role="alert">
        详情读取失败：{detail.error ?? "未知原因"}
      </div>
    );
  }

  const row = detail.detail;
  const audit = row.audit;
  return (
    <div className={css.detail}>
      <div className={css.metaRows}>
        <span className={css.metaLabel}>工具</span>
        <span className={css.metaValue}>{row.tool_name}</span>
        <span className={css.metaLabel}>Agent</span>
        <span className={css.metaValue}>{row.agent_name}</span>
        <span className={css.metaLabel}>来源</span>
        <span className={css.metaValue}>
          {approvalSource(row) === "model" ? "模型判定" : row.rule_name === "" ? "规则判定（名称未记录）" : row.rule_name}
        </span>
        <span className={css.metaLabel}>决定时间</span>
        <span className={css.metaValue}>{approvalTime(row.decided_at)}</span>
        {audit === null ? null : (
          <>
            <span className={css.metaLabel}>初始动作</span>
            <span className={css.metaValue}>{audit.initial_action}</span>
            <span className={css.metaLabel}>执行状态</span>
            <span className={css.metaValue}>{audit.execution_status}</span>
            <span className={css.metaLabel}>关联精确度</span>
            <span className={css.metaValue}>{audit.correlation}</span>
          </>
        )}
      </div>
      {row.reason === "" ? null : <p className={css.reason}>理由：{row.reason.replace(/^\[模型\]\s*/, "")}</p>}
      {row.tool_input === null || Object.keys(row.tool_input).length === 0 ? null : (
        <pre className={css.command}>{JSON.stringify(row.tool_input, null, 2)}</pre>
      )}
      <div className={css.execBlock}>
        <span className={css.metaLabel}>执行链路</span>
        {execution.phase === "loading" ? <span className={css.state}>加载执行记录…</span> : null}
        {execution.phase === "offline" ? <span className={css.stateError}>执行记录读取失败。</span> : null}
        {execution.phase === "ready" && execution.items.length === 0 ? (
          <span className={css.state}>这条审批没有关联的执行记录。</span>
        ) : null}
        {execution.phase === "ready" && execution.items.length > 0 ? (
          <ul className={css.execList}>
            {execution.items.map((item) => (
              <li key={item.seq} className={css.execRow}>
                {activityLine(item)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 渲染审批历史列表。
 * @param props.task - 当前选中任务；为空时只提供「全部」范围。
 * @returns 历史视图。
 */
export function ApprovalHistoryPane({ task }: { task?: Task | null }): ReactNode {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [status, setStatus] = useState<ApprovalStatusFilter>("all");
  const [source, setSource] = useState<ApprovalSourceFilter>("all");
  const [scope, setScope] = useState<"all" | "task">("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  // 任何筛选变化都回到第一页，避免停在空页上。
  useEffect(() => {
    setPage(1);
  }, [status, source, scope, size]);

  const taskId = scope === "task" && task != null ? task.id : null;
  const history = useApprovalHistory({ page, size, status, source, taskId });
  const pageCount = Math.max(1, Math.ceil(history.total / size));
  const scopeOptions = useMemo(
    () => [
      { value: "all", label: "全部任务" },
      ...(task == null ? [] : [{ value: "task", label: `当前任务 ${task.id}` }]),
    ],
    [task],
  );

  return (
    <div className={css.pane} data-approval-history="">
      <div className={css.filters}>
        <SelectMenu
          ariaLabel="审批状态筛选"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(next) => setStatus(next as ApprovalStatusFilter)}
        />
        <SelectMenu
          ariaLabel="审批来源筛选"
          value={source}
          options={SOURCE_OPTIONS}
          onChange={(next) => setSource(next as ApprovalSourceFilter)}
        />
        <SelectMenu ariaLabel="审批范围" value={scope} options={scopeOptions} onChange={(next) => setScope(next as "all" | "task")} />
        <SelectMenu ariaLabel="每页条数" value={String(size)} options={SIZE_OPTIONS} onChange={(next) => setSize(Number(next))} />
        <Button variant="outline" size="sm" onClick={history.reload} data-approval-history-refresh="">
          刷新
        </Button>
      </div>

      {history.phase === "loading" ? <div className={css.state}>加载审批历史…</div> : null}

      {history.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>审批历史读取失败：{history.error}</span>
          <Button variant="outline" size="sm" onClick={history.reload}>
            重试
          </Button>
        </div>
      ) : null}

      {history.phase === "ready" && history.items.length === 0 ? (
        <p className={css.empty}>
          还没有审批记录。工具在拦截层排队并被人工或规则决定后，历史会出现在这里。
        </p>
      ) : null}

      {history.phase === "ready" && history.items.length > 0 ? (
        <>
          <div className={css.count} data-approval-history-count={history.total}>
            共 {history.total} 条
          </div>
          <ul className={css.list}>
            {history.items.map((row) => {
              const open = expanded === row.id;
              return (
                <li key={row.id} className={css.row} data-approval-row={row.id}>
                  <button
                    type="button"
                    className={css.rowHead}
                    aria-expanded={open}
                    data-approval-row-toggle={row.id}
                    onClick={() => setExpanded(open ? null : row.id)}
                  >
                    <Tag tone={approvalStatusTone(row.status)}>{approvalStatusLabel(row.status)}</Tag>
                    <span className={css.tool}>{row.tool_name}</span>
                    <span className={css.when}>{approvalTime(row.decided_at ?? row.created_at)}</span>
                  </button>
                  <div className={css.rowSub}>
                    <span className={css.origin}>来源：{approvalOriginLabel(row)}</span>
                    <span className={css.summary} title={approvalSummary(row)}>
                      {approvalSummary(row)}
                    </span>
                  </div>
                  {open ? <HistoryDetail id={row.id} conversationId={row.conversation_id} /> : null}
                </li>
              );
            })}
          </ul>
          {pageCount > 1 ? (
            <div className={css.pager}>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </Button>
              <span className={css.pageInfo}>
                第 {page} / {pageCount} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
