"use client";

/**
 * Phase 3 probe page for the sidebar's building blocks: session rows in every
 * state, the workspace flow dialogs, and the brand mark.
 *
 * C09：探针页的任务行改为读**真实**任务列表（`useTasks` → `GET /tasks`），
 * 并按 P1:A30 的排序（置顶优先 + 本地拖动顺序）与 P1:A31 的详情面板渲染，
 * 四种状态（加载 / 失败可重试 / 无任务 / 有数据）齐全。旧页依据：
 * `app/(main)/function/tasks/page.tsx:281-305`（排序）、`:1287-1291`（详情入口）。
 *
 * C10（P1:A15 A16 A18 A20 A21）：加多选模式开关 + 每行勾选 + 「已选 N 条」工具条
 * （批量暂停 / 恢复 / 归档 / 删除带清理选项 / 移动分类）。旧页依据：
 * `app/(main)/function/tasks/page.tsx:406-451`（多选状态）、`:842-901`（工具条）。
 *
 * C12（P1:A2 A22–A25）：「当前 / 已归档」切换（切到「已归档」时渲染 `TaskArchiveView`：
 * 搜索 + 处理状态筛选 + 分页 + 单条还原 / 永久删除 / 失败重试 + 勾选批量还原 / 批量永久删除）。
 * 旧页依据：`app/(main)/function/tasks/page.tsx:783-788`（两个页签）、`:1651-1789`（归档面板）。
 */
import { useEffect, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { MioxMark } from "@/components/v2/sidebar/MioxMark";
import { TaskArchiveView, type TaskListView } from "@/components/v2/sidebar/TaskArchiveView";
import { TaskBulkBar, useTaskMultiSelect } from "@/components/v2/sidebar/TaskBulkBar";
import { TaskDetailPanel } from "@/components/v2/sidebar/TaskDetailPanel";
import { TaskList } from "@/components/v2/sidebar/TaskList";
import { TaskSelectToggle } from "@/components/v2/sidebar/TaskSelectToggle";
import { WorkspaceFlow } from "@/components/v2/sidebar/WorkspaceFlow";
import type { Session } from "@/components/v2/sidebar/SessionRow";
import { archiveTasks, deleteTask, pinTask, renameTask } from "@/v2/data/task-actions";
import { useTasks } from "@/v2/data/tasks";
import { tasksToSessions } from "@/v2/data/tasks-map";

type Flow = { kind: "add" } | { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

export default function SidebarPage() {
  const taskState = useTasks();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>(null);
  // C12 P1:A2：「当前 / 已归档」视图（纯本地状态；切换条由 TaskList 渲染）。
  const [view, setView] = useState<TaskListView>("current");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const workspaces = [{ id: "default", title: "默认工作区" }];
  const tasks = taskState.tasks ?? [];
  const selection = useTaskMultiSelect(taskState.tasks);
  const sessionsById = new Map(tasksToSessions(tasks).map((row) => [row.id, row]));
  const fallback = detailId === null ? null : (tasks.find((task) => task.id === detailId) ?? null);

  // 旧页的置顶 / 重命名 / 归档 / 删除是真接口，本探针页沿用同一封装（一对一转发，不重试）。
  const onRowChange = (id: string, patch: Partial<Session> | "remove"): void => {
    if (patch === "remove") {
      void deleteTask(id, {
        delete_assets: false,
        delete_traffic: false,
        delete_files: false,
        delete_findings: false,
        delete_llm_records: false,
      })
        .then(() => {
          selection.forget([id]);
          taskState.reload();
        })
        .catch(() => undefined);
      return;
    }
    if (patch.pinned !== undefined) {
      void pinTask(id, patch.pinned)
        .then(() => taskState.reload())
        .catch(() => undefined);
      return;
    }
    if (patch.label !== undefined) {
      void renameTask(id, patch.label)
        .then(() => taskState.reload())
        .catch(() => undefined);
      return;
    }
    if (patch.archived === true) {
      void archiveTasks([id])
        .then(() => {
          selection.forget([id]);
          taskState.reload();
        })
        .catch(() => undefined);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 40px",
        background: "var(--dsw-alias-bg-module-platform, #f2f3f5)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <MioxMark size={20} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>侧栏构件</h1>
      </div>
      <p style={{ margin: "0 0 20px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
        真实任务行（置顶/运行中/已归档/状态与进度）+ 拖动排序 + 任务详情 + 工作区流程 + 品牌标记。
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <Button variant="outline" size="sm" onClick={() => setFlow({ kind: "add" })}>添加工作区</Button>
        <Button variant="outline" size="sm" onClick={() => setFlow({ kind: "rename", id: "default" })}>重命名工作区</Button>
        <Button variant="outline" size="sm" onClick={() => setFlow({ kind: "delete", id: "default" })}>删除工作区</Button>
        <Button variant="outline" size="sm" disabled={taskState.phase === "loading"} onClick={taskState.reload}>
          重新读取任务
        </Button>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TaskSelectToggle
            active={selection.active}
            onToggle={selection.setActive}
            total={tasks.length}
            selected={selection.ids.size}
            onSelectAll={(next) => {
              for (const task of tasks) selection.toggle(task.id, next);
            }}
            disabled={tasks.length === 0}
          />
        </span>
      </div>

      {selection.active ? (
        <TaskBulkBar tasks={tasks} selection={selection} onChanged={taskState.reload} />
      ) : null}

      <div style={{ width: 300, padding: 8, borderRadius: 12, background: "var(--dsw-alias-bg-layer-1, #fff)" }}>
        {view === "archived" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Button variant="ghost" size="sm" onClick={() => setView("current")}>
              ← 返回当前任务
            </Button>
            <TaskArchiveView onChanged={taskState.reload} />
          </div>
        ) : !mounted || taskState.phase === "loading" ? (
          <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
            读取任务…
          </div>
        ) : taskState.phase === "offline" ? (
          <div role="alert" style={{ padding: "6px 8px", fontSize: 12, color: "var(--dsw-alias-text-danger, #d93025)" }}>
            读取失败：{taskState.error}
            <Button variant="outline" size="sm" onClick={taskState.reload}>重试</Button>
          </div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
            暂无任务
          </div>
        ) : (
          <TaskList
            tasks={tasks}
            activeId={activeId}
            onSelect={setActiveId}
            onChange={onRowChange}
            toSession={(task) => sessionsById.get(task.id) ?? { id: task.id, label: task.description, time: "" }}
            selectable={selection.active}
            selectedIds={selection.ids}
            onSelectionChange={selection.toggle}
            view={view}
            onViewChange={setView}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <Button
          variant="outline"
          size="sm"
          disabled={activeId === null}
          onClick={() => setDetailId(activeId)}
        >
          查看选中任务详情
        </Button>
      </div>

      {mounted && detailId !== null ? (
        <div style={{ width: 300, marginTop: 12, borderRadius: 12, overflow: "hidden" }}>
          <TaskDetailPanel
            taskId={detailId}
            fallback={fallback}
            onClose={() => setDetailId(null)}
            onChanged={taskState.reload}
          />
        </div>
      ) : null}

      {mounted ? (
        <WorkspaceFlow
          open={flow}
          onClose={() => setFlow(null)}
          workspaces={workspaces}
          onCreate={() => setFlow(null)}
          onRename={() => setFlow(null)}
          onDelete={() => setFlow(null)}
        />
      ) : null}
    </main>
  );
}
