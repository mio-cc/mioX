"use client";

/**
 * Traffic body: captured exchanges with the capture state surfaced first, because
 * an empty list and a switched-off capture mean different things.
 *
 * A08 扩展：方法 / 状态桶 / 高级筛选（正文关键词、路径、响应长度区间）/ 服务端排序 / 分页 / 勾选。
 * A13 扩展：勾选 ≥1 条后出现「关联到漏洞（N）」按钮，挂 LinkToFindingDialog；成功后清空勾选并刷新列表。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/traffic/page.tsx:112,340-690（A08）、:605-615（A13 勾选栏与入口）。
 * 所有筛选都下推到后端（v2/data/traffic.ts 的 useTrafficPage → api.traffic），本地不做假过滤。
 *
 * The body is surface-agnostic and takes no props, because two surfaces render
 * it: the standalone `/v2/traffic` route, which owns the full-viewport frame, and
 * the shell's main area, which reaches it through the page registry
 * (`v2/data/pages.ts`).
 */
import { type ReactNode, useCallback, useMemo, useState } from "react";

import { buildCsv, csvFileName, downloadCsv } from "@/components/v2/data-pages/csv";
import { DataPageToolbar } from "@/components/v2/data-pages/DataPageToolbar";
import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconLinkOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { TrafficExchange } from "@/lib/types";
import { saveSettingsPatch } from "@/v2/data/settings";
import { useTrafficPage, type TrafficPageQuery } from "@/v2/data/traffic";
import { toast } from "@/components/v2/settings/Toast";

import { TrafficDetail } from "@/components/v2/traffic/TrafficDetail";
import { TrafficFilters } from "@/components/v2/traffic/TrafficFilters";
import { TrafficHostsDialog } from "@/components/v2/traffic/TrafficHostsDialog";
import { TrafficTable } from "@/components/v2/traffic/TrafficTable";
import { LinkToFindingDialog } from "@/components/v2/traffic/LinkToFindingDialog";
import css from "@/components/v2/traffic/traffic.module.css";

const CSV_HEADERS = ["方法", "URL", "状态", "大小", "时间"];

/** 筛选默认值；也是「清除筛选」的目标值。 */
const DEFAULT_QUERY: TrafficPageQuery = {
  page: 1,
  size: 50,
  host: "",
  method: "all",
  q: "",
  body: "",
  path: "",
  status: "all",
  respMin: "",
  respMax: "",
  sort: "ts",
  order: "desc",
};

/**
 * 行导出用的一行文本。
 * @param row - 一条流量。
 * @returns CSV 的一行。
 */
function rowCells(row: TrafficExchange): string[] {
  return [row.method, row.url, String(row.status), String(row.resp_len), row.ts];
}

/**
 * Render the traffic table and its filter/refresh/export toolbar.
 * @returns the toolbar, the capture state line, the rows, and the empty/offline state.
 */
export function TrafficDataPage(): ReactNode {
  const [query, setQuery] = useState<TrafficPageQuery>(DEFAULT_QUERY);
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<TrafficExchange | null>(null);
  // 采集开关写入中：防止连点发出两次 PATCH（Switch 本身没有 disabled 档）。
  const [captureBusy, setCaptureBusy] = useState(false);
  // A13：非 null 表示「关联到漏洞」弹窗打开，值是当前勾选的流量 id 快照。
  const [linking, setLinking] = useState<string[] | null>(null);
  // 文本类筛选防抖，避免每敲一个字符就请求一次。
  const appliedQ = useDebouncedValue(query.q.trim(), 250);
  const appliedHost = useDebouncedValue(query.host.trim(), 250);
  const appliedBody = useDebouncedValue(query.body.trim(), 250);
  const appliedPath = useDebouncedValue(query.path.trim(), 250);

  const effective = useMemo<TrafficPageQuery>(
    () => ({ ...query, q: appliedQ, host: appliedHost, body: appliedBody, path: appliedPath }),
    [query, appliedQ, appliedHost, appliedBody, appliedPath],
  );
  const state = useTrafficPage(effective);
  const rows = state.data?.exchanges ?? [];
  const enabled = state.data?.enabled === true;
  const total = state.data?.total ?? 0;

  /** 改筛选：除页码外的任何变化都回到第 1 页。 */
  const patch = useCallback((next: Partial<TrafficPageQuery>) => {
    setQuery((current) => {
      const page = "page" in next ? (next.page ?? 1) : 1;
      return { ...current, ...next, page };
    });
  }, []);

  const clear = useCallback(() => {
    setQuery(DEFAULT_QUERY);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const allSelected = rows.length > 0 && rows.every((row) => current.has(row.id));
      if (allSelected) {
        const next = new Set(current);
        for (const row of rows) next.delete(row.id);
        return next;
      }
      const next = new Set(current);
      for (const row of rows) next.add(row.id);
      return next;
    });
  }, [rows]);

  const exportCsv = useCallback(() => {
    downloadCsv(csvFileName("traffic"), buildCsv(CSV_HEADERS, rows.map(rowCells)));
  }, [rows]);

  return (
    <>
      <DataPageToolbar
        page="traffic"
        title="流量"
        lead="记录代理落库的请求与响应。"
        query={query.q}
        onQueryChange={(value) => patch({ q: value })}
        filterLabel="搜索流量…"
        count={state.phase === "ready" ? total : null}
        onRefresh={state.reload}
        onExport={exportCsv}
        canExport={rows.length > 0}
      />

      <TrafficFilters
        query={query}
        onChange={patch}
        onClear={clear}
        advanced={advanced}
        onToggleAdvanced={() => setAdvanced((open) => !open)}
      />

      <TrafficHostsDialog onChanged={state.reload} />

      {state.phase === "ready" ? (
        <div className={css.captureLine} data-traffic-capture={enabled ? "on" : "off"}>
          {/* P2:E1：采集开关就地在页内可改（PATCH /settings 的 traffic_capture），
              改完立即重读流量列表，失败时把后端原因写进 toast 并回滚显示。 */}
          <Switch
            checked={enabled}
            label={enabled ? "流量采集中，点击关闭" : "流量采集已关闭，点击开启"}
            onChange={(next) => {
              if (captureBusy) return;
              setCaptureBusy(true);
              saveSettingsPatch({ traffic_capture: next })
                .then(() => {
                  setCaptureBusy(false);
                  toast(next ? "已开启流量采集" : "已关闭流量采集");
                  state.reload();
                })
                .catch((reason: unknown) => {
                  setCaptureBusy(false);
                  toast(`切换失败：${reason instanceof Error ? reason.message : String(reason)}`);
                });
            }}
          />
          <span>{enabled ? "采集中" : "未采集"}</span>
          {state.data?.proxy === undefined || state.data.proxy === "" ? null : (
            <span className={css.captureMeta}>代理：{state.data.proxy}</span>
          )}
          <span className={css.captureMeta}>共 {total} 条</span>
        </div>
      ) : null}

      {state.phase === "ready" && !enabled ? (
        <p className={css.warnLine}>流量采集当前关闭，因此没有记录。可在「设置 → 通用设置 → 流量采集」里打开。</p>
      ) : null}

      {state.phase === "ready" && enabled && rows.length === 0 ? (
        <p className={css.hintLine} data-traffic-empty="">
          {effective.q === "" && effective.host === "" && effective.body === "" && effective.path === ""
            ? "暂无流量记录"
            : "没有匹配的流量记录"}
        </p>
      ) : null}

      {selected.size > 0 ? (
        <div className={css.hostActions} data-traffic-link-bar={selected.size}>
          <Button
            variant="outline"
            size="sm"
            data-traffic-link-open=""
            onClick={() => setLinking([...selected])}
            icon={<IconLinkOutlineRegular size={14} />}
          >
            关联到漏洞（{selected.size}）
          </Button>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <TrafficTable
          rows={rows}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onClearSelection={() => setSelected(new Set())}
          onOpen={(row) => setDetail(row)}
          page={query.page}
          size={query.size}
          total={total}
          onPage={(page) => patch({ page })}
        />
      ) : null}

      {state.phase === "offline" ? (
        <p className={css.errorLine} role="alert">
          未连接后端（{state.error}）
          <Button variant="outline" size="sm" onClick={state.reload}>
            重试
          </Button>
        </p>
      ) : null}

      <TrafficDetail row={detail} onClose={() => setDetail(null)} />

      <LinkToFindingDialog
        trafficIds={linking}
        onCancel={() => setLinking(null)}
        onBound={() => {
          setLinking(null);
          setSelected(new Set());
          state.reload();
        }}
      />
    </>
  );
}
