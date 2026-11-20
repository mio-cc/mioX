"use client";

/**
 * Asset table of `/v2/assets` (D8) with the per-row selection and delete hooks
 * D11 needs.
 *
 * One column set per asset class follows the old page's per-tab tables
 * (`app/(main)/function/assets/page.tsx`: 根域名 `:424-436`、IP `:465-477`、
 * 子域名 `:512-524`、应用 `:554-566`、服务 `:594-609`、接口 `:690-702`); the 归属企业
 * column of the 根域名 table follows `:291-297` (company id → name map) +
 * `:424-436` (the column), joined on the row's `company_id`. The cross-class
 * 全部 tab keeps the four columns the W7 page shipped
 * (`components/v2/data-pages/AssetsDataPage.tsx:30-45`), so its CSV header stays
 * 「类型,资产,关联任务,最近出现」。DSH ships no table primitive
 * (`项目分析/dsh-upstream/packages/client/ui-primitives/src/index.tsx` exports
 * Button/Input/Checkbox/CodeCard/JsonTree only), so the table is drawn with
 * `--dsw-*` tokens exactly like the W7 asset/traffic tables.
 *
 * The table is horizontally scrollable inside its own wrapper: the shell's main
 * area is squeezed to ≈513px by the right pane (`98-子agent通用守则.md` §4.6), and
 * the service class needs eight columns.
 */
import { type ReactNode, useEffect, useRef } from "react";

import type { Asset, Company } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconTrashOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { assetTypeLabel } from "@/v2/data/assets-page";

import css from "./AssetTable.module.css";

/** One visible column: the cell text doubles as the CSV cell. */
export interface AssetColumn {
  /** Stable React key and CSV ordering key. */
  key: string;
  /** Header wording, identical in the table and the CSV. */
  header: string;
  /** Project one row onto this column. */
  text: (asset: Asset) => string;
  /** Draw the cell in the tertiary label colour (timestamps). */
  muted?: boolean;
}

export interface AssetTableProps {
  /** Active asset class, or null for the cross-class 全部 tab. */
  type: string | null;
  /** Rows of the current view (server page, or the merged snapshot). */
  rows: Asset[];
  /** Company rows by id, for the 归属企业 cell. */
  companies: Map<number, Company>;
  /** Ids currently selected for deletion. */
  selected: ReadonlySet<number>;
  /** Toggle one row's selection. */
  onToggleRow: (id: number) => void;
  /** Toggle every row of the current view. */
  onToggleAll: (ids: number[]) => void;
  /** Open the delete confirmation for one row. */
  onRequestDelete: (asset: Asset) => void;
}

/** `type` column wording (the old page's `_harness/assets-list.tsx:25-33`). */
const ALL_TYPE_LABEL: Record<string, string> = {
  company: "企业",
  root_domain: "根域",
  subdomain: "子域",
  ip: "IP",
  service: "服务",
  app: "应用",
  endpoint: "接口",
};

/** Narrowest usable width per class; the wrapper scrolls when the pane is narrower. */
const TABLE_MIN_WIDTH: Record<string, number> = {
  all: 540,
  root_domain: 480,
  ip: 660,
  subdomain: 660,
  app: 580,
  service: 900,
  endpoint: 620,
};

/** The row label shown in the 资产 column and in the row's accessible names. */
export function assetLabel(asset: Asset): string {
  const record = asset as unknown as Record<string, unknown>;
  for (const key of ["label", "url", "domain", "root_domain", "ip", "app_name", "c_segment", "service_name", "value"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return `#${asset.id}`;
}

/**
 * Format a list-valued cell.
 * @param values - backend list column, already filtered of empty entries.
 * @returns comma-joined text, or an em dash when the list is empty.
 */
function joinList(values: ReadonlyArray<unknown> | undefined): string {
  const items = (values ?? []).filter((value) => value !== null && value !== undefined && String(value) !== "");
  return items.length > 0 ? items.map((value) => String(value)).join(", ") : "—";
}

/**
 * Column set of one tab.
 * @param type - asset class, or null for the 全部 tab.
 * @param companies - company rows by id.
 * @returns the visible columns in table order.
 */
export function assetColumnsFor(type: string | null, companies: Map<number, Company>): AssetColumn[] {
  const companyName = (id: number | undefined): string => (id === undefined ? "" : (companies.get(id)?.name ?? ""));
  switch (type) {
    case "root_domain":
      return [
        { key: "domain", header: "域名", text: (asset) => asset.domain || "—" },
        { key: "icp", header: "ICP 备案", text: (asset) => asset.icp || "—" },
        {
          key: "company",
          header: "归属企业",
          text: (asset) => companyName(asset.company_id) || "未归属",
        },
      ];
    case "ip":
      return [
        { key: "ip", header: "IP", text: (asset) => asset.ip || "—" },
        { key: "c_segment", header: "C 段", text: (asset) => asset.c_segment || "—" },
        { key: "bound_domains", header: "绑定域名", text: (asset) => joinList(asset.bound_domains) },
        {
          key: "open_ports",
          header: "开放端口",
          text: (asset) => joinList((asset.open_ports ?? []).map((port) => (port.service ? `${port.port}/${port.service}` : String(port.port)))),
        },
      ];
    case "subdomain":
      return [
        { key: "domain", header: "域名", text: (asset) => asset.domain || "—" },
        { key: "root_domain", header: "根域名", text: (asset) => asset.root_domain || "—" },
        { key: "record_type", header: "解析类型", text: (asset) => asset.record_type || "—" },
        {
          key: "record_value",
          header: "解析值",
          text: (asset) =>
            Array.isArray(asset.record_value) ? joinList(asset.record_value) : (asset.record_value || "—"),
        },
      ];
    case "app":
      return [
        { key: "app_name", header: "应用名", text: (asset) => asset.app_name || "—" },
        { key: "bundle_id", header: "Bundle ID", text: (asset) => asset.bundle_id || "—" },
        { key: "category", header: "分类", text: (asset) => asset.category || "—" },
        { key: "app_icp", header: "ICP 备案", text: (asset) => asset.app_icp || "—" },
      ];
    case "service":
      return [
        { key: "service", header: "服务", text: (asset) => asset.service_name || asset.service_type || "—" },
        { key: "domain", header: "域名", text: (asset) => asset.domain || asset.url || "—" },
        { key: "ip", header: "IP", text: (asset) => asset.ip || "—" },
        { key: "port", header: "端口", text: (asset) => (asset.port === undefined ? "—" : String(asset.port)) },
        {
          key: "status_code",
          header: "状态码",
          text: (asset) => (asset.status_code === undefined ? "—" : String(asset.status_code)),
        },
        { key: "page_title", header: "标题", text: (asset) => asset.page_title || "—" },
        { key: "technologies", header: "指纹", text: (asset) => joinList(asset.technologies) },
        {
          key: "auth",
          header: "认证",
          text: (asset) =>
            joinList((asset.auth ?? []).map((item) => String(item.type ?? item.username ?? "认证"))),
        },
      ];
    case "endpoint":
      return [
        { key: "method", header: "方法", text: (asset) => asset.method || "—" },
        { key: "url", header: "完整地址", text: (asset) => asset.url || "—" },
        {
          key: "params",
          header: "参数",
          text: (asset) =>
            joinList(
              (asset.params ?? []).map((item) =>
                item.name ? `${String(item.name)}(${String(item.location ?? "?")})` : "?",
              ),
            ),
        },
      ];
    default:
      return [
        { key: "type", header: "类型", text: (asset) => ALL_TYPE_LABEL[asset.type] ?? asset.type },
        { key: "asset", header: "资产", text: assetLabel },
        { key: "tasks", header: "关联任务", text: (asset) => String(asset.task_ids?.length ?? 0) },
        { key: "last_seen", header: "最近出现", text: (asset) => String(asset.last_seen ?? ""), muted: true },
      ];
  }
}

/**
 * Render the current view of the inventory: a checkbox column, the class columns
 * and a per-row delete action.
 * @param props - view rows, selection state and the two row callbacks.
 * @returns the scrollable table.
 */
export function AssetTable({
  type,
  rows,
  companies,
  selected,
  onToggleRow,
  onToggleAll,
  onRequestDelete,
}: AssetTableProps): ReactNode {
  const columns = assetColumnsFor(type, companies);
  const pageIds = rows.map((row) => row.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAll.current !== null) selectAll.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <div className={css.wrap} data-asset-table={type ?? "all"}>
      <table className={css.table} style={{ minWidth: TABLE_MIN_WIDTH[type ?? "all"] ?? 540 }}>
        <thead>
          <tr>
            <th className={`${css.th} ${css.colCheck}`}>
              <input
                ref={selectAll}
                type="checkbox"
                aria-label="全选当前视图的资产"
                checked={allSelected}
                disabled={pageIds.length === 0}
                onChange={() => onToggleAll(pageIds)}
                data-asset-select-all=""
              />
            </th>
            {columns.map((column) => (
              <th key={column.key} className={css.th} title={column.header}>
                {column.header}
              </th>
            ))}
            <th className={`${css.th} ${css.colAction}`} aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} className={`${css.td} ${css.emptyCell}`}>
                暂无数据。
              </td>
            </tr>
          ) : null}
          {rows.map((asset) => (
            <tr
              key={asset.id}
              data-data-page-row=""
              data-asset-id={asset.id}
              className={selected.has(asset.id) ? css.rowSelected : undefined}
            >
              <td className={`${css.td} ${css.colCheck}`}>
                <input
                  type="checkbox"
                  aria-label={`选择资产 ${assetLabel(asset)}`}
                  checked={selected.has(asset.id)}
                  onChange={() => onToggleRow(asset.id)}
                  data-asset-select={asset.id}
                />
              </td>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={column.muted ? `${css.td} ${css.tdMuted}` : css.td}
                  title={column.text(asset)}
                >
                  {column.text(asset)}
                </td>
              ))}
              <td className={`${css.td} ${css.colAction}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`删除资产 ${assetLabel(asset)}`}
                  title="删除该资产"
                  onClick={() => onRequestDelete(asset)}
                  data-asset-delete={asset.id}
                  icon={<IconTrashOutlineRegular size={14} />}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wording of one asset class for the empty state and the tab tooltip. */
export function assetTypeCaption(type: string | null): string {
  return type === null ? "资产" : assetTypeLabel(type);
}
