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

import {
  IconCheckOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconGoalOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { GoalSnapshot } from "@/lib/types";
import type { GoalActions, GoalActionResult } from "@/v2/data/goal";
import css from "./GoalBar.module.css";

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
}: {
  goal: GoalSnapshot | null;
  actions?: GoalActions;
}): React.ReactNode {
  const objective = goal?.objective ?? "";
  const phase = goal === null ? null : visiblePhase(goal.phase);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [clearedGoalId, setClearedGoalId] = React.useState<string | null>(null);
  const pendingRef = React.useRef(false);

  // A new goal identity (cleared/completed/replaced externally) invalidates the
  // local edit state: without the reset a surviving draft's Enter would write
  // over the NEW goal (`GoalBar.tsx:51-58`).
  const goalId = goal?.id;
  React.useEffect(() => {
    setEditing(false);
    setDraft("");
    setActionError(null);
    setClearedGoalId(null);
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

  // Loading, absent, unplumbed and complete goals have no strip at all.
  if (actions === undefined || goal === null || phase === null || goal.id === clearedGoalId) return null;

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
  return (
    <div className={css.dock} data-goal-bar="" data-goal-phase={goal.phase} data-goal-revision={goal.revision}>
      <div className={css.bar}>
        <span className={css.glyph} aria-hidden="true">
          <IconGoalOutlineRegular size={14} />
        </span>
        <span className={css.label}>{PHASE_LABEL[phase]}</span>
        <span className={css.objective} data-goal-objective="" title={goal.objective}>
          {goal.objective}
        </span>
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
            onClick={() => void clear(goal.id)}
            aria-label="清除目标"
            title="清除目标"
          >
            <IconTrashOutlineRegular size={14} />
          </button>
          <button
            type="button"
            className={css.iconBtn}
            disabled={pending}
            onClick={toggle}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            {resume ? <IconPlayOutlineRegular size={14} /> : <IconPauseOutlineRegular size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
