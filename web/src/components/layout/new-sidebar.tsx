"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Activity,
  Bug,
  ChevronUp,
  LayoutDashboard,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

import { useAppLayout } from "@/components/layout/app-frame";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { toast } from "sonner";

import styles from "./new-sidebar.module.css";

const quickLinks = [
  { href: "/dashboard", label: "任务总览", icon: LayoutDashboard },
  { href: "/function/findings", label: "发现", icon: Bug },
  { href: "/function/assets", label: "资产", icon: Network },
  { href: "/function/traffic", label: "流量", icon: Activity },
];

const moreLinks = [
  { href: "/function/commands", label: "工具执行" },
  { href: "/function/llm-records", label: "LLM 录制" },
  { href: "/function/workspace", label: "工作空间" },
  { href: "/function/sync", label: "资产同步" },
  { href: "/system/llm", label: "LLM 配置" },
  { href: "/system/agents", label: "Agent" },
  { href: "/system/mcp", label: "MCP" },
  { href: "/system/skills", label: "Skill" },
  { href: "/system/tools", label: "工具" },
  { href: "/system/notify", label: "通知推送" },
  { href: "/system/intercept", label: "拦截规则" },
  { href: "/system/intercept/approvals", label: "审批记录" },
  { href: "/system/logs", label: "日志" },
];

interface SidebarMenuItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly active?: boolean;
}

interface SidebarMenuProps {
  readonly ariaLabel: string;
  readonly menuId: string;
  readonly items: readonly SidebarMenuItem[];
  readonly triggerClassName: string;
  readonly triggerContent: React.ReactNode;
  readonly triggerLabel: string;
  readonly triggerTestId?: string;
  readonly triggerTooltip?: string;
  readonly placement?: "up" | "down";
}

/**
 * Small keyboard-navigable popover menu used by "更多" and the account row.
 * Keeps focus inside the menu while open: Arrow keys/Home/End move, Enter
 * follows the focused link, Esc closes and returns focus to the trigger.
 */
function SidebarMenu({
  ariaLabel,
  menuId,
  items,
  triggerClassName,
  triggerContent,
  triggerLabel,
  triggerTestId,
  triggerTooltip,
  placement = "up",
}: SidebarMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const closeMenu = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, closeMenu]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (nodes.length === 0) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      let next = activeIndex;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = nodes.length - 1;
      else next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length;
      setActiveIndex(next);
      nodes[next]?.focus();
      return;
    }
    if (event.key === "Tab") closeMenu(false);
  };

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={triggerLabel}
        data-testid={triggerTestId}
        data-tooltip={triggerTooltip}
        onClick={() => {
          if (open) closeMenu(true);
          else setOpen(true);
        }}
      >
        {triggerContent}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className={`${styles.menuPanel} ${placement === "up" ? styles.menuPanelUp : styles.menuPanelDown}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <Link
              key={item.id}
              href={item.href}
              role="menuitem"
              tabIndex={-1}
              className={`${styles.menuItem} ${index === activeIndex ? styles.menuItemActive : ""} ${
                item.active ? styles.menuItemCurrent : ""
              }`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => closeMenu(false)}
            >
              <span className={styles.menuItemLabel}>{item.label}</span>
              {item.active ? <span className={styles.menuItemDot} aria-hidden="true" /> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function taskName(task: Task): string {
  const name = task.name?.trim() || task.description?.trim() || task.goal?.trim() || task.id;
  return name.length > 28 ? `${name.slice(0, 28)}…` : name;
}

function statusClass(task: Task): string {
  if (task.paused) return styles.statusPaused;
  switch (task.status) {
    case "running":
      return styles.statusRunning;
    case "done":
      return styles.statusDone;
    case "failed":
    case "timeout":
      return styles.statusPaused;
    default:
      return styles.statusWaiting;
  }
}

function statusLabel(task: Task): string {
  if (task.paused) return "已暂停";
  switch (task.status) {
    case "running":
      return "运行中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "timeout":
      return "超时";
    case "queued":
      return "排队中";
    default:
      return "待处理";
  }
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark({ className = styles.brandMark }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12c3.2-5.3 7.1-8 11.8-8 2.4 0 4.1.8 5.2 2.4-1.4.4-2.6 1.1-3.6 2.1 1.5.2 2.8.8 3.8 1.8-2.2 1-3.7 2.8-4.6 5.2-1.2 3.2-3.6 5-7.2 5.5 1.3-1.6 2.2-3.4 2.7-5.3-2.2-.4-4.1-1.3-5.7-2.7-.9-.8-1.7-1.9-2.4-3Z"
        fill="currentColor"
      />
      <circle cx="16.2" cy="8.7" r=".9" fill="var(--ax-bg-subtle)" />
    </svg>
  );
}

export function NewSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sidebarCollapsed, toggleSidebar, toggleRight } = useAppLayout();
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = React.useState("");

  // The palette's task command reads activeTask.paused, so the list must be
  // re-read when the palette opens and after a control action - otherwise the
  // label stays stale and the same command pauses twice instead of resuming.
  const refreshTasks = React.useCallback(() => {
    api
      .tasks()
      .then((result) => setTasks(result.tasks ?? []))
      .catch(() => setTasks([]));
  }, []);
  const [onlyRunning, setOnlyRunning] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [activeResult, setActiveResult] = React.useState(0);
  const [modLabel, setModLabel] = React.useState("Ctrl");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsButtonRef = React.useRef<HTMLButtonElement>(null);
  const searchButtonRef = React.useRef<HTMLButtonElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const resolvedThemeMode = usePreferencesStore((state) => state.resolvedThemeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  // The task currently open in the workspace, if any. Used to offer task-scoped
  // commands (pause/resume) instead of always showing them.
  const activeTask = React.useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [tasks, activeTaskId],
  );

  React.useEffect(() => {
    if (!pathname.startsWith("/function/tasks/detail")) {
      setActiveTaskId("");
      return;
    }
    setActiveTaskId(searchParams.get("id") ?? "");
  }, [pathname, searchParams]);

  React.useEffect(() => {
    refreshTasks();
    return undefined;
  }, [refreshTasks]);

  React.useEffect(() => {
    const platform = navigator.platform || navigator.userAgent;
    setModLabel(/Mac|iPhone|iPad/i.test(platform) ? "⌘" : "Ctrl");
  }, []);

  const openSearch = React.useCallback((trigger: HTMLElement | null) => {
    searchReturnFocusRef.current =
      trigger && trigger !== document.body ? trigger : searchButtonRef.current;
    setSearch("");
    setActiveResult(0);
    refreshTasks();
    setSearchOpen(true);
  }, [refreshTasks]);
  const closeSearch = React.useCallback((returnFocus = true) => {
    setSearchOpen(false);
    setSearch("");
    setActiveResult(0);
    if (returnFocus) {
      const target = searchReturnFocusRef.current;
      window.requestAnimationFrame(() => target?.focus());
    }
  }, []);

  // Stable identity: the dialog's focus-trap effect depends on it.
  const closeSettings = React.useCallback(() => setSettingsOpen(false), []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (searchOpen) closeSearch(true);
        else openSearch(document.activeElement instanceof HTMLElement ? document.activeElement : null);
        return;
      }
      // Ctrl/Cmd+, opens settings — the hint shown in the palette must be real.
      if (mod && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // Ctrl+B is intentionally NOT handled here: AppFrame owns it (and guards
      // typing targets). A second handler made the two toggles cancel out.
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, closeSearch, openSearch]);

  React.useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  // Palette entries are either navigations (href) or commands (run). Commands are
  // real actions against real state — no decorative entries.
  type PaletteEntry = {
    id: string;
    label: string;
    kind: string;
    hint?: string;
    href?: string;
    run?: () => void;
  };

  const commands = React.useMemo<PaletteEntry[]>(
    () => [
      {
        id: "cmd-new-task",
        label: "新建任务",
        kind: "命令",
        run: () => router.push("/function/tasks/new"),
      },
      {
        id: "cmd-settings",
        label: "打开设置",
        kind: "命令",
        hint: "Ctrl ,",
        run: () => setSettingsOpen(true),
      },
      {
        id: "cmd-toggle-sidebar",
        label: sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏",
        kind: "命令",
        hint: "Ctrl B",
        run: toggleSidebar,
      },
      {
        id: "cmd-toggle-right",
        label: "打开/关闭右侧检查器",
        kind: "命令",
        hint: "Ctrl Shift B",
        run: toggleRight,
      },
      {
        id: "cmd-refresh",
        label: "刷新当前页面数据",
        kind: "命令",
        run: () => {
          router.refresh();
          toast.success("已刷新");
        },
      },
      {
        id: "cmd-copy-link",
        label: "复制当前页链接",
        kind: "命令",
        run: () => {
          const url = window.location.href;
          void navigator.clipboard?.writeText(url).then(
            () => toast.success("链接已复制"),
            () => toast.error("复制失败，请手动复制地址栏"),
          );
        },
      },
      {
        id: "cmd-theme",
        label: resolvedThemeMode === "dark" ? "切换到浅色主题" : "切换到深色主题",
        kind: "命令",
        run: () => setThemeMode(resolvedThemeMode === "dark" ? "light" : "dark"),
      },
      // Only offered when a task is actually open — a "pause task" command with no
      // task would be a fake affordance.
      ...(activeTask
        ? [
            {
              id: "cmd-toggle-task",
              label: activeTask.paused ? "恢复当前任务" : "暂停当前任务",
              kind: "命令",
              run: () => {
                const action = activeTask.paused ? "resume" : "pause";
                void api.controlTask(activeTask.id, action).then(
                  () => {
                    toast.success(action === "pause" ? "已暂停" : "已恢复");
                    refreshTasks();
                  },
                  (err: Error) => toast.error(err.message || "操作失败"),
                );
              },
            },
          ]
        : []),
    ],
    [router, sidebarCollapsed, toggleSidebar, toggleRight, resolvedThemeMode, setThemeMode, activeTask, refreshTasks],
  );

  const searchEntries = React.useMemo(() => {
    const entries: PaletteEntry[] = [
      ...commands,
      ...tasks.map((task) => ({
        id: `task-${task.id}`,
        label: taskName(task),
        kind: "任务",
        href: `/function/tasks/detail?id=${encodeURIComponent(task.id)}`,
      })),
      ...quickLinks.map((item) => ({ id: `quick-${item.href}`, label: item.label, kind: "面板", href: item.href })),
      ...moreLinks.map((item) => ({ id: `more-${item.href}`, label: item.label, kind: "设置", href: item.href })),
    ];
    const needle = search.trim().toLowerCase();
    return needle ? entries.filter((entry) => entry.label.toLowerCase().includes(needle)) : entries;
  }, [commands, search, tasks]);

  const results = React.useMemo(() => searchEntries.slice(0, 40), [searchEntries]);

  React.useEffect(() => {
    setActiveResult(0);
  }, [search]);

  React.useEffect(() => {
    if (!searchOpen) return;
    setActiveResult((index) => Math.min(index, Math.max(results.length - 1, 0)));
  }, [results, searchOpen]);

  React.useEffect(() => {
    if (!searchOpen || results.length === 0) return;
    document.getElementById(`sidebar-search-option-${activeResult}`)?.scrollIntoView({ block: "nearest" });
  }, [activeResult, results, searchOpen]);

  const openSearchResult = React.useCallback(
    (entry: PaletteEntry) => {
      const target = searchReturnFocusRef.current;
      setSearchOpen(false);
      setSearch("");
      setActiveResult(0);
      if (target) window.requestAnimationFrame(() => target.focus());
      if (entry.run) {
        entry.run();
        return;
      }
      if (entry.href) router.push(entry.href);
    },
    [router],
  );

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (results.length === 0) return;
      let next = activeResult;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = results.length - 1;
      else next = (activeResult + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      setActiveResult(next);
      return;
    }
    if (event.key === "Enter") {
      const index = Math.min(activeResult, Math.max(results.length - 1, 0));
      const entry = results[index];
      if (entry) {
        event.preventDefault();
        openSearchResult(entry);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch(true);
      return;
    }
    if (event.key === "Tab") {
      // Command palette keeps focus in its input while open.
      event.preventDefault();
    }
  };

  const rootClass = `${styles.root} ${sidebarCollapsed ? styles.collapsed : ""}`;
  const visibleTasks = onlyRunning
    ? tasks.filter((task) => task.status === "running" && !task.paused)
    : tasks;
  const moreItems: SidebarMenuItem[] = moreLinks.map((item) => ({
    id: item.href,
    label: item.label,
    href: item.href,
    active: isActivePath(pathname, item.href),
  }));
  const accountItems: SidebarMenuItem[] = [
    { id: "account-dashboard", label: "任务总览", href: "/dashboard", active: isActivePath(pathname, "/dashboard") },
    { id: "account-settings", label: "系统设置", href: "/system/settings", active: isActivePath(pathname, "/system/settings") },
  ];

  return (
    <div className={rootClass} data-testid="new-sidebar" data-collapsed={sidebarCollapsed ? "true" : "false"}>
      <div className={styles.brandRow}>
        {sidebarCollapsed ? (
          <button
            type="button"
            className={styles.railBrand}
            onClick={toggleSidebar}
            title="展开侧边栏 (Ctrl+B)"
            aria-label="展开侧边栏"
            aria-keyshortcuts="Control+B Meta+B"
            aria-expanded={false}
            data-tooltip="展开侧边栏 (Ctrl+B)"
            data-testid="rail-expand"
          >
            <BrandMark className={styles.railBrandMark} />
            <PanelLeftOpen className={styles.railBrandIcon} size={18} aria-hidden="true" />
          </button>
        ) : (
          <>
            <Link href="/dashboard" className={styles.brandIdentity} aria-label="返回任务总览">
              <BrandMark />
              <span className={styles.brandName}>mioX</span>
              <span className={styles.brandBadge}>PENTEST</span>
            </Link>
            <button
              type="button"
              className={styles.sidebarToggle}
              onClick={toggleSidebar}
              title="折叠侧边栏 (Ctrl+B)"
              aria-label="折叠侧边栏"
              aria-keyshortcuts="Control+B Meta+B"
              aria-expanded
              data-testid="sidebar-toggle"
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      <Link href="/function/tasks/new" className={styles.newTask} title="新建任务" data-tooltip="新建任务">
        <Plus className={styles.quickIcon} />
        <span className={styles.newTaskLabel}>新建任务</span>
      </Link>

      <button
        ref={searchButtonRef}
        type="button"
        className={styles.searchButton}
        onClick={(event) => openSearch(event.currentTarget)}
        title="搜索任务、面板或执行命令（Ctrl+K）"
        aria-label="搜索任务、面板或执行命令"
        aria-haspopup="dialog"
        aria-expanded={searchOpen}
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="sidebar-search"
      >
        <Search className={styles.searchIcon} aria-hidden="true" />
        <span className={styles.searchButtonLabel}>搜索或执行命令…</span>
        <span className={styles.shortcut}>{modLabel} K</span>
      </button>

      <div className={styles.taskScroll} data-testid="task-scroll">
        <div className={`${styles.sectionLabel} ${styles.taskSectionLabel}`}>
          <span>工作区 / 任务</span>
          <button
            type="button"
            className={`${styles.sectionAction} ${onlyRunning ? styles.sectionActionActive : ""}`}
            onClick={() => setOnlyRunning((value) => !value)}
            title={onlyRunning ? "显示全部任务" : "只看运行中的任务"}
            aria-pressed={onlyRunning}
            aria-label={onlyRunning ? "显示全部任务" : "只看运行中的任务"}
            disabled={tasks.length === 0}
            data-testid="task-filter"
          >
            <SlidersHorizontal className={styles.quickIcon} />
          </button>
        </div>
        <div className={styles.taskList} data-testid="task-list">
          {visibleTasks.length === 0 ? (
            <div className={styles.emptyTask}>{onlyRunning ? "没有运行中的任务" : "暂无任务"}</div>
          ) : (
            visibleTasks.map((task) => (
              <Link
                key={task.id}
                href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`}
                className={`${styles.taskRow} ${task.id === activeTaskId ? styles.taskRowActive : ""}`}
                title={taskName(task)}
                aria-current={task.id === activeTaskId ? "page" : undefined}
              >
                <span className={`${styles.statusDot} ${statusClass(task)}`} />
                <span className={styles.taskName}>{taskName(task)}</span>
                <span className={styles.taskTime}>{statusLabel(task)}</span>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className={styles.sectionLabel}>
        <span>全局面板</span>
      </div>

      <div className={styles.quickList}>
        {quickLinks.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.quickItem} ${active ? styles.quickItemActive : ""}`}
              title={item.label}
              data-tooltip={item.label}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={styles.quickIcon} />
              <span className={styles.quickLabel}>{item.label}</span>
            </Link>
          );
        })}
        <SidebarMenu
          ariaLabel="更多面板"
          menuId="sidebar-more-menu"
          items={moreItems}
          triggerClassName={`${styles.quickItem} ${styles.moreTrigger}`}
          triggerContent={
            <>
              <MoreHorizontal className={styles.quickIcon} />
              <span className={styles.quickLabel}>更多</span>
              <ChevronUp className={styles.menuChevron} aria-hidden="true" />
            </>
          }
          triggerLabel="更多面板"
          triggerTestId="sidebar-more"
          triggerTooltip="更多面板"
          placement="up"
        />
      </div>

      <div className={styles.footer}>
        <button
          ref={settingsButtonRef}
          type="button"
          className={styles.footerRow}
          title="设置"
          data-tooltip="设置"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          data-testid="sidebar-settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className={styles.footerIcon} />
          <span className={styles.footerGrow}>设置</span>
        </button>
        <div className={styles.footerAccount}>
          <SidebarMenu
            ariaLabel="账户菜单"
            menuId="sidebar-account-menu"
            items={accountItems}
            triggerClassName={styles.footerRow}
            triggerContent={
              <>
                <span className={styles.avatar} aria-hidden="true">
                  A
                </span>
                <span className={styles.footerGrow}>admin</span>
                <ChevronUp className={styles.menuChevron} aria-hidden="true" />
              </>
            }
            triggerLabel="账户菜单"
            triggerTestId="sidebar-account"
            triggerTooltip="账户菜单"
            placement="up"
          />
        </div>
      </div>

      {searchOpen ? (
        <div
          className={styles.commandOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearch(true);
          }}
        >
          <div
            className={styles.commandDialog}
            role="dialog"
            aria-modal="true"
            aria-label="搜索任务、面板或执行命令"
          >
            <div className={styles.commandInputRow}>
              <Search className={styles.commandSearchIcon} aria-hidden="true" />
              <input
                ref={searchInputRef}
                className={styles.commandInput}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveResult(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="搜索任务、面板，或输入命令…"
                aria-label="搜索任务、面板或执行命令"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="sidebar-search-listbox"
                aria-activedescendant={results.length > 0 ? `sidebar-search-option-${activeResult}` : undefined}
              />
              <span className={styles.commandHint}>Esc</span>
            </div>
            <div className={styles.commandResults} id="sidebar-search-listbox" role="listbox" aria-label="搜索结果">
              {results.length === 0 ? (
                <div className={styles.commandEmpty}>没有匹配结果</div>
              ) : (
                results.map((entry, index) => (
                  <button
                    key={entry.id}
                    id={`sidebar-search-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeResult}
                    tabIndex={-1}
                    className={`${styles.commandResult} ${index === activeResult ? styles.commandResultActive : ""}`}
                    onMouseEnter={() => setActiveResult(index)}
                    onClick={() => openSearchResult(entry)}
                  >
                    <span className={styles.commandResultLabel}>{entry.label}</span>
                    {entry.hint ? <span className={styles.commandHint}>{entry.hint}</span> : null}
                    <span className={styles.commandKind}>{entry.kind}</span>
                  </button>
                ))
              )}
            </div>
            <div className={styles.commandFooter}>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> 选择
              </span>
              <span>
                <kbd>Enter</kbd> 打开
              </span>
              <span>
                <kbd>Esc</kbd> 关闭
              </span>
            </div>
            <span className={styles.srOnly} role="status" aria-live="polite">
              {results.length} 个结果
            </span>
          </div>
        </div>
      ) : null}

      {/* Harness-level settings modal (replaces the old /system/settings link). */}
      <SettingsDialog
        open={settingsOpen}
        onClose={closeSettings}
        returnFocusRef={settingsButtonRef}
      />
    </div>
  );
}
