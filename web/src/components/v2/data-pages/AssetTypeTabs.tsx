"use client";

/**
 * Asset type tabs (D2): one chip per asset class with its backend count, plus the
 * page-level total and the "delete selected" action.
 *
 * Wording and geometry follow the old page's header row and tab list
 * (`app/(main)/function/assets/page.tsx:319-350`): tabs carry the icon-free
 * caption and a tabular count, the total sits in the header row, and the delete
 * action only appears once rows are selected (`:327-331`). DSH has no
 * content-width tab strip — `ui-primitives/src/SegmentedTabs.tsx:26-85` is an
 * equal-width, indicator-sliding tablist, which cannot hold seven counted tabs in
 * the ≈513px main area (`98-子agent通用守则.md` §4.6) — so the strip follows the old
 * page's `TabsList` with `--dsw-*` tokens only.
 */
import type { ReactNode } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { IconTrashOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./AssetTypeTabs.module.css";

/** One tab of the strip; `value` is the tab id (`all` or an asset class). */
export interface AssetTypeTab {
  value: string;
  label: string;
}

export interface AssetTypeTabsProps {
  /** Tabs in display order; the first one is the cross-class 全部 tab. */
  tabs: readonly AssetTypeTab[];
  /** Selected tab id. */
  value: string;
  /** Switch tabs; the page resets its filter, page cursor and selection. */
  onChange: (value: string) => void;
  /** Backend counters per asset class. */
  counts: Record<string, number>;
  /** Sum of every class = 「共 N 项资产」. */
  total: number;
  /** How many rows are selected (0 hides the delete action). */
  selectedCount: number;
  /** Open the delete confirmation for the current selection. */
  onDeleteSelected: () => void;
}

/**
 * Count of one tab: the counter of its class, or the summed total for 全部.
 * @param tab - tab id.
 * @param counts - backend counters.
 * @param total - sum of every counter.
 * @returns the number shown after the caption.
 */
function countOf(tab: string, counts: Record<string, number>, total: number): number {
  return tab === "all" ? total : (counts[tab] ?? 0);
}

/**
 * Render the asset tab strip with counts, the page total and the bulk action.
 * @param props - tabs, counters and selection state.
 * @returns the tablist row.
 */
export function AssetTypeTabs({
  tabs,
  value,
  onChange,
  counts,
  total,
  selectedCount,
  onDeleteSelected,
}: AssetTypeTabsProps): ReactNode {
  return (
    <div className={css.row}>
      <div role="tablist" aria-label="资产类型" data-asset-tabs="" className={css.tablist}>
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-asset-tab={tab.value}
              title={`${tab.label}（${countOf(tab.value, counts, total)}）`}
              onClick={() => onChange(tab.value)}
              className={active ? `${css.tab} ${css.tabActive}` : css.tab}
            >
              {tab.label}
              <span className={css.count}>{countOf(tab.value, counts, total)}</span>
            </button>
          );
        })}
      </div>

      <span data-asset-total={total} className={css.total}>
        共 <span className={css.numeric}>{total}</span> 项资产
      </span>

      {selectedCount > 0 ? (
        <Button
          variant="outline"
          size="sm"
          data-asset-delete-selected={selectedCount}
          title="删除当前已选资产（会先二次确认）"
          onClick={onDeleteSelected}
          icon={<IconTrashOutlineRegular size={13} />}
        >
          删除已选 ({selectedCount})
        </Button>
      ) : null}
    </div>
  );
}
