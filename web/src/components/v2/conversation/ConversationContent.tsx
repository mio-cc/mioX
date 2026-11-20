"use client";

/**
 * Conversation body: View area plus the composer seat.
 *
 * Port of `ui-conversation/src/client/skeleton/ConversationContent.tsx:22-211`,
 * reduced to the parts ARTEX owns: the `body` / `scrollBody` / `viewArea` /
 * `composerSeat` frame, the hero composer stack, and the composer bar seat.
 * Width controls, workspace pickers, and input docking are not ported.
 *
 * P1-B7: when a single lane is selected, the body shows that lane's title and
 * backend state above the View, and a sub-session lane (planner / worker)
 * replaces the composer with a read-only notice — the old page does the same
 * because typing there would post into a different conversation
 * (`task-workspace-dsh.tsx:3206-3230`).
 *
 * P1-B25 / P1-B27 / P1-B28:
 *   - the lane picker (three segments, `新建主会话`, and the lanes by name) lives
 *     in the header's lane menu, not above the transcript: the body keeps no
 *     resident list or panel (`102-UI-UX规范.md` §7.3);
 *   - a main-agent lane keeps the real composer (every main segment is an
 *     interactive session, old page `:1231-1232`), a planner/worker lane is
 *     read-only;
 *   - `newSessionToken` one-shot-clears the draft after `新建主会话`.
 * 旧页面依据：`app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1655-1729,1231-1232`、
 * `task-workspace-dsh.tsx:3206-3230`
 * DSH 依据：`ui-conversation/src/client/skeleton/ConversationContent.tsx:22-211`
 * 对照表行：P1:B25 P1:B27 P1:B28
 */
import { type ReactNode } from "react";

import clsx from "clsx";

import { intentStateLabel, isSubLane, type SessionLane } from "@/v2/data/sessions";

import css from "./ConversationRoot.module.css";
import { ConversationViews } from "./ConversationViews";
import type { ConversationSkeletonProps, ConversationViewId } from "./contract";
import { EmptyHero } from "./EmptyHero";
import { InputBar } from "./InputBar";

export interface ConversationContentProps extends ConversationSkeletonProps {
  /** True while no task is selected: the hero stack replaces the View area. */
  readonly blank: boolean;
  /** `hero` for the blank column, `active` once a task is selected. */
  readonly phase: "hero" | "active";
  /** Selected View id, owned by the main panel. */
  readonly view: ConversationViewId;
  /** Selected lane key, or null for the merged transcript of every lane. */
  readonly lane?: string | null;
  /** Return to the merged transcript from the lane strip. */
  readonly onSelectLane?: (key: string | null) => void;
  /** Lane list of the selected task, for the strip's title and state. */
  readonly lanes?: readonly SessionLane[];
  /** Backend's current (writable) main-agent segment number. */
  readonly laneCurrent?: number;
  /** Bumped after a successful new main session: the composer clears its draft once. */
  readonly newSessionToken?: number;
}

/**
 * Lane strip: which lane is on screen and what the backend says about it.
 * @param lane - selected lane key.
 * @param lanes - lane list of the task.
 * @param onSelectLane - return-to-all callback.
 * @returns the strip, or null when every lane is shown.
 */
function laneStrip(
  lane: string | null,
  lanes: readonly SessionLane[],
  onSelectLane: ((key: string | null) => void) | undefined,
  current: number,
): ReactNode {
  if (lane === null) return null;
  const entry = lanes.find((candidate) => candidate.key === lane);
  const title = entry?.label ?? lane;
  const status =
    entry === undefined
      ? "未知"
      : entry.group === "worker"
        ? intentStateLabel(entry.state)
        : entry.group === "mainagent"
          ? entry.key === `main:${current}`
            ? "当前写入"
            : "历史分段"
          : "规划 Planner";
  return (
    <div
      className={css.laneStrip}
      role="status"
      data-p1-b7-lane-strip=""
      data-p1-b25-lane-strip=""
      data-lane-key={lane}
    >
      <span className={css.laneDot} data-state={entry?.live === true ? "running" : "idle"} aria-hidden="true" />
      <span className={css.laneStripTitle} title={title} data-p1-b7-lane-title="">
        {title}
      </span>
      <span className={css.laneStripState} data-p1-b7-lane-state={entry?.state ?? ""}>
        {status}
      </span>
      <span className={css.laneStripHint}>
        {isSubLane(lane) ? "子会话由 agent 自动派发，只读；要下指令请回到「全部」或「主 Agent」会话。" : ""}
      </span>
      {onSelectLane === undefined ? null : (
        <button
          type="button"
          className={css.laneStripBack}
          title="回到全部会话"
          data-p1-b7-lane-back=""
          onClick={() => {
            onSelectLane(null);
          }}
        >
          回到全部
        </button>
      )}
    </div>
  );
}

/**
 * Render the conversation content frame.
 * @param props - skeleton contract plus the blank/phase/View/lane selection.
 * @returns the content column with the composer seat at its floor.
 */
export function ConversationContent(props: ConversationContentProps): ReactNode {
  const hero = props.blank;
  const lane = props.lane ?? null;
  const subLane = isSubLane(lane);
  const lanes = props.lanes ?? [];
  const newSessionToken = props.newSessionToken ?? 0;

  return (
    <div
      className={css.body}
      data-conversation-content=""
      data-conversation-session={props.task?.id}
      data-conversation-region="chat"
      data-content-phase={props.phase}
      data-p1-b7-lane={lane ?? ""}
      data-p1-b25-lane={lane ?? ""}
    >
      {/* The scroll body wraps the View and the composer seat, so the composer
          stays mounted while the View switches (upstream lines 199-207). */}
      <div className={css.scrollBody} data-conversation-scroll="">
        {props.blank ? null : (
          <>
            {laneStrip(lane, lanes, props.onSelectLane, props.laneCurrent ?? 0)}
            <ConversationViews
              view={props.view}
              task={props.task}
              activities={props.activities}
              activityPhase={props.activityPhase}
              conversationId={props.task?.id ?? null}
              chatRunning={props.chatRunning === true}
              lane={lane}
            />
          </>
        )}
        <div className={css.composerSeat} data-composer-seat="" data-conversation-region="composer">
          <div className={clsx(css.composerStack, hero && css.composerHero)}>
            {hero ? <EmptyHero /> : null}
            {subLane ? (
              // Old page :3225-3229: a sub-session transcript cannot be typed into.
              <div className={css.laneReadOnly} role="status" data-p1-b7-lane-readonly="">
                <strong>{lane === "plan" ? "规划者会话（只读）" : "子会话（只读）"}</strong>
                <span>子会话由 agent 自动派发，不能直接输入；要下指令请回到「主 Agent」会话。</span>
              </div>
            ) : (
              // Remount on a new main session so the draft starts empty; every
              // other render keeps the same instance and the same draft.
              <InputBar key={`composer-${newSessionToken}`} variant={hero ? "hero" : "composer"}>
                {props.composer}
              </InputBar>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
