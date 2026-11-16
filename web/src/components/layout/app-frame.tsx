"use client";

import * as React from "react";

import styles from "./app-frame.module.css";

interface AppLayoutContextValue {
  readonly sidebarCollapsed: boolean;
  readonly rightOpen: boolean;
  readonly toggleSidebar: () => void;
  readonly toggleRight: () => void;
}

const AppLayoutContext = React.createContext<AppLayoutContextValue | null>(null);

export function useAppLayout(): AppLayoutContextValue {
  const value = React.useContext(AppLayoutContext);
  if (!value) throw new Error("useAppLayout must be used inside <AppFrame>");
  return value;
}

export interface AppFrameProps {
  readonly sidebar: React.ReactNode;
  readonly children: React.ReactNode;
  readonly rightPanel: React.ReactNode;
  /** Right panel starts open when nothing is persisted (used by /ui-preview). */
  readonly defaultRightOpen?: boolean;
}

const SIDEBAR_MIN = 264;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 280;
const RIGHT_MIN = 300;
const CENTER_MIN = 400;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

export function AppFrame({ sidebar, children, rightPanel, defaultRightOpen = false }: AppFrameProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [rightOpen, setRightOpen] = React.useState(defaultRightOpen);
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT);
  const [rightWidth, setRightWidth] = React.useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = React.useState(0);
  const [dragging, setDragging] = React.useState<"sidebar" | "right" | null>(null);
  const hydrated = React.useRef(false);
  const rightRef = React.useRef<HTMLDivElement>(null);
  // Preference captured before an automatic narrow-viewport collapse; restored on
  // return to desktop so responsive rules never rewrite the user's choice (DSH:
  // "responsive never rewrites user preference", ui-layout AppFrame).
  const preNarrowCollapsed = React.useRef<boolean | null>(null);

  // Restore layout preferences after mount so static-export prerender stays deterministic.
  React.useEffect(() => {
    let storedSidebarCollapsed: string | null = null;
    try {
      storedSidebarCollapsed = window.localStorage.getItem("artex.sidebar.collapsed");
    } catch {
      storedSidebarCollapsed = null;
    }
    const width = window.innerWidth;
    const compact = width < 1024;
    const initialCollapsed = width < 768 ? true : storedSidebarCollapsed === null ? compact : storedSidebarCollapsed === "true";

    setSidebarCollapsed(initialCollapsed);
    setRightOpen(readBoolean("artex.rightPanel.open", defaultRightOpen));
    setSidebarWidth(clamp(readNumber("artex.sidebar.width", SIDEBAR_DEFAULT), SIDEBAR_MIN, SIDEBAR_MAX));
    const storedRightWidth = readNumber("artex.rightPanel.width", 0);
    setRightWidth(storedRightWidth > 0 ? storedRightWidth : null);
    setViewportWidth(width);

    const onResize = () => {
      const nextWidth = window.innerWidth;
      setViewportWidth(nextWidth);
      // Responsive rule: desktop -> tablet collapses the sidebar; returning to
      // desktop restores the preference that was in effect before (was: collapse
      // only, so the sidebar never re-expanded and the auto-collapse got persisted).
      if (nextWidth < 1024) {
        if (preNarrowCollapsed.current === null) preNarrowCollapsed.current = sidebarCollapsed;
        setSidebarCollapsed(true);
      } else if (preNarrowCollapsed.current !== null) {
        setSidebarCollapsed(preNarrowCollapsed.current);
        preNarrowCollapsed.current = null;
      }
    };
    window.addEventListener("resize", onResize);
    hydrated.current = true;
    return () => window.removeEventListener("resize", onResize);
  }, [defaultRightOpen]);

  React.useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem("artex.sidebar.collapsed", String(sidebarCollapsed));
      window.localStorage.setItem("artex.sidebar.width", String(Math.round(sidebarWidth)));
      window.localStorage.setItem("artex.rightPanel.open", String(rightOpen));
      if (rightWidth === null) {
        window.localStorage.removeItem("artex.rightPanel.width");
      } else {
        window.localStorage.setItem("artex.rightPanel.width", String(Math.round(rightWidth)));
      }
    } catch {
      // localStorage may be unavailable; layout still works in memory.
    }
  }, [sidebarCollapsed, rightOpen, sidebarWidth, rightWidth]);

  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((value) => !value);
  }, []);

  const toggleRight = React.useCallback(() => {
    setRightOpen((value) => !value);
  }, []);

  const beginResize = React.useCallback(
    (target: "sidebar" | "right") => (event: React.PointerEvent<HTMLDivElement>) => {
      if (target === "right" && !rightOpen) return;
      if (target === "sidebar" && sidebarCollapsed) return;
      event.preventDefault();

      const startX = event.clientX;
      const startSidebar = sidebarWidth;
      const startRight =
        rightRef.current?.getBoundingClientRect().width ?? rightWidth ?? window.innerWidth * 0.45;
      setDragging(target);
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        if (target === "sidebar") {
          setSidebarWidth(
            clamp(startSidebar + moveEvent.clientX - startX, SIDEBAR_MIN, SIDEBAR_MAX),
          );
          return;
        }
        const innerWidth = window.innerWidth;
        const sidebarCurrent = sidebarCollapsed ? 56 : sidebarWidth;
        const max = Math.max(
          RIGHT_MIN,
          Math.min(innerWidth * 0.7, innerWidth - sidebarCurrent - CENTER_MIN),
        );
        setRightWidth(clamp(startRight + (startX - moveEvent.clientX), RIGHT_MIN, max));
      };
      const onUp = () => {
        setDragging(null);
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rightOpen, rightWidth, sidebarCollapsed, sidebarWidth],
  );

  // Keyboard: Mod+B toggles the sidebar (ignored while typing), Mod+Shift+B toggles the
  // right inspector. At tablet/mobile widths Escape closes the overlay inspector.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "b" && !event.shiftKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && key === "b" && event.shiftKey) {
        event.preventDefault();
        toggleRight();
        return;
      }
      if (event.key === "Escape" && !event.isComposing && rightOpen) {
        if (window.innerWidth <= 1023) {
          event.preventDefault();
          setRightOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rightOpen, toggleSidebar, toggleRight]);

  const isMobile = viewportWidth > 0 && viewportWidth < 768;
  const className = [
    styles.appFrame,
    sidebarCollapsed ? styles.sidebarCollapsed : "",
    rightOpen ? "" : styles.rightClosed,
    dragging ? styles.dragging : "",
    isMobile && !sidebarCollapsed ? styles.mobileSidebarOpen : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = {
    "--ax-sidebar-expanded-width": `${sidebarWidth}px`,
    ...(rightWidth === null ? {} : { "--ax-right-width-px": `${rightWidth}px` }),
  } as React.CSSProperties;

  return (
    <AppLayoutContext.Provider value={{ sidebarCollapsed, rightOpen, toggleSidebar, toggleRight }}>
      <div
        className={className}
        style={style}
        data-testid="app-frame"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
        data-right-open={rightOpen ? "true" : "false"}
      >
        <aside className={styles.sidebar} data-testid="app-sidebar">
          {sidebar}
        </aside>
        <div className={styles.main} data-testid="app-main">
          {children}
        </div>
        <div
          ref={rightRef}
          className={styles.right}
          data-testid="app-right"
          inert={rightOpen ? undefined : true}
          aria-hidden={rightOpen ? undefined : true}
        >
          {rightPanel}
        </div>
        <div className={styles.scrim} aria-hidden="true" onClick={toggleSidebar} />
        <div
          className={styles.sidebarResizer}
          role="separator"
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={sidebarCollapsed ? -1 : 0}
          data-testid="sidebar-resizer"
          onPointerDown={beginResize("sidebar")}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          onKeyDown={(event) => {
            if (sidebarCollapsed) return;
            const step = event.shiftKey ? 32 : 12;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSidebarWidth((value) => clamp(value - step, SIDEBAR_MIN, SIDEBAR_MAX));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setSidebarWidth((value) => clamp(value + step, SIDEBAR_MIN, SIDEBAR_MAX));
            } else if (event.key === "Home") {
              event.preventDefault();
              setSidebarWidth(SIDEBAR_DEFAULT);
            }
          }}
        />
        <div
          className={styles.rightResizer}
          role="separator"
          aria-label="调整右侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={RIGHT_MIN}
          aria-valuemax={Math.max(RIGHT_MIN, Math.round(viewportWidth * 0.7))}
          aria-valuenow={Math.round(rightWidth ?? (viewportWidth || 0) * 0.45)}
          tabIndex={rightOpen ? 0 : -1}
          data-testid="right-resizer"
          onPointerDown={beginResize("right")}
          onDoubleClick={() => setRightWidth(null)}
          onKeyDown={(event) => {
            if (!rightOpen) return;
            const step = event.shiftKey ? 40 : 16;
            const current = rightWidth ?? Math.round((viewportWidth || 0) * 0.45);
            const max = Math.max(
              RIGHT_MIN,
              Math.min(viewportWidth * 0.7, viewportWidth - (sidebarCollapsed ? 56 : sidebarWidth) - CENTER_MIN),
            );
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setRightWidth(clamp(current + step, RIGHT_MIN, max));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setRightWidth(clamp(current - step, RIGHT_MIN, max));
            } else if (event.key === "Home") {
              event.preventDefault();
              setRightWidth(null);
            }
          }}
        />
      </div>
    </AppLayoutContext.Provider>
  );
}
