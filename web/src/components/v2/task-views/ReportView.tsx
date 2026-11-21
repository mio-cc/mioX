"use client";

/**
 * 报告与复测记录（会话视图 tab「报告」，对照表 P1:C18、P1:C19）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/report-tab.tsx:14-90（报告）、
 * retests-tab.tsx:26-168（复测：左侧本任务漏洞分页 + 右侧复测记录）。
 * DSH 依据：DSH 无报告页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 *
 * D2 版式：PageHead（复制全文 / 刷新）+ 页内 FilterBar（报告 / 复测记录）→
 * 报告：「报告正文」Section，Markdown 放进 padded 卡，按舒适的阅读宽度排；
 * 复测：左栏漏洞选择卡（严重度点 + 标题 + 元信息，底部分页），右栏选中漏洞的概要卡 +
 * 「复测记录」卡（每次复测一行：状态点 + 状态 + 结论徽标 + 时间，说明/摘要/错误在行下）。
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { Finding, FindingRetest, Task } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import {
  Badge,
  Card,
  Dot,
  Empty,
  FilterBar,
  IconButton,
  type KitTone,
  Meta,
  Notice,
  Page,
  PageHead,
  Row,
  Section,
  Skeleton,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconCheckOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCopyOutlineRegular,
  IconListPenOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconShieldOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
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
 * 严重度对应的语义色调。
 * @param severity - 后端严重等级。
 * @returns kit 色调。
 */
function severityTone(severity: string): KitTone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  return "neutral";
}

/** 复测状态的中文与色调；未知值原样显示。 */
const RETEST_STATUS: Record<string, { label: string; tone: KitTone }> = {
  pending: { label: "排队中", tone: "neutral" },
  running: { label: "进行中", tone: "info" },
  completed: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  stopped: { label: "已停止", tone: "warning" },
};

/** 复测结论的中文与色调。 */
const RETEST_VERDICT: Record<string, { label: string; tone: KitTone }> = {
  reproduced: { label: "仍可复现", tone: "danger" },
  fixed: { label: "已修复", tone: "success" },
  inconclusive: { label: "无法判定", tone: "neutral" },
};

/**
 * 一次复测的显示时间：结束 > 开始 > 创建。
 * @param row - 复测记录。
 * @returns 格式化时间。
 */
function retestTime(row: FindingRetest): string {
  return formatFindingTime(row.finished_at ?? row.started_at ?? row.created_at);
}

/**
 * 右栏复测记录：某个漏洞的复测历史。
 * @param props.findingId - 漏洞 id。
 * @returns 「复测记录」Section。
 */
function RetestHistory({ findingId }: { findingId: string }): ReactNode {
  const retests = useFindingRetests(findingId);
  return (
    <Section
      title="复测记录"
      count={retests.phase === "ready" && retests.items.length > 0 ? `${retests.items.length} 次` : undefined}
    >
      {retests.phase === "loading" ? (
        <Card>
          <Skeleton label="加载复测记录" />
        </Card>
      ) : null}
      {retests.phase === "offline" ? <Notice tone="danger">复测记录读取失败。</Notice> : null}
      {retests.phase === "ready" && retests.items.length === 0 ? (
        <Card>
          <Empty inCard title="还没有复测记录" text="对这个漏洞发起复测后，每一次的状态、结论和摘要都会按时间列在这里。" />
        </Card>
      ) : null}
      {retests.phase === "ready" && retests.items.length > 0 ? (
        <Card>
          {retests.items.map((row) => {
            const status = RETEST_STATUS[row.status] ?? { label: row.status, tone: "neutral" as KitTone };
            const verdict = row.verdict === "" ? null : (RETEST_VERDICT[row.verdict] ?? { label: row.verdict, tone: "neutral" as KitTone });
            const active = findingRetestActive(row);
            const hasBody = row.notes !== "" || row.summary !== "" || row.error !== "";
            return (
              <Row
                key={row.id}
                top={hasBody}
                data={{ "data-retest-id": String(row.id), "data-status": row.status }}
                lead={<span className={css.retestDot}><Dot tone={status.tone} pulse={active} /></span>}
                label={status.label}
                labelAdornment={verdict === null ? null : <Badge tone={verdict.tone}>{verdict.label}</Badge>}
                description={
                  <span className={css.retestBody}>
                    <Meta items={[retestTime(row), active ? <span key="live" className={css.live}>进行中</span> : null, `#${row.id}`]} />
                    {row.notes !== "" ? <span className={css.retestNote}>说明：{row.notes}</span> : null}
                    {row.summary !== "" ? <span className={css.retestSummary}>{row.summary}</span> : null}
                    {row.error !== "" ? (
                      <span className={css.retestError} role="alert">
                        失败：{row.error}
                      </span>
                    ) : null}
                  </span>
                }
              />
            );
          })}
        </Card>
      ) : null}
    </Section>
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

  const hasReport = report.phase === "ready" && report.text.trim() !== "";
  const charCount = hasReport ? report.text.trim().length : 0;

  return (
    <Page data={{ "data-report-view": "" }}>
      <div className={css.head}>
        <PageHead
          title="报告"
          lead={
            pane === "report"
              ? "agent 汇总产出的 Markdown 报告全文；复测记录里可以逐个漏洞查看每一次复测的结论。"
              : "按漏洞查看复测历史：左侧选择本任务的漏洞，右侧列出它的每一次复测。"
          }
          actions={
            pane === "report" ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
                  disabled={report.text === ""}
                  data-report-copy=""
                  onClick={copy}
                >
                  {copied ? "已复制" : "复制全文"}
                </Button>
                <IconButton
                  label="刷新"
                  spinning={report.phase === "loading"}
                  onClick={report.reload}
                  data-report-refresh=""
                >
                  <IconRefreshOutlineRegular size={14} />
                </IconButton>
              </>
            ) : undefined
          }
        />
        <FilterBar
          id="report-pane"
          label="报告或复测记录"
          value={pane}
          options={PANE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(next) => setPane(next as Pane)}
        />
      </div>

      {pane === "report" ? (
        <Section
          title="报告正文"
          count={hasReport ? `${charCount.toLocaleString("zh-CN")} 字` : undefined}
          hint={hasReport ? "Markdown" : undefined}
        >
          {report.phase === "loading" && report.text === "" ? (
            <Card>
              <Skeleton label="加载报告" />
            </Card>
          ) : null}
          {report.phase === "offline" ? (
            <Notice
              tone="danger"
              action={
                <Button variant="ghost" size="sm" onClick={report.reload}>
                  重试
                </Button>
              }
            >
              报告读取失败：{report.error}
            </Notice>
          ) : null}
          {report.phase === "ready" && report.text.trim() === "" ? (
            <Card>
              <Empty
                inCard
                icon={<IconListPenOutlineRegular size={18} />}
                title="还没有报告"
                text="等 agent 汇总产出报告后，这里会显示 Markdown 全文，可一键复制。"
              />
            </Card>
          ) : null}
          {hasReport ? (
            <Card padded className={css.reportCard} data={{ "data-report-body": "" }}>
              <div className={css.markdown}>
                <MarkdownText text={report.text} labels={MD_LABELS} />
              </div>
            </Card>
          ) : null}
        </Section>
      ) : (
        <RetestsPane taskId={task.id} />
      )}
    </Page>
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

  if (findings.phase === "loading") {
    return (
      <Section title="本任务漏洞">
        <Card>
          <Skeleton label="加载本任务漏洞" />
        </Card>
      </Section>
    );
  }
  if (findings.phase === "offline") {
    return (
      <Notice
        tone="danger"
        action={
          <Button variant="ghost" size="sm" onClick={findings.reload}>
            重试
          </Button>
        }
      >
        漏洞读取失败：{findings.error}
      </Notice>
    );
  }
  if (findings.total === 0) {
    return (
      <Card>
        <Empty
          icon={<IconShieldOutlineRegular size={18} />}
          title="本任务还没有漏洞"
          text="发现漏洞并发起复测后，可以在这里按漏洞查看每一次复测的状态与结论。"
        />
      </Card>
    );
  }

  return (
    <div className={css.retestsGrid}>
      <Section title="选择漏洞" count={findings.total}>
        <Card className={css.pickCard}>
          <ul className={css.pickList}>
            {findings.items.map((row: Finding) => {
              const on = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className={css.pick}
                    aria-pressed={on}
                    data-finding-row={row.id}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <span className={css.pickDot}>
                      <Dot tone={severityTone(row.severity)} />
                    </span>
                    <span className={css.pickText}>
                      <span className={css.pickTitle} title={findingLabel(row)}>
                        {findingLabel(row)}
                      </span>
                      <Meta items={[severityLabel(row.severity), findingStatusLabel(row.status)]} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pageCount > 1 ? (
            <div className={css.pager}>
              <span className={css.pageInfo}>
                {page} / {pageCount}
              </span>
              <IconButton
                label="上一页漏洞"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <IconChevronLeftOutlineRegular size={14} />
              </IconButton>
              <IconButton
                label="下一页漏洞"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <IconChevronRightOutlineRegular size={14} />
              </IconButton>
            </div>
          ) : null}
        </Card>
      </Section>

      <div className={css.detailCol}>
        {selected === null ? (
          <Card>
            <Empty inCard title="选择一个漏洞" text="在左侧选择漏洞，查看它的复测记录。" />
          </Card>
        ) : (
          <>
            <Section title="漏洞">
              <Card>
                <Row
                  top={selected.summary !== ""}
                  lead={<span className={css.retestDot}><Dot tone={severityTone(selected.severity)} /></span>}
                  label={<span title={findingLabel(selected)}>{findingLabel(selected)}</span>}
                  labelAdornment={<Badge tone={severityTone(selected.severity)}>{severityLabel(selected.severity)}</Badge>}
                  description={
                    <span className={css.retestBody}>
                      <Meta items={[findingStatusLabel(selected.status), selected.ts === "" ? null : formatFindingTime(selected.ts)]} />
                      {selected.summary !== "" ? <span className={css.findingSummary}>{selected.summary}</span> : null}
                    </span>
                  }
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconRightUpOutlineRegular size={14} />}
                    data-finding-open=""
                    onClick={() => openFindingDetail(selected.id)}
                  >
                    打开详情
                  </Button>
                </Row>
              </Card>
            </Section>
            <RetestHistory findingId={selected.id} />
          </>
        )}
      </div>
    </div>
  );
}
