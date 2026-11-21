/**
 * Per-task reasoning-effort choice made in the composer's model menu.
 *
 * The backend takes it per chat turn (`POST /chat {reasoning_effort}`, applied to
 * that turn's main-agent calls only — server.go startTaskChatTurn), so the choice
 * lives client-side: remembered per task in localStorage and attached to every
 * turn the composer or its queue sends. "" = follow the profile (send nothing).
 */
import * as React from "react";

const KEY = "miox.v2.turnEffort";
const EVENT = "miox:turn-effort";

function readAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * The effort choice for a task ("" when none).
 * @param taskId - task id; null → "".
 * @returns stored choice.
 */
export function turnEffortFor(taskId: string | null): string {
  if (taskId === null) return "";
  const value = readAll()[taskId];
  return typeof value === "string" ? value : "";
}

/**
 * Remember (or clear with "") the effort choice for a task.
 * @param taskId - task id.
 * @param value - effort value from the model's declared levels, or "".
 */
export function setTurnEffort(taskId: string, value: string): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  if (value === "") delete all[taskId];
  else all[taskId] = value;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage full / disabled: the choice still applies for this page via the event
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { taskId, value } }));
}

/**
 * Subscribe to a task's effort choice.
 * @param taskId - task id; null → "".
 * @returns the current choice, updated when any surface changes it.
 */
export function useTurnEffort(taskId: string | null): string {
  const [value, setValue] = React.useState(() => turnEffortFor(taskId));
  React.useEffect(() => {
    setValue(turnEffortFor(taskId));
    const sync = (): void => setValue(turnEffortFor(taskId));
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [taskId]);
  return value;
}
