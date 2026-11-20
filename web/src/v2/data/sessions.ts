"use client";

/**
 * Adapter for a task's conversation lanes (主 Agent / Planner / Worker).
 *
 * The old page (`app/(main)/function/tasks/detail/task-workspace-dsh.tsx:104-175`)
 * derives the lane list from two read-only endpoints and one fixed affordance:
 * `api.mainSessions` (`:870` → GET /exploration/main-sessions) lists the
 * main-agent segments, `api.intents` (`:781` → GET /exploration/intents) lists
 * the worker intents, and the planner is the fixed `plan` key with no endpoint
 * of its own. The lane key is exactly what `api.activityHistory` (`:840`) takes
 * as `session`: `main:<seg>` | `plan` | `intent:<id>`.
 *
 * Rows are routed to lanes by the same rule the old dropdown and the legacy
 * SessionsTab use (`task-workspace-dsh.tsx:162-170`): a `mainagent` row belongs
 * to `main:<main_seg>`, a `planner` row to `plan`, an intent row to
 * `intent:<intent_id>`, and the task-level LLM switch/failover audit rows to the
 * `system` pseudo-lane.
 *
 * DSH has no lane concept: its closest shape is the per-Session header tabs and
 * the child-session list in
 * `dsh-upstream/packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
 * (`viewTabs`, `:135-143`, `:222-254`) plus the session crumb row (`:147-204`).
 * The lane bar copies that tab-strip placement; grouping and the state dot come
 * from the old page's `SessionDropdown` (`:200-356`).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Activity } from "@/lib/types";

import { resetActivitySessions } from "./message-history";

/** Lane group, mirroring the old dropdown's `SessionOption.group`. */
export type SessionLaneGroup = "mainagent" | "planner" | "worker";

/** One selectable lane; `key` is the backend session key of `activityHistory`. */
export interface SessionLane {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly group: SessionLaneGroup;
  /** Right-aligned meta (segment time or intent id). */
  readonly meta?: string;
  /** Whether this lane produced rows recently (running segment / running intent). */
  readonly live: boolean;
  /** Raw backend state of the lane, workers only (`IntentState`). */
  readonly state?: string;
}

/** Group headings, in the old listbox order (`task-workspace-dsh.tsx:116-120`). */
export const LANE_GROUP_LABEL: Record<SessionLaneGroup, string> = {
  mainagent: "主 Agent",
  planner: "规划 Planner",
  worker: "Workers",
};

/** Canonical main-agent lane key for a segment number. */
export function mainLaneKey(seq: number): string {
  return `main:${seq}`;
}

/** Segment index encoded in a `main:<n>` key, or null for any other lane. */
export function mainSegOf(key: string): number | null {
  const match = /^main:(\d+)$/.exec(key);
  return match === null ? null : Number(match[1]);
}

/** A sub-session lane (planner or worker): a read-only transcript. */
export function isSubLane(key: string | null): boolean {
  return key !== null && mainSegOf(key) === null;
}

/**
 * Route one activity row to its lane key. Mirrors the old page so the lane
 * filter and the lane list agree on what belongs where.
 * @param activity - one activity row of the task.
 * @returns the lane key the row is recorded under.
 */
export function laneKeyOf(activity: Activity): string {
  if (activity.worker === "system" || activity.kind === "llm_switch" || activity.kind === "llm_failover") {
    return "system";
  }
  if (activity.worker === "mainagent") return mainLaneKey(activity.main_seg ?? 0);
  if (activity.worker === "planner") return "plan";
  if (activity.intent_id !== undefined && activity.intent_id !== "") return `intent:${activity.intent_id}`;
  return activity.worker;
}

/** Label of one main-agent segment (`task-workspace-dsh.tsx:122-124`). */
export function mainSessionLabel(seq: number): string {
  return seq > 0 ? `主 Agent · #${seq + 1}` : "主 Agent";
}

/** `M/D HH:mm` of a segment creation stamp; empty when unparseable. */
export function sessionTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Worker lane title: the intent's `payload.summary`, else its raw payload, else
 * `Intent <id>` (`task-workspace-dsh.tsx:136-146`).
 */
export function intentTitle(payload: string | undefined, id: string): string {
  if (!payload) return `Intent ${id}`;
  try {
    const parsed = JSON.parse(payload) as { summary?: unknown };
    if (typeof parsed?.summary === "string" && parsed.summary.trim()) return parsed.summary.trim();
  } catch {
    const trimmed = payload.trim();
    if (trimmed) return trimmed;
  }
  return `Intent ${id}`;
}

/** Human label of a worker intent's `IntentState`. */
export function intentStateLabel(state: string | undefined): string {
  switch (state) {
    case "open":
      return "待派发";
    case "running":
      return "运行中";
    case "paused":
      return "已暂停";
    case "done":
      return "已完成";
    case "blocked":
      return "受阻";
    case "exhausted":
      return "已耗尽";
    case "stopped":
      return "已停止";
    default:
      return state === undefined || state === "" ? "未知" : state;
  }
}

export interface LaneList {
  readonly lanes: readonly SessionLane[];
  /** Newest (writable) main-agent segment number. */
  readonly current: number;
}

/**
 * Read the task's lane list: main-agent segments, the planner, then workers.
 * @param taskId - task whose lanes are listed.
 * @returns the grouped lane list and the current main segment.
 */
export async function loadLanes(taskId: string): Promise<LaneList> {
  const [sessions, intents] = await Promise.all([api.mainSessions(taskId), api.intents(taskId)]);
  const mainSessions = sessions.sessions.length > 0 ? sessions.sessions : [{ seq: 0, created_at: "" }];
  const main: SessionLane[] = mainSessions.map((session) => ({
    id: `main-${session.seq}`,
    key: mainLaneKey(session.seq),
    label: mainSessionLabel(session.seq),
    group: "mainagent",
    meta: sessionTime(session.created_at),
    live: session.seq === sessions.current,
    state: session.seq === sessions.current ? "current" : "archived",
  }));
  const planner: SessionLane = {
    id: "plan",
    key: "plan",
    label: "规划 Planner",
    group: "planner",
    live: true,
  };
  const workers: SessionLane[] = intents
    .filter((node) => node.state !== "deleted")
    .map((node) => ({
      id: `intent-${node.id}`,
      key: `intent:${node.id}`,
      label: intentTitle(node.payload, node.id),
      group: "worker",
      meta: `#${node.id}`,
      live: node.state === "running",
      state: node.state,
    }));
  return { lanes: [...main, planner, ...workers], current: sessions.current };
}

export interface SessionLanesState extends LaneList {
  readonly loading: boolean;
  readonly error: string | null;
  /** Re-read the lane list (after a new main session, or to refresh worker states). */
  readonly reload: () => void;
}

/**
 * Lane list of the selected task.
 * @param taskId - selected task, or null while nothing is open.
 * @returns the lanes plus reload/loading/error state.
 */
export function useSessionLanes(taskId: string | null): SessionLanesState {
  const [list, setList] = useState<LaneList>({ lanes: [], current: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    // Another task is another lane list: never show the previous one's lanes.
    setList({ lanes: [], current: 0 });
    setError(null);
    if (taskId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadLanes(taskId)
      .then((value) => {
        if (!live.current) return;
        setList(value);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!live.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (live.current) setLoading(false);
      });
  }, [taskId, tick]);

  const reload = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  return { lanes: list.lanes, current: list.current, loading, error, reload };
}

/**
 * Start a fresh main-agent segment and return it.
 *
 * `POST /exploration/main-sessions/{...}` (`api.ts:875`) flips the task's
 * current main session; the graph, assets and goal stay with the task. The
 * paging cache must be dropped so history keeps reaching the older segments.
 * @param taskId - task to reset the main conversation of.
 * @returns the new segment number and the task's new current segment.
 */
export async function createMainSession(taskId: string): Promise<{ seq: number; current: number }> {
  const result = await api.newMainSession(taskId);
  resetActivitySessions(taskId);
  return { seq: result.seq, current: result.current };
}

/**
 * Lane key of the newest main segment, for a row that carries no segment stamp.
 * @param current - newest main segment number of the task.
 * @returns the lane key.
 */
export function defaultMainLane(current: number): string {
  return mainLaneKey(current);
}

/* --------------------------------------------------------------------------
 * P1:B25 / P1:B27 / P1:B28 — 子会话列表与车道切换（会话区展示件新增部分）
 *
 * 旧页面依据：
 *   - 新车道的调用点 `task-workspace-dsh.tsx:2496-2505`（`/new` → `api.newMainSession`，
 *     成功后 `setCurrentKey(mainLaneKey(result.seq))`）；
 *   - 子会话列表 `_tabs/sessions-tab.tsx:1233-1259`（按 role 分组成
 *     mainagent / planner / worker / system）与 `:1655-1729`（分组渲染，
 *     mainagent 组头带「新建」按钮、worker 组带「加载更早的 Worker」）。
 *
 * 以下全部是只读派生，不发新请求：数据来自本文件已有的 `useSessionLanes` 与
 * `v2/data/intents.ts` 的 `useIntents`（后者就是 `api.intents`，与
 * `loadLanes` 里 worker 车道的来源同一个接口）。
 * ------------------------------------------------------------------------ */

/**
 * 按分组顺序取一个任务的子会话（旧页 `sessions-tab.tsx:1254-1259` 的 `grouped`）。
 * @param lanes - `useSessionLanes` 读到的车道列表。
 * @returns 四个分组各自的车道数组（顺序固定，空组为空数组）。
 */
export function groupLanes(
  lanes: readonly SessionLane[],
): Readonly<Record<SessionLaneGroup, readonly SessionLane[]>> {
  return {
    mainagent: lanes.filter((lane) => lane.group === "mainagent"),
    planner: lanes.filter((lane) => lane.group === "planner"),
    worker: lanes.filter((lane) => lane.group === "worker"),
  };
}

/**
 * 一个车道当前是否可写入。
 *
 * 旧页允许在任意主 Agent 分段里说话（`sessions-tab.tsx:1231-1232`「每个 main
 * 分段都是可交互的、独立会话」），而 planner 与 worker 车道只读
 * （`task-workspace-dsh.tsx:3225-3229`）。因此「主 Agent」指的是任意
 * `main:<seg>` 车道，不是只有当前分段。
 * @param lane - 待判断的车道键；null 是合并视图。
 * @returns 可写入返回 true。
 */
export function isWritableLane(lane: string | null): boolean {
  return lane === null || mainSegOf(lane) !== null;
}

/** 合并视图在车道分段控件里的取值（它与主 Agent 分段同一条发送通道）。 */
export const ALL_LANES_VALUE = "all";

/**
 * 分段控件里「主 Agent」那一段的取值：当前主 Agent 分段，存在即用它。
 *
 * 主 Agent 的每一段共用同一条 `POST /api/tasks/{id}/chat` 通道，输入区不受分段
 * 影响；但只有 `current` 段是后端当前写入的会话，其它段是历史（旧页把它叫
 * 「历史分段」，可读可切）。所以这里优先落到 `current`，让它成为「我正处在
 * 主 Agent 会话里」这一状态的真实代表。
 * @param lanes - 车道列表。
 * @param current - 后端当前的（可写的）主 Agent 分段号。
 * @returns 一个 `main:<seg>` 键；列表里没有主 Agent 分段时返回 null。
 */
export function primaryMainLane(lanes: readonly SessionLane[], current: number): string | null {
  const preferred = mainLaneKey(current);
  if (lanes.some((lane) => lane.key === preferred)) return preferred;
  const first = lanes.find((lane) => mainSegOf(lane.key) !== null);
  return first === undefined ? null : first.key;
}

/**
 * 把已有车道归到一段：`main` / `planner` / `worker` / `system`。
 *
 * `system` 是任务级 LLM 切换/故障转移审计行的伪车道（见 {@link laneKeyOf}），
 * 分段控件里没有它的一段，本函数把它单列出来供列表与计数使用。
 * @param lane - 车道键。
 * @returns 段名。
 */
export function laneSegmentGroup(lane: string): "main" | "planner" | "worker" | "system" {
  if (mainSegOf(lane) !== null) return "main";
  if (lane === "plan") return "planner";
  if (lane === "system") return "system";
  return "worker";
}

/**
 * 分段控件的取值换成车道键：只负责「选哪一类」，不等同于具体某条车道。
 *
 * 主 Agent 的多个分段共用一个控件段（都走同一条 chat 通道），具体落到哪一段
 * 由 {@link primaryMainLane} 给出；Worker 段则由 {@link pickWorkerLane} 在
 * 列表里选一条（优先运行中，否则最新）。
 * @param segment - 控件取值（`all` 走合并视图，其余三段各取一条车道）。
 * @param lanes - 车道列表。
 * @param current - 后端当前主 Agent 分段号。
 * @returns 车道键；该类车道不存在时返回 null。
 */
export function laneForSegment(
  segment: "all" | "main" | "planner" | "worker",
  lanes: readonly SessionLane[],
  current: number,
): string | null {
  if (segment === "all") return null;
  if (segment === "main") return primaryMainLane(lanes, current);
  if (segment === "planner") return lanes.some((lane) => lane.key === "plan") ? "plan" : null;
  return pickWorkerLane(lanes);
}

/**
 * Worker 段默认落到哪条意图车道：优先运行中，其次第一条非 deleted 的意图。
 * @param lanes - 车道列表。
 * @returns `intent:<id>` 键，没有 worker 车道时返回 null。
 */
export function pickWorkerLane(lanes: readonly SessionLane[]): string | null {
  const workers = lanes.filter((lane) => lane.group === "worker");
  const running = workers.find((lane) => lane.live);
  const first = running ?? workers[0];
  return first === undefined ? null : first.key;
}
