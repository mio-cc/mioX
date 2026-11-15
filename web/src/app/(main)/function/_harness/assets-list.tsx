"use client";

import * as React from "react";

import { Inbox, Loader2, RotateCw, Search, X } from "lucide-react";

import { api } from "@/lib/api";
import type { Asset } from "@/lib/types";

import styles from "./list.module.css";
import { Picker } from "./picker";

const PAGE_SIZE = 30;

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部类型" },
  { value: "root_domain", label: "根域名" },
  { value: "subdomain", label: "子域名" },
  { value: "ip", label: "IP" },
  { value: "c_segment", label: "C 段" },
  { value: "service", label: "服务" },
  { value: "app", label: "应用" },
];

const TYPE_LABEL: Record<string, string> = {
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  c_segment: "C 段",
  service: "服务",
  app: "应用",
  company: "企业",
};

function assetLabel(asset: Asset): string {
  return asset.domain || asset.app_name || asset.ip || asset.c_segment || asset.root_domain || `#${asset.id}`;
}

function assetMeta(asset: Asset): string {
  const parts: string[] = [];
  if (asset.port) parts.push(`:${asset.port}`);
  if (asset.open_ports?.length) {
    parts.push(asset.open_ports.map((p) => p.port).slice(0, 6).join(", "));
  }
  if (asset.record_type) parts.push(asset.record_type);
  if (asset.icp) parts.push(asset.icp);
  return parts.join(" · ") || "—";
}

/**
 * Harness asset list.
 *
 * Same single-column language as the task/findings lists; the legacy page keeps
 * its own 1156-line table and bulk-edit toolbar for the legacy shell.
 */
export function AssetsList() {
  const [items, setItems] = React.useState<Asset[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.assets(type, PAGE_SIZE, (page - 1) * PAGE_SIZE);
      setItems(res.assets ?? []);
      setTotal(res.total ?? 0);
      setError("");
    } catch (err) {
      setError((err as Error).message || "资产列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [type, page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    setPage(1);
  }, [type]);

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? items.filter((asset) =>
        [assetLabel(asset), assetMeta(asset), asset.type].some((field) => String(field).toLowerCase().includes(needle)),
      )
    : items;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.root} data-testid="harness-assets">
      <header className={styles.head}>
        <h1 className={styles.title}>资产</h1>
        <span className={styles.count}>{total} 个</span>
        <div className={styles.headActions}>
          <button
            type="button"
            className={`${styles.ghostBtn} ${styles.iconBtn}`}
            onClick={() => void load()}
            aria-label="刷新"
            title="刷新"
          >
            <RotateCw size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={14} className={styles.searchIcon} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="在当前页内搜索域名、IP 或端口"
            aria-label="搜索资产"
            data-testid="asset-search"
          />
          {query ? (
            <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="清空搜索">
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <Picker label="资产类型筛选" value={type} options={TYPE_OPTIONS} onChange={setType} testId="asset-type-filter" />
      </div>

      <div className={styles.listWrap}>
        {loading && items.length === 0 ? (
          <div className={styles.state}>
            <Loader2 size={16} className={styles.spin} aria-hidden="true" /> 加载中…
          </div>
        ) : error ? (
          <div className={styles.stateError}>
            {error}
            <button type="button" className={styles.retry} onClick={() => void load()}>重试</button>
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Inbox size={18} strokeWidth={1.7} aria-hidden="true" /></span>
            <span className={styles.emptyTitle}>{total === 0 ? "还没有资产" : "没有匹配的资产"}</span>
            <span className={styles.emptyText}>
              {total === 0 ? "任务探测或资产同步产生的结果会汇总到这里。" : "换个关键词或切换类型试试。"}
            </span>
          </div>
        ) : (
          <ul className={styles.list} data-testid="asset-rows">
            {rows.map((asset) => (
              <li key={asset.id} className={styles.row} data-asset-id={asset.id}>
                <div className={styles.rowLink}>
                  <span className={`${styles.badge} ${styles.badgeInfo}`}>
                    {TYPE_LABEL[asset.type] ?? asset.type}
                  </span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{assetLabel(asset)}</span>
                    <span className={styles.rowSub}>{assetMeta(asset)}</span>
                  </span>
                  <span className={styles.rowMeta}>
                    {asset.task_ids?.length ? <span>{asset.task_ids.length} 个任务</span> : <span>未关联任务</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? (
        <footer className={styles.footer}>
          <span className={styles.footerInfo}>第 {page} / {pageCount} 页 · 共 {total} 个</span>
          <span className={styles.footerActions}>
            <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              上一页
            </button>
            <button type="button" className={styles.pageBtn} disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              下一页
            </button>
          </span>
        </footer>
      ) : null}
    </div>
  );
}
