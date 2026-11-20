"use client";

/**
 * 输入区 `@` 引用的候选适配器：工作区真实文件 + 会话记录候选。
 * 旧页面依据：ARTEX/web/src/components/mention-textarea.tsx:233-320（按 `@` 查询记录，
 *   下拉有候选/加载中/失败/空四态，选中后插入记号）；同一组件在
 *   app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1944,2010 两处输入区挂载。
 * 接口：api.ts:530 workspaceList（GET /workspace/list?path=）读真实工作区；
 *   api.ts:979 chatMentions（GET /chat/mentions?kind=&q=）读记录候选（漏洞/资产/企业/接口/IP/应用/域名/子域名/服务）。
 * DSH 无，按输入区扩展（DSH 的 `ui-input-trigger` 只有触发与菜单，没有文件补全数据源）。
 * 对照表行：P1:B19
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { ChatMention } from "@/lib/chat-mentions";
import type { WorkspaceEntry } from "@/lib/types";

/** 输入区 `@` 下拉的一行。 */
export interface FileMentionCandidate {
  /** 唯一 id：工作区文件是路径，记录候选是 `kind#id`。 */
  readonly id: string;
  /** 插入草稿的记号正文（不含 `@` 与尾随空格）。 */
  readonly token: string;
  /** 右侧说明（目录/大小/记录描述）。 */
  readonly hint: string;
  /** 记录候选的种类标签（漏洞/资产/…）；工作区文件为 undefined。 */
  readonly kindLabel?: string;
}

export type FileMentionPhase = "idle" | "loading" | "ready" | "empty" | "offline";

export interface FileMentionState {
  readonly phase: FileMentionPhase;
  readonly candidates: readonly FileMentionCandidate[];
  readonly error: string | null;
  /** 记录候选还有下一页时的游标；空串表示已到底。 */
  readonly nextCursor: string;
  /** 停在「加载中」超过这个毫秒数就提示可换关键词重试；0 表示未超时。 */
  readonly stallMs: number;
  /** 失败后重新读取。 */
  readonly reload: () => void;
}

/** 记录候选的种类与中文标签（与旧页 `lib/chat-mentions.ts:1-11` 同表）。 */
const MENTION_KINDS: ReadonlyArray<{ readonly kind: string; readonly label: string }> = [
  { kind: "finding", label: "漏洞" },
  { kind: "asset", label: "资产" },
  { kind: "company", label: "企业" },
  { kind: "endpoint", label: "接口" },
  { kind: "ip", label: "IP" },
  { kind: "app", label: "应用" },
  { kind: "root_domain", label: "域名" },
  { kind: "subdomain", label: "子域名" },
  { kind: "service", label: "服务" },
];

/** 工作区一次最多列多少目录项，避免超大目录把下拉撑爆。 */
const MAX_WORKSPACE_ROWS = 200;

/** 文件大小的人读形式（与工作区文件列表同一口的短格式）。 */
function sizeHint(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 工作区目录项 → 下拉候选。
 * @param entries - `/workspace/list` 返回的目录项。
 * @param query - `@` 后面的过滤词（大小写不敏感，匹配路径）。
 * @returns 候选；目录排在文件前面，最多 `MAX_WORKSPACE_ROWS` 条。
 */
function workspaceCandidates(entries: readonly WorkspaceEntry[], query: string): FileMentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const matched = entries
    .filter((entry) => needle === "" || entry.path.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path))
    .slice(0, MAX_WORKSPACE_ROWS);
  return matched.map((entry) => ({
    id: entry.path,
    token: entry.path,
    hint: entry.dir ? "目录" : sizeHint(entry.size),
  }));
}

/**
 * 记录候选 → 下拉候选（旧页 `lib/chat-mentions.ts:45-52` 的记号格式）。
 * @param items - `/chat/mentions` 返回的记录。
 * @returns 候选；插入正文用 `[标签#id 名称]` 形式，和工作区的 `@路径` 分开。
 */
function recordCandidates(items: readonly ChatMention[]): FileMentionCandidate[] {
  return items.map((item) => {
    const kindLabel = MENTION_KINDS.find((entry) => entry.kind === item.kind)?.label ?? item.kind;
    return {
      id: `${item.kind}#${item.id}`,
      token: `[${kindLabel}#${item.id} ${item.label.replace(/[[\]]/g, "")}]`,
      hint: item.description,
      kindLabel,
    };
  });
}

/** 先查哪一种记录：`@漏洞 xxx` 这类显式种类前缀直接切到该种类。 */
function explicitKind(query: string): { kind: string; rest: string } | null {
  const text = query.trimStart();
  for (const entry of MENTION_KINDS) {
    if (text === entry.label || text.startsWith(`${entry.label} `)) {
      return { kind: entry.kind, rest: text.slice(entry.label.length).trim() };
    }
    if (text.toLowerCase().startsWith(`${entry.kind} `)) {
      return { kind: entry.kind, rest: text.slice(entry.kind.length).trim() };
    }
  }
  return null;
}

/**
 * `@` 下拉的数据源：有过滤词时同时查工作区与记录候选，没过滤词时只列工作区。
 *
 * 四态：`loading`（请求在飞）、`ready`（有候选）、`empty`（两边都返回空）、
 * `offline`（至少一路失败且另一路也没候选时才算失败，`error` 写清哪一路）。
 *
 * @param query - `@` 后面的过滤词；null 表示下拉未打开。
 * @param enabled - 下拉是否打开（关闭时不请求）。
 * @returns 阶段、候选、错误、游标、停滞时长与重新读取。
 */
export function useFileMentions(query: string | null, enabled: boolean): FileMentionState {
  const [phase, setPhase] = useState<FileMentionPhase>("idle");
  const [candidates, setCandidates] = useState<readonly FileMentionCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState("");
  const [stallMs, setStallMs] = useState(0);
  const [tick, setTick] = useState(0);
  const stampRef = useRef(0);
  const needle = query ?? "";
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setPhase("idle");
      setCandidates([]);
      setError(null);
      setNextCursor("");
      setStallMs(0);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    const started = Date.now();
    stampRef.current = started;
    setPhase("loading");
    setError(null);
    setStallMs(0);

    const explicit = explicitKind(needle);
    const recordKind = explicit?.kind ?? "asset";
    const recordQuery = explicit === null ? needle.trim() : explicit.rest;
    const wantRecords = needle.trim() !== "";

    const workspaceRequest = api.workspaceList("").then(
      (value) => ({ ok: true as const, entries: value.entries ?? [] }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    const recordsRequest = wantRecords
      ? api.chatMentions(recordKind, recordQuery, controller.signal).then(
          (value) => ({ ok: true as const, items: value.items ?? [], cursor: value.next_cursor ?? "" }),
          (reason: unknown) => ({ ok: false as const, reason }),
        )
      : Promise.resolve({ ok: true as const, items: [] as ChatMention[], cursor: "" });

    Promise.all([workspaceRequest, recordsRequest])
      .then(([workspace, records]) => {
        if (!alive) return;
        const files = workspace.ok ? workspaceCandidates(workspace.entries, needle) : [];
        const recs = records.ok ? recordCandidates(records.items) : [];
        const merged = [...files, ...recs];
        setCandidates(merged);
        setNextCursor(records.ok ? records.cursor : "");
        if (merged.length > 0) {
          // 两路都失败、或失败那一路恰好是唯一有候选的通道时才报错；
          // 另一路有真实候选就照常可用（旧页只在一路数据源上，不存在这种并存）。
          const workspaceLost = !workspace.ok;
          const recordsLost = !records.ok;
          setError(
            workspaceLost && recordsLost
              ? `${workspace.ok ? "记录候选读取失败" : "工作区文件读取失败"}：${String(
                  !workspace.ok && workspace.reason instanceof Error
                    ? workspace.reason.message
                    : !records.ok && records.reason instanceof Error
                      ? records.reason.message
                      : "",
                )}`
              : null,
          );
          setPhase("ready");
          return;
        }
        if (workspace.ok && records.ok) {
          setPhase("empty");
          return;
        }
        const why = !workspace.ok
          ? `工作区文件读取失败：${workspace.reason instanceof Error ? workspace.reason.message : String(workspace.reason)}`
          : !records.ok
            ? `记录候选读取失败：${records.reason instanceof Error ? records.reason.message : String(records.reason)}`
            : "没有候选";
        setError(why);
        setPhase("offline");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setCandidates([]);
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });

    // 停滞提示：请求迟迟不回来时页面至少说明「还在等」，不伪造进度。
    const stallTimer = setInterval(() => {
      if (!alive || stampRef.current !== started) return;
      setStallMs(Date.now() - started);
    }, 1000);

    return () => {
      alive = false;
      controller.abort();
      clearInterval(stallTimer);
    };
  }, [needle, enabled, tick]);

  return { phase, candidates, error, nextCursor, stallMs, reload };
}

