"use client";

/**
 * Composer: the conversation input surface.
 *
 * Port of `ui-conversation/src/client/skeleton/InputBar.tsx`: one card with a
 * plain-text contenteditable draft, the toolbar seats (left: attach + permission;
 * right: model + primary send), and the `/` and `@` trigger menus. Enter sends,
 * Shift+Enter breaks the line, an IME composition never sends, and the draft
 * scrollport caps at 14 lines. Draft attachments render in the card's
 * attachments seat above the draft (`InputBar.tsx:471-483`) as the source's
 * per-file upload cards, each file uploaded for real through `api.chatUpload`;
 * the send seat waits while any draft is not ready (`InputBar.tsx:98-104`).
 * Permission changes still write through the owner's callback.
 *
 * The primary seat is a two-state control, as in the source: while the chat request
 * is in flight it keeps the sending spinner, and once the backend reports the turn
 * running it becomes the Stop control. The run state itself is owned by the shell
 * (`useChatRun` is polled once) and arrives as `chatRun`, so the Stop seat and the
 * stream-tail running status share one `chat/status` poll chain. A stop request
 * never clears the conversation; the SSE tail keeps draining the turn.
 *
 * A running turn also accepts a draft into the page-level queue (`useComposerQueue`):
 * `POST /api/chat` answers 409 while the agent is busy and the backend has no steer
 * channel, so Enter/the primary seat hold the text instead of POSTing and the head
 * row goes out automatically when `chatRun.running` falls back to false. The queue
 * strip renders above the draft (`QueueDock`). While such a draft exists the primary
 * seat reads "排队发送" and carries the queue action, as the source's top-level session
 * does (`InputBar.tsx:383`: `interruptible` is only true while the request is in
 * flight, so no independent Stop is drawn beside a queueing primary). With an empty
 * draft the primary seat is the Stop control, so the R1 states are intact; the
 * independent Stop exists only while the send request is in flight. Stopping a
 * running turn that has a draft therefore means clearing the draft (primary Stop) or
 * pressing Escape twice. Two Escape presses within 500ms while the task runs stop it
 * through the same `chatRun.stop()` call (single Escape never acts).
 */
import * as React from "react";

import type { GoalSnapshot } from "@/lib/types";
import type { ChatRunState } from "@/v2/data/chat-run";
import { sendChat } from "@/v2/data/chat-send";
import type { FileMentionCandidate } from "@/v2/data/file-mentions";
import { useFileMentions } from "@/v2/data/file-mentions";
import type { GoalActions } from "@/v2/data/goal";
import { useComposerAttachments } from "@/v2/data/composer-attachments";
import { profilesToOptions } from "@/v2/data/llm-map";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import type { SideQuestionChannel } from "@/v2/data/side-questions";
import { isSideQuestionCommand, mutateSideQuestions as cancelSideQuestion, sideQuestionBody, useSideHistory, useSideQuestionSubmit } from "@/v2/data/side-questions";
import { useWorkspaceFiles } from "@/v2/data/workspace-files";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconChevronDownOutlineRegular,
  IconPlusOutlineRegular,
  IconSendOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { toast } from "@/components/v2/settings/Toast";

import css from "./Composer.module.css";
import { ComposerAttachments } from "./ComposerAttachments";
import type { ComposerEditorHandle } from "./ComposerEditor";
import { ComposerEditor } from "./ComposerEditor";
import { GoalBar } from "./GoalBar";
import { MentionMenu } from "./MentionMenu";
import { ModelPicker } from "./ModelPicker";
import { QueueDock } from "./QueueDock";
import { SteeringDock } from "./SteeringDock";
import { SideQuestionNotice } from "./SideQuestionNotice";
import type { TriggerHit } from "./trigger";
import { detectTrigger } from "./trigger";
import { QUEUE_ATTACHMENT_NOTICE, useComposerQueue } from "./useComposerQueue";

/** The draft surface's copy; the same string is its accessible name, as in the source. */
const PLACEHOLDER = "描述你想要构建的内容, / 调用指令, @ 文件或对话";

/**
 * Two Escape presses inside this window stop the running turn. The source's
 * `client-shortcuts/config.ts` validates the same 500ms default (`stopSequenceMs`).
 */
const DOUBLE_ESCAPE_MS = 500;

// Backend enum, read from its 400 body: auto / read-only / workspace-write / danger-full.
const PERMISSIONS = [
  { id: "auto", label: "自动" },
  { id: "read-only", label: "仅可查看" },
  { id: "workspace-write", label: "工作区内修改" },
  { id: "danger-full", label: "完全权限" },
];

const COMMANDS = [
  { id: "model", label: "/model", desc: "切换本次会话的模型" },
  { id: "compact", label: "/compact", desc: "压缩上下文" },
  { id: "clear", label: "/clear", desc: "清空当前会话" },
  { id: "report", label: "/report", desc: "生成报告" },
];

/**
 * `/btw`：静默兼容的旧入口（旧页 sessions-tab.tsx:1494-1527）。敲了前缀照旧走插话，
 * 但命令表不再列出它 —— 运行中 Enter 本身就是插话，前缀只剩兼容意义。
 */
const BTW_COMMAND = { id: "btw", label: "/btw", desc: "给正在运行的会话提一条不打断的追问（兼容写法：直接输入即可插话）" };

/** One row of the `/` or `@` menu. */
interface TriggerCandidate {
  readonly id: string;
  readonly label: string;
  readonly desc?: string;
}

/**
 * Inert run state for a composer mounted without the shell (the `/v2/composer`
 * probe page): the primary seat never shows Stop and, crucially, no second
 * `chat/status` poll is created outside `Shell.tsx`.
 */
const IDLE_CHAT_RUN: ChatRunState = {
  running: false,
  start: () => {},
  stop: () => Promise.resolve(),
  error: null,
};

/**
 * Dismissal sticks to the exact token it was raised for.
 * @param hit - the live trigger token.
 * @returns the token's identity key.
 */
function tokenKey(hit: TriggerHit): string {
  return `${hit.trigger}|${hit.query}|${hit.start}|${hit.end}`;
}

/** The source Stop glyph: the 16-unit viewBox's 10-unit rounded square (`InputBar.tsx:556-558`, `InputBar.tsx:574-577`). */
function StopGlyph(): React.ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  );
}

/**
 * Render the conversation composer.
 * @param props.goalState - goal snapshot of the open task, so the banner shows real text.
 * @param props.goalActions - the goal mutations the shell owns; without them the strip stays hidden.
 * @param props.taskId - the open task; the send button waits for one.
 * @param props.chatRun - backend run state of the open task, owned by the shell.
 * @param props.onSent - notified after a message was accepted, so the owner can reload.
 * @param props.permissionLevel - the task's current permission level.
 * @param props.onPermissionChange - writes the chosen level back to the task.
 * @returns the composer.
 */
export function Composer({
  goalState = null,
  goalActions,
  taskId = null,
  chatRun = IDLE_CHAT_RUN,
  onSent,
  permissionLevel = "auto",
  onPermissionChange,
}: {
  goalState?: GoalSnapshot | null;
  goalActions?: GoalActions;
  taskId?: string | null;
  chatRun?: ChatRunState;
  onSent?: () => void;
  permissionLevel?: string;
  onPermissionChange?: (level: string) => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  /** A stop request is in flight; the primary seat stays disabled until it settles. */
  const [stopping, setStopping] = React.useState(false);
  const editorRef = React.useRef<ComposerEditorHandle | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Draft attachments own their per-file upload state; a failure surfaces in the
  // same notice row as send/stop failures, as the source's toast does.
  const draftAttachments = useComposerAttachments(taskId, setSendError);
  const attachments = draftAttachments.attachments;
  const uploading = draftAttachments.uploading;
  // Send waits for every picked file: uploading and failed drafts both hold the
  // gate (the source's `uploadsPending`, `InputBar.tsx:98-104`). A failed upload
  // is retried or removed, never silently dropped.
  const uploadsPending = !draftAttachments.ready;

  // The backend run state of this task's turn, restored on mount and followed
  // after every accepted send. This is separate from `sending`: the 202 comes
  // back before the model has answered, so `running` is what the Stop seat shows.
  // The shell owns the poll (`Shell.tsx`), so this component never polls again.
  const running = chatRun.running;
  const runningRef = React.useRef(running);
  React.useEffect(() => {
    runningRef.current = running;
    // The turn settled (or the task changed): release a pending stop.
    if (!running) setStopping(false);
  }, [running]);

  // Page-level submission queue. It lives as long as this composer surface stays
  // mounted (task switches included), is text-only, and is dropped by a page
  // reload — unlike DSH's durable Host inbox. Each row remembers the task it was
  // queued for, so only that task's run end can flush it. See the hook for why
  // steer is not offered: this backend has no channel to insert into a live turn.
  const queue = useComposerQueue({
    taskId,
    running,
    sending,
    startRun: chatRun.start,
    onSent,
    onError: setSendError,
  });

  // Trigger menu state: the live token, the highlighted row, and per-token dismissal.
  const [hit, setHit] = React.useState<TriggerHit | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const hitRef = React.useRef<TriggerHit | null>(null);
  const dismissedRef = React.useRef<string | null>(null);

  const [permission, setPermission] = React.useState(permissionLevel);
  const [permissionOpen, setPermissionOpen] = React.useState(false);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [confirmFull, setConfirmFull] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);

  // The level arrives with the selected task, so the local copy must follow the
  // prop; `useState` alone would pin the first task's value.
  React.useEffect(() => {
    setPermission(permissionLevel);
  }, [permissionLevel]);

  const profilesState = useLlmProfiles();
  const modelOptions = React.useMemo(() => profilesToOptions(profilesState.profiles), [profilesState.profiles]);
  const workspaceState = useWorkspaceFiles();
  const fileOptions = React.useMemo(
    () => workspaceState.entries.map((entry) => ({ id: entry.path, label: entry.path })),
    [workspaceState.entries],
  );

  // ---- 插话（W-2 重设计）：DSH 的 steer 语义用后端旁路问答通道承载 ----------------
  // 运行中主 Agent 就是插话目标（后端 side-questions 的通道判定：running 主车道走 chat
  // 端口的 request_id 提问，intent_intervention.go 的 worker 只收 paused 且本 UI 的 worker
  // 车道只读，所以插话目标恒为 main）。空 dao 目标 = 没有 running 主 Agent = Enter 排队。
  // 旧页依据：sessions-tab.tsx:1262-1268（主车道路径）、:1494-1527（/btw 接管）。
  // DSH 依据：`submission-policy.ts:36`（running 且可插话 → 按偏好解析 queue/steer，
  // 这里取 steer 为默认、排队保留在 Cmd/Ctrl+Enter，对齐 DSH 的加速 Enter 家族）。
  const steerChannel: SideQuestionChannel | null = running ? "main" : null;
  const steerAvailable = steerChannel !== null;
  /** 没有可插话目标时的原因提示（仅 /btw 兼容路径需要）。 */
  const [steerNotice, setSteerNotice] = React.useState<string | null>(null);

  const sideHistory = useSideHistory(taskId, steerChannel);
  const sideSubmit = useSideQuestionSubmit(taskId, steerChannel, sideHistory.reload);

  // 历史里有「回答中」就按旧页节奏每 2 秒刷新一次（hooks/use-side-questions.ts:120-125）；
  // SteeringDock 吃同一份历史，所以 dock 的实时态就是这个轮询喂的（SSE 归 Phase 2 内联）。
  const sideRunning = sideHistory.items.some((item) => item.status === "running");
  React.useEffect(() => {
    if (!sideRunning) return;
    const timer = setInterval(sideHistory.reload, 2000);
    return () => clearInterval(timer);
  }, [sideRunning, sideHistory.reload]);

  // `@` 下拉的数据源：工作区真实文件 + 记录候选（旧页 mention-textarea.tsx:233-320）。
  const mentionQuery = hit !== null && hit.trigger === "@" ? hit.query : null;
  const mentions = useFileMentions(mentionQuery, mentionQuery !== null);

  // `/` 指令表：`/btw` 只在可插话时出现，且只是兼容提示（真入口是运行中 Enter）。
  const slashCandidates = React.useMemo<readonly TriggerCandidate[]>(() => {
    if (hit === null || hit.trigger !== "/") return [];
    const needle = hit.query.toLowerCase();
    const table = steerAvailable ? [...COMMANDS, BTW_COMMAND] : COMMANDS;
    return table.filter((candidate) => candidate.label.toLowerCase().includes(needle));
  }, [hit, steerAvailable]);
  const atCandidates = mentions.candidates;
  // 两条触发路径各自的候选集分开保存：`/` 只有指令，`@` 只有文件/记录，键盘与渲染
  // 都只读自己那一路，避免把 `@` 候选当成指令插入、或反过来。
  const slashMenuOpen = hit !== null && hit.trigger === "/" && slashCandidates.length > 0;
  const atMenuOpen = hit !== null && hit.trigger === "@";
  // 菜单是否吃掉键盘：`/` 有候选才吃；`@` 在四态（加载/空/失败/有数据）下都吃，
  // 否则空态时按 Enter 会把半截 `@` 草稿直接发出去。
  const menuOpen = slashMenuOpen || atMenuOpen;
  const activeCount = hit !== null && hit.trigger === "@" ? atCandidates.length : slashCandidates.length;
  const active = activeCount === 0 ? 0 : Math.min(activeIndex, activeCount - 1);

  const permissionLabel = PERMISSIONS.find((entry) => entry.id === permission)?.label ?? "工作区内修改";

  /** Apply the live token; the highlight only resets when the token itself changed. */
  const applyHit = React.useCallback((next: TriggerHit | null): void => {
    const previous = hitRef.current;
    hitRef.current = next;
    setHit(next);
    if (next !== null && (previous === null || tokenKey(previous) !== tokenKey(next))) setActiveIndex(0);
  }, []);

  /** Re-detect the trigger token at the caret after every caret move. */
  const syncTrigger = React.useCallback(
    (text: string, caret: number | null): void => {
      const next = caret === null ? null : detectTrigger(text, caret);
      if (next === null || dismissedRef.current === tokenKey(next)) {
        applyHit(null);
        return;
      }
      applyHit(next);
    },
    [applyHit],
  );

  const handleDraftChange = React.useCallback(
    (text: string, caret: number | null, composing: boolean): void => {
      setDraft(text);
      // IME candidate text is not a user-authored `/` or `@` token yet.
      if (composing) return;
      syncTrigger(text, caret);
    },
    [syncTrigger],
  );

  const pick = (label: string): void => {
    const current = hitRef.current;
    if (current === null) return;
    const insert = current.trigger === "/" ? `${label} ` : `@${label} `;
    editorRef.current?.replaceRange(current.start, current.end, insert);
    editorRef.current?.focus();
    applyHit(null);
  };

  /** 选中一行 `@` 候选：文件是 `@路径 `，记录是 `@[种类#id 名称] `。 */
  const pickMention = (candidate: FileMentionCandidate): void => {
    pick(candidate.token);
  };

  /** Enter/Tab 键按下时选中当前高亮行；`@` 走候选，`/` 走指令。 */
  const commitActive = (): void => {
    const current = hitRef.current;
    if (current === null) return;
    if (current.trigger === "@") {
      const candidate = atCandidates[active];
      if (candidate !== undefined) pickMention(candidate);
      return;
    }
    pick(slashCandidates[active]?.label ?? "");
  };

  const dismiss = (): void => {
    const current = hitRef.current;
    if (current === null) return;
    dismissedRef.current = tokenKey(current);
    applyHit(null);
  };

  const moveActive = (delta: number): void => {
    if (activeCount === 0) return;
    setActiveIndex((index) => {
      const current = Math.min(index, activeCount - 1);
      return (current + delta + activeCount) % activeCount;
    });
  };

  /** Hand picked, pasted, or dropped files to the attachment state (real upload each). */
  const uploadFiles = (files: readonly File[]): void => {
    draftAttachments.addFiles(files);
  };

  // An automatic queue send in flight also holds the send gate: the backend would
  // reject a second concurrent turn with 409.
  const canSubmit =
    draft.trim() !== "" && taskId !== null && !sending && !uploadsPending && !queue.flushing;

  /**
   * Move the draft into the page-level queue instead of POSTing it.
   *
   * Text only: a draft that still carries attachments cannot be replayed later
   * through this path (the backend has no attachment re-queue and the upload
   * state belongs to the draft seat), so the gesture is refused with a notice and
   * the draft is left untouched rather than silently losing its files.
   */
  const enqueueDraft = (): void => {
    const text = draft.trim();
    if (text === "" || taskId === null) return;
    if (attachments.length > 0) {
      setSendError(QUEUE_ATTACHMENT_NOTICE);
      return;
    }
    setSendError(null);
    queue.enqueue(text);
    // The text lives in the queue now; clear the surface for the next draft.
    editorRef.current?.clear();
    setDraft("");
    applyHit(null);
  };

  /**
   * 发一条插话（W-2：原「旁路问题」。语义照旧页 /btw 分流，但入口合并进 Enter）。
   * 成功清稿（答案出现在 SteeringDock），失败把稿子留在输入区并写进提示行。
   * @param text - 已 trim 的整段草稿（可能含 `/btw` 兼容前缀）。
   */
  const submitSteer = (text: string): void => {
    if (steerChannel === null) {
      setSteerNotice("现在没有在运行的会话可插话。等主 Agent 跑起来，输入即插话；或按 Ctrl/Cmd+Enter 排队到下一轮。");
      return;
    }
    const body = sideQuestionBody(text);
    if (body === "") return;
    // 插话不带附件：旁路问答端口不收附件（旧页 useSideQuestions 也没有附件参数）。
    if (attachments.length > 0) {
      setSendError("插话不能带附件，请先去掉附件；要连附件一起发就排队到下一轮。");
      return;
    }
    setSendError(null);
    setSteerNotice(null);
    void sideSubmit.ask(body).then((accepted) => {
      if (!accepted) {
        // 失败留稿：`sideSubmit.error` 已经进了提示行，稿子不清。
        setSendError(sideSubmit.error ?? "插话发送失败");
        return;
      }
      editorRef.current?.clear();
      setDraft("");
      applyHit(null);
      toast(`已插话给主 Agent（不打断当前工作）`);
    });
  };

  const submit = (): void => {
    if (taskId === null) return;
    // `/btw` 兼容接管：无论运行与否，敲了前缀就按插话语义走（旧行为保留）。
    if (isSideQuestionCommand(draft)) {
      submitSteer(draft.trim());
      return;
    }
    // 运行中且有草稿：普通 Enter = 插话（DSH submission-policy 的 steer 分支）；没有
    // 插话目标（主 Agent 没在跑）时维持排队。发送中的请求期缓存 Enter 排队不变。
    if (running && !sending && steerAvailable) {
      submitSteer(draft.trim());
      return;
    }
    if (running || sending) {
      enqueueDraft();
      return;
    }
    if (!canSubmit) return;
    // An explicit send after a stop restarts delivery: rows kept by the stop
    // (DSH `keepInbox`) drain again once this new turn settles.
    queue.release();
    setSending(true);
    setSendError(null);
    // Only ready drafts go on the wire; the send gate above guarantees none is
    // still uploading, so this is the whole list. Size is the browser's exact
    // byte count (the source sends its draft descriptors the same way).
    const sendAttachments = attachments.flatMap((item) =>
      item.status === "ready" && item.path !== undefined
        ? [{ name: item.name, path: item.path, size: item.size }]
        : [],
    );
    sendChat(draft.trim(), taskId, sendAttachments)
      .then(() => {
        editorRef.current?.clear();
        setDraft("");
        applyHit(null);
        draftAttachments.clear();
        // 202 accepted: the turn now runs asynchronously on the backend, so the
        // primary seat becomes Stop instead of falling back to Send.
        chatRun.start();
        onSent?.();
      })
      .catch((reason: unknown) => setSendError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSending(false));
  };

  /**
   * 运行中把草稿排到下一轮（DSH 排队语义）：插话是 Enter 的默认，排队保留在
   * Ctrl/Cmd+Enter。主按钮在排队场景（无可插话目标）下仍走 `submit` 的排队分支。
   */
  const submitQueueGesture = (): void => {
    if (taskId === null) return;
    if (isSideQuestionCommand(draft)) {
      submitSteer(draft.trim());
      return;
    }
    enqueueDraft();
  };

  /** Stop the turn in flight; a failed request surfaces through the notice row. */
  const stop = (): void => {
    if (stopping || taskId === null) return;
    // DSH cancels with `keepInbox: true` (`session-controller/src/commands.ts:538`):
    // the stopped turn's end must not auto-send the queued rows.
    queue.noteStop();
    setStopping(true);
    setSendError(null);
    chatRun
      .stop()
      .then(() => {
        // Still running: the status poll owns the switch back to Send. Already
        // idle (stopped during the send request): nothing else flips `running`,
        // so release the control here.
        if (!runningRef.current) setStopping(false);
      })
      .catch((reason: unknown) => {
        setStopping(false);
        setSendError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  // Esc Esc: two Escape presses within DOUBLE_ESCAPE_MS while this task's turn
  // runs stop it through the same call as the Stop seat. A single press never
  // acts; it only arms the short window. Conditions mirror the source's
  // `stop-shortcut.ts` fixed-input filter: repeated and IME-composing presses are
  // ignored, chords carrying Ctrl/Alt/Shift/Meta are ignored, an already-consumed
  // press is ignored, and the sequence is bound to one task (a switch or the run
  // ending disarms it). Simplification vs the source: a press inside a modal
  // dialog does not arm or stop (the source additionally scopes by conversation
  // occurrence/region and excludes approval keys, terminals, and iframes; the /v2
  // shell has none of those in the composer scope).
  const stopRef = React.useRef(stop);
  React.useEffect(() => {
    stopRef.current = stop;
  });
  const escapePressRef = React.useRef<{ readonly taskId: string; readonly deadline: number } | null>(null);
  React.useEffect(() => {
    escapePressRef.current = null;
    if (!running || taskId === null) return;
    const activeTask = taskId;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.repeat) return;
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"], [aria-modal="true"]') !== null) return;
      const now = performance.now();
      const first = escapePressRef.current;
      if (first !== null && first.taskId === activeTask && now <= first.deadline) {
        // Second press inside the window: consume it and stop the turn once.
        escapePressRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        stopRef.current();
        return;
      }
      escapePressRef.current = { taskId: activeTask, deadline: now + DOUBLE_ESCAPE_MS };
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      escapePressRef.current = null;
    };
  }, [running, taskId]);

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const native = event.nativeEvent;
    const composing = native.isComposing || native.keyCode === 229 || (editorRef.current?.recentlyComposing() ?? false);
    // Alt/AltGraph and the Ctrl+Meta/Shift+Ctrl(Meta) chords stay with the
    // platform: consume the Enter they belong to so no line break slips in.
    if (
      native.altKey ||
      native.getModifierState("AltGraph") ||
      (native.ctrlKey && native.metaKey) ||
      (native.shiftKey && (native.ctrlKey || native.metaKey))
    ) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      // During composition the IME owns Enter and Shift+Enter: leave both native.
      if (event.shiftKey) {
        if (composing) return;
        // The source lets the browser insert the line break; the plain-text
        // surface runs the browser's own line-break editing command, which
        // keeps the caret on the new line and the next keystroke continuous.
        event.preventDefault();
        editorRef.current?.insertLineBreak();
        return;
      }
      if (composing) return;
      // W-2：运行中 Ctrl/Cmd+Enter 永远是排队（插话是默认的普通 Enter），
      // 对齐 DSH 的加速 Enter 家族（`hub.ts:230` 的 shell.submit('queue', 'click', true)）。
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (event.repeat) return;
        submitQueueGesture();
        return;
      }
      if (menuOpen) {
        event.preventDefault();
        commitActive();
        return;
      }
      event.preventDefault();
      if (event.repeat) return; // held-down Enter must not machine-gun sends
      submit();
      return;
    }
    if (composing) return;
    if (!menuOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      commitActive();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  };

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const clipboard = event.clipboardData;
    const files = Array.from(clipboard.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      uploadFiles(files);
      return;
    }
    const text = clipboard.getData("text/plain");
    if (text === "") return;
    // Rich clipboard content never reaches the draft: only its plain-text form does.
    event.preventDefault();
    editorRef.current?.insertPlainText(text);
  };

  /** Toolbar presses keep the keyboard in the draft, as the source composer does. */
  const keepEditorFocus = (event: React.MouseEvent): void => {
    event.preventDefault();
    editorRef.current?.focus();
  };

  /** A press on the card's chrome (not a control) returns the caret to the draft. */
  const onCardMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, a, input, select, textarea, [role="button"], [contenteditable], [tabindex]') !== null)
      return;
    event.preventDefault();
    editorRef.current?.focus();
  };

  // The primary seat follows DSH's label priority (`InputBar.tsx:386-394` + our
  // W-2 split): a running turn with an empty draft stops; a running turn with a
  // draft steers it into the live turn ("插话发送", the side-question channel:
  // `submission-policy.ts:36` resolves running+steer-capable to the preferred
  // mode, and Ctrl/Cmd+Enter keeps queue available); when no steer target
  // exists the same seat queues ("排队发送", `locales.ts:32`). A request in
  // flight shows its spinner; otherwise the seat sends.
  const hasDraft = draft.trim() !== "";
  const primaryStops = running && !sending && !hasDraft;
  const primarySteers = running && !sending && hasDraft && steerAvailable;
  const primaryQueues = running && !sending && hasDraft && !steerAvailable;
  const primaryLabel = primaryStops
    ? "停止生成"
    : primarySteers
      ? "插话发送"
      : primaryQueues
        ? "排队发送"
        : sending
          ? "正在发送消息"
          : "发送消息";
  const primaryDisabled = primaryStops ? stopping : primarySteers || primaryQueues ? false : !canSubmit;
  const primaryActs = primaryStops ? stop : primarySteers ? () => submit() : submit;
  // Independent Stop: only while the send request itself is in flight, matching the
  // source's `interruptible` minus the continuable-child arm (`InputBar.tsx:383`). A
  // running turn with a draft keeps queueing on the primary seat instead.
  const interruptVisible = sending && !running;
  const notice = sendError ?? chatRun.error;

  return (
    <div className={css.wrap}>
      <GoalBar goal={goalState} actions={goalActions} />

      {hit !== null && hit.trigger === "@" ? (
        <MentionMenu
          state={mentions}
          activeIndex={active}
          onHover={setActiveIndex}
          onPick={pickMention}
          onRetry={mentions.reload}
        />
      ) : hit !== null && slashMenuOpen ? (
        <div className={css.triggerMenu} role="listbox" aria-label="指令">
          <div className={css.triggerHead}>指令</div>
          {slashCandidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`${css.triggerRow} ${index === active ? css.triggerRowActive : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(candidate.label)}
            >
              <span className={css.triggerLabel}>{candidate.label}</span>
              {"desc" in candidate ? <span className={css.triggerDesc}>{candidate.desc}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the card only redirects
          pointer presses on its own chrome back to the draft; the editable and the
          toolbar controls keep their own semantics. */}
      <div className={css.composer} data-composer-panel="" onMouseDown={onCardMouseDown}>
        <QueueDock rows={queue.items} onRemove={queue.remove} held={queue.hold === "stopped"} />

        {/* W-2：插话问答栈——问题、回答中/终态、答案就地展开，跑的时候一直可见。 */}
        <SteeringDock
          history={sideHistory}
          onCancel={async (id) => {
            const failure = await cancelSideQuestion(taskId ?? "", "main", "cancel", id);
            if (failure !== null) setSteerNotice(failure);
            sideHistory.reload();
            return failure === null;
          }}
        />

        <ComposerAttachments
          attachments={attachments}
          onRemove={draftAttachments.removeAttachment}
          onRetry={draftAttachments.retryAttachment}
        />

        <ComposerEditor
          placeholder={PLACEHOLDER}
          editable={!sending}
          showPlaceholder={draft === "" && attachments.length === 0}
          handleRef={editorRef}
          onDraftChange={handleDraftChange}
          onKeyDown={handleEditorKeyDown}
          onPaste={handleEditorPaste}
        />

        <div className={css.row}>
          <div className={css.tools}>
            <Menu
              open={attachOpen}
              anchor={
                <button
                  type="button"
                  className={css.add}
                  aria-label="添加附件"
                  aria-haspopup="menu"
                  aria-expanded={attachOpen}
                  aria-busy={uploading ? true : undefined}
                  data-uploading={uploading ? "" : undefined}
                  title="添加附件"
                  onMouseDown={keepEditorFocus}
                  onClick={() => setAttachOpen((open) => !open)}
                >
                  <IconPlusOutlineRegular size={14} />
                </button>
              }
              items={[
                { id: "upload", label: "上传文件" },
                { id: "workspace", label: "引用工作区文件" },
              ]}
              onSelect={(id) => {
                setAttachOpen(false);
                if (id === "upload") {
                  if (taskId === null) {
                    setSendError("先选择一个任务再上传附件");
                    return;
                  }
                  fileInputRef.current?.click();
                  return;
                }
                if (id === "workspace") setPickerOpen(true);
              }}
              onClose={() => setAttachOpen(false)}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                uploadFiles(files);
              }}
            />
            <Menu
              open={pickerOpen}
              anchor={<span hidden />}
              items={fileOptions.map((option) => ({ id: option.id, label: option.label }))}
              onSelect={(id) => {
                setPickerOpen(false);
                editorRef.current?.insertPlainText(`@${id} `);
                editorRef.current?.focus();
              }}
              onClose={() => setPickerOpen(false)}
            />

            <div className={css.modes}>
              <Menu
                open={permissionOpen}
                anchor={
                  <button
                    type="button"
                    className={css.chip}
                    aria-haspopup="menu"
                    aria-expanded={permissionOpen}
                    onMouseDown={keepEditorFocus}
                    onClick={() => setPermissionOpen((open) => !open)}
                  >
                    {permissionLabel} <IconChevronDownOutlineRegular size={10} />
                  </button>
                }
                items={PERMISSIONS.map((entry) => ({ id: entry.id, label: entry.label }))}
                selectedId={permission}
                selection="check"
                onSelect={(id) => {
                  setPermissionOpen(false);
                  // Full access is gated behind an acknowledgement dialog.
                  if (id === "danger-full") {
                    setAcknowledged(false);
                    setConfirmFull(true);
                    return;
                  }
                  setPermission(id);
                  onPermissionChange?.(id);
                }}
                onClose={() => setPermissionOpen(false)}
              />
            </div>
          </div>

          <div className={css.trailing}>
            <div className={css.standardControls}>
              <ModelPicker models={modelOptions} phase={profilesState.phase} />
            </div>

            {interruptVisible ? (
              <button
                type="button"
                className={css.primary}
                aria-label="停止生成"
                title="停止生成"
                aria-busy={stopping ? true : undefined}
                data-independent-stop=""
                data-running={stopping ? undefined : ""}
                data-stopping={stopping ? "" : undefined}
                disabled={stopping}
                onMouseDown={keepEditorFocus}
                onClick={stop}
              >
                <StopGlyph />
              </button>
            ) : null}

            <button
              type="button"
              className={css.primary}
              aria-label={primaryLabel}
              aria-busy={sending ? true : undefined}
              title={primaryLabel}
              data-composer-primary=""
              data-sending={sending ? "" : undefined}
              data-running={primaryStops && !stopping ? "" : undefined}
              data-stopping={primaryStops && stopping ? "" : undefined}
              data-queued={primaryQueues ? "" : undefined}
              data-steers={primarySteers ? "" : undefined}
              disabled={primaryDisabled}
              onMouseDown={keepEditorFocus}
              onClick={primaryActs}
            >
              {primaryStops ? (
                <StopGlyph />
              ) : sending ? (
                <svg className={css.sendingSpinner} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
                  <path
                    d="M8 2a6 6 0 0 1 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <IconSendOutlineRegular size={15} />
              )}
            </button>
          </div>
        </div>

        {notice !== null ? (
          <div className={css.notice} role="alert">
            {notice}
          </div>
        ) : null}

        {/* 插话不可用时（/btw 兼容路径敲进空闲会话）的原因提示；Enter 本身不会走到这。 */}
        <SideQuestionNotice reason={steerNotice} onDismiss={() => setSteerNotice(null)} />
      </div>

      <Modal
        open={confirmFull}
        onClose={() => setConfirmFull(false)}
        closeLabel="关闭"
        title="确认启用完全权限？"
        description="启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmFull(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!acknowledged}
              onClick={() => {
                setPermission("danger-full");
                onPermissionChange?.("danger-full");
                setConfirmFull(false);
              }}
            >
              启用完全权限
            </Button>
          </>
        }
      >
        <label className={css.ackRow}>
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          我已了解风险，并愿意继续
        </label>
      </Modal>
    </div>
  );
}
