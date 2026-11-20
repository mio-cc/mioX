"use client";

/**
 * Asset inventory body: the type tab strip (D2), one server-side page per asset
 * class (D10) with the class-specific columns (D8), the 全部 cross-class view the
 * W7 toolbar shipped, row selection with a delete confirmation (D11) and the
 * company attribution column (D13).
 *
 * Behaviour and wording come from the old page
 * (`app/(main)/function/assets/page.tsx`): tab counts `:299-300` + `:342-350`,
 * server-side paging `:249-289` + `:882-927`, row columns `:447-730`, selection
 * and the delete alert `:327-331` + `:739-762`, company attribution — the 归属企业
 * cell of the 根域名 table `:291-297` + `:424-436`, and the 企业 view with its
 * 资产数 column `:299` + `:353-387`. Import / create / sync write paths are out of
 * scope (W7 delivery notes), and so is the company CRUD of D3–D7 (P2-5): the 企业
 * view added here is read-only.
 *
 * The body is surface-agnostic and takes no props, because two surfaces render
 * it: the standalone `/v2/assets` route, which owns the full-viewport frame, and
 * the shell's main area, which reaches it through the page registry
 * (`v2/data/pages.ts`).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { AssetDeleteDialog, type AssetDeleteTarget } from "@/components/v2/data-pages/AssetDeleteDialog";
import { AssetPager } from "@/components/v2/data-pages/AssetPager";
import { AssetTable, assetColumnsFor, assetLabel } from "@/components/v2/data-pages/AssetTable";
import { AssetTypeTabs, type AssetTypeTab } from "@/components/v2/data-pages/AssetTypeTabs";
import { buildCsv, csvFileName, downloadCsv } from "@/components/v2/data-pages/csv";
import { DataPageToolbar } from "@/components/v2/data-pages/DataPageToolbar";
import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import type { Asset, Company, NewAssetType } from "@/lib/types";
import { useAssets } from "@/v2/data/assets";
import {
  ASSET_DEFAULT_PAGE_SIZE,
  ASSET_TAB_TYPES,
  assetCompanyCount,
  assetCompanyName,
  assetTypeLabel,
  useAssetPage,
  useAssetTypeCounts,
  useCompanyDirectory,
} from "@/v2/data/assets-page";

import css from "./AssetsDataPage.module.css";

/** Tab id of the cross-class view (the merged snapshot the W7 page shipped). */
const ALL_TAB = "all";

/** Tab id of the 企业 view (D13: the company list with its asset count). */
const COMPANY_TAB = "company";

/** Tab strip: 全部 first, then the asset classes in the old page's order, then 企业. */
const TABS: readonly AssetTypeTab[] = [
  { value: ALL_TAB, label: "全部" },
  ...ASSET_TAB_TYPES.map((type) => ({ value: type, label: assetTypeLabel(type) })),
  { value: COMPANY_TAB, label: "企业" },
];

/**
 * The 企业 view of the inventory (D13): every company the asset rows can be
 * attributed to, with its 资产数.
 *
 * Rows and the 资产数 figure come from `GET /companies` (`api.ts:608`,
 * `Company.asset_count` at `types.ts:414`), the same source the old page's 企业
 * tab renders (`app/(main)/function/assets/page.tsx:299` for the tab counter,
 * `:359` for the 资产数 header, `:374` for the count cell). 资产范围 is left out
 * on purpose: `app/(main)/function/assets/page.tsx:376-386` renders it but scope
 * editing is the company CRUD of P2-5, so this view stays read-only.
 * @param props.companies - company rows from the directory.
 * @param props.phase - directory read phase.
 * @param props.error - directory read failure reason.
 * @returns the read-only company table with its four states.
 */
function CompanyAttributionTable({
  companies,
  phase,
  error,
}: {
  companies: Company[];
  phase: "loading" | "ready" | "offline";
  error: string | null;
}): ReactNode {
  if (phase === "loading") {
    return (
      <p className={css.stateText} data-asset-company-state="loading">
        读取企业…
      </p>
    );
  }
  if (phase === "offline") {
    return (
      <p className={css.stateError} data-asset-company-state="offline">
        企业归属读取失败（{error}）
      </p>
    );
  }
  if (companies.length === 0) {
    return (
      <p className={css.stateText} data-asset-company-state="empty">
        暂无企业。
      </p>
    );
  }
  return (
    <div className={css.companyWrap} data-asset-company-table="">
      <table className={css.companyTable}>
        <thead>
          <tr>
            <th className={css.companyTh}>企业</th>
            <th className={css.companyTh}>资产范围</th>
            <th className={`${css.companyTh} ${css.companyThRight}`}>资产数</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => (
            <tr key={company.id} data-data-page-row="" data-company-id={company.id}>
              <td className={css.companyTd} title={company.name}>
                {company.name || `企业 #${company.id}`}
              </td>
              {/* P2:D13：资产范围列，数据来自公司自带的 scope（ScopeRow.raw 是原始输入），
                  与旧页 assets/page.tsx:376-386 同口径：多条用「、」连接，为空显示「—」。 */}
              <td className={css.companyTd} data-company-scope={company.id}>
                {company.scope === undefined || company.scope.length === 0 ? (
                  <span className={css.companyEmpty}>—</span>
                ) : (
                  company.scope.map((rule) => rule.raw).join("、")
                )}
              </td>
              <td className={`${css.companyTd} ${css.companyTdRight}`} data-company-asset-count={company.id}>
                {String(company.asset_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Render the asset toolbar, tab strip, table and pager.
 * @returns the whole asset page body.
 */
export function AssetsDataPage(): ReactNode {
  const [tab, setTab] = useState<string>(ALL_TAB);
  const [query, setQuery] = useState("");
  const applied = useDebouncedValue(query.trim(), 250);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(ASSET_DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [deleteTargets, setDeleteTargets] = useState<AssetDeleteTarget[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useAssetTypeCounts();
  const companies = useCompanyDirectory();
  const companyTab = tab === COMPANY_TAB;
  // 全部 tab keeps the W7 merged snapshot; type tabs own a real server page.
  const merged = useAssets(applied, 200, tab === ALL_TAB);
  const paged = useAssetPage({
    type: (tab === ALL_TAB ? ASSET_TAB_TYPES[0] : tab) as NewAssetType,
    query: applied,
    page,
    size,
    // The 企业 view reads the company list, never an asset class page.
    enabled: tab !== ALL_TAB && !companyTab,
  });

  const allTab = tab === ALL_TAB;
  const rows = allTab ? merged.assets : paged.assets;
  const total = allTab ? merged.total : paged.total;
  const phase = allTab ? merged.phase : paged.phase;
  const error = allTab ? merged.error : paged.error;

  // Switching tabs resets the filter, the page cursor and the selection
  // (`assets/page.tsx:232-245`).
  const changeTab = useCallback((next: string) => {
    setTab(next);
    setQuery("");
    setSelected(new Set<number>());
    setPage(0);
    setNotice(null);
  }, []);

  // Last-page correction: a shrinking total pulls the cursor back
  // (`assets/page.tsx:285-289`).
  useEffect(() => {
    if (allTab || companyTab) return;
    const lastPage = Math.max(0, Math.ceil(paged.total / size) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [allTab, companyTab, page, size, paged.total]);

  // Refresh re-reads the counters and the active view and clears the selection
  // (`assets/page.tsx:155-160`).
  const reload = useCallback(() => {
    counts.reload();
    companies.reload();
    if (allTab) merged.reload();
    else if (!companyTab) paged.reload();
    setSelected(new Set<number>());
    setNotice(null);
  }, [allTab, companyTab, counts, companies, merged, paged]);

  // Changing the page size returns to the first page (`assets/page.tsx:244-245`).
  const changeSize = useCallback((next: number) => {
    setSize(next);
    setPage(0);
  }, []);

  const toggleRow = useCallback((id: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: number[]) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (ids.every((id) => next.has(id))) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, []);

  const columns = useMemo(() => assetColumnsFor(allTab ? null : tab, companies.byId), [allTab, tab, companies.byId]);

  const exportCsv = useCallback(() => {
    downloadCsv(
      csvFileName("assets"),
      buildCsv(
        columns.map((column) => column.header),
        rows.map((row) => columns.map((column) => column.text(row))),
      ),
    );
  }, [columns, rows]);

  // Selected rows can live on another page or under another filter, so the
  // dialog is built from ids; unseen ids fall back to their `#id` (`assets/page.tsx:328`).
  const toTargets = useCallback(
    (ids: number[]): AssetDeleteTarget[] => {
      const labels = new Map(rows.map((row: Asset) => [row.id, assetLabel(row)]));
      return ids.map((id) => ({ id, label: labels.get(id) ?? `#${id}` }));
    },
    [rows],
  );

  const requestDeleteRow = useCallback((asset: Asset) => setDeleteTargets(toTargets([asset.id])), [toTargets]);
  const requestDeleteSelected = useCallback(
    () => setDeleteTargets(toTargets([...selected])),
    [selected, toTargets],
  );

  const onDeleted = useCallback(
    (deleted: number) => {
      setDeleteTargets(null);
      setSelected(new Set<number>());
      setNotice(`已删除 ${deleted} 条资产`);
      counts.reload();
      if (allTab) merged.reload();
      else paged.reload();
    },
    [allTab, counts, merged, paged],
  );

  return (
    <>
      <DataPageToolbar
        page="assets"
        title="资产"
        lead="资产图：站点、接口、主机与指纹。"
        query={query}
        onQueryChange={setQuery}
        filterLabel="搜索资产…"
        count={phase === "ready" ? total : null}
        onRefresh={reload}
        onExport={exportCsv}
        canExport={rows.length > 0}
      />

      <AssetTypeTabs
        tabs={TABS}
        value={tab}
        onChange={changeTab}
        counts={companyTab ? { ...counts.counts, company: companies.rows.length } : counts.counts}
        total={counts.total}
        selectedCount={selected.size}
        onDeleteSelected={requestDeleteSelected}
      />

      {companyTab ? (
        <CompanyAttributionTable companies={companies.rows} phase={companies.phase} error={companies.error} />
      ) : null}

      {!companyTab && (rows.length > 0 || phase === "ready") ? (
        <AssetTable
          type={allTab ? null : tab}
          rows={rows}
          companies={companies.byId}
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onRequestDelete={requestDeleteRow}
        />
      ) : null}

      {!allTab && !companyTab ? <AssetPager total={total} page={page} size={size} rowCount={rows.length} onPage={setPage} onSize={changeSize} /> : null}

      {notice !== null ? (
        <p data-asset-notice="" className={css.notice}>
          {notice}
        </p>
      ) : null}

      {!companyTab && phase === "loading" && rows.length === 0 ? <p className={css.stateText}>读取中…</p> : null}

      {!companyTab && phase === "offline" ? <p className={css.stateError}>未连接后端（{error}）</p> : null}

      <AssetDeleteDialog
        targets={deleteTargets}
        type={allTab ? null : tab}
        onCancel={() => setDeleteTargets(null)}
        onDeleted={onDeleted}
      />
    </>
  );
}
