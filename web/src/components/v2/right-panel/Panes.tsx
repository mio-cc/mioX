"use client";

/**
 * Page bodies for the right panel's six tabs.
 *
 * Each body owns the same three-part layout the DSH right Sidebar's pages use:
 * a 38px header row across the pane (`ui-sidebar-files FilesBody.tsx:74-116`,
 * `FilesBody.module.css:162-171`), one scrolling content region
 * (`FilesBody.module.css:172-180`), and a centred empty/status state when there
 * is nothing to list (`FilesBody.tsx:63-69`). Approval cards follow the shared
 * DSH card (`ui-approval ApprovalCard.tsx:53-90`: waiting strip, scrolling body,
 * action row) and the file rows follow the DSH tree row
 * (`ui-sidebar-files FileTree.module.css` `.row`/`.action`).
 *
 * The 证据 body is a separate file (`EvidencePane.tsx`, unit C23) because it owns
 * its adapter. U3 retired the 资产 / 任务 / 会话 pages (their content lives in the
 * conversation Views 资产 / 概览 now).
 */
import * as React from "react";

import type {
  Finding,
  InterceptPending,
  Task,
  WorkspaceEntry,
} from "@/lib/types";
import { type ApprovalsPhase, decideApproval } from "@/v2/data/approvals";
import { reloadPlanState, reviewFromPending } from "@/v2/data/plan-review";
import { setConversationView } from "@/v2/data/conversation-view-url";
import { PlanReviewDock } from "@/components/v2/composer/PlanReviewDock";
import { FileTypeIcon } from "@/vendor/dsh/primitives/FileTypeIcon";
import { fileSizeText } from "@/vendor/dsh/primitives/file-size";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import type { TagTone } from "@/vendor/dsh/primitives/Tag";
import { FilterBar } from "@/components/v2/design/Kit";

import { ApprovalHistoryPane } from "./ApprovalHistoryPane";
import {
  IconCheckCircleOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconFolderOpenRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { FindingsPhase } from "@/v2/data/findings";
import type { FindingRow } from "@/v2/data/findings-map";
import type { WorkspacePhase } from "@/v2/data/workspace-files";
import { toast } from "../settings/Toast";
import css from "./Panes.module.css";

// 证据 page (C23) is re-exported through the pane dispatch module.
export { EvidencePane, type EvidencePaneProps } from "./EvidencePane";

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

/** The pane's header row: context on the left, controls on the right. */
function PaneHeader({ children, actions }: {
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
}): React.ReactNode {
  return (
    <div className={css.header}>
      <div className={css.headerMain}>{children}</div>
      {actions === undefined ? null : <div className={css.headerActions}>{actions}</div>}
    </div>
  );
}

/** A 28px icon control in the pane header, matching the files page's tools. */
function ToolButton({ label, onClick, children }: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.ReactNode {
  return (
    <button type="button" className={css.tool} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** A centred state for loading failures and empty lists. */
function EmptyState({ icon, title, hint }: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly hint?: string;
}): React.ReactNode {
  return (
    <div className={css.empty}>
      <span className={css.emptyIcon} aria-hidden="true">{icon}</span>
      <span className={css.emptyTitle}>{title}</span>
      {hint === undefined ? null : <span className={css.emptyHint}>{hint}</span>}
    </div>
  );
}

/** Placeholder rows while a list is being read. */
function LoadingRows({ count }: { readonly count: number }): React.ReactNode {
  return (
    <div className={css.scroll} aria-busy="true">
      <div className={css.list}>
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className={css.skeletonRow} aria-hidden="true">
            <span className={css.skeletonTag} />
            <span className={css.skeletonLine} />
            <span className={css.skeletonMeta} />
          </div>
        ))}
      </div>
      <span className={css.srOnly} role="status">加载中</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 发现
// ---------------------------------------------------------------------------

const SEVERITY_TONE: Record<FindingRow["severity"], TagTone> = {
  high: "danger",
  medium: "warning",
  low: "outline",
};

const SEVERITY_LABEL: Record<FindingRow["severity"], string> = {
  high: "高危",
  medium: "中危",
  low: "低危",
};

const FINDING_STATUS_LABEL: Record<Finding["status"], string> = {
  pending: "待处理",
  in_progress: "处理中",
  confirmed: "已确认",
  resolved: "已处理",
  fixed: "已修复",
  false_positive: "误报",
  ignored: "已忽略",
  duplicate: "重复",
  risk_accepted: "风险接受",
};

export interface FindingsPaneProps {
  readonly phase: FindingsPhase;
  readonly findings: Finding[] | null;
  readonly rows: readonly FindingRow[];
  readonly onReload: () => void;
  /** Task the list is scoped to; null when no task is selected (then every task's findings show). */
  readonly scopedTaskId?: string | null;
}

/** Open the global findings library (the left-rail page), optionally at one finding. */
function openFindingsLibrary(findingId?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  if (findingId === undefined) url.searchParams.delete("finding");
  else url.searchParams.set("finding", findingId);
  window.history.pushState(null, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * The findings page: severity-tallied header over one accordion list.
 * @param props - findings adapter state and the row view model.
 * @returns the page.
 */
export function FindingsPane({ phase, findings, rows, onReload, scopedTaskId = null }: FindingsPaneProps): React.ReactNode {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const counts = React.useMemo(() => {
    const tally = { high: 0, medium: 0, low: 0 };
    for (const row of rows) tally[row.severity] += 1;
    return tally;
  }, [rows]);
  const selected = openId === null || findings === null
    ? undefined
    : findings.find((item) => String(item.id) === openId);

  return (
    <div className={css.page}>
      <PaneHeader
        actions={(
          <ToolButton label="刷新发现" onClick={onReload}>
            <IconRefreshOutlineRegular size={15} />
          </ToolButton>
        )}
      >
        <span className={css.count} data-findings-scope={scopedTaskId ?? "all"}>
          {phase === "ready" ? `${scopedTaskId === null ? "全部任务" : "本任务"} ${rows.length} 条发现` : "发现"}
        </span>
        {phase === "ready" && rows.length > 0 ? (
          <span className={css.tally} aria-hidden="true">
            <span className={css.tallyItem}><span className={css.dot} data-tone="high" />{counts.high}</span>
            <span className={css.tallyItem}><span className={css.dot} data-tone="medium" />{counts.medium}</span>
            <span className={css.tallyItem}><span className={css.dot} data-tone="low" />{counts.low}</span>
          </span>
        ) : null}
      </PaneHeader>

      {phase === "loading" ? <LoadingRows count={5} /> : null}

      {phase === "offline" ? (
        <EmptyState
          icon={<IconWarningOutlineRegular size={26} />}
          title="未连接后端（发现列表不可用）"
          hint="GET /exploration/findings 读取失败，后端恢复后点刷新重试"
        />
      ) : null}

      {phase === "ready" && rows.length === 0 ? (
        <>
          <EmptyState
            icon={<IconShieldOutlineRegular size={26} />}
            title={scopedTaskId === null ? "暂无发现" : "本任务暂无发现"}
            hint="扫描确认漏洞后会出现在这里：按严重度分档，点开看摘要与证据"
          />
          {scopedTaskId === null ? null : (
            <button type="button" className={css.libraryLink} data-findings-library="" onClick={() => openFindingsLibrary()}>
              查看全部任务的发现 →
            </button>
          )}
        </>
      ) : null}

      {phase === "ready" && rows.length > 0 ? (
        <div className={css.scroll}>
          <ul className={css.list}>
            {rows.map((row) => {
              const open = row.id === openId;
              return (
                <li key={row.id} className={css.listItem}>
                  <button
                    type="button"
                    className={`${css.row} ${open ? css.rowActive : ""}`}
                    aria-expanded={open}
                    onClick={() => {
                      setOpenId(open ? null : row.id);
                    }}
                  >
                    <span className={css.rowTop}>
                      <Tag tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABEL[row.severity]}</Tag>
                      <span className={css.rowTitle}>{row.title}</span>
                      <span className={css.rowChevron} aria-hidden="true">
                        {open ? <IconChevronUpOutlineRegular size={13} /> : <IconChevronDownOutlineRegular size={13} />}
                      </span>
                    </span>
                    <span className={css.rowMeta}>
                      #{row.id}
                      {row.at === "" ? "" : ` · ${row.at}`}
                    </span>
                  </button>
                  {open ? (
                    <div className={css.detail}>
                      {selected === undefined ? null : (
                        <div className={css.detailMeta}>
                          <Tag tone="outline">{FINDING_STATUS_LABEL[selected.status]}</Tag>
                          {selected.vulnclass === "" ? null : (
                            <span className={css.detailClass}>{selected.vulnclass}</span>
                          )}
                        </div>
                      )}
                      {selected === undefined || selected.summary === "" ? null : (
                        <p className={css.detailText}>{selected.summary}</p>
                      )}
                      {selected === undefined || selected.evidence === "" ? null : (
                        <pre className={css.detailEvidence}>{selected.evidence}</pre>
                      )}
                      <button
                        type="button"
                        className={css.libraryLink}
                        data-finding-open-detail={row.id}
                        onClick={() => openFindingsLibrary(row.id)}
                      >
                        打开完整详情 →
                      </button>
                      {/* U1（.tmp/d6-ia-inventory.md §4.3「发现」行）：到中间·发现视图定位该行，
                          `?hl=` 传发现 id，由 TaskFindingsView 滚动 + 短暂高亮。
                          id 用 findings 表行 id（`finding_id`，探测节点 id 作退路）：中间
                          发现视图的行钩子 `[data-task-finding]` 用的是 findings 表行 id。 */}
                      <button
                        type="button"
                        className={css.libraryLink}
                        data-finding-open-view={selected === undefined ? row.id : (selected.finding_id ?? selected.id)}
                        onClick={() =>
                          setConversationView("findings", {
                            hl: selected === undefined ? row.id : (selected.finding_id ?? selected.id),
                          })
                        }
                      >
                        在发现视图打开 →
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

export interface ApprovalsPaneProps {
  readonly phase: ApprovalsPhase;
  readonly pending: readonly InterceptPending[];
  readonly onReload: () => void;
  /** 当前选中任务，历史视图用它做「只看当前任务」范围（A04）。 */
  readonly task?: Task | null;
}

/**
 * The approvals page: one card per pending intercept request.
 * @param props - approvals adapter state.
 * @returns the page.
 */
export function ApprovalsPane({ phase, pending, onReload, task = null }: ApprovalsPaneProps): React.ReactNode {
  const [busyId, setBusyId] = React.useState<number | null>(null);
  /** 待审批 / 历史两个视图（A04：历史落在本 tab 内，不新开右栏 tab）。 */
  const [view, setView] = React.useState<"pending" | "history">("pending");
  const decide = (id: number, decision: "allowed" | "denied"): void => {
    setBusyId(id);
    void decideApproval(id, decision)
      .then(() => {
        toast(decision === "allowed" ? "已允许" : "已拒绝");
        onReload();
      })
      .catch((reason: unknown) => {
        toast(`处理失败：${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  const viewSwitch = (
    <FilterBar
      id="approvals-view"
      label="审批视图"
      value={view}
      options={[
        { value: "pending", label: "待审批" },
        { value: "history", label: "历史" },
      ]}
      onChange={(next) => setView(next as "pending" | "history")}
    />
  );

  if (view === "history") {
    return (
      <div className={css.page} data-approvals-view="history">
        <PaneHeader actions={viewSwitch}>
          <span className={css.count}>审批历史</span>
        </PaneHeader>
        <ApprovalHistoryPane task={task} />
      </div>
    );
  }

  return (
    <div className={css.page} data-approvals-view="pending">
      <PaneHeader
        actions={(
          <>
            {viewSwitch}
            <ToolButton label="刷新审批" onClick={onReload}>
              <IconRefreshOutlineRegular size={15} />
            </ToolButton>
          </>
        )}
      >
        <span className={css.count}>
          {phase === "ready" ? (pending.length === 0 ? "无待审批" : `${pending.length} 条待审批`) : "审批"}
        </span>
        {phase === "ready" && pending.length > 0 ? <span className={css.liveDot} aria-hidden="true" /> : null}
      </PaneHeader>

      {phase === "loading" ? <LoadingRows count={2} /> : null}

      {phase === "offline" ? (
        <EmptyState
          icon={<IconWarningOutlineRegular size={26} />}
          title="未连接后端（审批不可用）"
          hint="GET /intercept/pending 读取失败，后端恢复后点刷新重试"
        />
      ) : null}

      {phase === "ready" && pending.length === 0 ? (
        <EmptyState
          icon={<IconCheckCircleOutlineRegular size={26} />}
          title="暂无待审批操作"
          hint="工具在拦截层排队等待人工决定时会出现在这里，可直接允许或拒绝"
        />
      ) : null}

      {phase === "ready" && pending.length > 0 ? (
        <div className={css.scroll}>
          <div className={css.approvalList}>
            {pending.map((item) => {
              // A submitted plan is not a tool asking for privileges: it gets the
              // three plan outcomes (approve / keep planning / dismiss) instead of
              // allow-once / deny, through the same dock the composer shows.
              const planReview = reviewFromPending(item);
              if (planReview !== null) {
                return (
                  <div key={item.id} data-approval-plan={item.id}>
                    <PlanReviewDock
                      review={planReview}
                      variant="panel"
                      onSettled={() => {
                        onReload();
                        if (planReview.taskId !== "") reloadPlanState(planReview.taskId);
                      }}
                    />
                  </div>
                );
              }
              const command = String(item.tool_input?.command ?? item.tool_input?.file_path ?? item.reason ?? "");
              const busy = busyId === item.id;
              return (
                <article key={item.id} className={css.approvalCard} aria-busy={busy}>
                  <div className={css.approvalStrip}>
                    <span className={css.approvalDot} aria-hidden="true" />
                    <span>等待批准</span>
                    <span className={css.approvalAgent}>{item.agent_name}</span>
                    <span className={css.approvalId}>#{item.id}</span>
                  </div>
                  <div className={css.approvalBody}>
                    <p className={css.approvalHeading}>
                      工具 <code className={css.inlineCode}>{item.tool_name}</code> 请求越权执行
                    </p>
                    {item.reason === "" ? null : <p className={css.approvalReason}>{item.reason}</p>}
                    {command === "" ? null : <pre className={css.command}>{command}</pre>}
                  </div>
                  <div className={css.approvalActions}>
                    <button
                      type="button"
                      className={css.rejectBtn}
                      disabled={busy}
                      onClick={() => {
                        decide(item.id, "denied");
                      }}
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      className={css.allowBtn}
                      disabled={busy}
                      onClick={() => {
                        decide(item.id, "allowed");
                      }}
                    >
                      允许一次
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------------

export interface FilesPaneProps {
  readonly phase: WorkspacePhase;
  readonly entries: readonly WorkspaceEntry[];
  readonly onReload: () => void;
}

/**
 * The files page: the workspace root's entries, directories first.
 * @param props - workspace listing adapter state.
 * @returns the page.
 */
export function FilesPane({ phase, entries, onReload }: FilesPaneProps): React.ReactNode {
  const sorted = React.useMemo(
    () => [...entries].sort((left, right) => {
      if (left.dir !== right.dir) return left.dir ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN");
    }),
    [entries],
  );
  const directoryCount = sorted.filter((entry) => entry.dir).length;

  return (
    <div className={css.page}>
      <PaneHeader
        actions={(
          <ToolButton label="刷新工作区" onClick={onReload}>
            <IconRefreshOutlineRegular size={15} />
          </ToolButton>
        )}
      >
        <span className={css.rootLabel} title="工作区根目录">/</span>
        {phase === "ready" ? (
          <span className={css.count}>
            {sorted.length} 项 · {directoryCount} 目录
          </span>
        ) : null}
      </PaneHeader>

      {phase === "loading" ? <LoadingRows count={5} /> : null}

      {phase === "offline" ? (
        <EmptyState
          icon={<IconWarningOutlineRegular size={26} />}
          title="未连接后端（文件树不可用）"
          hint="GET /workspace/list 读取失败，后端恢复后点刷新重试"
        />
      ) : null}

      {phase === "ready" && sorted.length === 0 ? (
        <EmptyState
          icon={<IconFolderOpenOutlineRegular size={26} />}
          title="工作区为空"
          hint="任务写入工作目录的文件会出现在这里"
        />
      ) : null}

      {phase === "ready" && sorted.length > 0 ? (
        <div className={css.scroll}>
          <ul className={css.fileList}>
            {sorted.map((entry) => (
              <li key={entry.path} className={css.fileRow}>
                <span className={css.fileIcon} aria-hidden="true">
                  {entry.dir
                    ? <IconFolderOpenRegular size={16} />
                    : <FileTypeIcon path={entry.path} size={16} />}
                </span>
                <span className={css.fileName} title={entry.path}>{entry.name}</span>
                <span className={css.fileMeta}>{entry.dir ? "目录" : fileSizeText(entry.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
