"use client";

/**
 * Contributions to the two Session-header list slots.
 *
 * Mirrors DSH's split of `conversation.session.header.actions` (ui-conversation
 * declares the band, ui-jobs contributes `job-list` at `order: 20`) and the
 * Utilities band. The shell registers these entries (it is the contributor);
 * `ConversationSessionHeader` owns the seats and renders the slot.
 *
 * Ordering is explicit and matches DSH's composition order:
 *
 *   actions     plan-mode (10) → jobs-chip (20)
 *   utilities   schedule-clock (5) → right-panel-toggle (10) → more-menu (20)
 *
 * `jobs-chip` conditions itself on DSH's rule that the chip only exists while a
 * job row is live; the entry stays registered, exactly like DSH's component
 * returning null (`ui-jobs/src/client/JobListAction.tsx:500`).
 */
import type { SlotEntry } from "@/v2/slots/registry";
import { IconPanelLeftOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import { BackgroundJobsChip } from "./BackgroundJobsChip";
import { ConversationMoreMenu } from "./ConversationMoreMenu";
import css from "./ConversationRoot.module.css";
import type { ConversationHeaderSlotContext } from "./contract";
import { ModeMenu } from "./ModeMenu";
import { ScheduleClock } from "./ScheduleClock";

declare module "@/v2/slots/registry" {
  interface SlotContextMap {
    "conversation.header.actions": ConversationHeaderSlotContext;
    "conversation.header.utilities": ConversationHeaderSlotContext;
  }
}

/** Mode chip (standard / plan / team) with its dropdown; first in the actions band (order 10). */
export const PLAN_MODE_ACTION: SlotEntry<ConversationHeaderSlotContext> = {
  id: "plan-mode",
  order: 10,
  render: (ctx) => (
    <ModeMenu
      planMode={ctx.planMode}
      teamMode={ctx.teamMode}
      onTogglePlanMode={ctx.onTogglePlanMode}
      onToggleTeamMode={ctx.onToggleTeamMode}
    />
  ),
};

/** Running-jobs chip; follows the plan chip (order 20) and hides without a live row. */
export const JOBS_CHIP_ACTION: SlotEntry<ConversationHeaderSlotContext> = {
  id: "jobs-chip",
  order: 20,
  when: (ctx) => ctx.runningTasks.length > 0,
  render: (ctx) => (
    <BackgroundJobsChip
      tasks={ctx.runningTasks}
      activeTaskId={ctx.task.id}
      onOpenTask={ctx.onOpenTask}
      onPauseTask={ctx.onPauseTask}
    />
  ),
};

/** Right-panel visibility toggle; first in the utilities band (order 10). */
export const RIGHT_PANEL_TOGGLE_UTILITY: SlotEntry<ConversationHeaderSlotContext> = {
  id: "right-panel-toggle",
  order: 10,
  render: (ctx) => (
    <button
      type="button"
      className={css.headerMenuButton}
      aria-label={ctx.rightOpen ? "收起右栏" : "展开右栏"}
      aria-pressed={ctx.rightOpen}
      title={ctx.rightOpen ? "收起右栏" : "展开右栏"}
      onClick={ctx.onToggleRightPanel}
    >
      <IconPanelLeftOutlineRegular size={16} />
    </button>
  ),
};

/** Session More launcher; last in the utilities band (order 20). */
export const MORE_MENU_UTILITY: SlotEntry<ConversationHeaderSlotContext> = {
  id: "more-menu",
  order: 20,
  render: (ctx) => <ConversationMoreMenu task={ctx.task} taskActions={ctx.taskActions} />,
};

/**
 * 自动化时钟（DX-S3）：当前任务有 enabled 自动化时的快捷入口，排在右栏开关之前
 * （order 5）。组件自隐：数据未就绪或当前任务没有 enabled 的自动化时渲染 null，
 * 条目本身保持注册——与 `JOBS_CHIP_ACTION` 的 `when` 注释同一策略。
 */
export const SCHEDULE_CLOCK_UTILITY: SlotEntry<ConversationHeaderSlotContext> = {
  id: "schedule-clock",
  order: 5,
  render: (ctx) => <ScheduleClock taskId={ctx.task.id} />,
};
