"use client";

/**
 * Phase 3 shell assembly: three columns (sidebar / main / right panel) driven by
 * the ported column solver, so the breakpoints behave like ui-lab's:
 *   ≥1024 → sidebar + main + right panel
 *   768–1023 → rail + main (right panel hidden)
 *   <768 → drawer (sidebar off-canvas) + main
 *
 * The middle column is the ported DSH conversation skeleton
 * (`components/v2/conversation/*`): the resident header's two chrome bands are
 * list slots (`conversation.header.actions` / `conversation.header.utilities`)
 * owned by the header and contributed here, above the View area and the
 * composer seat.
 */
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Composer } from "@/components/v2/composer/Composer";
import { ConversationRoot } from "@/components/v2/conversation/ConversationRoot";
import { ConversationUsageBar } from "@/components/v2/conversation/ConversationUsageBar";
import {
  JOBS_CHIP_ACTION,
  MORE_MENU_UTILITY,
  PLAN_MODE_ACTION,
  RIGHT_PANEL_TOGGLE_UTILITY,
  SCHEDULE_CLOCK_UTILITY,
} from "@/components/v2/conversation/headerSlotContributions";
import { RightPanel } from "@/components/v2/right-panel/RightPanel";
import type { SettingsSectionId } from "@/components/v2/settings/SettingsDialog";
import { SettingsDialog } from "@/components/v2/settings/SettingsDialog";
import { ToastHost, toast } from "@/components/v2/settings/Toast";
import { CommandPalette } from "@/components/v2/shell/CommandPalette";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Button } from "@/vendor/dsh/primitives/Button";
import { MioxMark } from "@/components/v2/sidebar/MioxMark";
import { NewTaskPage } from "@/components/v2/sidebar/NewTaskPage";
import type { Session } from "@/components/v2/sidebar/SessionRow";
import type { TaskListView } from "@/components/v2/sidebar/TaskArchiveView";
import { TaskArchiveView, TaskListSwitch } from "@/components/v2/sidebar/TaskArchiveView";
import { TaskBulkBar, useTaskMultiSelect } from "@/components/v2/sidebar/TaskBulkBar";
import { TaskCategoryGroups } from "@/components/v2/sidebar/TaskCategoryGroups";
import { TaskDetailPanel } from "@/components/v2/sidebar/TaskDetailPanel";
import { TaskList } from "@/components/v2/sidebar/TaskList";
import { TaskSelectToggle } from "@/components/v2/sidebar/TaskSelectToggle";
import type { Task } from "@/lib/types";
import { useActivities } from "@/v2/data/activity";
import { useChatRun } from "@/v2/data/chat-run";
import { useTaskGoal } from "@/v2/data/goal";
import type { MainPage } from "@/v2/data/pages";
import { findMainPage, listMainPages } from "@/v2/data/pages";
import {
  archiveTasks,
  deleteTask,
  listTasks,
  pauseTask as pauseTaskRequest,
  pinTask,
  renameTask,
  resumeTask as resumeTaskRequest,
  setTaskPermissionLevel,
  setTaskPlanMode,
} from "@/v2/data/task-actions";
import { NativeDirPicker } from "@/components/v2/sidebar/NativeDirPicker";
import { groupTasksByCategory, moveTaskToCategory } from "@/v2/data/task-categories";
import { useTaskCategories } from "@/v2/data/task-create";
import { setTaskTeamMode } from "@/v2/data/task-mode";
import {
  applyTaskOrder,
  readTaskOrder,
  sortTasks,
  type TaskSortPreference,
  useActiveTaskSync,
  useTasks,
} from "@/v2/data/tasks";
import { tasksToSessions } from "@/v2/data/tasks-map";
import { useUpdate } from "@/v2/data/update";
import {
  computeColumns,
  DRAWER_BREAKPOINT,
  RIGHTBAR_DEFAULT_RATIO,
  RIGHTBAR_MIN,
  SIDEBAR_DEFAULT,
  shouldAutoCollapse,
} from "@/v2/layout/columns";
import { SlotProvider, useSlotRegister } from "@/v2/slots";
import {
  IconAppsAddOutlineRegular,
  IconChevronsUpDownOutlineRegular,
  IconCloseOutlineRegular,
  IconDarkOutlineRegular,
  IconInfoOutlineRegular,
  IconLightOutlineRegular,
  IconNewChatOutlineRegular,
  IconPanelLeftOutlineRegular,
  IconProjectAddOutlineRegular,
  IconSearchOutlineRegular,
  IconSettingsOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Menu, type MenuEntry } from "@/vendor/dsh/primitives/Menu";
import { Tooltip } from "@/vendor/dsh/primitives/Tooltip";

import css from "./Shell.module.css";

/**
 * Menu entries for the sidebar's page launcher: one captioned run per registry group.
 *
 * DSH keeps the sidebar's navigation to a short pinned launcher list and moves the
 * rest behind one 「更多」 menu (`ui-sidebar/src/client/SidebarRoot.tsx:416-451`,
 * `PanelMoreMenu` `:124-144`), so the workspace region below gets the column's
 * remaining height (`:453-458`). mioX has twelve whole pages instead of DSH's three
 * panels, so all of them go behind the launcher, grouped by their registry caption.
 * The fixed 「插件」 row is gone with it: MCP lives in 设置, and one settings entry
 * is the only system surface the sidebar keeps (`102 §0 C`：与设置重复的入口不单占一行).
 * @param pages - Rows from `listMainPages()`.
 * @returns Label rows and page rows for `Menu`'s `items`.
 */
function pageMenuEntries(pages: readonly MainPage[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let group: string | null = null;
  for (const page of pages) {
    if (page.group !== group) {
      group = page.group;
      if (entries.length > 0) entries.push({ type: "separator", id: `sep:${group}` });
      entries.push({ type: "label", id: `label:${group}`, text: group });
    }
    entries.push({ id: page.id, label: page.label, icon: <page.Icon size={14} /> });
  }
  return entries;
}

type Flow = { kind: "add" } | { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

/**
 * Session-header contributions owned by the shell.
 *
 * The conversation header owns the two chrome bands
 * (`conversation.header.actions` / `conversation.header.utilities`); the shell
 * is their contributor. Registrations live exactly as long as this component is
 * mounted inside the slot provider, so unmounting the shell disposes all four
 * entries.
 * @returns nothing; the entries render inside the header's `<Slot>` seats.
 */
function ShellHeaderSlots(): React.ReactNode {
  useSlotRegister("conversation.header.actions", PLAN_MODE_ACTION);
  useSlotRegister("conversation.header.actions", JOBS_CHIP_ACTION);
  useSlotRegister("conversation.header.utilities", SCHEDULE_CLOCK_UTILITY);
  useSlotRegister("conversation.header.utilities", RIGHT_PANEL_TOGGLE_UTILITY);
  useSlotRegister("conversation.header.utilities", MORE_MENU_UTILITY);
  return null;
}

/** `v` 前缀去掉，只留数字版本号，与旧页徽标的显示口径一致。 */
function stripVersionPrefix(version: string): string {
  return version.replace(/^v(?=\d)/, "");
}

/**
 * 「有新版本」徽标：设置按钮旁的小圆点 + Tooltip（文案带最新版本号）。
 *
 * 判定用 `v2/data/update.ts` 的真实 `GET /update/check`：`has_update` 已包含
 * 「版本号可比较」的判断，所以开发构建（`dev`）不会亮；查询失败一律静默——顶栏
 * 不是报错的地方，用户进设置「版本与更新」点「检查更新」才看原因。
 * 旧页面依据：ARTEX/web/src/app/(main)/_components/update-badge.tsx:21-57（`:24-38` 挂载即查一次、
 *   `:30` 去 `v` 前缀、`:42-57` 圆点 + 「发现新版本 …」提示）。
 * 对照表行：P3:S6。
 * @param props.collapsed - 侧栏是否处于 rail 模式（只显示圆点，不显示文字）。
 * @param props.onOpen - 点击后打开设置弹窗的「通用设置」（版本与更新卡片所在页）。
 * @returns 有新版本时的徽标，否则 null。
 */
function UpdateBadge({ collapsed, onOpen }: { collapsed: boolean; onOpen: () => void }): React.ReactNode {
  const update = useUpdate();
  const checked = React.useRef(false);
  // 挂载即查一次；后端对 GitHub 结果有 30 分钟缓存，多开标签页不会耗光配额。
  React.useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    void update.refresh(false);
  }, [update.refresh]);

  const check = update.check;
  if (check === null || check.has_update !== true) return null;
  const latest = check.latest === undefined ? "" : stripVersionPrefix(check.latest);
  const label = latest === "" ? "发现新版本，点击前往更新" : `发现新版本 ${latest}，点击前往更新`;

  return (
    <Tooltip label={label} side="top" portal>
      <button
        type="button"
        className={collapsed ? css.updateDotBtnRail : css.updateDotBtn}
        aria-label={label}
        title={label}
        data-update-badge={latest}
        onClick={onOpen}
      >
        <span className={css.updateDot} aria-hidden="true" />
        {collapsed ? null : <span className={css.updateDotText}>新版本{latest === "" ? "" : ` ${latest}`}</span>}
      </button>
    </Tooltip>
  );
}

export function Shell(): React.ReactNode {
  const [viewport, setViewport] = useState(1440);
  const [manual, setManual] = useState<"auto" | "expanded" | "collapsed">("auto");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which settings section a shell entry opens (「插件」→ MCP, 版本徽标 → 通用设置);
  // the dialog keeps owning later nav clicks.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // 分类组头行内「+」按钮传来的分类 id：NewTaskPage 创建后绑定该分类。
  const [pendingCategoryId, setPendingCategoryId] = useState<number | null>(null);
  // 新建工作区（DSH WorkspacePicker）：打开 NativeDirPicker 浏览服务器目录，
  // 选中的路径成为下一个任务的 workDir。替代旧版的「输入名字→mkdir」步骤。
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [selectedWorkDir, setSelectedWorkDir] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  // P1:E5 命令面板（Ctrl / Cmd+K）。打开是纯本地动作，结果全部来自页面注册表与
  // 真实的 `GET /tasks`，面板自己不新增请求。
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 「页面」启动器：12 个整页收进一个分组菜单（DSH `PanelMoreMenu`），侧栏高度留给任务列表。
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false);
  // 窄屏（<1024）右栏不再整列消失：会话头的开关改为打开浮层抽屉，点遮罩或 Esc 关闭。
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false);
  const taskState = useTasks();
  // C11 · P1:A26 / A27：侧栏按分类分组的数据源——分类列表（`useTaskCategories` 的
  // `GET /task-categories`）+ 任务自带的 `category_id` / `category_name`。
  // 分类列表还没读完时不分组（仍走原来的平铺 `TaskList`），读完后自动切到分组视图。
  const categoryState = useTaskCategories();
  const sessions = taskState.tasks === null ? [] : tasksToSessions(taskState.tasks);
  // The selected task is a deep link too (`?task=<id>`, 对照表行 P2:A11): `active` is
  // only component state, so a page outside the shell (总览「活动流」的点行) could not
  // reach it. The initializer reads the address before the first paint and pops re-read
  // it; the sync effect below writes it back so a reload / copy-link lands here again.
  const [active, setActive] = useState<string | null>(readShellTaskParam);
  const activeTask = taskState.tasks?.find((row) => row.id === active);
  // C09 的 P1:D13：用户选中一个真实存在的任务时，把「当前活动任务」写回后端
  // （`POST /tasks/{id}/active`）。钩子自己做守卫：列表里没有该 id 就不写，
  // 所以 GET /tasks 的自动选中、被删掉的行走不到这里。写入失败不打断界面，
  // 只在控制台留证据（右栏与列表各自有自己的 offline 态）。
  useActiveTaskSync(active, taskState.tasks === null ? null : taskState.tasks.map((row) => row.id));
  // C09/C10：侧栏列表接上 TaskList（拖动排序 + 行内字段 + 多选），
  // 多选与批量条复用 sidebar 组件，选择状态由 hook 持有。
  const taskSelection = useTaskMultiSelect(taskState.tasks);
  // C09 的 P1:A31：任务详情面板的入口。点侧栏头部的「任务详情」打开当前选中任务的详情；
  // 没有选中任务时按钮 disable（详情面板要一个真实 taskId）。
  const [detailOpen, setDetailOpen] = useState(false);
  // C12 的 P1:A2：侧栏「当前 / 已归档」切换；切到归档时列表区整块换成 TaskArchiveView。
  const [taskView, setTaskView] = useState<TaskListView>("current");
  // Real running-worker roster for the header chip. The sidebar list only
  // reloads on gestures, so this polls the task list on a short page-lifetime
  // timer instead: it is silent (the sidebar keeps its own loading/offline
  // phases) and feeds the chip alone, which must see a worker that just
  // started running. No mock data: the backend list is the only source.
  const [liveTasks, setLiveTasks] = useState<Task[] | null>(null);
  const refreshLiveTasks = useCallback(async (): Promise<void> => {
    try {
      const value = await listTasks();
      setLiveTasks(value.tasks);
    } catch {
      // Keep the last snapshot: the sidebar already surfaces the offline phase,
      // and a 1.5s poll must not flood the console while the backend is down.
    }
  }, []);
  useEffect(() => {
    void refreshLiveTasks();
    const timer = setInterval(() => {
      void refreshLiveTasks();
    }, RUNNING_TASKS_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [refreshLiveTasks]);
  // Pause a task: the header jobs chip and the composer's Stop seat share this
  // call. The control request is the only mutation (it rejects on failure so
  // each caller reports it in place); the row is updated optimistically and the
  // 1.5s poll plus the list reload correct it.
  const pauseTask = useCallback(
    async (id: string): Promise<void> => {
      try {
        await pauseTaskRequest(id);
        setLiveTasks((rows) =>
          rows === null
            ? rows
            : rows.map((row) => (row.id === id ? { ...row, status: "paused" as const, paused: true } : row)),
        );
      } finally {
        taskState.reload();
      }
    },
    [taskState.reload],
  );
  // Resume a paused task; the composer calls it before sending to a paused task.
  const resumeTask = useCallback(
    async (id: string): Promise<void> => {
      try {
        const result = await resumeTaskRequest(id);
        const status = result.queued ? ("queued" as const) : ("running" as const);
        setLiveTasks((rows) =>
          rows === null ? rows : rows.map((row) => (row.id === id ? { ...row, status, paused: false } : row)),
        );
      } finally {
        taskState.reload();
      }
    },
    [taskState.reload],
  );
  const activityState = useActivities(active);
  // Single owner of the backend run poll: the composer's Stop seat and the
  // stream-tail status row both read this one state object, so `chat/status`
  // keeps exactly one 1300ms poll chain for the selected task.
  const chatRun = useChatRun(active);
  // Task-level `/goal` target of the selected task: the strip above the composer
  // renders from this snapshot, and its edit/pause/resume/clear actions live here
  // so the composer stays a pure view (`v2/data/goal.ts`).
  const taskGoal = useTaskGoal(active);
  const [flow, setFlow] = useState<Flow>(null);
  const [query, setQuery] = useState("");
  // Focus target for the clear-search control: clearing returns the caret to the
  // input so the user can keep typing, as the ui-lab original does.
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const visibleSessions = sessions
    .filter((row) => (query.trim() === "" ? true : row.label.toLowerCase().includes(query.trim().toLowerCase())))
    .slice(0, expanded ? sessions.length : 12);
  // 同一份筛选结果映射回 Task 行，交给 TaskList 渲染（它需要 task 字段做排序与多选）。
  const visibleTaskIds = new Set(visibleSessions.map((row) => row.id));
  const visibleTasks = (taskState.tasks ?? []).filter((row) => visibleTaskIds.has(row.id));
  // C11 · P1:A26：分类分组用的同一批可见任务。`TaskList` 的排序偏好只存在它自己的
  // 组件状态里（`TaskList.tsx:206` 读 `miox.v2.tasks.sort`），Shell 读不到，所以这里
  // 用它的默认口径（创建时间倒序，`TaskList.tsx:58`）+ 同一份本地拖动顺序
  // `v2.tasks.order`（`tasks.ts:300`）排出组内顺序，保证两种视图的行序一致。
  // 分组本身用 `groupTasksByCategory`（`v2/data/task-categories.ts:55`）。
  const categoryGroups = groupTasksByCategory(
    applyTaskOrder(
      sortTasks(
        visibleTasks,
        { field: "created", direction: "desc" } satisfies TaskSortPreference,
        Math.floor(Date.now() / 1000),
      ),
      readTaskOrder(),
    ),
    categoryState.categories,
  );
  // 只要有任务落在真实分类或未分类里，就按分类分组渲染；否则仍用原来的平铺
  // `TaskList`（例如后端还没有任何分类时，平铺列表不必套一层「未分类」壳）。
  const groupedByCategory = categoryGroups.some((group) => group.tasks.length > 0);
  // 分组已就绪但分类列表读取失败：界面按「全部未分类」分组显示，并在列表下方如实说明。
  const categoryOffline = categoryState.phase === "offline";
  const [mounted, setMounted] = useState(false);
  // `?page=<id>` selects a whole-page surface in the main area; absent means the
  // Conversation. The URL is the single owner of that selection (DSH keeps the
  // selected global panel in its layout store, `ui-layout/client/service.ts:36`):
  // the initializer reads a deep link before the first paint, and Back/Forward
  // re-read it on `popstate`.
  const [pageId, setPageId] = useState<string | null>(readShellPageParam);

  // DSH selects a Session on startup (ConversationMainPanel.tsx:21-35 keeps the
  // header stable across that auto-selection). Mirror it once per mount so the
  // conversation column always renders a real task instead of leaving the hero
  // mounted; later selections stay owned by the user and the dialogs.
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (didAutoSelect.current) return;
    if (taskState.phase !== "ready" || taskState.tasks === null) return;
    didAutoSelect.current = true;
    // A `?task=` deep link that names no current task must not swallow the auto
    // selection: pick the first real row instead (and the sync effect rewrites the
    // address). A nameable task is already in `active` from the initializer and the
    // task list, so its conversation opens as-is.
    if (active !== null && taskState.tasks.some((row) => row.id === active)) return;
    if (active === null && taskState.tasks.length > 0) setActive(taskState.tasks[0].id);
  }, [active, taskState.phase, taskState.tasks]);

  // P2:A11: keep the address in step with the selection so the conversation is
  // deep-linkable (`?task=<id>`). A plain replace — selecting a session is not a
  // Back-worthy step. The `?page=` writer (selectPage below) re-reads the live
  // address, so the two parameters never overwrite one another.
  useEffect(() => {
    if (!mounted) return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("task");
    const wanted = active;
    if (wanted === null) {
      if (current === null) return;
      url.searchParams.delete("task");
    } else {
      if (current === wanted) return;
      url.searchParams.set("task", wanted);
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [active, mounted]);

  // D6·U4 旧页面深链别名的落地动作（一次性，幂等）：`readShellPageParam` 已把
  // `?page=tools/companies` 映射到现存页面（null / assets），这里只负责两件地址
  // 与弹窗的收尾——`tools` 打开设置弹窗并停在「工具」节（组件挂在
  // SettingsDialog 的 tools 分节），然后把 `page` 从地址里去掉；`companies` 把
  // 地址规范化成 `?page=assets&tab=company`（AssetsDataPage 首渲染还会直接认
  // 旧值，所以这里只改地址，不承担页面落地）。
  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("page");
    if (raw === "tools") {
      url.searchParams.delete("page");
      window.history.replaceState(window.history.state, "", url.toString());
      setSettingsSection("tools");
      setSettingsOpen(true);
    } else if (raw === "companies") {
      url.searchParams.set("page", "assets");
      url.searchParams.set("tab", "company");
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [setSettingsOpen, setSettingsSection]);

  // Dark theme is a body attribute in the ported theme, matching what the real
  // theme presenter toggles; restore the stored choice, then keep both in sync.
  useEffect(() => {
    setDark(window.localStorage.getItem("miox.v2.dark") === "1");
  }, []);
  useEffect(() => {
    if (dark) document.body.setAttribute("data-ds-dark-theme", "");
    else document.body.removeAttribute("data-ds-dark-theme");
    window.localStorage.setItem("miox.v2.dark", dark ? "1" : "0");
  }, [dark]);

  // Back/Forward are history navigations, not page renders: follow them by
  // re-reading the address instead of trying to push state again. Both selectors
  // live in the address, so a pop re-reads `?page=` and `?task=` together (P2:A11).
  useEffect(() => {
    const onPopState = (): void => {
      setPageId(readShellPageParam());
      setActive(readShellTaskParam());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // P1:E5：Ctrl / Cmd+K 打开命令面板。按住连发、输入法组字中、带 Alt/Shift 的组合都不处理；
  // 已经在任意 dialog 里（设置弹窗、命令面板自己、二次确认）时不抢键，键盘归那个层。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.repeat || event.defaultPrevented) return;
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"], [aria-modal="true"]') !== null) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    setMounted(true);
    const onResize = (): void => setViewport(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Escape dismisses the open overlay surfaces (the right-panel sheet and the
  // sidebar drawer). Dialogs own their own Escape, so a key inside one is left alone.
  useEffect(() => {
    if (!rightOverlayOpen && !drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"][aria-modal="true"], [role="menu"]') !== null)
        return;
      setRightOverlayOpen(false);
      setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rightOverlayOpen, drawerOpen]);

  // Below the drawer breakpoint the sidebar is an off-canvas panel, so it is
  // always drawn expanded; collapsing it would leave an empty white sheet.
  const isDrawer = viewport < DRAWER_BREAKPOINT;
  const autoCollapsed = shouldAutoCollapse(viewport);
  const collapsed = isDrawer ? false : manual === "auto" ? autoCollapsed : manual === "collapsed";
  // 打开整页（`?page=`）时右栏不渲染、也不占列宽，把宽度让给数据页；回到会话后
  // 按 `rightOpen` 原偏好恢复（DSH `RightbarRoot.tsx:35`：`activePanelId === null`
  // 才可见）。`findMainPage` 是纯函数、不是 hook，前移到条件 return 之前不改变
  // hooks 顺序。`rightOpen` 本身只是用户偏好，这里不写它。
  const activePage = findMainPage(pageId);
  // ≥1024 the right panel is a column; below it the column has no room (the
  // centre keeps its 400px floor), so the header toggle opens the same panel as
  // an overlay sheet over the conversation instead of doing nothing.
  const rightAsOverlay = viewport < AUTO_MIN;
  const rightVisible = rightOpen && !rightAsOverlay && activePage === null;
  const rightOverlayVisible = rightAsOverlay && rightOverlayOpen && activePage === null;
  // First-open width follows DSH: `RIGHTBAR_DEFAULT_RATIO` of the frame, never
  // below the drag floor (`ui-layout/client/columns.ts`). The solver applies the
  // ratio ceiling and concedes the track before the center minimum.
  const rightWidth = Math.max(RIGHTBAR_MIN, Math.round(viewport * RIGHTBAR_DEFAULT_RATIO));
  const columns = computeColumns({
    viewport,
    sidebarExpanded: SIDEBAR_DEFAULT,
    sidebarCollapsed: collapsed,
    rightOpen: rightVisible,
    rightWidth,
  });

  // Collapse staging has to be a hook, so it sits above the mount gate: first the
  // wide labels fade while the column eases closed, then the 36px rail mounts.
  // Declaring it below `if (!mounted)` would change the hook count between renders.
  const [railSettled, setRailSettled] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setRailSettled(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setRailSettled(true), COLLAPSE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed]);
  // Freeze the wide content at its expanded width while the track eases (DSH
  // `SidebarRoot.tsx:206-208`), so nothing reflows mid-slide.
  const frozenSidebarWidth = useRef(columns.sidebar);
  if (!collapsed) frozenSidebarWidth.current = columns.sidebar;

  if (!mounted) return null;

  // Pages come from the registry alone (`v2/data/pages.ts`): the navigation rows
  // and the main-area body read the same sorted list, so a page unit registers one
  // entry and never touches this shell.
  const navPages = listMainPages();
  const ActivePageBody = activePage?.Component ?? null;

  // Real running-task roster behind the header's background-jobs chip: the
  // polled snapshot leads and the gesture-driven sidebar snapshot is the
  // fallback before the first poll lands.
  const runningTasks = (liveTasks ?? taskState.tasks ?? []).filter((task) => task.status === "running");

  const togglePlanMode = (): void => {
    if (active === null) return;
    const next = activeTask?.plan_mode !== true;
    void setTaskPlanMode(active, next)
      .then(() => taskState.reload())
      .catch((reason: unknown) => toast(`计划模式切换失败：${reason instanceof Error ? reason.message : String(reason)}`));
  };

  // Team mode is the second, independent Session flag (`PATCH /tasks/{id}/team-mode`):
  // the shared task-board tools enter the agent only for a turn built after this
  // write, so the reload below is what makes the chip's row show the new value.
  const toggleTeamMode = (): void => {
    if (active === null) return;
    const next = activeTask?.team_mode !== true;
    void setTaskTeamMode(active, next)
      .then(() => taskState.reload())
      .catch((reason: unknown) => toast(`团队模式切换失败：${reason instanceof Error ? reason.message : String(reason)}`));
  };

  // After the selected task leaves the list (archive/delete), land on the next
  // task in the current snapshot instead of leaving a stale blank column.
  const selectFallbackTask = (removedId: string): void => {
    const next = (taskState.tasks ?? []).find((task) => task.id !== removedId);
    setActive(next?.id ?? null);
  };

  // Entering a page is a history step, so Back leaves it and returns to the
  // Conversation. Returning to the Conversation (a session row or a task link)
  // replaces that step instead: a page that is no longer on screen must not
  // come back on Back.
  const selectPage = (id: string | null): void => {
    // Any navigation leaves the new-session launch page: it has no close button
    // of its own — picking a session, opening a page or creating a task is the exit.
    setNewTaskOpen(false);
    if (id === pageId) return;
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete("page");
    else url.searchParams.set("page", id);
    if (id === null) window.history.replaceState(window.history.state, "", url);
    else window.history.pushState(window.history.state, "", url);
    setPageId(id);
  };

  /** 打开设置弹窗并停在指定分节（「插件」→ MCP；更新徽标 → 通用设置）。 */
  const openSettings = (section: SettingsSectionId = "general"): void => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  /**
   * 侧栏任务行的行内动作（置顶 / 重命名 / 归档 / 删除）。
   *
   * 平铺 `TaskList` 与分类分组 `TaskCategoryGroups` 共用这一个回调：分组视图只是换了
   * 排版（组头 + 行），行内语义与落到的接口必须完全一致，避免两套视图行为分叉。
   * 每个分支都落到真实接口，没有接口的动作不画（总表 §0.1 第 3 条）。
   * @param id - 任务 id。
   * @param patch - 行内动作：`remove` 删除，其它为要改的字段。
   */
  const onTaskRowChange = (id: string, patch: Partial<Session> | "remove"): void => {
    if (patch === "remove") {
      void deleteTask(id, {
        delete_assets: false,
        delete_traffic: false,
        delete_files: false,
        delete_findings: false,
        delete_llm_records: false,
      })
        .then(() => {
          if (active === id) selectFallbackTask(id);
          taskState.reload();
        })
        .catch((reason: unknown) => toast(`删除任务失败：${reason instanceof Error ? reason.message : String(reason)}`));
      return;
    }
    if (patch.pinned !== undefined) {
      void pinTask(id, patch.pinned)
        .then(() => taskState.reload())
        .catch((reason: unknown) => toast(`置顶失败：${reason instanceof Error ? reason.message : String(reason)}`));
      return;
    }
    if (patch.label !== undefined) {
      void renameTask(id, patch.label)
        .then(() => taskState.reload())
        .catch((reason: unknown) => toast(`重命名失败：${reason instanceof Error ? reason.message : String(reason)}`));
      return;
    }
    if (patch.archived === true) {
      void archiveTasks([id])
        .then(() => {
          if (active === id) selectFallbackTask(id);
          taskState.reload();
        })
        .catch((reason: unknown) => toast(`归档失败：${reason instanceof Error ? reason.message : String(reason)}`));
      return;
    }
    taskState.reload();
  };

  // Sidebar launcher rows render the same in both widths: icon + label when wide,
  // icon alone on the 56px rail, where the tooltip carries the name (DSH keeps the
  // Tooltip mounted and toggles `disabled={wide}`, `SidebarRoot.tsx:79`).
  const railTip = (
    key: string,
    label: string,
    node: React.ReactElement<React.HTMLAttributes<HTMLElement>>,
  ): React.ReactNode => (
    <Tooltip key={key} label={label} side="right" delayMs={300} portal disabled={!rail}>
      {node}
    </Tooltip>
  );

  // Collapse staging: width, labels and rail controls switch in that order.
  const sidebarWidth = columns.drawer ? 280 : collapsed && !railSettled ? frozenSidebarWidth.current : columns.sidebar;
  const activePageEntry = activePage === null ? null : (navPages.find((page) => page.id === activePage.id) ?? null);
  // Three render phases for the column: wide (labels), collapsing (labels held at the
  // frozen width while the track eases), rail (36px squares + tooltips). `wide` drives
  // content, `rail` drives geometry, `collapsing` lets CSS fade the labels out first.
  const rail = collapsed && railSettled;
  const collapsing = collapsed && !railSettled;
  const wide = !rail;

  const sidebar = (
    <aside
      className={`${css.sidebar} ${rail ? css.sidebarRail : ""} ${collapsing ? css.sidebarCollapsing : ""}`}
      style={{ width: sidebarWidth }}
      data-sidebar-collapsed={rail ? "" : undefined}
    >
      <div className={css.brandRow}>
        {rail ? (
          railTip(
            "sidebar-expand",
            "展开侧边栏",
            <button
              type="button"
              className={css.railToggle}
              aria-label="展开侧边栏"
              onClick={() => setManual("expanded")}
            >
              <span className={css.railMark} aria-hidden="true">
                <MioxMark size={20} />
              </span>
              <span className={css.railPanelIcon} aria-hidden="true">
                <IconPanelLeftOutlineRegular size={18} />
              </span>
            </button>,
          )
        ) : (
          <>
            <span className={css.brand}>
              <MioxMark size={20} />
              <span className={css.brandName}>mioX</span>
            </span>
            <Tooltip label="收起侧边栏" side="bottom" delayMs={300}>
              <button
                type="button"
                className={css.iconBtn}
                aria-label="收起侧边栏"
                onClick={() => (columns.drawer ? setDrawerOpen(false) : setManual("collapsed"))}
              >
                <IconPanelLeftOutlineRegular size={16} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <div className={css.newSessionRow}>
        {railTip(
          "new-session",
          "新会话",
          <button
            type="button"
            className={css.newSessionBtn}
            aria-label="新会话"
            onClick={() => {
              setNewTaskOpen(true);
            }}
          >
            <IconNewChatOutlineRegular size={rail ? 18 : 16} />
            {wide ? <span>新会话</span> : null}
          </button>,
        )}
      </div>

      {/* Launchers. DSH keeps a short pinned list plus one 「更多」 menu
          (`ui-sidebar/src/client/SidebarRoot.tsx:416-451`) so the workspace region
          owns the column's height. mioX's twelve whole pages sit behind one grouped
          「页面」 menu; the page on screen stays visible as its own row so the user
          always sees where they are. */}
      <nav className={css.nav} aria-label="主导航">
        <Menu
          open={pagesMenuOpen}
          onClose={() => setPagesMenuOpen(false)}
          onSelect={(id) => {
            setPagesMenuOpen(false);
            selectPage(id);
            if (columns.drawer) setDrawerOpen(false);
          }}
          items={pageMenuEntries(navPages)}
          selectedId={activePage?.id}
          portal
          autoFocus
          side={rail ? "right" : "bottom"}
          className={css.pagesAnchor}
          listClassName={css.pagesMenu}
          anchor={railTip(
            "pages",
            "页面",
            <button
              type="button"
              className={`${css.navRow} ${pagesMenuOpen ? css.navRowOpen : ""}`}
              aria-label="页面"
              aria-haspopup="menu"
              aria-expanded={pagesMenuOpen}
              data-nav-row="pages"
              onClick={() => setPagesMenuOpen((open) => !open)}
            >
              <span className={css.navIcon} aria-hidden="true">
                <IconAppsAddOutlineRegular size={rail ? 18 : 16} />
              </span>
              {wide ? (
                <>
                  <span className={css.navLabel}>页面</span>
                  <span className={css.navHint}>{navPages.length}</span>
                </>
              ) : null}
            </button>,
          )}
        />
        {activePageEntry === null
          ? null
          : railTip(
              activePageEntry.id,
              activePageEntry.label,
              <button
                type="button"
                className={`${css.navRow} ${css.navRowActive}`}
                aria-label={activePageEntry.label}
                aria-current="page"
                data-nav-row={activePageEntry.id}
                onClick={() => selectPage(activePageEntry.id)}
              >
                <span className={css.navIcon} aria-hidden="true">
                  <activePageEntry.Icon size={rail ? 18 : 16} />
                </span>
                {wide ? <span className={css.navLabel}>{activePageEntry.label}</span> : null}
                {wide ? (
                  <span
                    className={css.navClose}
                    role="button"
                    tabIndex={0}
                    aria-label="回到会话"
                    title="回到会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectPage(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      selectPage(null);
                    }}
                  >
                    <IconCloseOutlineRegular size={12} />
                  </span>
                ) : null}
              </button>,
            )}
      </nav>
      {rail ? (
        <div className={css.railSpacer} />
      ) : (
        <section className={css.region} aria-label="工作区">
          {/* Region header: the workspace caption, its tools, and the current /
              archived switch stay pinned while the task list scrolls under them. */}
          <div className={css.regionHead}>
            <div className={css.wsRow}>
              {/* D1: the region caption is the current / archived switch itself
                  (text tabs), so the list gains a row instead of a pill track. */}
              <TaskListSwitch
                value={taskView}
                onChange={(next) => {
                  setTaskView(next);
                  setSearchOpen(false);
                  setQuery("");
                }}
              />
              <span className={css.wsActions}>
                <Tooltip label="搜索会话" side="bottom" delayMs={300}>
                  <button
                    type="button"
                    className={`${css.wsIconBtn} ${searchOpen ? css.wsIconBtnOn : ""}`}
                    aria-label="搜索会话"
                    aria-pressed={searchOpen}
                    onClick={() => {
                      setSearchOpen((v) => !v);
                      if (searchOpen) setQuery("");
                    }}
                  >
                    <IconSearchOutlineRegular size={14} />
                  </button>
                </Tooltip>
                <TaskSelectToggle
                  active={taskSelection.active}
                  onToggle={taskSelection.setActive}
                  total={visibleTasks.length}
                  selected={taskSelection.ids.size}
                  onSelectAll={() => {
                    const allSelected =
                      visibleTasks.length > 0 && visibleTasks.every((row) => taskSelection.ids.has(row.id));
                    for (const row of visibleTasks) {
                      if (allSelected ? taskSelection.ids.has(row.id) : !taskSelection.ids.has(row.id)) {
                        taskSelection.toggle(row.id, !allSelected);
                      }
                    }
                  }}
                />
                <Tooltip label={active === null ? "先选中一个任务" : "任务详情"} side="bottom" delayMs={300}>
                  <button
                    type="button"
                    className={`${css.wsIconBtn} ${detailOpen ? css.wsIconBtnOn : ""}`}
                    aria-label="任务详情"
                    aria-pressed={detailOpen}
                    disabled={active === null}
                    data-shell-task-detail=""
                    onClick={() => setDetailOpen((v) => !v)}
                  >
                    <IconInfoOutlineRegular size={14} />
                  </button>
                </Tooltip>
                <Tooltip label={expanded ? "只显示最近 12 个" : "显示全部会话"} side="bottom" delayMs={300}>
                  <button
                    type="button"
                    className={`${css.wsIconBtn} ${expanded ? css.wsIconBtnOn : ""}`}
                    aria-label="展开全部会话"
                    aria-pressed={expanded}
                    onClick={() => setExpanded((v) => !v)}
                  >
                    <IconChevronsUpDownOutlineRegular size={14} />
                  </button>
                </Tooltip>
                <Tooltip label="新建工作区" side="bottom" delayMs={300}>
                  <button
                    type="button"
                    className={css.wsIconBtn}
                    aria-label="新建工作区"
                    onClick={() => setMkdirOpen(true)}
                  >
                    <IconProjectAddOutlineRegular size={14} />
                  </button>
                </Tooltip>
                <NativeDirPicker
                  open={mkdirOpen}
                  initial=""
                  onClose={() => setMkdirOpen(false)}
                  onPick={(path) => {
                    // DSH WorkspacePicker：选中的目录成为工作区根
                    // — 后端没有 workspace CRUD，所以这个目录作为下一个
                    // 新任务的工作目录（workDir）。存下来给 bao 的
                    // NewTaskPage 创建时用。
                    setMkdirOpen(false);
                    setSelectedWorkDir(path);
                    setNewTaskOpen(true);
                  }}
                />
              </span>
            </div>
            {searchOpen && taskView === "current" ? (
              <div className={css.searchField}>
                <IconSearchOutlineRegular size={13} />
                <input
                  ref={searchInputRef}
                  className={css.sessionSearch}
                  autoFocus
                  value={query}
                  aria-label="搜索会话"
                  placeholder="搜索会话"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.preventDefault();
                    setQuery("");
                    setSearchOpen(false);
                  }}
                />
                {query !== "" ? (
                  <button
                    type="button"
                    className={css.searchClear}
                    aria-label="清空搜索"
                    title="清空搜索"
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <IconCloseOutlineRegular size={11} />
                  </button>
                ) : null}
              </div>
            ) : null}
            {taskSelection.active && taskView === "current" ? (
              <TaskBulkBar
                tasks={taskState.tasks ?? []}
                selection={taskSelection}
                onChanged={() => taskState.reload()}
              />
            ) : null}
          </div>

          {detailOpen && active !== null ? (
            <div className={css.detailSeat}>
              <TaskDetailPanel
                taskId={active}
                fallback={activeTask ?? null}
                onClose={() => setDetailOpen(false)}
                onChanged={() => taskState.reload()}
              />
            </div>
          ) : null}

          <div className={css.regionBody} data-sidebar-scrollport="">
            {taskView === "archived" ? (
              <TaskArchiveView onChanged={() => taskState.reload()} />
            ) : (
              <>
                {groupedByCategory ? (
                  // C11 · P1:A26 / A27：任务带分类时按分类分组渲染（组头 = 分类名 + 条数 + 折叠）。
                  // 行内多选与行内动作原样透传，和平铺 `TaskList` 是同一套回调。
                  <TaskCategoryGroups
                    groups={categoryGroups}
                    categories={categoryState.categories}
                    activeId={active}
                    onSelect={(id) => {
                      setActive(id);
                      selectPage(null);
                      if (columns.drawer) setDrawerOpen(false);
                    }}
                    onChange={onTaskRowChange}
                    toSession={(id) => {
                      const task = visibleTasks.find((row) => row.id === id);
                      return task === undefined ? { id, label: "", time: "" } : tasksToSessions([task])[0];
                    }}
                    onTaskMoved={() => taskState.reload()}
                    selectable={taskSelection.active}
                    selectedIds={taskSelection.ids}
                    onSelectionChange={taskSelection.toggle}
                    onNewSessionInCategory={(categoryId) => {
                      // DSH ProjectRow 的行内 startSession：在指定分类下新建任务。
                      // 走同一个 launch page，NewTaskPage 创建后调 setTaskCategory 绑分类。
                      setPendingCategoryId(categoryId);
                      setNewTaskOpen(true);
                    }}
                  />
                ) : (
                  <TaskList
                    tasks={visibleTasks}
                    activeId={active}
                    onSelect={(id) => {
                      setActive(id);
                      selectPage(null);
                      if (columns.drawer) setDrawerOpen(false);
                    }}
                    onChange={onTaskRowChange}
                    toSession={(row) => tasksToSessions([row])[0]}
                    selectable={taskSelection.active}
                    selectedIds={taskSelection.ids}
                    onSelectionChange={taskSelection.toggle}
                  />
                )}
                {taskState.phase !== "ready" ? (
                  <div className={css.offlineRow}>
                    {taskState.phase === "loading" ? "读取任务…" : "未连接后端（任务列表不可用）"}
                  </div>
                ) : sessions.length === 0 ? (
                  <div className={css.emptyRow}>
                    <span>还没有会话</span>
                    <button
                      type="button"
                      className={css.linkBtn}
                      onClick={() => {
                        setNewTaskOpen(true);
                      }}
                    >
                      新建一个
                    </button>
                  </div>
                ) : query.trim() !== "" && visibleSessions.length === 0 ? (
                  <div className={css.emptyRow}>没有匹配「{query.trim()}」的会话</div>
                ) : null}
                {/* 分类列表读取失败：分组退化成「全部未分类」，但分组本身照常可用；
                    这一行如实说明「分类」菜单暂时只有「未分类」，并把重试入口接上。 */}
                {groupedByCategory && categoryOffline ? (
                  <div className={css.offlineRow} role="status" data-shell-category-offline="">
                    分类列表读取失败（{categoryState.error ?? "未知原因"}），暂时只能按「未分类」查看
                    <button type="button" className={css.linkBtn} onClick={categoryState.reload}>
                      重试
                    </button>
                  </div>
                ) : null}
                {!expanded && sessions.length > 12 && query.trim() === "" ? (
                  <button type="button" className={css.showAll} onClick={() => setExpanded(true)}>
                    显示全部 {sessions.length} 个会话
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>
      )}

      <div className={css.footer}>
        {railTip(
          "theme",
          dark ? "浅色主题" : "深色主题",
          <button
            type="button"
            className={css.navRow}
            onClick={() => setDark((v) => !v)}
            aria-pressed={dark}
            aria-label={dark ? "浅色主题" : "深色主题"}
          >
            <span className={css.navIcon} aria-hidden="true">
              {dark ? (
                <IconLightOutlineRegular size={rail ? 18 : 16} />
              ) : (
                <IconDarkOutlineRegular size={rail ? 18 : 16} />
              )}
            </span>
            {wide ? <span className={css.navLabel}>{dark ? "浅色主题" : "深色主题"}</span> : null}
          </button>,
        )}
        {/* 设置行：rail 模式下「有新版本」的圆点贴在设置图标旁（旧页徽标在顶栏，/v2 顶栏由
            ConversationRoot 拥有，Shell 只能往侧栏放，位置差异记在 overlay note）。 */}
        <div className={css.settingsRow}>
          {railTip(
            "settings",
            "设置",
            <button type="button" className={css.navRow} onClick={() => openSettings("general")} aria-label="设置">
              <span className={css.navIcon} aria-hidden="true">
                <IconSettingsOutlineRegular size={rail ? 18 : 16} />
              </span>
              {wide ? <span className={css.navLabel}>设置</span> : null}
            </button>,
          )}
          <UpdateBadge collapsed={rail} onOpen={() => openSettings("general")} />
        </div>
      </div>
      {settingsOpen ? (
        <SettingsDialog open={settingsOpen} initialSection={settingsSection} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </aside>
  );

  /**
   * The main column's body: the new-session launch page, a registry data page,
   * or the resident Conversation. The launch page is the app's first page: it
   * shows on an explicit 新会话 and whenever no session exists to chat with;
   * it has no close button — navigation (select a session, open a page, create
   * the task) is the only way out.
   */
  const launchVisible = newTaskOpen || (active === null && activePage === null);
  const launchCreated = (id: string): void => {
    setNewTaskOpen(false);
    setDrawerOpen(false);
    selectPage(null);
    setActive(id);
    // 分类组头「+」进入的：创建成功后绑定到对应分类（P1:A26 的 PATCH /tasks/{id}/category）。
    if (pendingCategoryId !== null) {
      moveTaskToCategory(id, pendingCategoryId)
        .then(() => {
          setPendingCategoryId(null);
          taskState.reload();
        })
        .catch((reason: unknown) => toast(`分类设置失败：${reason instanceof Error ? reason.message : String(reason)}`));
      return;
    }
    taskState.reload();
  };
  const renderMain = (): React.ReactNode => {
    if (launchVisible) {
      return (
        <>
          {/* 抽屉模式下启动页没有会话头承载这个开关，给它一个左上角入口
              （DSH `SidebarRoot` 收起后的固定展开按钮语义）。 */}
          {columns.drawer ? (
            <button
              type="button"
              className={css.launchDrawerButton}
              aria-label="打开侧边栏"
              title="打开侧边栏"
              onClick={() => setDrawerOpen(true)}
            >
              <IconPanelLeftOutlineRegular size={18} />
            </button>
          ) : null}
          <NewTaskPage onCreated={launchCreated} />
        </>
      );
    }
    if (activePage !== null && ActivePageBody !== null) {
      return (
        <>
          {/* 抽屉模式（<768px）下全局页面同样没有会话头，侧栏只能从这里打开；
              否则资产库等页面在窄屏里整个侧栏都找不回来。 */}
          {columns.drawer ? (
            <button
              type="button"
              className={css.launchDrawerButton}
              aria-label="打开侧边栏"
              title="打开侧边栏"
              data-page-drawer-open=""
              onClick={() => setDrawerOpen(true)}
            >
              <IconPanelLeftOutlineRegular size={18} />
            </button>
          ) : null}
          <div
            className={`${css.mainPage} ${columns.drawer ? css.mainPageDrawer : ""}`}
            data-shell-page={activePage.id}
            key={activePage.id}
          >
            <ActivePageBody />
          </div>
        </>
      );
    }
    // 输入框停止键与用量条共用的任务行：优先 1.5s 实时快照（暂停/恢复的乐观
    // 更新也落在它上面），缺失时退回列表快照——两个视图永远读同一行。
    const liveActiveTask =
      (liveTasks === null ? null : (liveTasks.find((row) => row.id === active) ?? null)) ?? activeTask ?? null;
    return (
      <ConversationRoot
        task={activeTask ?? null}
        activities={activityState.activities}
        activityPhase={activityState.phase}
        chatRunning={chatRun.running}
        headerSlotData={{
          runningTasks,
          planMode: activeTask?.plan_mode === true,
          teamMode: activeTask?.team_mode === true,
          rightOpen: rightAsOverlay ? rightOverlayVisible : rightVisible,
          onTogglePlanMode: togglePlanMode,
          onToggleTeamMode: toggleTeamMode,
          onToggleRightPanel: () => {
            if (rightAsOverlay) setRightOverlayOpen((value) => !value);
            else setRightOpen((value) => !value);
          },
          onPauseTask: pauseTask,
          taskActions: {
            setPinned: (id, pinned) => {
              void pinTask(id, pinned)
                .then(() => taskState.reload())
                .catch((reason: unknown) => toast(`置顶失败：${reason instanceof Error ? reason.message : String(reason)}`));
            },
            archive: (id) => {
              void archiveTasks([id])
                .then(() => {
                  if (active === id) selectFallbackTask(id);
                  taskState.reload();
                })
                .catch((reason: unknown) => toast(`归档失败：${reason instanceof Error ? reason.message : String(reason)}`));
            },
            remove: async (id) => {
              await deleteTask(id, {
                delete_assets: false,
                delete_traffic: false,
                delete_files: false,
                delete_findings: false,
                delete_llm_records: false,
              });
              if (active === id) selectFallbackTask(id);
              taskState.reload();
            },
          },
        }}
        drawer={columns.drawer}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenTask={(id) => {
          setActive(id);
          selectPage(null);
        }}
        composer={
          <>
            <Composer
              goalState={taskGoal.goal}
              goalActions={taskGoal.actions}
              goalProgress={
                activeTask === null || activeTask === undefined
                  ? null
                  : { met: activeTask.goals_met ?? 0, total: activeTask.goals_total ?? 0 }
              }
              taskId={active}
              chatRun={chatRun}
              taskStatus={liveActiveTask?.status ?? null}
              taskPaused={liveActiveTask?.paused === true}
              onPauseTask={active === null ? undefined : () => pauseTask(active)}
              onResumeTask={active === null ? undefined : () => resumeTask(active)}
              onSent={() => activityState.reload()}
              permissionLevel={activeTask?.permission_level ?? "auto"}
              onPermissionChange={(level) => {
                if (active === null) return;
                void setTaskPermissionLevel(active, level)
                  .then(() => taskState.reload())
                  .catch((reason: unknown) =>
                    toast(`权限档切换失败：${reason instanceof Error ? reason.message : String(reason)}`),
                  );
              }}
            />
            {/* 卡下状态条（DSH InputBar `.dock` 语义）：步数/tok/s/token/上下文，
                数据取实时轮询的任务行与活动流的 usage 行。 */}
            <ConversationUsageBar
              activities={activityState.activities}
              task={
                (liveTasks === null ? null : (liveTasks.find((row) => row.id === active) ?? null)) ?? activeTask ?? null
              }
              running={chatRun.running}
            />
          </>
        }
      />
    );
  };

  return (
    <SlotProvider>
      <ShellHeaderSlots />
      <div className={css.root}>
        {columns.drawer ? (
          <>
            <div
              className={`${css.mask} ${drawerOpen ? css.maskOpen : ""}`}
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
            />
            <div className={`${css.drawer} ${drawerOpen ? css.drawerOpen : ""}`} inert={!drawerOpen}>
              {sidebar}
            </div>
          </>
        ) : (
          sidebar
        )}

        <main className={css.main}>{renderMain()}</main>

        {/* Right column. It stays mounted while closed so its width can animate
            to 0 (DSH eases the grid track, `AppFrame.module.css:17`); the content
            is inert while the track is closed. Below 1024 the same panel opens as
            an overlay sheet instead, because the column would starve the centre. */}
        {launchVisible || rightAsOverlay ? null : (
          <div
            className={`${css.rightWrap} ${rightVisible ? "" : css.rightWrapClosed}`}
            style={{ width: rightVisible ? columns.right : 0 }}
            aria-hidden={rightVisible ? undefined : true}
            inert={!rightVisible}
          >
            <div className={css.rightInner} style={{ width: Math.max(columns.right, RIGHTBAR_MIN) }}>
              <RightPanel onClose={() => setRightOpen(false)} task={activeTask ?? null} />
            </div>
          </div>
        )}
        {rightAsOverlay && activePage === null && !launchVisible ? (
          <>
            <div
              className={`${css.sheetMask} ${rightOverlayVisible ? css.sheetMaskOpen : ""}`}
              aria-hidden="true"
              onClick={() => setRightOverlayOpen(false)}
            />
            <div
              className={`${css.sheet} ${rightOverlayVisible ? css.sheetOpen : ""}`}
              role="dialog"
              aria-label="右栏"
              aria-hidden={rightOverlayVisible ? undefined : true}
              inert={!rightOverlayVisible}
              style={{ width: Math.min(Math.max(RIGHTBAR_MIN, Math.round(viewport * 0.6)), viewport - 48) }}
            >
              <RightPanel onClose={() => setRightOverlayOpen(false)} task={activeTask ?? null} />
            </div>
          </>
        ) : null}

        <ToastHost />
        {/* P1:E5 命令面板：页面来自 `listMainPages()`（与左栏同一份注册表），任务来自
            上面同一个 `taskState.tasks`（`GET /tasks` 的真实结果）。页面项写 `?page=`，
            任务项切换活动任务并回到会话，都不新增接口。 */}
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          pages={navPages}
          tasks={taskState.tasks}
          tasksPhase={taskState.phase}
          onSelectPage={selectPage}
          onSelectTask={(id) => {
            setActive(id);
            selectPage(null);
          }}
        />
      </div>
    </SlotProvider>
  );
}

const AUTO_MIN = 1024;
/** Wide labels stay mounted this long after collapse starts, then the rail swaps in. */
const COLLAPSE_SETTLE_MS = 150;
/** Task-list poll cadence: a worker that just started running reaches the header chip inside ~1.5s. */
const RUNNING_TASKS_POLL_MS = 1_500;

/**
 * Read the selected page id from `?page=`.
 *
 * D6·U4 旧页面深链别名在解析处（`findMainPage` 之前）映射：
 * `companies` → `assets`（企业页并入资产库的 company tab，tab 值由本组件的
 * 别名落地 effect 写入地址，页面本体读得到）；`tools` → null（工具页入口已删，
 * 该深链由别名落地 effect 打开设置弹窗「工具」节）。映射后的地址会被就地规范成
 * 新写法，但任何带着旧值的入口（书签、外部链接）在首次解析时就落在正确页面。
 * @returns The page id after aliasing, or null when the URL names no page (also during server render).
 */
function readShellPageParam(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("page");
  if (value === null || value === "") return null;
  if (value === "companies") return "assets";
  if (value === "tools") return null;
  return value;
}

/**
 * Read the selected task id from `?task=<id>` (P2:A11 的会话深链).
 * @returns The raw id, or null when the URL names no task (also during server render).
 */
function readShellTaskParam(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("task");
  return value === null || value.trim() === "" ? null : value.trim();
}
