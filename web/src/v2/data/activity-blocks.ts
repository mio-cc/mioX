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
  | ({ kind: "user"; seq: number; text: string; source?: string; automationTitle?: string } & MessageIdentity)
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
  | { kind: "other"; seq: number; tool: string; text: string; resultSeq?: number }
  | PlanBlock
  | PlanReviewBlock
  | DecomposeBlock;

/**
 * Planner 目标拆解段（round-0「第 0 轮目标拆解」、/goal 的「目标拆解（/goal）」）折叠卡。
 *
 * 用户反馈的问题：同一个目标在对话流里重复出现 3 遍——set_goals 工具卡、`{"ids":[395]}`
 * 回执、长 result 正文、每个验收项一条 text。做法：round 行开一张卡，段内**所有**
 * worker=planner 的行（到下一条 planner round 为止）都收进卡里，mainagent/system 行
 * 照常在原位置输出。段内 planner 行（含拆解 head）不再各自成块。
 */
export interface DecomposeBlock {
  kind: "decompose";
  /** 开卡的 round 行 seq。 */
  seq: number;
  /** round 摘要（「第 0 轮目标拆解」/「目标拆解（/goal）」）。 */
  summary: string;
  /** set_goals 登记的验收项目标文本。 */
  goals: string[];
  /** set_constraints / add_task_scope 登记的条目（若有）。 */
  extras: string[];
  /** planner result 正文与折进来的 text/thinking，「查看拆解说明」展开后显示。 */
  report: string;
}

/**
 * A plan submitted through `exit_plan_mode` (`agent/tools_plan.go`: one
 * `kind="plan"` activity, summary = heading, detail = full Markdown, metadata
 * `{title, tool_use_id}`). The list endpoint carries only `detail_head` (the
 * first 2000 characters), so `truncated` tells the card to fetch the row.
 */
export interface PlanBlock {
  kind: "plan";
  seq: number;
  title: string;
  /** Plan Markdown as far as the list row carries it. */
  markdown: string;
  /** `markdown` is a prefix; the full text needs `GET /exploration/activity/{seq}`. */
  truncated: boolean;
  toolUseId?: string;
  /** Pending id of the review that followed this plan (`plan_review` row). */
  reviewId?: number;
  /** Revision notes the user sent with "继续规划", read from the tool result. */
  feedback?: string;
  /** The tool call ended in an error other than a revision request (e.g. no review channel). */
  failure?: string;
}

/**
 * A review request (`intercept/plan_review.go`: `kind="plan_review"`, summary
 * `计划审阅：<title> (#<id>)`, detail `{pending_id,title,plan}`). When the plan it
 * reviews is in the same window, the fold attaches the id to that plan block and
 * marks this one `attached`, so the thread draws one card per plan.
 */
export interface PlanReviewBlock {
  kind: "plan_review";
  seq: number;
  reviewId: number | null;
  title: string;
  /** Plan text recovered from the row, for a review whose plan row is not loaded. */
  markdown: string;
  attached: boolean;
}

/** Tool name of plan submission (`intercept.ExitPlanModeTool`). */
const EXIT_PLAN_MODE = "exit_plan_mode";

/** Read the review id out of `计划审阅：<title> (#<id>)` or the JSON detail. */
function reviewIdOf(activity: Activity): number | null {
  const fromSummary = /\(#(\d+)\)\s*$/.exec(activity.summary);
  if (fromSummary !== null) return Number(fromSummary[1]);
  const raw = activity.detail ?? activity.detail_head ?? "";
  const fromDetail = /"pending_id"\s*:\s*(\d+)/.exec(raw);
  return fromDetail === null ? null : Number(fromDetail[1]);
}

/** Title and plan of a review row; the JSON may be cut at 2000 characters. */
function reviewPayloadOf(activity: Activity): { title: string; plan: string } {
  const raw = activity.detail ?? activity.detail_head ?? "";
  try {
    const parsed = JSON.parse(raw) as { title?: unknown; plan?: unknown };
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      plan: typeof parsed.plan === "string" ? parsed.plan : "",
    };
  } catch {
    const title = /^计划审阅：([\s\S]*?)\s*\(#\d+\)\s*$/.exec(activity.summary)?.[1] ?? "";
    const plan = /"plan"\s*:\s*"([\s\S]*)$/.exec(raw)?.[1] ?? "";
    return {
      title,
      plan: plan.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "\t").replace(/\\\\/g, "\\"),
    };
  }
}

/** Feedback carried by a "keep planning" tool error (`tools_plan.go:262`). */
function revisionFeedbackOf(text: string): string | undefined {
  const match = /反馈：([\s\S]*?)。请按反馈修改计划/.exec(text);
  return match === null ? undefined : match[1].trim();
}

/** Session identity of one activity row, for the message blocks that need it. */
function identityOf(activity: Activity): MessageIdentity {
  return {
    worker: activity.worker,
    mainSeg: activity.main_seg,
    intentId: activity.intent_id,
  };
}

/**
 * S-4 自动化消息标记（.tmp/d5-backend-api.md §3「S-4」）：投递的 user 行
 * `metadata = {"source":"automation",…,"automation_title":"…"}`。`types.ts` 的
 * `Activity.metadata` 只留了已定型的字段，这里按鸭子读出标记。
 */
function automationMarkOf(activity: Activity): { source: string; automationTitle?: string } | null {
  const raw = activity.metadata as { source?: unknown; automation_title?: unknown } | undefined;
  if (raw === undefined || raw === null || typeof raw !== "object") return null;
  if (typeof raw.source !== "string" || raw.source === "") return null;
  return { source: raw.source, automationTitle: typeof raw.automation_title === "string" ? raw.automation_title : undefined };
}

/** 目标拆解 round 的标记：新任务 round-0 与 /goal 触发的 round 摘要都含它。 */
const DECOMPOSE_ROUND = "目标拆解";

/** 拆解段的工具行有效名（工具名不带路径大小写差异，直接小写比较）。 */
function effectiveToolOf(activity: Activity): string {
  const tool = norm(activity.tool);
  const brace = activity.summary.indexOf("{");
  if (brace <= 0) return tool;
  const head = activity.summary.slice(0, brace).trim();
  return head === "" ? tool : head.toLowerCase();
}

/** `{"text": …}` 字符串值抽取器，JSON 与被截断的 detail_head 都能读。 */
function stringFieldOf(value: unknown): string | undefined {
  return value !== null && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
    ? (value as { text: string }).text
    : undefined;
}

/**
 * 拆解工具调用的载荷：优先 `detail`/`detail_head` 的 JSON，截断时再用正则逐个取
 * `"text"` 字段，最后退回 summary 内嵌的 JSON。
 * @returns 解析出的对象；解析不出时为空对象。
 */
function objectPayloadOf(activity: Activity): Record<string, unknown> {
  const sources = [activity.detail, activity.detail_head];
  for (const raw of sources) {
    if (raw === undefined || !raw.trimStart().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // 长 JSON 被 detail_head 截断：交给调用方正则兜底。
    }
  }
  const brace = activity.summary.indexOf("{");
  if (brace >= 0) {
    try {
      const parsed = JSON.parse(activity.summary.slice(brace)) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // summary 同样可能截断。
    }
  }
  return {};
}

/** 从 JSON 数组或截断文本里取 `text` 字段列表（set_goals 的 goals / set_constraints 的 constraints）。 */
function textItemsOf(payload: Record<string, unknown>, key: string, rawText: string | undefined): string[] {
  const list = payload[key];
  const fromList = Array.isArray(list) ? list.map(stringFieldOf).filter((text): text is string => text !== undefined && text.trim() !== "") : [];
  if (fromList.length > 0) return fromList;
  if (rawText === undefined) return [];
  // 截断的 detail_head：`"text"\s*:\s*"…"` 逐个抓取（转义先剥掉裸换行，避免跨段拼接）。
  const item = String(rawText);
  const out: string[] = [];
  const pattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match = pattern.exec(item);
  while (match !== null) {
    const text = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    if (text !== "") out.push(text);
    match = pattern.exec(item);
  }
  return out;
}

/** add_task_scope 的 entries → 「kind value（reason）」摘要列表。 */
function scopeItemsOf(payload: Record<string, unknown>, rawText: string | undefined): string[] {
  const entries = payload.entries;
  const listOf = (rows: unknown): string[] =>
    Array.isArray(rows)
      ? rows
          .map((row): string => {
            const scope = row as { kind?: unknown; value?: unknown };
            const kind = typeof scope.kind === "string" ? scope.kind : "";
            const value = typeof scope.value === "string" ? scope.value : "";
            const label = `${kind} ${value}`.trim();
            return label === "" ? "" : label;
          })
          .filter((label): label is string => label !== "")
      : [];
  const fromPayload = Array.isArray(entries) ? listOf(entries) : [];
  if (fromPayload.length > 0) return fromPayload;
  const single = `${typeof payload.kind === "string" ? payload.kind : ""} ${typeof payload.value === "string" ? payload.value : ""}`.trim();
  if (single !== "") return [single];
  if (rawText === undefined) return [];
  const out: string[] = [];
  const pattern = /"kind"\s*:\s*"([^"]*)"\s*,\s*"value"\s*:\s*"([^"]*)"/g;
  let match = pattern.exec(String(rawText));
  while (match !== null) {
    const label = `${match[1]} ${match[2]}`.trim();
    if (label !== "") out.push(label);
    match = pattern.exec(String(rawText));
  }
  return out;
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
      .map((part) =>
        part !== null && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
      )
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
  if (DIFF.has(tool))
    return { path: field("file_path"), before: field("old_string"), after: field("new_string") ?? field("content") };
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
 * Let entity activity text like "{5 entities have been updated}" pass through unchanged;
 * abstract-wrap activity text for unknown shapes (backend-evolving event objects such as asset snapshots and team board states) goes into json code blocks—readable, wall-of-text free, and no information lost.
 * @param text - activity's summary/body.
 * @returns displayable markdown; original text if unmodified.
 */
export function humanizeActivityText(text: string): string {
  const trimmed = text.trim();
  const startsObject = trimmed.startsWith("{") || trimmed.startsWith("[");
  // 后端把 worker 回写存进 summary 时只保留截断版：有的行连开头的 "{" 都被截掉，
  // 剩下 `"final_text":"…` 的残半。这种前缀直接剥壳取正文。
  const kernel = /^(?:\{)?"final_text"\s*:\s*"([\s\S]*)$/.exec(trimmed);
  if (kernel !== null) {
    let body = kernel[1] ?? "";
    // 值后若还跟着别的键（未截断的行），在键边界收尾。
    const tail = /",\s*"(?:intent_id|summary|is_error|returned_step_ids)/.exec(body);
    if (tail !== null) body = body.slice(0, tail.index);
    body = body
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t");
    const value = body.trim();
    return value === "" ? text : value;
  }
  if (!startsObject) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 截断的机载荷：不回退成整行墙——trace 类先读出意图号与步数。
    if (startsObject && trimmed.length > 160) {
      const intentMatch = /"intent_id"\s*:\s*"?([A-Za-z0-9-]+)/.exec(trimmed);
      const stepCount = (trimmed.match(/"step_id"\s*:/g) ?? []).length;
      if (intentMatch !== null && stepCount > 0) {
        return `意图 ${intentMatch[1]} 轨迹 · ${stepCount} 步（后端存储截断）`;
      }
      return `\`\`\`json\n${trimmed}\n…（后端存储截断，原文不完整）\n\`\`\``;
    }
    return text;
  }
  const known = readKnownEvent(parsed);
  if (known !== null) return known;
  return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
}

/** Set of known event shapes (returns null if not recognized): find the human sentence, no code block wall needed. */
function readKnownEvent(parsed: unknown, depth = 0): string | null {
  if (depth > 2 || parsed === null || typeof parsed !== "object") return null;
  if (Array.isArray(parsed)) {
    const parts: string[] = [];
    for (const item of parsed) {
      const read = readKnownEvent(item, depth + 1);
      if (read === null) return null;
      parts.push(read);
    }
    return parts.length === 0 ? null : parts.join("；");
  }
  const obj = parsed as Record<string, unknown>;
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  const chunk = (value: unknown): string => (typeof value === "string" ? value : "");
  // fact/goal injection events: payload already has a human sentence.
  if (typeof obj.kind === "string") {
    const readable = chunk(payload.summary) || chunk(payload.text) || chunk(payload.description);
    if (readable !== "") return obj.kind === "goal" ? `已登记目标：${readable}` : `已登记事实：${readable}`;
  }
  // worker writeback: final_text is the reply body.
  if (typeof obj.final_text === "string" && obj.final_text !== "") return obj.final_text;
  // step audit event with intent + steps: read out intent number and step count.
  if (typeof obj.intent_id !== "undefined" && Array.isArray(obj.steps)) {
    const down = Number(obj.intent_id);
    return `意图 ${Number.isNaN(down) ? String(obj.intent_id) : down} · ${obj.steps.length} 步`;
  }
  // returned_step_ids: tool activity attached to intent completion.
  if (obj.intent_id !== undefined && Array.isArray(obj.returned_step_ids)) {
    return `意图 ${String(obj.intent_id)} 收尾 · 挂 ${obj.returned_step_ids.length} 个工具活动`;
  }
  // asset snapshot: assets + count.
  if (obj.assets !== undefined && typeof obj.count === "number") return `资产快照：${obj.count} 项`;
  // team board snapshot: progress.total / tasks.
  const progress = obj.progress as Record<string, unknown> | undefined;
  if (progress !== undefined && typeof progress === "object" && typeof progress.total === "number") {
    return `任务板进度：${String(progress.completed ?? 0)}/${String(progress.total)} 完成 · 待办 ${Array.isArray(obj.tasks) ? obj.tasks.length : 0}`;
  }
  // company snapshot.
  const companies = obj.companies;
  if (Array.isArray(companies) && typeof obj.count === "number") return `企业：${obj.count} 家`;
  return null;
}

/**
 * Fold an activity stream into renderable blocks.
 *
 * `tool_result` attaches to the preceding `tool_use` with the same
 * `tool_use_id`; unmatched results still become a block so nothing is dropped.
 * An `exit_plan_mode` call folds into its `plan` block (the call itself is not
 * drawn); the `plan_review` row that follows attaches its pending id to it.
 * @param activities - backend activities in log order.
 * @returns blocks in log order.
 */
export function toBlocks(activities: readonly Activity[]): Block[] {
  const blocks: Block[] = [];
  const pending = new Map<string, number>();
  /** `exit_plan_mode` calls: tool_use id → index of the plan block (or -1 before it lands). */
  const planCalls = new Map<string, number>();
  /** Index of the latest plan block still waiting for its review row. */
  let openPlan: number | null = null;
  let headWorker: string | null = null;
  /** Open planner 目标拆解 fold（DX-S3）；null = 普通规划段。 */
  let decompose: DecomposeBlock | null = null;

  for (const activity of activities) {
    const tool = norm(activity.tool);

    // Planner round boundary: a 目标拆解 round opens the fold card (round-0 of
    // a new task, or the /goal-triggered「目标拆解（/goal）」); any other planner
    // round closes an open fold. Round rows never render themselves.
    if (activity.kind === "round" && activity.worker === "planner") {
      if (activity.summary.includes(DECOMPOSE_ROUND)) {
        decompose = { kind: "decompose", seq: activity.seq, summary: activity.summary, goals: [], extras: [], report: "" };
        blocks.push(decompose);
        // The fold owns the segment's speaker: the planner's own head row
        //（「已完成分析」）must not appear for these lines.
        headWorker = activity.worker;
      } else {
        decompose = null;
      }
      continue;
    }

    // While the fold is open, EVERY planner row folds into the card: goal /
    // constraint / scope calls become its lists, result the report, the ids
    // receipt is dropped. Other workers' rows keep their original blocks.
    if (decompose !== null && activity.worker === "planner") {
      if (activity.kind === "tool_use") {
        const effective = effectiveToolOf(activity);
        const raw = activity.detail ?? activity.detail_head;
        if (effective === "set_goals") decompose.goals.push(...textItemsOf(objectPayloadOf(activity), "goals", raw));
        else if (effective === "set_constraints") decompose.extras.push(...textItemsOf(objectPayloadOf(activity), "constraints", raw));
        else if (effective === "add_task_scope") decompose.extras.push(...scopeItemsOf(objectPayloadOf(activity), raw));
        else decompose.report = [decompose.report, `${effective} · ${activity.summary}`].filter((piece) => piece !== "").join("\n\n");
      } else if (activity.kind === "tool_result") {
        // `{"ids":[395]}` 登记回执：卡标题已给出数量，回执不再出现在对话流。
      } else if (activity.kind === "result" || activity.kind === "text") {
        const body = humanizeActivityText(activity.detail_head ?? activity.detail ?? activity.summary);
        // 每个验收项一条 text 的回声不进卡（正文已把目标列了一遍）。
        const echo = decompose.goals.some((goal) => goal.trim() === body.trim());
        if (!echo) decompose.report = [decompose.report, body].filter((piece) => piece !== "").join("\n\n");
      } else if (activity.kind === "thinking" || activity.kind === "intent") {
        const body = humanizeActivityText(activity.summary);
        const echo = decompose.goals.some((goal) => goal.trim() === body.trim());
        if (!echo) decompose.report = [decompose.report, body].filter((piece) => piece !== "").join("\n\n");
      }
      continue;
    }

    // Opening a new speaker's run: assistant output starts with a head row that
    // carries the worker and timestamp the cards themselves do not show.
    if (activity.worker !== headWorker && activity.kind !== "user") {
      headWorker = activity.worker;
      blocks.push({ kind: "head", seq: activity.seq - 0.5, worker: activity.worker, at: activity.ts });
    }

    if (activity.kind === "user") {
      const mark = automationMarkOf(activity);
      blocks.push({
        kind: "user",
        seq: activity.seq,
        text: activity.summary,
        source: mark?.source,
        automationTitle: mark?.automationTitle,
        ...identityOf(activity),
      });
      continue;
    }
    if (activity.kind === "thinking") {
      blocks.push({ kind: "thinking", seq: activity.seq, text: activity.summary });
      continue;
    }
    if (activity.kind === "text" || activity.kind === "result") {
      // 正文行：detail_head 是后端 detail 的 UTF-8 安全前缀（多数=完整正文），
      // 但后端部分 detail 本身是机载荷 JSON——所以统一过 humanize：
      // 人写的正文原样直通，JSON 才转成可读形式/代码块。
      const body = humanizeActivityText(activity.detail_head ?? activity.detail ?? activity.summary);
      blocks.push({
        kind: "text",
        seq: activity.seq,
        text: body,
        ...identityOf(activity),
      });
      continue;
    }
    if (activity.kind === "usage" || activity.kind === "round") continue;

    if (activity.kind === "plan") {
      const head = activity.detail ?? activity.detail_head ?? "";
      const markdown = head === "" ? `# ${activity.summary}` : head;
      const index = blocks.length;
      blocks.push({
        kind: "plan",
        seq: activity.seq,
        title: activity.summary.trim() !== "" ? activity.summary.trim() : "未命名计划",
        markdown,
        // The list row carries a 2000-character prefix (`db/exploration.go` DetailHead).
        truncated: activity.detail === undefined && [...head].length >= 2000,
        toolUseId: activity.tool_use_id,
      });
      if (activity.tool_use_id !== undefined) planCalls.set(activity.tool_use_id, index);
      openPlan = index;
      continue;
    }

    if (activity.kind === "plan_review") {
      const reviewId = reviewIdOf(activity);
      const payload = reviewPayloadOf(activity);
      const target = openPlan === null ? undefined : blocks[openPlan];
      const attached = target !== undefined && target.kind === "plan" && target.reviewId === undefined;
      if (attached && target.kind === "plan" && reviewId !== null) target.reviewId = reviewId;
      openPlan = null;
      blocks.push({
        kind: "plan_review",
        seq: activity.seq,
        reviewId,
        title: payload.title !== "" ? payload.title : (target?.kind === "plan" ? target.title : "计划"),
        markdown: payload.plan,
        attached,
      });
      continue;
    }

    if (activity.kind === "tool_use") {
      const index = blocks.length;
      // `detail` is usually empty; the engine packs `"<tool> {json}"` into summary.
      const split = splitSummary(activity.summary, tool);
      const effective = split.tool === "" ? tool : split.tool;
      // Plan submission: the plan row that follows is the card; the raw call
      // (the whole plan as JSON) is not drawn a second time.
      if (effective === EXIT_PLAN_MODE || tool === EXIT_PLAN_MODE) {
        if (activity.tool_use_id !== undefined) planCalls.set(activity.tool_use_id, -1);
        continue;
      }
      const payload = Object.keys(split.payload).length > 0 ? split.payload : toolPayload(tool, activity.detail);
      if (TERMINAL.has(effective)) {
        blocks.push({
          kind: "terminal",
          seq: activity.seq,
          tool: effective,
          command: payload.command ?? activity.summary,
          output: "",
          isError: false,
        });
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
        blocks.push({
          kind: "search",
          seq: activity.seq,
          tool: effective,
          query: payload.pattern ?? activity.summary,
          result: "",
        });
      } else if (READ.has(effective)) {
        blocks.push({
          kind: "read",
          seq: activity.seq,
          tool: effective,
          label: payload.path ?? pathOf(activity),
          result: "",
        });
      } else {
        // Unknown tool: keep the name and a readable payload instead of raw JSON.
        const detailText =
          typeof (split.payload as { text?: string }).text === "string"
            ? (split.payload as { text: string }).text
            : activity.summary;
        blocks.push({ kind: "other", seq: activity.seq, tool: effective, text: `${effective} · ${detailText}` });
      }
      if (activity.tool_use_id !== undefined) pending.set(activity.tool_use_id, index);
      continue;
    }

    if (activity.kind === "intent") {
      // Intent annotation: summary is the intention description; if raw JSON is measured, read it out.
      blocks.push({
        kind: "text",
        seq: activity.seq,
        text: humanizeActivityText(activity.summary),
        ...identityOf(activity),
      });
      continue;
    }

    if (activity.kind === "tool_result" && activity.tool_use_id !== undefined && planCalls.has(activity.tool_use_id)) {
      const planIndex = planCalls.get(activity.tool_use_id) ?? -1;
      const plan = planIndex >= 0 ? blocks[planIndex] : undefined;
      const body = unwrapText(activity.detail ?? activity.detail_head) ?? activity.summary;
      if (plan !== undefined && plan.kind === "plan") {
        const feedback = revisionFeedbackOf(body);
        if (feedback !== undefined) plan.feedback = feedback;
        else if (activity.is_error === true && !body.includes("继续规划")) plan.failure = body;
        continue;
      }
      // No plan row (the call failed validation before saving): show the reason.
      blocks.push({ kind: "other", seq: activity.seq, tool: EXIT_PLAN_MODE, text: humanizeActivityText(body) });
      continue;
    }

    if (activity.kind === "tool_result") {
      const index = activity.tool_use_id === undefined ? undefined : pending.get(activity.tool_use_id);
      const target = index === undefined ? undefined : blocks[index];
      // 工具正文：detail/detail_head 是完整输出的（前 2000 字），但工具输出
      // 本身多为 JSON——统一过 humanize（非 JSON 原样，JSON 可读化）。
      const body = humanizeActivityText(activity.detail ?? activity.detail_head ?? activity.summary);
      if (target === undefined) {
        blocks.push({ kind: "other", seq: activity.seq, tool, text: body });
        continue;
      }
      // The card's detail disclosure fetches the result row too, so the id has to
      // survive the fold into the tool_use block.
      if (
        target.kind === "terminal" ||
        target.kind === "diff" ||
        target.kind === "search" ||
        target.kind === "read" ||
        target.kind === "other"
      ) {
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

    blocks.push({ kind: "other", seq: activity.seq, tool, text: humanizeActivityText(activity.summary) });
  }

  return blocks;
}
