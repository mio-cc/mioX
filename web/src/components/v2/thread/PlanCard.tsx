"use client";

/**
 * Plan card in the conversation stream.
 *
 * One card per plan submitted through `exit_plan_mode`: a document tile, the
 * plan's heading, a "计划" badge and the review state, then the Markdown body
 * clipped to its first 8 source lines under a fade, expanded in place by
 * "展开全文". The card follows DSH's plan artifact (`ui-plan/src/client/PlanCard.tsx`:
 * tile + title + "计划 · Markdown") but keeps the text readable inline, since
 * the /v2 right panel has no document tab for it.
 *
 * Review state: an undecided review (the task's pending plan review) reads
 * "待审批"; a decided one reads its recorded outcome from the approval history
 * (`audit.effective_action`): 已批准 / 已要求修改 / 未批准.
 */
import { useMemo, useState } from "react";

import { Badge } from "@/components/v2/design/Kit";
import { fetchActivityDetail } from "@/v2/data/message-detail";
import { usePlanMode, usePlanOutcome } from "@/v2/data/plan-review";
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconPlanOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { MarkdownText } from "@/vendor/dsh/primitives/markdown/MarkdownText";

import { MARKDOWN_LABELS } from "./thread-labels";
import css from "./ThreadView.module.css";

/** Source lines shown before the fade. */
const PREVIEW_LINES = 8;

export interface PlanCardProps {
  readonly seq: number;
  readonly taskId: string | null;
  readonly title: string;
  readonly markdown: string;
  /** The body is a prefix of the plan; the full text is read on expand. */
  readonly truncated: boolean;
  readonly reviewId: number | null;
  /** Revision notes sent with "继续规划". */
  readonly feedback?: string;
  /** Submission failed after the plan was saved (e.g. no review channel). */
  readonly failure?: string;
}

/** Drop the leading `# heading` line: the card header already shows it. */
function bodyOf(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && /^\s*#\s+/.test(lines[first])) lines.splice(0, first + 1);
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return lines.join("\n");
}

/**
 * Cut a Markdown body after `count` source lines without leaving a fence open.
 * @returns the preview and whether anything was cut.
 */
function previewOf(body: string, count: number): { text: string; cut: boolean } {
  const lines = body.split("\n");
  if (lines.length <= count) return { text: body, cut: false };
  const head = lines.slice(0, count);
  const fences = head.filter((line) => /^\s*(```|~~~)/.test(line)).length;
  if (fences % 2 === 1) head.push("```");
  return { text: head.join("\n"), cut: true };
}

/**
 * Render one plan card.
 * @param props - plan block fields and the task id.
 * @returns the card.
 */
export function PlanCard({ seq, taskId, title, markdown, truncated, reviewId, feedback, failure }: PlanCardProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const planState = usePlanMode(taskId);
  const pending = reviewId !== null && planState.review?.id === reviewId;
  // A review is only known to be settled once the task state has been read.
  const outcome = usePlanOutcome(reviewId, pending || planState.phase !== "ready");

  const body = useMemo(() => bodyOf(full ?? markdown), [full, markdown]);
  const preview = useMemo(() => previewOf(body, PREVIEW_LINES), [body]);
  const expandable = preview.cut || truncated;

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!truncated || full !== null || taskId === null) return;
    setLoading(true);
    setLoadError(null);
    fetchActivityDetail(taskId, seq)
      .then((text) => {
        if (text.trim() !== "") setFull(text);
      })
      .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  };

  const status = pending ? (
    <Badge tone="warning">待审批</Badge>
  ) : outcome === "approved" ? (
    <Badge tone="success">已批准</Badge>
  ) : outcome === "revise" ? (
    <Badge tone="info">已要求修改</Badge>
  ) : outcome === "dismissed" ? (
    <Badge tone="neutral">未批准</Badge>
  ) : failure !== undefined ? (
    <Badge tone="danger">未提交审阅</Badge>
  ) : null;

  return (
    <section
      className={css.planCard}
      data-plan-card={seq}
      data-plan-review-id={reviewId ?? undefined}
      data-plan-state={pending ? "pending" : (outcome ?? "unknown")}
      aria-label={`计划：${title}`}
    >
      <header className={css.planHead}>
        <span className={css.planTile} aria-hidden="true">
          <IconPlanOutlineRegular size={16} />
        </span>
        <span className={css.planHeading}>
          <span className={css.planTitle}>{title}</span>
          <span className={css.planSub}>计划 · Markdown</span>
        </span>
        <span className={css.planBadges}>
          <Badge tone="info">计划</Badge>
          {status}
        </span>
      </header>

      {body.trim() === "" ? null : (
        <div className={css.planBody} data-clipped={!open && expandable ? "true" : undefined}>
          <MarkdownText text={open ? body : preview.text} labels={MARKDOWN_LABELS} variant="compact" />
        </div>
      )}

      {loading ? <p className={css.planNote}>正在读取全文…</p> : null}
      {loadError === null ? null : (
        <p className={css.planNote} role="alert">
          全文读取失败：{loadError}
        </p>
      )}
      {feedback === undefined || feedback === "" ? null : (
        <p className={css.planFeedback}>
          <span className={css.planFeedbackLabel}>修改意见</span>
          {feedback}
        </p>
      )}
      {failure === undefined ? null : (
        <p className={css.planNote} role="status">
          {failure}
        </p>
      )}

      {expandable ? (
        <button type="button" className={css.planToggle} aria-expanded={open} data-plan-expand={seq} onClick={toggle}>
          {open ? "收起" : "展开全文"}
          {open ? <IconChevronUpOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
        </button>
      ) : null}
    </section>
  );
}
