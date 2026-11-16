/**
 * Trajectory timeline model (port of DSH `ui-trajectory/timeline.ts`).
 *
 * DSH projects a conversation into a three-lane horizontal timeline so you can see, at a
 * glance, where the time went: lane 0 = everything else, lane 1 = messages, lane 2 =
 * tool calls. Each turn boundary is a vertical line.
 *
 * DSH has four projections (`sequence` / `duration` / `time` / `actual`). Two of them
 * need a recorded duration per operation; our activity stream stores only a timestamp,
 * so this port implements the two the data supports and says so instead of faking the
 * other two.
 */

import type { Activity } from "@/lib/types";

export type TrajectoryMode = "sequence" | "time" | "turn";

export const TRAJECTORY_MODES: ReadonlyArray<{ value: TrajectoryMode; label: string; hint: string }> = [
  { value: "sequence", label: "序列", hint: "按发生顺序等宽排列" },
  { value: "time", label: "时间", hint: "按真实时间轴排列（空闲段保留）" },
  { value: "turn", label: "回合", hint: "按回合分组，每回合等宽" },
];

/** Lane assignment, mirroring DSH `laneFor`. */
export const TRAJECTORY_LANES: ReadonlyArray<{ index: number; label: string }> = [
  { index: 0, label: "其它" },
  { index: 1, label: "消息" },
  { index: 2, label: "工具" },
];

export interface TrajectorySpan {
  /** Stable identity: the activity seq. */
  seq: number;
  /** Projection domain start. */
  start: number;
  /** Projection domain end. */
  end: number;
  lane: number;
  kind: string;
  worker: string;
  label: string;
  isError: boolean;
  /** Turn index (user→result pairing, same axis as the chat transcript) this span belongs to. */
  turn: number;
}

export interface TrajectoryTurnBoundary {
  turn: number;
  at: number;
}

export interface TrajectoryModel {
  mode: TrajectoryMode;
  start: number;
  end: number;
  spans: TrajectorySpan[];
  boundaries: TrajectoryTurnBoundary[];
  turns: number;
}

// Lane 1 = things the reader reads (user/assistant text, thinking, results).
const MESSAGE_KINDS = new Set(["user", "assistant", "text", "thinking", "reasoning", "result"]);
// Lane 2 = tool traffic.
const TOOL_KINDS = new Set(["tool_use", "tool_result"]);
// Lane 0 = bookkeeping (usage / round / llm switches / intents / approvals).

/** Lane for an activity kind (DSH: tool/subtool = 2, message/compacted = 1, else 0). */
export function laneFor(kind: string): number {
  if (TOOL_KINDS.has(kind)) return 2;
  if (MESSAGE_KINDS.has(kind)) return 1;
  return 0;
}

function isErrorActivity(activity: Activity): boolean {
  if (activity.is_error === true) return true;
  const summary = activity.summary ?? "";
  return summary.startsWith("✗") || summary.startsWith("error");
}

/** Activity timestamps are ISO strings; a missing/garbage one must not poison the axis. */
function tsOf(activity: Activity): number {
  const parsed = Date.parse(activity.ts ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Project activities onto the timeline.
 *
 * @param activities - Activity rows in stream order.
 * @param mode - Projection: `sequence` (equal widths), `time` (wall clock), `turn`
 *   (equal width per turn, so a long idle gap cannot squash the work).
 * @returns The model, or null when there is nothing to draw.
 */
export function deriveTrajectory(
  activities: readonly Activity[],
  mode: TrajectoryMode = "sequence",
): TrajectoryModel | null {
  // `usage` rows are bookkeeping that the chat does not render either (DSH filters its
  // equivalent `requestOnly` cells the same way), so they must not become timeline bars.
  const visible = activities.filter((activity) => activity.kind !== "usage");
  if (visible.length === 0) return null;
  activities = visible;

  const spans: TrajectorySpan[] = [];
  const boundaries: TrajectoryTurnBoundary[] = [];
  let lastTurn: number | null = null;

  // 回合轴与聊天区同口径:每条 `user` 行开一个回合,该行及其后的行都属于它
  // (聊天区 turns 列表的 user→result 配对)。`main_seg` 是主会话分段号,只有
  // /new 才变,拿它当回合轴时一段对话永远只有 1 个回合(U5)。
  const seqToTurn = new Map<number, number>();
  let turnCursor = 0;
  for (const activity of activities) {
    if (activity.kind === "user") turnCursor += 1;
    seqToTurn.set(activity.seq, Math.max(turnCursor - 1, 0));
  }
  const turnOf = (activity: Activity): number => seqToTurn.get(activity.seq) ?? 0;

  if (mode === "sequence") {
    for (const activity of activities) {
      const turn = turnOf(activity);
      if (turn !== lastTurn) {
        boundaries.push({ turn, at: spans.length });
        lastTurn = turn;
      }
      spans.push({
        seq: activity.seq,
        start: spans.length,
        end: spans.length + 1,
        lane: laneFor(activity.kind),
        kind: activity.kind,
        worker: activity.worker,
        label: activity.summary,
        isError: isErrorActivity(activity),
        turn,
      });
    }
    return { mode, start: 0, end: spans.length, spans, boundaries, turns: boundaries.length };
  }

  if (mode === "time") {
    const times = activities.map(tsOf);
    const start = Math.min(...times);
    const end = Math.max(...times);
    // A single instant (all rows share a timestamp) would divide by zero downstream.
    const span = end > start ? end - start : 1;
    for (let i = 0; i < activities.length; i += 1) {
      const activity = activities[i];
      const turn = turnOf(activity);
      const at = (times[i] ?? start) - start;
      if (turn !== lastTurn) {
        boundaries.push({ turn, at });
        lastTurn = turn;
      }
      spans.push({
        seq: activity.seq,
        start: at,
        end: at + span / activities.length,
        lane: laneFor(activity.kind),
        kind: activity.kind,
        worker: activity.worker,
        label: activity.summary,
        isError: isErrorActivity(activity),
        turn,
      });
    }
    return { mode, start: 0, end: span, spans, boundaries, turns: boundaries.length };
  }

  // turn: one equal slot per turn, activities spread inside their slot.
  const byTurn = new Map<number, Activity[]>();
  for (const activity of activities) {
    const turn = turnOf(activity);
    const bucket = byTurn.get(turn);
    if (bucket) bucket.push(activity);
    else byTurn.set(turn, [activity]);
  }
  const turns = [...byTurn.keys()].sort((a, b) => a - b);
  const slot = 1 / Math.max(1, turns.length);
  turns.forEach((turn, turnIndex) => {
    const bucket = byTurn.get(turn) ?? [];
    boundaries.push({ turn, at: turnIndex * slot });
    bucket.forEach((activity, offset) => {
      const start = turnIndex * slot + (offset * slot) / Math.max(1, bucket.length);
      spans.push({
        seq: activity.seq,
        start,
        end: start + slot / Math.max(1, bucket.length),
        lane: laneFor(activity.kind),
        kind: activity.kind,
        worker: activity.worker,
        label: activity.summary,
        isError: isErrorActivity(activity),
        turn,
      });
    });
  });
  return { mode, start: 0, end: 1, spans, boundaries, turns: turns.length };
}

/** Position a span as a percentage pair, clamped to the domain. */
export function spanRect(
  span: TrajectorySpan,
  model: TrajectoryModel,
): { left: number; width: number } {
  const domain = model.end - model.start || 1;
  const left = ((span.start - model.start) / domain) * 100;
  const width = ((span.end - span.start) / domain) * 100;
  return { left: Math.max(0, left), width: Math.max(width, 0.12) };
}
