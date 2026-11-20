"use client";

/**
 * 旁路问题（/btw）适配器：给正在运行的会话提一条不打断它的追问。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/sessions-tab.tsx:1262-1268
 *   （主 Agent 车道 → `/api/tasks/{taskId}/chat`；正在运行的 worker 车道 → `/api/tasks/{taskId}/intents/{intentId}`）、
 *   :1494-1527（`/btw` 先被 handleCommand 接管，再按车道分流发送）；
 *   ARTEX/web/src/lib/side-questions.ts:43-64（转发用的函数与 `isBtwCommand`）、
 *   ARTEX/web/src/hooks/use-side-questions.ts:25-192（历史、提问、清除、取消的语义）。
 * 接口：api.ts:404 sendWorkerMessage（POST /tasks/{taskId}/intents/{intentId}/messages；
 *   后端只按 request_id 去重，不解析 `/btw` 前缀）；主 Agent 旁路问题走 api.chat（api.ts:984）。
 * DSH 无，按输入区扩展（DSH 的 `ui-conversation` 输入 facade 没有旁路提问通道）。
 * 对照表行：P1:D12
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { http } from "@/lib/api";
import { isBtwCommand } from "@/lib/side-questions";
import { sendChat } from "@/v2/data/chat-send";
import { sendWorkerMessage } from "@/v2/data/intents";

/**
 * 旁路问题的提问通道。
 *
 * - `main`：主 Agent 车道（旧页 `/api/tasks/{id}/chat`），用普通 chat 端口。
 * - `worker:<意图 id>`：正在运行的 worker 车道（旧页 `/api/tasks/{id}/intents/{intentId}`），
 *   用 worker 消息端口。
 */
export type SideQuestionChannel = "main" | `worker:${string}`;

/** 历史里一条旁路问答（后端 SideExchange 的字段，只取展示需要的）。 */
export interface SideExchange {
  readonly id: string;
  readonly ordinal: number;
  readonly question: string;
  readonly answer: string;
  readonly status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  readonly error?: string;
  readonly created_at: string;
  readonly model?: { readonly model: string; readonly name: string; readonly profile_id: number };
}

/** 历史接口的返回（新模型漏字段时按空处理，不抛）。 */
export interface SideHistory {
  readonly items: readonly SideExchange[];
  readonly current: SideExchange | null;
  readonly next_cursor: number;
}

export type SideHistoryPhase = "loading" | "ready" | "offline";

export interface SideHistoryState {
  readonly phase: SideHistoryPhase;
  readonly items: readonly SideExchange[];
  readonly error: string | null;
  /** 重新读取。 */
  readonly reload: () => void;
}

/**
 * 旧页 `hooks/use-side-questions.ts:79-118` 里的父路径换算。
 * @param taskId - 当前任务 id；null 时没有通道。
 * @param channel - 提问通道；null 表示这一车道不支持旁路提问。
 * @returns 后端历史路径；没有通道时为 null。
 */
function historyPath(taskId: string | null, channel: SideQuestionChannel | null): string | null {
  if (taskId === null || channel === null) return null;
  return channel === "main"
    ? `/tasks/${taskId}/chat/side-questions`
    : `/tasks/${taskId}/intents/${channel.slice("worker:".length)}/side-questions`;
}

/**
 * 读取当前车道的旁路问题历史。
 * @param taskId - 当前任务 id；null 时不请求。
 * @param channel - 提问通道；null 时不请求。
 * @returns 阶段、历史、错误与重新读取。
 */
export function useSideHistory(taskId: string | null, channel: SideQuestionChannel | null): SideHistoryState {
  const [phase, setPhase] = useState<SideHistoryPhase>("loading");
  const [items, setItems] = useState<readonly SideExchange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const path = historyPath(taskId, channel);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    http<{ items?: SideExchange[]; current?: SideExchange | null; next_cursor?: number }>(path, { method: "GET" })
      .then((value) => {
        if (!alive) return;
        setItems(Array.isArray(value.items) ? value.items : []);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, error, reload };
}

/**
 * 发送一条旁路问题。
 *
 * 转发规则与旧页一致：用户只要在提交时带上 `/btw` 前缀（`lib/side-questions.ts:62`），
 * 输入区就把它转成一条不打断会话的追问；后端自己不解析这个前缀，所以 worker 通道下
 * 正文原样保留（旧页 `hooks/use-side-questions.ts:184` 只把前缀当作触发词，不做改写）。
 *
 * @param taskId - 当前任务 id。
 * @param channel - 提问通道。
 * @param question - 已去掉 `/btw` 前缀的正文。
 * @param requestId - 去重用的客户端请求 id（同一问题重试时复用）。
 * @returns 后端受理结果；worker 通道返回受理记录，主通道返回 mode。
 */
export async function askSideQuestion(
  taskId: string,
  channel: SideQuestionChannel,
  question: string,
  requestId: string,
): Promise<{ mode: string }> {
  const text = question.trim();
  if (text === "") throw new Error("旁路问题不能为空");
  if (channel === "main") {
    const result = await sendChat(`/btw ${text}`, taskId);
    return { mode: result.mode };
  }
  await sendWorkerMessage(taskId, channel.slice("worker:".length), text, requestId);
  return { mode: "llm" };
}

/**
 * 是否以 `/btw` 开头（转发旧页 `isBtwCommand`，避免组件里再写一份判断）。
 * @param text - 输入区草稿。
 * @returns 是旁路问题命令时为 true。
 */
export function isSideQuestionCommand(text: string): boolean {
  return isBtwCommand(text);
}

/**
 * 哪些 worker 意图可以接收旁路问题。
 *
 * 后端 `intent_intervention.go:118-121` 只接受 `state == "paused"` 的意图
 * （「仅已暂停的 Worker 可以发送消息，请先暂停」），运行中的 worker 会得到 409；
 * 旧页 `sessions-tab.tsx:2007` 也只在 paused 车道露出 worker 输入框。因此这里只把
 * 「已暂停且未继承」的意图当作可提问目标。
 *
 * @param intent - 意图节点的类型与状态。
 * @returns 可以发送时为 true。
 */
export function canReceiveWorkerQuestion(intent: { readonly type: string; readonly state: string; readonly inherited?: boolean }): boolean {
  return intent.type === "intent" && intent.state === "paused" && intent.inherited !== true;
}

/**
 * 去掉 `/btw` 前缀后的正文。
 * @param text - 输入区草稿。
 * @returns 正文；没有前缀时返回原文（已 trim）。
 */
export function sideQuestionBody(text: string): string {
  const trimmed = text.trim();
  return isBtwCommand(trimmed) ? trimmed.slice(4).trim() : trimmed;
}

/**
 * 去重用的客户端请求 id：安全上下文用 `crypto.randomUUID`，经 IP+http 访问时降级
 * （旧页 `hooks/use-side-questions.ts:11-15` 的同一条降级路径）。
 * @returns 请求 id。
 */
export function newSideRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `btw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  );
}

/**
 * 打开某个任务的旁路问题历史（清除/取消也走这里）。历史一旦读过就留着，供输入区的
 * 旁路面板显示真实状态；失败时返回后端错误文本。
 * @param taskId - 任务 id。
 * @param channel - 提问通道。
 * @param action - `clear` 清空历史；`cancel` 取消正在跑的问答。
 * @param exchangeId - cancel 时要取消的那条问答 id。
 * @returns 成功后返回 null，失败返回错误文本。
 */
export async function mutateSideQuestions(
  taskId: string,
  channel: SideQuestionChannel,
  action: "clear" | "cancel",
  exchangeId?: string,
): Promise<string | null> {
  const path = historyPath(taskId, channel);
  if (path === null) return "当前车道不支持旁路问题";
  try {
    if (action === "clear") {
      await http(path, { method: "DELETE" });
      return null;
    }
    if (exchangeId === undefined) return "没有正在运行的旁路问题";
    await http(`/side-questions/${exchangeId}/cancel`, { method: "POST" });
    return null;
  } catch (reason: unknown) {
    return reason instanceof Error ? reason.message : String(reason);
  }
}

/** 输入区里那条「正在运行的旁路问答」的本地视图。 */
export interface SideRunState {
  /** 上一次提问是否还在飞（提交中，用于锁按钮）。 */
  readonly submitting: boolean;
  /** 最近一次失败的文本；成功后清空。 */
  readonly error: string | null;
}

/**
 * 输入区的旁路问题状态机：提交、失败留稿、当前运行中的问答。
 *
 * 只做转发与本地状态；成功/失败提示由组件用 `toast` 呈现（失败文本同时留在 `error`，
 * 因为独立路由里没有 toast）。
 *
 * @param taskId - 当前任务 id；null 时不可发送。
 * @param channel - 提问通道；null 时不可发送。
 * @param onSubmitted - 发送成功后的回调，用于让历史重新拉取。
 * @returns 状态与动作。
 */
export function useSideQuestionSubmit(
  taskId: string | null,
  channel: SideQuestionChannel | null,
  onSubmitted: () => void,
): SideRunState & {
  /** 提交一条已去掉 `/btw` 前缀的正文。 */
  readonly ask: (question: string) => Promise<boolean>;
} {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<{ readonly question: string; readonly requestId: string } | null>(null);
  const submittedRef = useRef(onSubmitted);
  submittedRef.current = onSubmitted;

  const ask = useCallback(
    async (question: string): Promise<boolean> => {
      const text = question.trim();
      if (taskId === null || channel === null || text === "") return false;
      if (pendingRef.current === null || pendingRef.current.question !== text) {
        pendingRef.current = { question: text, requestId: newSideRequestId() };
      }
      setSubmitting(true);
      setError(null);
      try {
        await askSideQuestion(taskId, channel, text, pendingRef.current.requestId);
        pendingRef.current = null;
        submittedRef.current();
        return true;
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [taskId, channel],
  );

  return { submitting, error, ask };
}
