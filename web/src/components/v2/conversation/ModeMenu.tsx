"use client";

/**
 * Session-header mode chip: a labelled trigger plus the vendored DSH `Menu`.
 *
 * The backend models a Session's mode as **two independent task booleans**, so the
 * menu shows two independently checkable rows (`role="menuitemcheckbox"`) instead of
 * an exclusive three-way choice:
 *
 *   - 计划模式 → `plan_mode`, `PATCH /tasks/{id}/plan-mode`: recon only; the agent
 *     hands over a plan and waits for the review approval
 *     (`ui-plan/src/client/PlanModeControl.tsx:19-70` renders DSH's own plan chip
 *     only while the mode is on, as an exit affordance).
 *   - 团队模式 → `team_mode`, `PATCH /tasks/{id}/team-mode`: registers the shared
 *     task-board tools for the next turn (server.go `setTaskTeamMode`).
 *
 * Neither row is optimistic: the shell writes, reloads the task snapshot, and the
 * rows re-render from that snapshot, so a failed request leaves the old state.
 *
 * Divergence from DSH, recorded in the inventory audit: DSH's hero chip with the
 * same "标准模式" label selects the *work-steps display level*
 * (简洁/标准/详细/完全展开, `ui-chat/src/client/locale.ts:114-127`), a viewing
 * preference. ARTEX has no display-level backend setting, so the same chip position
 * carries the two real mode switches the backend does expose.
 */
import { useState } from "react";

import clsx from "clsx";

import { Menu } from "@/vendor/dsh/primitives/Menu";
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import chipCss from "./ConversationRoot.module.css";
import css from "./ModeMenu.module.css";

/** Props of the header mode chip. */
export interface ModeMenuProps {
  /** Whether the selected task's plan mode is on. */
  readonly planMode: boolean;
  /** Whether the selected task's team mode is on. */
  readonly teamMode: boolean;
  /** Toggle the selected task's plan mode. */
  readonly onTogglePlanMode: () => void;
  /** Toggle the selected task's team mode. */
  readonly onToggleTeamMode: () => void;
}

/**
 * Render the mode chip and its two-switch menu.
 * @param props - the two live mode flags and their toggle callbacks.
 * @returns the anchored chip.
 */
export function ModeMenu(props: ModeMenuProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const parts: string[] = [];
  if (props.planMode) parts.push("计划");
  if (props.teamMode) parts.push("团队");
  const label = parts.length === 0 ? "标准模式" : `${parts.join(" + ")}模式`;
  const on = props.planMode || props.teamMode;

  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      // The title cluster clips its overflow (`ConversationRoot.module.css`
      // .titleCluster: overflow clip), so the in-place list would be invisible;
      // the portal variant paints the same card against the chip's CSS anchor.
      portal
      anchor={
        <button
          type="button"
          data-mode-chip=""
          className={clsx(chipCss.planChip, on && chipCss.planChipOn)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="会话模式：计划 / 团队"
          onClick={() => setOpen((value) => !value)}
        >
          {label}
          <IconChevronDownOutlineRegular size={10} />
        </button>
      }
    >
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={props.planMode}
        data-mode-option="plan"
        className={css.row}
        onClick={props.onTogglePlanMode}
      >
        <span className={css.glyph} aria-hidden="true">
          {props.planMode ? <IconCheckOutlineRegular size={14} /> : null}
        </span>
        <span className={css.label}>计划模式</span>
        <span className={css.hint}>{props.planMode ? "已开启" : "只侦察，交计划待批准"}</span>
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={props.teamMode}
        data-mode-option="team"
        className={css.row}
        onClick={props.onToggleTeamMode}
      >
        <span className={css.glyph} aria-hidden="true">
          {props.teamMode ? <IconCheckOutlineRegular size={14} /> : null}
        </span>
        <span className={css.label}>团队模式</span>
        <span className={css.hint}>{props.teamMode ? "已开启" : "共享任务板工具"}</span>
      </button>
    </Menu>
  );
}
