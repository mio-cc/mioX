"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import {
  ArrowDown,
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  PanelRight,
  Paperclip,
  Pause,
  Send,
  Square,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAppLayout } from "@/components/layout/app-frame";
import { ApprovalRecords } from "@/components/approval-records";
import { Markdown } from "@/components/markdown";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, sseUrl } from "@/lib/api";
import { ScrollFollow, scrollMetrics } from "@/lib/scroll-follow";
import { MOCK } from "@/lib/mock/enabled";
import type { Activity, ChatAttachment, LLMProfile, Task, TaskNode } from "@/lib/types";
import { TeamTab } from "./_tabs/team-tab";

import { FindingsTab } from "./_tabs/findings-tab";
import { GraphTab } from "./_tabs/graph-tab";
import { ReportTab } from "./_tabs/report-tab";
import {
  ModelSelect,
  buildModelGroups,
  type GlobalLLM,
  type ModelOption,
} from "./_composer/model-picker";
import { CommandMenu, type CommandItem } from "./_composer/slash-menu";
import styles from "./task-workspace-dsh.module.css";

type TabKey = "chat" | "trajectory" | "team" | "graph" | "findings" | "report";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "chat", label: "对话" },
  { key: "trajectory", label: "轨迹" },
  { key: "team", label: "团队" },
  { key: "graph", label: "探索图" },
  { key: "findings", label: "发现" },
  { key: "report", label: "报告" },
];

function fmtTokens(value?: number): string {
  if (!value || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function statusMeta(task: Task | null): { label: string; className: string } {
  if (!task) return { label: "加载中", className: styles.statusPaused };
  if (task.paused) return { label: "已暂停", className: styles.statusPaused };
  if (task.status === "done") return { label: "已完成", className: styles.statusDone };
  if (task.status === "failed" || task.status === "timeout") return { label: "异常", className: styles.statusPaused };
  if (task.status === "running") return { label: "运行中", className: "" };
  return { label: task.status || "空闲", className: styles.statusPaused };
}

/**
 * One selectable conversation lane. `key` is the backend session key
 * (`main:<seg>` | `plan` | `intent:<id>`), which is exactly what
 * `activityHistory` expects.
 */
type SessionOption = {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly group: "mainagent" | "planner" | "worker";
  readonly meta?: string;
  readonly live?: boolean;
};

const GROUP_LABEL: Record<SessionOption["group"], string> = {
  mainagent: "主 Agent",
  planner: "规划 Planner",
  worker: "Workers",
};

function mainSessionLabel(seq: number): string {
  return seq > 0 ? `主 Agent · #${seq + 1}` : "主 Agent";
}

function sessionTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// intentTitle mirrors SessionsTab's title derivation so the dropdown and the
// legacy inspector agree on what a worker lane is called.
function intentTitle(payload: string | undefined, id: string): string {
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

/**
 * sessionKeyOf routes one activity to its lane key. Mirrors SessionsTab so the
 * dropdown and the legacy inspector select the same stream.
 *
 * The main-agent key is ALWAYS `main:<seg>` (seg defaulting to 0) — never the
 * bare `main` the history API also accepts — so that keys built from
 * `mainSessions` and keys derived from a frame compare equal.
 */
/** Segment index encoded in a `main:<n>` session key (0 for any other lane). */
function mainSegOf(sessionKey: string): number {
  const match = /^main:(\d+)$/.exec(sessionKey);
  return match ? Number(match[1]) : 0;
}

function sessionKeyOf(activity: Activity): string {
  if (activity.worker === "system" || activity.kind === "llm_switch" || activity.kind === "llm_failover") {
    return "system";
  }
  if (activity.worker === "mainagent") return `main:${activity.main_seg ?? 0}`;
  if (activity.worker === "planner") return "plan";
  if (activity.intent_id) return `intent:${activity.intent_id}`;
  return activity.worker;
}

/** Canonical main-agent lane key for a segment number. */
function mainLaneKey(seq: number): string {
  return `main:${seq}`;
}

/** Compact DSH-style session switcher: a button plus a grouped keyboard listbox. */
function SessionDropdown({
  options,
  currentKey,
  onChange,
  onAside,
}: {
  readonly options: SessionOption[];
  readonly currentKey: string;
  readonly onChange: (option: SessionOption) => void;
  /** Open this lane beside the main view instead of replacing it. */
  readonly onAside?: (option: SessionOption) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.key === currentKey),
  );
  const selected = options[selectedIndex] ?? options[0];

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => listRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option);
    setOpen(false);
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex((index) => {
        if (event.key === "Home") return 0;
        if (event.key === "End") return options.length - 1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (index + delta + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(activeIndex);
    }
  };

  // Group rows while keeping one flat index space for the keyboard cursor.
  const renderRows = () => {
    const rows: React.ReactNode[] = [];
    let lastGroup: SessionOption["group"] | null = null;
    options.forEach((option, index) => {
      if (option.group !== lastGroup) {
        lastGroup = option.group;
        rows.push(
          <div className={styles.sessionGroup} key={`group-${option.group}`} role="presentation">
            {GROUP_LABEL[option.group]}
          </div>,
        );
      }
      const isSelected = option.key === currentKey;
      rows.push(
        <button
          key={option.id}
          id={`task-session-option-${option.id}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={isSelected}
          data-active={index === activeIndex ? "true" : "false"}
          data-group={option.group}
          data-session-key={option.key}
          className={styles.sessionOption}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => selectOption(index)}
        >
          {/* Always render a state dot (reference: StateDot): a uniform gutter makes
              running vs idle scannable, instead of a dot that only appears sometimes. */}
          <span className={styles.sessionLiveDot} data-state={option.live ? "running" : "idle"} aria-hidden="true" />
          <span className={styles.sessionOptionMain}>{option.label}</span>
          {option.meta ? <span className={styles.sessionOptionMeta}>{option.meta}</span> : null}
          {onAside ? (
            <span
              role="button"
              tabIndex={-1}
              className={styles.sessionAside}
              title="在主对话旁边打开这个子会话"
              aria-label={`旁开 ${option.label}`}
              data-action="session-aside"
              data-testid="session-aside"
              onClick={(event) => {
                event.stopPropagation();
                onAside(option);
              }}
            >
              旁开
            </span>
          ) : null}
          {isSelected ? <Check size={13} aria-hidden="true" className={styles.sessionCheck} /> : null}
        </button>,
      );
    });
    return rows;
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={styles.sessionTrigger}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`选择会话，当前 ${selected?.label ?? "主 Agent"}`}
          title="切换会话（主 Agent / Planner / Worker）"
          data-action="session"
          data-testid="session-dropdown-trigger"
        >
          <span className={styles.sessionCaption}>会话</span>
          <span className={styles.sessionValue}>{selected?.label ?? "主 Agent"}</span>
          <ChevronDown size={12} aria-hidden="true" className={styles.sessionChevron} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className={`${styles.sessionMenu} w-[260px] gap-0 p-1`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          listRef.current?.focus();
        }}
        data-testid="session-menu"
      >
        <div
          ref={listRef}
          id="task-session-listbox"
          role="listbox"
          aria-label="选择会话"
          aria-activedescendant={`task-session-option-${options[activeIndex]?.id ?? selected?.id ?? ""}`}
          tabIndex={0}
          className={styles.sessionList}
          onKeyDown={handleListKeyDown}
        >
          {renderRows()}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** An uploaded attachment plus the local key its chip removes by. */
type ComposerAttachment = ChatAttachment & { readonly localId: number };

/** Upload cap per message (the composer chip row stays one line of chips). */
const MAX_ATTACHMENTS = 6;

/** Human size for the attachment cards (reference: FileCard shows name + size). */
function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Leading glyph per attachment kind, so a rail of cards scans by shape. */
function attachmentGlyph(name: string) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "IMG";
  if (["md", "txt", "log"].includes(ext)) return "TXT";
  if (["json", "yaml", "yml", "xml", "csv"].includes(ext)) return "DAT";
  if (["go", "ts", "tsx", "js", "py", "sh", "ps1"].includes(ext)) return "SRC";
  return "FILE";
}

// Copy for the two chips the backend cannot honour yet. Both stay in the bar as
// explicitly disabled controls (with the explanation on a hoverable wrapper —
// a disabled button swallows its own title in Chromium) instead of pretending
// to be clickable.
const APPROVAL_CHIP_TITLE =
  "审批由「拦截规则」决定。本任务的规则可在下方「审批与拦截」里查看/开关，全局规则在「设置 → 拦截规则」。";

/**
 * A composer chip whose setting cannot be changed from here. It used to be a
 * `disabled` button: correct but useless — you cannot focus it, and hovering is
 * the only way to learn why. This opens a small panel with the reason and a link
 * to the page that actually owns the setting.
 */
function ConstraintChip({
  label,
  reason,
  href,
  linkLabel,
  testId,
  action,
}: {
  readonly label: string;
  readonly reason: string;
  readonly href: string;
  readonly linkLabel: string;
  readonly testId: string;
  readonly action: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={styles.chipButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label} —— ${reason}`}
          title={reason}
          data-action={action}
          data-testid={testId}
        >
          <span className={styles.chipLabel}>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-[300px] gap-2 p-3"
        data-testid={`${testId}-panel`}
      >
        <p className={styles.constraintText}>{reason}</p>
        <a className={styles.constraintLink} href={href}>
          {linkLabel}
        </a>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reasoning-effort picker for the composer.
 *
 * The backend cannot change a profile's effort mid-task (norma/llm keeps it on the
 * provider Config), so the choice is sent per turn and the server rebuilds the
 * provider for that turn only. "" means "inherit the profile".
 */
/** Which card a tool row draws. Mirrors the reference tool views. */
type ToolCardKind = "terminal" | "read" | "search" | "diff" | "generic";

function toolCardKind(tool: string): ToolCardKind {
  if (tool === "Bash" || tool === "Shell") return "terminal";
  if (tool === "Read") return "read";
  if (tool === "Grep" || tool === "Glob" || tool === "Search") return "search";
  if (tool === "Edit" || tool === "MultiEdit" || tool === "Write" || tool === "str_replace_editor") return "diff";
  return "generic";
}

/** Recover the tool arguments from the activity summary ("Bash {...}"). */
function parseToolArgs(tool: string, summary: string): Record<string, unknown> | null {
  const text = summary.trim();
  const brace = text.indexOf("{");
  if (brace < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(brace));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Output body that keeps a chat row scannable: shows the first `maxLines`, then a
 * toggle for the rest (reference: CHAT_TERMINAL_MAX_LINES / CHAT_READ_MAX_LINES).
 */
function CollapsibleOutput({
  text,
  maxLines,
  failed,
}: {
  readonly text: string;
  readonly maxLines: number;
  readonly failed: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const lines = text === "" ? [] : text.split("\\n");
  const hidden = lines.length - maxLines;
  const shown = expanded || hidden <= 0 ? lines : lines.slice(0, maxLines);
  return (
    <div className={styles.cardBody}>
      <pre className={styles.toolPre} data-error={failed || undefined}>
        {shown.join("\\n") || "（无输出）"}
      </pre>
      {hidden > 0 ? (
        <button
          type="button"
          className={styles.cardExpand}
          onClick={() => setExpanded((value) => !value)}
          data-testid="tool-expand-output"
        >
          {expanded ? "收起" : `展开其余 ${hidden} 行`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Numbered body for a file read: a gutter plus the text, capped like the rest of
 * the chat surface (reference: ReadBlock renders ReadBlockLine{number,text}).
 */
function NumberedLines({ text, maxLines }: { readonly text: string; readonly maxLines: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const lines = text === "" ? [] : text.split("\n");
  const hidden = lines.length - maxLines;
  const shown = expanded || hidden <= 0 ? lines : lines.slice(0, maxLines);
  return (
    <div className={styles.cardBody}>
      <div className={styles.numberedBody} data-testid="read-lines">
        {shown.map((line, index) => (
          <div className={styles.numberedRow} key={index}>
            <span className={styles.numberedGutter} aria-hidden="true">{index + 1}</span>
            <span className={styles.numberedText}>{line === "" ? " " : line}</span>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <button type="button" className={styles.cardExpand} onClick={() => setExpanded((v) => !v)} data-testid="tool-expand-output">
          {expanded ? "收起" : `展开其余 ${hidden} 行`}
        </button>
      ) : null}
    </div>
  );
}

/** One hit line parsed out of grep-style output ("path:line:text"). */
type SearchHit = { readonly file: string; readonly line: string; readonly text: string };

function parseSearchHits(text: string): { hits: SearchHit[]; other: string[] } {
  const hits: SearchHit[] = [];
  const other: string[] = [];
  for (const raw of text.split("\n")) {
    const match = /^(.+?):(\d+):(.*)$/.exec(raw);
    if (match) hits.push({ file: match[1], line: match[2], text: match[3] });
    else if (raw.trim() !== "") other.push(raw);
  }
  return { hits, other };
}

/**
 * Search results grouped by file with a per-file count (reference: SearchBlock).
 * Falls back to a plain listing when the output is not grep-shaped.
 */
function SearchGroups({ text, maxLines }: { readonly text: string; readonly maxLines: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const { hits, other } = React.useMemo(() => parseSearchHits(text), [text]);
  if (hits.length === 0) {
    return <CollapsibleOutput text={text} maxLines={maxLines} failed={false} />;
  }
  const byFile = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const bucket = byFile.get(hit.file);
    if (bucket) bucket.push(hit);
    else byFile.set(hit.file, [hit]);
  }
  const files = [...byFile.entries()];
  const shown = expanded ? files : files.slice(0, 4);
  const hidden = files.length - shown.length;
  return (
    <div className={styles.cardBody} data-testid="search-groups">
      {shown.map(([file, rows]) => (
        <div className={styles.searchFile} key={file}>
          <div className={styles.searchFileHead}>
            <span className={styles.searchFile} title={file}>{file}</span>
            <span className={styles.cardMeta}>{rows.length} 处</span>
          </div>
          {rows.slice(0, expanded ? rows.length : 3).map((row, index) => (
            <div className={styles.searchHit} key={`${row.line}-${index}`}>
              <span className={styles.numberedGutter} aria-hidden="true">{row.line}</span>
              <span className={styles.numberedText}>{row.text}</span>
            </div>
          ))}
        </div>
      ))}
      {hidden > 0 || other.length > 0 ? (
        <button type="button" className={styles.cardExpand} onClick={() => setExpanded((v) => !v)} data-testid="tool-expand-output">
          {expanded ? "收起" : `展开其余 ${hidden} 个文件`}
        </button>
      ) : null}
    </div>
  );
}

/** One file mutation reduced to the pair of texts the diff card draws. */
type DiffHunk = { readonly path: string; readonly oldText: string | null; readonly newText: string };

/** Recover diff hunks from a file-mutation call's arguments. */
function diffHunks(args: Record<string, unknown> | null): DiffHunk[] {
  if (!args) return [];
  const path = String(args.file_path ?? args.path ?? args.filename ?? "");
  if (Array.isArray(args.edits)) {
    return (args.edits as Array<Record<string, unknown>>).map((edit) => ({
      path: String(edit.file_path ?? path),
      oldText: typeof edit.old_string === "string" ? edit.old_string : null,
      newText: typeof edit.new_string === "string" ? edit.new_string : "",
    }));
  }
  if (typeof args.old_string === "string" || typeof args.new_string === "string") {
    return [{ path, oldText: typeof args.old_string === "string" ? args.old_string : null, newText: typeof args.new_string === "string" ? args.new_string : "" }];
  }
  if (typeof args.content === "string") {
    return [{ path, oldText: null, newText: args.content }];
  }
  return [];
}

/** Added/removed line totals for the row summary (reference: diff totals). */
function diffTotals(hunks: ReadonlyArray<DiffHunk>): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    added += hunk.newText === "" ? 0 : hunk.newText.split("\n").length;
    removed += hunk.oldText ? hunk.oldText.split("\n").length : 0;
  }
  return { added, removed };
}

/**
 * Diff body for a file mutation: removed lines then added lines, capped like the
 * chat surface (reference: DiffBlock, CHAT_DIFF_MAX_LINES = 9).
 */
function DiffBody({ hunks, maxLines = 9 }: { readonly hunks: ReadonlyArray<DiffHunk>; readonly maxLines?: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const rows = React.useMemo(() => {
    const out: Array<{ sign: "+" | "-"; text: string }> = [];
    for (const hunk of hunks) {
      if (hunk.oldText) for (const line of hunk.oldText.split("\n")) out.push({ sign: "-", text: line });
      for (const line of hunk.newText.split("\n")) out.push({ sign: "+", text: line });
    }
    return out;
  }, [hunks]);
  if (rows.length === 0) return <p className={styles.cardEmpty}>（没有可显示的改动）</p>;
  const hidden = rows.length - maxLines;
  const shown = expanded || hidden <= 0 ? rows : rows.slice(0, maxLines);
  return (
    <div className={styles.cardBody} data-testid="diff-body">
      <div className={styles.diffBody}>
        {shown.map((row, index) => (
          <div className={styles.diffRow} data-sign={row.sign} key={index}>
            <span className={styles.diffSign} aria-hidden="true">{row.sign}</span>
            <span className={styles.diffText}>{row.text === "" ? " " : row.text}</span>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <button type="button" className={styles.cardExpand} onClick={() => setExpanded((v) => !v)} data-testid="tool-expand-output">
          {expanded ? "收起" : `展开其余 ${hidden} 行`}
        </button>
      ) : null}
    </div>
  );
}

/** Copy-to-clipboard affordance for terminal cards. */
function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className={styles.cardCopy}
      title={label}
      aria-label={label}
      data-testid="tool-copy"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        );
      }}
    >
      {copied ? "已复制" : label}
    </button>
  );
}

/**
 * Chinese label for a tool row. The raw tool name stays available (title/aria),
 * but the visible line speaks the same language as the rest of the surface.
 */
const TOOL_LABELS: Record<string, string> = {
  Bash: "命令",
  Read: "读取",
  Write: "写入",
  Edit: "编辑",
  MultiEdit: "编辑",
  Grep: "搜索",
  Glob: "查找",
  LS: "列目录",
  WebFetch: "抓取",
  WebSearch: "联网搜索",
  TodoWrite: "待办",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

function ToolRow({
  step,
  result,
  taskId,
}: {
  readonly step: Activity;
  readonly result?: Activity;
  readonly taskId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail !== null || loading) return;
    setLoading(true);
    try {
      // The full body lives on the RESULT activity; the tool_use detail is only the
      // argument JSON (its summary is a truncated one-liner).
      const response = await api.activityDetail((result ?? step).seq, taskId);
      setDetail(response.detail || "没有更多详情");
    } catch {
      setDetail("详情加载失败");
    } finally {
      setLoading(false);
    }
  };

  // Row geometry follows the reference ToolRow: 24px single line,
  // [16 leading] gap6 [title 13/24] gap8 [2x2 dot] gap8 [summary fills + truncates].
  // State is carried by the leading icon and an error marker, not by a pill - a
  // "完成/失败" chip on every row is noise when 95% of rows succeed.
  const tool = step.tool || "tool";
  // Card shape is chosen by tool, not by a generic fallback: a terminal reads
  // differently from a file read or a search (reference: per-tool views).
  const cardKind = toolCardKind(tool);
  const args = parseToolArgs(tool, step.summary || "");
  // File mutations render as a diff: removed lines then added lines, with the
  // +/- totals in the row summary (reference: DiffBlock + diff totals).
  const hunks = React.useMemo(() => diffHunks(args), [args]);
  const totals = React.useMemo(() => diffTotals(hunks), [hunks]);
  const failed = Boolean(result?.is_error);
  const pending = !result;
  // The backend summary already starts with the tool name ("Bash {...}"); the row
  // renders the name as its own title, so drop the duplicate prefix.
  const rawArgSummary = (step.summary || "").trim();
  const strippedArgs = rawArgSummary.toLowerCase().startsWith(tool.toLowerCase())
    ? rawArgSummary.slice(tool.length).trim()
    : rawArgSummary;
  // A no-argument call serialises to "{}"; showing that verbatim reads like a
  // broken payload, so name the state instead.
  const argSummary = strippedArgs === "{}" || strippedArgs === "" ? "无参数" : strippedArgs;
  const output = (result?.summary || "").trim();
  // result.summary is a truncated one-liner; the full body only arrives through
  // activityDetail when the row expands. Prefer the detail once it lands, or a
  // terminal card would show a cut-off command output as if that were all of it.
  const bodyText = detail !== null ? detail.trim() : output;

  return (
    <div className={styles.toolRoot} data-state={failed ? "error" : pending ? "pending" : "ok"}>
      <button
        type="button"
        className={styles.toolRow}
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={`${tool}${argSummary ? `：${argSummary}` : ""}${failed ? "（失败）" : ""}（点击展开）`}
        data-action="tool-row"
        data-testid="tool-row"
      >
        <span className={styles.toolIcon} aria-hidden="true">
          {failed ? <X size={14} /> : tool === "Bash" ? <Terminal size={14} /> : <Wrench size={14} />}
        </span>
        <span className={styles.toolName}>{toolLabel(tool)}</span>
        <span className={styles.toolSep} aria-hidden="true" />
        <span className={styles.toolSummary}>{argSummary || "执行中…"}</span>
        {cardKind === "diff" && (totals.added > 0 || totals.removed > 0) ? (
          <span className={styles.diffStat} data-testid="diff-summary">
            <span className={styles.diffAdded}>+{totals.added}</span>
            <span className={styles.diffRemoved}>-{totals.removed}</span>
          </span>
        ) : null}
        {failed ? <span className={styles.toolErrorMark}>失败</span> : null}
        <ChevronDown size={12} aria-hidden="true" className={styles.toolChevron} />
      </button>
      {open ? (
        <div className={styles.toolBody} data-testid="tool-body" data-card={cardKind}>
          {cardKind === "terminal" ? (
            <>
              <div className={styles.cardHead}>
                <span className={styles.cardPrompt} aria-hidden="true">$</span>
                <code className={styles.cardCommand}>{String(args?.command ?? argSummary) || "—"}</code>
                <CopyButton value={String(args?.command ?? argSummary)} label="复制命令" />
                <CopyButton value={bodyText} label="复制输出" />
                <span className={styles.cardExit} data-failed={failed || undefined}>
                  {failed ? "失败" : pending ? "运行中" : "完成"}
                </span>
              </div>
              <CollapsibleOutput text={loading ? "加载中…" : bodyText} maxLines={12} failed={failed} />
            </>
          ) : null}
          {cardKind === "read" ? (
            <>
              <div className={styles.cardHead}>
                <span className={styles.cardLabel}>读取</span>
                <code className={styles.cardPath}>{String(args?.path ?? args?.file_path ?? argSummary) || "—"}</code>
                <span className={styles.cardMeta}>{output === "" ? "" : `${output.split("\\n").length} 行`}</span>
              </div>
              <NumberedLines text={loading ? "加载中…" : bodyText} maxLines={8} />
            </>
          ) : null}
          {cardKind === "search" ? (
            <>
              <div className={styles.cardHead}>
                <span className={styles.cardLabel}>{tool === "Glob" ? "文件匹配" : "搜索"}</span>
                <code className={styles.cardPath}>{String(args?.pattern ?? argSummary) || "—"}</code>
                {args?.path ? <span className={styles.cardMeta}>{String(args.path)}</span> : null}
              </div>
              <SearchGroups text={loading ? "加载中…" : bodyText} maxLines={10} />
            </>
          ) : null}
          {cardKind === "diff" ? (
            <>
              <div className={styles.cardHead}>
                <span className={styles.cardLabel}>{tool}</span>
                <code className={styles.cardPath}>{hunks[0]?.path || argSummary || "—"}</code>
                <span className={styles.diffStat} data-testid="diff-stat">
                  <span className={styles.diffAdded}>+{totals.added}</span>
                  {" "}
                  <span className={styles.diffRemoved}>-{totals.removed}</span>
                </span>
              </div>
              <DiffBody hunks={hunks} />
            </>
          ) : null}
          {cardKind === "generic" ? (
            <>
              {argSummary ? (
                <>
                  <div className={styles.toolSectionLabel}>参数</div>
                  <pre className={styles.toolPre}>{argSummary}</pre>
                </>
              ) : null}
              <div className={styles.toolSectionLabel}>输出</div>
              <pre className={styles.toolPre} data-error={failed || undefined}>
                {loading ? "加载中…" : output || detail || (pending ? "等待结果…" : "（无输出）")}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inline intercept approval card. The pending id is carried in the summary as
 * "(#N)" (same contract as the legacy transcript), so the decide buttons work
 * without waiting for a detail round-trip.
 */
function ApprovalCard({ activity }: { readonly activity: Activity }) {
  const pendingId = React.useMemo(() => {
    const match = /\(#(\d+)\)/.exec(activity.summary ?? "");
    return match ? Number(match[1]) : null;
  }, [activity.summary]);
  const toolName = React.useMemo(() => {
    const match = /工具\s+(\S+)\s+请求/.exec(activity.summary ?? "");
    return match?.[1] ?? activity.tool ?? "工具";
  }, [activity.summary, activity.tool]);

  const [decided, setDecided] = React.useState<"allowed" | "denied" | null>(null);
  const [busy, setBusy] = React.useState<"allowed" | "denied" | null>(null);
  const inherited = Boolean(activity.inherited);

  const decide = async (decision: "allowed" | "denied") => {
    if (inherited || !pendingId || busy) return;
    setBusy(decision);
    try {
      await api.interceptDecide(pendingId, decision);
      setDecided(decision);
      toast.success(decision === "allowed" ? "已允许执行" : "已拒绝执行");
    } catch (error) {
      toast.error((error as Error).message || "审批失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.approval} data-testid="approval-card" data-pending-id={pendingId ?? undefined}>
      <div className={styles.approvalHead}>
        <span className={styles.approvalDot} aria-hidden="true" />
        <span className={styles.approvalTitle}>审批请求 · {toolName}</span>
        {pendingId ? <span className={styles.approvalId}>#{pendingId}</span> : null}
        {inherited ? <span className={styles.approvalTag}>历史记录 · 只读</span> : null}
        {decided ? (
          <span className={styles.approvalTag} data-tone={decided}>
            {decided === "allowed" ? "已允许" : "已拒绝"}
          </span>
        ) : null}
      </div>
      <div className={styles.approvalBody}>{activity.summary || "等待用户审批"}</div>
      {!inherited && pendingId && !decided ? (
        <div className={styles.approvalActions}>
          <button
            type="button"
            className={styles.approvalAllow}
            onClick={() => void decide("allowed")}
            disabled={busy !== null}
            data-action="approval-allow"
            data-testid="approval-allow"
          >
            {busy === "allowed" ? <Loader2 size={12} className={styles.spinner} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
            允许执行
          </button>
          <button
            type="button"
            className={styles.approvalDeny}
            onClick={() => void decide("denied")}
            disabled={busy !== null}
            data-action="approval-deny"
            data-testid="approval-deny"
          >
            {busy === "denied" ? <Loader2 size={12} className={styles.spinner} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
            拒绝
          </button>
        </div>
      ) : null}
    </div>
  );
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

/** While streaming, the reference shows the latest *completed* paragraph, not the
 *  partial one being written - so the summary does not flicker mid-sentence. */
function latestCompletedParagraphFirstLine(text: string): string {
  const paragraphs = text.split(/\r?\n(?:[\t ]*\r?\n)+/);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const line = firstLine(paragraphs[index]).trim();
    if (line !== "") return line;
  }
  return "";
}

/**
 * Reasoning disclosure (ported from the reference ReasoningRow): a 24px row with
 * icon + label + dot separator + a one-line summary, expanding to the full text.
 * The streaming row fades at its right edge instead of clipping mid-glyph.
 */
function ReasoningRow({
  kind,
  text,
  streaming,
}: {
  readonly kind: string;
  readonly text: string;
  readonly streaming: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const clean = text.replaceAll("**", "").trim();
  const summary = streaming ? latestCompletedParagraphFirstLine(clean) : firstLine(clean);
  if (clean === "") return null;
  const label = kind === "thinking" ? "思考" : "意图";
  return (
    <div className={styles.thinkRow} data-streaming={streaming || undefined} data-expanded={open || undefined}>
      <button
        type="button"
        className={styles.thinkHead}
        aria-expanded={open}
        aria-label={`${label}${summary ? `：${summary}` : ""}（点击展开）`}
        onClick={() => setOpen((value) => !value)}
        data-action="reasoning-toggle"
        data-testid="reasoning-row"
      >
        <Brain size={14} aria-hidden="true" className={styles.thinkIcon} />
        <span className={styles.thinkLabel}>{label}</span>
        <span className={styles.thinkDot} aria-hidden="true" />
        <span className={styles.thinkSummary}>{summary}</span>
        <ChevronDown size={12} aria-hidden="true" className={styles.thinkChevron} />
      </button>
      {open ? (
        <div className={styles.thinkBody}>
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Running row at the transcript tail (ported from the reference RunningStatus):
 * shimmering label plus a live elapsed clock, announced politely once. The clock
 * is isolated here so streaming re-renders never restart the interval.
 */
function RunningStatus({ startedAt }: { readonly startedAt: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(1, Math.round((now - startedAt) / 1000));
  const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return (
    <div className={styles.running} data-testid="running-status">
      <span className={styles.runningDivider} aria-hidden="true" />
      <span className={styles.runningDot} aria-hidden="true" />
      <span className={styles.runningText} role="status" aria-live="polite">
        深度思考中 · {elapsed}
      </span>
    </div>
  );
}

/**
 * Empty-transcript hero (ported from the reference EmptyHero/HeroShell): a
 * centered stack with the mark, a 26/32 headline and starter prompts that fill
 * the composer. The reference centers the real input card here; our composer is
 * already pinned at the bottom, so this only carries the chrome above it.
 */
function EmptyHero({ onPick }: { readonly onPick: (text: string) => void }) {
  const starters = [
    "这个任务的当前进展如何？",
    "列出已发现的高危问题",
    "下一步你建议做什么？",
  ];
  return (
    <div className={styles.heroRoot} data-testid="empty-hero">
      <div className={styles.heroStack}>
        <div className={styles.heroHeadline}>
          <span className={styles.heroMark} aria-hidden="true" />
          <span>开始对话</span>
        </div>
        <p className={styles.heroHint}>描述你想让它做的事，或从下面选一个开始。</p>
        <div className={styles.heroStarters}>
          {starters.map((text) => (
            <button
              key={text}
              type="button"
              className={styles.heroStarter}
              onClick={() => onPick(text)}
              data-action="hero-starter"
              data-testid="hero-starter"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A human turn, editable in place. Editing rewinds the lane to just before this
 * message and resends the edited text, so the model never sees both versions
 * (reference: message editing in codex / zcode; DSH cannot do this at all).
 */
function UserRow({
  activity,
  taskId,
  seg,
  onEdited,
}: {
  readonly activity: Activity;
  readonly taskId: string;
  readonly seg: number;
  readonly onEdited: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(activity.summary ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const save = async () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      // Rewinding mid-turn would strand the lane: the running turn keeps writing into
      // a tail we just deleted, and the resend is rejected with 409. Wait for idle.
      for (let attempt = 0; attempt < 120; attempt++) {
        const status = await api.chatStatus(taskId).catch(() => ({ running: false }));
        if (!status.running) break;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      await api.truncateChat(taskId, activity.seq, seg);
      await api.chat(text, taskId, [], seg);
      setEditing(false);
      onEdited();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className={styles.userRow} data-seq={activity.seq} data-turn-start={activity.seq}>
        <div className={styles.bubble}>{activity.summary}</div>
        <button
          type="button"
          className={styles.userEdit}
          title="编辑并重新发送"
          aria-label="编辑这条消息"
          data-testid="user-edit"
          onClick={() => {
            setDraft(activity.summary ?? "");
            setEditing(true);
          }}
        >
          编辑
        </button>
      </div>
    );
  }

  return (
    <div className={styles.userRow} data-seq={activity.seq} data-editing="true" data-testid="user-edit-form">
      <textarea
        className={styles.userEditBox}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={Math.min(8, Math.max(2, draft.split("\n").length))}
        data-testid="user-edit-input"
        autoFocus
      />
      {error !== "" ? <div className={styles.userEditError}>{error}</div> : null}
      <div className={styles.userEditActions}>
        <button type="button" className={styles.userEditSave} onClick={() => void save()} disabled={busy} data-testid="user-edit-save">
          {busy ? "重发中…" : "保存并重发"}
        </button>
        <button type="button" className={styles.userEditCancel} onClick={() => setEditing(false)} disabled={busy} data-testid="user-edit-cancel">
          取消
        </button>
      </div>
    </div>
  );
}

/**
 * The final answer is stored in full in the activity detail; the history row only
 * carries its first line. Render the detail once it loads, keeping the summary as
 * the immediate (and fallback) text - rendering the summary alone is what made a
 * long reply look truncated to its opening sentence.
 */
function AssistantAnswer({
  taskId,
  seq,
  summary,
}: {
  readonly taskId: string;
  readonly seq: number;
  readonly summary: string;
}) {
  const [text, setText] = React.useState(summary);

  React.useEffect(() => {
    if (taskId === "" || seq <= 0) return;
    let live = true;
    api
      .activityDetail(seq, taskId)
      .then((result) => {
        const detail = (result?.detail ?? "").trim();
        if (live && detail.length > summary.trim().length) setText(detail);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [seq, summary, taskId]);

  return <Markdown text={text} />;
}

function buildActivityNodes(activities: Activity[], taskId: string, streamingSeq: number, seg: number, onEdited: () => void): React.ReactNode[] {
  const resultByUse = new Map<string, Activity>();
  for (const activity of activities) {
    if (activity.kind === "tool_result" && activity.tool_use_id) resultByUse.set(activity.tool_use_id, activity);
  }

  const nodes: React.ReactNode[] = [];
  let toolGroup: Activity[] = [];
  let groupKey = 0;

  const flushTools = () => {
    if (!toolGroup.length) return;
    const key = `tools-${groupKey++}`;
    nodes.push(
      <div className={styles.process} key={key}>
        {toolGroup.map((step) => (
          <ToolRow key={step.seq} step={step} result={step.tool_use_id ? resultByUse.get(step.tool_use_id) : undefined} taskId={taskId} />
        ))}
      </div>,
    );
    toolGroup = [];
  };

  for (const activity of activities) {
    if (activity.kind === "tool_result") continue;
    if (activity.kind === "tool_use") {
      toolGroup.push(activity);
      continue;
    }
    flushTools();

    if (activity.kind === "user") {
      nodes.push(
        <UserRow
          key={`user-${activity.seq}`}
          activity={activity}
          taskId={taskId}
          seg={seg}
          onEdited={onEdited}
        />,
      );
      continue;
    }
    if (activity.kind === "text") {
      nodes.push(
        <div className={styles.assistant} key={`text-${activity.seq}`}>
          <Markdown text={activity.summary} />
        </div>,
      );
      continue;
    }
    if (activity.kind === "thinking" || activity.kind === "intent") {
      // Reasoning is a collapsed disclosure (reference: ReasoningRow): one 24px
      // row with icon + label + dot + a one-line summary, expandable to the full
      // text. It is never a wall of thinking dumped into the transcript.
      nodes.push(
        <ReasoningRow
          key={`reason-${activity.seq}`}
          kind={activity.kind}
          text={activity.summary ?? ""}
          streaming={streamingSeq === activity.seq}
        />,
      );
      continue;
    }
    if (activity.kind === "round") {
      nodes.push(<div className={styles.round} key={`round-${activity.seq}`}>{activity.summary || "新一轮"}</div>);
      continue;
    }
    if (activity.kind === "intercept_request") {
      nodes.push(<ApprovalCard key={`approval-${activity.seq}`} activity={activity} />);
      continue;
    }
    if (activity.kind === "result") {
      const tokens = (activity.input_tokens ?? 0) + (activity.output_tokens ?? 0);
      // The main agent's final answer lives in `result.summary` (the server does
      // not emit a separate text frame for it). Rendering only the turn-end footer
      // is what made every reply look like it never arrived.
      const answer = (activity.summary ?? "").trim();
      nodes.push(
        <React.Fragment key={`result-${activity.seq}`}>
          {answer ? (
            <div className={styles.assistant} data-testid="assistant-answer">
              <AssistantAnswer taskId={taskId} seq={activity.seq} summary={answer} />
            </div>
          ) : null}
          <div className={styles.footer} data-seq={activity.seq} data-turn-end={activity.seq}>
            Turn 结束{tokens > 0 ? ` · ${fmtTokens(tokens)} tokens` : ""}
          </div>
        </React.Fragment>,
      );
    }
  }
  flushTools();
  return nodes;
}

export function TaskWorkspaceDsh({ taskId }: { readonly taskId: string }) {
  const router = useRouter();
  const { rightOpen, toggleRight } = useAppLayout();
  const [task, setTask] = React.useState<Task | null>(null);
  const [activities, setActivities] = React.useState<Activity[]>([]);
  const [sessions, setSessions] = React.useState<Array<{ seq: number; created_at: string }>>([]);
  const [intents, setIntents] = React.useState<TaskNode[]>([]);
  const [currentKey, setCurrentKey] = React.useState(mainLaneKey(0));
  const [tab, setTab] = React.useState<TabKey>("chat");
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // Wall clock for the running row; set when a turn is submitted.
  const [turnStartedAt, setTurnStartedAt] = React.useState(() => Date.now());
  const [stopping, setStopping] = React.useState(false);
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([]);
  const [uploading, setUploading] = React.useState(0);
  // Whole-document file drag: dropping anywhere in the workspace attaches, like
  // the reference composer (DropOverlay), instead of requiring the paperclip.
  const [dragActive, setDragActive] = React.useState(false);
  // The turn the user just submitted, shown until the server's own activity
  // echo (SSE or poll) lands and replaces it.
  const [optimistic, setOptimistic] = React.useState<Activity[]>([]);
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [globalLLM, setGlobalLLM] = React.useState<GlobalLLM | null>(null);
  const [modelPending, setModelPending] = React.useState(false);
  const [modelOpenSignal, setModelOpenSignal] = React.useState(0);
  const [approvalOpen, setApprovalOpen] = React.useState(false);
  // Per-turn reasoning-effort override sent with the next message. "" inherits the
  // profile's own setting; the backend applies it to this turn's main-agent calls.
  const [reasoningOverride, setReasoningOverride] = React.useState("");
  const [commandIndex, setCommandIndex] = React.useState(0);
  const [commandDismissed, setCommandDismissed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [hasOlder, setHasOlder] = React.useState(false);
  const [oldestSeq, setOldestSeq] = React.useState(0);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [olderError, setOlderError] = React.useState("");
  const [showJump, setShowJump] = React.useState(false);
  const [live, setLive] = React.useState(false);
  const olderInFlightRef = React.useRef(false);
  const activeSessionKeyRef = React.useRef(mainLaneKey(0));
  const pollRef = React.useRef<number | null>(null);
  const streamRef = React.useRef<EventSource | null>(null);
  const snapshotRef = React.useRef(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  // Highest activity seq at the moment the current turn was sent. Used to tell
  // "this turn finished" apart from older result frames already on screen.
  const turnStartSeqRef = React.useRef(0);
  // Safety valve: a turn that never emits `result` must not leave the composer
  // stuck in the running state forever.
  const turnTimeoutRef = React.useRef<number | null>(null);

  // A turn ends when its `result` frame lands (that frame carries the answer).
  // Clearing `sending` here - instead of right after the 202 - is what lets the
  // composer show a working stop control for the whole turn.
  React.useEffect(() => {
    if (!sending) return;
    const finished = activities.some((a) => a.kind === "result" && a.seq > turnStartSeqRef.current);
    if (finished) {
      setSending(false);
      if (turnTimeoutRef.current !== null) {
        window.clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = null;
      }
    }
  }, [activities, sending]);


  // Watchdog for a turn whose `result` never arrives (crash, kill, model hang).
  React.useEffect(() => {
    if (!sending) {
      if (turnTimeoutRef.current !== null) {
        window.clearTimeout(turnTimeoutRef.current);
        turnTimeoutRef.current = null;
      }
      return;
    }
    if (turnTimeoutRef.current === null) {
      turnTimeoutRef.current = window.setTimeout(() => {
        turnTimeoutRef.current = null;
        setSending(false);
      }, 10 * 60 * 1000);
    }
  }, [sending]);


  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Bottom-follow policy ported from the reference harness: follow intent is its
  // own state and "near the bottom" is a 24px tolerance, so streaming growth keeps
  // the floor in view while a reader who scrolled up is left alone.
  const followRef = React.useRef<ScrollFollow | null>(null);
  const follow = () => {
    if (followRef.current === null) followRef.current = new ScrollFollow(true);
    return followRef.current;
  };
  const attachmentSeqRef = React.useRef(0);

  const loadTask = React.useCallback(() => {
    api.task(taskId).then(setTask).catch((e) => setError((e as Error).message));
  }, [taskId]);

  const loadSessions = React.useCallback(() => {
    return api
      .mainSessions(taskId)
      .then((result) => {
        setSessions(result.sessions);
        // Adopt the server's current main-agent segment on first load only.
        setCurrentKey((current) => {
          if (current !== mainLaneKey(0)) return current;
          const seq = result.current || result.sessions[0]?.seq || 0;
          return mainLaneKey(seq);
        });
      })
      .catch(() => setSessions([]));
  }, [taskId]);

  // Model seats read the real LLM catalog: every profile plus the global
  // fallback the task calls when its own chain is empty.
  const loadLLM = React.useCallback(() => {
    api
      .llmProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
    api
      .getLLM()
      .then((value) => setGlobalLLM(value))
      .catch(() => setGlobalLLM(null));
  }, []);

  // Worker lanes come from exploration intents (there is no backend sessions
  // endpoint); the planner lane is a fixed affordance like the main lane.
  const loadIntents = React.useCallback(() => {
    api
      .intents(taskId)
      .then(setIntents)
      .catch(() => setIntents([]));
  }, [taskId]);

  const loadActivity = React.useCallback(
    async (sessionKey: string) => {
      try {
        const history = await api.activityHistory(taskId, sessionKey, 0, 200);
        // An empty first page is a normal state (a fresh task has no main-agent
        // turns yet), NOT an error. Treating it as one dropped through to the
        // 300-row fallback query, which then ran on every poll.
        if (activeSessionKeyRef.current !== sessionKey) return;
        if (history.items.length === 0) {
          setActivities([]);
          setHasOlder(false);
          setOldestSeq(0);
          if (history.snapshotCursor > snapshotRef.current) snapshotRef.current = history.snapshotCursor;
          return;
        }
        const earliest = history.earliestCursor || Math.min(...history.items.map((item) => item.seq));
        // Keep pages the reader already pulled in via scroll-up; the poll only
        // refreshes the newest window.
        setActivities((current) => {
          const older = current.filter((item) => item.seq < earliest);
          const seen = new Set(history.items.map((item) => item.seq));
          return [...older.filter((item) => !seen.has(item.seq)), ...history.items].sort((a, b) => a.seq - b.seq);
        });
        setHasOlder((current) => current || history.hasMore);
        setOldestSeq((current) => (current > 0 && current < earliest ? current : earliest));
        // The SSE resumes from the task-level max id, so history (seq <= cursor)
        // and the live tail (seq > cursor) meet with no gap.
        if (history.snapshotCursor > snapshotRef.current) snapshotRef.current = history.snapshotCursor;
      } catch {
        if (activeSessionKeyRef.current !== sessionKey) return;
        // Fallback for environments without the history endpoint: filter the
        // flat activity feed by the lane that owns the session key.
        try {
          const fallback = await api.activity(taskId, { limit: 300 });
          const items = fallback.items.filter((item) => sessionKeyOf(item) === sessionKey);
          setActivities(items);
          setHasOlder(false);
          setOldestSeq(items.length ? Math.min(...items.map((item) => item.seq)) : 0);
        } catch {
          setActivities([]);
          setHasOlder(false);
          setOldestSeq(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  /**
   * Scroll-up pagination: fetch the page before `oldestSeq`, prepend by seq,
   * and restore the reader's visual position by the height growth.
   */
  const loadOlder = React.useCallback(async () => {
    if (!hasOlder || olderInFlightRef.current || oldestSeq <= 0) return;
    olderInFlightRef.current = true;
    setLoadingOlder(true);
    setOlderError("");
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    const sessionKey = currentKey;
    try {
      const history = await api.activityHistory(taskId, sessionKey, oldestSeq, 200);
      if (activeSessionKeyRef.current !== currentKey) return;
      if (history.items.length > 0) {
        setActivities((current) => {
          const seen = new Set(current.map((item) => item.seq));
          const older = history.items.filter((item) => !seen.has(item.seq));
          return [...older, ...current].sort((a, b) => a.seq - b.seq);
        });
        setHasOlder(history.hasMore);
        setOldestSeq(history.earliestCursor || Math.min(...history.items.map((item) => item.seq)));
        window.requestAnimationFrame(() => {
          const next = scrollRef.current;
          if (next) next.scrollTop = next.scrollHeight - previousHeight + previousTop;
        });
      } else {
        setHasOlder(history.hasMore);
      }
    } catch (loadError) {
      setOlderError((loadError as Error).message || "更早历史加载失败");
    } finally {
      olderInFlightRef.current = false;
      setLoadingOlder(false);
    }
  }, [currentKey, hasOlder, oldestSeq, taskId]);

  const jumpToBottom = React.useCallback((smooth = true) => {
    const element = scrollRef.current;
    if (!element) return;
    follow().toBottom(element, scrollMetrics(element), smooth ? "smooth" : "instant");
    setShowJump(false);
  }, []);

  // The chat composer always targets the main-agent lane; worker lanes are
  // read-only transcripts, so the segment falls back to the newest main lane.
  const currentSeq = React.useMemo(() => {
    if (currentKey.startsWith("main:")) {
      const parsed = Number(currentKey.slice("main:".length));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    // Non-main lanes are read-only transcripts; the composer targets the newest
    // main segment so a send always lands in the live conversation.
    return sessions[sessions.length - 1]?.seq ?? 0;
  }, [currentKey, sessions]);

  // Only the main-agent lanes accept human input. Planner and worker lanes are
  // sub-sessions: the reference harness swaps in a read-only composer for them,
  // because typing there would silently post into a different conversation.
  const readOnlyLane = !currentKey.startsWith("main:");

  // Server transcript plus the in-flight optimistic turn.
  const transcript = React.useMemo(
    () => (optimistic.length > 0 ? [...activities, ...optimistic] : activities),
    [activities, optimistic],
  );

  // Turn boundaries for the navigation rail: a turn opens on a user row and closes
  // on the result row that carries the answer (reference: TurnNavigator rail).
  const turns = React.useMemo(() => {
    const list: Array<{ index: number; startSeq: number; endSeq: number }> = [];
    for (const activity of transcript) {
      if (activity.kind === "user") {
        list.push({ index: list.length, startSeq: activity.seq, endSeq: activity.seq });
      } else if (activity.kind === "result" && list.length > 0) {
        list[list.length - 1].endSeq = activity.seq;
      }
    }
    return list;
  }, [transcript]);
  const [activeTurn, setActiveTurn] = React.useState(0);

  // Jump to a turn: release follow first, otherwise streaming growth would drag the
  // reader back to the floor right after the jump.
  const scrollToTurn = React.useCallback((turnIndex: number) => {
    const element = scrollRef.current;
    const target = turns[turnIndex];
    if (!element || !target) return;
    const row = element.querySelector(`[data-turn-start="${target.startSeq}"]`);
    if (!(row instanceof HTMLElement)) return;
    follow().setFollowing(false);
    setShowJump(true);
    element.scrollTo({ top: Math.max(0, row.offsetTop - 12), behavior: "smooth" });
    setActiveTurn(turnIndex);
  }, [turns]);

  // The reasoning row that is currently streaming: the last thinking/intent row
  // while a turn is in flight. Everything else renders as settled.
  const streamingSeq = React.useMemo(() => {
    if (!sending) return -1;
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const activity = activities[index];
      if (activity.kind === "thinking" || activity.kind === "intent") return activity.seq;
    }
    return -1;
  }, [activities, sending]);

  React.useEffect(() => {
    loadTask();
    loadSessions();
    loadIntents();
    loadLLM();
    const timer = window.setInterval(() => {
      loadTask();
      loadIntents();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadLLM, loadIntents, loadSessions, loadTask]);

  // Live updates: one task-level SSE tails every lane's new activity and routes
  // each frame by session key, so switching lanes never reopens a stream. It
  // resumes from the task-level snapshot cursor recorded by `loadActivity`, so
  // history and the live tail meet with no gap. When EventSource is unavailable
  // (SSR/mock) or the stream fails, fall back to polling the newest window.
  //
  // The stream is task-scoped and outlives lane switches: reopening it per lane
  // replayed the whole task from `since=0` and made switching cost a full
  // round-trip plus a white transcript (measured 1.3 s / 4 requests per switch).
  // Frames are already routed by session key, so the open stream serves every
  // lane; only the history load below is per-lane.
  React.useEffect(() => {
    let disposed = false;

    const stopStream = () => {
      streamRef.current?.close();
      streamRef.current = null;
      setLive(false);
    };
    const stopPoll = () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // Poll whichever lane the user is looking at now, not the one captured when
    // the effect mounted.
    const startPoll = () => {
      if (pollRef.current !== null) return;
      pollRef.current = window.setInterval(() => void loadActivity(activeSessionKeyRef.current), 8000);
    };

    // Mock mode serves no SSE endpoint, so poll directly.
    if (MOCK || typeof EventSource === "undefined") {
      startPoll();
      return () => {
        disposed = true;
        stopPoll();
        stopStream();
      };
    }

    const openStream = () => {
      if (disposed) return;
      stopStream();
      const source = new EventSource(
        sseUrl(
          `/api/exploration/activity/stream?task=${encodeURIComponent(taskId)}&since=${snapshotRef.current}`,
        ),
      );
      streamRef.current = source;
      source.onopen = () => {
        if (disposed) return;
        setLive(true);
        // The stream owns freshness now; polling is only the safety net.
        stopPoll();
      };
      source.onerror = () => {
        if (disposed) return;
        setLive(false);
        // EventSource reconnects on its own; poll meanwhile so a proxy that
        // buffers the stream can never leave the transcript stale.
        startPoll();
      };
      source.onmessage = (event) => {
        if (disposed) return;
        let frame: Activity;
        try {
          frame = JSON.parse(event.data) as Activity;
        } catch {
          return; // ignore malformed frame
        }
        if (frame.seq > snapshotRef.current) snapshotRef.current = frame.seq;
        const key = sessionKeyOf(frame);
        if (key !== activeSessionKeyRef.current) return;
        setActivities((current) => {
          if (current.some((item) => item.seq === frame.seq)) return current;
          const older = current.filter((item) => item.seq < frame.seq);
          return [...older, frame].sort((a, b) => a.seq - b.seq);
        });
      };
    };

    openStream();
    return () => {
      disposed = true;
      stopPoll();
      stopStream();
    };
  }, [loadActivity, taskId]);

  // Lane switch: load that lane's newest window. Kept separate from the stream
  // effect so switching never tears the stream down.
  React.useEffect(() => {
    activeSessionKeyRef.current = currentKey;
    void loadActivity(currentKey);
  }, [currentKey, loadActivity]);

  // Composer textarea grows with its content, capped at 180px (then scrolls).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft value deliberately drives the height recalculation.
  React.useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const nextHeight = Math.min(Math.max(element.scrollHeight, 44), 180);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > 180 ? "auto" : "hidden";
  }, [input]);

  // Follow content GROWTH, not row count: a streaming assistant message grows
  // inside one row, so counting activities never fires. The reference viewport
  // measures the content box instead - ResizeObserver is the DOM equivalent.
  React.useEffect(() => {
    const element = scrollRef.current;
    const inner = element?.firstElementChild;
    if (!element || !(inner instanceof Element)) return;
    const observer = new ResizeObserver(() => {
      if (!follow().active) return;
      // Instant follow retargets an outstanding smooth scroll instead of cutting it.
      follow().toBottom(element, scrollMetrics(element), "instant");
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [currentKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: switching session resets scroll and optimistic echoes.
  React.useEffect(() => {
    // Do NOT clear `activities` here: the previous lane's rows stay on screen
    // until the new page arrives, so switching shows content instead of a blank
    // flash. `loadActivity` (the lane effect) replaces them, and its seq-merge
    // guarantees no stale row survives a real load.
    follow().reset();
    setShowJump(false);
    setOlderError("");
    setOptimistic([]);
    const element = scrollRef.current;
    if (element) follow().toBottom(element, scrollMetrics(element), "instant");
  }, [currentKey]);

  // Native scrolling settles on `scrollend`: an off-target stop (the reader grabbed
  // an in-flight smooth scroll) releases follow; a landing at the floor keeps it.
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onSettle = () => {
      follow().settle(scrollMetrics(element));
    };
    element.addEventListener("scrollend", onSettle);
    return () => element.removeEventListener("scrollend", onSettle);
  }, [currentKey]);

  const handleChatScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const metrics = scrollMetrics(element);
    // Feed the delivered position to the follow policy: a reader who left the
    // 24px floor band releases follow; scrolling back into it resumes.
    follow().sample(metrics);
    const distance = metrics.floor - metrics.top;
    setShowJump(distance > 120);
    // Which turn is at the top of the viewport: the rail highlights it.
    let currentTurn = 0;
    const limit = element.scrollTop + 12;
    for (const row of element.querySelectorAll("[data-turn-start]")) {
      if (!(row instanceof HTMLElement) || row.offsetTop > limit) continue;
      const seq = Number(row.getAttribute("data-turn-start"));
      const index = turns.findIndex((turn) => turn.startSeq === seq);
      if (index >= 0) currentTurn = index;
    }
    // At the floor the newest turn is the active one, even if its first row starts
    // below the top edge of the viewport (short transcripts never cross it).
    if (distance <= 24 && turns.length > 0) currentTurn = turns.length - 1;
    setActiveTurn(currentTurn);
    if (element.scrollTop < 64 && hasOlder && !loadingOlder) {
      void loadOlder();
    }
  };

  // Attachments are real uploads: the backend stores them under the task's
  // working directory and returns the relative path the agent reads, so the
  // chip shows that path and the send call passes it straight through.
  const attachFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const picked = Array.from(files);
      const room = MAX_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        toast.error(`最多 ${MAX_ATTACHMENTS} 个附件`);
        return;
      }
      const accepted = picked.slice(0, room);
      if (accepted.length < picked.length) {
        toast.error(`最多 ${MAX_ATTACHMENTS} 个附件，已忽略 ${picked.length - accepted.length} 个`);
      }
      setUploading((count) => count + accepted.length);
      try {
        const result = await api.chatUpload("task", taskId, accepted);
        const uploaded: ComposerAttachment[] = result.attachments.map((attachment) => ({
          ...attachment,
          localId: ++attachmentSeqRef.current,
        }));
        setAttachments((current) => [...current, ...uploaded].slice(0, MAX_ATTACHMENTS));
      } catch (uploadError) {
        toast.error(`附件上传失败：${(uploadError as Error).message}`);
      } finally {
        setUploading((count) => Math.max(0, count - accepted.length));
      }
    },
    [attachments.length, taskId],
  );

  // Document-level drag handling with a depth counter: dragenter/dragleave fire
  // for every child element, so a naive flag flickers while moving over the UI.
  React.useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragActive(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) void attachFiles(files);
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [attachFiles]);

  const controlTask = React.useCallback(
    async (action: "pause" | "resume") => {
      try {
        await api.controlTask(taskId, action);
        loadTask();
        toast.success(action === "pause" ? "已暂停探索" : "已恢复探索");
      } catch (controlError) {
        toast.error((controlError as Error).message);
      }
    },
    [loadTask, taskId],
  );

  // /new: start a clean main-agent segment and follow it. The graph, assets and
  // goal stay with the task — only the transcript/context resets.
  const startNewSession = React.useCallback(async () => {
    try {
      const result = await api.newMainSession(taskId);
      await loadSessions();
      setCurrentKey(mainLaneKey(result.seq));
      toast.success(`已新建主会话 · #${result.seq + 1}`);
    } catch (sessionError) {
      toast.error(`新建会话失败：${(sessionError as Error).message}`);
    }
  }, [loadSessions, taskId]);

  const send = React.useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    // The POST returns 202 immediately; the turn itself runs server-side and
    // streams back over SSE. `sending` therefore means "a turn is in flight",
    // not "the request is in flight" - it is cleared when this turn's `result`
    // frame arrives (see the effect below), when the user stops it, or on error.
    setTurnStartedAt(Date.now());
    turnStartSeqRef.current = activities.reduce((max, a) => (a.seq > max ? a.seq : max), 0);
    setSending(true);
    setCommandDismissed(false);
    // Optimistic human turn: replaced the moment the server's own activity echo
    // (SSE frame or history poll) carries the same text.
    const pendingUser: Activity = {
      seq: -1,
      worker: "mainagent",
      ts: new Date().toISOString(),
      kind: "user",
      summary: text,
    };
    setOptimistic([pendingUser]);
    // Own input always lands at the tail (the reference treats a submission as
    // superseding any reader sampling).
    jumpToBottom(true);
    try {
      const payload = attachments.map((item) => ({
        name: item.name,
        path: item.path,
        size: item.size,
        ...(item.abs ? { abs: item.abs } : {}),
      }));
      const response = await api.chat(
        text,
        taskId,
        payload.length > 0 ? payload : undefined,
        currentSeq,
        reasoningOverride || undefined,
      );
      setInput("");
      setAttachments([]);
      // Rule/mock turns answer in the body; LLM turns stream through SSE, so
      // only a body reply is echoed optimistically.
      if (response && typeof response.reply === "string" && response.reply.trim()) {
        setOptimistic([
          pendingUser,
          { seq: -2, worker: "mainagent", ts: new Date().toISOString(), kind: "text", summary: response.reply },
        ]);
      }
      void loadActivity(currentKey);
    } catch (sendError) {
      setOptimistic([]);
      toast.error(`发送失败：${(sendError as Error).message}`);
    } finally {
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [activities, attachments, currentKey, currentSeq, input, jumpToBottom, loadActivity, reasoningOverride, sending, taskId]);

  const stop = React.useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await api.stopChat(taskId);
      // The stop request cancels the turn server-side; reflect it immediately so
      // the composer returns to the send state without waiting for SSE.
      setSending(false);
    } catch (stopError) {
      toast.error((stopError as Error).message);
    } finally {
      setStopping(false);
    }
  }, [stopping, taskId]);


  // Grouped lane list: main-agent segments, the planner affordance, then workers
  // derived from exploration intents.
  const sessionOptions = React.useMemo<SessionOption[]>(() => {
    const main: SessionOption[] = (sessions.length > 0 ? sessions : [{ seq: 0, created_at: "" }]).map((session) => ({
      id: `main-${session.seq}`,
      key: mainLaneKey(session.seq),
      label: mainSessionLabel(session.seq),
      group: "mainagent",
      meta: sessionTime(session.created_at),
      live: mainLaneKey(session.seq) === currentKey,
    }));
    const planner: SessionOption = {
      id: "plan",
      key: "plan",
      label: "规划 Planner",
      group: "planner",
    };
    const workers: SessionOption[] = intents
      .filter((node) => node.state !== "deleted")
      .map((node) => ({
        id: `intent-${node.id}`,
        key: `intent:${node.id}`,
        label: intentTitle(node.payload, node.id),
        group: "worker" as const,
        meta: `#${node.id}`,
        live: node.state === "running",
      }));
    return [...main, planner, ...workers];
  }, [currentKey, intents, sessions]);

  const selectSession = React.useCallback((option: SessionOption) => {
    setCurrentKey(option.key);
  }, []);

  // Aside: keep the current conversation and open the child lane in the right
  // panel (reference: openChildAside). The lane rides the URL so a refresh or a
  // shared link restores the same side-by-side view.
  const openAside = React.useCallback(
    (option: SessionOption) => {
      const params = new URLSearchParams(window.location.search);
      params.set("id", taskId);
      params.set("aside", option.key);
      router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
      if (!rightOpen) toggleRight();
    },
    [rightOpen, router, taskId, toggleRight],
  );

  // ---- composer seats: model / reasoning / approval ----
  const modelGroups = React.useMemo(
    () => buildModelGroups(task, profiles, globalLLM),
    [globalLLM, profiles, task],
  );
  const activeProfile = React.useMemo(
    () => profiles.find((profile) => Number(profile.id) === task?.active_llm_profile_id) ?? null,
    [profiles, task?.active_llm_profile_id],
  );
  // The effort a turn will really run with: the task's profile first, then the
  // global config. Read-only here — the backend has no per-conversation field.
  const reasoningEffort = activeProfile?.reasoning_effort ?? globalLLM?.reasoning_effort;

  const selectModel = React.useCallback(
    async (option: ModelOption) => {
      const previous = task;
      const nextIds = option.kind === "global" ? [] : [option.profileId ?? 0];
      // Optimistic: the chip flips immediately; a rejected write rolls it back.
      setTask((current) =>
        current ? { ...current, llm_profile_ids: nextIds, active_llm_profile_id: nextIds[0] } : current,
      );
      setModelPending(true);
      try {
        const result = await api.updateTaskLLMProfiles(taskId, nextIds);
        setTask((current) =>
          current
            ? {
                ...current,
                llm_profile_ids: result.llm_profile_ids ?? nextIds,
                active_llm_profile_id: result.active_llm_profile_id,
              }
            : current,
        );
        toast.success(option.kind === "global" ? "已改为跟随全局模型" : `已切换模型：${option.label}`);
        loadTask();
        loadLLM();
      } catch (modelError) {
        setTask(previous); // roll the optimistic chain back
        toast.error(`切换模型失败：${(modelError as Error).message}`);
      } finally {
        setModelPending(false);
      }
    },
    [loadLLM, loadTask, task, taskId],
  );

  // ---- composer: slash commands ----
  const slashQuery = React.useMemo(() => {
    const match = /^\/([a-zA-Z0-9_-]*)$/.exec(input);
    return match ? match[1].toLowerCase() : null;
  }, [input]);

  const canControl = task !== null && !["done", "failed", "timeout"].includes(task.status);

  const commands = React.useMemo<CommandItem[]>(
    () => [
      {
        name: "/clear",
        title: "清空输入",
        hint: "清掉当前草稿，不影响会话",
        run: () => setInput(""),
      },
      {
        name: "/new",
        title: "新建主会话",
        hint: "开一段干净的上下文，图与资产保留",
        run: () => void startNewSession(),
      },
      {
        name: "/pause",
        title: "暂停任务",
        hint: "暂停 planner 与 worker",
        disabled: !canControl || Boolean(task?.paused),
        reason: canControl ? "任务已暂停" : "任务已结束，无法暂停",
        run: () => void controlTask("pause"),
      },
      {
        name: "/resume",
        title: "恢复任务",
        hint: "继续 planner 与 worker",
        disabled: !canControl || !task?.paused,
        reason: canControl ? "任务未暂停" : "任务已结束，无法恢复",
        run: () => void controlTask("resume"),
      },
      {
        name: "/stop",
        title: "停止当前回合",
        hint: "中断主 Agent 正在生成的回复",
        disabled: task?.status !== "running",
        reason: "当前没有正在进行的回合",
        run: () => void stop(),
      },
      {
        name: "/model",
        title: "切换模型",
        hint: "打开模型选择器",
        run: () => setModelOpenSignal((value) => value + 1),
      },
    ],
    [canControl, controlTask, startNewSession, stop, task?.paused, task?.status],
  );

  const commandMatches = React.useMemo(() => {
    if (slashQuery === null) return commands;
    return commands.filter((item) => item.name.slice(1).startsWith(slashQuery));
  }, [commands, slashQuery]);

  const commandsOpen = slashQuery !== null && !commandDismissed && !sending;

  // A new query re-arms the highlight at the top of the filtered list.
  React.useEffect(() => {
    if (!commandsOpen) return;
    setCommandIndex(0);
  }, [commandsOpen, slashQuery]);

  const runCommand = React.useCallback((item: CommandItem) => {
    setInput("");
    setCommandDismissed(false);
    setCommandIndex(0);
    if (item.disabled) {
      toast.info(item.reason ?? "当前不可用");
    } else {
      item.run();
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // keyCode 229 is the legacy IME-composition signal; a composing Enter picks
    // a candidate and must never send or run a command.
    const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (commandsOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (commandMatches.length === 0) return;
        setCommandIndex((index) => {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return (index + delta + commandMatches.length) % commandMatches.length;
        });
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !composing) {
        event.preventDefault();
        const item = commandMatches[Math.min(commandIndex, commandMatches.length - 1)];
        if (item) runCommand(item);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      if (event.repeat) return; // held-down Enter must not machine-gun sends
      void send();
    }
  };

  const onComposerChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    setCommandDismissed(false);
  };

  // The optimistic turn retires the moment the server echoes it back.
  React.useEffect(() => {
    if (optimistic.length === 0) return;
    const echoed = new Set(activities.filter((item) => item.kind === "user").map((item) => item.summary));
    if (optimistic.some((item) => item.kind === "user" && echoed.has(item.summary))) setOptimistic([]);
  }, [activities, optimistic]);

  // Live-feed state: SSE connected, or degraded to polling (mock/no EventSource).
  const feedState = live
    ? { label: "实时", tone: "live" as const, title: "SSE 实时连接正常" }
    : MOCK || typeof EventSource === "undefined"
      ? { label: "轮询", tone: "poll" as const, title: "mock/无 SSE 环境，使用 5s 轮询" }
      : { label: "重连中", tone: "retry" as const, title: "实时连接中断，正在自动重连并回退轮询" };

  const meta = statusMeta(task);
  const tokenTotal = task?.tokens ? task.tokens.input_tokens + task.tokens.output_tokens : 0;
  const pauseDisabled = !task || ["done", "failed", "timeout"].includes(task.status);
  let pauseTitle = "暂停探索";
  if (pauseDisabled) pauseTitle = "当前任务不可暂停";
  else if (task?.paused) pauseTitle = "恢复探索";

  return (
    <div className={styles.root} data-testid="task-workspace">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleZone}>
            <button type="button" className={styles.backButton} onClick={() => router.push("/function/tasks")} aria-label="返回任务列表" title="返回任务列表" data-action="back">
              <ArrowLeft size={15} aria-hidden="true" />
            </button>
            <h1 className={styles.title} title={task?.name || task?.description || taskId}>{task?.name?.trim() || task?.description || taskId}</h1>
            <span className={`${styles.status} ${meta.className}`}><span className={styles.statusDot} />{meta.label}</span>
          </div>
          <div className={styles.headerActions}>
            <SessionDropdown
              options={sessionOptions}
              currentKey={currentKey}
              onChange={selectSession}
              onAside={openAside}
            />
            <span
              className={styles.feedState}
              data-tone={feedState.tone}
              title={feedState.title}
              data-testid="feed-state"
            >
              <span className={styles.feedDot} aria-hidden="true" />
              {feedState.label}
            </span>
            <span className={styles.meta}>tokens {fmtTokens(tokenTotal)}</span>
            {/* No pause control here: stopping a turn belongs to the composer, and
                task-level pause/resume is available from the command palette. */}
            {!rightOpen ? (
              <button
                type="button"
                className={`${styles.action} ${styles.actionIcon}`}
                onClick={toggleRight}
                aria-label="打开右侧检查器"
                aria-expanded={rightOpen}
                title="右侧检查器 (Ctrl+Shift+B)"
                data-action="right-toggle"
                data-testid="task-right-toggle"
              >
                <PanelRight size={15} />
              </button>
            ) : null}
          </div>
        </div>
        <nav className={styles.tabs} aria-label="任务视图">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.tab} ${tab === item.key ? styles.tabActive : ""}`}
              onClick={() => setTab(item.key)}
              aria-current={tab === item.key ? "page" : undefined}
              data-action="tab"
              data-tab={item.key}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "chat" ? (
        <div className={styles.body}>
          <div className={styles.chatScroll} ref={scrollRef} onScroll={handleChatScroll} data-testid="chat-scroll">
            <div className={styles.chatColumn}>
              {hasOlder || loadingOlder || olderError ? (
                <div className={styles.loadOlder} data-testid="load-older">
                  {loadingOlder ? (
                    <span className={styles.loadOlderBusy}><Loader2 size={12} className={styles.spinner} aria-hidden="true" />加载更早历史…</span>
                  ) : olderError ? (
                    <button type="button" className={styles.loadOlderButton} onClick={() => void loadOlder()} data-action="load-older">{olderError} · 重试</button>
                  ) : (
                    <button type="button" className={styles.loadOlderButton} onClick={() => void loadOlder()} data-action="load-older">加载更早历史</button>
                  )}
                </div>
              ) : null}
              {loading && transcript.length === 0 ? (
                <div className={styles.stateRow} data-testid="chat-loading">
                  <Loader2 size={13} className={styles.spinner} aria-hidden="true" />
                  <span>加载会话…</span>
                </div>
              ) : null}
              {error ? (
                <div className={styles.stateError} data-testid="chat-error" role="alert">
                  <span className={styles.stateErrorTitle}>会话加载失败</span>
                  <span className={styles.stateErrorBody}>{error}</span>
                  <button
                    type="button"
                    className={styles.stateRetry}
                    onClick={() => loadActivity(currentKey)}
                    data-action="chat-retry"
                    data-testid="chat-retry"
                  >
                    重试
                  </button>
                </div>
              ) : null}
              {!loading && !error && transcript.length === 0 ? (
                <EmptyHero
                  onPick={(text) => {
                    setInput(text);
                    window.requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
              ) : null}
              {buildActivityNodes(transcript, taskId, streamingSeq, mainSegOf(currentKey), () => { void loadActivity(currentKey); })}
              {sending ? <RunningStatus startedAt={turnStartedAt} /> : null}
            </div>
          </div>

          {/* Turn rail (reference: TurnNavigator): one tick per turn, fixed 10px
              pitch, click to jump. Kept outside the scrollport so it never scrolls
              with the transcript. */}
          {turns.length > 1 ? (
            <div className={styles.turnRail} data-testid="turn-rail" role="navigation" aria-label="回合导航">
              <div className={styles.turnRailScroller}>
                {turns.map((turn) => (
                  <button
                    key={turn.index}
                    type="button"
                    className={styles.turnMark}
                    data-active={turn.index === activeTurn ? "true" : "false"}
                    aria-label={`跳到第 ${turn.index + 1} 回合`}
                    aria-current={turn.index === activeTurn ? "true" : undefined}
                    title={`第 ${turn.index + 1} 回合`}
                    onClick={() => scrollToTurn(turn.index)}
                    data-testid="turn-mark"
                  />
                ))}
              </div>
            </div>
          ) : null}
          {showJump ? (
            <button
              type="button"
              className={styles.jumpBottom}
              onClick={() => jumpToBottom()}
              aria-label="回到底部"
              title="回到底部"
              data-action="jump-bottom"
              data-testid="chat-jump-bottom"
            >
              <ArrowDown size={15} aria-hidden="true" />
            </button>
          ) : null}
          {readOnlyLane ? (
            <div className={styles.readOnlyComposer} role="status" data-testid="composer-readonly">
              <strong>{currentKey === "plan" ? "规划者会话（只读）" : "子会话（只读）"}</strong>
              <span>子会话由 agent 自动派发，不能直接输入；要下指令请回到「主 Agent」会话。</span>
            </div>
          ) : (
          <div className={styles.composerWrap}>
            <div className={`${styles.composer} ${sending ? styles.composerBusy : ""}`} data-testid="composer">
              {commandsOpen ? (
                <CommandMenu
                  items={commandMatches}
                  activeIndex={commandIndex}
                  onHover={setCommandIndex}
                  onRun={runCommand}
                />
              ) : null}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onComposerChange}
                onKeyDown={onComposerKeyDown}
                placeholder="给主 Agent 发消息，输入 / 打开命令…"
                aria-label="给主 Agent 发消息"
                aria-haspopup="listbox"
                aria-expanded={commandsOpen}
                aria-controls={commandsOpen ? "composer-command-list" : undefined}
                rows={1}
                data-testid="composer-textarea"
              />
              {attachments.length > 0 || uploading > 0 ? (
                <div className={styles.attachmentRow} data-testid="composer-attachments">
                  {attachments.map((attachment) => (
                    <span
                      className={styles.attachmentCard}
                      key={attachment.localId}
                      title={attachment.path}
                      data-testid="composer-attachment"
                      data-path={attachment.path}
                    >
                      <span className={styles.attachmentGlyph} aria-hidden="true">
                        {attachmentGlyph(attachment.name)}
                      </span>
                      <span className={styles.attachmentCopy}>
                        <span className={styles.attachmentName}>{attachment.name}</span>
                        <span className={styles.attachmentMeta}>{formatBytes(attachment.size)}</span>
                      </span>
                      <button
                        type="button"
                        className={styles.attachmentRemove}
                        aria-label={`移除附件 ${attachment.name}`}
                        title={`移除附件 · ${attachment.path}`}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((item) => item.localId !== attachment.localId),
                          )
                        }
                        data-action="attachment-remove"
                      >
                        <X size={11} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  {uploading > 0 ? (
                    <span
                      className={styles.attachmentCard}
                      data-uploading="true"
                      data-testid="composer-attachment-uploading"
                    >
                      <span className={styles.attachmentGlyph} aria-hidden="true">
                        <Loader2 size={12} className={styles.spinner} />
                      </span>
                      <span className={styles.attachmentCopy}>
                        <span className={styles.attachmentName}>上传中…</span>
                        <span className={styles.attachmentMeta}>{uploading} 个文件</span>
                      </span>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className={styles.composerBar}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className={styles.fileInput}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    void attachFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className={styles.attach}
                  title="添加附件（上传到任务工作目录）"
                  aria-label="添加附件"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading > 0}
                  data-action="attach"
                  data-testid="composer-attach"
                >
                  <Paperclip size={14} aria-hidden="true" />
                </button>
                <ModelSelect
                  groups={modelGroups}
                  pending={modelPending}
                  openSignal={modelOpenSignal}
                  onRefresh={loadLLM}
                  onSelect={(option) => void selectModel(option)}
                  effort={reasoningOverride}
                  inheritedEffort={reasoningEffort}
                  onEffortChange={setReasoningOverride}
                />
                <span
                  className={`${styles.chipWrap} ${styles.chipWrapApproval}`}
                  data-testid="composer-approval-wrap"
                >
                  <button
                    type="button"
                    className={styles.chipButton}
                    aria-haspopup="dialog"
                    aria-expanded={approvalOpen}
                    aria-label={`审批模式：${APPROVAL_CHIP_TITLE}`}
                    title={APPROVAL_CHIP_TITLE}
                    onClick={() => setApprovalOpen(true)}
                    data-action="approval-open"
                    data-testid="composer-approval-chip"
                  >
                    <span className={styles.chipLabel}>审批：本任务规则</span>
                  </button>
                </span>
                <span className={styles.composerMeta} title="本任务累计 token">
                  tokens {fmtTokens(tokenTotal)}
                </span>
                <span className={styles.composerGrow} />
                {/* One slot, two states: while a turn runs the send control becomes
                    the stop control. A separate always-visible stop square read as a
                    stray icon and was easy to miss; this is the pattern the
                    reference harness uses. */}
                {sending ? (
                  <button
                    type="button"
                    className={styles.stop}
                    onClick={() => void stop()}
                    disabled={stopping}
                    aria-label="停止本轮"
                    aria-busy={stopping}
                    title="停止本轮"
                    data-action="stop"
                    data-testid="composer-stop"
                  >
                    {stopping ? <Loader2 size={13} className={styles.spinner} aria-hidden="true" /> : <Square size={11} fill="currentColor" aria-hidden="true" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.send}
                    onClick={() => void send()}
                    disabled={!input.trim() || uploading > 0}
                    aria-label="发送消息"
                    title="发送 (Enter)"
                    data-action="send"
                    data-testid="composer-send"
                  >
                    <Send size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      ) : null}

      {tab === "trajectory" ? (
        <div className={styles.panel}>
          <div className={styles.chatColumn}>
            {activities.map((activity) => (
              <div className={styles.reasoning} key={activity.seq}>
                <span style={{ fontFamily: "var(--ax-font-family-code)", marginRight: 8 }}>{activity.seq}</span>
                {activity.worker} · {activity.kind} · {activity.summary}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "team" ? <div className={styles.panel}><TeamTab taskId={taskId} /></div> : null}
      {tab === "graph" ? <div className={styles.panel}><GraphTab taskId={taskId} /></div> : null}
      {tab === "findings" ? <div className={styles.panel}><FindingsTab taskId={taskId} /></div> : null}
      {tab === "report" ? <div className={styles.panel}><ReportTab taskId={taskId} /></div> : null}

      {/* Task-level approval rules were only reachable from the legacy detail page.
          Surfacing the existing records component here makes the composer approval
          chip an entry point instead of a dead end. */}
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent className="max-h-[80vh] w-[92vw] max-w-[760px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>审批与拦截</DialogTitle>
            <DialogDescription>
              审批由拦截规则决定：命中规则的工具调用会在这里排队等待人工决定。本任务可单独开关规则；全局规则在「设置 → 拦截规则」。
            </DialogDescription>
          </DialogHeader>
          <ApprovalRecords taskId={taskId} />
        </DialogContent>
      </Dialog>

      {/* Whole-document drop target: the reference composer shows an overlay while
          files are dragged anywhere over the app, not just over the paperclip. */}
      {dragActive ? (
        <div className={styles.dropOverlay} data-testid="composer-drop-overlay">
          <div className={styles.dropOverlayCard}>
            <Paperclip size={18} aria-hidden="true" />
            <span>松开即可添加附件</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
