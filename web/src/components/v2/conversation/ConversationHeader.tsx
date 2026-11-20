"use client";

/**
 * Resident conversation navigation container.
 *
 * Port of `ui-conversation/src/client/skeleton/ConversationHeader.tsx:12-29`:
 * the header is a two-column grid whose leading slot holds global navigation
 * and whose second column is either the blank title row or the strict Session
 * header (`conversation.session.header`).
 */
import type { ReactNode } from "react";

import clsx from "clsx";

import { IconPanelLeftOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./ConversationRoot.module.css";
import { ConversationSessionHeader } from "./ConversationSessionHeader";
import type { ConversationSkeletonProps, ConversationViewId } from "./contract";

export interface ConversationHeaderProps extends ConversationSkeletonProps {
  /** True while no task is selected: title and View tabs stay hidden. */
  readonly blank: boolean;
  /** Selected View id, owned by the main panel. */
  readonly view: ConversationViewId;
  /** Select one View from the tab row. */
  readonly onSelectView: (view: ConversationViewId) => void;
  /**
   * Session lane switcher (P1-B7), built and owned by the main panel because the
   * transcript it filters lives there too. Rendered at the end of the View tab
   * strip, the seat the old page gave its dropdown (`task-workspace-dsh.tsx:2988`).
   */
  readonly laneBar?: ReactNode;
}

/**
 * Render the resident header.
 * @param props - skeleton contract, blank flag, and the View tab selection.
 * @returns the header grid.
 */
export function ConversationHeader(props: ConversationHeaderProps): ReactNode {
  const { blank, drawer, onOpenDrawer, task, headerSlotData, view, onSelectView, onOpenTask, laneBar } = props;

  return (
    <header className={clsx(css.header, blank && css.headerBlank)} data-window-drag="">
      <div className={css.headerLeading} data-conversation-header-leading="">
        {drawer ? (
          <button
            type="button"
            className={css.leadingButton}
            aria-label="打开侧边栏"
            title="打开侧边栏"
            onClick={onOpenDrawer}
          >
            <IconPanelLeftOutlineRegular size={16} />
          </button>
        ) : null}
      </div>
      {blank || task === null ? (
        // The empty title row keeps the blank header height so the hero centers
        // at the same offset as an active Session (upstream lines 22-26).
        <div className={css.titleRow} />
      ) : (
        // The strict Session header only receives what its crumbs, slot context,
        // and View tabs read; the rest of the skeleton contract stops here.
        <ConversationSessionHeader
          task={task}
          headerSlotData={headerSlotData}
          view={view}
          onSelectView={onSelectView}
          onOpenTask={onOpenTask}
          laneBar={laneBar}
        />
      )}
    </header>
  );
}
