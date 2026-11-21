"use client";

/**
 * Plan-mode capsule in the composer toolbar, beside the permission chip.
 *
 * Off: a quiet text control "计划". On: the brand-filled capsule with the plan
 * glyph, which turns into a close glyph on hover/focus to mark the click as
 * "leave plan mode" (DSH `ui-plan/src/client/PlanModeControl.tsx:51-66`). While a
 * turn runs, a toggle only applies to the next turn (the backend drops the agent
 * bundle), so the capsule shows "下一轮生效" until the run ends.
 */
import { IconCloseCircleFillRegular, IconPlanOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Tooltip } from "@/vendor/dsh/primitives/Tooltip";

import css from "./Composer.module.css";

export interface PlanModeToggleProps {
  /** Current plan mode; `null` while the first read is pending. */
  readonly on: boolean | null;
  /** A write is in flight. */
  readonly busy: boolean;
  /** The last toggle happened during a running turn. */
  readonly nextTurn: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
  readonly onMouseDown?: (event: React.MouseEvent) => void;
}

/**
 * Render the capsule.
 * @param props - state and the toggle callback.
 * @returns the control.
 */
export function PlanModeToggle({ on, busy, nextTurn, disabled = false, onToggle, onMouseDown }: PlanModeToggleProps): React.ReactNode {
  const active = on === true;
  const label = active ? "退出计划模式" : "开启计划模式：先侦察并给出计划，批准后再执行";
  return (
    <span className={css.planWrap}>
      <Tooltip label={label} shortcutKeys={["Shift", "Tab"]} side="top">
        <button
          type="button"
          className={active ? `${css.planChip} ${css.planChipOn}` : css.planChip}
          aria-pressed={active}
          aria-label={active ? "计划模式已开启，点击退出" : "开启计划模式"}
          aria-busy={busy ? true : undefined}
          data-plan-toggle={active ? "on" : "off"}
          disabled={disabled || busy || on === null}
          onMouseDown={onMouseDown}
          onClick={onToggle}
        >
          {active ? (
            <span className={css.planGlyph} aria-hidden="true">
              <IconPlanOutlineRegular className={css.planRest} size={14} />
              <IconCloseCircleFillRegular className={css.planHover} size={14} />
            </span>
          ) : null}
          计划
        </button>
      </Tooltip>
      {nextTurn ? (
        <span className={css.planPending} data-plan-next-turn="">
          下一轮生效
        </span>
      ) : null}
    </span>
  );
}
