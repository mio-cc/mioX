"use client";

/**
 * Adapter for editing a sent human message: rewind the lane to just before that
 * message, then resend the edited text through the normal chat turn.
 *
 * `POST /chat` answers 202 and the turn runs asynchronously, so rewinding while a
 * turn is in flight would delete a tail the running turn keeps writing to and the
 * resend would be rejected with 409. The wait below is the old workspace's guard:
 * poll `chat/status` until the backend reports idle, then truncate and send.
 */
import { api } from "@/lib/api";

/** Poll cadence of the idle wait. */
const IDLE_POLL_MS = 400;

/**
 * Wait until the task's backend turn is idle.
 * @param taskId - task whose turn is being waited on.
 * @param timeoutMs - give up after this long.
 * @returns whether the backend reported idle before the deadline.
 */
export async function waitForIdle(taskId: string, timeoutMs = 90000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await api.chatStatus(taskId).catch(() => null);
    if (status !== null && !status.running) return true;
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
  }
  return false;
}

export interface EditResendInput {
  readonly taskId: string;
  /** Activity id of the human message being edited: the lane is rewound to it. */
  readonly seq: number;
  /** Main-agent segment the message belongs to. */
  readonly seg: number;
  /** Replacement text, already trimmed by the caller. */
  readonly text: string;
}

export interface EditResendResult {
  /** Rows the backend removed from the lane. */
  readonly removed: number;
  readonly seg: number;
}

/**
 * Rewind the main-agent lane to one message and resend the edited text.
 * @param input - task, message id, segment and replacement text.
 * @returns the truncation result.
 */
export async function editAndResend(input: EditResendInput): Promise<EditResendResult> {
  const idle = await waitForIdle(input.taskId);
  if (!idle) throw new Error("当前回合尚未结束，无法编辑重发");
  const result = await api.truncateChat(input.taskId, input.seq, input.seg);
  await api.chat(input.text, input.taskId, [], input.seg);
  return { removed: result.removed, seg: result.seg };
}
