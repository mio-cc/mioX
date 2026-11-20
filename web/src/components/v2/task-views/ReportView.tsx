"use client";

/**
 * 报告与复测记录（会话视图 tab「报告」，对照表 P1:C18、P1:C19）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/report-tab.tsx:14-90（报告）、
 * retests-tab.tsx:26-168（复测：左侧本任务漏洞分页 + 右侧复测记录）。
 * DSH 依据：DSH 无报告页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { Finding, Task } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { MarkdownText, type MarkdownLabels } from "@/vendor/dsh/primitives/markdown/MarkdownText";
import { useFindingRetests, findingRetestActive } from "@/v2/data/finding-detail";
import { findingStatusLabel, formatFindingTime, severityLabel } from "@/v2/data/findings-page";
import { findingLabel, RETESTS_PAGE_SIZE, useTaskFindings, useTaskReport } from "@/v2/data/task-report";

import css from "./ReportView.module.css";

/** Markdown 代码块按钮文案；必须稳定（不能每次渲染新建）。 */
const MD_LABELS: MarkdownLabels = { code: { copyLabel: "复制", copiedLabel: "已复制" }, footnotes: "脚注" };

/** 页内两个子页签。 */
type Pane = "report" | "retests";

const PANE_OPTIONS: readonly { value: Pane; label: string }[] = [
  { value: "report", label: "报告" },
  { value: "retests", label: "复测记录" },
];

/**
 * 打开某个漏洞的详情（真实 SPA 导航：改地址后通知 Shell 重新读取 `?page=`）。
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
 * 复测状态对应的 Tag 色调。
 * @param status - 复测状态。
 * @returns Tag 的 tone。
 */
function retestTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "running") return "info";
  if (status === "pending") return "neutral";
  if (status === "failed") return "danger";
  return "warning";
}

/**
 * 右侧复测记录：某个漏洞的复测历史。
 * @param props.findingId - 漏洞 id。
 * @param props.findingName - 漏洞显示名。
 * @returns 复测记录列表。
 */
function RetestHistory({ findingId, findingName }: { findingId: string; findingName: string }): ReactNode {
  const retests = useFindingRetests(findingId);
  if (retests.phase === "loading") return <div className={css.state}>加载复测记录…</div>;
  if (retests.phase === "offline") return <div className={css.state}>复测记录读取失败。</div>;
  if (retests.items.length === 0) {
    return (
      <div className={css.panel}>
        <div className={css.panelHead}>
          <span className={css.panelTitle}>{findingName}</span>
        </div>
        <p className={css.empty}>这个漏洞还没有复测记录。</p>
      </div>
    );
  }
  return (
    <div className={css.panel}>
      <div className={css.panelHead}>
        <span className={css.panelTitle}>{findingName}</span>
      </div>
      <ul className={css.retestList}>
        {retests.items.map((row) => (
          <li key={row.id} className={css.retestRow} data-retest-id={row.id} data-status={row.status}>
            <div className={css.retestHead}>
              <Tag tone={retestTone(row.status)}>{row.status}</Tag>
              {findingRetestActive(row) ? <span className={css.live}>进行中</span> : null}
              <span className={css.retestTime}>
                {formatFindingTime(row.finished_at ?? row.started_at ?? row.created_at)}
              </span>
            </div>
            {row.notes !== "" ? <p className={css.retestNote}>说明：{row.notes}</p> : null}
            {row.verdict !== "" ? <p className={css.retestNote}>结论：{row.verdict}</p> : null}
            {row.summary !== "" ? <p className={css.retestBody}>{row.summary}</p> : null}
            {row.error !== "" ? (
              <p className={css.retestError} role="alert">
                失败：{row.error}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 渲染报告 / 复测记录视图。
 * @param props.task - 当前选中的任务。
 * @returns 报告视图。
 */
export function ReportView({ task }: { task: Task }): ReactNode {
  const [pane, setPane] = useState<Pane>("report");
  const report = useTaskReport(task.id);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    if (report.text === "") return;
    navigator.clipboard
      .writeText(report.text)
      .then(() => {
        setCopied(true);
        toast("已复制 Markdown 全文");
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((reason: unknown) => {
        toast(`复制失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  return (
    <div className={css.wrap} data-report-view="">
      <div className={css.toolbar}>
        <SegmentedControl
          id="report-pane"
          label="报告或复测记录"
          value={pane}
          options={PANE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(next) => setPane(next as Pane)}
        />
        {pane === "report" ? (
          <div className={css.toolbarRight}>
            <Button
              variant="outline"
              size="sm"
              disabled={report.text === ""}
              data-report-copy=""
              onClick={copy}
            >
              {copied ? "已复制" : "复制全文"}
            </Button>
            <Button variant="outline" size="sm" onClick={report.reload} data-report-refresh="">
              刷新
            </Button>
          </div>
        ) : null}
      </div>

      {pane === "report" ? (
        <>
          {report.phase === "loading" ? <div className={css.state}>加载报告…</div> : null}
          {report.phase === "offline" ? (
            <div className={css.stateError} role="alert">
              <span>报告读取失败：{report.error}</span>
              <Button variant="outline" size="sm" onClick={report.reload}>
                重试
              </Button>
            </div>
          ) : null}
          {report.phase === "ready" && report.text.trim() === "" ? (
            <p className={css.empty}>这个任务还没有报告。等 agent 产出报告后，这里会显示 Markdown 全文。</p>
          ) : null}
          {report.phase === "ready" && report.text.trim() !== "" ? (
            <div className={css.markdownBox} data-report-body="">
              <MarkdownText text={report.text} labels={MD_LABELS} />
            </div>
          ) : null}
        </>
      ) : (
        <RetestsPane taskId={task.id} />
      )}
    </div>
  );
}

/**
 * 复测记录子页：左侧本任务漏洞分页，右侧选中漏洞的复测历史。
 * @param props.taskId - 任务 id。
 * @returns 复测记录面板。
 */
function RetestsPane({ taskId }: { taskId: string }): ReactNode {
  const [page, setPage] = useState(1);
  const findings = useTaskFindings(taskId, page, RETESTS_PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageCount = Math.max(1, Math.ceil(findings.total / RETESTS_PAGE_SIZE));

  // 列表换了就选第一条；原来选中的仍在本页时保持不变。
  useEffect(() => {
    if (findings.phase !== "ready") return;
    setSelectedId((current) => {
      if (current !== null && findings.items.some((row) => row.id === current)) return current;
      return findings.items[0]?.id ?? null;
    });
  }, [findings.phase, findings.items]);

  const selected = useMemo(
    () => findings.items.find((row) => row.id === selectedId) ?? null,
    [findings.items, selectedId],
  );

  if (findings.phase === "loading") return <div className={css.state}>加载本任务漏洞…</div>;
  if (findings.phase === "offline") {
    return (
      <div className={css.stateError} role="alert">
        <span>漏洞读取失败：{findings.error}</span>
        <Button variant="outline" size="sm" onClick={findings.reload}>
          重试
        </Button>
      </div>
    );
  }
  if (findings.total === 0) {
    return <p className={css.empty}>本任务还没有漏洞。发现漏洞后，可以在这里查看复测记录。</p>;
  }

  return (
    <div className={css.retestsGrid}>
      <div className={css.listPane}>
        <div className={css.listHead}>选择漏洞 · {findings.total}</div>
        <ul className={css.findingsList}>
          {findings.items.map((row: Finding) => (
            <li key={row.id}>
              <button
                type="button"
                className={css.findingRow}
                aria-pressed={row.id === selectedId}
                data-finding-row={row.id}
                onClick={() => setSelectedId(row.id)}
              >
                <span className={css.findingTitle}>{findingLabel(row)}</span>
                <span className={css.findingMeta}>
                  <Tag tone="outline">{severityLabel(row.severity)}</Tag>
                  <Tag tone="outline">{findingStatusLabel(row.status)}</Tag>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {pageCount > 1 ? (
          <div className={css.pager}>
            <Button
              variant="outline"
              size="sm"
              aria-label="上一页漏洞"
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
              aria-label="下一页漏洞"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            >
              下一页
            </Button>
          </div>
        ) : null}
      </div>
      <div className={css.detailPane}>
        {selected === null ? (
          <p className={css.empty}>选择左侧的一个漏洞查看复测记录。</p>
        ) : (
          <>
            <div className={css.detailHead}>
              <span className={css.detailTitle}>{findingLabel(selected)}</span>
              <Button variant="outline" size="sm" data-finding-open="" onClick={() => openFindingDetail(selected.id)}>
                打开漏洞详情
              </Button>
            </div>
            {selected.summary !== "" ? <p className={css.detailSummary}>{selected.summary}</p> : null}
            <RetestHistory findingId={selected.id} findingName={findingLabel(selected)} />
          </>
        )}
      </div>
    </div>
  );
}
