"use client";

/**
 * Conversation main panel: the phase frame around Header + Content.
 *
 * Port of `ui-conversation/src/client/skeleton/ConversationMainPanel.tsx:13-49`.
 * Upstream distinguishes `settling` / `hero` / `active` from the Session
 * snapshot; ARTEX has a single selected task, so the blank state is simply the
 * hero phase and every selected task is active.
 *
 * P1-B7 adds the lane selection: the panel owns which lane the transcript is
 * read from (`null` = the merged "all lanes" view), the lane list of the
 * selected task, and the `新建主会话` mutation, because the header (switcher)
 * and the content (transcript + composer) both need them.
 *
 * P1-B25 / P1-B27 / P1-B28 extend that ownership:
 *   - `SessionLaneSwitcher` (主 Agent / Planner / Worker) reports a segment and
 *     this panel resolves it to a real lane key through `laneForSegment`, so the
 *     transcript, its history pager, and the read-only composer notice all switch
 *     to the other data source (old page `task-workspace-dsh.tsx:2702-2734`);
 *   - `新建主会话` (`/new`, old page `:2496-2505`) creates the segment, follows it,
 *     and hands a one-shot `newSessionToken` down so the composer clears its draft
 *     (old page `sessions-tab.tsx:566-584` ends with `setInput("")`);
 *   - the lane menu (P1:B28) also lists the lanes by name, so both it and the
 *     switcher switch the same transcript (old page `sessions-tab.tsx:1655-1729`).
 *     The panel feeds it the lane list, the current segment, the selected key,
 *     the create callback, and the read state; nothing lane-shaped sits above
 *     the transcript any more.
 * 旧页面依据：`app/(main)/function/tasks/detail/task-workspace-dsh.tsx:2496-2505,2702-2734`、
 * `_tabs/sessions-tab.tsx:1233-1259,1655-1729`
 * DSH 依据：`ui-conversation/src/client/skeleton/ConversationMainPanel.tsx:13-49`
 * 对照表行：P1:B25 P1:B27 P1:B28
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";

import {
  createMainSession,
  laneForSegment,
  laneSegmentGroup,
  mainLaneKey,
  primaryMainLane,
  useSessionLanes,
} from "@/v2/data/sessions";

import { ConversationContent } from "./ConversationContent";
import { ConversationHeader } from "./ConversationHeader";
import css from "./ConversationRoot.module.css";
import type { ConversationSkeletonProps, ConversationViewId } from "./contract";
import type { LaneSegmentValue } from "./SessionLaneSwitcher";
import { SessionLaneSwitcher } from "./SessionLaneSwitcher";

/**
 * Render the phase root, the header, and the content frame.
 * @param props - the skeleton contract plus the shell-provided composer.
 * @returns the conversation column.
 */
export function ConversationMainPanel(props: ConversationSkeletonProps): ReactNode {
  const blank = props.task === null;
  const phase = blank ? "hero" : "active";
  const [view, setView] = useState<ConversationViewId>("chat");
  /** Selected lane key, or null for the merged transcript of every lane. */
  const [lane, setLane] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /**
   * Bumped after a successful `新建主会话`. The composer seat sees the change and
   * clears its draft once (old page `sessions-tab.tsx:577` `setInput("")`).
   * A token rather than a boolean so two creates in a row both clear.
   */
  const [newSessionToken, setNewSessionToken] = useState(0);
  const taskId = props.task?.id ?? null;
  const { lanes, current, loading, error, reload } = useSessionLanes(taskId);

  // Another task is another lane list and another transcript: go back to all lanes.
  useEffect(() => {
    setLane(null);
    setView("chat");
    setCreateError(null);
  }, [taskId]);

  // A selected lane that is no longer in the list (the intent was hard-deleted,
  // or the list reloaded without it) would leave the transcript pointed at a
  // session nobody can name: fall back to the merged view.
  useEffect(() => {
    if (lane === null || loading) return;
    if (lanes.some((entry) => entry.key === lane)) return;
    setLane(null);
  }, [lane, lanes, loading]);

  // `新建主会话` (`task-workspace-dsh.tsx:2494-2505`): the backend flips the task's
  // current main session, then the list is re-read and the new segment followed.
  const onNewMain = useCallback(() => {
    if (taskId === null || creating) return;
    setCreating(true);
    setCreateError(null);
    createMainSession(taskId)
      .then((result) => {
        reload();
        setLane(mainLaneKey(result.seq));
        // The new segment starts empty, and the draft belongs to the previous one.
        setNewSessionToken((value) => value + 1);
      })
      .catch((reason: unknown) => {
        setCreateError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        setCreating(false);
      });
  }, [creating, reload, taskId]);

  /** Select one lane from the lane menu (a segment or a named lane). */
  const onSelectLane = useCallback((key: string | null) => {
    setCreateError(null);
    setLane(key);
  }, []);

  const mainLane = primaryMainLane(lanes, current);
  const available: Readonly<Record<LaneSegmentValue, boolean>> = {
    main: mainLane !== null,
    planner: lanes.some((entry) => entry.key === "plan"),
    worker: lanes.some((entry) => entry.group === "worker"),
  };
  // The control's current segment is derived from the selected lane, so a lane
  // row picked in the menu (which can be a specific segment or intent) keeps
  // the trigger in agreement.
  const segment: LaneSegmentValue = lane === null ? "main" : segmentOfLane(lane, mainLane);

  const onSelectSegment = useCallback(
    (next: LaneSegmentValue) => {
      if (next === segment) return;
      onSelectLane(laneForSegment(next, lanes, current));
    },
    [current, lanes, onSelectLane, segment],
  );

  const laneBar =
    props.task === null ? null : (
      <SessionLaneSwitcher
        value={segment}
        onChange={onSelectSegment}
        available={available}
        loading={loading}
        titles={{
          main: mainLane === null ? "这个任务还没有主 Agent 会话" : "主 Agent 会话（可写入）",
          planner: available.planner ? "规划 Planner 会话（只读）" : "这个任务还没有规划会话",
          worker: available.worker ? "Worker 子会话（只读）" : "这个任务还没有 Worker 会话",
        }}
        lanes={lanes}
        current={current}
        selected={lane}
        onSelectLane={onSelectLane}
        onNewMain={onNewMain}
        creating={creating}
        error={createError ?? error}
        onRetry={reload}
      />
    );

  return (
    <div className={css.root} data-phase={phase} data-drawer={props.drawer ? "" : undefined}>
      <ConversationHeader {...props} blank={blank} view={view} onSelectView={setView} laneBar={laneBar} />
      <ConversationContent
        {...props}
        blank={blank}
        phase={phase}
        view={view}
        lane={lane}
        onSelectLane={onSelectLane}
        lanes={lanes}
        laneCurrent={current}
        newSessionToken={newSessionToken}
      />
    </div>
  );
}

/**
 * Segment a lane key belongs to, for keeping the switcher in sync.
 * @param lane - selected lane key.
 * @param mainLane - the lane the 主 Agent segment resolves to.
 * @returns `main` / `planner` / `worker` (the system pseudo-lane reads as worker).
 */
function segmentOfLane(lane: string, mainLane: string | null): LaneSegmentValue {
  if (lane === mainLane) return "main";
  const group = laneSegmentGroup(lane);
  if (group === "main") return "main";
  if (group === "planner") return "planner";
  return "worker";
}
