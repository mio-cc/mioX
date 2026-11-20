"use client";

/**
 * 自动化任务：/v2 内的任务总览（替代跳回旧版页面）。
 * 数据来自 GET /tasks，与侧栏同一份来源。
 */
import Link from "next/link";

import { useTasks } from "@/v2/data/tasks";

const STATUS_LABEL: Record<string, string> = {
  running: "运行中",
  done: "已完成",
  failed: "失败",
  paused: "已暂停",
  created: "已创建",
  queued: "排队中",
};

export default function TasksPage() {
  const state = useTasks();
  const rows = state.tasks ?? [];

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>任务</h1>
        <span style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
          {state.phase === "ready" ? `共 ${rows.length} 个` : state.phase === "loading" ? "读取中…" : "未连接后端"}
        </span>
        <Link
          href="/v2/shell"
          style={{ marginLeft: "auto", fontSize: 12, color: "var(--dsw-alias-label-secondary, #3c4048)" }}
        >
          打开对话界面 →
        </Link>
      </div>

      {state.phase === "offline" ? (
        <p style={{ marginTop: 20, fontSize: 13, color: "var(--dsw-alias-text-danger, #d93025)" }}>
          未连接后端（读不到任务列表）
        </p>
      ) : null}

      {state.phase === "ready" && rows.length === 0 ? (
        <p style={{ marginTop: 20, fontSize: 13, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>暂无任务</p>
      ) : null}

      <div style={{ marginTop: 20, display: "grid", gap: 8, maxWidth: 860 }}>
        {rows.map((task) => {
          const name = task.name !== undefined && task.name !== "" ? task.name : task.description;
          return (
            <div
              key={task.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "0.5px solid var(--dsw-alias-border-l1, #e5e7eb)",
                borderRadius: 10,
                background: "var(--dsw-alias-bg-layer-1, #f7f7f8)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: task.status === "running" ? "var(--dsw-alias-brand-primary, #4d6bfe)" : "#2f9e44",
                }}
              />
              <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
                {STATUS_LABEL[task.status] ?? task.status} · 目标 {task.goals_met ?? 0}/{task.goals_total ?? 0}
              </span>
            </div>
          );
        })}
      </div>
    </main>
  );
}
