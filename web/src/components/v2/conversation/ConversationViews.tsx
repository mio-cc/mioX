"use client";

/**
 * Active View area.
 *
 * Port of `ui-conversation/src/client/skeleton/DefaultConversationViews.tsx:13-44`
 * plus the registered View targets: `chat` reuses the existing ThreadView
 * activity renderer, `trajectory` renders the compact activity ledger.
 *
 * This is also where the conversation's history and rewinds live, because the
 * View area is the one component that sees the whole activity window: the live
 * window comes from the shell's tail loader, older pages come from
 * `v2/data/message-history`, and an edited-and-resent turn hides the rows the
 * backend just truncated until their replacements stream in.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { ThreadView, type ThreadHistoryState } from "@/components/v2/thread/ThreadView";
import type { Activity, Task } from "@/lib/types";
import type { ActivityPhase } from "@/v2/data/activity";
import { toBlocks } from "@/v2/data/activity-blocks";
import { findTaskView, splitViewId } from "@/v2/data/conversation-views";
import { editAndResend } from "@/v2/data/message-edit";
import { useOlderHistory } from "@/v2/data/message-history";
import { isSubLane, laneKeyOf } from "@/v2/data/sessions";

import css from "./ConversationRoot.module.css";
import type { ConversationViewId } from "./contract";
import { TrajectoryView } from "./TrajectoryView";

export interface ConversationViewsProps {
  /** Active View id. */
  readonly view: ConversationViewId;
  /** Selected task, or null; a registered task View only renders while one is open. */
  readonly task?: Task | null;
  /** Selected task's activity stream. */
  readonly activities: readonly Activity[];
  /** Transport phase of the stream. */
  readonly activityPhase: ActivityPhase;
  /** Selected task id: identity of the conversation the blocks belong to. */
  readonly conversationId?: string | null;
  /** True while the selected task's backend turn runs; drives the stream-tail status. */
  readonly chatRunning?: boolean;
  /**
   * Selected lane key (`main:<seg>` | `plan` | `intent:<id>`), or null for the
   * merged transcript of every lane (P1-B7). A lane view keeps only that lane's
   * rows and pages its history from that session alone.
   */
  readonly lane?: string | null;
}

/** Merge two ascending activity lists by id, preferring the live window's row. */
function mergeById(window: readonly Activity[], older: readonly Activity[]): Activity[] {
  const seen = new Set<number>();
  const merged: Activity[] = [];
  for (const row of [...older, ...window]) {
    if (seen.has(row.seq)) continue;
    seen.add(row.seq);
    merged.push(row);
  }
  return merged.sort((a, b) => a.seq - b.seq);
}

/** Chat View body: the activity renderer, or the matching loading/empty state. */
function chatView(
  blocks: ReturnType<typeof toBlocks>,
  activities: readonly Activity[],
  phase: ActivityPhase,
  conversationId: string | null,
  chatRunning: boolean,
  history: ThreadHistoryState,
  onEditResend: ((seq: number, text: string, seg: number) => Promise<void>) | undefined,
  lane: string | null,
): ReactNode {
  if (phase === "loading") return <div className={css.viewPlaceholder}>读取活动…</div>;
  if (phase === "offline") return <div className={css.viewPlaceholder}>未连接后端（活动流不可用）</div>;
  if (phase === "idle") return <div className={css.viewPlaceholder}>选择左侧任务查看对话</div>;
  // A running turn still owns the tail even before its first activity lands, so
  // the status row keeps the thread mounted instead of a "no activity" plate.
  if (activities.length === 0 && !chatRunning) return <div className={css.viewPlaceholder}>这个任务还没有活动记录</div>;
  return (
    <ThreadView
      blocks={blocks}
      conversationId={conversationId}
      running={chatRunning}
      taskId={conversationId}
      history={history}
      onEditResend={onEditResend}
      lane={lane}
    />
  );
}

/**
 * Render the active View inside the shared scroll body.
 * @param props - View id, the real activity stream behind both Views, and the
 * selected lane (P1-B7).
 * @returns the View area.
 */
export function ConversationViews({
  view,
  task,
  activities,
  activityPhase,
  conversationId,
  chatRunning,
  lane = null,
}: ConversationViewsProps): ReactNode {
  const taskId = conversationId ?? null;
  // A lane view reads one session only: the merged "all lanes" window first,
  // then the rows of the selected lane.
  const laneRows = useMemo(
    () => (lane === null ? activities : activities.filter((row) => laneKeyOf(row) === lane)),
    [activities, lane],
  );
  const oldestSeq = useMemo(
    () => (laneRows.length === 0 ? 0 : laneRows.reduce((min, row) => (row.seq < min ? row.seq : min), laneRows[0].seq)),
    [laneRows],
  );
  // The pager is lane-scoped: switched lanes must not absorb each other's pages.
  const history = useOlderHistory(taskId, oldestSeq, lane ?? undefined);
  /** Rows an edit-resend asked the backend to drop, until replacements stream in. */
  const [hidden, setHidden] = useState<{ from: number; to: number } | null>(null);

  // Another task means another transcript: neither the paged rows nor a hidden
  // range of the previous one may leak into it.
  useEffect(() => {
    setHidden(null);
  }, [conversationId]);

  const merged = useMemo(() => {
    const rows = mergeById(laneRows, history.older);
    if (hidden === null) return rows;
    return rows.filter((row) => row.seq < hidden.from || row.seq > hidden.to);
  }, [hidden, history.older, laneRows]);

  const blocks = useMemo(() => toBlocks(merged), [merged]);

  const onEditResend = useCallback(
    async (seq: number, text: string, seg: number): Promise<void> => {
      if (taskId === null) throw new Error("没有选中任务");
      const lastSeq = merged.length > 0 ? merged[merged.length - 1].seq : seq;
      await editAndResend({ taskId, seq, text, seg });
      setHidden({ from: seq, to: lastSeq });
    },
    [merged, taskId],
  );

  const historyState: ThreadHistoryState = {
    hasMore: history.hasMore,
    loading: history.loading,
    error: history.error,
    onLoad: history.load,
  };

  // A registered task View (TC0) owns the View area; it only renders with a task.
  // U2: `explore.graph` = container `explore` + sub-view `graph`.
  const extraView = view !== "chat" && view !== "trajectory" ? findTaskView(view) : null;
  const ExtraView = extraView?.Component ?? null;
  const subView = splitViewId(view).sub;

  return (
    <div className={css.viewArea} data-view={view} data-p1-b7-view-lane={lane ?? ""}>
      {ExtraView !== null && task != null ? (
        <ExtraView task={task} sub={subView} />
      ) : view === "trajectory" ? (
        <TrajectoryView activities={merged} phase={activityPhase} />
      ) : (
        // A sub-session lane is a read-only transcript: no edit-and-resend there,
        // because the backend would truncate a different conversation.
        chatView(
          blocks,
          merged,
          activityPhase,
          taskId,
          chatRunning === true,
          historyState,
          isSubLane(lane) ? undefined : onEditResend,
          lane,
        )
      )}
    </div>
  );
}
