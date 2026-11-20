"use client";

/**
 * Finding detail: the second level of the findings page (C1–C7, C10).
 *
 * It mirrors `app/(main)/function/findings/detail/page.tsx:233-407`: the same
 * header badges (C3), the 概览/链路图 tab strip (C4), 摘要 (C5), 证据 / PoC (C7)
 * and the 状态 panel with the 严重等级/处理状态 pickers (C10). This unit adds the
 * write surface (previously deferred): the two pickers, the 复测 panel (C6), the
 * evidence copy button, and the edit / delete / deepen actions that the old
 * list row owned (`findings-table.tsx:283-323`, `findings/page.tsx:665-754`).
 *
 * Inherited rows stay read-only: badges instead of pickers, no retest/edit/
 * delete/deepen control, because the backend resolves them from another task.
 *
 * The 链路图 tab is still the tab-strip skeleton only: the lineage read (C11)
 * belongs to a later unit and shows an explicit "not connected" state instead
 * of a fabricated graph. The 所属任务 row stays plain text for the same reason
 * recorded by the read unit: the /v2 shell keeps the session in component state
 * and exposes no task URL.
 */
import { type ReactNode, useState } from "react";

import type { Finding } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconChevronLeftOutlineRegular,
  IconEditOutlineRegular,
  IconPlayOutlineRegular,
  IconShieldOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningTriangleOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  findingAssetLabels,
  findingTaskText,
  type FindingRetestsState,
  type FindingWriteState,
  useFindingDetail,
  useFindingRetests,
  useFindingWrite,
} from "@/v2/data/finding-detail";
import {
  findingStatusLabel,
  findingTitle,
  formatFindingDateTime,
  severityLabel,
} from "@/v2/data/findings-page";

import {
  FindingCopyButton,
  FindingDeepenDialog,
  FindingDeleteDialog,
  FindingEditDialog,
  FindingRetestSection,
  FindingSeverityPicker,
  FindingStatusPicker,
} from "./FindingWriteControls";
import { FindingTrafficPanel } from "./FindingTrafficPanel";
import { FindingLineage } from "./FindingLineage";
import css from "./FindingsDataPage.module.css";
import wcss from "./FindingWrite.module.css";

/** One label/value line in the status panel. */
function FieldRow({ label, field, children }: { label: string; field: string; children: ReactNode }): ReactNode {
  return (
    <div className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      <div className={css.fieldValue} data-finding-field={field}>
        {children}
      </div>
    </div>
  );
}

/** Severity pill class; unknown backend values fall back to the neutral pill. */
function severityClass(severity: string): string {
  switch (severity) {
    case "critical":
      return css.badgeCritical;
    case "high":
      return css.badgeHigh;
    case "medium":
      return css.badgeMedium;
    case "low":
      return css.badgeLow;
    default:
      return css.badgeInfo;
  }
}

/** Inline write feedback: the last failure, else the last success sentence. */
function WriteFeedback({ write }: { write: FindingWriteState }): ReactNode {
  if (write.failure !== null) {
    return (
      <p className={wcss.errorLine} data-finding-write="failed" role="alert">
        {write.failure}
      </p>
    );
  }
  if (write.notice !== null) {
    return (
      <p className={wcss.panelHint} data-finding-write="saved">
        {write.notice}
      </p>
    );
  }
  return null;
}

/** Tab strip + 概览/链路图 body of a loaded finding. */
function FindingBody({
  finding,
  tab,
  onSelectTab,
  write,
  retests,
  readOnly,
}: {
  finding: Finding;
  tab: "overview" | "lineage";
  onSelectTab: (next: "overview" | "lineage") => void;
  write: FindingWriteState;
  retests: FindingRetestsState;
  readOnly: boolean;
}): ReactNode {
  const assets = findingAssetLabels(finding);
  return (
    <>
      <div className={css.tabs} role="tablist" aria-label="发现详情视图">
        <button
          type="button"
          role="tab"
          className={css.tab}
          aria-selected={tab === "overview"}
          data-active={tab === "overview" || undefined}
          data-findings-tab="overview"
          onClick={() => onSelectTab("overview")}
        >
          概览
        </button>
        <button
          type="button"
          role="tab"
          className={css.tab}
          aria-selected={tab === "lineage"}
          data-active={tab === "lineage" || undefined}
          data-findings-tab="lineage"
          onClick={() => onSelectTab("lineage")}
        >
          链路图
        </button>
      </div>

      {tab === "overview" ? (
        <div className={css.detailGrid} data-findings-detail-body="overview">
          <WriteFeedback write={write} />

          <section className={css.panel} data-finding-section="summary">
            <div className={css.panelHead}>
              <span className={css.panelTitle}>摘要</span>
            </div>
            <div className={css.panelBody}>
              <p className={css.summaryText} data-finding-summary="">
                {finding.summary || "（无摘要）"}
              </p>
            </div>
          </section>

          <FindingRetestSection
            findingId={finding.id}
            findingName={finding.name || finding.vulnclass || ""}
            readOnly={readOnly}
            busy={write.busy}
            state={retests}
            onStart={write.startRetest}
          />

          {/* A14：详细报告（P2:C9）。report_stale 由后端在流量证据变更后置位。 */}
          <section className={css.panel} data-finding-section="report">
            <div className={css.panelHead}>
              <span className={css.panelTitle}>详细报告</span>
              {finding.report === undefined || finding.report === "" ? (
                <span className={wcss.panelHint}>还没有生成详细报告。</span>
              ) : (
                <FindingCopyButton text={finding.report} label="复制报告" />
              )}
            </div>
            <div className={css.panelBody}>
              {finding.report_stale === true ? (
                <p className={css.muted} data-finding-report-stale="">
                  流量证据已变更，报告待更新。
                </p>
              ) : null}
              {finding.report === undefined || finding.report === "" ? (
                <p className={css.muted}>（无报告）</p>
              ) : (
                <pre className={css.code} data-finding-report="">
                  {finding.report}
                </pre>
              )}
            </div>
          </section>

          <section className={css.panel} data-finding-section="evidence">
            <div className={css.panelHead}>
              <span className={css.panelTitle}>证据 / PoC</span>
              {finding.evidence ? <FindingCopyButton text={finding.evidence} label="复制证据" /> : null}
            </div>
            <div className={css.panelBody}>
              {finding.evidence ? (
                <pre className={css.code} data-finding-evidence="">
                  {finding.evidence}
                </pre>
              ) : (
                <p className={css.muted}>（无证据）</p>
              )}
            </div>
          </section>

          <section className={css.panel} data-finding-section="status">
            <div className={css.panelHead}>
              <span className={css.panelTitle}>状态</span>
              {readOnly ? <span className={wcss.panelHint}>继承的发现只读，不能在这里处置。</span> : null}
            </div>
            <div className={css.panelBody}>
              <FieldRow label="漏洞 ID" field="id">
                <code className={css.mono}>#{finding.id}</code>
              </FieldRow>
              <FieldRow label="严重等级" field="severity">
                {readOnly ? (
                  <span className={`${css.badge} ${severityClass(finding.severity)}`}>
                    {severityLabel(finding.severity)}
                  </span>
                ) : (
                  <FindingSeverityPicker
                    value={finding.severity}
                    disabled={write.busy}
                    onChange={(next) => void write.setSeverity(next)}
                  />
                )}
              </FieldRow>
              <FieldRow label="处理状态" field="status">
                {readOnly ? (
                  <span className={css.statusChip}>{findingStatusLabel(finding.status)}</span>
                ) : (
                  <FindingStatusPicker
                    value={finding.status}
                    disabled={write.busy}
                    onChange={(next) => void write.setStatus(next)}
                  />
                )}
              </FieldRow>
              <FieldRow label="漏洞类型" field="vulnclass">
                {finding.vulnclass ? <code className={css.mono}>{finding.vulnclass}</code> : <span className={css.muted}>—</span>}
              </FieldRow>
              <FieldRow label="涉及资产" field="assets">
                {assets.length > 0 ? (
                  <div className={css.assetList}>
                    {assets.map((asset) => (
                      <code key={asset.id} className={css.mono} data-finding-asset={asset.id}>
                        {asset.text}
                      </code>
                    ))}
                  </div>
                ) : (
                  <span className={css.muted}>—</span>
                )}
              </FieldRow>
              <FieldRow label="所属任务" field="task">
                <span
                  className={finding.task_id ? css.taskText : css.muted}
                  title={finding.task_description ?? undefined}
                >
                  {findingTaskText(finding)}
                </span>
              </FieldRow>
              <FieldRow label="发现时间" field="ts">
                <span className={css.numeric}>{formatFindingDateTime(finding.ts)}</span>
              </FieldRow>
            </div>
          </section>

          {/* A07：关联流量（P2:C8、P2:K4）。数据与写操作都在面板自己的适配器里。 */}
          <FindingTrafficPanel findingId={finding.id} contextTask={finding.task_id ?? undefined} readOnly={readOnly} />
        </div>
      ) : (
        <section className={css.panel} data-findings-detail-body="lineage" data-finding-section="lineage">
          <div className={css.panelHead}>
            <span className={css.panelTitle}>链路图</span>
          </div>
          <div className={css.panelBody}>
            <FindingLineage findingId={finding.id} />
          </div>
        </section>
      )}
    </>
  );
}

/** Edit / deepen / delete dialogs of the loaded row (opened from the header actions). */
function FindingDialogs({
  finding,
  dialog,
  write,
  onClose,
  onDeleted,
  onDeepened,
}: {
  finding: Finding;
  dialog: "edit" | "delete" | "deepen";
  write: FindingWriteState;
  onClose: () => void;
  onDeleted: () => void;
  onDeepened: () => void;
}): ReactNode {
  if (dialog === "edit") {
    return <FindingEditDialog finding={finding} busy={write.busy} onCancel={onClose} onSave={write.update} />;
  }
  if (dialog === "delete") {
    return (
      <FindingDeleteDialog
        finding={finding}
        busy={write.busy}
        onCancel={onClose}
        onConfirm={async () => {
          const removed = await write.remove();
          if (removed) {
            onClose();
            onDeleted();
          }
          return removed;
        }}
      />
    );
  }
  return (
    <FindingDeepenDialog
      finding={finding}
      busy={write.busy}
      onCancel={onClose}
      onSubmit={async (description) => {
        const outcome = await write.deepen(description);
        if (outcome !== null) {
          onClose();
          onDeepened();
        }
        return outcome !== null;
      }}
    />
  );
}

/**
 * Render one finding as a writable detail.
 * @param findingId - finding id from `?finding=`.
 * @param onBack - return to the list (Back when this page pushed the step).
 * @returns the detail header + tab body, or the loading/missing/offline state.
 */
export function FindingDetailView({ findingId, onBack }: { findingId: string; onBack: () => void }): ReactNode {
  const detail = useFindingDetail(findingId);
  const [tab, setTab] = useState<"overview" | "lineage">("overview");
  const [dialog, setDialog] = useState<"edit" | "delete" | "deepen" | null>(null);
  const write = useFindingWrite(findingId, detail.applyRow);
  const retests = useFindingRetests(findingId, detail.reload);

  const backButton = (
    <button
      type="button"
      className={css.backBtn}
      onClick={onBack}
      aria-label="返回发现列表"
      title="返回发现列表"
      data-findings-back=""
    >
      <IconChevronLeftOutlineRegular size={15} />
    </button>
  );

  if (detail.phase === "loading" || detail.phase === "idle") {
    return (
      <div className={css.detail} data-findings-detail={findingId} data-findings-detail-phase="loading">
        <header className={css.detailHead}>
          <div className={css.detailHeadRow}>{backButton}</div>
        </header>
        <div className={css.state}>加载中…</div>
      </div>
    );
  }

  if (detail.finding === null) {
    const missing = detail.phase === "missing";
    return (
      <div
        className={css.detail}
        data-findings-detail={findingId}
        data-findings-detail-phase={missing ? "missing" : "offline"}
      >
        <header className={css.detailHead}>
          <div className={css.detailHeadRow}>{backButton}</div>
        </header>
        <div className={missing ? css.empty : css.stateError} data-findings-detail-state={missing ? "missing" : "offline"}>
          <IconWarningTriangleOutlineRegular size={20} />
          <span>{missing ? `未找到发现 ${findingId}` : `未连接后端（${detail.error}）`}</span>
          {!missing ? (
            <Button variant="outline" size="sm" onClick={detail.reload} data-findings-detail-action="retry">
              重试
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onBack} data-findings-detail-action="back">
            返回发现列表
          </Button>
        </div>
      </div>
    );
  }

  const finding = detail.finding;
  const title = findingTitle(finding) || "未分类";
  const readOnly = finding.inherited === true;

  return (
    <div className={css.detail} data-findings-detail={findingId} data-findings-detail-phase="ready">
      <header className={css.detailHead}>
        <div className={css.detailHeadRow}>
          {backButton}
          <IconShieldOutlineRegular size={14} className={css.detailGlyph} />
          <h1 className={css.detailTitle} title={title} data-finding-title="">
            {title}
          </h1>
          <code className={css.idChip} data-finding-id="">
            #{finding.id}
          </code>
          <span className={`${css.badge} ${severityClass(finding.severity)}`} data-finding-severity="">
            {severityLabel(finding.severity)}
          </span>
          <span className={css.statusChip} data-finding-status="">
            {findingStatusLabel(finding.status)}
          </span>
          {finding.inherited && finding.source_task_id ? (
            <code className={css.idChip} data-finding-inherited="">
              来源任务 #{finding.source_task_id} · 只读
            </code>
          ) : null}
          {readOnly ? null : (
            <div className={wcss.actions}>
              <Button
                variant="outline"
                size="sm"
                disabled={write.busy}
                data-finding-action="edit"
                onClick={() => setDialog("edit")}
              >
                <IconEditOutlineRegular size={12} /> 编辑
              </Button>
              {finding.task_id ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={write.busy}
                  data-finding-action="deepen"
                  onClick={() => setDialog("deepen")}
                >
                  <IconPlayOutlineRegular size={12} /> 深入
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={write.busy}
                data-finding-action="delete"
                onClick={() => setDialog("delete")}
              >
                <IconTrashOutlineRegular size={12} /> 删除
              </Button>
            </div>
          )}
        </div>
      </header>
      <FindingBody
        finding={finding}
        tab={tab}
        onSelectTab={setTab}
        write={write}
        retests={retests}
        readOnly={readOnly}
      />
      {dialog === null ? null : (
        <FindingDialogs
          finding={finding}
          dialog={dialog}
          write={write}
          onClose={() => setDialog(null)}
          onDeleted={onBack}
          onDeepened={detail.reload}
        />
      )}
    </div>
  );
}
