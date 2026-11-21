"use client";

/**
 * Plan review dock: while the open task has an undecided plan review, this
 * panel takes the composer's place (DSH: a pending interaction replaces the
 * whole InputBar, `ui-plan/README.zh.md:93`; Claude Code / Codex ask
 * "Implement this plan?" in the same seat).
 *
 * Three outcomes, mapped 1:1 to `POST /intercept/pending/{id}/plan-review`:
 *   - 批准并执行 (approve): the backend leaves plan mode and the turn continues;
 *   - 继续规划 (keep_planning): optional notes go back to the model as the
 *     revision request; the model resubmits a new plan;
 *   - 关闭 (dismiss): neither approve nor revise; the turn ends and plan mode
 *     stays on.
 *
 * Keys (focus inside the dock): Enter approves, Esc opens/focuses the notes,
 * Ctrl/Cmd+Enter in the notes sends them. A 409 means another surface (the right
 * panel, another tab) decided first: the dock says so and refreshes.
 */
import * as React from "react";

import { toast } from "@/components/v2/settings/Toast";
import { decidePlanReview, type PendingPlanReview, type PlanDecision } from "@/v2/data/plan-review";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconChevronRightOutlineRegular, IconPlanOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Tooltip } from "@/vendor/dsh/primitives/Tooltip";

import css from "./PlanReviewDock.module.css";

export interface PlanReviewDockProps {
  readonly review: PendingPlanReview;
  /** Re-read the task's plan state (after a decision or a conflict). */
  readonly onSettled: () => void;
  /** Visual density: the right panel uses the compact variant. */
  readonly variant?: "dock" | "panel";
}

const DISMISS_HINT = "不批准也不修改：结束本轮，计划模式保持开启";

/**
 * Scroll the conversation to the plan card of this review and flash it.
 * @param reviewId - pending id.
 * @returns whether a card was found.
 */
export function revealPlanCard(reviewId: number): boolean {
  const card =
    document.querySelector<HTMLElement>(`[data-plan-review-id="${reviewId}"]`) ??
    Array.from(document.querySelectorAll<HTMLElement>("[data-plan-card]")).at(-1) ??
    null;
  if (card === null) return false;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.removeAttribute("data-plan-flash");
  // Restart the one-shot ring on repeated presses.
  void card.offsetWidth;
  card.setAttribute("data-plan-flash", "");
  window.setTimeout(() => card.removeAttribute("data-plan-flash"), 1500);
  return true;
}

/**
 * Render the review panel.
 * @param props - the pending review and the refresh callback.
 * @returns the dock.
 */
export function PlanReviewDock({ review, onSettled, variant = "dock" }: PlanReviewDockProps): React.ReactNode {
  const [revising, setRevising] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState<PlanDecision | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const notesRef = React.useRef<HTMLTextAreaElement | null>(null);
  const approveRef = React.useRef<HTMLButtonElement | null>(null);

  // A new review starts clean.
  React.useEffect(() => {
    setRevising(false);
    setNotes("");
    setError(null);
    setBusy(null);
  }, [review.id]);

  // The dock replaces the editor: keep the keyboard inside it so Enter approves.
  React.useEffect(() => {
    if (variant !== "dock") return;
    const active = document.activeElement;
    if (active === null || active === document.body || active.closest("[data-composer-panel]") !== null) {
      approveRef.current?.focus({ preventScroll: true });
    }
  }, [review.id, variant]);

  React.useEffect(() => {
    if (revising) notesRef.current?.focus();
  }, [revising]);

  const decide = (decision: PlanDecision): void => {
    if (busy !== null) return;
    setBusy(decision);
    setError(null);
    void decidePlanReview(review.id, decision, decision === "keep_planning" ? notes : "")
      .then((result) => {
        if (result.ok) {
          toast(
            decision === "approve"
              ? "已批准计划，开始执行"
              : decision === "keep_planning"
                ? "已请求继续规划"
                : "已关闭计划审阅，计划模式保持开启",
          );
          onSettled();
          return;
        }
        if (result.conflict) {
          toast("此计划已在别处处理");
          onSettled();
          return;
        }
        setError(result.message);
      })
      .finally(() => setBusy(null));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    const inNotes = event.target === notesRef.current;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setRevising(true);
      notesRef.current?.focus();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.repeat) return;
    if (event.ctrlKey || event.metaKey) {
      if (!revising) return;
      event.preventDefault();
      decide("keep_planning");
      return;
    }
    if (inNotes) return; // plain Enter types a newline in the notes
    const target = event.target;
    if (target instanceof HTMLButtonElement && target !== approveRef.current) return; // the focused button acts
    event.preventDefault();
    decide("approve");
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the region routes its documented shortcuts.
    <div
      ref={rootRef}
      className={variant === "panel" ? `${css.dock} ${css.panel}` : css.dock}
      role="region"
      aria-label={`计划待审批：${review.title}`}
      aria-busy={busy !== null ? true : undefined}
      data-plan-review-dock={review.id}
      onKeyDown={onKeyDown}
    >
      <div className={css.head}>
        <span className={css.tile} aria-hidden="true">
          <IconPlanOutlineRegular size={16} />
        </span>
        <div className={css.heading}>
          <span className={css.eyebrow}>
            <span className={css.pulse} aria-hidden="true" />
            计划待审批
          </span>
          <span className={css.title} title={review.title}>
            {review.title}
          </span>
        </div>
        <button
          type="button"
          className={css.reveal}
          data-plan-review-reveal=""
          onClick={() => {
            if (!revealPlanCard(review.id)) toast("计划卡不在当前视图（可能在更早的历史里）");
          }}
        >
          查看计划
          <IconChevronRightOutlineRegular size={12} />
        </button>
      </div>

      {revising ? (
        <div className={css.notes}>
          <textarea
            ref={notesRef}
            className={css.textarea}
            value={notes}
            rows={3}
            maxLength={4000}
            placeholder="写下要调整的地方，例如：先不碰登录接口，补充资产范围确认"
            aria-label="修改意见"
            data-plan-review-notes=""
            disabled={busy !== null}
            onChange={(event) => setNotes(event.currentTarget.value)}
          />
          <span className={css.notesHint}>Ctrl+Enter 发送修改意见 · 可留空</span>
        </div>
      ) : null}

      {error === null ? null : (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}

      <div className={css.actions}>
        <Tooltip label={DISMISS_HINT} side="top" maxWidth={240}>
          <Button
            variant="ghost"
            size="sm"
            className={css.dismiss}
            disabled={busy !== null}
            data-plan-review-action="dismiss"
            onClick={() => decide("dismiss")}
          >
            {busy === "dismiss" ? "关闭中…" : "关闭"}
          </Button>
        </Tooltip>
        <span className={css.spacer} />
        {revising ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            data-plan-review-action="keep_planning"
            onClick={() => decide("keep_planning")}
          >
            {busy === "keep_planning" ? "发送中…" : "发送修改意见"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            data-plan-review-action="revise"
            onClick={() => setRevising(true)}
          >
            继续规划
          </Button>
        )}
        <Button
          ref={approveRef}
          variant="primary"
          size="sm"
          disabled={busy !== null}
          data-plan-review-action="approve"
          onClick={() => decide("approve")}
        >
          {busy === "approve" ? "提交中…" : "批准并执行"}
          {variant === "dock" ? <kbd className={css.kbd}>Enter</kbd> : null}
        </Button>
      </div>
    </div>
  );
}
