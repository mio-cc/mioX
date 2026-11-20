"use client";

/**
 * Heading, header actions and filter row shared by the read-only data pages
 * (`/v2/assets`, `/v2/traffic`).
 *
 * Geometry follows the ui-lab original (`ui-lab/src/shell2/DataPages.tsx:189-219`):
 * a title + lead block with the page actions on the right, then a 280px search
 * field carrying the matching row count. The search control itself follows
 * DSH's trajectory toolbar (`ui-trajectory/src/client/TrajectoryToolbar.tsx:133-143`):
 * an icon-prefixed `input[type=search]` with an accessible name, using the shared
 * `Button` primitive for the header actions.
 */
import type { ReactNode } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { IconSearchOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./DataPageToolbar.module.css";

export interface DataPageToolbarProps {
  /** `data-data-page` marker of the page this toolbar belongs to. */
  page: "assets" | "traffic";
  /** Page heading. */
  title: string;
  /** One-line description under the heading. */
  lead: string;
  /** Current filter text (raw, not yet debounced). */
  query: string;
  /** Update the filter text. */
  onQueryChange: (query: string) => void;
  /** Placeholder and accessible name of the filter box. */
  filterLabel: string;
  /** Matching row count, or null before the first response. */
  count: number | null;
  /** Re-read the current view from the backend. */
  onRefresh: () => void;
  /** Export the current view as a locally generated CSV. */
  onExport: () => void;
  /** Whether there are rows to export. */
  canExport: boolean;
}

/**
 * Render the data page header and filter row.
 * @param props - page copy, filter state and the two read-only actions.
 * @returns the header block and the filter row.
 */
export function DataPageToolbar({
  page,
  title,
  lead,
  query,
  onQueryChange,
  filterLabel,
  count,
  onRefresh,
  onExport,
  canExport,
}: DataPageToolbarProps): ReactNode {
  return (
    <>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>{title}</h1>
          <p className={css.lead}>{lead}</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label={`${title}页头动作`} data-data-page-toolbar={page}>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            title="重新读取当前视图"
            data-data-page-action="refresh"
          >
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={!canExport}
            title={canExport ? "把当前视图导出为 CSV（本地生成）" : "没有可导出的记录"}
            data-data-page-action="export"
          >
            导出 CSV
          </Button>
        </div>
      </header>

      <div className={css.filterRow}>
        <label className={css.filter}>
          <IconSearchOutlineRegular size={13} className={css.filterIcon} />
          <input
            type="search"
            className={css.filterInput}
            value={query}
            placeholder={filterLabel}
            aria-label={filterLabel}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            data-data-page-filter={page}
          />
        </label>
        <span className={css.count} data-data-page-count={count === null ? "" : String(count)}>
          {count === null ? "读取中…" : `${count} 条`}
        </span>
      </div>
    </>
  );
}
