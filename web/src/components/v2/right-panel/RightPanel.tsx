"use client";

/**
 * Right panel: the DSH right Sidebar's pane structure over ARTEX data — one
 * tab-strip pane normally, two side-by-side panes while split.
 *
 * Structure ported from the DSH Web client:
 * - `ui-sidebar-right/src/client/shell/SidebarRight.tsx:338-378` draws the
 *   column as a docking surface of one or two horizontal panes; the panel has
 *   no header of its own. `SidebarRight.tsx:356-375` allows at most two docked
 *   panes (`dockPaneIds(layout).length < 2`) and passes the kit a 0.2 minimum
 *   pane share.
 * - `ui-dockkit/src/components/TabLayout.tsx:120-160` lays the panes out as one
 *   CSS grid row (`minmax(0, <share>fr)` per pane with a 0px divider column, so
 *   the pane widths plus the painted seam are exactly the surface width) and
 *   draws each pane's strip inside that pane.
 * - `ui-dockkit/src/components/TabPanel.tsx:297-464` draws one pane's strip: a
 *   `role="tablist"`, one `role="tab"` chip per page with `aria-selected` and a
 *   roving tab stop, Left/Right wrapping and Home/End moving focus, and
 *   Enter/Space selecting. `TabPanel.tsx:423-448` is the kit's split control
 *   with its blocked states (`budget` / `width`).
 * - `ui-dockkit/src/engine/planner.ts:139-163` splits a pane to its right and
 *   seeds the new pane; `ui-sidebar-right/src/client/stores.ts:347-360` caps the
 *   right column at two panes and refuses to split an empty pane;
 *   `planner.ts:382-397` merges a pane away once its last tab leaves.
 * - `ui-sidebar-right/src/client/shell/SidebarRight.tsx:370-373` puts the
 *   embedder chrome (presentation + collapse) only in the top-right pane's
 *   strip end, which is the strip seat `TabPanel.tsx:449-461` reserves.
 *
 * ARTEX adaptations, stated here because they are visible in the DOM:
 * - The fixed pages cannot be closed or moved, so the split control both
 *   opens and merges the second pane (DSH merges through its settle rule when a
 *   pane empties). Merging keeps the page of the pane the user is in.
 * - The split control rides the chrome seat next to fullscreen/collapse (the
 *   task's three-button chrome), where DSH draws it at each pane's strip end.
 * - The new pane is seeded with the next page rather than DSH's guide page.
 *
 * Pages keep their ARTEX data wiring: findings (`/exploration/findings`),
 * approvals (`/intercept/pending`), workspace files (`/workspace/list`), task
 * assets (`/assets?task_id=`) and bound traffic evidence (`/exploration/findings`
 * + `/exploration/findings/{id}/traffic`), and the active Task the shell passes
 * in. Each pane scrolls on its own and owns its own page selection.
 *
 * The 资产 / 证据 pages are unit C23 (P1:E8): the old right panel had six tabs
 * (`components/layout/right-panel.tsx:23-31`) and /v2 carried four, so these two
 * close the gap. Their bodies take no data props: each owns its adapter
 * (`v2/data/right-panel-assets.ts`, `v2/data/right-panel-evidence.ts`) and reads
 * the task the pane is handed, so a page switch never re-fetches anything.
 *
 * 任务 closes P1:E8: the old strip's first page (`right-panel.tsx:15`, `:24`) was
 * the one /v2 still lacked. Its body (`TaskPane.tsx`) reads through
 * `v2/data/task-overview.ts`; the four reads are held here, like the other
 * panel-level adapters, so switching pages or splitting never re-fetches them.
 *
 * The strip budgets its chips by its own measured width (UX7). The seven fixed
 * pages carry two-character labels, far narrower than the kit's 80px chip floor
 * assumes, so a chip that no longer fits moves into a More menu instead of
 * scrolling out of reach; the selected page always keeps a visible seat.
 */
import * as React from "react";

import type { Task } from "@/lib/types";
import { useApprovals } from "@/v2/data/approvals";
import { useFindings } from "@/v2/data/findings";
import { findingsToRows } from "@/v2/data/findings-map";
import {
  useOverviewSummary,
  useTaskConstraints,
  useTaskGoals,
  useTaskScope,
} from "@/v2/data/task-overview";
import { useWorkspaceFiles } from "@/v2/data/workspace-files";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconEllipsisOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Menu } from "@/vendor/dsh/primitives/Menu";

import { PanelChrome } from "./PanelChrome";
import { ApprovalsPane, FilesPane, FindingsPane, SessionPane } from "./Panes";
import { AssetsPane } from "./AssetsPane";
import { EvidencePane } from "./EvidencePane";
import { TaskPane } from "./TaskPane";
import css from "./RightPanel.module.css";

/**
 * The right panel's pages, in strip order. The first four are the pages the
 * panel started with; 资产 / 证据 are unit C23's additions, placed where the old
 * panel had them (`components/layout/right-panel.tsx:24-30`: 资产 and 证据 sit
 * between 任务 and 审批).
 *
 * 任务 is the last page of the old panel to be ported (P1:E8 close-out): the old
 * strip opens with it (`right-panel.tsx:15` `RightTab` and `:24` `tabs[0]`), so
 * it is inserted first here and the six existing pages keep their order.
 */
export type RightPanelTab = "task" | "findings" | "assets" | "evidence" | "approvals" | "files" | "session";

/** A docked pane's side. The left one is the panel itself until it is split. */
type PaneId = "left" | "right";

interface TabDefinition {
  readonly id: RightPanelTab;
  readonly label: string;
}

const TABS: readonly TabDefinition[] = [
  { id: "task", label: "任务" },
  { id: "findings", label: "发现" },
  { id: "assets", label: "资产" },
  { id: "evidence", label: "证据" },
  { id: "approvals", label: "审批" },
  { id: "files", label: "文件" },
  { id: "session", label: "会话" },
];

const TAB_IDS: readonly RightPanelTab[] = TABS.map((tab) => tab.id);

/**
 * A chip's minimum box: `.chip`'s 48px floor in `RightPanel.module.css`, which
 * holds two 13px Han characters plus the 10px inset on each side.
 */
const CHIP_MIN_WIDTH = 48;

/** One visible chip including the strip's 4px gap: the width one seat takes. */
const CHIP_SEAT_WIDTH = CHIP_MIN_WIDTH + 4;

/** Room the chip band keeps for the More launcher (22px) and its 4px gap. */
const MORE_RESERVE = 28;

/** Strip-label side word, so each embedded tablist names the pane it belongs to. */
const PANE_LABEL: Record<PaneId, string> = { left: "左", right: "右" };

/**
 * Divider clamp, from the minimum pane share the right Sidebar hands the kit
 * (`SidebarRight.tsx:358`, `minPaneFraction={0.2}`).
 */
const MIN_PANE_SHARE = 0.2;
const MAX_PANE_SHARE = 0.8;

/**
 * Column width below which the split control is withheld as too narrow.
 * The DSH room rule measures rendered strips (`measure.ts:90-103`,
 * `geometry.ts:127-138`); ARTEX's right column is fixed at 420px at 1440
 * (`v2/layout/columns.ts:20`), so the rule is reduced to one threshold: each
 * half keeps enough room for the chips plus the strip's fixed chrome.
 * C23 raised it from 360: six chips at their 80px minimum plus the 10/6px strip
 * insets and the 32px of chrome buttons outgrow a 210px half pane, and a half
 * pane that scrolls its own strip hides the page the user is on.
 * P1:E8 adds the seventh chip (任务); UX7 narrows a chip's floor from the kit's
 * 80px to 48px, so the constant follows the strip on its own:
 * 7 × (48 + 4) + 16 + 32 = 412 per half, so the split control needs 824px.
 */
const MIN_SPLIT_WIDTH = 2 * (TABS.length * (CHIP_MIN_WIDTH + 4) + 16 + 32);

/**
 * Visible chip seats for a measured chip-band width, so the strip never draws a
 * chip it cannot show whole. A page that does not fit moves into More; the
 * reserve keeps that launcher's own box out of the seats it is counting.
 * @param width - the chip band's `clientWidth`.
 * @returns at least one seat (a page always stays on the strip).
 */
function visibleChipLimit(width: number): number {
  return Math.max(1, Math.floor((width - MORE_RESERVE) / CHIP_SEAT_WIDTH));
}

/**
 * The chip a navigation key moves focus to, mirroring the WAI-ARIA tabs
 * pattern DSH implements in `ui-dockkit/src/components/TabPanel.tsx:112-123`:
 * Left/Right step through the strip and wrap, Home/End jump to its ends.
 * @param key - the pressed key.
 * @param current - the tab whose chip holds focus.
 * @returns the tab to focus, or `undefined` when the key is not a navigation key.
 */
function tabForKey(key: string, current: RightPanelTab): RightPanelTab | undefined {
  const count = TAB_IDS.length;
  const index = TAB_IDS.indexOf(current);
  switch (key) {
    case "ArrowLeft":
      return TAB_IDS[(index - 1 + count) % count];
    case "ArrowRight":
      return TAB_IDS[(index + 1) % count];
    case "Home":
      return TAB_IDS[0];
    case "End":
      return TAB_IDS[count - 1];
    default:
      return undefined;
  }
}

/** Whether a key activates the focused chip, as in DSH (`TabPanel.tsx:126-128`). */
function activates(key: string): boolean {
  return key === "Enter" || key === " ";
}

/**
 * Clamp a panel share to the divider limits.
 * @param value - candidate share.
 * @returns the share inside `[MIN_PANE_SHARE, MAX_PANE_SHARE]`.
 */
function clampShare(value: number): number {
  return Math.min(MAX_PANE_SHARE, Math.max(MIN_PANE_SHARE, value));
}

/**
 * The page a deep link names
 * (`?rp=task|findings|assets|evidence|approvals|files|session`).
 * Screenshot tooling uses it to open one page without scripted clicks.
 * @returns the requested page, or `undefined` when the URL names none.
 */
function tabFromLocation(): RightPanelTab | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("rp");
  return TAB_IDS.find((id) => id === value);
}

/** What one pane's strip and body need. Declared at module scope so React keeps its identity. */
interface PaneViewProps {
  readonly pane: PaneId;
  readonly tab: RightPanelTab;
  /** Whether this pane is the one the next split/merge target reads. */
  readonly active: boolean;
  /** Whether this pane's strip carries the panel chrome (the top-right pane). */
  readonly showChrome: boolean;
  readonly split: boolean;
  readonly canSplit: boolean;
  readonly fullscreen: boolean;
  readonly onSelect: (pane: PaneId, tab: RightPanelTab) => void;
  readonly onActivate: (pane: PaneId) => void;
  readonly onToggleSplit: () => void;
  readonly onToggleFullscreen: () => void;
  readonly onClose: () => void;
  readonly renderPage: (tab: RightPanelTab) => React.ReactNode;
  readonly chipElements: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}

/**
 * One docked pane: its tab strip above its selected page's body.
 * @param props - pane identity, selection, chrome and callbacks.
 * @returns the pane section.
 */
function PaneView(props: PaneViewProps): React.ReactNode {
  const {
    pane, tab, active, showChrome, split, canSplit, fullscreen,
    onSelect, onActivate, onToggleSplit, onToggleFullscreen, onClose, renderPage, chipElements,
  } = props;
  const chipKey = (id: RightPanelTab): string => `${pane}:${id}`;

  /** Focus one chip of this pane by page id. */
  const focusChip = (id: RightPanelTab): void => {
    chipElements.current.get(chipKey(id))?.focus();
  };

  const chipsRef = React.useRef<HTMLDivElement | null>(null);
  /** Visible chip seats; all of them until the band is first measured. */
  const [visibleLimit, setVisibleLimit] = React.useState(TABS.length);
  const [moreOpen, setMoreOpen] = React.useState(false);
  /** A page a navigation key selected before it had a seat, to focus after the swap. */
  const focusAfterRender = React.useRef<RightPanelTab | null>(null);

  // The strip budgets its chips by its own measured width, the mechanism the
  // conversation header uses for its View tabs (`ConversationSessionHeader.tsx:114-131`):
  // only the chip band is observed, so a pane resize re-seats the strip without
  // measuring each chip. A runtime without ResizeObserver seats every page.
  React.useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      setVisibleLimit(TABS.length);
      return undefined;
    }
    const element = chipsRef.current;
    if (element === null) return undefined;
    const update = (): void => {
      setVisibleLimit(visibleChipLimit(element.clientWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The page the user is on keeps a visible seat: when it would land in More it
  // takes the last visible seat, and the page that sat there joins More. The
  // strip therefore never hides which page the pane is on.
  const { visibleTabs, moreTabs } = React.useMemo(() => {
    const head = TABS.slice(0, Math.min(visibleLimit, TABS.length));
    const rest = TABS.slice(head.length);
    const current = rest.find((entry) => entry.id === tab);
    if (current === undefined) return { visibleTabs: head, moreTabs: rest };
    const visible = [...head.slice(0, head.length - 1), current];
    const visibleIds = new Set(visible.map((entry) => entry.id));
    return { visibleTabs: visible, moreTabs: TABS.filter((entry) => !visibleIds.has(entry.id)) };
  }, [visibleLimit, tab]);

  // A page selected from the keyboard that was in More gets the keyboard back
  // once the swap above has given it a seat; focusChip alone is a no-op for a
  // chip that is not rendered yet.
  React.useLayoutEffect(() => {
    const pending = focusAfterRender.current;
    if (pending === null) return;
    focusAfterRender.current = null;
    focusChip(pending);
  }, [visibleTabs]);

  const onChipKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: RightPanelTab): void => {
    // Only the chip itself owns the key: its inner content adds no controls.
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const next = tabForKey(event.key, id);
    if (next !== undefined) {
      event.preventDefault();
      focusAfterRender.current = next;
      onSelect(pane, next);
      focusChip(next);
      return;
    }
    if (activates(event.key)) {
      event.preventDefault();
      onSelect(pane, id);
    }
  };

  return (
    <section
      className={css.pane}
      data-pane={pane}
      data-dockkit-pane={`pane-${pane}`}
      data-dockkit-pane-active={active ? "" : undefined}
      aria-label={`右栏${PANE_LABEL[pane]}分栏`}
      // The pane the user last interacted with is the merge target; a press
      // anywhere in the pane claims that, as the kit claims pane focus
      // (`TabLayout.tsx:68-77`).
      onPointerDownCapture={() => {
        onActivate(pane);
      }}
    >
      <div
        className={css.strip}
        role="tablist"
        aria-label={`右栏${PANE_LABEL[pane]}页面`}
        aria-orientation="horizontal"
        data-dockkit-strip={`pane-${pane}`}
      >
        <div
          ref={chipsRef}
          className={css.chips}
          role="presentation"
          data-dockkit-strip-tabs={`pane-${pane}`}
        >
          {visibleTabs.map(({ id, label }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                ref={(element) => {
                  if (element === null) chipElements.current.delete(chipKey(id));
                  else chipElements.current.set(chipKey(id), element);
                }}
                type="button"
                role="tab"
                id={`rp-tab-${pane}-${id}`}
                aria-selected={selected}
                aria-controls={`rp-panel-${pane}`}
                tabIndex={selected ? 0 : -1}
                className={`${css.chip} ${selected ? css.chipActive : ""}`}
                data-rp-tab={id}
                data-dockkit-tab={`${pane}-${id}`}
                onClick={() => {
                  onSelect(pane, id);
                }}
                onKeyDown={(event) => {
                  onChipKeyDown(event, id);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {/* The pages the budget could not seat, one press away: the conversation
            header's More launcher pattern (`ConversationSessionHeader.tsx:189-221`).
            Absent while every page fits; portaled so the strip's clipping cannot
            crop the list. */}
        {moreTabs.length === 0 ? null : (
          <Menu
            open={moreOpen}
            onClose={() => {
              setMoreOpen(false);
            }}
            onSelect={(id) => {
              setMoreOpen(false);
              const next = TAB_IDS.find((entry) => entry === id);
              if (next !== undefined) onSelect(pane, next);
            }}
            items={moreTabs.map(({ id, label }) => ({ id, label }))}
            selectedId={tab}
            portal
            autoFocus
            className={css.moreAnchor}
            anchor={
              <Button
                size="sm"
                className={css.moreButton}
                aria-label="更多页签"
                title="更多页签"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => {
                  setMoreOpen((value) => !value);
                }}
              >
                <IconEllipsisOutlineRegular size={13} />
              </Button>
            }
          />
        )}
        <div className={css.stripFill} data-dockkit-strip-fill="" />
        {/* The kit's chrome seat (`data-dockkit-strip-chrome`, TabPanel.tsx:449-461),
            drawn only in the top-right pane (`SidebarRight.tsx:370-373`). */}
        {showChrome ? (
          <div
            className={css.stripChrome}
            data-dockkit-strip-chrome=""
            onPointerDown={(event) => {
              // The controls report their own intents; the pane's try-to-focus
              // must not steal the press from them.
              event.stopPropagation();
            }}
          >
            <PanelChrome
              split={split}
              canSplit={canSplit}
              fullscreen={fullscreen}
              onToggleSplit={onToggleSplit}
              onToggleFullscreen={onToggleFullscreen}
              onClose={onClose}
            />
          </div>
        ) : null}
      </div>

      <div className={css.paneBody} data-dockkit-pane-body="" data-pane-body={pane}>
        <div
          role="tabpanel"
          id={`rp-panel-${pane}`}
          aria-labelledby={`rp-tab-${pane}-${tab}`}
          className={css.pageSlot}
        >
          {renderPage(tab)}
        </div>
      </div>
    </section>
  );
}

/** What the split divider reads and writes. */
interface SplitDividerProps {
  /** The left pane's share of the pair, in `[MIN_PANE_SHARE, MAX_PANE_SHARE]`. */
  readonly share: number;
  readonly onChange: (next: number) => void;
}

/**
 * The seam between two panes: drag to resize, arrow keys to nudge.
 * Mirrors the kit's divider (`TabLayout.tsx:156-158` paints it in a 0px grid
 * column; `DockSurface.tsx:260-287` drags it; `geometry.ts:84-103` clamps).
 * @param props - current share and its setter.
 * @returns the focusable separator.
 */
function SplitDivider({ share, onChange }: SplitDividerProps): React.ReactNode {
  const drag = React.useRef<{ pointerId: number; startX: number; startShare: number; width: number } | null>(null);

  const begin = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const box = event.currentTarget.parentElement?.getBoundingClientRect();
    if (box === undefined) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startShare: share, width: box.width };
  };

  const move = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId || !(current.width > 0)) return;
    onChange(clampShare(current.startShare + (event.clientX - current.startX) / current.width));
  };

  const end = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = share - step;
        break;
      case "ArrowRight":
        next = share + step;
        break;
      case "Home":
        next = MIN_PANE_SHARE;
        break;
      case "End":
        next = MAX_PANE_SHARE;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(clampShare(next));
  };

  return (
    <div
      className={css.splitDivider}
      data-sidebar-right-split-divider=""
      data-dockkit-divider="split-1"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整分栏宽度"
      aria-valuemin={Math.round(MIN_PANE_SHARE * 100)}
      aria-valuemax={Math.round(MAX_PANE_SHARE * 100)}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * The right column: one or two panes, each a tab strip over its page body.
 * @param props.onClose - collapses the column (the strip-end control).
 * @param props.task - the task the shell currently has selected, if any.
 * @returns the panel.
 */
export function RightPanel({ onClose, task }: { onClose: () => void; task?: Task | null }): React.ReactNode {
  // Data is read once here, not per page mount, so switching pages or opening
  // the second pane keeps the loaded rows.
  const findingsState = useFindings();
  const rows = React.useMemo(
    () => (findingsState.findings === null ? [] : findingsToRows(findingsState.findings)),
    [findingsState.findings],
  );
  const findings = findingsState.findings;
  const approvals = useApprovals();
  const files = useWorkspaceFiles();
  // The 任务 page (P1:E8 close-out) reads its four sources here, once, so a page
  // switch or a split never re-fetches them; page bodies only render.
  const taskId = task === null || task === undefined ? null : String(task.id);
  const taskSummary = useOverviewSummary(taskId);
  const taskConstraints = useTaskConstraints(taskId);
  const taskScope = useTaskScope(taskId);
  const taskGoals = useTaskGoals(taskId);

  const [tabByPane, setTabByPane] = React.useState<Record<PaneId, RightPanelTab>>({
    left: "findings",
    right: "approvals",
  });
  /** Whether the column currently shows two panes. */
  const [split, setSplit] = React.useState(false);
  /** The pane the user last interacted with; the merge target and the split seed read it. */
  const [focusedPane, setFocusedPane] = React.useState<PaneId>("left");
  /** The left pane's share of the pair; the right pane takes the rest. */
  const [leftShare, setLeftShare] = React.useState(0.5);
  /** Measured panel width, for the split room rule. */
  const [columnWidth, setColumnWidth] = React.useState(0);
  // Presentation mode is panel-local: the shell owns the column track
  // (`Shell.tsx`), so fullscreen instead lifts this content tree over the frame,
  // the same presentation upstream calls `fullscreen` (`SidebarRight.tsx:345-355`).
  const [fullscreen, setFullscreen] = React.useState(false);

  const rootRef = React.useRef<HTMLElement | null>(null);
  // The chip element of every page of every pane, for the keys that move focus.
  const chipElements = React.useRef(new Map<string, HTMLButtonElement>());

  // Read the deep link after mount, so server markup and the hydrating render agree.
  React.useEffect(() => {
    const requested = tabFromLocation();
    if (requested !== undefined) setTabByPane((current) => ({ ...current, left: requested }));
  }, []);

  // The DSH room rule reads rendered widths (`measure.ts:90-103`); one
  // ResizeObserver on the panel carries the reading this fixed column needs.
  React.useLayoutEffect(() => {
    const element = rootRef.current;
    if (element === null) return undefined;
    const read = (): void => {
      setColumnWidth(element.getBoundingClientRect().width);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const canSplit = fullscreen || columnWidth >= MIN_SPLIT_WIDTH;

  /**
   * Open the second pane, or merge it back.
   * Opening seeds the new pane with the page after the primary pane's current
   * one (the kit seeds its split pane from a factory, `planner.ts:160-162`);
   * merging keeps the page of the pane the user is in, because the fixed pages
   * cannot be closed the way DSH empties a pane (`planner.ts:382-397`).
   */
  const toggleSplit = (): void => {
    if (!split) {
      if (!canSplit) return;
      const index = TAB_IDS.indexOf(tabByPane.left);
      const seed = TAB_IDS[(index + 1) % TAB_IDS.length];
      setTabByPane((current) => ({ ...current, right: seed }));
      setLeftShare(0.5);
      setFocusedPane("right");
      setSplit(true);
      return;
    }
    const keep = focusedPane === "right" ? tabByPane.right : tabByPane.left;
    setTabByPane((current) => ({ left: keep, right: current.right }));
    setFocusedPane("left");
    setSplit(false);
  };

  // The column narrowing under a split would leave halves that cannot work:
  // merge instead of drawing a broken pair (the kit blocks such a split up
  // front with its `width` state, `TabPanel.tsx:423-448`).
  React.useEffect(() => {
    if (!split || fullscreen || columnWidth === 0 || columnWidth >= MIN_SPLIT_WIDTH) return;
    setTabByPane((current) => ({ left: focusedPane === "right" ? current.right : current.left, right: current.right }));
    setFocusedPane("left");
    setSplit(false);
  }, [split, fullscreen, columnWidth, focusedPane]);

  /** Select one pane's page, making that pane the one the next merge reads. */
  const selectTab = (pane: PaneId, tab: RightPanelTab): void => {
    setFocusedPane(pane);
    setTabByPane((current) => (current[pane] === tab ? current : { ...current, [pane]: tab }));
  };

  /** Choose every page body from one place, so both panes share the data wiring. */
  const renderPage = (page: RightPanelTab): React.ReactNode => {
    switch (page) {
      case "task":
        // The page body only renders the four adapters' state; the reads live
        // above so the pane keeps its rows across page switches.
        return (
          <TaskPane
            task={task}
            summary={taskSummary}
            constraints={taskConstraints}
            scope={taskScope}
            goals={taskGoals}
          />
        );
      case "findings":
        return <FindingsPane phase={findingsState.phase} findings={findings} rows={rows} onReload={findingsState.reload} />;
      case "assets":
        // The page owns its adapter (`v2/data/right-panel-assets.ts`, C23), so
        // switching pages never re-reads the task's asset page.
        return <AssetsPane task={task} />;
      case "evidence":
        // Same for the bound-traffic evidence (`v2/data/right-panel-evidence.ts`).
        return <EvidencePane task={task} />;
      case "approvals":
        return (
          <ApprovalsPane
            phase={approvals.phase}
            pending={approvals.pending}
            onReload={approvals.reload}
            task={task}
          />
        );
      case "files":
        return <FilesPane phase={files.phase} entries={files.entries} onReload={files.reload} />;
      case "session":
        return <SessionPane task={task} />;
      default:
        return null;
    }
  };

  return (
    <aside
      ref={rootRef}
      className={css.root}
      aria-label="右栏"
      // Upstream marks the presentation on the panel box (`SidebarRight.tsx:348`);
      // the CSS module keys the viewport-covering geometry off this value.
      data-sidebar-right-panel={fullscreen ? "fullscreen" : "push"}
      // The shell unmounts the column when collapsed, so a mounted panel is open.
      data-sidebar-right-open=""
      // The split state a reader (or a test) can assert: attribute presence,
      // pane count, and the divider share.
      data-sidebar-right-split={split ? "" : undefined}
      data-sidebar-right-panes={split ? 2 : 1}
      data-sidebar-right-split-share={split ? Number(leftShare.toFixed(3)) : undefined}
    >
      <div
        className={`${css.body} ${split ? css.bodySplit : ""}`}
        data-sidebar-right-panes-box=""
        // Panes share one track: every pane's `fr` plus the 0px seam column sum
        // to the surface width (`TabLayout.tsx:139-144`).
        style={split ? { gridTemplateColumns: `minmax(0, ${leftShare}fr) 0px minmax(0, ${1 - leftShare}fr)` } : undefined}
      >
        <PaneView
          pane="left"
          tab={tabByPane.left}
          active={focusedPane === "left"}
          // The panel chrome lives in the top-right pane's strip.
          showChrome={!split}
          split={split}
          canSplit={canSplit}
          fullscreen={fullscreen}
          onSelect={selectTab}
          onActivate={setFocusedPane}
          onToggleSplit={toggleSplit}
          onToggleFullscreen={() => {
            setFullscreen((value) => !value);
          }}
          onClose={onClose}
          renderPage={renderPage}
          chipElements={chipElements}
        />
        {split ? (
          <>
            <SplitDivider share={leftShare} onChange={setLeftShare} />
            <PaneView
              pane="right"
              tab={tabByPane.right}
              active={focusedPane === "right"}
              showChrome
              split={split}
              canSplit={canSplit}
              fullscreen={fullscreen}
              onSelect={selectTab}
              onActivate={setFocusedPane}
              onToggleSplit={toggleSplit}
              onToggleFullscreen={() => {
                setFullscreen((value) => !value);
              }}
              onClose={onClose}
              renderPage={renderPage}
              chipElements={chipElements}
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}
