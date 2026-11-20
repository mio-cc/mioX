"use client";

/**
 * Agent 对话整页（主区整页「Agent 对话」）的适配器：对话列表读取与增删改，
 * 以及右侧消息区（B08）的历史 / 增量读取、发送、停止、对话级模型。
 * 旧页面依据：ARTEX/web/src/app/(main)/chat/page.tsx:1108-1123（列表 2 秒轮询）、
 * :1255-1346（删除 / 批量删除 / 置顶 / 重命名）、:99（置顶判定）、:115-132（按 Agent 分组）；
 * 消息区照旧页 :542-571（打开对话只取最新一页 history）、:580-608（运行中增量轮询）、
 * :628-652（向上翻页保留视口）、:712-723（附件上传到 session conv-<id>）、
 * :725-745（发送）、:750-760（停止）、:516-523（切换对话级 LLM）。
 * DSH 依据：DSH 无独立 Agent 对话页，按「主区整页」扩展（总表 §4.1、§4）。
 * 对照表行：P1:D1 P1:D2 P1:D3 P1:D4 P1:D5 P1:D6 P1:D7 P1:D8 P1:D9 P1:D10 P1:D11
 *
 * 接口：api.ts:1129 conversations（GET /conversations）、:1130 createConversation、
 * :1134 renameConversation、:1135 pinConversation、:1136 updateConversationProfile、
 * :1138 deleteConversation、:1139 deleteConversations（POST /conversations/delete/batch）、
 * :1142 conversationMessages（增量 since）、:1148 conversationHistory（倒序翻页）、
 * :1155 conversationMsgDetail、:1157 sendConversationMessage、:1159 stopConversation、
 * :994 chatUpload（scope="session"、id=conv-<id>）。
 * 类型：types.ts:810 Conversation（id / agent_key / title / created_at / updated_at /
 * pinned? / pinned_at? / running? / llm_profile_id?；没有未读字段）、
 * types.ts:692 Activity（seq / ts / kind / summary / detail? …）、types.ts:685 ChatAttachment。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { mergeActivities } from "@/lib/activity-merge";
import { api } from "@/lib/api";
import type { Activity, ChatAttachment, Conversation } from "@/lib/types";

/** 列表轮询间隔，照旧页 chat/page.tsx:1115 的 2 秒（只为同步别处产生的运行状态）。 */
export const CONVERSATION_POLL_MS = 2000;

/** 一屏渲染多少行，照旧页 chat/page.tsx:92 CONVERSATION_LIST_PAGE，「显示更多」每次再加这么多。 */
export const CONVERSATION_LIST_PAGE = 100;

/** 批量删除一次提交的 id 上限，照旧页 chat/page.tsx:1281 的 100 个一批。 */
export const CONVERSATION_DELETE_BATCH = 100;

export type ConversationsPhase = "loading" | "ready" | "offline";

export interface ConversationsState {
  phase: ConversationsPhase;
  conversations: Conversation[];
  error: string | null;
  reload: () => void;
}

/**
 * 是否置顶：pinned 优先，其次看 pinned_at（照旧页 chat/page.tsx:99）。
 * @param conversation - 一行对话。
 * @returns 置顶为 true。
 */
export function conversationIsPinned(conversation: Conversation): boolean {
  return conversation.pinned ?? Boolean(conversation.pinned_at);
}

/**
 * 读对话列表，并按旧页的节奏轮询。
 *
 * 首次读取的结果决定四种状态；之后的轮询失败保留上一次的记录（旧页
 * chat/page.tsx:1089-1091 同样在瞬时失败时保留列表），避免整页闪成错误态。
 * @param pollMs - 轮询间隔；传 0 关闭轮询。
 * @returns 阶段、记录、错误与手动重新读取。
 */
export function useConversations(pollMs: number = CONVERSATION_POLL_MS): ConversationsState {
  const [phase, setPhase] = useState<ConversationsPhase>("loading");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // 序号防止慢请求覆盖新结果（旧页 chat/page.tsx:1083-1092 的 conversationListSeq）。
  const seqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setPhase("loading");
    setError(null);

    const load = (): void => {
      const seq = ++seqRef.current;
      api
        .conversations()
        .then((value) => {
          if (!alive || seq !== seqRef.current) return;
          setConversations(value);
          setPhase("ready");
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!alive || seq !== seqRef.current) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          // 已经有记录时保留它们，只把失败留在 error 里；一次都没成过才判离线。
          setPhase((current) => (current === "ready" ? "ready" : "offline"));
        })
        .finally(() => {
          if (!alive || pollMs <= 0) return;
          timer = setTimeout(load, pollMs);
        });
    };

    load();
    return () => {
      alive = false;
      seqRef.current++;
      if (timer !== null) clearTimeout(timer);
    };
  }, [tick, pollMs]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, conversations, error, reload };
}

/**
 * 新建对话（旧页 chat/page.tsx:412 的同名调用，B07 把它放在「新建对话」弹窗里）。
 * @param agentKey - Agent 的 key。
 * @param title - 标题；空串表示交给后端默认。
 * @returns 后端返回的新对话；失败时抛出带后端信息的 Error。
 */
export function createConversation(agentKey: string, title: string): Promise<Conversation> {
  return api.createConversation(agentKey, title);
}

/**
 * 重命名（旧页 chat/page.tsx:1338）。
 * @param id - 对话 id。
 * @param title - 新标题；调用方负责先 trim 并拒绝空串。
 * @returns 后端回显的对话。
 */
export function renameConversation(id: number, title: string): Promise<Conversation> {
  return api.renameConversation(id, title);
}

/**
 * 置顶 / 取消置顶（旧页 chat/page.tsx:1319）。
 * @param id - 对话 id。
 * @param pinned - 目标状态。
 * @returns 后端回显的对话。
 */
export function pinConversation(id: number, pinned: boolean): Promise<Conversation> {
  return api.pinConversation(id, pinned);
}

/**
 * 删除一个对话（旧页 chat/page.tsx:1258）。
 * @param id - 对话 id。
 * @returns 后端报告删除的条数。
 */
export function deleteConversation(id: number): Promise<{ deleted: number }> {
  return api.deleteConversation(id);
}

/** 一条批量删除的结果：成功的 id 与失败的 id + 后端原因。 */
export interface ConversationDeleteOutcome {
  deleted: number[];
  failed: { id: number; error: string }[];
}

/**
 * 批量删除，按 100 个一批提交（照旧页 chat/page.tsx:1281-1287）。
 * 单条失败不影响其他条：结果逐条返回，调用方据此保留失败项。
 * @param ids - 要删除的对话 id。
 * @returns 成功的 id 列表与失败明细。
 */
export async function deleteConversations(ids: number[]): Promise<ConversationDeleteOutcome> {
  const deleted: number[] = [];
  const failed: { id: number; error: string }[] = [];
  for (let offset = 0; offset < ids.length; offset += CONVERSATION_DELETE_BATCH) {
    const result = await api.deleteConversations(ids.slice(offset, offset + CONVERSATION_DELETE_BATCH));
    for (const item of result.items) {
      if (item.ok) deleted.push(item.id);
      else failed.push({ id: item.id, error: item.error ?? "对话不存在" });
    }
  }
  return { deleted, failed };
}

// ---------------------------------------------------------------------------
// B08 · 消息区（P1:D6–D11）。以下全部为新增导出，上面的导出保持不变。
// ---------------------------------------------------------------------------

/** 消息增量轮询间隔，照卡片「每 2 秒」与旧页 chat/page.tsx:600 的量级（旧页 1 秒，本页 2 秒）。 */
export const CONVERSATION_MESSAGE_POLL_MS = 2000;

/** 打开对话时取的最新一代页大小，照旧页 chat/page.tsx:552 的 HISTORY_PAGE。 */
export const CONVERSATION_HISTORY_PAGE = 200;

/** 一次选文件的上限：旧页 chat/page.tsx:413 的 pickFiles 不限个数，这里与 v2 作曲器一致取 6。 */
export const CONVERSATION_ATTACHMENT_LIMIT = 6;

export type ConversationMessagesPhase = "loading" | "ready" | "offline";

export interface ConversationMessagesState {
  /** 首次读取（最新一页）的阶段；轮询失败不会把它打回 loading。 */
  phase: ConversationMessagesPhase;
  /** 当前已加载的消息，按 seq 升序；历史页与增量页按 seq 去重合并。 */
  messages: Activity[];
  /** 后端报告的运行状态；为 true 时才继续增量轮询。 */
  running: boolean;
  /** 上方是否还有更早的消息。 */
  hasMore: boolean;
  /** 正在加载更早一页。 */
  loadingMore: boolean;
  /** 首次读取失败的原因。 */
  error: string | null;
  /** 加载更早一页失败的原因。 */
  olderError: string | null;
  /** 重新读取（从最新一页重来）。 */
  reload: () => void;
  /** 向上加载一页更早的消息。 */
  loadOlder: () => void;
  /** 发送成功后立刻开始轮询（旧页 chat/page.tsx:737 的 setRunning(true)）。 */
  startPolling: () => void;
  /** 停止后立刻再读一次，让停止结果尽快落地。 */
  refreshNow: () => void;
}

/**
 * 读一个对话的消息：先取最新一页（旧页 chat/page.tsx:552），
 * 只有在后端报告 running 时才按 2 秒增量轮询 `since=cursor`（旧页 :580-608）。
 * @param conversationId - 对话 id；null 时不请求。
 * @returns 消息、运行状态、翻页状态与动作。
 */
export function useConversationMessages(conversationId: number | null): ConversationMessagesState {
  const [phase, setPhase] = useState<ConversationMessagesPhase>("loading");
  const [messages, setMessages] = useState<Activity[]>([]);
  const [running, setRunning] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /** 最新已加载的 seq —— 增量轮询的锚点（旧页 cursorRef）。 */
  const cursorRef = useRef(0);
  /** 最早已加载的 seq —— 向上翻页的锚点（旧页 earliestRef）。 */
  const earliestRef = useRef(0);
  /** 是否还有更早的消息；轮询回调里要读最新值，所以同时放在 ref 与 state。 */
  const hasMoreRef = useRef(false);
  /** 同一时刻只翻一页（旧页 loadingMoreRef）。 */
  const loadingMoreRef = useRef(false);
  /** 切换对话或在翻页时丢弃过期响应。 */
  const idRef = useRef<number | null>(conversationId);
  idRef.current = conversationId;

  useEffect(() => {
    if (conversationId === null) {
      cursorRef.current = 0;
      earliestRef.current = 0;
      hasMoreRef.current = false;
      setPhase("ready");
      setMessages([]);
      setRunning(false);
      setHasMore(false);
      setLoadingMore(false);
      setError(null);
      setOlderError(null);
      return;
    }
    let alive = true;
    cursorRef.current = 0;
    earliestRef.current = 0;
    hasMoreRef.current = false;
    loadingMoreRef.current = false;
    setPhase("loading");
    setMessages([]);
    setRunning(false);
    setHasMore(false);
    setLoadingMore(false);
    setError(null);
    setOlderError(null);
    api
      .conversationHistory(conversationId, 0, CONVERSATION_HISTORY_PAGE)
      .then((page) => {
        if (!alive) return;
        setMessages((current) => mergeActivities(current, page.items));
        cursorRef.current = Math.max(cursorRef.current, page.cursor);
        earliestRef.current = page.items.length > 0 ? page.items[0].seq : 0;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setRunning(page.running);
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
  }, [conversationId, tick]);

  // 运行中才轮询：每次拿到结果后再排下一次，慢响应不会与下一轮重叠（旧页 :598-601）。
  useEffect(() => {
    if (conversationId === null || !running) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tickOnce = (): void => {
      const current = conversationId;
      let keep = true;
      api
        .conversationMessages(current, cursorRef.current)
        .then((page) => {
          if (!alive || idRef.current !== current) return;
          if (page.items.length > 0) setMessages((prev) => mergeActivities(prev, page.items));
          cursorRef.current = Math.max(cursorRef.current, page.cursor);
          keep = page.running;
          setRunning(page.running);
        })
        .catch(() => {
          // 瞬时失败继续轮询，不把已经渲染的消息换成错误态（旧页 :596-597）。
        })
        .finally(() => {
          if (alive && keep) timer = setTimeout(tickOnce, CONVERSATION_MESSAGE_POLL_MS);
        });
    };
    timer = setTimeout(tickOnce, CONVERSATION_MESSAGE_POLL_MS);
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [conversationId, running]);

  const loadOlder = useCallback((): void => {
    const current = conversationId;
    if (current === null || loadingMoreRef.current || !hasMoreRef.current) return;
    if (earliestRef.current <= 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setOlderError(null);
    api
      .conversationHistory(current, earliestRef.current, CONVERSATION_HISTORY_PAGE)
      .then((page) => {
        if (idRef.current !== current) return;
        if (page.items.length > 0) {
          setMessages((prev) => mergeActivities(page.items, prev));
          earliestRef.current = page.items[0].seq;
        }
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
      })
      .catch((reason: unknown) => {
        if (idRef.current !== current) return;
        setOlderError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [conversationId]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const startPolling = useCallback(() => setRunning(true), []);
  const refreshNow = useCallback(() => setTick((n) => n + 1), []);

  return {
    phase,
    messages,
    running,
    hasMore,
    loadingMore,
    error,
    olderError,
    reload,
    loadOlder,
    startPolling,
    refreshNow,
  };
}

/**
 * 读一条消息的完整详情（旧页 chat/page.tsx:526 的 fetchDetail）。
 * @param conversationId - 对话 id。
 * @param seq - 消息的 seq。
 * @returns 详情文本；空串表示该条没有记录详情。
 */
export function conversationMessageDetail(conversationId: number, seq: number): Promise<string> {
  return api.conversationMsgDetail(conversationId, seq);
}

/**
 * 上传附件到该对话的 session 目录（旧页 chat/page.tsx:716：scope="session"、id=`conv-<id>`）。
 * @param conversationId - 对话 id。
 * @param files - 用户选中的文件。
 * @returns 后端返回的附件元信息（随下一条消息一起发送）。
 */
export function uploadConversationAttachments(
  conversationId: number,
  files: File[],
): Promise<{ attachments: ChatAttachment[] }> {
  return api.chatUpload("session", `conv-${conversationId}`, files);
}

/**
 * 发送一条消息（旧页 chat/page.tsx:734）。
 * @param conversationId - 对话 id。
 * @param message - 已 trim 的正文；只发附件时可以传空串。
 * @param attachments - 已上传的附件；为空时不带该字段。
 * @returns 后端受理状态。
 */
export function sendConversationMessage(
  conversationId: number,
  message: string,
  attachments: ChatAttachment[] = [],
): Promise<{ status: string }> {
  return api.sendConversationMessage(conversationId, message, attachments.length > 0 ? attachments : undefined);
}

/**
 * 停止当前对话的运行（旧页 chat/page.tsx:754）。
 * @param conversationId - 对话 id。
 * @returns 后端受理状态。
 */
export function stopConversation(conversationId: number): Promise<{ status: string }> {
  return api.stopConversation(conversationId);
}

/**
 * 切换对话级 LLM 配置（旧页 chat/page.tsx:518）。
 * @param conversationId - 对话 id。
 * @param profileId - LLM 配置 id；null 表示回到默认。
 * @returns 写入结果。
 */
export function updateConversationProfile(
  conversationId: number,
  profileId: number | null,
): Promise<{ ok: boolean }> {
  return api.updateConversationProfile(conversationId, profileId);
}
