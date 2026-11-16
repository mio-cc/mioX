"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronDown,
  ChevronRight,
  CrosshairIcon,
  FileTextIcon,
  Flag,
  MessageSquare,
  PaperclipIcon,
  ShieldAlertIcon,
  Terminal,
  UserIcon,
  Wrench,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Markdown } from "@/components/markdown";
import { SecretText } from "@/components/secret-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ApprovalDetail } from "@/components/approval-records";
import type { Activity, InterceptPending } from "@/lib/types";

// ---- per-agent lane color (planner + work#1/#2/#3 …) ---------------------------
const workerColors = [
  "bg-sky-600",
  "bg-violet-600",
  "bg-teal-600",
  "bg-pink-600",
  "bg-orange-600",
];
function workerColor(name: string): string {
  if (name === "planner") return "bg-amber-600"; // the intent generator, distinct
  if (name === "mainagent") return "bg-primary";
  const m = /#(\d+)/.exec(name);
  const i = m ? (parseInt(m[1], 10) - 1) % workerColors.length : 0;
  return workerColors[Math.max(0, i)];
}

const chip = (worker: string) =>
  "mt-0.5 shrink-0 rounded px-1 text-[9px] font-medium text-white " + workerColor(worker);

// useInView latches true when the ref'd element first comes within `rootMargin` of
// the enclosing scroll viewport. Blocks that always show their full body (user
// bubbles, answers) use it to defer fetching that body until they're about to be
// seen — so opening a long thread doesn't fire a detail request for every off-
// screen step. Observes the ScrollArea viewport (falls back to eager load when
// IntersectionObserver is unavailable, e.g. SSR).
function useInView(rootMargin = "400px"): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    if (inView) return; // latch: once seen, stop observing
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const root = el.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { root, rootMargin },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

// A tool group pairs a tool_use with its matching tool_result (by tool_use_id);
// a run of consecutive conversational steps (text/thinking/result) from the same
// agent is one "message".
type Group =
  | { type: "user"; key: number; step: Activity; intent?: boolean }
  | { type: "answer"; key: number; step: Activity }
  | { type: "round"; key: number; label: string }
  | { type: "tool"; key: number; worker: string; use?: Activity; result?: Activity }
  | { type: "msg"; key: number; worker: string; steps: Activity[] }
  | { type: "intercept"; key: number; step: Activity }
  | { type: "plan"; key: number; step: Activity }
  | { type: "plan_review"; key: number; step: Activity };

function groupSteps(steps: Activity[], chat: boolean): Group[] {
  const out: Group[] = [];
  const byToolId = new Map<string, Extract<Group, { type: "tool" }>>();
  for (const s of steps) {
    if (s.kind === "usage") continue; // live token-usage marker — not a rendered step
    if (s.kind === "round") {
      out.push({ type: "round", key: s.seq, label: s.summary || "新一轮" }); // planner round boundary
      continue;
    }
    if (s.kind === "intercept_request") {
      out.push({ type: "intercept", key: s.seq, step: s });
      continue;
    }
    // 计划模式：一份提交的计划渲染成卡片（DSH ui-plan/PlanCard.tsx:43-60 的回合尾部
    // 计划卡片），审阅请求渲染成审批卡片（两个选项 + 反馈）。
    if (s.kind === "plan") {
      out.push({ type: "plan", key: s.seq, step: s });
      continue;
    }
    if (s.kind === "plan_review") {
      out.push({ type: "plan_review", key: s.seq, step: s });
      continue;
    }
    if (s.kind === "user" || s.kind === "intent") {
      // human turn OR the LLM-generated intent leading a worker session — both are
      // right-aligned bubbles; `intent` swaps the avatar to a non-human icon.
      out.push({ type: "user", key: s.seq, step: s, intent: s.kind === "intent" });
      continue;
    }
    // In a chat (main agent) the assistant's text/result IS the answer — render it
    // full (markdown), never collapsed. thinking still folds into a compact block.
    if (s.kind === "result" || (chat && s.kind === "text")) {
      out.push({ type: "answer", key: s.seq, step: s });
      continue;
    }
    if (s.kind === "tool_use") {
      const g: Extract<Group, { type: "tool" }> = { type: "tool", key: s.seq, worker: s.worker, use: s };
      if (s.tool_use_id) byToolId.set(s.tool_use_id, g);
      out.push(g);
      continue;
    }
    if (s.kind === "tool_result") {
      // bind to its tool_use by id (NOT adjacency — tools can run in parallel)
      const g = s.tool_use_id ? byToolId.get(s.tool_use_id) : undefined;
      if (g && !g.result) g.result = s;
      else out.push({ type: "tool", key: s.seq, worker: s.worker, result: s }); // orphan result
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.type === "msg" && last.worker === s.worker) last.steps.push(s);
    else out.push({ type: "msg", key: s.seq, worker: s.worker, steps: [s] });
  }
  return out;
}

const kindLabel = (k: string) => (k === "thinking" ? "推理" : k === "result" ? "总结" : "说明");

function ActivityTime({ ts }: { ts: string }) {
  const date = new Date(ts);
  if (!ts || Number.isNaN(date.getTime())) return null;
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString("zh-CN")}
      className="text-[10px] text-muted-foreground tabular-nums"
      suppressHydrationWarning
    >
      {date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}
    </time>
  );
}

// toolInputText renders a tool_use input for display. For Bash it pulls the shell
// command out of the raw input JSON ({"command":…,"description":…}) so the UI shows
// the command itself instead of JSON; other tools fall back to the raw text.
function toolInputText(tool: string, raw: string): string {
  if (tool !== "Bash") return raw;
  // full input (expanded detail): parse and pull the command out.
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.command === "string") return o.command;
  } catch {
    // collapsed-row summaries are truncated to ~200 chars by the backend, so the
    // JSON tail is cut off and JSON.parse fails — fall through and extract the
    // "command" field by hand, tolerating the missing closing quote.
  }
  const m = raw.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (m) {
    try {
      // re-wrap the captured body and parse to unescape \n, \", \\, etc.
      return JSON.parse('"' + m[1] + '"');
    } catch {
      // truncated mid-escape — unescape the common sequences best-effort.
      return m[1].replace(/\\(["\\/nrt])/g, (_s, c) =>
        c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
      );
    }
  }
  return raw;
}

// InterceptCard renders an inline intercept_request approval card. The pending_id
// is extracted from the summary (format: "工具 X 请求审批 (#N)") so buttons are
// available immediately without waiting for the detail load.
function InterceptCard({
  step,
  getDetail,
}: {
  step: Activity;
  getDetail: (seq: number) => Promise<string>;
}) {
  // extract pending_id from summary: "工具 Bash 请求审批 (#42)"
  const pendingId = React.useMemo(() => {
    const m = /\(#(\d+)\)/.exec(step.summary);
    return m ? parseInt(m[1], 10) : null;
  }, [step.summary]);

  const toolName = React.useMemo(() => {
    const m = /工具\s+(\S+)\s+请求/.exec(step.summary);
    return m ? m[1] : step.summary;
  }, [step.summary]);

  const [detail, setDetail] = React.useState<Record<string, unknown> | null>(null);
  const [decided, setDecided] = React.useState<"allowed" | "denied" | "timeout" | null>(null);
  const [deciding, setDeciding] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [pending, setPending] = React.useState<InterceptPending | null>(null);
  const [statusError, setStatusError] = React.useState("");
  const [retry, setRetry] = React.useState(0);

  // Load persisted detail JSON + check the real current status from the backend
  // so that a page refresh shows the already-decided state instead of re-offering buttons.
  React.useEffect(() => {
    let live = true;
    getDetail(step.seq)
      .then((raw) => {
        if (!live || !raw) return;
        try { setDetail(JSON.parse(raw)); } catch { /* ignore */ }
      })
      .catch(() => {/* ignore */});
    return () => { live = false; };
  }, [step.seq, getDetail]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the same approval after a failed request.
  React.useEffect(() => {
    if (!pendingId) return;
    let live = true;
    api.interceptGetOne(pendingId)
      .then((p) => {
        if (!live) return;
        setPending(p);
        setStatusError("");
        if (p.status !== "pending") setDecided(p.status as "allowed" | "denied" | "timeout");
      })
      .catch((error) => { if (live) setStatusError((error as Error).message || "审批详情加载失败"); });
    return () => { live = false; };
  }, [pendingId, retry]);

  async function decide(decision: "allowed" | "denied") {
    if (step.inherited || !pendingId || deciding) return;
    setDeciding(true);
    try {
      await api.interceptDecide(pendingId, decision);
      setDecided(decision);
      toast.success(decision === "allowed" ? "已允许执行" : "已拒绝执行");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  const inputStr = detail?.input
    ? JSON.stringify(detail.input).slice(0, 200)
    : null;

  const row = pending ? { ...pending, status: decided || pending.status, conv_title: "", conv_agent_key: "", rule_name: "" } : null;

  return (
    <div className="my-2 rounded-lg border border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/15 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="text-amber-700 dark:text-amber-400">审批请求</span>
              <code className="rounded bg-amber-100 dark:bg-amber-900/50 px-1 font-mono text-amber-800 dark:text-amber-300">
                {toolName}
              </code>
              {pendingId && (
                <span className="text-muted-foreground">#{pendingId}</span>
              )}
            </div>
            {inputStr && (
              <p className="font-mono text-muted-foreground truncate">{inputStr}</p>
            )}
          </div>
        </div>

        {step.inherited ? (
          <Badge variant="outline">历史记录 · 只读</Badge>
        ) : decided ? (
          <span className={
            "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium " +
            (decided === "allowed"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
              : decided === "timeout"
                ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400")
          }>
            {decided === "allowed" ? "已允许" : decided === "timeout" ? "已超时" : "已拒绝"}
          </span>
        ) : (
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={deciding || !pendingId}
              onClick={() => decide("allowed")}
            >
              <CheckIcon className="h-3 w-3" />
              允许
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-xs"
              disabled={deciding || !pendingId}
              onClick={() => decide("denied")}
            >
              <XIcon className="h-3 w-3" />
              拒绝
            </Button>
          </div>
        )}
      </div>
      {pendingId ? (
        <Collapsible open={expanded} onOpenChange={setExpanded} className="mt-2 min-w-0">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={expanded ? "收起审批详情" : "展开审批详情"}>
              {expanded ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
              {expanded ? "收起审批详情" : "展开审批详情"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {expanded && row ? (
              <ApprovalDetail
                row={row}
                busy={deciding}
                decide={(_id, decision) => decide(decision)}
                revision={retry}
                readOnly={Boolean(step.inherited)}
                defaultExpanded
                onResolved={setDecided}
              />
            ) : statusError ? (
              <div className="flex flex-wrap items-center gap-2 p-3" role="alert">
                <span>{statusError}</span>
                <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>重试详情</Button>
              </div>
            ) : <p className="p-3 text-muted-foreground">正在加载审批详情…</p>}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

// PlanCard renders one submitted plan as a card, mirroring DSH
// ui-plan/PlanCard.tsx:43-60: a file icon, the plan title, the "计划文档" subtitle and
// `data-plan-card={callId}` so the card is addressable; clicking expands/collapses the
// markdown body (DSH opens the same document in the sidebar preview instead).
export function PlanCard({
  step,
  getDetail,
}: {
  step: Activity;
  getDetail: (seq: number) => Promise<string>;
}) {
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState<string | null>(null);
  const callId = step.tool_use_id || `seq${step.seq}`;
  const title = step.summary || "计划";
  const toggle = React.useCallback(() => {
    setOpen((was) => {
      if (!was) {
        getDetail(step.seq)
          .then((raw) => { if (raw) setBody(raw); })
          .catch(() => { /* 详情拉取失败就用 summary 兜底 */ });
      }
      return !was;
    });
  }, [step.seq, getDetail]);
  return (
    <div className="my-2">
      <button
        type="button"
        data-plan-card={callId}
        aria-label={`打开计划：${title}`}
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-50/40 px-3 py-2 text-left hover:bg-sky-50 dark:bg-sky-950/20 dark:hover:bg-sky-950/35"
      >
        <FileTextIcon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{title}</span>
          <span className="block text-[10px] text-muted-foreground">计划文档</span>
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{open ? "收起" : "展开"}</span>
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      </button>
      {open && (
        <div className="mt-1 rounded-lg border bg-background p-3 text-xs">
          <Markdown text={body ?? step.detail ?? step.summary} />
        </div>
      )}
    </div>
  );
}

// PlanReviewCard renders the pending plan review: the plan itself plus the two options
// DSH offers (plan-mode/src/index.ts:316-333: Approve this plan and leave plan mode? /
// stay in plan mode, feedback goes back to the model) and a dismiss (index.ts:339-341,
// the turn ends there). The plan body and the pending id both come from the activity
// detail the backend wrote, so the card needs no extra fetch to show the plan.
// parsePlanReviewDetail reads the review payload the backend wrote into the activity
// detail ({pending_id,title,plan}). The activity LIST endpoint omits detail, so the
// card also falls back to the pending id embedded in the summary
// ("计划审阅：<标题> (#12)") — buttons stay usable before the detail arrives.
function parsePlanReviewDetail(raw: string | undefined, summary: string) {
  let pendingId: number | null = null;
  let title = summary;
  let plan = "";
  try {
    const o = JSON.parse(raw ?? "{}") as { pending_id?: number; title?: string; plan?: string };
    if (typeof o.pending_id === "number") pendingId = o.pending_id;
    if (o.title) title = o.title;
    if (o.plan) plan = o.plan;
  } catch { /* detail 缺失/被裁掉：用 summary 兜底 */ }
  if (pendingId === null) {
    const m = /\(#(\d+)\)/.exec(summary);
    if (m) pendingId = parseInt(m[1], 10);
  }
  return { pendingId, title, plan };
}

export function PlanReviewCard({
  step,
  getDetail,
}: {
  step: Activity;
  getDetail: (seq: number) => Promise<string>;
}) {
  const initial = React.useMemo(
    () => parsePlanReviewDetail(step.detail, step.summary),
    [step.detail, step.summary],
  );
  const [pendingId, setPendingId] = React.useState<number | null>(initial.pendingId);
  const [title, setTitle] = React.useState(initial.title);
  const [plan, setPlan] = React.useState(initial.plan);
  const [status, setStatus] = React.useState<"pending" | "allowed" | "denied" | "timeout">("pending");
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [open, setOpen] = React.useState(true);

  // 列表接口不带 detail：挂载后拉一次 activity detail 补出计划正文（getDetail 走 ref，
  // 调用方每次渲染都会新建闭包，直接进依赖数组会反复重拉）。
  const getDetailRef = React.useRef(getDetail);
  getDetailRef.current = getDetail;
  const detailLoadedRef = React.useRef(initial.plan !== "" && initial.pendingId !== null);
  React.useEffect(() => {
    if (detailLoadedRef.current) return;
    getDetailRef
      .current(step.seq)
      .then((raw) => {
        const o = parsePlanReviewDetail(raw, step.summary);
        if (o.pendingId !== null) setPendingId(o.pendingId);
        if (o.title) setTitle(o.title);
        if (o.plan) setPlan(o.plan);
        detailLoadedRef.current = true;
      })
      .catch(() => { /* 详情拉取失败：卡片仍可用（正文退回 summary） */ });
  }, [step.seq, step.summary]);

  React.useEffect(() => {
    if (pendingId === null) return;
    let live = true;
    api.interceptGetOne(pendingId)
      .then((p) => { if (live && p.status !== "pending") setStatus(p.status as typeof status); })
      .catch(() => { /* ignore */ });
    return () => { live = false; };
  }, [pendingId]);

  const decide = React.useCallback(
    async (decision: "approve" | "keep_planning" | "dismiss", note = "") => {
      if (pendingId === null || busy) return;
      setBusy(true);
      try {
        await api.interceptPlanReview(pendingId, decision, note);
        setStatus(decision === "approve" ? "allowed" : "denied");
        toast.success(
          decision === "approve" ? "已批准：退出计划模式，开始执行"
            : decision === "keep_planning" ? "已把反馈发回模型，继续规划"
              : "已关闭审阅，本轮结束",
        );
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [pendingId, busy],
  );

  const decidedLabel = status === "allowed" ? "已批准" : status === "timeout" ? "已超时" : "已继续规划/关闭";

  return (
    <div className="my-2 rounded-lg border border-sky-400/50 bg-sky-50/30 p-3 text-xs dark:bg-sky-950/15">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FileTextIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="text-sky-700 dark:text-sky-400">计划审阅</span>
              <span className="truncate text-muted-foreground">{title}</span>
              {pendingId !== null && <span className="text-muted-foreground">#{pendingId}</span>}
            </div>
            <p className="text-muted-foreground">批准后退出计划模式并从下一步开始执行；也可以要求继续规划。</p>
          </div>
        </div>
        {status !== "pending" ? (
          <span className={
            "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium " +
            (status === "allowed"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400")
          }>
            {decidedLabel}
          </span>
        ) : (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button size="sm" className="h-6 px-2 text-xs" disabled={busy || pendingId === null}
              onClick={() => void decide("approve")}>
              <CheckIcon className="h-3 w-3" />
              批准并退出计划模式
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy || pendingId === null}
              onClick={() => setShowFeedback((v) => !v)}>
              <MessageSquare className="h-3 w-3" />
              继续规划
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy || pendingId === null}
              onClick={() => void decide("dismiss")}>
              <XIcon className="h-3 w-3" />
              关闭审阅
            </Button>
          </div>
        )}
      </div>
      {showFeedback && status === "pending" && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="告诉模型要改什么（反馈会作为错误回到模型，它改完会重新提交计划）"
            className="w-full rounded border bg-background px-2 py-1 text-xs"
          />
          <Button size="sm" className="h-6 px-2 text-xs" disabled={busy || pendingId === null}
            onClick={() => void decide("keep_planning", feedback)}>
            发送反馈，继续规划
          </Button>
        </div>
      )}
      <Collapsible open={open} onOpenChange={setOpen} className="mt-2 min-w-0">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={open ? "收起计划" : "展开计划"}>
            {open ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
            {open ? "收起计划全文" : "展开计划全文"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded border bg-background p-3">
            <Markdown text={plan || step.summary} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ToolBlock renders ONE tool call: the command and its result bound into a single
// row (collapsed shows the command + a status/result preview; expand shows the
// full input AND output together). Lazy-loads both details on expand.
function ToolBlock({
  group,
  getDetail,
  showWorker,
  focused = false,
}: {
  group: Extract<Group, { type: "tool" }>;
  getDetail: (seq: number) => Promise<string>;
  showWorker?: boolean;
  focused?: boolean;
}) {
  const [open, setOpen] = React.useState(focused);
  const targetRef = React.useRef<HTMLElement>(null);
  const [detail, setDetail] = React.useState<string | null>(null);
  // what we last loaded, keyed by the underlying step seqs. When the tool result
  // arrives after we expanded mid-run (command only), this key changes and the
  // effect below re-fetches — so the output shows up instead of being cached out.
  const loadedKey = React.useRef<string | null>(null);
  const { use, result } = group;
  const toolName = use?.tool || result?.tool || "工具";
  const ToolIcon = toolName === "Bash" ? Terminal : Wrench;
  const running = !result;
  const ok = !!result && !result.is_error;
  const statusTone = running
    ? "text-muted-foreground"
    : ok
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const rawCmd =
    use && use.summary.startsWith(toolName) ? use.summary.slice(toolName.length).trimStart() : (use?.summary ?? "");
  const cmd = toolInputText(toolName, rawCmd);
  // status only — the full result lives behind the expand (【输出】), not previewed inline
  const statusText = running ? "执行中…" : ok ? "✓" : "✕ 失败";

  // key over the seqs we'd load; changes when the result (or command) arrives.
  const detailKey = `${use?.seq ?? ""}:${result?.seq ?? ""}`;
  React.useEffect(() => {
    if (!open || loadedKey.current === detailKey) return;
    let live = true;
    const segs: { label: string; seq: number }[] = [];
    if (use) segs.push({ label: "命令", seq: use.seq });
    if (result) segs.push({ label: "输出" + (result.is_error ? " ✕" : " ✓"), seq: result.seq });
    void Promise.all(
      segs.map((x) =>
        getDetail(x.seq)
          .then((d) => d || "（空）")
          .catch(() => "（加载失败）"),
      ),
    ).then((parts) => {
      if (!live) return;
      setDetail(
        segs
          .map((x, i) => `【${x.label}】\n${x.label === "命令" ? toolInputText(toolName, parts[i]) : parts[i]}`)
          .join("\n\n"),
      );
      loadedKey.current = detailKey;
    });
    return () => {
      live = false;
    };
  }, [open, detailKey, use, result, getDetail, toolName]);

  const scrolledRef = React.useRef(false);
  React.useEffect(() => {
    scrolledRef.current = false;
    if (focused) setOpen(true);
  }, [focused]);
  React.useEffect(() => {
    if (!focused || !open || detail === null || scrolledRef.current) return;
    const el = targetRef.current;
    const viewport = el?.closest('[data-slot="scroll-area-viewport"]');
    if (!el || !viewport) return;
    scrolledRef.current = true;
    const center = () => {
      const rect = el.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      viewport.scrollTop += rect.top + rect.height / 2 - bounds.top - bounds.height / 2;
    };
    // User bubbles load their full text lazily. Allow their initial layout to
    // settle, but stop anchoring immediately if the user interacts or after 2s.
    const observer = new ResizeObserver(center);
    observer.observe(el.parentElement ?? el);
    observer.observe(viewport);
    const stop = () => observer.disconnect();
    viewport.addEventListener("wheel", stop, { passive: true, once: true });
    viewport.addEventListener("touchstart", stop, { passive: true, once: true });
    viewport.addEventListener("pointerdown", stop, { once: true });
    const frame = requestAnimationFrame(center);
    const timer = setTimeout(stop, 2000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stop();
      viewport.removeEventListener("wheel", stop);
      viewport.removeEventListener("touchstart", stop);
      viewport.removeEventListener("pointerdown", stop);
    };
  }, [focused, open, detail]);

  function toggle() {
    setOpen((o) => !o);
  }

  return (
    <section
      ref={targetRef}
      aria-label={focused ? `定位的工具调用 #${use?.seq}` : undefined}
      className={focused ? "rounded-lg border-2 border-primary bg-primary/5 p-3 text-xs" : "text-xs"}
    >
      <button type="button" onClick={toggle} className="flex w-full items-start gap-2 py-1 text-left hover:bg-muted/40">
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
        <ToolIcon className={"mt-0.5 size-3.5 shrink-0 " + (running ? "text-sky-600 dark:text-sky-400" : statusTone)} />
        {showWorker && <span className={chip(group.worker)}>{group.worker}</span>}
        <span className="shrink-0 font-medium text-sky-600 dark:text-sky-400">{toolName}</span>
        {cmd && <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{cmd}</span>}
        <span className={"ml-auto shrink-0 font-medium " + statusTone}>{statusText}</span>
      </button>
      {open && (
        <pre className="ml-7 mb-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
          {/* 工具输出里的凭据也要遮（DSH 的掩码只影响画出来的字）。 */}
          <SecretText text={detail ?? "加载中…"} />
        </pre>
      )}
    </section>
  );
}

// MessageBlock renders a coalesced agent message (merged streaming text/thinking/
// result fragments into one block) so the conversation reads as messages, not rows.
function MessageBlock({
  group,
  getDetail,
  showWorker,
}: {
  group: Extract<Group, { type: "msg" }>;
  getDetail: (seq: number) => Promise<string>;
  showWorker?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<string | null>(null);
  // like ToolBlock: keyed by the group's step seqs so streamed steps arriving
  // after an early expand re-fetch instead of being cached out.
  const loadedKey = React.useRef<string | null>(null);
  const speak = group.steps.filter((s) => s.kind !== "thinking");
  const hasThinking = group.steps.some((s) => s.kind === "thinking");
  const isError = group.steps.some((s) => s.is_error);
  const body = (speak.length ? speak : group.steps).map((s) => s.summary).join("  ") || "…";
  const Icon = isError ? Flag : MessageSquare;
  const tone = isError ? "text-red-600 dark:text-red-400" : "text-foreground";

  const detailKey = group.steps.map((s) => s.seq).join(",");
  React.useEffect(() => {
    if (!open || loadedKey.current === detailKey) return;
    let live = true;
    void Promise.all(
      group.steps.map((s) =>
        getDetail(s.seq)
          .then((d) => d || s.summary)
          .catch(() => s.summary),
      ),
    ).then((parts) => {
      if (!live) return;
      setDetail(group.steps.map((s, i) => `【${kindLabel(s.kind)}】\n${parts[i]}`).join("\n\n"));
      loadedKey.current = detailKey;
    });
    return () => {
      live = false;
    };
  }, [open, detailKey, group.steps, getDetail]);

  function toggle() {
    setOpen((o) => !o);
  }

  return (
    <div className="text-xs">
      <button type="button" onClick={toggle} className="flex w-full items-start gap-2 py-1 text-left hover:bg-muted/40">
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
        <Icon className={"mt-0.5 size-3.5 shrink-0 " + tone} />
        {showWorker && <span className={chip(group.worker)}>{group.worker}</span>}
        <span className={"min-w-0 flex-1 truncate " + tone}>
          {body}
          {hasThinking && <span className="ml-1 text-[10px] text-muted-foreground">· 含推理</span>}
        </span>
      </button>
      {open && (
        <pre className="ml-7 mb-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
          <SecretText text={detail ?? "加载中…"} />
        </pre>
      )}
    </div>
  );
}

// UserRow renders a right-aligned chat bubble: either a human turn (the message you
// sent the main agent) or, in a worker session, the LLM-generated intent that leads
// it (intent=true) — same bubble, but a target icon instead of the human avatar.
// summary is a truncated first line, so the full message is pulled from the detail
// and shown in full (bubble is whitespace-pre-wrap, so long/multi-line text wraps).
// fmtBytes renders a human file size for attachment chips.
function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

type MsgAttachment = { name: string; path: string; size: number };

// parseUserBody splits a user turn's body into text + attachments. The backend stores
// Detail as JSON {text, attachments} when files were uploaded, else plain text — so we
// parse defensively and fall back to treating the whole body as text.
function parseUserBody(body: string): { text: string; attachments: MsgAttachment[] } {
  if (body.startsWith("{")) {
    try {
      const p = JSON.parse(body);
      if (p && Array.isArray(p.attachments)) {
        return { text: typeof p.text === "string" ? p.text : "", attachments: p.attachments };
      }
    } catch {
      /* plain text that merely starts with "{" */
    }
  }
  return { text: body, attachments: [] };
}

function UserRow({ step, intent, getDetail }: { step: Activity; intent?: boolean; getDetail: (seq: number) => Promise<string> }) {
  const Icon = intent ? CrosshairIcon : UserIcon;
  const [ref, inView] = useInView();
  // Optimistic echoes carry their detail inline; persisted rows lazy-load it on scroll.
  const inline = step.detail && step.detail.length > 0 ? step.detail : null;
  const [full, setFull] = React.useState<string | null>(inline);
  React.useEffect(() => {
    if (inline) return; // already have the body (optimistic echo)
    if (!inView) return; // fetch the full message only when the bubble nears view
    let live = true;
    getDetail(step.seq)
      .then((d) => {
        if (live) setFull(d || step.summary);
      })
      .catch(() => {
        if (live) setFull(step.summary);
      });
    return () => {
      live = false;
    };
  }, [inView, step.seq, getDetail, step.summary, inline]);
  const { text, attachments } = parseUserBody(full ?? step.summary);
  return (
    <div ref={ref} className="mt-3 mb-2 flex min-w-0 justify-end gap-2">
      <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5">
        {attachments.length > 0 && (
          <div className="flex min-w-0 max-w-full flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <div
                key={a.path}
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs shadow-sm"
                title={a.path}
              >
                <PaperclipIcon className="size-3 shrink-0 text-primary" />
                <span className="max-w-[180px] truncate font-medium">{a.name}</span>
                <span className="shrink-0 text-muted-foreground">{fmtBytes(a.size)}</span>
              </div>
            ))}
          </div>
        )}
        {text && (
          <div className="min-w-0 max-w-full whitespace-pre-wrap rounded-lg rounded-tr-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground [overflow-wrap:anywhere]">
            {/* 用户文本里的凭据只遮画出来的字（DSH ui-secret-mask/client/index.ts:2-4）。 */}
            <SecretText text={text} />
          </div>
        )}
        <ActivityTime ts={step.ts} />
      </div>
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon className="size-3.5 text-primary" />
      </div>
    </div>
  );
}

// AnswerBlock renders the agent's FINAL answer (kind="result") in full — never
// collapsed. The summary is a truncated first line, so the full text is pulled
// from the detail and shown inline.
function AnswerBlock({ step, getDetail }: { step: Activity; getDetail: (seq: number) => Promise<string> }) {
  const [ref, inView] = useInView();
  const [full, setFull] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!inView) return; // fetch the full answer only when it nears view
    let live = true;
    getDetail(step.seq)
      .then((d) => {
        if (live) setFull(d || step.summary);
      })
      .catch(() => {
        if (live) setFull(step.summary);
      });
    return () => {
      live = false;
    };
  }, [inView, step.seq, getDetail, step.summary]);
  return (
    <div ref={ref} className="mb-2 mt-1 flex min-w-0 flex-col gap-1">
      <div
        className={
          "min-w-0 flex-1 break-words rounded-lg bg-muted px-3 py-2 " +
          (step.is_error ? "text-sm text-red-600 dark:text-red-400" : "")
        }
      >
        {step.is_error ? (
          <span className="whitespace-pre-wrap">{full ?? step.summary}</span>
        ) : (
          <Markdown text={full ?? step.summary} />
        )}
      </div>
      <ActivityTime ts={step.ts} />
    </div>
  );
}

// ExecView renders an agent execution replay (planner / worker / main agent) in
// the compact, grouped, expand-to-detail format — thinking, tool calls/results,
// and (for the main agent) the human turns. Worker lane chips show only when the
// view actually mixes agents.
function ExecView({
  activity,
  taskId,
  chat,
  fetchDetail,
  focusedSeq,
}: {
  activity: Activity[];
  taskId?: string;
  chat?: boolean;
  fetchDetail?: (seq: number) => Promise<string>;
  focusedSeq?: number;
}) {
  const showWorker = new Set(activity.map((a) => a.worker)).size > 1;
  // default detail fetcher: the task-scoped activity endpoint. The chat page passes
  // its own (conversation-scoped) fetcher instead.
  const getDetail = React.useCallback(
    (seq: number) => (fetchDetail ? fetchDetail(seq) : api.activityDetail(seq, taskId).then((r) => r.detail ?? "")),
    [fetchDetail, taskId],
  );
  return (
    <div className="flex flex-col">
      {groupSteps(activity, !!chat).map((g) =>
        g.type === "round" ? (
          <div key={"r" + g.key} className="my-2 flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {g.label}
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : g.type === "user" ? (
          <UserRow key={"u" + g.key} step={g.step} intent={g.intent} getDetail={getDetail} />
        ) : g.type === "answer" ? (
          <AnswerBlock key={"a" + g.key} step={g.step} getDetail={getDetail} />
        ) : g.type === "tool" ? (
          <ToolBlock
            key={"t" + g.key}
            group={g}
            getDetail={getDetail}
            showWorker={showWorker}
            focused={focusedSeq != null && g.use?.seq === focusedSeq}
          />
        ) : g.type === "intercept" ? (
          <InterceptCard key={"ic" + g.key} step={g.step} getDetail={getDetail} />
        ) : g.type === "plan" ? (
          <PlanCard key={"pl" + g.key} step={g.step} getDetail={getDetail} />
        ) : g.type === "plan_review" ? (
          <PlanReviewCard key={"pr" + g.key} step={g.step} getDetail={getDetail} />
        ) : (
          <MessageBlock key={"m" + g.key} group={g} getDetail={getDetail} showWorker={showWorker} />
        ),
      )}
    </div>
  );
}

// Transcript renders a session's activity as a compact grouped execution replay:
// human turns, thinking, tool calls (command+result paired), and messages — for
// the main agent (interactive) and worker/planner (read-only) alike.
export function Transcript({
  activity,
  live,
  taskId,
  chat,
  fetchDetail,
  focusedSeq,
}: {
  activity: Activity[];
  live?: boolean;
  taskId?: string;
  chat?: boolean;
  fetchDetail?: (seq: number) => Promise<string>;
  focusedSeq?: number;
}) {
  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const [focusPadding, setFocusPadding] = React.useState(0);
  React.useLayoutEffect(() => {
    if (focusedSeq == null) { setFocusPadding(0); return; }
    const viewport = transcriptRef.current?.closest('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const measure = () => setFocusPadding(viewport.clientHeight / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [focusedSeq]);
  return (
    <div ref={transcriptRef} className="flex flex-col gap-1" style={focusPadding ? { paddingBlock: focusPadding } : undefined}>
      <ExecView activity={activity} taskId={taskId} chat={chat} fetchDetail={fetchDetail} focusedSeq={focusedSeq} />
      {live && (
        <div className="flex items-center gap-2 pl-2 pt-1 text-xs text-muted-foreground">
          <span className="flex gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-blue-500" />
          </span>
          实时流式中…
        </div>
      )}
    </div>
  );
}
