"use client";

import * as React from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ArrowLeft, ArrowUpRight, ChevronDown, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/copy-button";
import { FindingRetestPanel } from "@/components/finding-retest-panel";
import { FindingTrafficPanel } from "@/components/finding-traffic-panel";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { statusMeta } from "@/lib/status";
import type { Finding, FindingStatus, Severity } from "@/lib/types";

import styles from "./detail.module.css";
import { FindingLineageView } from "./lineage";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const FINDING_STATUSES: FindingStatus[] = [
  "pending",
  "in_progress",
  "confirmed",
  "resolved",
  "fixed",
  "false_positive",
  "ignored",
  "duplicate",
  "risk_accepted",
];

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString("zh-CN");
}

/** One label/value line in the status panel. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldValue}>{children}</div>
    </div>
  );
}

/**
 * Compact harness picker: a quiet chip that opens a keyboard-navigable list. Same
 * interaction as the task list picker so the two surfaces feel like one product
 * (the shadcn Select it replaces looked nothing like the rest of the harness).
 */
function HxPicker<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<{ value: T; label: string; node: React.ReactNode }>;
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
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {current?.node}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className={styles.pickerList}
          role="listbox"
          tabIndex={-1}
          ref={listRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((prev) => Math.min(options.length - 1, prev + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((prev) => Math.max(0, prev - 1));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              commit(cursor);
            }
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={styles.pickerItem}
              data-cursor={index === cursor || undefined}
              data-testid={`${testId}-option-${option.value}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => commit(index)}
            >
              {option.node}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FindingDetailInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const contextTaskId = searchParams.get("context_task") ?? "";
  const [finding, setFinding] = React.useState<Finding | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [tab, setTab] = React.useState<"overview" | "lineage">("overview");

  const load = React.useCallback(() => {
    if (!id) {
      setLoaded(true);
      return;
    }
    api
      .getFinding(id, contextTaskId || undefined)
      .then((f) => setFinding(f))
      .catch(() => setFinding(null))
      .finally(() => setLoaded(true));
  }, [contextTaskId, id]);
  React.useEffect(() => {
    load();
  }, [load]);

  const changeSeverity = React.useCallback(
    async (next: Severity) => {
      if (!finding || finding.inherited || next === finding.severity) return;
      const prev = finding.severity;
      setFinding({ ...finding, severity: next });
      try {
        const updated = await api.setFindingSeverity(id, next);
        setFinding(updated);
        toast.success(`严重等级已改为「${statusMeta("severity", next).label}」`);
      } catch (e) {
        setFinding((cur) => (cur ? { ...cur, severity: prev } : cur));
        toast.error("更新失败：" + (e as Error).message);
      }
    },
    [finding, id],
  );

  const changeStatus = React.useCallback(
    async (next: FindingStatus) => {
      if (!finding || finding.inherited || next === finding.status) return;
      const prev = finding.status;
      setFinding({ ...finding, status: next });
      try {
        const updated = await api.setFindingStatus(id, next);
        setFinding(updated);
        toast.success(`处理状态已改为「${statusMeta("finding", next).label}」`);
      } catch (e) {
        setFinding((cur) => (cur ? { ...cur, status: prev } : cur));
        toast.error("更新失败：" + (e as Error).message);
      }
    },
    [finding, id],
  );

  if (!finding) {
    return (
      <div className={styles.root}>
        <div className={styles.empty} data-testid="finding-empty">
          <ShieldAlert size={20} aria-hidden="true" />
          <span>{loaded ? `未找到发现 ${id}` : "加载中…"}</span>
          {loaded ? (
            <Link href="/function/findings" className={styles.link}>
              <ArrowLeft size={13} aria-hidden="true" /> 返回发现列表
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const title = finding.name || finding.vulnclass || "未分类";
  const severityOptions = SEVERITIES.map((sv) => ({
    value: sv,
    label: statusMeta("severity", sv).label,
    node: <StatusBadge domain="severity" value={sv} dot />,
  }));
  const statusOptions = FINDING_STATUSES.map((st) => ({
    value: st,
    label: statusMeta("finding", st).label,
    node: <StatusBadge domain="finding" value={st} dot />,
  }));

  return (
    <div className={styles.root} data-testid="finding-detail">
      <header className={styles.head}>
        <div className={styles.headRow}>
          <Link href="/function/findings" className={styles.iconBtn} aria-label="返回发现列表" title="返回发现列表">
            <ArrowLeft size={15} aria-hidden="true" />
          </Link>
          <ShieldAlert size={14} aria-hidden="true" style={{ color: "var(--ax-text-tertiary)" }} />
          <h1 className={styles.title} title={title}>
            {title}
          </h1>
          <code className={styles.idChip}>#{finding.id}</code>
          <StatusBadge domain="severity" value={finding.severity} dot />
          <StatusBadge domain="finding" value={finding.status} dot />
          {finding.inherited && finding.source_task_id ? (
            <code className={styles.idChip}>来源任务 #{finding.source_task_id} · 只读</code>
          ) : null}
        </div>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            className={styles.tab}
            data-active={tab === "overview" || undefined}
            aria-selected={tab === "overview"}
            data-testid="finding-tab-overview"
            onClick={() => setTab("overview")}
          >
            概览
          </button>
          <button
            type="button"
            role="tab"
            className={styles.tab}
            data-active={tab === "lineage" || undefined}
            aria-selected={tab === "lineage"}
            data-testid="finding-tab-lineage"
            onClick={() => setTab("lineage")}
          >
            链路图
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {tab === "overview" ? (
          <div className={styles.grid}>
            <div className={styles.col}>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.panelTitle}>摘要</span>
                </div>
                <div className={styles.panelBody}>
                  <p className={styles.summaryText}>{finding.summary || "（无摘要）"}</p>
                </div>
              </section>

              <FindingRetestPanel key={id} findingId={id} readOnly={finding.inherited} onCompleted={load} />

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.panelTitle}>证据 / PoC</span>
                  {finding.evidence ? <CopyButton text={finding.evidence} successMessage="已复制证据" /> : null}
                </div>
                <div className={styles.panelBody}>
                  {finding.evidence ? (
                    <pre className={styles.code}>{finding.evidence}</pre>
                  ) : (
                    <p className={styles.muted}>（无证据）</p>
                  )}
                </div>
              </section>

              <FindingTrafficPanel
                key={id}
                findingId={id}
                contextTask={contextTaskId || undefined}
                readOnly={finding.inherited}
                onChanged={load}
              />

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.panelTitle}>详细报告</span>
                  {finding.report ? <CopyButton text={finding.report} successMessage="已复制详细报告" /> : null}
                </div>
                <div className={styles.panelBody}>
                  {finding.report_stale ? (
                    <p className={styles.notice} data-testid="finding-report-stale">
                      流量证据已变更，详细报告待更新。
                    </p>
                  ) : null}
                  {finding.report ? <Markdown text={finding.report} /> : <p className={styles.muted}>暂无详细报告。</p>}
                </div>
              </section>
            </div>

            <div className={styles.col}>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <span className={styles.panelTitle}>状态</span>
                </div>
                <div className={styles.panelBody}>
                  <FieldRow label="漏洞 ID">
                    <code className={styles.mono}>#{finding.id}</code>
                  </FieldRow>

                  <FieldRow label="严重等级">
                    {finding.inherited ? (
                      <StatusBadge domain="severity" value={finding.severity} dot />
                    ) : (
                      <HxPicker
                        value={finding.severity}
                        options={severityOptions}
                        onChange={(next) => void changeSeverity(next)}
                        testId="finding-severity-picker"
                      />
                    )}
                  </FieldRow>

                  <FieldRow label="处理状态">
                    {finding.inherited ? (
                      <StatusBadge domain="finding" value={finding.status} dot />
                    ) : (
                      <HxPicker
                        value={finding.status}
                        options={statusOptions}
                        onChange={(next) => void changeStatus(next)}
                        testId="finding-status-picker"
                      />
                    )}
                  </FieldRow>

                  <FieldRow label="漏洞类型">
                    {finding.vulnclass ? <code className={styles.mono}>{finding.vulnclass}</code> : <span className={styles.muted}>—</span>}
                  </FieldRow>

                  <FieldRow label="涉及资产">
                    {finding.assets && finding.assets.length > 0 ? (
                      <div className={styles.assetList}>
                        {finding.assets.map((a) => (
                          <code key={a.id} className={styles.mono} title={`${a.type} · ${a.label}`}>
                            {a.label}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </FieldRow>

                  <FieldRow label="所属任务">
                    {finding.task_id ? (
                      <Link
                        href={`/function/tasks/detail?id=${finding.task_id}`}
                        className={styles.link}
                        title={finding.task_description}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {finding.task_description || `#${finding.task_id}`}
                        </span>
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </Link>
                    ) : (
                      <span className={styles.muted}>—（任务已删除）</span>
                    )}
                  </FieldRow>

                  <FieldRow label="发现时间">
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTime(finding.ts)}</span>
                  </FieldRow>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <FindingLineageView findingId={finding.id} />
        )}
      </div>
    </div>
  );
}

// useSearchParams must sit under a Suspense boundary for static export.
export default function FindingDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <FindingDetailInner />
    </React.Suspense>
  );
}
