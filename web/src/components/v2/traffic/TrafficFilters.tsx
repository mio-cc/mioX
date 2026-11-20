"use client";

/**
 * 流量页的筛选行（A08，对照表 P2:E6、P2:E7、P2:E8）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:112（状态桶）、:106-108（排序字段与存储键）、
 * :491-603（方法/每页条数/高级筛选）、:639-667（排序）。
 * 所有筛选都下推到后端（api.ts:880-907 的 traffic 入参），本地不做假过滤。
 */
import type { ReactNode } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import {
  STATUS_BUCKETS,
  TRAFFIC_PAGE_SIZES,
  type TrafficPageQuery,
  type TrafficSortDirection,
  type TrafficSortField,
} from "@/v2/data/traffic";

import css from "./traffic.module.css";

const METHOD_OPTIONS = [
  { value: "all", label: "全部方法" },
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
  { value: "other", label: "其他" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  ...STATUS_BUCKETS.map((bucket) => ({ value: bucket, label: bucket })),
];

const SORT_OPTIONS = [
  { value: "ts", label: "按时间" },
  { value: "status", label: "按状态码" },
  { value: "resp_len", label: "按响应长度" },
];

const ORDER_OPTIONS = [
  { value: "desc", label: "降序" },
  { value: "asc", label: "升序" },
];

export interface TrafficFiltersProps {
  readonly query: TrafficPageQuery;
  /** 改一个字段（页码由调用方重置）。 */
  readonly onChange: (patch: Partial<TrafficPageQuery>) => void;
  /** 清除全部筛选（回到默认）。 */
  readonly onClear: () => void;
  /** 是否展开高级筛选。 */
  readonly advanced: boolean;
  readonly onToggleAdvanced: () => void;
}

/**
 * 渲染筛选行与高级筛选。
 * @param props - 当前筛选、变更回调、清除与高级展开状态。
 * @returns 筛选区。
 */
export function TrafficFilters({ query, onChange, onClear, advanced, onToggleAdvanced }: TrafficFiltersProps): ReactNode {
  const hasAdvanced =
    query.body !== "" || query.path !== "" || query.respMin !== "" || query.respMax !== "" || query.status !== "all";
  const dirty =
    hasAdvanced ||
    query.host !== "" ||
    query.method !== "all" ||
    query.q !== "" ||
    query.sort !== "ts" ||
    query.order !== "desc" ||
    query.size !== 50;

  return (
    <div className={css.filters} data-traffic-filters="">
      <div className={css.filterRow}>
        <SelectMenu
          ariaLabel="请求方法筛选"
          value={query.method}
          options={METHOD_OPTIONS}
          onChange={(next) => onChange({ method: next })}
        />
        <SelectMenu
          ariaLabel="状态码筛选"
          value={query.status}
          options={STATUS_OPTIONS}
          onChange={(next) => onChange({ status: next })}
        />
        <SelectMenu
          ariaLabel="每页条数"
          value={String(query.size)}
          options={TRAFFIC_PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / 页` }))}
          onChange={(next) => onChange({ size: Number(next) })}
        />
        <SelectMenu
          ariaLabel="排序字段"
          value={query.sort}
          options={SORT_OPTIONS}
          onChange={(next) => onChange({ sort: next as TrafficSortField })}
        />
        <SelectMenu
          ariaLabel="排序方向"
          value={query.order}
          options={ORDER_OPTIONS}
          onChange={(next) => onChange({ order: next as TrafficSortDirection })}
        />
        <Button variant="outline" size="sm" aria-pressed={advanced} onClick={onToggleAdvanced} data-traffic-advanced-toggle="">
          {advanced ? "收起高级筛选" : "高级筛选"}
        </Button>
        {dirty ? (
          <Button variant="outline" size="sm" onClick={onClear} data-traffic-clear="">
            清除筛选
          </Button>
        ) : null}
      </div>

      {advanced ? (
        <div className={css.advanced} data-traffic-advanced="">
          <label className={css.field}>
            <span className={css.fieldLabel}>Host</span>
            <Input
              value={query.host}
              placeholder="example.com"
              data-traffic-host=""
              onChange={(event) => onChange({ host: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>响应正文关键词</span>
            <Input
              value={query.body}
              placeholder="响应里出现过的词"
              data-traffic-body=""
              onChange={(event) => onChange({ body: event.target.value })}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>路径包含</span>
            <Input
              value={query.path}
              placeholder="/api/"
              data-traffic-path=""
              onChange={(event) => onChange({ path: event.target.value })}
            />
          </label>
          <div className={css.rangeRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>响应长度下限</span>
              <Input
                value={query.respMin}
                placeholder="0"
                data-traffic-resp-min=""
                onChange={(event) => onChange({ respMin: event.target.value.replace(/[^\d]/g, "") })}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>上限</span>
              <Input
                value={query.respMax}
                placeholder="不限"
                data-traffic-resp-max=""
                onChange={(event) => onChange({ respMax: event.target.value.replace(/[^\d]/g, "") })}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
