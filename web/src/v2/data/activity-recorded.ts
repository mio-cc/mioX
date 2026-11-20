/** Activities shaped like the recorded transcripts, for mapper verification. */
import type { Activity } from "@/lib/types";

/**
 * Five tool calls whose `detail` JSON matches what the agent actually emits
 * (scanned from `data/transcripts/*.jsonl`), plus their results.
 */
export const RECORDED_SHAPES: Activity[] = [
  { seq: 1, worker: "mainagent", ts: "2026-11-16T09:25:23Z", kind: "text", summary: "先确认工作目录结构" },
  { seq: 2, worker: "mainagent", ts: "2026-11-16T09:25:30Z", kind: "tool_use", tool: "Bash", tool_use_id: "r1", summary: "ls -la", detail: JSON.stringify({ command: "ls -la", description: "列出目录" }) },
  { seq: 3, worker: "mainagent", ts: "2026-11-16T09:25:31Z", kind: "tool_result", tool: "Bash", tool_use_id: "r1", summary: "done", detail: JSON.stringify([{ type: "text", text: "total 8\ndrwxr-xr-x  4 user  staff  128 ." }]) },
  { seq: 4, worker: "mainagent", ts: "2026-11-16T09:25:40Z", kind: "tool_use", tool: "Read", tool_use_id: "r2", summary: "读配置文件", detail: JSON.stringify({ file_path: "config.json" }) },
  { seq: 5, worker: "mainagent", ts: "2026-11-16T09:25:41Z", kind: "tool_result", tool: "Read", tool_use_id: "r2", summary: "ok", detail: JSON.stringify([{ type: "text", text: "{\"database\":{\"dsn\":\"...\"}}" }]) },
  { seq: 6, worker: "mainagent", ts: "2026-11-16T09:25:50Z", kind: "tool_use", tool: "Glob", tool_use_id: "r3", summary: "找脚本", detail: JSON.stringify({ pattern: "**/*自研native*" }) },
  { seq: 7, worker: "mainagent", ts: "2026-11-16T09:25:51Z", kind: "tool_result", tool: "Glob", tool_use_id: "r3", summary: "2 files", detail: JSON.stringify([{ type: "text", text: "poc/a.sh\npoc/b.sh" }]) },
  { seq: 8, worker: "mainagent", ts: "2026-11-16T09:26:00Z", kind: "tool_use", tool: "Edit", tool_use_id: "r4", summary: "改超时", detail: JSON.stringify({ file_path: "poc/a.sh", old_string: "timeout=5", new_string: "timeout=15" }) },
  { seq: 9, worker: "mainagent", ts: "2026-11-16T09:26:01Z", kind: "tool_result", tool: "Edit", tool_use_id: "r4", summary: "ok", detail: JSON.stringify([{ type: "text", text: "updated" }]) },
  { seq: 10, worker: "mainagent", ts: "2026-11-16T09:26:10Z", kind: "tool_use", tool: "Write", tool_use_id: "r5", summary: "写报告", detail: JSON.stringify({ file_path: "report.md", content: "# 报告\n" }) },
  { seq: 11, worker: "mainagent", ts: "2026-11-16T09:26:11Z", kind: "tool_result", tool: "Write", tool_use_id: "r5", summary: "ok", detail: JSON.stringify([{ type: "text", text: "written" }]) },
];
