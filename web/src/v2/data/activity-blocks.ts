/**
 * Pure mapping from the backend's `Activity` stream to the blocks the ported
 * thread renders. No React, no fetching: the shell renders whatever this returns,
 * so the same mapping can be unit-checked against recorded activities.
 */
import type { Activity } from "@/lib/types";

/** Session identity an activity row was recorded under, carried onto message blocks. */
export interface MessageIdentity {
  /** Recording worker (`mainagent`, `planner`, `work#N`). */
  readonly worker: string;
  /** Main-agent segment; only meaningful for `mainagent` rows. */
  readonly mainSeg?: number;
  /** Worker intent id; only meaningful for worker rows. */
  readonly intentId?: string;
}

export type Block =
  | { kind: "head"; seq: number; worker: string; at: string }
  | ({ kind: "user"; seq: number; text: string } & MessageIdentity)
  | { kind: "thinking"; seq: number; text: string }
  | ({ kind: "text"; seq: number; text: string } & MessageIdentity)
  | {
      kind: "terminal";
      seq: number;
      tool: string;
      command: string;
      output: string;
      isError: boolean;
      resultSeq?: number;
    }
  | {
      kind: "diff";
      seq: number;
      tool: string;
      path: string;
      body: string;
      before?: string;
      after?: string;
      resultSeq?: number;
    }
  | { kind: "search"; seq: number; tool: string; query: string; result: string; resultSeq?: number }
  | { kind: "read"; seq: number; tool: string; label: string; result: string; resultSeq?: number }
  | { kind: "other"; seq: number; tool: string; text: string; resultSeq?: number };

/** Session identity of one activity row, for the message blocks that need it. */
function identityOf(activity: Activity): MessageIdentity {
  return {
    worker: activity.worker,
    mainSeg: activity.main_seg,
    intentId: activity.intent_id,
  };
}

/** Tools whose result reads as a terminal transcript. */
const TERMINAL = new Set(["bash", "shell", "sh", "run_command", "execute", "python", "node"]);
/** Tools that change files. */
const DIFF = new Set(["write", "edit", "multiedit", "apply_patch", "create_file", "str_replace"]);
/** Tools that search. */
const SEARCH = new Set(["grep", "glob", "search", "ripgrep", "find"]);
/** Tools that read a file. */
const READ = new Set(["read", "read_file", "view", "cat"]);

const norm = (tool: string | undefined): string => (tool ?? "").toLowerCase();

/** Best-effort path extraction from a tool summary or result body. */
function pathOf(activity: Activity): string {
  const fromSummary = activity.summary.match(/[\w./-]+\.\w{1,6}\b/);
  if (fromSummary !== null) return fromSummary[0];
  return activity.summary.slice(0, 60);
}

/** Payload extracted from a tool_use `detail`, when the backend records JSON. */
export interface ToolPayload {
  command?: string;
  path?: string;
  pattern?: string;
  before?: string;
  after?: string;
}

/** Read `[{type:'text',text}]` blocks down to plain text. */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => (part !== null && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
      .filter((part) => part !== "");
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

/**
 * Unwrap a tool_result `detail` into plain text.
 *
 * The agent records results as `[{type:'text',text:'…'}]`; older rows keep the
 * text as-is. Returns undefined when nothing readable is present.
 * @param detail - raw `activity.detail`.
 * @returns the concatenated text, or undefined.
 */
export function unwrapText(detail: string | undefined): string | undefined {
  if (detail === undefined || detail === "") return undefined;
  const direct = textOf(detail);
  if (direct !== undefined && !detail.trimStart().startsWith("[")) return direct;
  try {
    return textOf(JSON.parse(detail));
  } catch {
    return direct;
  }
}

/**
 * Parse a tool_use `detail` into the fields each card needs.
 *
 * Shapes follow what the agent actually emits (recorded transcripts):
 * Bash `{command,description}`, Read `{file_path}`, Grep/Glob `{pattern}`,
 * Write `{file_path,content}`, Edit `{file_path,old_string,new_string}`.
 * @param tool - normalized tool name.
 * @param detail - raw `activity.detail` (JSON string when recorded).
 * @returns whichever fields the tool carries; empty object when unparseable.
 */
export function toolPayload(tool: string, detail: string | undefined): ToolPayload {
  const fromDetail = payloadFromJson(tool, detail);
  if (Object.keys(fromDetail).length > 0 || detail === undefined || detail === "") return fromDetail;
  return fromDetail;
}

/** Parse a JSON string into card fields; empty when it is not an object. */
function payloadFromJson(tool: string, text: string | undefined): ToolPayload {
  if (text === undefined || text === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object") return {};
  const raw = parsed as Record<string, unknown>;
  const field = (key: string): string | undefined => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);

  if (TERMINAL.has(tool)) return { command: field("command") };
  // Write carries the new content only; Edit carries both sides.
  if (DIFF.has(tool)) return { path: field("file_path"), before: field("old_string"), after: field("new_string") ?? field("content") };
  if (SEARCH.has(tool)) return { pattern: field("pattern") ?? field("query") };
  if (READ.has(tool)) return { path: field("file_path") };
  return {};
}

/**
 * Split the backend's `tool_use` summary into tool name and JSON payload.
 *
 * The engine records the summary as `"<tool> {json}"` while `detail` stays
 * empty, so the payload has to be recovered from the summary itself.
 * @param summary - raw `activity.summary`.
 * @param fallbackTool - the activity's own `tool` field.
 * @returns the tool name carried in the summary and its parsed fields.
 */
export function splitSummary(summary: string, fallbackTool: string): { tool: string; payload: ToolPayload } {
  const brace = summary.indexOf("{");
  if (brace <= 0) return { tool: fallbackTool, payload: {} };
  const head = summary.slice(0, brace).trim();
  const tool = head === "" ? fallbackTool : head.toLowerCase();
  const payload = payloadFromJson(tool, summary.slice(brace));
  return { tool: tool === "" ? fallbackTool : tool, payload };
}

/**
 * Fold an activity stream into renderable blocks.
 *
 * `tool_result` attaches to the preceding `tool_use` with the same
 * `tool_use_id`; unmatched results still become a block so nothing is dropped.
 * @param activities - backend activities in log order.
 * @returns blocks in log order.
 */
export function toBlocks(activities: readonly Activity[]): Block[] {
  const blocks: Block[] = [];
  const pending = new Map<string, number>();
  let headWorker: string | null = null;

  for (const activity of activities) {
    const tool = norm(activity.tool);

    // Opening a new speaker's run: assistant output starts with a head row that
    // carries the worker and timestamp the cards themselves do not show.
    if (activity.worker !== headWorker && activity.kind !== "user") {
      headWorker = activity.worker;
      blocks.push({ kind: "head", seq: activity.seq - 0.5, worker: activity.worker, at: activity.ts });
    }

    if (activity.kind === "user") {
      blocks.push({ kind: "user", seq: activity.seq, text: activity.summary, ...identityOf(activity) });
      continue;
    }
    if (activity.kind === "thinking") {
      blocks.push({ kind: "thinking", seq: activity.seq, text: activity.summary });
      continue;
    }
    if (activity.kind === "text" || activity.kind === "result") {
      blocks.push({ kind: "text", seq: activity.seq, text: activity.summary, ...identityOf(activity) });
      continue;
    }
    if (activity.kind === "usage" || activity.kind === "round") continue;

    if (activity.kind === "tool_use") {
      const index = blocks.length;
      // `detail` is usually empty; the engine packs `"<tool> {json}"` into summary.
      const split = splitSummary(activity.summary, tool);
      const effective = split.tool === "" ? tool : split.tool;
      const payload = Object.keys(split.payload).length > 0 ? split.payload : toolPayload(tool, activity.detail);
      if (TERMINAL.has(effective)) {
        blocks.push({ kind: "terminal", seq: activity.seq, tool: effective, command: payload.command ?? activity.summary, output: "", isError: false });
      } else if (DIFF.has(effective)) {
        blocks.push({
          kind: "diff",
          seq: activity.seq,
          tool: effective,
          path: payload.path ?? pathOf(activity),
          body: activity.detail ?? activity.summary,
          before: payload.before,
          after: payload.after,
        });
      } else if (SEARCH.has(effective)) {
        blocks.push({ kind: "search", seq: activity.seq, tool: effective, query: payload.pattern ?? activity.summary, result: "" });
      } else if (READ.has(effective)) {
        blocks.push({ kind: "read", seq: activity.seq, tool: effective, label: payload.path ?? pathOf(activity), result: "" });
      } else {
        // Unknown tool: keep the name and a readable payload instead of raw JSON.
        const detailText = typeof (split.payload as { text?: string }).text === "string" ? (split.payload as { text: string }).text : activity.summary;
        blocks.push({ kind: "other", seq: activity.seq, tool: effective, text: `${effective} · ${detailText}` });
      }
      if (activity.tool_use_id !== undefined) pending.set(activity.tool_use_id, index);
      continue;
    }

    if (activity.kind === "tool_result") {
      const index = activity.tool_use_id === undefined ? undefined : pending.get(activity.tool_use_id);
      const target = index === undefined ? undefined : blocks[index];
      const body = unwrapText(activity.detail) ?? activity.summary;
      if (target === undefined) {
        blocks.push({ kind: "other", seq: activity.seq, tool, text: body });
        continue;
      }
      // The card's detail disclosure fetches the result row too, so the id has to
      // survive the fold into the tool_use block.
      if (target.kind !== "text" && target.kind !== "thinking" && target.kind !== "user" && target.kind !== "head") {
        target.resultSeq = activity.seq;
      }
      if (target.kind === "terminal") target.output = body;
      else if (target.kind === "search") target.result = body;
      else if (target.kind === "read") target.result = body;
      else if (target.kind === "diff") target.body = body;
      else if (target.kind === "other" || target.kind === "text") target.text = body;
      if (activity.is_error === true) {
        if (target.kind === "terminal") target.isError = true;
      }
      continue;
    }

    blocks.push({ kind: "other", seq: activity.seq, tool, text: activity.summary });
  }

  return blocks;
}
