"use client";

/**
 * Adapter for message-level feedback (Like/Dislike + category + text).
 *
 * One record per (task, session_key, message_seq) in the backend, so clicking the
 * rating that is already recorded retracts it and clicking the other one opens
 * the form that overwrites it. The whole task's records are read once and seed
 * every message's button state, so a reload restores the solid rating instead of
 * hiding the fact behind hover state.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Activity, MessageFeedback, MessageFeedbackRating } from "@/lib/types";

/** Category ids offered by the feedback form, in display order. */
export const FEEDBACK_CATEGORIES: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "task-result", label: "任务结果" },
  { id: "instruction-following", label: "指令理解与遵循" },
  { id: "product-interaction", label: "产品功能与交互" },
  { id: "service-stability", label: "稳定性和速度" },
  { id: "resource-cost", label: "资源使用与费用" },
  { id: "security-privacy-permission", label: "安全隐私与权限" },
  { id: "other", label: "其他" },
];

/** One record's identity, mirroring the backend's unique key. */
export function feedbackKey(sessionKey: string, seq: number): string {
  return `${sessionKey}|${seq}`;
}

/**
 * Resolve the session key an activity row is recorded under.
 * @param activity - any activity row of the task.
 * @returns `main:<seg>` for main-agent rows, `plan` for the planner, `intent:<id>` for a worker.
 */
export function sessionKeyOf(
  activity: Pick<Activity, "worker" | "kind" | "main_seg" | "intent_id">,
): string {
  if (activity.worker === "system") return "system";
  if (activity.worker === "mainagent") return `main:${activity.main_seg ?? 0}`;
  if (activity.worker === "planner") return "plan";
  if (activity.intent_id !== undefined && activity.intent_id !== "") return `intent:${activity.intent_id}`;
  return activity.worker;
}

export interface TaskFeedbackState {
  /** Records of this task, keyed by {@link feedbackKey}. */
  readonly byKey: Readonly<Record<string, MessageFeedback>>;
  /** Re-read every record of the task. */
  readonly reload: () => void;
}

/**
 * Read the task's feedback records once and keep them addressable per message.
 * @param taskId - selected task, or null while nothing is open.
 * @returns the records by key and a reload callback.
 */
export function useTaskFeedback(taskId: string | null): TaskFeedbackState {
  const [byKey, setByKey] = useState<Record<string, MessageFeedback>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) {
      setByKey({});
      return;
    }
    let alive = true;
    api
      .messageFeedback(taskId)
      .then((items) => {
        if (!alive) return;
        const next: Record<string, MessageFeedback> = {};
        for (const item of items) next[feedbackKey(item.session_key, item.message_seq)] = item;
        setByKey(next);
      })
      .catch(() => {
        // A failed read must not invent ratings: keep the last known snapshot.
      });
    return () => {
      alive = false;
    };
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { byKey, reload };
}

/** One message's rating to write; the form supplies category and text. */
export interface FeedbackInput {
  readonly sessionKey: string;
  readonly seq: number;
  readonly rating: MessageFeedbackRating;
  readonly category: string | null;
  readonly text: string;
}

/**
 * Write (or overwrite) one message's rating.
 * @param taskId - task the message belongs to.
 * @param input - message identity, rating, category and text.
 * @returns the stored record.
 */
export function putFeedback(taskId: string, input: FeedbackInput): Promise<MessageFeedback> {
  return api.putMessageFeedback(taskId, {
    session_key: input.sessionKey,
    message_seq: input.seq,
    rating: input.rating,
    category: input.category,
    text: input.text,
  });
}

/**
 * Retract one message's rating.
 * @param taskId - task the message belongs to.
 * @param seq - message sequence.
 * @param sessionKey - session the message was recorded under.
 */
export async function deleteFeedback(taskId: string, seq: number, sessionKey: string): Promise<void> {
  await api.deleteMessageFeedback(taskId, seq, sessionKey);
}
