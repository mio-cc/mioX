"use client";

/**
 * Strict per-Session header content: title row, chrome actions, View tabs.
 *
 * Port of `ui-conversation/src/client/skeleton/ConversationSession.tsx:108-257`
 * (`ConversationSessionHeader`). The two chrome bands are list slots, matching
 * upstream:
 *
 *   titleRow
 *     titleCluster   (crumbs + `conversation.header.actions`)
 *     headerUtilities (`conversation.header.utilities` + More launcher)
 *     headerCorner   (far-right empty seat)
 *   tabs
 *     viewTabs       (role=tablist with the fixed View first)
 *     viewsMore      (the Views that did not fit the row budget)
 *     laneBar        (mioX lane switcher, a Menu trigger)
 *
 * The View strip keeps DSH's width budget (`ConversationSession.tsx:120-143`):
 * only the row is measured, `visibleViewLimit = max(1, floor((width - 48) / 120))`,
 * the fixed View stays first, and the rest move into a 22px More menu
 * (`ViewsMoreMenu`, `:28-44`; `ConversationRoot.module.css:299-323`). mioX has
 * more Views than DSH, so the selected View is additionally swapped into the
 * last visible seat — the user always sees which View is current, and the More
 * button only marks itself in the degenerate one-seat row.
 *
 * The header owns the seats and the render context; the shell contributes the
 * entries through `useSlotRegister`, so this file no longer renders the plan
 * chip, jobs chip, right-panel toggle, or More menu itself.
 */
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";

import clsx from "clsx";

import type { Task } from "@/lib/types";
import { listTaskViews } from "@/v2/data/conversation-views";
import { Slot } from "@/v2/slots";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconEllipsisOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Menu } from "@/vendor/dsh/primitives/Menu";

import css from "./ConversationRoot.module.css";
import {
  CONVERSATION_MORE_TABS,
  CONVERSATION_VIEW_TABS,
  type ConversationHeaderSlotContext,
  type ConversationHeaderSlotData,
  type ConversationViewId,
  type ConversationViewTab,
} from "./contract";
import { SessionCrumbs } from "./SessionCrumbs";

/** Row width budget per View tab, mirroring `ConversationSession.tsx:127`. */
/** DSH tab 実测：tab 文字上限 88px + 左右 hit 10px + 32px gap ≈ 每席约 70px 而非 120px。 */
const VIEW_TAB_SLOT_WIDTH = 70;
/** Space the row keeps for the More launcher and the strip's own gaps. */
const VIEW_TAB_ROW_RESERVE = 48;

/**
 * Visible View slots for a measured row width.
 * @param width - the tab row's `clientWidth`.
 * @returns at least one visible slot (the fixed View).
 */
function visibleViewLimit(width: number): number {
  return Math.max(1, Math.floor((width - VIEW_TAB_ROW_RESERVE) / VIEW_TAB_SLOT_WIDTH));
}

/**
 * Props of the strict per-Session header: only the data its crumb row, slot
 * seats, and View tabs read. The wider skeleton contract stops at
 * `ConversationHeader`.
 */
export interface ConversationSessionHeaderProps {
  /** Selected task; the header never renders without one. */
  readonly task: Task;
  /** Shell-owned data the two chrome slot entries render against. */
  readonly headerSlotData: ConversationHeaderSlotData;
  /** Selected View id, owned by the main panel. */
  readonly view: ConversationViewId;
  /** Select one View from the tab row or the More menu. */
  readonly onSelectView: (view: ConversationViewId) => void;
  /** Select another task, used by the Session crumb navigation. */
  readonly onOpenTask: (id: string) => void;
  /**
   * Session lane switcher (P1-B7), owned by the main panel. Sits at the end of
   * the View tab strip, matching the old page's header dropdown seat.
   */
  readonly laneBar?: ReactNode;
}

/**
 * Render the Session title row and View tab strip.
 * @param props - the strict per-Session header contract.
 * @returns the session header rows.
 */
export function ConversationSessionHeader(props: ConversationSessionHeaderProps): ReactNode {
  const { task, headerSlotData, view: viewId, onSelectView, onOpenTask, laneBar } = props;

  // Owner data: shell contributions plus the Session this header owns.
  const slotContext: ConversationHeaderSlotContext = { ...headerSlotData, task, onOpenTask };

  /**
   * U2: the strip holds the fixed View plus the registry's `main` Views (对话 / 概览 /
   * 探索 / 发现 / 资产); 轨迹 and the `more` Views (团队, team mode only) always sit in
   * the More menu. A container's sub-view (`explore.graph`) selects its container tab.
   */
  const registry = listTaskViews(task);
  const tabs = useMemo<readonly ConversationViewTab[]>(
    () => [
      ...CONVERSATION_VIEW_TABS,
      ...registry.filter((entry) => entry.placement === "main").map((entry) => ({ id: entry.id, label: entry.label })),
    ],
    [registry],
  );
  const pinnedMore = useMemo<readonly ConversationViewTab[]>(
    () => [
      ...CONVERSATION_MORE_TABS,
      ...registry.filter((entry) => entry.placement === "more").map((entry) => ({ id: entry.id, label: entry.label })),
    ],
    [registry],
  );
  const view = viewId.split(".")[0] ?? viewId;

  const tabRow = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);

  // Observe only the available row width; individual tabs are not measured.
  // A runtime without ResizeObserver shows every View instead of budgeting.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      setLimit(tabs.length);
      return;
    }
    const row = tabRow.current;
    if (row === null) return;
    const updateLimit = (): void => {
      setLimit(visibleViewLimit(row.clientWidth));
    };
    updateLimit();
    const observer = new ResizeObserver(updateLimit);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [tabs.length]);

  const { visibleTabs, moreTabs } = useMemo(() => {
    const head = tabs.slice(0, Math.min(limit, tabs.length));
    const rest = tabs.slice(head.length);
    // The selected View stays on the strip: swap it into the last visible seat
    // and let the displaced tab join the More menu.
    const current = rest.find((tab) => tab.id === view);
    if (current === undefined || head.length < 2) {
      return { visibleTabs: head, moreTabs: [...rest, ...pinnedMore] };
    }
    const visible = [...head.slice(0, head.length - 1), current];
    const visibleIds = new Set(visible.map((tab) => tab.id));
    return { visibleTabs: visible, moreTabs: [...tabs.filter((tab) => !visibleIds.has(tab.id)), ...pinnedMore] };
  }, [limit, pinnedMore, tabs, view]);

  // Only reachable in the one-seat fallback (a very narrow column), where the
  // selected View cannot be swapped onto the strip.
  const currentInMore = moreTabs.some((tab) => tab.id === view);

  return (
    <>
      <div className={css.titleRow}>
        <div className={css.titleCluster}>
          {/* Session hierarchy: class names and markup follow the upstream
              titleCluster > nav.crumbs row (ConversationSession.tsx:147-204);
              the ancestry walk and current/ancestor split live in SessionCrumbs. */}
          <SessionCrumbs task={task} onOpenTask={onOpenTask} />

          <div className={css.headerActions} data-slot="conversation.header.actions">
            <Slot name="conversation.header.actions" ctx={slotContext} />
          </div>
        </div>
        <div className={css.headerUtilities} data-slot="conversation.header.utilities">
          <Slot name="conversation.header.utilities" ctx={slotContext} />
        </div>
        <div className={css.headerCorner} data-conversation-header-corner="" />
      </div>
      {/* data-conversation-tabs marks the tab strip; the fixed View renders
          first (upstream ConversationSession.tsx:135-143, 222-254). */}
      <div ref={tabRow} className={css.tabs}>
        <div className={css.viewTabs} role="tablist" data-conversation-tabs="">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-view-tab={tab.id}
              aria-selected={tab.id === view}
              className={clsx(css.tab, tab.id === view && css.tabActive)}
              onClick={() => {
                onSelectView(tab.id);
              }}
            >
              <span className={css.tabLabel}>{tab.label}</span>
            </button>
          ))}
        </div>
        {moreTabs.length === 0 ? null : (
          <Menu
            open={moreOpen}
            onClose={() => {
              setMoreOpen(false);
            }}
            onSelect={(id) => {
              setMoreOpen(false);
              onSelectView(id);
            }}
            items={moreTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
            selectedId={view}
            portal
            autoFocus
            className={css.viewsMoreAnchor}
            listClassName={css.viewsMoreMenu}
            anchor={
              <Button
                size="sm"
                className={clsx(css.viewsMore, currentInMore && css.viewsMoreActive)}
                aria-label="更多视图"
                title="更多视图"
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
        {/* Lane switcher seat (P1-B7): the old page put its session dropdown in
            the header's right-hand action group (task-workspace-dsh.tsx:2987-2993);
            here it closes the View tab strip instead. */}
        {laneBar}
      </div>
    </>
  );
}
