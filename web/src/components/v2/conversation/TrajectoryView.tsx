"use client";

import type { CSSProperties, ReactNode } from "react";
/**
 * Trajectory View: a turn-grouped event ledger over the real activity stream.
 *
 * Structure follows `ui-trajectory` in 项目分析/dsh-upstream:
 *   - TrajectoryView.tsx:544-616   toolbar + timeline + ledger/details split
 *   - TrajectoryToolbar.tsx:58-145 timeline mode, whole-list fold, live search
 *   - TrajectoryTimeline.tsx:586-735 three-lane (input/model/tools) overview
 *   - TrajectoryTable.tsx:2658-3060 30px ledger rows, selection and details pane
 *   - TrajectoryTable.tsx:3082-3604 details header, tabs and overview list
 *
 * Upstream folds conversation event nodes into turns → Message/Step groups and
 * adds recorded request timing. ARTEX only has the flat `Activity` log, whose
 * engine markers are `round` rows, so turns are the round boundaries (a leading
 * round-less turn holds activities recorded before the first marker) and rows
 * are the activity's own kinds. `toBlocks` renders the same activity stream for
 * the chat View, so its tool classification and merged tool results feed both
 * the row payload/result and the details pane instead of being re-derived.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ScrollFollow, scrollMetrics } from "@/lib/scroll-follow";
import type { Activity } from "@/lib/types";
import type { ActivityPhase } from "@/v2/data/activity";
import { type Block, toBlocks, unwrapText } from "@/v2/data/activity-blocks";
import {
  IconCheckCircleOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconChevronsUpDownOutlineRegular,
  IconClockOutlineRegular,
  IconCloseOutlineRegular,
  IconCodeOutlineRegular,
  IconGoalOutlineRegular,
  IconInfoOutlineRegular,
  IconPlanOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconShieldOutlineRegular,
  IconThinkOutlineRegular,
  IconUserOutlineRegular,
  IconWrapLinesOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import css from "./TrajectoryView.module.css";

/** Activity kinds that become ledger rows; rounds are turn boundaries, usage is a counter. */
type RowKind = Exclude<Activity["kind"], "round" | "usage">;

/** Localized row label per kind (mirrors `ui-trajectory/src/client/locales.ts`). */
const KIND_LABEL: Record<RowKind, string> = {
  tool_use: "工具",
  tool_result: "工具结果",
  text: "助手",
  thinking: "思考",
  result: "完成",
  user: "用户",
  intent: "意图",
  llm_switch: "模型切换",
  llm_failover: "模型故障转移",
  intercept_request: "审批请求",
  plan: "计划",
  plan_review: "计划审阅",
};

/** Timeline lanes, in the upstream overview's top-to-bottom order. */
const LANE_LABEL: readonly string[] = ["输入", "模型", "工具"];

/** One labelled block of detail text in the details pane. */
interface DetailSection {
  readonly label: string;
  readonly text: string;
}

/** One ledger row: an activity (or a result merged into its tool call). */
interface TrajectoryRow {
  readonly seq: number;
  readonly kind: RowKind;
  readonly worker: string;
  readonly ts: string;
  /** Wall-clock `HH:MM:SS` shown in the row's time column. */
  readonly clock: string;
  /** Parsed epoch milliseconds; null when the timestamp is unparsable. */
  readonly tsMs: number | null;
  /** Recorded distance to the next row of the same turn. */
  readonly durationMs: number | null;
  readonly isError: boolean;
  /** Primary text shown in the content column. */
  readonly text: string;
  readonly toolName?: string;
  /** One-line tool arguments preview. */
  readonly argsPreview?: string;
  /** Merged tool result text. */
  readonly resultText?: string;
  /** Recorded tool-use id, indexed by the upstream search (callId source). */
  readonly callId?: string;
  /** Payload blocks for the details "输入" tab. */
  readonly inputSections: readonly DetailSection[];
  /** Raw recorded detail, when the engine persisted one. */
  readonly rawText?: string;
  readonly intent?: string;
  /** 1-based turn index this row belongs to. */
  readonly turnIndex: number;
}

interface TokenTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** One turn (a `round` marker and everything recorded under it). */
interface TrajectoryTurn {
  readonly index: number;
  readonly round: Activity | null;
  readonly title: string;
  readonly rows: readonly TrajectoryRow[];
  readonly workers: readonly string[];
  readonly tokens: TokenTotals;
  readonly startMs: number | null;
  readonly endMs: number | null;
}

type TimelineMode = "sequence" | "time";

interface TimelineSpan {
  readonly seq: number;
  readonly kind: RowKind;
  readonly lane: number;
  readonly start: number;
  readonly end: number;
  readonly error: boolean;
  readonly clock: string;
  readonly tooltip: string;
}

interface TimelineModel {
  readonly start: number;
  readonly end: number;
  readonly spans: readonly TimelineSpan[];
  readonly boundaries: readonly { readonly turn: number; readonly at: number }[];
}

type DetailTab = "overview" | "input" | "output" | "raw";

interface DetailTabItem {
  readonly id: DetailTab;
  readonly label: string;
}

/** Row style variables for the absolute timeline spans. */
type SpanStyle = CSSProperties & {
  "--trajectory-span-left": string;
  "--trajectory-span-width": string;
  "--trajectory-span-lane": string;
};

type BoundaryStyle = CSSProperties & {
  "--trajectory-turn-left": string;
};

const EMPTY_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Worker id → display name; unknown ids stay verbatim. */
function workerLabel(worker: string): string {
  if (worker === "planner") return "规划器";
  if (worker === "mainagent") return "主代理";
  const match = /^work#(.+)$/.exec(worker);
  return match === null ? worker : `执行器 ${match[1]}`;
}

/** `HH:MM:SS` of an ISO timestamp, or the raw value when it is shorter. */
function clockOf(ts: string): string {
  return ts.length >= 19 ? ts.slice(11, 19) : ts;
}

/** Epoch milliseconds of a recorded timestamp. */
function msOf(ts: string): number | null {
  const value = Date.parse(ts);
  return Number.isFinite(value) ? value : null;
}

/** Collapse whitespace so one-line rows and tooltips stay on one line. */
function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Truncate a preview string, honoring the ellipsis in the title attribute. */
function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Integer token count with a compact thousands suffix. */
function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  const scaled = value / 1000;
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}k`;
}

/** Human duration: milliseconds → 秒/分. */
function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} 毫秒`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, "")} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes} 分 ${rest} 秒`;
}

/** Parse a recorded JSON argument string and re-emit it for the details pane. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Lane for a kind, matching `timeline.ts:51-55`: tools bottom, model middle, rest top. */
function laneFor(kind: RowKind): number {
  if (kind === "tool_use" || kind === "tool_result") return 2;
  if (kind === "text" || kind === "result" || kind === "thinking") return 1;
  return 0;
}

/** Kind tag icon, matching the upstream `KIND_ICON` map. */
function kindIcon(kind: RowKind): ReactNode {
  switch (kind) {
    case "user":
      return <IconUserOutlineRegular size={11} />;
    case "thinking":
      return <IconThinkOutlineRegular size={11} />;
    case "text":
      return <IconWrapLinesOutlineRegular size={11} />;
    case "result":
      return <IconCheckCircleOutlineRegular size={11} />;
    case "tool_use":
      return <IconCodeOutlineRegular size={11} />;
    case "tool_result":
      return <IconWrapLinesOutlineRegular size={11} />;
    case "intent":
      return <IconGoalOutlineRegular size={11} />;
    case "plan":
    case "plan_review":
      return <IconPlanOutlineRegular size={11} />;
    case "intercept_request":
      return <IconShieldOutlineRegular size={11} />;
    case "llm_switch":
    case "llm_failover":
      return <IconRefreshOutlineRegular size={11} />;
    default:
      return <IconInfoOutlineRegular size={11} />;
  }
}

/** Merged tool result recovered from a `tool_result` activity. */
interface MergedResult {
  readonly text: string;
  readonly isError: boolean;
}

/**
 * Resolve a tool call's recorded result and payload.
 * @param activity - the `tool_use` activity.
 * @param block - the `toBlocks` card for that activity, when classified.
 * @param results - results indexed by `tool_use_id`.
 * @returns the payload sections, preview text, merged result and display name.
 */
function toolRow(
  activity: Activity,
  block: Block | undefined,
  results: ReadonlyMap<string, MergedResult>,
): TrajectoryRow {
  const brace = activity.summary.indexOf("{");
  const head = brace > 0 ? activity.summary.slice(0, brace).trim() : "";
  const toolName = head === "" ? (activity.tool ?? "工具") : head;
  const argsRaw = brace > 0 ? activity.summary.slice(brace) : undefined;
  const merged = activity.tool_use_id === undefined ? undefined : results.get(activity.tool_use_id);
  let text = "";
  let inputSections: readonly DetailSection[] = [];

  switch (block?.kind) {
    case "terminal":
      text = block.command;
      inputSections = [{ label: "命令", text: block.command }];
      break;
    case "diff":
      text = block.path;
      inputSections = [
        { label: "路径", text: block.path },
        ...(block.before === undefined ? [] : [{ label: "修改前", text: block.before }]),
        ...(block.after === undefined ? [] : [{ label: "修改后", text: block.after }]),
      ];
      break;
    case "search":
      text = block.query;
      inputSections = [{ label: "查询", text: block.query }];
      break;
    case "read":
      text = block.label;
      inputSections = [{ label: "文件", text: block.label }];
      break;
    default:
      // Unknown tools keep both sides: the engine packs `<tool> {json}` into
      // the summary and the result arrives as a separate activity.
      text = argsRaw ?? activity.summary;
      inputSections = argsRaw === undefined ? [] : [{ label: "参数", text: prettyJson(argsRaw) }];
      break;
  }

  const previewSource = argsRaw ?? text;
  const resultText = merged === undefined || merged.text === "" ? undefined : merged.text;
  return {
    seq: activity.seq,
    kind: "tool_use",
    worker: activity.worker,
    ts: activity.ts,
    clock: clockOf(activity.ts),
    tsMs: msOf(activity.ts),
    durationMs: null,
    isError: merged?.isError === true,
    text,
    toolName,
    argsPreview: truncate(singleLine(previewSource), 180),
    ...(resultText === undefined ? {} : { resultText }),
    inputSections,
    ...(activity.detail === undefined || activity.detail.trim() === "" ? {} : { rawText: activity.detail }),
    ...(activity.intent_id === undefined ? {} : { intent: activity.intent_id }),
    turnIndex: 0,
  };
}

/** Text carried by the block kinds that render their own summary. */
function blockText(block: Block | undefined): string {
  if (block === undefined) return "";
  switch (block.kind) {
    case "user":
    case "thinking":
    case "text":
    case "other":
      return block.text;
    default:
      return "";
  }
}

/** Build a row for an activity that is not a tool call, a round or usage. */
function plainRow(activity: Activity, block: Block | undefined): TrajectoryRow | null {
  if (activity.kind === "round" || activity.kind === "usage") return null;
  const blockContent = blockText(block);
  const text = blockContent === "" || activity.kind === "tool_result" ? activity.summary : blockContent;
  return {
    seq: activity.seq,
    kind: activity.kind,
    worker: activity.worker,
    ts: activity.ts,
    clock: clockOf(activity.ts),
    tsMs: msOf(activity.ts),
    durationMs: null,
    isError: activity.is_error === true,
    text,
    inputSections: [],
    ...(activity.detail === undefined || activity.detail.trim() === "" ? {} : { rawText: activity.detail }),
    ...(activity.intent_id === undefined ? {} : { intent: activity.intent_id }),
    turnIndex: 0,
  };
}

/** Build the row for a `tool_result` that no seen `tool_use` claimed. */
function standaloneResultRow(activity: Activity): TrajectoryRow {
  const body = (unwrapText(activity.detail) ?? activity.summary).trim();
  return {
    seq: activity.seq,
    kind: "tool_result",
    worker: activity.worker,
    ts: activity.ts,
    clock: clockOf(activity.ts),
    tsMs: msOf(activity.ts),
    durationMs: null,
    isError: activity.is_error === true,
    text: body,
    ...(body === "" ? {} : { resultText: body }),
    inputSections: [],
    ...(activity.detail === undefined || activity.detail.trim() === "" ? {} : { rawText: activity.detail }),
    ...(activity.intent_id === undefined ? {} : { intent: activity.intent_id }),
    turnIndex: 0,
  };
}

/** Fold activities into turns of rows, merging results into their tool calls. */
function buildTrajectory(
  activities: readonly Activity[],
  blockBySeq: ReadonlyMap<number, Block>,
): readonly TrajectoryTurn[] {
  const results = new Map<string, MergedResult>();
  for (const activity of activities) {
    if (activity.kind !== "tool_result") continue;
    const id = activity.tool_use_id;
    if (id === undefined) continue;
    const body = (unwrapText(activity.detail) ?? activity.summary).trim();
    const previous = results.get(id);
    let text = body;
    if (previous !== undefined && previous.text !== "") {
      text = body === "" ? previous.text : `${previous.text}\n${body}`;
    }
    results.set(id, { text, isError: previous?.isError === true || activity.is_error === true });
  }

  const seenToolUses = new Set<string>();
  const pending: { round: Activity | null; rows: TrajectoryRow[]; tokens: TokenTotals }[] = [];
  let current = { round: null as Activity | null, rows: [] as TrajectoryRow[], tokens: EMPTY_TOKENS };

  for (const activity of activities) {
    if (activity.kind === "usage") continue;
    if (activity.kind === "round") {
      if (current.round !== null || current.rows.length > 0) pending.push(current);
      current = { round: activity, rows: [], tokens: EMPTY_TOKENS };
      continue;
    }
    if (activity.kind === "tool_use" && activity.tool_use_id !== undefined) {
      seenToolUses.add(activity.tool_use_id);
    }
    let row: TrajectoryRow | null;
    if (activity.kind === "tool_result") {
      const id = activity.tool_use_id;
      if (id !== undefined && seenToolUses.has(id)) {
        // Merged into the tool row that produced it, as `toBlocks` does.
        continue;
      }
      row = standaloneResultRow(activity);
    } else if (activity.kind === "tool_use") {
      row = toolRow(activity, blockBySeq.get(activity.seq), results);
    } else {
      row = plainRow(activity, blockBySeq.get(activity.seq));
    }
    if (row === null) continue;
    current.rows.push(row);
    if (activity.kind === "result") {
      current.tokens = {
        input: current.tokens.input + (activity.input_tokens ?? 0),
        output: current.tokens.output + (activity.output_tokens ?? 0),
        cacheRead: current.tokens.cacheRead + (activity.cache_read_tokens ?? 0),
        cacheWrite: current.tokens.cacheWrite + (activity.cache_write_tokens ?? 0),
      };
    }
  }
  if (current.round !== null || current.rows.length > 0) pending.push(current);

  return pending.map((turn, index) => {
    const rows = turn.rows.map((row, position) => {
      const next = turn.rows[position + 1];
      const nextMs = next?.tsMs;
      return {
        ...row,
        turnIndex: index + 1,
        durationMs:
          row.tsMs === null || nextMs === null || nextMs === undefined || nextMs < row.tsMs ? null : nextMs - row.tsMs,
      };
    });
    const workers: string[] = [];
    for (const worker of [...(turn.round === null ? [] : [turn.round.worker]), ...rows.map((row) => row.worker)]) {
      if (workers.length === 0 || workers[workers.length - 1] !== worker) workers.push(worker);
    }
    const uniqueWorkers = [...new Set(workers)];
    const startMs = turn.round === null ? (rows[0]?.tsMs ?? null) : (msOf(turn.round.ts) ?? rows[0]?.tsMs ?? null);
    const endMs = rows[rows.length - 1]?.tsMs ?? null;
    const summary = turn.round?.summary.trim() ?? "";
    let title = "任务开始";
    if (turn.round !== null) title = summary === "" ? `第 ${index + 1} 轮` : summary;
    return {
      index: index + 1,
      round: turn.round,
      title,
      rows,
      workers: uniqueWorkers,
      tokens: turn.tokens,
      startMs,
      endMs,
    };
  });
}

/**
 * Summary line for a collapsed turn, mirroring `summarizeTurn`
 * (`TrajectoryTable.tsx:618-637`): the first content row stays visible and the
 * rest folds into `N 个步骤 · M 个工具调用`.
 *
 * DSH counts distinct request groups as "steps"; the flat ARTEX log has no
 * request ids, so a step is a contiguous run of one agent (planner / work#N /
 * mainagent) — the closest equivalent unit in this data.
 * @param turn - the turn being folded.
 * @returns the localized summary text.
 */
function summarizeTurn(turn: TrajectoryTurn): string {
  const rows = turn.rows.slice(1);
  let steps = 0;
  let previousWorker: string | null = null;
  for (const row of rows) {
    if (row.worker !== previousWorker) {
      steps += 1;
      previousWorker = row.worker;
    }
  }
  const toolCalls = rows.filter((row) => row.kind === "tool_use").length;
  return `${steps} 个步骤 · ${toolCalls} 个工具调用`;
}

/** Project turns into the overview timeline; equal width or recorded wall-clock. */
function buildTimeline(turns: readonly TrajectoryTurn[], mode: TimelineMode): TimelineModel | null {
  const items = turns.flatMap((turn) => turn.rows.map((row) => ({ row, turn })));
  if (items.length === 0) return null;

  if (mode === "sequence") {
    const spans = items.map(
      ({ row }, index): TimelineSpan => ({
        seq: row.seq,
        kind: row.kind,
        lane: laneFor(row.kind),
        start: index,
        end: index + 1,
        error: row.isError,
        clock: row.clock,
        tooltip: truncate(singleLine(row.resultText ?? row.text), 110),
      }),
    );
    const positionBySeq = new Map(spans.map((span) => [span.seq, span.start]));
    const boundaries = turns
      .filter((turn) => turn.rows.length > 0)
      .map((turn) => ({ turn: turn.index, at: positionBySeq.get(turn.rows[0].seq) ?? 0 }));
    return { start: 0, end: spans.length, spans, boundaries };
  }

  const starts: { row: TrajectoryRow; turn: TrajectoryTurn; start: number }[] = [];
  let lastKnown: number | null = null;
  for (const item of items) {
    const start: number | null = item.row.tsMs ?? lastKnown;
    if (start === null) continue;
    starts.push({ ...item, start });
    lastKnown = start;
  }
  if (starts.length === 0) return null;
  const spans = starts.map((item, index): TimelineSpan => {
    const next = starts[index + 1];
    const end = next === undefined ? item.start + 1000 : Math.max(item.start, next.start);
    return {
      seq: item.row.seq,
      kind: item.row.kind,
      lane: laneFor(item.row.kind),
      start: item.start,
      end,
      error: item.row.isError,
      clock: item.row.clock,
      tooltip: truncate(singleLine(item.row.resultText ?? item.row.text), 110),
    };
  });
  const startSeqs = new Map(starts.map((item) => [item.row.seq, item.start]));
  const boundaries = turns
    .filter((turn) => turn.rows.length > 0)
    .flatMap((turn) => {
      const at = startSeqs.get(turn.rows[0].seq);
      return at === undefined ? [] : [{ turn: turn.index, at }];
    });
  return {
    start: Math.min(...spans.map((span) => span.start)),
    end: Math.max(...spans.map((span) => span.end)),
    spans,
    boundaries,
  };
}

/** Row haystack for the live ledger search (turn, kind, agent, text, payload, result). */
function haystack(turn: TrajectoryTurn, row: TrajectoryRow): string {
  return [
    `turn ${turn.index}`,
    `第 ${turn.index} 轮`,
    turn.title,
    KIND_LABEL[row.kind],
    row.kind,
    row.worker,
    workerLabel(row.worker),
    row.text,
    row.toolName ?? "",
    row.argsPreview ?? "",
    row.resultText ?? "",
    row.rawText ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

/** Absolute timeline span placement inside the track. */
function spanStyle(span: TimelineSpan, model: TimelineModel): SpanStyle {
  const total = Math.max(1, model.end - model.start);
  return {
    "--trajectory-span-left": `${((span.start - model.start) / total) * 100}%`,
    "--trajectory-span-width": `${Math.max(0, ((span.end - span.start) / total) * 100)}%`,
    "--trajectory-span-lane": String(span.lane),
  };
}

/** Absolute turn boundary placement inside the track. */
function boundaryStyle(at: number, model: TimelineModel): BoundaryStyle {
  const total = Math.max(1, model.end - model.start);
  return { "--trajectory-turn-left": `${((at - model.start) / total) * 100}%` };
}

/**
 * Render the trajectory ledger.
 * @param props.activities - the selected task's activity stream, in log order.
 * @param props.phase - transport phase of the stream.
 * @returns the toolbar, overview timeline, ledger and details pane.
 */
export function TrajectoryView({
  activities,
  phase,
}: {
  readonly activities: readonly Activity[];
  readonly phase: ActivityPhase;
}): ReactNode {
  const [searchQuery, setSearchQuery] = useState("");
  /** Query the ledger is actually filtered by (200ms debounce, see below). */
  const [appliedQuery, setAppliedQuery] = useState("");
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("sequence");
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(() => new Set());
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  /** True when the reader left the floor: growth no longer follows and the chip shows. */
  const [away, setAway] = useState(false);
  /** False until the first layout adopted the floor (DSH hides the table meanwhile). */
  const [scrollReady, setScrollReady] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const viewRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef<ScrollFollow | null>(null);
  const detailsResizeDrag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    splitWidth: number;
  } | null>(null);
  /** Follow intent to restore when a search is cleared. */
  const followBeforeSearch = useRef(true);
  const previousQuery = useRef("");

  const controller = useCallback((): ScrollFollow => {
    // DSH follows only within 2px of the floor (`TrajectoryTable.tsx:48,2665`).
    if (followRef.current === null) followRef.current = new ScrollFollow(true, 2);
    return followRef.current;
  }, []);

  /**
   * Land the ledger on the newest activity.
   * @param behavior - `instant` for entry/task switch, `smooth` for live growth.
   */
  const toFloor = useCallback(
    (behavior: "instant" | "smooth"): void => {
      const element = viewRef.current;
      if (element === null) return;
      controller().toBottom(element, scrollMetrics(element), behavior);
      setAway(false);
      if (behavior !== "smooth") return;
      // A smooth follow can be dropped (reduced motion, suspended compositor, no
      // frames left in a background tab). Re-check once and fall back to a jump so
      // "following" never stalls with the newest turn off screen (ThreadView.tsx:65-79).
      window.setTimeout(() => {
        if (viewRef.current !== element) return;
        const metrics = scrollMetrics(element);
        if (metrics.floor - metrics.top > 1) controller().jump(element, metrics, metrics.floor);
      }, 420);
    },
    [controller],
  );

  /** Clamp a details width to the upstream bounds (320–720px, ledger keeps ≥280px). */
  const clampDetailsWidth = (width: number, splitWidth: number): number =>
    Math.max(320, Math.min(Math.min(720, splitWidth - 280), width));

  // 200ms input debounce (DSH throttles its index rebuild by 3000ms; mioX indexes
  // at most 800 rows in memory, so a short debounce is enough — see 差异表).
  useEffect(() => {
    if (searchQuery === appliedQuery) return;
    const timer = window.setTimeout(() => setAppliedQuery(searchQuery), 200);
    return () => window.clearTimeout(timer);
  }, [appliedQuery, searchQuery]);

  const blockBySeq = useMemo(() => {
    const map = new Map<number, Block>();
    for (const block of toBlocks(activities)) {
      if (Number.isInteger(block.seq)) map.set(block.seq, block);
    }
    return map;
  }, [activities]);
  const turns = useMemo(() => buildTrajectory(activities, blockBySeq), [activities, blockBySeq]);
  const query = appliedQuery.trim().toLocaleLowerCase();
  const terms = useMemo(() => (query === "" ? null : query.split(/\s+/).filter((term) => term !== "")), [query]);
  // Same rule as the upstream search index (`trajectory-search-index.ts:124-132`):
  // every space-separated term must occur in the record's sources, case-insensitive.
  const matchedSeqs = useMemo(() => {
    if (terms === null || terms.length === 0) return null;
    const matched = new Set<number>();
    for (const turn of turns) {
      for (const row of turn.rows) {
        const text = haystack(turn, row);
        if (terms.every((term) => text.includes(term))) matched.add(row.seq);
      }
    }
    return matched;
  }, [terms, turns]);
  const visibleTurns = useMemo(() => {
    if (matchedSeqs === null) return turns;
    return turns.flatMap((turn) => {
      const rows = turn.rows.filter((row) => matchedSeqs.has(row.seq));
      return rows.length === 0 ? [] : [{ ...turn, rows }];
    });
  }, [matchedSeqs, turns]);
  const matchCount = matchedSeqs === null ? null : matchedSeqs.size;
  const timeline = useMemo(() => buildTimeline(turns, timelineMode), [timelineMode, turns]);
  // Only turns with more than one content record fold (TrajectoryView.tsx:433-446).
  const collapsibleTurns = useMemo(() => turns.filter((turn) => turn.rows.length > 1), [turns]);
  const allCollapsed = collapsibleTurns.length > 0 && collapsibleTurns.every((turn) => collapsedTurns.has(turn.index));
  const rows = useMemo(() => turns.flatMap((turn) => turn.rows), [turns]);
  const selectedRow = selectedSeq === null ? undefined : rows.find((row) => row.seq === selectedSeq);
  const selectedTurn =
    selectedRow === undefined ? undefined : turns.find((turn) => turn.index === selectedRow.turnIndex);

  const toggleTurn = useCallback(
    (index: number) => {
      setCollapsedTurns((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      // A fold changes the content height under the reader; following keeps the
      // floor instead of leaving the newest row pushed out of view.
      if (controller().active) requestAnimationFrame(() => toFloor("instant"));
    },
    [controller, toFloor],
  );

  const toggleAllTurns = useCallback(() => {
    setCollapsedTurns((current) => {
      const next = new Set(current);
      if (allCollapsed) {
        for (const turn of collapsibleTurns) next.delete(turn.index);
      } else {
        for (const turn of collapsibleTurns) next.add(turn.index);
      }
      return next;
    });
    if (controller().active) requestAnimationFrame(() => toFloor("instant"));
  }, [allCollapsed, collapsibleTurns, controller, toFloor]);

  const registerRow = useCallback((seq: number, element: HTMLButtonElement | null) => {
    if (element === null) rowRefs.current.delete(seq);
    else rowRefs.current.set(seq, element);
  }, []);

  const toggleRow = useCallback((seq: number) => {
    setSelectedSeq((current) => (current === seq ? null : seq));
    setActiveTab("overview");
  }, []);

  const focusRow = useCallback((seq: number) => {
    setSelectedSeq(seq);
    setActiveTab("overview");
    requestAnimationFrame(() => {
      rowRefs.current.get(seq)?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  const rowsVisible = phase === "ready" && turns.length > 0;
  const lastSeq = activities.length > 0 ? activities[activities.length - 1].seq : null;

  // Reader intent: every scroll sample decides whether growth keeps the floor
  // (same policy as ThreadView.tsx:81-95 over the shared ScrollFollow). The
  // trajectory instance uses DSH's 2px follow threshold.
  useEffect(() => {
    if (!rowsVisible) return;
    const element = viewRef.current;
    if (element === null) return;
    const onScroll = (): void => setAway(!controller().sample(scrollMetrics(element)));
    const onScrollEnd = (): void => {
      controller().settle(scrollMetrics(element));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("scrollend", onScrollEnd);
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("scrollend", onScrollEnd);
    };
  }, [controller, rowsVisible]);

  // Entering the trajectory View (mount, task switch, or coming back from chat)
  // adopts the floor without animation, then reveals the ledger: DSH does the
  // same on first layout (`TrajectoryTable.tsx:2634-2641`) and hides the table
  // until ready (`TrajectoryTable.module.css:97-99`).
  useEffect(() => {
    if (!rowsVisible) {
      setScrollReady(false);
      return;
    }
    const element = viewRef.current;
    if (element === null) return;
    controller().reset();
    setAway(false);
    const id = requestAnimationFrame(() => {
      const metrics = scrollMetrics(element);
      controller().jump(element, metrics, metrics.floor);
      setScrollReady(true);
    });
    return () => cancelAnimationFrame(id);
  }, [controller, rowsVisible]);

  // Live growth: keep the floor while following (smooth), otherwise surface the
  // "回到最新" chip. The activity hook appends SSE rows; nothing here polls.
  useEffect(() => {
    if (lastSeq === null || !rowsVisible) return;
    const id = requestAnimationFrame(() => {
      if (query !== "") return;
      if (controller().active) toFloor("smooth");
      else setAway(true);
    });
    return () => cancelAnimationFrame(id);
  }, [controller, lastSeq, query, rowsVisible, toFloor]);

  // Search narrows the ledger: show the first match instead of leaving the
  // reader on a row the filter just hid, and restore the pre-search follow
  // intent when the query is cleared.
  useEffect(() => {
    const previous = previousQuery.current;
    if (previous === query) return;
    previousQuery.current = query;
    if (query !== "") {
      if (previous === "") followBeforeSearch.current = controller().active;
      controller().setFollowing(false);
      setAway(false);
      const id = requestAnimationFrame(() => {
        if (viewRef.current !== null) viewRef.current.scrollTop = 0;
      });
      return () => cancelAnimationFrame(id);
    }
    if (followBeforeSearch.current) {
      const id = requestAnimationFrame(() => toFloor("instant"));
      return () => cancelAnimationFrame(id);
    }
    const element = viewRef.current;
    if (element !== null) setAway(!controller().nearBottom(scrollMetrics(element)));
    return;
  }, [controller, query, toFloor]);

  const detailTabs: readonly DetailTabItem[] =
    selectedRow === undefined
      ? []
      : [
          { id: "overview", label: "概述" },
          ...(selectedRow.inputSections.length === 0 ? [] : [{ id: "input" as const, label: "参数" }]),
          ...(selectedRow.resultText === undefined ? [] : [{ id: "output" as const, label: "结果" }]),
          ...(selectedRow.rawText === undefined ? [] : [{ id: "raw" as const, label: "原文" }]),
        ];
  const activeDetailTab = detailTabs.some((tab) => tab.id === activeTab) ? activeTab : "overview";

  if (phase === "loading") return <div className={css.placeholder}>读取轨迹…</div>;
  if (phase === "offline") return <div className={css.placeholder}>未连接后端（活动流不可用）</div>;
  if (phase === "idle") return <div className={css.placeholder}>选择左侧任务查看轨迹</div>;
  if (turns.length === 0) return <div className={css.placeholder}>这个任务还没有轨迹记录</div>;

  return (
    <div
      className={css.root}
      data-view-ledger=""
      data-following={away || matchedSeqs !== null ? "false" : "true"}
      data-search-active={matchedSeqs === null ? undefined : "true"}
    >
      <div className={css.toolbar} role="toolbar" aria-label="轨迹工具栏" data-trajectory-toolbar="">
        <div className={css.toolbarActions}>
          <button
            type="button"
            className={css.toolbarButton}
            aria-label={timelineMode === "time" ? "使用等宽操作" : "使用实际时间"}
            aria-pressed={timelineMode === "time"}
            title={timelineMode === "time" ? "使用等宽操作" : "使用实际时间"}
            onClick={() => {
              setTimelineMode((current) => (current === "time" ? "sequence" : "time"));
            }}
          >
            <IconClockOutlineRegular size={11} />
            <span>{timelineMode === "time" ? "实际时间" : "操作序列"}</span>
          </button>
          <button
            type="button"
            className={css.toolbarButton}
            aria-label={allCollapsed ? "展开所有轮次" : "收起所有轮次"}
            aria-pressed={allCollapsed}
            title={allCollapsed ? "展开所有轮次" : "收起所有轮次"}
            onClick={toggleAllTurns}
          >
            <IconChevronsUpDownOutlineRegular size={11} />
            <span>轮次</span>
          </button>
          <span className={css.toolbarCount}>{rows.length} 条记录</span>
        </div>
        <label className={css.search}>
          <IconSearchOutlineRegular size={11} className={css.searchIcon} />
          <input
            type="search"
            className={css.searchInput}
            aria-label="搜索轨迹"
            placeholder="搜索"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              if (searchQuery !== "") setSearchQuery("");
              else event.currentTarget.blur();
            }}
          />
        </label>
        {matchCount === null ? null : (
          <span className={css.matchCount} aria-live="polite">
            {matchCount === 0 ? "无匹配" : `${matchCount} 项匹配`}
          </span>
        )}
      </div>

      {timeline === null ? null : (
        <section className={css.timeline} aria-label="轨迹时间线">
          <div className={css.laneLabels} aria-hidden="true">
            {LANE_LABEL.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className={css.timelineTrack} data-trajectory-track="">
            {timeline.boundaries
              .filter((boundary) => boundary.at > timeline.start)
              .map((boundary) => (
                <span
                  key={boundary.turn}
                  className={css.boundary}
                  style={boundaryStyle(boundary.at, timeline)}
                  aria-hidden="true"
                />
              ))}
            {timeline.spans.map((span) => {
              const matched = matchedSeqs === null || matchedSeqs.has(span.seq);
              return (
                <button
                  key={span.seq}
                  type="button"
                  className={css.timelineSpan}
                  data-kind={span.kind}
                  data-error={span.error ? "true" : undefined}
                  data-match={matched ? undefined : "false"}
                  data-selected={span.seq === selectedSeq ? "true" : undefined}
                  aria-label={`${KIND_LABEL[span.kind]} ${span.clock}`}
                  title={`${KIND_LABEL[span.kind]} · ${span.clock}\n${span.tooltip}`}
                  style={spanStyle(span, timeline)}
                  onClick={() => {
                    focusRow(span.seq);
                  }}
                />
              );
            })}
          </div>
        </section>
      )}

      <div className={css.split}>
        <div className={css.tableViewport}>
          <div
            className={css.tablePane}
            ref={viewRef}
            data-trajectory-scroll=""
            data-scroll-ready={scrollReady ? "true" : "false"}
          >
            {visibleTurns.map((turn) => {
              // Folding follows DSH: a turn folds only when it has more than one
              // content record, search bypasses folding, and the collapsed
              // representation is a summary row (TrajectoryTable.tsx:639-672,2775-2848).
              const collapsible = matchedSeqs === null && turn.rows.length > 1;
              const collapsed = collapsible && collapsedTurns.has(turn.index);
              const rowsToRender = collapsed ? turn.rows.slice(0, 1) : turn.rows;
              const summaryText = collapsed ? summarizeTurn(turn) : "";
              const elapsed =
                turn.startMs === null || turn.endMs === null || turn.endMs < turn.startMs
                  ? null
                  : turn.endMs - turn.startMs;
              return (
                <section className={css.turn} data-turn={turn.index} key={turn.index}>
                  <button
                    type="button"
                    className={css.turnHeader}
                    data-turn-header=""
                    data-collapsed={collapsed ? "true" : undefined}
                    aria-expanded={collapsible ? !collapsed : undefined}
                    disabled={!collapsible}
                    title={collapsible ? (collapsed ? "展开此轮" : "收起此轮") : "该轮次只有一条记录"}
                    onClick={() => {
                      if (collapsible) toggleTurn(turn.index);
                    }}
                  >
                    <span className={css.turnToggle} aria-hidden="true">
                      {collapsed ? (
                        <IconChevronRightOutlineRegular size={11} />
                      ) : (
                        <IconChevronDownOutlineRegular size={11} />
                      )}
                    </span>
                    <span className={css.turnTitle} title={turn.title}>
                      {turn.title}
                    </span>
                    <span className={css.turnDescription}>
                      {turn.workers.map((worker) => workerLabel(worker)).join(" · ")}
                    </span>
                    <span className={css.turnMetrics}>
                      <span className={css.turnMetric}>{turn.rows.length} 条</span>
                      {turn.tokens.input === 0 && turn.tokens.output === 0 ? null : (
                        <>
                          <span className={css.turnMetric}>输入 {formatTokens(turn.tokens.input)}</span>
                          <span className={css.turnMetric}>输出 {formatTokens(turn.tokens.output)}</span>
                        </>
                      )}
                      {elapsed === null ? null : <span className={css.turnMetric}>跨度 {formatDuration(elapsed)}</span>}
                    </span>
                  </button>
                  <div className={css.turnBody}>
                    {rowsToRender.map((row) => {
                      const selected = row.seq === selectedSeq;
                      const expandable =
                        row.inputSections.length > 0 || row.resultText !== undefined || row.rawText !== undefined;
                      let disclosure: ReactNode = null;
                      if (expandable) {
                        disclosure = selected ? (
                          <IconChevronDownOutlineRegular size={11} />
                        ) : (
                          <IconChevronRightOutlineRegular size={11} />
                        );
                      }
                      return (
                        <button
                          key={row.seq}
                          type="button"
                          ref={(element) => {
                            registerRow(row.seq, element);
                          }}
                          className={css.row}
                          data-kind={row.kind}
                          data-seq={row.seq}
                          data-selected={selected ? "true" : undefined}
                          data-error={row.isError ? "true" : undefined}
                          aria-pressed={selected}
                          aria-label={`${KIND_LABEL[row.kind]} ${row.clock} ${singleLine(row.text)}`}
                          title={`${workerLabel(row.worker)} · ${row.ts}\n${row.text}`}
                          onClick={() => {
                            toggleRow(row.seq);
                          }}
                          onDoubleClick={() => {
                            if (collapsible) toggleTurn(turn.index);
                          }}
                        >
                          <span className={css.kindCell}>
                            <span className={css.kindTag} data-kind={row.kind}>
                              <span className={css.kindIcon} aria-hidden="true">
                                {kindIcon(row.kind)}
                              </span>
                              <span className={css.kindLabel}>{KIND_LABEL[row.kind]}</span>
                            </span>
                          </span>
                          <span className={css.rowContent}>
                            {row.kind === "tool_use" ? (
                              <>
                                <span className={css.toolName}>{row.toolName}</span>
                                {row.argsPreview === undefined || row.argsPreview === "" ? null : (
                                  <span className={css.toolArgs}>{row.argsPreview}</span>
                                )}
                                {row.resultText === undefined ? null : (
                                  <span className={css.rowResult}>
                                    <span className={css.rowArrow} aria-hidden="true">
                                      →
                                    </span>
                                    <span className={css.rowResultText}>
                                      {truncate(singleLine(row.resultText), 160)}
                                    </span>
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className={css.rowText}>
                                {row.text === "" ? "（无内容）" : truncate(singleLine(row.text), 240)}
                              </span>
                            )}
                          </span>
                          <span className={css.rowTime}>{row.clock}</span>
                          <span className={css.rowDisclosure} aria-hidden="true">
                            {disclosure}
                          </span>
                        </button>
                      );
                    })}
                    {collapsed ? (
                      <button
                        type="button"
                        className={css.summaryRow}
                        data-collapsed-summary="turn"
                        data-turn-summary={turn.index}
                        aria-expanded={false}
                        aria-label={`已收起的轮次概述，${summaryText}`}
                        title="展开此轮"
                        onClick={() => {
                          toggleTurn(turn.index);
                        }}
                      >
                        <span className={css.summaryEllipsis} aria-hidden="true">
                          …
                        </span>
                        <span className={css.summaryText}>{summaryText}</span>
                      </button>
                    ) : null}
                  </div>
                </section>
              );
            })}
            {visibleTurns.length === 0 ? (
              <div className={css.noMatches}>没有匹配“{searchQuery.trim()}”的轨迹记录</div>
            ) : null}
          </div>

          {away && query === "" ? (
            <button
              type="button"
              className={css.jumpLatest}
              data-jump-latest=""
              aria-label="回到最新"
              title="回到最新"
              onClick={() => {
                toFloor("smooth");
              }}
            >
              <IconChevronDownOutlineRegular size={13} />
              <span>回到最新</span>
            </button>
          ) : null}
        </div>

        {selectedRow === undefined ? null : (
          <aside className={css.details} aria-label="事件详情" data-trajectory-details="">
            <div className={css.detailsHeader}>
              <div className={css.detailsTitle}>
                <span className={css.kindTag} data-kind={selectedRow.kind}>
                  <span className={css.kindIcon} aria-hidden="true">
                    {kindIcon(selectedRow.kind)}
                  </span>
                  <span className={css.kindLabel}>{KIND_LABEL[selectedRow.kind]}</span>
                </span>
                <span className={css.detailsLocation} title={selectedTurn?.title}>
                  {selectedTurn?.title ?? "—"} · {selectedRow.clock}
                </span>
              </div>
              <button
                type="button"
                className={css.close}
                aria-label="关闭详情"
                onClick={() => {
                  setSelectedSeq(null);
                }}
              >
                <IconCloseOutlineRegular size={14} />
              </button>
            </div>
            <div className={css.detailTabs} role="tablist" aria-label="事件详情">
              {detailTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeDetailTab === tab.id}
                  className={tab.id === activeDetailTab ? `${css.detailTab} ${css.detailTabActive}` : css.detailTab}
                  onClick={() => {
                    setActiveTab(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={css.detailBody} role="tabpanel">
              {activeDetailTab === "overview" ? (
                <>
                  <dl className={css.overview}>
                    <div>
                      <dt>状态</dt>
                      <dd className={selectedRow.isError ? css.error : undefined}>
                        {selectedRow.isError ? "失败" : "成功"}
                      </dd>
                    </div>
                    <div>
                      <dt>轮次</dt>
                      <dd>{selectedTurn?.title ?? "—"}</dd>
                    </div>
                    {selectedRow.toolName === undefined ? null : (
                      <div>
                        <dt>工具</dt>
                        <dd>{selectedRow.toolName}</dd>
                      </div>
                    )}
                    <div>
                      <dt>代理</dt>
                      <dd>
                        {workerLabel(selectedRow.worker)}
                        <span className={css.muted}> · {selectedRow.worker}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>记录时间</dt>
                      <dd className={css.monospace}>{selectedRow.ts}</dd>
                    </div>
                    <div>
                      <dt>到下一事件</dt>
                      <dd>{formatDuration(selectedRow.durationMs)}</dd>
                    </div>
                    {selectedRow.intent === undefined ? null : (
                      <div>
                        <dt>意图</dt>
                        <dd className={css.monospace}>#{selectedRow.intent}</dd>
                      </div>
                    )}
                    <div>
                      <dt>序号</dt>
                      <dd className={css.monospace}>#{selectedRow.seq}</dd>
                    </div>
                  </dl>
                  <section className={css.detailSection}>
                    <h3 className={css.detailHeading}>{selectedRow.kind === "tool_use" ? "参数摘要" : "内容"}</h3>
                    <pre className={css.detailPre}>{selectedRow.text === "" ? "（无内容）" : selectedRow.text}</pre>
                  </section>
                  {selectedRow.resultText === undefined ? null : (
                    <section className={css.detailSection}>
                      <h3 className={css.detailHeading}>结果</h3>
                      <pre className={selectedRow.isError ? `${css.detailPre} ${css.error}` : css.detailPre}>
                        {selectedRow.resultText}
                      </pre>
                    </section>
                  )}
                </>
              ) : null}
              {activeDetailTab === "input"
                ? selectedRow.inputSections.map((section) => (
                    <section className={css.detailSection} key={section.label}>
                      <h3 className={css.detailHeading}>{section.label}</h3>
                      <pre className={css.detailPre}>{section.text}</pre>
                    </section>
                  ))
                : null}
              {activeDetailTab === "output" ? (
                <section className={css.detailSection}>
                  <h3 className={css.detailHeading}>输出</h3>
                  <pre className={selectedRow.isError ? `${css.detailPre} ${css.error}` : css.detailPre}>
                    {selectedRow.resultText ?? "无输出"}
                  </pre>
                </section>
              ) : null}
              {activeDetailTab === "raw" ? (
                <section className={css.detailSection}>
                  <h3 className={css.detailHeading}>原文</h3>
                  <pre className={css.detailPre}>{selectedRow.rawText ?? "（无原始记录）"}</pre>
                </section>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
