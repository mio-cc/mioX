/**
 * Map backend tasks onto the session rows the sidebar renders.
 * Kept pure so the mapping can be checked without a running backend.
 *
 * C09（P1:A30）在 `Session` 上补了行内字段：状态、目标进度、发现分档、运行时长、
 * token、最近活动、是否后端活动任务，全部取自 `Task`（types.ts:7-54）已有字段，
 * 照旧页 `page.tsx:1194-1284` 的列。拿不到的字段留 undefined，行组件就不画。
 */
import type { Task } from "@/lib/types";
import type { Session } from "@/components/v2/sidebar/SessionRow";
import {
  findingsBreakdown,
  formatTaskDuration,
  goalsProgressText,
  taskActivityUnix,
  taskDurationSeconds,
  taskIsPinned,
} from "@/v2/data/tasks";

/** Compact relative time from a unix-seconds timestamp. */
function relative(unix: number | undefined): string {
  if (unix === undefined || unix <= 0) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

/**
 * Project tasks into sidebar rows.
 * @param tasks - backend task list, already ordered by the server.
 * @returns rows for `SessionRow`; labels fall back to the description.
 */
export function tasksToSessions(tasks: readonly Task[]): Session[] {
  const nowUnix = Math.floor(Date.now() / 1000);
  return tasks.map((task) => {
    const findings = findingsBreakdown(task);
    return {
      id: task.id,
      label: (task.name !== undefined && task.name !== "" ? task.name : task.description).slice(0, 60),
      time: relative(task.last_activity_unix),
      pinned: taskIsPinned(task),
      running: task.status === "running",
      unread: false,
      // C09 行内补齐（全部来自 Task 的真实字段）：
      description: task.description,
      status: task.status,
      goals: goalsProgressText(task),
      findings: findings === null ? undefined : `${findings.critical}/${findings.high}/${findings.medium}/${findings.low}`,
      findingsTitle:
        findings === null || findings.total === 0
          ? undefined
          : `严重 ${findings.critical} · 高 ${findings.high} · 中 ${findings.medium} · 低 ${findings.low}`,
      inFlight: task.in_flight !== undefined && task.in_flight > 0 ? String(task.in_flight) : "0",
      duration: formatTaskDuration(taskDurationSeconds(task, nowUnix)),
      tokens:
        task.tokens === undefined
          ? undefined
          : `入 ${task.tokens.input_tokens} · 缓 ${task.tokens.cache_read_tokens} · 出 ${task.tokens.output_tokens}`,
      activity: taskActivityUnix(task) > 0 ? relative(taskActivityUnix(task)) : undefined,
      active: task.active === true,
    };
  });
}
