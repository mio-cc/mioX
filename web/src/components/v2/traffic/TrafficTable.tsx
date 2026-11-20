"use client";

/**
 * 流量表格与分页（A08，对照表 P2:E9、P2:E10）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:517-542（分页）、:605-690（勾选）。
 * 勾选只服务后续批量动作（A13 关联到漏洞），本单元只负责选中状态与计数。
 */
import type { ReactNode } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import type { TrafficExchange } from "@/lib/types";

import css from "./traffic.module.css";

export interface TrafficTableProps {
  readonly rows: readonly TrafficExchange[];
  /** 已选流量 id。 */
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  /** 本页全选 / 取消全选。 */
  readonly onToggleAll: () => void;
  readonly onClearSelection: () => void;
  /** 点开某一行的详情（A10 的抽屉）；未提供时 URL 只作为文本显示。 */
  readonly onOpen?: (row: TrafficExchange) => void;
  readonly page: number;
  readonly size: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
}

/**
 * 时间戳文案（后端 ts 为 ISO 串）。
 * @param value - ISO 时间。
 * @returns 本地时间文本。
 */
function timeText(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 字节数文案。
 * @param value - 响应长度。
 * @returns 带单位的文本。
 */
function sizeText(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

/**
 * 渲染流量表格、勾选列与分页条。
 * @param props - 行、选中状态、分页与回调。
 * @returns 表格与分页条。
 */
export function TrafficTable(props: TrafficTableProps): ReactNode {
  const { rows, selected, page, size, total, onPage } = props;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div className={css.tableWrap}>
      {selected.size > 0 ? (
        <div className={css.selectionBar} data-traffic-selection={selected.size}>
          <span>已选 {selected.size} 条</span>
          <Button variant="outline" size="sm" onClick={props.onClearSelection} data-traffic-selection-clear="">
            清空选择
          </Button>
        </div>
      ) : null}

      <div className={css.scrollX}>
        <table className={css.table} data-traffic-table="">
          <thead>
            <tr>
              <th className={css.checkCell}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="本页全选"
                  data-traffic-select-all=""
                  onChange={props.onToggleAll}
                />
              </th>
              <th>方法</th>
              <th>URL</th>
              <th className={css.num}>状态</th>
              <th className={css.num}>大小</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                data-traffic-row={row.id}
                className={selected.has(row.id) ? css.rowSelected : undefined}
              >
                <td className={css.checkCell}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    aria-label={`选择流量 ${row.id}`}
                    data-traffic-select={row.id}
                    onChange={() => props.onToggle(row.id)}
                  />
                </td>
                <td className={css.mono}>{row.method}</td>
                <td className={css.urlCell}>
                  {props.onOpen === undefined ? (
                    <span className={css.urlText} title={row.url}>
                      {row.url}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={css.urlButton}
                      title={row.url}
                      data-traffic-open={row.id}
                      onClick={() => props.onOpen?.(row)}
                    >
                      {row.url}
                    </button>
                  )}
                </td>
                <td className={css.num}>{row.status}</td>
                <td className={css.num}>{sizeText(row.resp_len)}</td>
                <td className={css.time}>{timeText(row.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className={css.pager} data-traffic-pager="">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            上一页
          </Button>
          <span className={css.pageInfo}>
            第 {page} / {pageCount} 页 · 共 {total} 条
          </span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            下一页
          </Button>
        </div>
      ) : null}
    </div>
  );
}
