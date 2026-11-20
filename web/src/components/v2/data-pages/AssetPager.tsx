"use client";

/**
 * Server-side pager of the asset page (D10): page size, the "start–end / total"
 * range and prev/next, with the last-page correction handled by the page body.
 *
 * Geometry and wording follow the old page's table footer
 * (`app/(main)/function/assets/page.tsx:882-927`): a page-size selector, the
 * `start–end / total` range and a `page / pageCount` cursor between the two
 * arrow buttons. DSH ships no pagination primitive
 * (`项目分析/dsh-upstream/packages/client/ui-primitives/src/index.tsx`), so the
 * footer is drawn with the shared `Button` atom and `--dsw-*` tokens.
 */
import type { ReactNode } from "react";

import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { ASSET_PAGE_SIZES } from "@/v2/data/assets-page";
import { Button } from "@/vendor/dsh/primitives/Button";
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import css from "./AssetPager.module.css";

export interface AssetPagerProps {
  /** Full match count of the current view. */
  total: number;
  /** 0-based page cursor. */
  page: number;
  /** Rows per request. */
  size: number;
  /** Rows actually rendered on this page. */
  rowCount: number;
  /** Move to a 0-based page. */
  onPage: (page: number) => void;
  /** Change rows per request; the page body resets the cursor. */
  onSize: (size: number) => void;
}

/**
 * Render the pager footer of one server-side page.
 * @param props - counts, cursor and the two change callbacks.
 * @returns the footer, or null while the view is empty.
 */
export function AssetPager({ total, page, size, rowCount, onPage, onSize }: AssetPagerProps): ReactNode {
  if (total <= 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const start = page * size + 1;
  const end = page * size + rowCount;

  return (
    <div data-asset-pager="" className={css.pager}>
      <span className={css.sizeField} data-asset-page-size={size}>
        <SelectMenu
          ariaLabel="每页条数"
          value={String(size)}
          options={ASSET_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }))}
          onChange={(next) => onSize(Number(next))}
        />
      </span>

      <span data-asset-range="" className={css.numeric}>
        {start}–{end} / {total}
      </span>

      <span className={css.cursor}>
        <Button
          variant="outline"
          size="sm"
          aria-label="上一页"
          title={page <= 0 ? "已经是第一页" : "上一页"}
          disabled={page <= 0}
          onClick={() => onPage(Math.max(0, page - 1))}
          data-asset-page-prev=""
          icon={<IconChevronLeftOutlineRegular size={13} />}
        />
        <span data-asset-page-info="" className={css.numeric}>
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="下一页"
          title={page + 1 >= pageCount ? "已经是最后一页" : "下一页"}
          disabled={page + 1 >= pageCount}
          onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
          data-asset-page-next=""
          icon={<IconChevronRightOutlineRegular size={13} />}
        />
      </span>
    </div>
  );
}
