"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import {
  Activity,
  Bug,
  ChevronUp,
  LayoutDashboard,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
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
  // No JS truncation: the row ellipsises with CSS, so a wide sidebar shows more text
  // (reference: DSH rows never hard-cut the title in code).
  return task.name?.trim() || task.description?.trim() || task.goal?.trim() || task.id;
}

/**
 * Relative age in the DSH buckets (刚刚 / N分钟 / N小时 / N天). The row shows the age,
 * the status lives in the dot + tooltip, so the list reads like a recency-ordered
 * session list instead of a wall of status words.
 */
function relTime(task: Task): string {
  const seconds = task.last_activity_unix ?? task.created_unix ?? 0;
  if (!seconds) return "";
  const minutes = Math.floor((Date.now() - seconds * 1000) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天`;
  return `${Math.floor(days / 30)}个月`;
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

/**
 * Row hover card (reference: DSH `SessionHoverContent` + `HoverCard`).
 *
 * DSH shows a delayed card beside the row with the full title, the working directory,
 * the age, and the status lines. We have no cwd per task, so the card carries the full
 * title, the description, the relative age and the absolute creation time — the details
 * a truncated sidebar row cannot show.
 *
 * Rendered through a portal so the sidebar's scroll container cannot clip it.
 */
function TaskHoverCard({
  task,
  anchor,
}: {
  readonly task: Task;
  readonly anchor: DOMRect;
}) {
  const width = 280;
  const left = Math.min(anchor.right + 10, window.innerWidth - width - 12);
  const top = Math.min(anchor.top - 6, window.innerHeight - 160);
  // taskName falls back to the description when a task has no name, so only show the
  // description line when it adds information instead of repeating the title.
  const title = taskName(task);
  const description = task.description?.trim() ?? "";
  const showDescription = description !== "" && description !== title;
  return createPortal(
    <div className={styles.hoverCard} style={{ left, top, width }} role="tooltip" data-testid="sidebar-hover-card">
      <div className={styles.hoverTitle}>{title}</div>
      {showDescription ? <div className={styles.hoverPath}>{description}</div> : null}
      <div className={styles.hoverMeta}>
        {relTime(task)}
        {task.created_unix ? ` · 创建于 ${new Date(task.created_unix * 1000).toLocaleString("zh-CN")}` : ""}
      </div>
      <div className={styles.hoverStatus}>
        <span className={`${styles.statusDot} ${statusClass(task)}`} />
        <span>{statusLabel(task)}</span>
      </div>
    </div>,
    document.body,
  );
}

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* Overflow this small hides no meaningful tail; scrolling for it reads as an
   accidental jitter, so the title stays put (reference: DSH MIN_TITLE_REVEAL_PX). */
const MIN_TITLE_REVEAL_PX = 8;
/* Folded category groups, persisted per browser. */
const SIDEBAR_COLLAPSED_KEY = "miox.sidebar.collapsedGroups";
const SIDEBAR_TOUCHED_KEY = "miox.sidebar.touchedGroups";/* Marquee travel speed: slow enough to read the text as it passes. */
const TITLE_MARQUEE_PX_PER_MS = 0.03;

/**
 * Marquee a title wider than its cell while its row is hovered (reference: DSH
 * `useTitleMarquee`). The span clips its own text, so entering crawls it at a constant
 * speed until the far edge is in view, then rests there. Leaving snaps back in one step.
 * `data-scrolled` / `data-clipped` drive the fade masks so a clipped title never looks
 * like it just ends.
 */
function useTitleMarquee(title: React.RefObject<HTMLSpanElement | null>): {
  enter: () => void;
  leave: () => void;
} {
  const frame = React.useRef(0);
  const revealing = React.useRef(false);
  React.useEffect(() => () => window.cancelAnimationFrame(frame.current), []);
  return React.useMemo(
    () => ({
      enter: () => {
        const element = title.current;
        if (element === null || revealing.current) return;
        revealing.current = true;
        const range = element.scrollWidth - element.clientWidth;
        if (range <= MIN_TITLE_REVEAL_PX) return;
        const place = (left: number) => {
          element.scrollLeft = left;
          if (left > 0) element.dataset.scrolled = "";
          else delete element.dataset.scrolled;
          if (left < range) element.dataset.clipped = "";
          else delete element.dataset.clipped;
        };
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          place(range);
          return;
        }
        window.cancelAnimationFrame(frame.current);
        let previous: number | undefined;
        let position = 0;
        const step = (now: number) => {
          position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
          previous = now;
          place(Math.min(position, range));
          if (position < range) frame.current = window.requestAnimationFrame(step);
        };
        frame.current = window.requestAnimationFrame(step);
      },
      leave: () => {
        revealing.current = false;
        window.cancelAnimationFrame(frame.current);
        const element = title.current;
        if (element === null) return;
        element.scrollLeft = 0;
        delete element.dataset.scrolled;
        delete element.dataset.clipped;
      },
    }),
    [title],
  );
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

/**
 * Row context menu (reference: DSH `registerSessionMenus` — pin / rename / copy id /
 * archive, ordered by weight). Right-click or the row's "…" button opens it.
 */
function TaskContextMenu({
  task,
  x,
  y,
  onClose,
  onPin,
  onRename,
  onCopyId,
  onArchive,
  onDelete,
}: {
  readonly task: Task;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onPin: () => void;
  readonly onRename: () => void;
  readonly onCopyId: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items: ReadonlyArray<{ id: string; label: string; run: () => void; danger?: boolean }> = [
    { id: "pin", label: task.pinned ? "取消置顶" : "置顶", run: onPin },
    { id: "rename", label: "重命名", run: onRename },
    { id: "copy", label: "复制任务 ID", run: onCopyId },
    { id: "archive", label: "归档", run: onArchive },
    { id: "delete", label: "删除", run: onDelete, danger: true },
  ];
  return createPortal(
    <div
      ref={ref}
      className={styles.rowMenu}
      style={{ left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 190) }}
      role="menu"
      data-testid="sidebar-row-menu"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={styles.rowMenuItem}
          data-danger={item.danger || undefined}
          data-testid={`sidebar-row-menu-${item.id}`}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Inline rename dialog (a native prompt would break the harness look). */
function RenameTaskDialog({
  task,
  onClose,
  onSubmit,
}: {
  readonly task: Task;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = React.useState(taskName(task));
  return createPortal(
    <div className={styles.dialogBackdrop} onMouseDown={onClose} data-testid="sidebar-rename-backdrop">
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.dialogTitle}>重命名任务</div>
        <input
          className={styles.dialogInput}
          value={draft}
          autoFocus
          data-testid="sidebar-rename-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && draft.trim() !== "") {
              onSubmit(draft.trim());
              onClose();
            }
          }}
        />
        <div className={styles.dialogActions}>
          <button type="button" className={styles.dialogGhost} onClick={onClose} data-testid="sidebar-rename-cancel">
            取消
          </button>
          <button
            type="button"
            className={styles.dialogPrimary}
            data-testid="sidebar-rename-save"
            onClick={() => {
              if (draft.trim() !== "") onSubmit(draft.trim());
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One sidebar task row: status dot, marquee title, pin, relative age. */function TaskRowItem({
  task,
  active,
  onHover,
  onLeave,
  onMenu,
}: {
  readonly task: Task;
  readonly active: boolean;
  readonly onHover: (task: Task, element: HTMLElement) => void;
  readonly onLeave: () => void;
  readonly onMenu: (task: Task, x: number, y: number) => void;
}) {
  const nameRef = React.useRef<HTMLSpanElement>(null);
  const marquee = useTitleMarquee(nameRef);
  return (
    <Link
      href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`}
      className={`${styles.taskRow} ${active ? styles.taskRowActive : ""}`}
      title={`${taskName(task)} · ${statusLabel(task)}`}
      aria-current={active ? "page" : undefined}
      data-task-id={task.id}
      data-testid="sidebar-task-row"
      onMouseEnter={(event) => {
        marquee.enter();
        onHover(task, event.currentTarget);
      }}
      onMouseLeave={() => {
        marquee.leave();
        onLeave();
      }}
      onFocus={(event) => {
        marquee.enter();
        onHover(task, event.currentTarget);
      }}
      onBlur={() => {
        marquee.leave();
        onLeave();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(task, event.clientX, event.clientY);
      }}
    >
      <span className={`${styles.statusDot} ${statusClass(task)}`} />
      <span className={styles.taskName} ref={nameRef} data-testid="sidebar-task-name">
        {taskName(task)}
      </span>
      {task.pinned ? <Pin size={10} className={styles.taskPin} aria-label="已置顶" /> : null}
      <button
        type="button"
        className={styles.rowMenuButton}
        aria-label="任务操作"
        title="任务操作"
        data-testid="sidebar-row-menu-button"
        onClick={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(task, rect.left, rect.bottom + 4);
        }}
      >
        <MoreHorizontal size={12} aria-hidden="true" />
      </button>
      <span className={styles.taskTime} data-testid="sidebar-task-time">{relTime(task)}</span>
    </Link>
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

  // Row actions (reference: DSH session context menu): pin / rename / copy id / archive.
  const [rowMenu, setRowMenu] = React.useState<{ task: Task; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = React.useState<Task | null>(null);

  const openRowMenu = React.useCallback((task: Task, x: number, y: number) => {
    setHoveredRow(null);
    setRowMenu({ task, x, y });
  }, []);

  const runRowAction = React.useCallback(
    (action: () => Promise<unknown>, success: string) => {
      action()
        .then(() => {
          toast.success(success);
          refreshTasks();
        })
        .catch((error: Error) => toast.error(error.message || "操作失败"));
    },
    [refreshTasks],
  );

  // Folded sidebar groups (category buckets). Persisted per browser.
  const [collapsedGroups, setCollapsedGroups] = React.useState<ReadonlySet<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
    } catch {
      return new Set<string>();
    }
  });

  // Groups the user has explicitly toggled. Untouched groups default to COLLAPSED
  // (DSH: root groups default collapsed, ui-sidebar WorkspaceBrowser).
  const [touchedGroups, setTouchedGroups] = React.useState<ReadonlySet<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const raw = window.localStorage.getItem(SIDEBAR_TOUCHED_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
    } catch {
      return new Set<string>();
    }
  });

  // Watermark: groups show 5 rows by default (DSH SESSION_WATERMARK_BASE=5).
  const [showAllGroups, setShowAllGroups] = React.useState<ReadonlySet<string>>(() => new Set<string>());

  const toggleGroup = React.useCallback((key: string) => {
    // Render semantics: untouched -> collapsed; touched -> mirror collapsedGroups.
    // Toggle must flip the RENDERED state, not the raw set membership (otherwise
    // the first click on an untouched group would collapse it instead of expanding).
    const currentlyCollapsed = touchedGroups.has(key) ? collapsedGroups.has(key) : true;
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (currentlyCollapsed) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // storage unavailable: keep the in-memory state
      }
      return next;
    });
    setTouchedGroups((current) => {
      const next = new Set(current);
      next.add(key);
      try {
        window.localStorage.setItem(SIDEBAR_TOUCHED_KEY, JSON.stringify([...next]));
      } catch {
        // storage unavailable: keep the in-memory state
      }
      return next;
    });
  }, [touchedGroups, collapsedGroups]);

  // Row hover card: delayed like DSH's HoverCard so sweeping the list does not flash a
  // card on every row passed over.
  const [hoveredRow, setHoveredRow] = React.useState<{ task: Task; anchor: DOMRect } | null>(null);
  const hoverTimer = React.useRef<number | null>(null);

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  const onRowEnter = React.useCallback((task: Task, element: HTMLElement) => {
    clearHoverTimer();
    const anchor = element.getBoundingClientRect();
    hoverTimer.current = window.setTimeout(() => setHoveredRow({ task, anchor }), 350);
  }, [clearHoverTimer]);

  const onRowLeave = React.useCallback(() => {
    clearHoverTimer();
    setHoveredRow(null);
  }, [clearHoverTimer]);

  React.useEffect(() => clearHoverTimer, [clearHoverTimer]);
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
  // D2-T3: 截断提示（DSH 搜索上限由 Host 定且提示"还有更多"；我们之前硬截 40 条无提示）
  const resultsTruncated = searchEntries.length > results.length;

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
  // Group the list by task category (reference: DSH groups sessions under their
  // workspace/project with a collapsible folder row). Collapse state is per browser so
  // a folded group stays folded across reloads.
  const groups = React.useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; tasks: Task[] }>();
    for (const task of visibleTasks) {
      const key = task.category_id != null ? `c:${task.category_id}` : "none";
      const label = task.category_id != null ? task.category_name?.trim() || `分类 #${task.category_id}` : "未分类";
      const bucket = byKey.get(key);
      if (bucket) bucket.tasks.push(task);
      else byKey.set(key, { key, label, tasks: [task] });
    }
    // Named categories first (stable by label), the ungrouped bucket last.
    return [...byKey.values()].sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.label.localeCompare(b.label, "zh-CN");
    });
  }, [visibleTasks]);
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
            groups.map((group) => {
              // Untouched groups default to COLLAPSED (DSH root-group semantics).
              const collapsed = touchedGroups.has(group.key) ? collapsedGroups.has(group.key) : true;
              const showAll = showAllGroups.has(group.key);
              const watermark = 5; // DSH SESSION_WATERMARK_BASE
              const shownTasks = showAll ? group.tasks : group.tasks.slice(0, watermark);
              const hiddenCount = group.tasks.length - shownTasks.length;
              return (
                <div className={styles.taskGroup} key={group.key} data-testid="sidebar-group" data-group-key={group.key} data-collapsed={collapsed || undefined}>
                  <button
                    type="button"
                    className={styles.groupRow}
                    aria-expanded={!collapsed}
                    data-testid="sidebar-group-toggle"
                    onClick={() => toggleGroup(group.key)}
                  >
                    <ChevronUp size={11} className={styles.groupChevron} data-collapsed={collapsed || undefined} aria-hidden="true" />
                    <span className={styles.groupLabel}>{group.label}</span>
                    <span className={styles.groupCount}>{group.tasks.length}</span>
                  </button>
                  {collapsed
                    ? null
                    : shownTasks.map((task) => (
                        <TaskRowItem
                          key={task.id}
                          task={task}
                          active={task.id === activeTaskId}
                          onHover={onRowEnter}
                          onLeave={onRowLeave}
                          onMenu={openRowMenu}
                        />
                      ))}
                  {!collapsed && hiddenCount > 0 ? (
                    <button
                      type="button"
                      className={styles.groupExpandMore}
                      data-testid="sidebar-group-expand-more"
                      onClick={() =>
                        setShowAllGroups((current) => {
                          const next = new Set(current);
                          next.add(group.key);
                          return next;
                        })
                      }
                    >
                      展开其余 {hiddenCount} 个
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className={styles.sectionLabel} aria-label="全局面板">
        {/* 视觉标题已去掉（DSH 里「全局面板」只是 aria-label，不是可见标题），省 36px 固定开销 */}
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
              {resultsTruncated ? (
                <div className={styles.commandEmpty} data-testid="search-truncated-hint">
                  仅显示前 {results.length} 条，请输入更具体的关键字
                </div>
              ) : null}
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

      {hoveredRow ? <TaskHoverCard task={hoveredRow.task} anchor={hoveredRow.anchor} /> : null}

      {rowMenu ? (
        <TaskContextMenu
          task={rowMenu.task}
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={() => setRowMenu(null)}
          onPin={() =>
            runRowAction(() => api.pinTask(rowMenu.task.id, !rowMenu.task.pinned), rowMenu.task.pinned ? "已取消置顶" : "已置顶")
          }
          onRename={() => setRenaming(rowMenu.task)}
          onCopyId={() => {
            void navigator.clipboard?.writeText(rowMenu.task.id).then(
              () => toast.success("已复制任务 ID"),
              () => undefined,
            );
          }}
          onArchive={() => runRowAction(() => api.archiveTask(rowMenu.task.id), "已加入归档队列")}
          onDelete={() =>
            runRowAction(
              () =>
                api.deleteTask(rowMenu.task.id, {
                  delete_assets: true,
                  delete_traffic: true,
                  delete_files: true,
                  delete_findings: true,
                  delete_llm_records: true,
                }),
              "任务已删除",
            )
          }
        />
      ) : null}

      {renaming ? (
        <RenameTaskDialog
          task={renaming}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => runRowAction(() => api.renameTask(renaming.id, name), "已重命名")}
        />
      ) : null}
    </div>
  );
}
