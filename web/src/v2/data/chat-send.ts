/**
 * Chat turn submission for the composer and its queue.
 *
 * Thin forward to `@/lib/api`: the same arguments, the same 202 payload, the
 * same rejection. The callers decide what an accepted turn means (the composer
 * flips its primary seat to Stop), so nothing is interpreted here.
 */
import { api } from "@/lib/api";
import type { ChatAttachment } from "@/lib/types";

/** Result of `POST /chat`: the accepted turn's mode. */
export type ChatSendResult = Awaited<ReturnType<typeof api.chat>>;

/**
 * Send one chat turn.
 * @param message - message text (already trimmed by the caller).
 * @param task - task the turn belongs to; omitted = backend's default task.
 * @param attachments - uploaded files already stored by the backend.
 * @param seg - main-session segment the turn belongs to.
 * @param reasoningEffort - per-turn effort override; empty = inherit the profile.
 * @returns `{ reply, mode }` once the backend accepts the turn.
 */
export function sendChat(
  message: string,
  task?: string,
  attachments?: ChatAttachment[],
  seg?: number,
  reasoningEffort?: string,
): Promise<ChatSendResult> {
  return api.chat(message, task, attachments, seg, reasoningEffort);
}
