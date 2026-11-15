"use client";

import * as React from "react";

import Link from "next/link";

import { Inbox, Loader2, RotateCw, Search, X } from "lucide-react";

import { api } from "@/lib/api";
import type { Finding, Severity } from "@/lib/types";

import styles from "./list.module.css";
import { Picker } from "./picker";

const PAGE_SIZE = 25;

type SeverityFilter = "all" | Severity;

const SEVERITY_OPTIONS: Array<{ value: SeverityFilter; label: string }> = [
  { value: "all", label: "全部等级" },
  { value: "critical", label: "严重" },
  { value: "high", label: "高危" },
  { value: "medium", label: "中危" },
  { value: "low", label: "低危" },
];

const SEVERITY_LABEL: Record<string, string> = {
  critical: "严重",
  high: "高危",
  medium: "中危",
  low: "低危",
  info: "提示",
};

function severityClass(severity: string): string {
  switch (severity) {
    case "critical":
      return styles.badgeCritical;
    case "high":
      return styles.badgeHigh;
    case "medium":
      return styles.badgeMedium;
    case "low":
      return styles.badgeLow;
    default:
      return styles.badgeInfo;
  }
}

/**
 * Harness findings list.
 *
 * The legacy page is a 1191-line table with its own asset tree, batch export and
 * native controls. This replaces it with the same single-column language as the
 * task list: severity badge, title, vulnclass/summary, task, time.
 */
export function FindingsList() {
  const [items, setItems] = React.useState<Finding[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [severity, setSeverity] = React.useState<SeverityFilter>("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.findingsPage({
        page,
        pageSize: PAGE_SIZE,
        severity,
        status: "all",
        query: debounced || undefined,
        sort: "time",
      });
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
      setError("");
    } catch (err) {
      setError((err as Error).message || "发现列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, severity, debounced]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    setPage(1);
  }, [severity, debounced]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.root} data-testid="harness-findings">
      <header className={styles.head}>
        <h1 className={styles.title}>发现</h1>
        <span className={styles.count}>{total} 条</span>
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
            placeholder="搜索漏洞名称、类型或摘要"
            aria-label="搜索发现"
            data-testid="finding-search"
          />
          {query ? (
            <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="清空搜索">
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <Picker
          label="严重级别筛选"
          value={severity}
          options={SEVERITY_OPTIONS}
          onChange={setSeverity}
          testId="finding-severity-filter"
        />
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
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Inbox size={18} strokeWidth={1.7} aria-hidden="true" /></span>
            <span className={styles.emptyTitle}>还没有发现</span>
            <span className={styles.emptyText}>
              任务执行产生证据后，漏洞会按严重级别列在这里，并关联到对应资产。
            </span>
          </div>
        ) : (
          <ul className={styles.list} data-testid="finding-rows">
            {items.map((finding) => (
              <li key={finding.id} className={styles.row} data-finding-id={finding.id}>
                <Link
                  href={`/function/findings/detail?id=${encodeURIComponent(finding.finding_id ?? finding.id)}`}
                  className={styles.rowLink}
                >
                  <span className={`${styles.badge} ${severityClass(finding.severity)}`}>
                    {SEVERITY_LABEL[finding.severity] ?? finding.severity}
                  </span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{finding.name || finding.vulnclass}</span>
                    <span className={styles.rowSub}>
                      {finding.summary || finding.vulnclass}
                    </span>
                  </span>
                  <span className={styles.rowMeta}>
                    <span className={styles.mono}>{finding.vulnclass}</span>
                    <span>{finding.status}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pageCount > 1 ? (
        <footer className={styles.footer}>
          <span className={styles.footerInfo}>第 {page} / {pageCount} 页 · 共 {total} 条</span>
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
