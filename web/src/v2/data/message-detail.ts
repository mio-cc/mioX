"use client";

/**
 * Adapter for one activity row's full payload.
 *
 * List endpoints omit `detail` (`server/dto.go:524`), so a card that wants to show
 * the complete recorded payload has to ask for that row. Used by the tool cards'
 * detail disclosure: the tool_use row and its matching tool_result are fetched
 * separately and shown together, the same way the old workspace's tool card did.
 */
import { api } from "@/lib/api";

/**
 * Read one activity row's detail blob.
 * @param taskId - task the activity belongs to.
 * @param seq - activity id.
 * @returns the recorded detail text, or "" when the row has none.
 */
export async function fetchActivityDetail(taskId: string, seq: number): Promise<string> {
  const result = await api.activityDetail(seq, taskId);
  return result?.detail ?? "";
}
