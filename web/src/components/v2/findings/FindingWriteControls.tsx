"use client";

/**
 * Write controls of the finding detail (C6 / C7 / C10 write surface).
 *
 * Reference behaviour and wording come from the old pages: the severity/status
 * pickers and the evidence copy button (`app/(main)/function/findings/detail/page.tsx:340-364`,
 * `:292-304`), the retest panel + start dialog (`components/finding-retest-panel.tsx:83-185`,
 * `components/finding-retest-dialog.tsx:54-90`), and the edit / deepen / delete
 * actions that only lived on the list row (`findings-table.tsx:283-323`,
 * `findings/page.tsx:665-754`). The detail page has no row to hang them on, so
 * they are lifted into the header.
 *
 * The pickers use the vendored DSH `Menu` primitive; dialogs use the vendored
 * `Modal`. No control writes by itself: every mutation is called from the
 * `useFindingWrite` adapter and none of them is triggered on mount.
 */
import { type ReactNode, useState } from "react";

import type { Finding, FindingRetest, FindingStatus, Severity } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconChevronDownOutlineRegular,
  IconCopyOutlineRegular,
  IconRefreshOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import {
  findingRetestActive,
  type FindingRetestsState,
  type FindingWriteFields,
} from "@/v2/data/finding-detail";
import { findingStatusLabel, severityLabel } from "@/v2/data/findings-page";

import css from "./FindingWrite.module.css";

/** Verdict wording of a finished retest (`finding-retest-panel.tsx:28`). */
const RETEST_VERDICT_LABEL: Record<string, string> = {
  reproduced: "仍可复现",
  fixed: "已修复",
  inconclusive: "无法确认",
};

/** Lifecycle wording of a retest that has no verdict yet (`finding-retest-panel.tsx:21-27`). */
const RETEST_STATUS_LABEL: Record<string, string> = {
  pending: "等待启动",
  running: "复测中",
  completed: "已完成",
  failed: "复测失败",
  stopped: "已停止",
};

/** Severity options, most severe first. */
const SEVERITY_OPTIONS: ReadonlyArray<{ value: Severity; label: string }> = [
  { value: "critical", label: severityLabel("critical") },
  { value: "high", label: severityLabel("high") },
  { value: "medium", label: severityLabel("medium") },
  { value: "low", label: severityLabel("low") },
];

/** All disposition statuses the backend accepts. */
const STATUS_OPTIONS: ReadonlyArray<{ value: FindingStatus; label: string }> = [
  "pending",
  "in_progress",
  "confirmed",
  "resolved",
  "fixed",
  "false_positive",
  "ignored",
  "duplicate",
  "risk_accepted",
].map((value) => ({ value: value as FindingStatus, label: findingStatusLabel(value) }));

/**
 * Anchored select built on the vendored DSH `Menu`.
 * @param props.field - `severity` / `status`; exposed as `data-finding-picker`.
 */
export function FindingPicker(props: {
  field: string;
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (next: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const selected = props.options.find((option) => option.value === props.value);
  return (
    <Menu
      open={open}
      anchor={
        <button
          type="button"
          className={css.pickerTrigger}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={props.ariaLabel}
          disabled={props.disabled}
          data-finding-picker={props.field}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={css.pickerValue}>{selected?.label ?? props.value}</span>
          <IconChevronDownOutlineRegular size={12} className={css.pickerCaret} />
        </button>
      }
      items={props.options.map((option) => ({
        id: option.value,
        label: <span data-finding-option={option.value}>{option.label}</span>,
      }))}
      selectedId={props.value}
      selection="check"
      onSelect={(id) => {
        setOpen(false);
        if (id !== props.value) props.onChange(id);
      }}
      onClose={() => setOpen(false)}
    />
  );
}

/** Severity picker of the status panel. */
export function FindingSeverityPicker(props: {
  value: Severity;
  disabled?: boolean;
  onChange: (next: Severity) => void;
}): ReactNode {
  return (
    <FindingPicker
      field="severity"
      ariaLabel="严重等级"
      value={props.value}
      options={SEVERITY_OPTIONS}
      disabled={props.disabled}
      onChange={(next) => props.onChange(next as Severity)}
    />
  );
}

/** Disposition picker of the status panel. */
export function FindingStatusPicker(props: {
  value: FindingStatus;
  disabled?: boolean;
  onChange: (next: FindingStatus) => void;
}): ReactNode {
  return (
    <FindingPicker
      field="status"
      ariaLabel="处理状态"
      value={props.value}
      options={STATUS_OPTIONS}
      disabled={props.disabled}
      onChange={(next) => props.onChange(next as FindingStatus)}
    />
  );
}

/**
 * Copy the evidence / PoC text to the clipboard (`detail/page.tsx:292-304`).
 * @param props.text - evidence body; the caller only renders this when non-empty.
 */
export function FindingCopyButton(props: { text: string; label: string }): ReactNode {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.text);
      setState("done");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1600);
  };
  return (
    <button
      type="button"
      className={css.copyBtn}
      data-finding-action="copy-evidence"
      aria-label={props.label}
      onClick={() => void copy()}
    >
      {state === "done" ? (
        "已复制"
      ) : state === "failed" ? (
        "复制失败"
      ) : (
        <>
          <IconCopyOutlineRegular size={12} />
          {props.label}
        </>
      )}
    </button>
  );
}

/** Edit dialog: name / vulnclass / severity, the fields `updateFinding` accepts (list row edit). */
export function FindingEditDialog(props: {
  finding: Finding;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: FindingWriteFields) => Promise<boolean>;
}): ReactNode {
  const { finding } = props;
  const [name, setName] = useState(finding.name ?? "");
  const [vulnclass, setVulnclass] = useState(finding.vulnclass ?? "");
  const [severity, setSeverity] = useState<Severity>(finding.severity);

  const submit = async (): Promise<void> => {
    const fields: FindingWriteFields = {};
    if (name.trim() !== (finding.name ?? "")) fields.name = name.trim();
    if (vulnclass.trim() !== (finding.vulnclass ?? "")) fields.vulnclass = vulnclass.trim();
    if (severity !== finding.severity) fields.severity = severity;
    if (Object.keys(fields).length === 0) {
      props.onCancel();
      return;
    }
    if (await props.onSave(fields)) props.onCancel();
  };

  return (
    <Modal
      open
      onClose={props.onCancel}
      title="编辑漏洞"
      closeLabel="关闭编辑对话框"
      description={`#${finding.id}`}
      footer={
        <>
          <Button variant="outline" size="sm" disabled={props.busy} onClick={props.onCancel}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            data-finding-dialog-submit="edit"
            onClick={() => void submit()}
          >
            {props.busy ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className={css.dialogBody} data-finding-dialog="edit">
        <label className={css.fieldLabel} htmlFor="finding-edit-name">
          漏洞名称
        </label>
        <input
          id="finding-edit-name"
          className={css.input}
          value={name}
          disabled={props.busy}
          data-finding-edit="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="留空则只按类别显示"
        />
        <label className={css.fieldLabel} htmlFor="finding-edit-vulnclass">
          漏洞类别
        </label>
        <input
          id="finding-edit-vulnclass"
          className={css.input}
          value={vulnclass}
          disabled={props.busy}
          data-finding-edit="vulnclass"
          onChange={(event) => setVulnclass(event.target.value)}
          placeholder="例如 SSRF/凭据泄露"
        />
        <span className={css.fieldLabel}>严重等级</span>
        <FindingPicker
          field="edit-severity"
          ariaLabel="编辑严重等级"
          value={severity}
          options={SEVERITY_OPTIONS}
          disabled={props.busy}
          onChange={(next) => setSeverity(next as Severity)}
        />
        <p className={css.fieldHint}>只提交改动过的字段；未改动的字段保持后端原值。</p>
      </div>
    </Modal>
  );
}

/** Delete confirmation: the second step the list row used before `deleteFinding`. */
export function FindingDeleteDialog(props: {
  finding: Finding;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<boolean>;
}): ReactNode {
  const { finding } = props;
  const title = finding.name || finding.vulnclass || finding.summary || `#${finding.id}`;
  return (
    <Modal
      open
      onClose={props.onCancel}
      title="确认删除该漏洞？"
      closeLabel="关闭删除确认"
      tone="warning"
      description="删除后无法撤销。"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={props.busy} data-finding-dialog-cancel="delete" onClick={props.onCancel}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            data-finding-dialog-submit="delete"
            onClick={() => void props.onConfirm()}
          >
            {props.busy ? "删除中…" : "删除"}
          </Button>
        </>
      }
    >
      <div className={css.dialogBody} data-finding-dialog="delete">
        <p className={css.warnText}>
          「{title}」将被永久删除，同时从发现列表、任务发现 Tab 与探索图中移除，此操作不可撤销。
        </p>
      </div>
    </Modal>
  );
}

/** Deepen dialog: queues a priority-10 worker intent on the finding's task. */
export function FindingDeepenDialog(props: {
  finding: Finding;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (description: string) => Promise<boolean>;
}): ReactNode {
  const { finding } = props;
  const [description, setDescription] = useState("");
  const title = finding.name || finding.vulnclass || finding.summary || `#${finding.id}`;
  return (
    <Modal
      open
      onClose={props.onCancel}
      title="深入利用漏洞"
      closeLabel="关闭深入利用对话框"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={props.busy} data-finding-dialog-cancel="deepen" onClick={props.onCancel}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy || description.trim() === ""}
            data-finding-dialog-submit="deepen"
            onClick={() => void props.onSubmit(description.trim())}
          >
            {props.busy ? "提交中…" : "创建深入意图"}
          </Button>
        </>
      }
    >
      <div className={css.dialogBody} data-finding-dialog="deepen">
        <p className={css.dialogText}>
          将在原任务 #{finding.task_id} 中创建优先级 10 的 Worker 意图，基于当前漏洞开展二次验证：
          {title}
        </p>
        <label className={css.fieldLabel} htmlFor="finding-deepen-description">
          利用描述
        </label>
        <textarea
          id="finding-deepen-description"
          className={css.textarea}
          rows={4}
          maxLength={4000}
          value={description}
          disabled={props.busy}
          data-finding-deepen="description"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="描述需要验证的利用路径、边界条件、目标或期望证据"
        />
        <p className={css.fieldHint}>新意图会继承该漏洞的资产锚点。</p>
      </div>
    </Modal>
  );
}

/** Start-retest dialog (`finding-retest-dialog.tsx:54-90`). */
function FindingRetestDialog(props: {
  findingId: string;
  findingName: string;
  busy: boolean;
  onCancel: () => void;
  onStart: (notes: string) => void;
}): ReactNode {
  const [notes, setNotes] = useState("");
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={`复测漏洞 #${props.findingId}`}
      closeLabel="关闭复测对话框"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={props.busy} data-finding-dialog-cancel="retest" onClick={props.onCancel}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            data-finding-dialog-submit="retest"
            onClick={() => props.onStart(notes.trim())}
          >
            {props.busy ? "正在创建…" : "开始复测"}
          </Button>
        </>
      }
    >
      <div className={css.dialogBody} data-finding-dialog="retest">
        <p className={css.dialogText}>
          {props.findingName !== "" ? <span className={css.dialogStrong}>{props.findingName}</span> : null}
          复测 Agent 将读取原证据和测试约束，在独立会话中执行针对性验证。复测成功完成且确认修复后，漏洞状态自动改为「已修复」，其他结论保留原状态。
        </p>
        <label className={css.fieldLabel} htmlFor="finding-retest-notes">
          补充说明（可选）
        </label>
        <textarea
          id="finding-retest-notes"
          className={css.textarea}
          rows={4}
          maxLength={4000}
          value={notes}
          disabled={props.busy}
          data-finding-retest-notes=""
          onChange={(event) => setNotes(event.target.value)}
          placeholder="例如：使用原测试账号验证原接口；修复版本为 v2。"
        />
        <p className={css.fieldHint}>可补充修复版本、测试条件或本次限制。</p>
      </div>
    </Modal>
  );
}

/**
 * 漏洞复测 panel: history + verdict labels + start action (`finding-retest-panel.tsx:83-185`).
 * @param props.readOnly - inherited row: no start action, the panel stays readable.
 */
export function FindingRetestSection(props: {
  findingId: string;
  findingName: string;
  readOnly: boolean;
  busy: boolean;
  state: FindingRetestsState;
  onStart: (notes: string) => Promise<FindingRetest | null>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const { state } = props;
  const running = state.items.find(findingRetestActive);
  const start = async (notes: string): Promise<void> => {
    const retest = await props.onStart(notes);
    setOpen(false);
    if (retest !== null) state.reload();
  };

  return (
    <section className={css.panel} data-finding-section="retest">
      <div className={css.panelHead}>
        <span className={css.panelTitle}>漏洞复测</span>
        <span className={css.panelHint}>在独立会话中验证当前状态，保留每次复测的结论与证据。</span>
        {running?.conversation_id != null ? (
          <a
            className={css.miniLink}
            href={`/chat?c=${running.conversation_id}`}
            title="查看正在进行的复测会话"
            data-finding-retest-link={running.id}
          >
            该漏洞正在复测
          </a>
        ) : null}
        {running ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={props.readOnly || props.busy || state.phase === "loading" || state.error !== null}
            data-finding-action="start-retest"
            onClick={() => setOpen(true)}
          >
            <IconRefreshOutlineRegular size={12} /> 发起复测
          </Button>
        )}
      </div>
      <div className={css.panelBody}>
        {state.error !== null ? (
          <p className={css.errorLine} data-finding-retest-error="">
            加载复测记录失败：{state.error}
            <Button variant="outline" size="sm" onClick={state.reload}>
              重试
            </Button>
          </p>
        ) : null}
        {state.error === null && state.phase === "loading" ? <p className={css.muted}>加载中…</p> : null}
        {state.error === null && state.phase === "ready" && state.items.length === 0 ? (
          <p className={css.muted} data-finding-retest-empty="">
            暂无复测记录。修复部署完成后，可发起复测并比较新旧证据。
          </p>
        ) : null}
        {state.items.map((item) => {
          const label =
            item.status === "completed" && item.verdict !== ""
              ? (RETEST_VERDICT_LABEL[item.verdict] ?? item.verdict)
              : (RETEST_STATUS_LABEL[item.status] ?? item.status);
          return (
            <div key={item.id} className={css.retestRow} data-finding-retest={item.id} data-retest-status={item.status}>
              <div className={css.retestHead}>
                <span
                  className={`${css.retestBadge} ${item.status === "completed" && item.verdict === "reproduced" ? css.retestDanger : ""}`}
                  data-retest-verdict={item.verdict}
                >
                  {label}
                </span>
                <span className={css.meta}>
                  #{item.id} · {new Date(item.created_at).toLocaleString("zh-CN")}
                </span>
                {item.conversation_id != null ? (
                  <a className={css.miniLink} href={`/chat?c=${item.conversation_id}`} data-finding-retest-conversation={item.id}>
                    查看会话
                  </a>
                ) : (
                  <span className={css.meta}>会话已删除</span>
                )}
              </div>
              {item.status === "completed" && item.summary !== "" ? <p className={css.retestText}>{item.summary}</p> : null}
              {item.error !== "" ? <p className={css.errorLine}>{item.error}</p> : null}
              {item.notes !== "" ? <p className={css.meta}>补充说明：{item.notes}</p> : null}
              {item.status === "completed" && item.evidence !== "" ? (
                <details className={css.retestDetails}>
                  <summary>复测证据</summary>
                  <pre className={css.code}>{item.evidence}</pre>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
      {open ? (
        <FindingRetestDialog
          findingId={props.findingId}
          findingName={props.findingName}
          busy={props.busy}
          onCancel={() => setOpen(false)}
          onStart={(notes) => void start(notes)}
        />
      ) : null}
    </section>
  );
}
