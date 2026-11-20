"use client";

/**
 * 命令面板（Ctrl / Cmd+K）：一个 Modal 里同时搜「页面」与「任务」，↑↓ 选择、Enter 执行、Esc 关闭。
 * 旧页面依据：`ARTEX/web/src/app/(main)/_components/sidebar/new-sidebar.tsx:1217`（搜索入口把
 *   侧栏切成搜索态）、`:1313`、`:1326`（全局面板 / 命令项渲染与选中执行）。
 * DSH 依据：DSH 无命令面板，按总表 §4「侧栏」扩展；Modal / Input 用
 *   `@/vendor/dsh/primitives/*`（`vendor/dsh/primitives/Modal.tsx:51`、`Input.tsx:15`）。
 * 对照表行：P1:E5
 *
 * 两条结果来源都是真实数据，不新增接口、不造样例：
 *   1. 页面：`listMainPages()`（`v2/data/pages.ts:171`，与左栏导航同一份 PAGES 注册表）；
 *   2. 任务：`taskState.tasks`（`useTasks()` → `GET /tasks`，`v2/data/tasks.ts:35`），
 *      由 Shell 传进来，避免面板自己再发一次列表请求。
 *
 * 键盘归属：Escape 由 `Modal` 的 `useModalLayer` 顶层处理（`useModalLayer.ts:75-78`），
 * ↑↓ / Enter 由本组件自己的输入框 handler 处理，所以面板里不会再绑全局 keydown。
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { IconSearchOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import type { Task } from "@/lib/types";
import type { MainPage } from "@/v2/data/pages";
import { taskDisplayName } from "@/v2/data/tasks";

import css from "./CommandPalette.module.css";

/** 面板里一条可执行结果。 */
type PaletteItem =
  | { kind: "page"; key: string; label: string; hint: string; pageId: string }
  | { kind: "task"; key: string; label: string; hint: string; taskId: string };

export interface CommandPaletteProps {
  /** 是否打开。 */
  open: boolean;
  /** 关闭（Esc / 点遮罩 / 执行完一项）。 */
  onClose: () => void;
  /** 页面来源：`listMainPages()` 的返回值，与左栏导航同源。 */
  pages: readonly MainPage[];
  /** 任务来源：`useTasks().tasks`；null 表示还没读到（面板显示真实空状态）。 */
  tasks: readonly Task[] | null;
  /** 任务列表读取阶段，用来区分「读取中」「未连接」与真正的「暂无任务」。 */
  tasksPhase: "loading" | "ready" | "offline";
  /** 选中一个页面（Shell 的 `selectPage`，写 `?page=`）。 */
  onSelectPage: (id: string) => void;
  /** 选中一个任务（Shell 里 `setActive` + `selectPage(null)`）。 */
  onSelectTask: (id: string) => void;
}

/**
 * 大小写无关的子串匹配；空查询匹配全部。
 * @param needle - 已 trim 的查询串。
 * @param haystack - 参与匹配的文字。
 * @returns 是否命中。
 */
function matches(needle: string, haystack: string): boolean {
  if (needle === "") return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * 命令面板。
 * @param props.open - 是否打开。
 * @param props.onClose - 关闭回调。
 * @param props.pages - 页面注册表。
 * @param props.tasks - 任务列表（真实 `GET /tasks` 结果）。
 * @param props.tasksPhase - 任务列表阶段。
 * @param props.onSelectPage - 页面跳转。
 * @param props.onSelectTask - 任务跳转。
 * @returns 面板；关闭时 `Modal` 自己返回 null。
 */
export function CommandPalette({
  open,
  onClose,
  pages,
  tasks,
  tasksPhase,
  onSelectPage,
  onSelectTask,
}: CommandPaletteProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 每次打开都回到空查询与第一项，避免上次的过滤词把结果藏起来。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const needle = query.trim();
    const rows: PaletteItem[] = [];
    for (const page of pages) {
      if (page.when !== undefined && !page.when()) continue;
      if (!matches(needle, page.label) && !matches(needle, page.id) && !matches(needle, page.group)) continue;
      rows.push({ kind: "page", key: `page:${page.id}`, label: page.label, hint: page.group, pageId: page.id });
    }
    for (const task of tasks ?? []) {
      const label = taskDisplayName(task);
      if (!matches(needle, label) && !matches(needle, task.description) && !matches(needle, task.id)) continue;
      const category = task.category_name !== undefined && task.category_name !== "" ? task.category_name : "";
      rows.push({
        kind: "task",
        key: `task:${task.id}`,
        label,
        hint: category === "" ? `#${task.id}` : `${category} · #${task.id}`,
        taskId: task.id,
      });
    }
    return rows;
  }, [pages, query, tasks]);

  // 结果集变化（输入 / 任务列表刷新）后把光标收回到第一条，避免指向已不存在的行。
  const itemCount = items.length;
  useEffect(() => {
    setCursor(0);
  }, [itemCount, query]);

  const run = (item: PaletteItem | undefined): void => {
    if (item === undefined) return;
    onClose();
    if (item.kind === "page") onSelectPage(item.pageId);
    else onSelectTask(item.taskId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (items.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (current + 1) % items.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (current - 1 + items.length) % items.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(items[cursor]);
    }
  };

  // 键盘选中的行滚进视野（结果可能比面板高）。
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const row = list.querySelector<HTMLElement>('[data-palette-active="true"]');
    if (row !== null) row.scrollIntoView({ block: "nearest" });
  }, [cursor, items]);

  const pageCount = items.filter((item) => item.kind === "page").length;
  const taskCount = items.length - pageCount;

  return (
    <Modal open={open} onClose={onClose} title="命令面板" closeLabel="关闭">
      <div className={css.wrap} data-command-palette="">
        <Input
          value={query}
          aria-label="搜索页面与任务"
          placeholder="搜索页面或任务…"
          icon={<IconSearchOutlineRegular size={14} />}
          data-palette-input=""
          data-modal-autofocus=""
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={css.list} ref={listRef} role="listbox" aria-label="命令面板结果">
          {items.length === 0 ? (
            <div className={css.empty} role="status">
              没有匹配项
            </div>
          ) : (
            <>
              {pageCount > 0 ? <div className={css.groupLabel}>页面</div> : null}
              {items.map((item, index) => {
                const firstTask = item.kind === "task" && index === pageCount;
                return (
                  <React.Fragment key={item.key}>
                    {firstTask ? <div className={css.groupLabel}>任务</div> : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      data-palette-active={index === cursor ? "true" : "false"}
                      data-palette-kind={item.kind}
                      className={`${css.row} ${index === cursor ? css.rowActive : ""}`}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => run(item)}
                    >
                      <span className={css.rowLabel}>{item.label}</span>
                      <span className={css.rowHint}>{item.hint}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>
        {tasksPhase !== "ready" ? (
          <div className={css.phase}>
            {tasksPhase === "loading" ? "任务列表读取中…" : "未连接后端，只显示页面"}
          </div>
        ) : null}
        <div className={css.footer}>
          {items.length === 0 ? "0 项" : `页面 ${pageCount} · 任务 ${taskCount}`}
          <span className={css.keys}>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
        </div>
      </div>
    </Modal>
  );
}
