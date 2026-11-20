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
 * The 资产 and 证据 bodies are separate files (`AssetsPane.tsx`,
 * `EvidencePane.tsx`, unit C23) because they own their adapters; they are
 * dispatched from this module's page switch so one import names every page.
 */
import * as React from "react";

import type {
  Finding,
  InterceptPending,
  Task,
  TaskStatus,
  WorkspaceEntry,
} from "@/lib/types";
import { type ApprovalsPhase, decideApproval } from "@/v2/data/approvals";
import { FileTypeIcon } from "@/vendor/dsh/primitives/FileTypeIcon";
import { fileSizeText } from "@/vendor/dsh/primitives/file-size";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import type { TagTone } from "@/vendor/dsh/primitives/Tag";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";

import { ApprovalHistoryPane } from "./ApprovalHistoryPane";
import {
  IconCheckCircleOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconFolderOpenRegular,
  IconGoalOutlineRegular,
  IconNewChatOutlineRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { FindingsPhase } from "@/v2/data/findings";
import type { FindingRow } from "@/v2/data/findings-map";
import type { WorkspacePhase } from "@/v2/data/workspace-files";
import { toast } from "../settings/Toast";
import css from "./Panes.module.css";

// The two C23 pages are re-exported through the pane dispatch module, so the
// right panel and any future consumer import every page from one place.
export { AssetsPane, type AssetsPaneProps } from "./AssetsPane";
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
}

/**
 * The findings page: severity-tallied header over one accordion list.
 * @param props - findings adapter state and the row view model.
 * @returns the page.
 */
export function FindingsPane({ phase, findings, rows, onReload }: FindingsPaneProps): React.ReactNode {
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
        <span className={css.count}>{phase === "ready" ? `${rows.length} 条发现` : "发现"}</span>
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
        <EmptyState
          icon={<IconShieldOutlineRegular size={26} />}
          title="暂无发现"
          hint="扫描确认漏洞后会出现在这里：按严重度分档，点开看摘要与证据"
        />
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
    <SegmentedControl
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

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

const TASK_STATUS: Record<TaskStatus, { readonly label: string; readonly tone: TagTone }> = {
  created: { label: "已创建", tone: "outline" },
  queued: { label: "排队中", tone: "outline" },
  running: { label: "运行中", tone: "success" },
  paused: { label: "已暂停", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  timeout: { label: "超时", tone: "danger" },
};

const NUMBER = new Intl.NumberFormat("zh-CN");

/** One label/value row in the session's metadata list. */
function MetaRow({ label, children }: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className={css.metaRow}>
      <dt className={css.metaLabel}>{label}</dt>
      <dd className={css.metaValue}>{children}</dd>
    </div>
  );
}

/** One token counter cell. */
function TokenCell({ label, value }: { readonly label: string; readonly value: number }): React.ReactNode {
  return (
    <div className={css.tokenCell}>
      <span className={css.tokenLabel}>{label}</span>
      <span className={css.tokenValue}>{NUMBER.format(value)}</span>
    </div>
  );
}

/**
 * The session page: the shell's currently selected task, section by section.
 * @param props.task - the selected task; absent means the shell has no selection.
 * @returns the page.
 */
export function SessionPane({ task }: { readonly task?: Task | null }): React.ReactNode {
  if (task === undefined || task === null) {
    return (
      <EmptyState
        icon={<IconNewChatOutlineRegular size={26} />}
        title="先选择一个任务"
        hint="在左侧会话列表选中任务后，这里显示它的状态、目标进度与 token 用量"
      />
    );
  }

  const status = TASK_STATUS[task.status];
  const goalsMet = task.goals_met ?? 0;
  const goalsTotal = task.goals_total ?? 0;
  const percent = goalsTotal > 0 ? Math.min(100, Math.round((goalsMet / goalsTotal) * 100)) : 0;
  const title = task.name !== undefined && task.name !== "" ? task.name : task.description;
  const tokens = task.tokens;
  // The list payload sometimes carries only the unix second; format it the same
  // way the backend's own RFC3339 timestamps read.
  const lastActivity = task.last_activity !== undefined && task.last_activity !== ""
    ? task.last_activity
    : task.last_activity_unix !== undefined && task.last_activity_unix > 0
      ? new Date(task.last_activity_unix * 1000).toLocaleString("zh-CN", { hour12: false })
      : "—";

  return (
    <div className={css.page}>
      <PaneHeader>
        <Tag tone={status.tone}>{status.label}</Tag>
        <span className={css.sessionId}>#{task.id}</span>
        {task.plan_mode === true ? <Tag tone="info">计划模式</Tag> : null}
      </PaneHeader>

      <div className={css.scroll}>
        <div className={css.session}>
          <section className={css.section}>
            <h3 className={css.sectionTitle}>当前会话</h3>
            <p className={css.sessionTitle}>{title === "" ? "（未命名任务）" : title}</p>
            {task.description === "" || task.description === title ? null : (
              <p className={css.sessionDescription}>{task.description}</p>
            )}
          </section>

          <section className={css.section}>
            <h3 className={css.sectionTitle}>
              <span className={css.sectionIcon} aria-hidden="true"><IconGoalOutlineRegular size={13} /></span>
              任务目标
            </h3>
            <p className={css.sessionDescription}>{task.goal === "" ? "（未填写目标）" : task.goal}</p>
          </section>

          <section className={css.section}>
            <h3 className={css.sectionTitle}>目标进度</h3>
            <div className={css.progressRow}>
              <span
                className={css.progressTrack}
                role="progressbar"
                aria-label="目标完成进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span className={css.progressFill} style={{ width: `${percent}%` }} />
              </span>
              <span className={css.progressText}>{goalsMet} / {goalsTotal === 0 ? "—" : goalsTotal}</span>
            </div>
          </section>

          <section className={css.section}>
            <h3 className={css.sectionTitle}>运行信息</h3>
            <dl className={css.metaList}>
              <MetaRow label="引擎模式">{task.engine_mode ?? "—"}</MetaRow>
              <MetaRow label="权限档">{task.permission_level ?? "—"}</MetaRow>
              <MetaRow label="计划模式">{task.plan_mode === true ? "开启" : "关闭"}</MetaRow>
              <MetaRow label="团队模式">{task.team_mode === true ? "开启" : "关闭"}</MetaRow>
              <MetaRow label="创建时间">
                <span className={css.mono}>{task.created_at}</span>
              </MetaRow>
              <MetaRow label="完成时间">
                <span className={css.mono}>{task.completed_at !== undefined && task.completed_at !== "" ? task.completed_at : "—"}</span>
              </MetaRow>
              <MetaRow label="最近活动">
                <span className={css.mono}>{lastActivity}</span>
              </MetaRow>
            </dl>
          </section>

          {task.findings === undefined ? null : (
            <section className={css.section}>
              <h3 className={css.sectionTitle}>
                <span className={css.sectionIcon} aria-hidden="true"><IconShieldOutlineRegular size={13} /></span>
                漏洞统计
              </h3>
              <div className={css.tagRow}>
                <Tag tone={task.findings.critical > 0 ? "danger" : "outline"}>严重 {task.findings.critical}</Tag>
                <Tag tone={task.findings.high > 0 ? "danger" : "outline"}>高危 {task.findings.high}</Tag>
                <Tag tone={task.findings.medium > 0 ? "warning" : "outline"}>中危 {task.findings.medium}</Tag>
                <Tag tone="outline">低危 {task.findings.low}</Tag>
              </div>
            </section>
          )}

          <section className={css.section}>
            <h3 className={css.sectionTitle}>Token 用量</h3>
            <div className={css.tokenGrid}>
              <TokenCell label="输入" value={tokens?.input_tokens ?? 0} />
              <TokenCell label="输出" value={tokens?.output_tokens ?? 0} />
              <TokenCell label="缓存读取" value={tokens?.cache_read_tokens ?? 0} />
              <TokenCell label="缓存写入" value={tokens?.cache_write_tokens ?? 0} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
