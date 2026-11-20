"use client";

/**
 * Agent 对话页的右栏消息区（对照表 P1:D6–P1:D11）：消息流、向上加载历史、
 * 输入框 + 发送（可带附件）、运行中显示「停止」、点消息看详情、对话级模型下拉。
 * 旧页面依据：ARTEX/web/src/app/(main)/chat/page.tsx:542-571（打开对话只取最新一页）、
 * :580-608（运行中增量轮询）、:628-663（向上翻页并保留视口位置）、:712-723（附件上传到
 * conv-<id>）、:725-745（发送，失败回填输入与附件）、:750-760（停止）、:762-834（页头 +
 * 消息区 + 输入区 + 模型行）、:281-345（对话级 LLM 下拉：默认 / 各配置名）、
 * :526、:833（点开一条消息取 conversationMsgDetail）。
 * DSH 依据：DSH 无独立 Agent 对话页，按「主区整页」扩展（总表 §4.1）；
 * 渲染写法参考 `components/v2/thread/ThreadView.tsx:429-671`（用户行 / 回答行 / 折叠详情行 /
 * 顶部翻页行），但**不复用** ThreadView，也不复用会话区的 Composer（它绑定任务），
 * 这里按卡片要求写一个简单输入框。
 * 对照表行：P1:D6 P1:D7 P1:D8 P1:D9 P1:D10 P1:D11
 *
 * 只画后端真实支持的操作：接口见 `v2/data/agent-conversations.ts` 的 B08 段
 * （api.ts:1142 / :1148 / :1155 / :1157 / :1159 / :1136 / :994）。
 * 旧页的 /btw 旁路提问、@ 引用、审批聚焦都不在本单元写域内，故不画。
 */
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import type { Activity, ChatAttachment, Conversation } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconChevronDownOutlineRegular,
  IconPaperclipOutlineRegular,
  IconSendOutlineRegular,
  IconStopFillRegular,
  IconUserOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  CONVERSATION_ATTACHMENT_LIMIT,
  conversationMessageDetail,
  sendConversationMessage,
  stopConversation,
  updateConversationProfile,
  uploadConversationAttachments,
  useConversationMessages,
} from "@/v2/data/agent-conversations";
import { useLlmProfiles } from "@/v2/data/llm-profiles";

import css from "./agent-chat.module.css";

/** 默认模型选项的 value（SelectMenu 只吃字符串）。 */
const DEFAULT_PROFILE_VALUE = "";

/** 参与详情展开的消息类型：文本 / 用户消息。 */
function isDetailKind(kind: Activity["kind"]): boolean {
  return kind === "text" || kind === "user";
}

/** 一条消息的类型中文名（只做展示，不改变数据）。 */
function kindLabel(kind: Activity["kind"]): string {
  switch (kind) {
    case "user":
      return "你";
    case "text":
      return "回答";
    case "thinking":
      return "思考";
    case "tool_use":
      return "调用工具";
    case "tool_result":
      return "工具结果";
    case "result":
      return "本轮结束";
    case "usage":
      return "用量";
    case "round":
      return "回合";
    case "intent":
      return "意图";
    case "plan":
      return "计划";
    case "plan_review":
      return "计划审阅";
    case "llm_switch":
      return "模型切换";
    case "llm_failover":
      return "模型故障转移";
    case "intercept_request":
      return "拦截审批";
    default:
      return kind;
  }
}

/** 一行的显示时间：取 ts 的 HH:MM（旧页聊天记录同样只显示时分）。 */
function timeOf(ts: string): string {
  const text = ts.length >= 16 ? ts.slice(11, 16) : ts;
  return text;
}

/** 输入框里的一条已上传附件。 */
interface PendingAttachment {
  attachment: ChatAttachment;
  uploading: boolean;
  error: string | null;
}

export interface ConversationPaneProps {
  /** 左栏当前选中的对话。 */
  conversation: Conversation;
  /** 该对话对应的 Agent 显示名；拿不到时调用方传 agent_key。 */
  agentName: string;
  /** 该 Agent 是否自定义（页头标签用）。 */
  agentBuiltin: boolean;
  /** 该 Agent 的描述（页头副标题用，可为空）。 */
  agentDescription: string;
  /** 对话级 LLM 被改动后通知页面重读对话列表（旧页 :519 onConvUpdated）。 */
  onConversationChanged: () => void;
}

/**
 * 渲染一个对话的消息区。
 * @param props - 选中的对话、Agent 元信息与「对话已变化」回调。
 * @returns 页头（Agent 名 + 运行标签）、消息流、输入区、模型下拉。
 */
export function ConversationPane({
  conversation,
  agentName,
  agentBuiltin,
  agentDescription,
  onConversationChanged,
}: ConversationPaneProps): ReactNode {
  const state = useConversationMessages(conversation.id);
  const profiles = useLlmProfiles();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const [detailText, setDetailText] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 向上翻页前记录的滚动几何，插入历史后按高度差还原视口（旧页 :633-646）。 */
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  /** 用户是否贴在底部；只有贴着底才跟随新消息（旧页 :656-660、:673-679）。 */
  const atBottomRef = useRef(true);

  const uploading = pending.some((item) => item.uploading);
  const readyAttachments = pending.filter((item) => item.uploading === false && item.error === null);
  const canSend =
    !sending && !state.running && !uploading && (input.trim() !== "" || readyAttachments.length > 0);

  // 切换对话：丢弃上一个对话的输入态、展开态与错误。
  useEffect(() => {
    setInput("");
    setPending([]);
    setActionError(null);
    setProfileError(null);
    setExpandedSeq(null);
    setDetailText(null);
    setDetailError(null);
    atBottomRef.current = true;
  }, [conversation.id]);

  // 打开 / 切换对话时落到最新（旧页 :666-672）。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
    atBottomRef.current = true;
  }, [conversation.id]);

  const lastSeq = state.messages.length > 0 ? state.messages[state.messages.length - 1].seq : null;
  const messageCount = state.messages.length;

  // 新消息到达：贴着底就跟随，否则保持原位（旧页 :674-679）。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null || !atBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lastSeq, state.running, messageCount]);

  const onScroll = useCallback((): void => {
    const element = scrollRef.current;
    if (element === null) return;
    atBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 60;
    if (element.scrollTop <= 80 && state.hasMore && !state.loadingMore) {
      prependAnchorRef.current = { height: element.scrollHeight, top: element.scrollTop };
      state.loadOlder();
    }
  }, [state]);

  // 历史页插入后按高度差还原视口，阅读位置不跳（旧页 :643-646 / ThreadView.tsx:255-263）。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const anchor = prependAnchorRef.current;
    if (element === null || anchor === null) return;
    if (state.loadingMore) return;
    prependAnchorRef.current = null;
    const grown = element.scrollHeight - anchor.height;
    if (grown <= 0) return;
    element.scrollTop = anchor.top + grown;
  }, [state.loadingMore, messageCount]);

  const loadEarlier = useCallback((): void => {
    const element = scrollRef.current;
    if (element !== null) prependAnchorRef.current = { height: element.scrollHeight, top: element.scrollTop };
    state.loadOlder();
  }, [state]);

  // ---- 附件：选文件即上传到该对话的 session 目录（旧页 :712-723）----
  const pickFiles = useCallback(
    (files: File[]): void => {
      if (files.length === 0) return;
      const room = CONVERSATION_ATTACHMENT_LIMIT - pending.length;
      if (room <= 0) {
        setActionError(`最多 ${CONVERSATION_ATTACHMENT_LIMIT} 个附件`);
        return;
      }
      const accepted = files.slice(0, room);
      if (accepted.length < files.length) {
        setActionError(`最多 ${CONVERSATION_ATTACHMENT_LIMIT} 个附件，已忽略 ${files.length - accepted.length} 个`);
      } else {
        setActionError(null);
      }
      // 每个文件单独一条上传记录，避免整批失败时丢掉已成功的部分。
      for (const file of accepted) {
        const placeholder: PendingAttachment = {
          attachment: { name: file.name, path: "", size: file.size },
          uploading: true,
          error: null,
        };
        setPending((prev) => [...prev, placeholder]);
        uploadConversationAttachments(conversation.id, [file])
          .then((result) => {
            const uploaded = result.attachments[0];
            if (uploaded === undefined || uploaded.path === "") throw new Error("上传结果缺少文件路径");
            setPending((prev) =>
              prev.map((item) =>
                item.attachment === placeholder.attachment
                  ? { attachment: uploaded, uploading: false, error: null }
                  : item,
              ),
            );
          })
          .catch((reason: unknown) => {
            const message = reason instanceof Error ? reason.message : String(reason);
            setPending((prev) =>
              prev.map((item) =>
                item.attachment === placeholder.attachment
                  ? { ...item, uploading: false, error: message }
                  : item,
              ),
            );
            setActionError(`附件上传失败：${message}`);
          });
      }
    },
    [conversation.id, pending.length],
  );

  const removeAttachment = useCallback((name: string, size: number): void => {
    setPending((prev) =>
      prev.filter((item) => !(item.attachment.name === name && item.attachment.size === size)),
    );
  }, []);

  // ---- 发送（旧页 :725-745）----
  const send = useCallback((): void => {
    if (sending || state.running || uploading) return;
    const text = input.trim();
    const attachments = pending.filter((item) => item.uploading === false && item.error === null);
    if (text === "" && attachments.length === 0) return;
    setSending(true);
    setActionError(null);
    const sentText = input;
    const sentPending = pending;
    sendConversationMessage(
      conversation.id,
      text,
      attachments.map((item) => item.attachment),
    )
      .then(() => {
        setInput("");
        setPending([]);
        // 发送被受理后立刻开始增量轮询，让人工这一轮马上出现（旧页 :735-737）。
        state.startPolling();
      })
      .catch((reason: unknown) => {
        setActionError(`发送失败：${reason instanceof Error ? reason.message : String(reason)}`);
        setInput(sentText);
        setPending(sentPending);
      })
      .finally(() => setSending(false));
  }, [conversation.id, input, pending, sending, state, uploading]);

  // ---- 停止（旧页 :750-760）----
  const stop = useCallback((): void => {
    if (stopping) return;
    setStopping(true);
    setActionError(null);
    stopConversation(conversation.id)
      .then(() => {
        toast("已请求停止本次运行");
        state.refreshNow();
      })
      .catch((reason: unknown) => {
        setActionError(`停止失败：${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => setStopping(false));
  }, [conversation.id, state, stopping]);

  // ---- 对话级模型（旧页 :516-523 / :281-345）----
  const profileOptions = useMemo(() => {
    const fallback = profiles.profiles.find((profile) => profile.is_default);
    const options = [
      {
        value: DEFAULT_PROFILE_VALUE,
        label: `默认${fallback === undefined ? "" : `（${fallback.name}）`}`,
      },
    ];
    for (const profile of profiles.profiles) {
      options.push({ value: profile.id, label: profile.name });
    }
    return options;
  }, [profiles.profiles]);

  const currentProfileValue =
    conversation.llm_profile_id === undefined ? DEFAULT_PROFILE_VALUE : String(conversation.llm_profile_id);

  const changeProfile = useCallback(
    (value: string): void => {
      if (profileBusy) return;
      const next = value === DEFAULT_PROFILE_VALUE ? null : Number(value);
      if (next !== null && !Number.isFinite(next)) return;
      setProfileBusy(true);
      setProfileError(null);
      updateConversationProfile(conversation.id, next)
        .then(() => {
          toast("已切换该对话的模型");
          onConversationChanged();
        })
        .catch((reason: unknown) => {
          setProfileError(`切换模型失败：${reason instanceof Error ? reason.message : String(reason)}`);
        })
        .finally(() => setProfileBusy(false));
    },
    [conversation.id, onConversationChanged, profileBusy],
  );

  // ---- 消息详情（旧页 :526 / :833）----
  const toggleDetail = useCallback(
    (activity: Activity): void => {
      if (expandedSeq === activity.seq) {
        setExpandedSeq(null);
        setDetailText(null);
        setDetailError(null);
        return;
      }
      setExpandedSeq(activity.seq);
      setDetailLoading(true);
      setDetailError(null);
      // 列表里已带 detail 时先用它，再以接口结果覆盖；接口失败时保留已有文本。
      setDetailText(activity.detail ?? null);
      conversationMessageDetail(conversation.id, activity.seq)
        .then((text) => {
          setDetailText((current) => (text === "" ? (current ?? "") : text));
        })
        .catch((reason: unknown) => {
          setDetailError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => setDetailLoading(false));
    },
    [conversation.id, expandedSeq],
  );

  const hasMessages = state.messages.length > 0;

  return (
    <div className={css.paneRoot} data-conversation-pane={conversation.id}>
      <header className={css.paneHead} data-conversation-pane-head="">
        <span className={css.paneHeadName} title={agentName}>
          {agentName}
        </span>
        <span className={css.paneHeadKey}>{conversation.agent_key}</span>
        {agentBuiltin ? null : <Tag tone="outline">自定义</Tag>}
        {state.running ? <Tag tone="info">运行中</Tag> : null}
        {agentDescription === "" ? null : (
          <span className={css.paneHeadDesc} title={agentDescription}>
            {agentDescription}
          </span>
        )}
      </header>

      <div className={css.paneBody} ref={scrollRef} onScroll={onScroll} data-conversation-scroll="">
        {state.phase === "loading" ? (
          <div className={css.state} data-conversation-messages="loading">
            加载消息中…
          </div>
        ) : state.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-conversation-messages="offline">
            读取失败：{state.error}
            <Button variant="outline" size="sm" onClick={state.reload} data-conversation-messages-retry="">
              重试
            </Button>
          </div>
        ) : !hasMessages ? (
          <div className={css.empty} data-conversation-messages="empty">
            <span className={css.emptyTitle}>{state.running ? "Agent 正在回复…" : "开始和这个 Agent 对话"}</span>
            <span className={css.emptyText}>在下方输入第一条消息；附件会在发送前上传到该对话的会话目录。</span>
          </div>
        ) : (
          <div className={css.messageList} data-conversation-messages="ready">
            <div className={css.historyRow}>
              {state.hasMore ? (
                <button
                  type="button"
                  className={css.historyButton}
                  disabled={state.loadingMore}
                  data-conversation-history=""
                  onClick={loadEarlier}
                >
                  {state.loadingMore ? "加载更早消息…" : "加载更早的消息"}
                </button>
              ) : (
                <span className={css.historyStart} data-conversation-history="start">
                  已到最早
                </span>
              )}
            </div>
            {state.olderError === null ? null : (
              <p className={css.errorLine} role="alert">
                更早消息读取失败：{state.olderError}
              </p>
            )}
            {state.messages.map((activity) => {
              const open = expandedSeq === activity.seq;
              if (activity.kind === "user") {
                return (
                  <div key={activity.seq} className={css.userRow} data-conversation-message={activity.seq}>
                    <div className={css.userBubble}>{activity.summary}</div>
                    <div className={css.messageMeta}>
                      <span>{timeOf(activity.ts)}</span>
                      {activity.detail === undefined ? null : (
                        <button
                          type="button"
                          className={css.messageAction}
                          aria-expanded={open}
                          data-conversation-message-detail={activity.seq}
                          onClick={() => toggleDetail(activity)}
                        >
                          {open ? "收起详情" : "详情"}
                        </button>
                      )}
                    </div>
                    {open ? renderDetail(activity.seq, detailLoading, detailError, detailText) : null}
                  </div>
                );
              }
              return (
                <div key={activity.seq} className={css.messageRow} data-conversation-message={activity.seq}>
                  <div className={css.messageMeta}>
                    <Tag tone="neutral">{kindLabel(activity.kind)}</Tag>
                    <span>{timeOf(activity.ts)}</span>
                    {activity.tool === undefined ? null : <span className={css.messageTool}>{activity.tool}</span>}
                    {isDetailKind(activity.kind) || activity.detail !== undefined ? (
                      <button
                        type="button"
                        className={css.messageAction}
                        aria-expanded={open}
                        data-conversation-message-detail={activity.seq}
                        onClick={() => toggleDetail(activity)}
                      >
                        {open ? "收起详情" : "详情"}
                      </button>
                    ) : null}
                  </div>
                  <div className={activity.is_error === true ? `${css.messageText} ${css.messageTextError}` : css.messageText}>
                    {activity.summary}
                  </div>
                  {open ? renderDetail(activity.seq, detailLoading, detailError, detailText) : null}
                </div>
              );
            })}
            {state.running ? (
              <div className={css.runningRow} data-conversation-running-row="">
                <Tag tone="info">运行中</Tag>
                <span>每 2 秒读取新消息…</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className={css.composer} data-conversation-composer="">
        {pending.length === 0 ? null : (
          <div className={css.attachmentList} data-conversation-attachments="">
            {pending.map((item) => (
              <span key={`${item.attachment.name}:${item.attachment.size}`} className={css.attachmentChip}>
                <span className={css.attachmentName}>{item.attachment.name}</span>
                <span className={css.attachmentState}>
                  {item.uploading ? "上传中…" : item.error === null ? "已上传" : `失败：${item.error}`}
                </span>
                <button
                  type="button"
                  className={css.attachmentRemove}
                  aria-label={`移除附件 ${item.attachment.name}`}
                  onClick={() => removeAttachment(item.attachment.name, item.attachment.size)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={css.composerRow}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={css.fileInput}
            aria-label="选择附件"
            onChange={(event) => {
              // FileList 与 input 活绑定：先快照再清空 value（旧页 :224-229）。
              const picked = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              pickFiles(picked);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={sending || state.running || uploading}
            title="选择附件"
            aria-label="选择附件"
            icon={<IconPaperclipOutlineRegular size={14} />}
            onClick={() => fileInputRef.current?.click()}
            data-conversation-attach=""
          />
          <textarea
            className={css.composerInput}
            rows={2}
            value={input}
            aria-label="输入消息"
            placeholder={
              state.running ? "Agent 正在回复，可输入下一条消息，结束后再发送" : "输入消息，Enter 发送，Shift+Enter 换行"
            }
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) send();
              }
            }}
            data-conversation-input=""
          />
          {state.running ? (
            <Button
              variant="outline"
              size="sm"
              onClick={stop}
              disabled={stopping}
              title="停止本次运行"
              icon={<IconStopFillRegular size={13} />}
              data-conversation-stop=""
            >
              {stopping ? "停止中…" : "停止"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={send}
              disabled={!canSend}
              title="发送消息"
              icon={<IconSendOutlineRegular size={13} />}
              data-conversation-send=""
            >
              {sending ? "发送中…" : "发送"}
            </Button>
          )}
        </div>
        {actionError === null ? null : (
          <p className={css.errorLine} role="alert" data-conversation-action-error="">
            {actionError}
          </p>
        )}
        <div className={css.profileRow} data-conversation-profile-row="">
          <span className={css.profileLabel}>模型</span>
          {profiles.phase === "offline" ? (
            <span className={css.profileHint} role="status">
              读取模型列表失败：{profiles.error}
              <Button variant="outline" size="sm" onClick={profiles.reload}>
                重试
              </Button>
            </span>
          ) : profiles.phase === "loading" ? (
            <span className={css.profileHint}>正在读取模型列表…</span>
          ) : profiles.profiles.length === 0 ? (
            <span className={css.profileHint}>还没有可用的模型配置，当前跟随默认。</span>
          ) : (
            <>
              <SelectMenu
                id={`conversation-profile-${conversation.id}`}
                ariaLabel="对话级模型"
                value={currentProfileValue}
                options={profileOptions}
                disabled={profileBusy || state.running || sending}
                onChange={changeProfile}
              />
              {currentProfileValue === DEFAULT_PROFILE_VALUE ? (
                <span className={css.profileHint}>跟随默认配置</span>
              ) : null}
            </>
          )}
        </div>
        {profileError === null ? null : (
          <p className={css.errorLine} role="alert" data-conversation-profile-error="">
            {profileError}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 渲染一条消息的详情块。
 * @param seq - 消息 seq（渲染在 data 属性上）。
 * @param loading - 是否正在读取。
 * @param error - 读取失败原因。
 * @param text - 详情文本。
 * @returns 详情节点。
 */
function renderDetail(
  seq: number,
  loading: boolean,
  error: string | null,
  text: string | null,
): ReactNode {
  return (
    <div className={css.detailBody} data-conversation-detail-body={seq}>
      {error !== null ? (
        <p className={css.errorLine} role="alert">
          详情读取失败：{error}
        </p>
      ) : null}
      <pre className={css.detailPre}>
        {loading && text === null
          ? "读取中…"
          : text === null || text === ""
            ? "该消息没有记录详情"
            : text}
      </pre>
    </div>
  );
}
