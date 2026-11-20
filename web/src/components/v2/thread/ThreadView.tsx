"use client";

/**
 * The conversation stream, driven by blocks instead of authored markup: the shell
 * passes `Block[]` from the activity mapper, so wiring the live stream later is a
 * data-source change only. The `/v2/thread` demo page replays recorded activities
 * through the same mapping (`app/v2/thread/page.tsx`).
 *
 * Scroll behaviour is ported from the reference chat lane: `lib/scroll-follow`
 * owns the "near the floor = follow" intent, a conversation switch adopts the
 * floor without animation, and growing content keeps the floor in view unless
 * the reader scrolled away - then a jump chip appears instead.
 *
 * Message chrome: each user message reveals a copy action on hover/focus, the
 * same policy as the reference message actions row; assistant answers carry the
 * like/dislike pair (`ui-chat/chat/MessageIconActions.tsx:13-38`). Older history
 * is paged in at the top edge (`ui-chat/chat/use-chat-viewport.ts:803,1019-1046`)
 * and anchored by the height growth so the reader keeps their place, and the
 * fixed-pitch turn rail (`ui-chat/chat/TurnNavigator.tsx:29-33`) jumps between
 * human turns.
 *
 * P1:E1 message rendering: every message body goes through the vendored
 * `MarkdownText` (GFM + TeX math + shiki-highlighted fences with a copy button),
 * matching the old page's `components/transcript.tsx:410,581,907` and
 * `task-workspace-dsh.tsx:1105,1429,1495` which render summaries as Markdown.
 * Only the body renderer changed; the four states, the streaming tail and the
 * message chrome are untouched. There is no streamed token text in this contract
 * (an activity arrives whole over SSE), so the settled `MarkdownText` path is the
 * only one in use; `TerminalBlock` already covers the ANSI output of `terminal`
 * blocks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DiffBlock } from "@/vendor/dsh/primitives/DiffBlock";
import { DisclosureRow } from "@/vendor/dsh/primitives/DisclosureRow";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { ReadBlock } from "@/vendor/dsh/primitives/ReadBlock";
import { SearchBlock } from "@/vendor/dsh/primitives/SearchBlock";
import type { SearchFileGroup } from "@/vendor/dsh/primitives/SearchBlock";
import { TerminalBlock } from "@/vendor/dsh/primitives/TerminalBlock";
import { UserMessageBubble } from "@/vendor/dsh/primitives/UserMessageBubble";
import { Tooltip } from "@/vendor/dsh/primitives/Tooltip";
import { useClipboardCopy } from "@/vendor/dsh/primitives/use-clipboard-copy";
import { MarkdownText } from "@/vendor/dsh/primitives/markdown/MarkdownText";
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCopyOutlineRegular,
  IconDislikeOutlineRegular,
  IconEditOutlineRegular,
  IconLikeOutlineRegular,
  IconThinkOutlineRegular,
  IconWrapLinesOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { ScrollFollow, scrollMetrics } from "@/lib/scroll-follow";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import type { TurnChangedFile } from "@/lib/types";
import type { Block } from "@/v2/data/activity-blocks";
import { buildHunk, parseReadLines, parseSearchGroups } from "@/v2/data/block-cards";
import { fetchActivityDetail } from "@/v2/data/message-detail";
import { mainSegOf } from "@/v2/data/sessions";
import { useTurnFiles } from "@/v2/data/turn-files";
import {
  FEEDBACK_CATEGORIES,
  deleteFeedback,
  feedbackKey,
  putFeedback,
  sessionKeyOf,
  useTaskFeedback,
} from "@/v2/data/message-feedback";
import { RunningStatus } from "./RunningStatus";
import { TurnFilesSlot } from "./TurnFiles";
import { DIFF_LABELS, MARKDOWN_LABELS, READ_LABELS, SEARCH_LABELS, TERMINAL_LABELS } from "./thread-labels";
import css from "./ThreadView.module.css";

/** Paging state of the older-history pages above the live window. */
export interface ThreadHistoryState {
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  /** Load the next older page; the caller prepends it to `blocks`. */
  readonly onLoad: () => void;
}

export interface ThreadViewProps {
  /** Mapped activity blocks in log order. */
  readonly blocks: readonly Block[];
  /** Footer metrics; omitted entirely when the stream has none. */
  readonly stats?: readonly string[];
  /**
   * Identity of the conversation these blocks belong to (the selected task).
   * A change adopts the floor without animation; trimming old blocks must not
   * be mistaken for a session switch.
   */
  readonly conversationId?: string | null;
  /**
   * True while the backend runs the selected task's chat turn. The tail status
   * row is the last child of the message scroller, so it follows the stream
   * exactly like DSH's `RunningStatus` tail slot; false renders zero footprint.
   */
  readonly running?: boolean;
  /** Task id behind the conversation; enables feedback, detail and edit actions. */
  readonly taskId?: string | null;
  /** Older-history paging; omitted keeps the stream read-only at its window. */
  readonly history?: ThreadHistoryState;
  /**
   * Rewind the lane to one human message and resend the edited text. Omitted
   * hides the edit action (the recorded-activity probe page has no backend).
   */
  readonly onEditResend?: (seq: number, text: string, seg: number) => Promise<void>;
  /**
   * Selected lane key (`main:<seg>` | `plan` | `intent:<id>`), or null for the
   * merged transcript. Only a main-agent lane has turns, so the per-turn changed
   * files card reads the segment out of it (old page
   * `task-workspace-dsh.tsx:2120-2126`).
   */
  readonly lane?: string | null;
}

/** Detail id of a card's result row, when the fold attached one. */
function resultSeqOf(block: Block): number | undefined {
  switch (block.kind) {
    case "terminal":
    case "diff":
    case "search":
    case "read":
    case "other":
      return block.resultSeq;
    default:
      return undefined;
  }
}

/**
 * Hover-revealed copy action for one message. Mirrors the reference message
 * chrome: an icon-only button whose accessible name and tooltip swap to the
 * copied state, with a check glyph for one second after the write.
 */
function CopyMessageButton({ text }: { text: string }): React.ReactNode {
  const { copied, onCopy } = useClipboardCopy(text);
  const label = copied ? "已复制" : "复制消息";
  return (
    <Tooltip label={label} side="bottom">
      <button type="button" className={css.copyAction} aria-label={label} onClick={onCopy}>
        {copied ? <IconCheckOutlineRegular size={15} /> : <IconCopyOutlineRegular size={15} />}
      </button>
    </Tooltip>
  );
}

/** One turn of the transcript: it opens on a human message. */
interface TurnMark {
  readonly index: number;
  readonly startSeq: number;
  readonly label: string;
}

/**
 * One message body rendered as Markdown (P1:E1): GFM tables/lists, TeX math and
 * shiki-highlighted fenced code with its own copy button.
 *
 * The body is text a person or the model wrote, so it is and has always been
 * React text nodes; agent HTML never becomes elements. Rendered with the
 * settled pipeline (`MarkdownText` without `streaming`): this contract delivers
 * a whole activity at a time and has no growing token tail to keep live.
 * @param props.text - the message text, exactly as the activity recorded it.
 * @param props.blockSeq - the block's seq, stamped for the transcript probe.
 * @returns the Markdown body block.
 */
function MessageBody({ text, blockSeq }: { text: string; blockSeq: number }): React.ReactNode {
  return (
    <div className={css.messageBody} data-p1-e1-body={blockSeq}>
      <MarkdownText text={text} labels={MARKDOWN_LABELS} />
    </div>
  );
}

/**
 * Render the stream.
 * @param props - mapped blocks, optional stats, conversation identity, run state,
 *   older-history paging and the edit/resend action.
 * @returns the scrollable message area plus the optional stats bar.
 */
export function ThreadView({
  blocks,
  stats,
  conversationId,
  running = false,
  taskId = null,
  history,
  onEditResend,
  lane = null,
}: ThreadViewProps): React.ReactNode {
  const [thinking, setThinking] = useState<number | null>(null);
  const [away, setAway] = useState(false);
  const [activeTurn, setActiveTurn] = useState(0);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [detailSeq, setDetailSeq] = useState<number | null>(null);
  const [details, setDetails] = useState<Readonly<Record<number, string>>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<{
    seq: number;
    sessionKey: string;
    rating: "up" | "down";
  } | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef<ScrollFollow | null>(null);
  /** Scroll geometry captured before an older page prepend, for the anchor. */
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);

  const feedback = useTaskFeedback(taskId);
  const turns = useMemo(() => {
    const list: TurnMark[] = [];
    for (const block of blocks) {
      if (block.kind !== "user") continue;
      list.push({ index: list.length, startSeq: block.seq, label: block.text });
    }
    return list;
  }, [blocks]);

  // Per-turn changed files (P1:B31). Only a main-agent lane has turns, so the
  // segment comes from the selected lane; any other lane reads nothing and the
  // card never mounts (`task-workspace-dsh.tsx:2120-2123`). The boundary
  // signature is every `result` seq in the window: a new settled turn re-reads
  // the map (`:2111-2141`).
  const mainSeg = lane === null ? null : mainSegOf(lane);
  const turnBoundary = useMemo(
    () =>
      blocks
        .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
        .map((block) => block.seq)
        .join(","),
    [blocks],
  );
  const turnFiles = useTurnFiles(taskId, mainSeg, turnBoundary);

  const controller = (): ScrollFollow => {
    if (followRef.current === null) followRef.current = new ScrollFollow(true);
    return followRef.current;
  };

  const toFloor = useCallback((behavior: "instant" | "smooth"): void => {
    const element = listRef.current;
    if (element === null) return;
    controller().toBottom(element, scrollMetrics(element), behavior);
    setAway(false);
    if (behavior !== "smooth") return;
    // A smooth follow can be dropped (reduced motion, a suspended compositor, no
    // frames left in a background tab). Re-check once and fall back to a jump so
    // "following" never stalls with the newest turn off screen.
    window.setTimeout(() => {
      if (listRef.current !== element) return;
      const metrics = scrollMetrics(element);
      if (metrics.floor - metrics.top > 1) controller().jump(element, metrics, metrics.floor);
    }, 420);
  }, []);

  /** Ask for the next older page and remember the geometry it will grow. */
  const loadOlder = useCallback((): void => {
    const element = listRef.current;
    if (element !== null) prependAnchor.current = { height: element.scrollHeight, top: element.scrollTop };
    history?.onLoad();
  }, [history]);

  // Reader intent: every scroll sample decides whether growth should keep the floor.
  useEffect(() => {
    const element = listRef.current;
    if (element === null) return;
    const onScroll = (): void => {
      const metrics = scrollMetrics(element);
      const following = controller().sample(metrics);
      setAway(!following);
      // The rail highlights the turn at the top edge, or the newest one at the floor.
      // The 24px band absorbs a smooth scroll landing just above its 12px target.
      let current = 0;
      const limit = element.scrollTop + 24;
      for (const row of element.querySelectorAll("[data-turn-start]")) {
        if (!(row instanceof HTMLElement) || row.offsetTop > limit) continue;
        const seq = Number(row.getAttribute("data-turn-start"));
        const index = turns.findIndex((turn) => turn.startSeq === seq);
        if (index >= 0) current = index;
      }
      if (metrics.floor - metrics.top <= 24 && turns.length > 0) current = turns.length - 1;
      setActiveTurn(current);
      // Top-edge paging (`use-chat-viewport.ts:803`): one page per arrival at the top.
      if (element.scrollTop < 64 && history !== undefined && history.hasMore && !history.loading) loadOlder();
    };
    const onScrollEnd = (): void => {
      controller().settle(scrollMetrics(element));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("scrollend", onScrollEnd);
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("scrollend", onScrollEnd);
    };
  }, [history, loadOlder, turns]);

  // Conversation switch (task change): land on the newest turn, resume following.
  useEffect(() => {
    controller().reset();
    const id = requestAnimationFrame(() => toFloor("instant"));
    return () => cancelAnimationFrame(id);
  }, [conversationId, toFloor]);

  // Older page committed: shift by the height growth so the reader's row stays put.
  useLayoutEffect(() => {
    const element = listRef.current;
    const anchor = prependAnchor.current;
    if (element === null || anchor === null) return;
    const grown = element.scrollHeight - anchor.height;
    if (grown <= 0) return;
    element.scrollTop = anchor.top + grown;
    prependAnchor.current = null;
  }, [blocks]);

  const lastSeq = blocks.length > 0 ? blocks[blocks.length - 1].seq : null;
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  // The status row's divider needs the row above to be turn content, not an
  // input: DSH excludes user/steering rows (`ChatView.module.css:240-245`).
  const divider = lastBlock !== null && lastBlock.kind !== "user";

  // The status row enters the tail slot after the accepted send already returned;
  // if the reader was at the floor, keep the indicator in view the way a growing
  // Turn does (`lastSeq` handles the blocks themselves).
  useEffect(() => {
    if (!running) return;
    const id = requestAnimationFrame(() => {
      if (controller().active) toFloor("smooth");
    });
    return () => cancelAnimationFrame(id);
  }, [running, toFloor]);

  // Growth: follow when the reader is at the floor, otherwise surface the jump chip.
  useEffect(() => {
    if (lastSeq === null) return;
    const id = requestAnimationFrame(() => {
      if (controller().active) toFloor("smooth");
      else setAway(true);
    });
    return () => cancelAnimationFrame(id);
  }, [lastSeq, toFloor]);

  // Scroll one turn's human row to the top edge; follow is released first, or the
  // streaming tail would drag the reader back to the floor right after the jump.
  const goToTurn = useCallback(
    (index: number): void => {
      const element = listRef.current;
      const target = turns[index];
      if (element === null || target === undefined) return;
      const row = element.querySelector(`[data-turn-start="${target.startSeq}"]`);
      if (!(row instanceof HTMLElement)) return;
      controller().setFollowing(false);
      setAway(true);
      element.scrollTo({ top: Math.max(0, row.offsetTop - 12), behavior: "smooth" });
      setActiveTurn(index);
    },
    [turns],
  );

  /** Open one card's full payload, fetching both the call and its result row once. */
  const openDetail = (block: Block): void => {
    if (detailSeq === block.seq) {
      setDetailSeq(null);
      return;
    }
    setDetailSeq(block.seq);
    if (taskId === null || details[block.seq] !== undefined) return;
    const seqs = [block.seq, resultSeqOf(block)].filter((seq): seq is number => typeof seq === "number");
    setDetailLoading(block.seq);
    Promise.all(seqs.map((seq) => fetchActivityDetail(taskId, seq).catch(() => "")))
      .then((parts) => {
        const labels = ["调用", "结果"];
        const text = parts
          .map((part, index) => (part.trim() === "" ? "" : `【${labels[index] ?? "结果"}】\n${part}`))
          .filter((part) => part !== "")
          .join("\n\n");
        setDetails((prev) => ({ ...prev, [block.seq]: text }));
      })
      .finally(() => setDetailLoading((current) => (current === block.seq ? null : current)));
  };

  /** Save the edited message: rewind the lane to it, then resend the new text. */
  const saveEdit = (block: Extract<Block, { kind: "user" }>): void => {
    if (onEditResend === undefined || editBusy) return;
    const text = editDraft.trim();
    if (text === "") {
      setEditError("消息不能为空");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    onEditResend(block.seq, text, block.mainSeg ?? 0)
      .then(() => {
        setEditingSeq(null);
      })
      .catch((reason: unknown) => {
        setEditError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setEditBusy(false));
  };

  /**
   * Click on one rating: the recorded rating retracts, any other opens the form.
   * Nothing is written until the form is submitted (`MessageIconActions.tsx:13-38`).
   */
  const chooseRating = (block: Extract<Block, { kind: "text" }>, rating: "up" | "down"): void => {
    if (taskId === null) return;
    const sessionKey = sessionKeyOf({
      worker: block.worker,
      kind: "text",
      main_seg: block.mainSeg,
      intent_id: block.intentId,
    });
    const recorded = feedback.byKey[feedbackKey(sessionKey, block.seq)]?.rating ?? null;
    if (recorded !== rating) {
      setFeedbackCategory("");
      setFeedbackText("");
      setFeedbackError(null);
      setFeedbackDraft({ seq: block.seq, sessionKey, rating });
      return;
    }
    void deleteFeedback(taskId, block.seq, sessionKey)
      .then(() => feedback.reload())
      .catch((reason: unknown) => setFeedbackError(reason instanceof Error ? reason.message : String(reason)));
  };

  /** Submit the form: the record is written only here. */
  const submitFeedback = (): void => {
    const draft = feedbackDraft;
    if (draft === null || taskId === null || feedbackBusy) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    putFeedback(taskId, {
      sessionKey: draft.sessionKey,
      seq: draft.seq,
      rating: draft.rating,
      category: feedbackCategory === "" ? null : feedbackCategory,
      text: feedbackText,
    })
      .then(() => {
        setFeedbackDraft(null);
        feedback.reload();
      })
      .catch((reason: unknown) => {
        setFeedbackError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setFeedbackBusy(false));
  };

  /** Detail disclosure shared by the tool cards. */
  const detailRow = (block: Block): React.ReactNode => {
    const open = detailSeq === block.seq;
    const text = details[block.seq];
    return (
      <div className={css.detailWrap}>
        <button
          type="button"
          className={css.detailToggle}
          aria-expanded={open}
          aria-label={open ? "收起工具调用详情" : "查看工具调用详情"}
          data-p1-b6-detail={block.seq}
          onClick={() => openDetail(block)}
        >
          {open ? <IconChevronUpOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
          {open ? "收起详情" : "详情"}
        </button>
        {open ? (
          <div className={css.detailBody} data-p1-b6-detail-body={block.seq}>
            {detailLoading === block.seq ? (
              <p className={css.detailPlaceholder}>读取中…</p>
            ) : text === undefined || text === "" ? (
              <p className={css.detailPlaceholder}>该步骤没有记录详情</p>
            ) : (
              // P1:E1：详情是模型/工具写出的正文（含旧页 `【调用】/【结果】` 两个小节），按 Markdown 渲染。
              <MarkdownText text={text} labels={MARKDOWN_LABELS} variant="compact" />
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={css.thread} data-p1-b6-thread="">
      <div className={css.messages} ref={listRef}>
        {history === undefined ? null : (
          <div className={css.historyRow} data-p1-b6-history={history.loading ? "loading" : history.error !== null ? "error" : history.hasMore ? "more" : "start"}>
            <button
              type="button"
              className={css.historyButton}
              disabled={history.loading}
              data-p1-b6-history-load={history.hasMore ? "" : "none"}
              onClick={loadOlder}
            >
              {history.loading
                ? "加载更早历史…"
                : history.error !== null
                  ? `${history.error} · 重试`
                  : history.hasMore
                    ? "加载更早历史"
                    : "已到最早"}
            </button>
          </div>
        )}
        {blocks.map((block) => {
          switch (block.kind) {
            case "head": {
              const time = block.at.slice(11, 16);
              return (
                <div key={`h${block.seq}`} className={css.assistantHead}>
                  <IconWrapLinesOutlineRegular size={13} />
                  <span>已完成分析</span>
                  {time === "" ? null : <span className={css.meta}>{time}</span>}
                </div>
              );
            }
            case "user": {
              if (editingSeq === block.seq) {
                return (
                  <div key={block.seq} className={css.editRow} data-p1-b6-edit-form={block.seq}>
                    <textarea
                      className={css.editInput}
                      value={editDraft}
                      rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
                      aria-label="编辑这条消息"
                      data-p1-b6-edit-input={block.seq}
                      onChange={(event) => setEditDraft(event.currentTarget.value)}
                    />
                    {editError === null ? null : (
                      <p className={css.editError} role="alert">
                        {editError}
                      </p>
                    )}
                    <div className={css.editActions}>
                      <button
                        type="button"
                        className={css.editSave}
                        disabled={editBusy}
                        data-p1-b6-edit-save={block.seq}
                        onClick={() => saveEdit(block)}
                      >
                        {editBusy ? "重发中…" : "保存并重发"}
                      </button>
                      <button
                        type="button"
                        className={css.editCancel}
                        disabled={editBusy}
                        data-p1-b6-edit-cancel={block.seq}
                        onClick={() => {
                          setEditingSeq(null);
                          setEditError(null);
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={block.seq}
                  className={css.userRow}
                  data-actions-reveal="hover"
                  data-seq={block.seq}
                  data-turn-start={block.seq}
                >
                  <UserMessageBubble>{block.text}</UserMessageBubble>
                  <div className={css.userActions}>
                    <CopyMessageButton text={block.text} />
                    {onEditResend === undefined ? null : (
                      <Tooltip label="编辑并重新发送" side="bottom">
                        <button
                          type="button"
                          className={css.copyAction}
                          aria-label="编辑这条消息"
                          disabled={running}
                          data-p1-b6-edit={block.seq}
                          onClick={() => {
                            setEditDraft(block.text);
                            setEditError(null);
                            setEditingSeq(block.seq);
                          }}
                        >
                          <IconEditOutlineRegular size={15} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            }
            case "thinking":
              return (
                <DisclosureRow
                  key={block.seq}
                  icon={<IconThinkOutlineRegular size={13} />}
                  title={`思考 · ${block.text}`}
                  open={thinking === block.seq}
                  expandable
                  onToggle={() => setThinking(thinking === block.seq ? null : block.seq)}
                >
                  <MessageBody text={block.text} blockSeq={block.seq} />
                </DisclosureRow>
              );
            case "text": {
              const recorded = feedback.byKey[feedbackKey(sessionKeyOf({
                worker: block.worker,
                kind: "text",
                main_seg: block.mainSeg,
                intent_id: block.intentId,
              }), block.seq)]?.rating;
              // The turn's changed-files card closes the turn here, after its
              // closing reply and answer actions, before the next turn opens
              // (`task-workspace-dsh.tsx:1556,1574`; DSH registers it at
              // conversation.chat.turnTail, `ui-deliverables/index.ts:64-84`).
              // A turn that changed nothing renders zero footprint.
              const changed: readonly TurnChangedFile[] =
                mainSeg === null || turnFiles.phase !== "ready" ? [] : turnFiles.byEnd[block.seq] ?? [];
              return (
                <div key={block.seq} className={css.answerRow} data-seq={block.seq}>
                  <MessageBody text={block.text} blockSeq={block.seq} />
                  {taskId === null ? null : (
                    <div className={css.assistantActions}>
                      <Tooltip label={recorded === "up" ? "取消标记" : "好的回答"} side="bottom">
                        <button
                          type="button"
                          className={recorded === "up" ? `${css.ratingAction} ${css.ratingOn}` : css.ratingAction}
                          aria-label={recorded === "up" ? "取消标记" : "好的回答"}
                          aria-pressed={recorded === "up"}
                          data-p1-b6-feedback-up={block.seq}
                          data-active={recorded === "up" ? "true" : undefined}
                          onClick={() => chooseRating(block, "up")}
                        >
                          <IconLikeOutlineRegular size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={recorded === "down" ? "取消标记" : "有问题的回答"} side="bottom">
                        <button
                          type="button"
                          className={recorded === "down" ? `${css.ratingAction} ${css.ratingOn}` : css.ratingAction}
                          aria-label={recorded === "down" ? "取消标记" : "有问题的回答"}
                          aria-pressed={recorded === "down"}
                          data-p1-b6-feedback-down={block.seq}
                          data-active={recorded === "down" ? "true" : undefined}
                          onClick={() => chooseRating(block, "down")}
                        >
                          <IconDislikeOutlineRegular size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                  <TurnFilesSlot
                    phase={turnFiles.phase}
                    error={turnFiles.error}
                    onRetry={turnFiles.reload}
                    files={changed}
                    taskId={taskId}
                    renderEmpty={false}
                  />
                </div>
              );
            }
            case "terminal":
              return (
                <div key={block.seq} className={css.cardSlot}>
                  <TerminalBlock
                    command={block.command}
                    output={block.output}
                    cwd="~/tasks/1107"
                    exitCode={block.isError ? 1 : 0}
                    labels={TERMINAL_LABELS}
                  />
                  {detailRow(block)}
                </div>
              );
            case "diff":
              return (
                <div key={block.seq}>
                  <div className={css.actionLine}>
                    <IconWrapLinesOutlineRegular size={13} /> 执行了命令
                  </div>
                  <div className={css.cardSlot}>
                    <DiffBlock diffs={buildHunk(block.path, block.before, block.after)} labels={DIFF_LABELS} />
                    {detailRow(block)}
                  </div>
                </div>
              );
            case "search": {
              const groups = parseSearchGroups(block.result);
              // Grep returns `path:line` matches; Glob returns a bare path list.
              const paths = groups.length === 0 ? block.result.split("\n").map((row) => row.trim()).filter((row) => row !== "") : [];
              const count = groups.length > 0 ? groups.length : paths.length;
              return (
                <div key={block.seq}>
                  <div className={css.actionLine}>
                    <IconWrapLinesOutlineRegular size={13} /> {count > 0 ? `搜索到 ${count} 个文件` : "已搜索"}
                  </div>
                  <div className={css.cardSlot}>
                    {groups.length > 0 ? (
                      <SearchBlock
                        kind="matches"
                        files={groups}
                        labels={SEARCH_LABELS}
                        truncated={false}
                        total={groups.reduce((n, group) => n + group.matches.length, 0)}
                      />
                    ) : (
                      <SearchBlock kind="paths" paths={paths} labels={SEARCH_LABELS} truncated={false} total={paths.length} />
                    )}
                    {detailRow(block)}
                  </div>
                </div>
              );
            }
            case "read":
              return (
                <div key={block.seq}>
                  <div className={css.actionLine}>
                    <IconWrapLinesOutlineRegular size={13} /> 读取了 {block.label}
                  </div>
                  <div className={css.cardSlot}>
                    <ReadBlock label={block.label} lines={parseReadLines(block.result)} totalLines={parseReadLines(block.result).length} labels={READ_LABELS} />
                    {detailRow(block)}
                  </div>
                </div>
              );
            default:
              return (
                <div key={block.seq} className={css.actionLine}>
                  <MessageBody text={block.text} blockSeq={block.seq} />
                  {detailRow(block)}
                </div>
              );
          }
        })}

        {/* DSH's tail slot after the Turn's content (`ChatView.module.css:146-155`):
            the running row is the scroller's last child, so it follows the stream's
            scroll/follow policy, and it unmounts to nothing when the turn settles. */}
        <RunningStatus running={running} divider={divider} />
      </div>

      {turns.length > 1 ? (
        <div className={css.turnRail} role="navigation" aria-label="回合导航" data-p1-b6-turn-rail="">
          <div className={css.turnRailNav}>
            <button
              type="button"
              className={css.turnNavButton}
              aria-label="上一轮"
              disabled={activeTurn <= 0}
              data-p1-b6-turn-prev=""
              onClick={() => goToTurn(Math.max(0, activeTurn - 1))}
            >
              <IconChevronUpOutlineRegular size={12} />
            </button>
            <button
              type="button"
              className={css.turnNavButton}
              aria-label="下一轮"
              disabled={activeTurn >= turns.length - 1}
              data-p1-b6-turn-next=""
              onClick={() => goToTurn(Math.min(turns.length - 1, activeTurn + 1))}
            >
              <IconChevronDownOutlineRegular size={12} />
            </button>
          </div>
          {turns.map((turn) => (
            <button
              key={turn.index}
              type="button"
              className={css.turnMark}
              data-active={turn.index === activeTurn ? "true" : "false"}
              aria-label={`跳到第 ${turn.index + 1} 回合：${turn.label}`}
              aria-current={turn.index === activeTurn ? "true" : undefined}
              data-p1-b6-turn-mark={turn.index}
              onClick={() => goToTurn(turn.index)}
            />
          ))}
        </div>
      ) : null}

      {away ? (
        <button type="button" className={css.jumpLatest} aria-label="跳到最新" onClick={() => toFloor("smooth")}>
          <IconChevronDownOutlineRegular size={16} />
        </button>
      ) : null}

      {stats === undefined ? null : (
        <div className={css.statsBar}>
          {stats.map((row) => (
            <span key={row}>{row}</span>
          ))}
        </div>
      )}

      {feedbackDraft === null ? null : (
        <Modal
          open
          title={feedbackDraft.rating === "down" ? "这条回答有什么问题？" : "提交反馈"}
          description="选一个分类、补充详情；提交后这条消息才会记录你的判断（取消不记录）。"
          closeLabel="关闭反馈"
          onClose={() => {
            if (!feedbackBusy) setFeedbackDraft(null);
          }}
          footer={
            <>
              <button type="button" className={css.dialogCancel} disabled={feedbackBusy} data-p1-b6-feedback-cancel="" onClick={() => setFeedbackDraft(null)}>
                取消
              </button>
              <button type="button" className={css.dialogSubmit} disabled={feedbackBusy} data-p1-b6-feedback-submit="" onClick={submitFeedback}>
                {feedbackBusy ? "提交中…" : "提交"}
              </button>
            </>
          }
        >
          <div className={css.dialogForm} data-p1-b6-feedback-dialog="">
            <label className={css.dialogField}>
              <span>反馈分类</span>
              <SelectMenu
                value={feedbackCategory}
                disabled={feedbackBusy}
                onChange={(value) => setFeedbackCategory(value)}
                options={[
                  { value: "", label: "不选分类" },
                  ...FEEDBACK_CATEGORIES.map((category) => ({ value: category.id, label: category.label })),
                ]}
              />
            </label>
            <label className={css.dialogField}>
              <span>反馈详情</span>
              <textarea
                className={css.dialogTextarea}
                value={feedbackText}
                readOnly={feedbackBusy}
                maxLength={2000}
                placeholder="填写详情以帮助我们改进体验"
                data-p1-b6-feedback-text=""
                onChange={(event) => setFeedbackText(event.currentTarget.value)}
              />
            </label>
            {feedbackError === null ? null : (
              <p className={css.editError} role="alert">
                {feedbackError}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
