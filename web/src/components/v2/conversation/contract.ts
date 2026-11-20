/**
 * Prop contract for the ported DSH conversation skeleton.
 *
 * The upstream package splits its public surface into `contract/slots.ts`
 * (slot declarations) and `client/skeleton/*` (rendering). ARTEX keeps explicit
 * prop types for the skeleton structure and uses the mini slot registry
 * (`@/v2/slots`) for the two extensible Session-header bands: the header owns
 * `conversation.header.actions` / `conversation.header.utilities`, the shell
 * contributes their entries, and {@link ConversationHeaderSlotData} is the owner
 * data both bands render against.
 */
import type { ReactNode } from "react";

import type { Activity, Task } from "@/lib/types";
import type { ActivityPhase } from "@/v2/data/activity";

/**
 * View id. `chat` and `trajectory` are the built-in Views; every other id comes
 * from the task-view registry (`v2/data/conversation-views.ts`), which appends
 * task-scoped Views after the fixed View (`view-pins.ts:5`, `apply.ts:216,403`).
 */
export type ConversationViewId = string;

/** One View tab row entry. */
export interface ConversationViewTab {
  readonly id: ConversationViewId;
  readonly label: string;
}

/**
 * View tabs in header order: the fixed View first, then the remaining Views,
 * mirroring `view-pins.ts` FIXED_VIEW_ID ordering in
 * `ConversationSession.tsx:136-139`.
 */
export const CONVERSATION_VIEW_TABS: readonly ConversationViewTab[] = [
  { id: "chat", label: "对话" },
  { id: "trajectory", label: "轨迹" },
];

/** Backend mutations the Session header's More menu can request. */
export interface ConversationTaskActions {
  /** Pin or unpin the task behind the current Session. */
  readonly setPinned: (id: string, pinned: boolean) => void;
  /** Archive the task, removing it from the sidebar list. */
  readonly archive: (id: string) => void;
  /** Delete the task after the confirmation dialog resolves. */
  readonly remove: (id: string) => Promise<void>;
}

/**
 * Shell-owned data contributed to the `conversation.header.*` list slots.
 *
 * These values used to be direct props of the session header; the slot entries
 * now read them from the render context instead. They stay grouped here because
 * they are all owned by the shell and only the header's slots consume them.
 */
export interface ConversationHeaderSlotData {
  /** Tasks whose status is `running`; empty hides the background-jobs chip. */
  readonly runningTasks: readonly Task[];
  /** Whether the selected task's plan mode is on. */
  readonly planMode: boolean;
  /** Whether the selected task's team mode is on; the second, independent mode flag. */
  readonly teamMode: boolean;
  /** Whether the right panel is visible, for the header utility toggle. */
  readonly rightOpen: boolean;
  /** Toggle the selected task's plan mode. */
  readonly onTogglePlanMode: () => void;
  /** Toggle the selected task's team mode. */
  readonly onToggleTeamMode: () => void;
  /** Show or hide the right panel. */
  readonly onToggleRightPanel: () => void;
  /**
   * Pause a running task from the background-jobs chip. The shell owns the
   * `POST /tasks/{id}/control {action:"pause"}` call and the roster refresh;
   * the returned promise drives the chip's pending/failed control states.
   */
  readonly onPauseTask: (id: string) => Promise<void>;
  /** Task mutations behind the Session More menu. */
  readonly taskActions: ConversationTaskActions;
}

/**
 * Full render context of the `conversation.header.actions` and
 * `conversation.header.utilities` entries: shell data plus the Session the
 * header owns and the task-selection callback used by both crumb navigation and
 * the jobs roster.
 */
export type ConversationHeaderSlotContext = ConversationHeaderSlotData & {
  /** Selected task; the header never renders the slots without one. */
  readonly task: Task;
  /** Select another task, used by the background-jobs chip roster. */
  readonly onOpenTask: (id: string) => void;
};

/** Everything the resident conversation skeleton needs from the shell. */
export interface ConversationSkeletonProps {
  /** Selected task, or null when the column shows the blank/hero state. */
  readonly task: Task | null;
  /** Activity stream of the selected task, in log order. */
  readonly activities: readonly Activity[];
  /** Transport phase of the activity stream. */
  readonly activityPhase: ActivityPhase;
  /**
   * True while the selected task's backend chat turn runs. The shell owns the
   * single `useChatRun` poll and hands the flag down; the chat View paints the
   * stream-tail `data-chat-running` status from it.
   */
  readonly chatRunning?: boolean;
  /** Shell-owned data the `conversation.header.*` list slot entries render against. */
  readonly headerSlotData: ConversationHeaderSlotData;
  /** Whether the shell is in drawer mode (<768px), for the leading toggle. */
  readonly drawer: boolean;
  /** Open the sidebar drawer (drawer mode only). */
  readonly onOpenDrawer: () => void;
  /** Select another task, used by the Session crumb navigation. */
  readonly onOpenTask: (id: string) => void;
  /** Composer surface rendered inside the InputBar seat. */
  readonly composer: ReactNode;
}

/** Display title: the task name, falling back to its description. */
export function taskTitle(task: Pick<Task, "name" | "description">): string {
  const name = task.name?.trim() ?? "";
  return name === "" ? task.description : name;
}
