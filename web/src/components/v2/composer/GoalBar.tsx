"use client";

/**
 * Goal bar docked above the composer, mirroring `ui-goal/GoalBar.tsx`.
 *
 * Render contract taken from the source: the strip exists only while a goal
 * snapshot is present and its phase is not `complete` — an absent (`null`) or
 * finished goal draws nothing at all (`GoalBar.tsx:87`). The strip shows the
 * goal glyph, the phase label, the truncated objective and icon actions (edit /
 * clear / pause-resume); goal creation belongs to the `/goal` command, not this
 * strip (`GoalBar.tsx:1-10`).
 *
 * Every action is a real backend mutation owned by `useTaskGoal`: the strip
 * keeps only its local pending/error/editing state (`GoalBar.tsx:44-72`), while
 * the snapshot arrives through `props.goal`.
 */
import * as React from "react";

import { RowMenu } from "@/components/v2/design/Kit";
import {
  IconCheckOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconGoalOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { GoalSnapshot } from "@/lib/types";
import type { GoalActions, GoalActionResult } from "@/v2/data/goal";
import css from "./GoalBar.module.css";

/**
 * D5 目标模式：一个概念一个名字——用户下的那一条是「目标」，planner 拆出来、由
 * prove_goal 逐条证实的是「验收项」（任务行 goals_met / goals_total）。目标条显示
 * 「验收项 3/7」进度；清除收进 ⋯ 菜单并二次确认（长任务的目标重写成本高）；
 * 「标记已达成」走 POST /goal/complete（后端 G-3）。
 */
export interface GoalProgress {
  readonly met: number;
  readonly total: number;
}

/** 进度环：14px、2px 描边，与上下文环同一画法。 */
function ProgressRing({ met, total }: GoalProgress): React.ReactNode {
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, met / total) : 0;
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" className={css.ring}>
      <circle className={css.ringTrack} cx="7" cy="7" r={radius} />
      <circle
        className={css.ringFill}
        cx="7"
        cy="7"
        r={radius}
        strokeDasharray={`${circumference * ratio} ${circumference}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

type Phase = "active" | "paused" | "blocked";

/** `ui-goal/locales.ts:5-8`; `complete` (and anything unknown) has no strip. */
const PHASE_LABEL: Record<Phase, string> = {
  active: "进行中的目标",
  paused: "已暂停的目标",
  blocked: "受阻的目标",
};

/** Phases the strip can show; `complete` hides it (`GoalBar.tsx:87`). */
function visiblePhase(phase: string): Phase | null {
  return phase === "active" || phase === "paused" || phase === "blocked" ? phase : null;
}

/**
 * Render the goal bar.
 * @param props.goal - the task's goal snapshot; `null` means goal mode is off.
 * @param props.actions - the mutations the backend exposes; absent means the
 *   surface has no goal plumbing, so the strip (whose content is all controls)
 *   stays hidden rather than rendering dead buttons.
 * @returns the bar, or null when goal mode is off or completed.
 */
export function GoalBar({
  goal,
  actions,
  progress = null,
}: {
  goal: GoalSnapshot | null;
  actions?: GoalActions;
  /** 验收项进度（任务行 goals_met / goals_total）；total=0 时不显示胶囊。 */
  progress?: GoalProgress | null;
}): React.ReactNode {
  const phase = goal === null ? null : visiblePhase(goal.phase);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [clearedGoalId, setClearedGoalId] = React.useState<string | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  /** Goal id that just turned complete: show a 4s "achieved" strip, then hide. */
  const [celebrate, setCelebrate] = React.useState<string | null>(null);
  const lastPhase = React.useRef<{ id: string; phase: string } | null>(null);
  const pendingRef = React.useRef(false);

  // A goal that transitions to `complete` while on screen gets a brief
  // confirmation instead of vanishing silently (design §3.1.2).
  React.useEffect(() => {
    if (goal === null) {
      lastPhase.current = null;
      return undefined;
    }
    const previous = lastPhase.current;
    lastPhase.current = { id: goal.id, phase: goal.phase };
    if (goal.phase === "complete" && previous !== null && previous.id === goal.id && previous.phase !== "complete") {
      setCelebrate(goal.id);
      const timer = window.setTimeout(() => setCelebrate(null), 4000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [goal]);

  // A new goal identity (cleared/completed/replaced externally) invalidates the
  // local edit state: without the reset a surviving draft's Enter would write
  // over the NEW goal (`GoalBar.tsx:51-58`).
  const goalId = goal?.id;
  React.useEffect(() => {
    setEditing(false);
    setDraft("");
    setActionError(null);
    setClearedGoalId(null);
    setConfirmClear(false);
  }, [goalId]);

  // React state disables the controls on the next render; the ref closes the
  // same-render window so rapid clicks cannot submit the same CAS twice
  // (`GoalBar.tsx:60-72`).
  const runAction = React.useCallback(
    async (action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
      if (pendingRef.current) return undefined;
      pendingRef.current = true;
      setPending(true);
      setActionError(null);
      const result = await action();
      pendingRef.current = false;
      setPending(false);
      if (!result.ok && result.error !== undefined) setActionError(result.error.message);
      return result;
    },
    [],
  );

  const save = React.useCallback(async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed === "" || actions === undefined) return;
    const result = await runAction(() => actions.edit(trimmed));
    if (result?.ok === true) setEditing(false);
  }, [actions, draft, runAction]);

  const clear = React.useCallback(
    async (clearedId: string): Promise<void> => {
      if (actions === undefined) return;
      const result = await runAction(() => actions.clear());
      if (result?.ok === true) setClearedGoalId(clearedId);
    },
    [actions, runAction],
  );

  const toggle = React.useCallback((): void => {
    if (actions === undefined) return;
    const resume = phase !== "active";
    void runAction(() => (resume ? actions.resume() : actions.pause()));
  }, [actions, phase, runAction]);

  if (actions !== undefined && goal !== null && goal.phase === "complete" && celebrate === goal.id) {
    return (
      <div className={css.dock} data-goal-bar="" data-goal-phase="complete">
        <div className={`${css.bar} ${css.doneBar}`} role="status">
          <span className={css.glyph} aria-hidden="true">
            <IconCheckOutlineRegular size={14} />
          </span>
          <span className={css.label}>目标已达成</span>
          <span className={css.objective} title={goal.objective}>
            {goal.objective}
          </span>
        </div>
      </div>
    );
  }

  // Loading, absent, unplumbed and complete goals have no strip at all.
  if (actions === undefined || goal === null || phase === null || goal.id === clearedGoalId) return null;

  if (confirmClear) {
    return (
      <div className={css.dock} data-goal-bar="" data-goal-phase={goal.phase} data-goal-confirm-clear="">
        <div className={`${css.bar} ${css.confirmBar}`} role="alertdialog" aria-label="确认清除目标">
          <span className={css.confirmText}>清除目标后不再注入系统提示；已拆出的验收项保留。</span>
          {actionError !== null ? (
            <span className={css.error} role="alert">
              {actionError}
            </span>
          ) : null}
          <div className={css.actions}>
            <button type="button" className={css.textBtn} disabled={pending} onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              type="button"
              className={`${css.textBtn} ${css.textBtnDanger}`}
              disabled={pending}
              data-goal-clear-confirm=""
              onClick={() => void clear(goal.id)}
            >
              清除目标
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={css.dock} data-goal-bar="" data-goal-phase={goal.phase} data-goal-editing="true">
        <div className={`${css.bar} ${css.editBar}`}>
          <span className={css.glyph} aria-hidden="true">
            <IconGoalOutlineRegular size={14} />
          </span>
          <input
            className={css.input}
            aria-label="目标内容"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void save();
              } else if (event.key === "Escape") {
                setEditing(false);
              }
            }}
          />
          {actionError !== null ? (
            <span className={css.error} role="alert">
              {actionError}
            </span>
          ) : null}
          <div className={css.actions}>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => void save()}
              disabled={pending || draft.trim() === ""}
              aria-label="保存目标"
              title="保存目标"
            >
              <IconCheckOutlineRegular size={14} />
            </button>
            <button
              type="button"
              className={css.iconBtn}
              onClick={() => setEditing(false)}
              disabled={pending}
              aria-label="取消编辑"
              title="取消编辑"
            >
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const resume = phase !== "active";
  const toggleLabel = resume ? "恢复目标" : "暂停目标";
  const showProgress = progress !== null && progress.total > 0;
  return (
    <div className={css.dock} data-goal-bar="" data-goal-phase={goal.phase} data-goal-revision={goal.revision}>
      <div className={css.bar}>
        <span className={css.glyph} data-breathing={phase === "active" ? "" : undefined} aria-hidden="true">
          <IconGoalOutlineRegular size={14} />
        </span>
        <span className={css.label}>{PHASE_LABEL[phase]}</span>
        <span className={css.objective} data-goal-objective="" title={goal.objective}>
          {goal.objective}
        </span>
        {showProgress ? (
          <span
            className={css.progress}
            data-goal-progress={`${progress.met}/${progress.total}`}
            title={`验收项：已证实 ${progress.met} / 共 ${progress.total}（planner 拆出的子目标，逐条由事实证明）`}
          >
            <ProgressRing met={progress.met} total={progress.total} />
            验收项 {progress.met}/{progress.total}
          </span>
        ) : null}
        {actionError !== null ? (
          <span className={css.error} role="alert">
            {actionError}
          </span>
        ) : null}
        <div className={css.actions}>
          <button
            type="button"
            className={css.iconBtn}
            disabled={pending}
            onClick={() => {
              setDraft(goal.objective);
              setEditing(true);
            }}
            aria-label="编辑目标"
            title="编辑目标"
          >
            <IconEditOutlineRegular size={14} />
          </button>
          <button
            type="button"
            className={css.iconBtn}
            disabled={pending}
            onClick={toggle}
            aria-label={toggleLabel}
            title={toggleLabel}
            data-goal-toggle={resume ? "resume" : "pause"}
          >
            {resume ? <IconPlayOutlineRegular size={14} /> : <IconPauseOutlineRegular size={14} />}
          </button>
          <RowMenu
            label="目标的更多操作"
            disabled={pending}
            data={{ "data-goal-more": "" }}
            items={[
              {
                label: "标记为已达成",
                onSelect: () => void runAction(() => actions.complete()),
                data: { "data-goal-complete": "" },
              },
              {
                label: "清除目标…",
                danger: true,
                separatorBefore: true,
                onSelect: () => {
                  setActionError(null);
                  setConfirmClear(true);
                },
                data: { "data-goal-clear": "" },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
