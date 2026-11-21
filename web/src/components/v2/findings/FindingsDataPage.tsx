"use client";

/**
 * Findings page: the cross-task vulnerability list (B1–B5, B8–B12, B23, B24) and
 * the read-only detail second level (C1–C5, C10) in one addressable surface.
 *
 * The body is surface-agnostic and takes no props, because two surfaces render
 * it: the standalone `/v2/findings` route, which owns the full-viewport frame,
 * and the shell's main area, which reaches it through the page registry
 * (`v2/data/pages.ts`). The old pages are
 * `app/(main)/function/findings/page.tsx` (list) and
 * `app/(main)/function/findings/detail/page.tsx` (detail).
 *
 * Level two is a nested view of this same page, not a new route: the list ⇄
 * detail switch is the `?finding=<id>` search param (`/v2/shell?page=findings&
 * finding=<id>`), so one deep link restores it and the browser Back returns to
 * the list. The address is the single owner of that selection the same way
 * `?page=` is in the shell: opening pushes a history step, Back re-reads it on
 * `popstate`, and the "返回列表" button is a Back when this page pushed the
 * step and a replace otherwise (a deep link has no list step to go back to).
 * The list stays mounted while the detail shows, so filters/pagination survive
 * the round trip instead of being re-fetched and reset.
 *
 * Everything the detail writes (severity/status pickers, retest, traffic
 * bindings, report) belongs to the later detail unit: this body only lists, so
 * the list surface draws no detail write control.
 *
 * 勾选与批量 / 导出（P2:B13 / P2:B14，单元 C07）：行首勾选记 `finding_id`、跨页保留
 * （旧页 `findings/page.tsx:251-277`）；批量改状态逐条调用 `api.setFindingStatus`
 * （api.ts:760，**后端无批量接口**，见 `FindingsBulkBar.tsx` 文件头）；导出走
 * `api.exportFindings`（api.ts:654-686），后端按筛选条件导出全部命中行。
 *
 * 三视图（P2:B7 / P2:B20–B22，单元 C08）：顶部 `SegmentedControl` 切「平铺 / 按任务分组 /
 * 按资产」（旧页 `findings/page.tsx:826-832`）。三段共用同一份筛选 state，所以切换视图、
 * 点资产树节点都不丢当前筛选；只有资产范围 `assetScope` 属于「按资产」视图（旧页 :317
 * `activeAssetScope = view === "asset" ? assetScope : null`，只有该视图才把 asset_scope
 * 交给后端）。分组卡见 `GroupedFindings.tsx`，左树与面包屑见 `FindingsAssetTree.tsx`。
 */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { useDebouncedValue } from "@/components/v2/data-pages/use-debounced-value";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { toast } from "@/components/v2/settings/Toast";
import type { FindingStatus } from "@/lib/types";
import { Button } from "@/vendor/dsh/primitives/Button";
import { FilterBar } from "@/components/v2/design/Kit";
import {
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconShieldOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import {
  FINDINGS_PAGE_SIZE,
  FINDINGS_VIEW_OPTIONS,
  SEVERITY_FILTER_ORDER,
  STATUS_FILTER_ORDER,
  UNASSIGNED_TASK,
  findingStatusLabel,
  findingTitle,
  formatFindingTime,
  severityLabel,
  setFindingStatus,
  useActiveFindingRetests,
  useFindingAssetTree,
  useFindingStats,
  useFindingsPage,
  type FindingsSort,
  type FindingsView,
} from "@/v2/data/findings-page";

import {
  FindingBulkStatusDialog,
  FindingsBulkBar,
  FindingsExportDialog,
  findingRowId,
} from "./FindingsBulkBar";
import { FindingDetailView } from "./FindingDetailView";
import { FindingsAssetTree, assetPathOf } from "./FindingsAssetTree";
import { GroupedFindings } from "./GroupedFindings";
import css from "./FindingsDataPage.module.css";

/** Search param that selects the detail level (absent = the list). */
const FINDING_PARAM = "finding";

/**
 * Search param that presets the task filter on a deep link（U1：`?ftask=<id>`，
 * 中·发现「在发现库查看全部」）。不用 `task`：那是 Shell 的选中任务参数（Shell.tsx:1323）。
 */
const FTASK_PARAM = "ftask";

/** Severity filter value: a backend severity, or `all`. */
type SeverityFilter = "all" | (typeof SEVERITY_FILTER_ORDER)[number];

/** Everything the toolbar and the pager own; page resets to 1 on filter changes. */
interface FindingsFilters {
  page: number;
  query: string;
  sort: FindingsSort;
  severity: SeverityFilter;
  status: "all" | FindingStatus;
  vulnclass: string;
  task: string;
}

const DEFAULT_FILTERS: FindingsFilters = {
  page: 1,
  query: "",
  sort: "time",
  severity: "all",
  status: "all",
  vulnclass: "all",
  task: "all",
};

const SORT_OPTIONS: ReadonlyArray<{ value: FindingsSort; label: string }> = [
  { value: "time", label: "按时间" },
  { value: "severity", label: "按严重度" },
];

/** Read the detail selection from the address (null on the server and in the list). */
function readFindingParam(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(FINDING_PARAM);
  return value === "" ? null : value;
}

/**
 * 筛选初值（U1）：默认筛选，再读一次 `?ftask=` 预置任务筛选（只在挂载时读，
 * 之后筛选是页内 state，与旧页一致）。服务端渲染返回默认值。
 * @returns 初值；地址没有 `ftask` 时任务筛选取默认 `all`。
 */
function readInitialFilters(): FindingsFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  const value = new URLSearchParams(window.location.search).get(FTASK_PARAM);
  if (value === null || value.trim() === "") return DEFAULT_FILTERS;
  return { ...DEFAULT_FILTERS, task: value.trim() };
}

/**
 * Write the detail selection into the address.
 * @param id - finding id, or null to clear the selection.
 * @param mode - `push` adds a history step (row click); `replace` corrects the
 *   current entry (deep-link "back" with no list step behind it).
 */
function writeFindingParam(id: string | null, mode: "push" | "replace"): void {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete(FINDING_PARAM);
  else url.searchParams.set(FINDING_PARAM, id);
  if (mode === "push") window.history.pushState({ mioxFinding: id }, "", url);
  else window.history.replaceState(window.history.state, "", url);
}

/** Severity pill class; unknown backend values fall back to the neutral pill. */
function severityClass(severity: string): string {
  switch (severity) {
    case "critical":
      return css.badgeCritical;
    case "high":
      return css.badgeHigh;
    case "medium":
      return css.badgeMedium;
    case "low":
      return css.badgeLow;
    default:
      return css.badgeInfo;
  }
}

/**
 * Render the findings list (with filters, statistics and the second-level
 * detail) or the detail it selects.
 * @returns the list surface, or the detail view when `?finding=` names a row.
 */
export function FindingsDataPage(): ReactNode {
  const [filters, setFilters] = useState<FindingsFilters>(readInitialFilters);
  const [openId, setOpenId] = useState<string | null>(null);

  // 三视图（C08）：view 默认平铺；assetScope 只在「按资产」视图里生效（旧页 :317）。
  const [view, setView] = useState<FindingsView>("flat");
  const [assetScope, setAssetScope] = useState<string>("");

  // 勾选按 `finding_id` 记（旧页 :251-252），因此翻页不丢；批量写与导出都用它。
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<FindingStatus | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailure, setBulkFailure] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // The address owns the level selection: read it once mounted (the server has
  // no address) and follow Back/Forward by re-reading it.
  useEffect(() => {
    setOpenId(readFindingParam());
    const onPopState = (): void => setOpenId(readFindingParam());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openFinding = useCallback((id: string): void => {
    writeFindingParam(id, "push");
    setOpenId(id);
  }, []);

  const closeFinding = useCallback((): void => {
    const state = window.history.state as { mioxFinding?: string | null } | null;
    if (state?.mioxFinding !== undefined && state.mioxFinding !== null) {
      // We pushed a step for this detail: Back is the honest "return to list".
      window.history.back();
      return;
    }
    // Deep link with no list step behind it: clear the param in place.
    writeFindingParam(null, "replace");
    setOpenId(null);
  }, []);

  // Backend search is debounced; filters apply immediately.
  const applied = useDebouncedValue(filters.query.trim(), 250);

  // 资产范围只属于「按资产」视图：切到别的视图时按「全部资产」取数，切回来沿用原选择，
  // 这样来回切换既不丢筛选条件，也不会让平铺/分组视图被资产范围意外过滤。
  const activeAssetScope = useMemo(() => (view === "asset" ? assetScope : ""), [view, assetScope]);

  const state = useFindingsPage({
    page: filters.page,
    query: applied,
    sort: filters.sort,
    severity: filters.severity,
    status: filters.status,
    vulnclass: filters.vulnclass,
    task: filters.task,
    assetScope: activeAssetScope === "" ? undefined : activeAssetScope,
  });
  const stats = useFindingStats();
  const retests = useActiveFindingRetests();

  // 分组视图与资产树各用同一份筛选条件取数；资产树不带 assetScope（旧页 :346-348）。
  const tree = useFindingAssetTree({
    query: applied,
    sort: filters.sort,
    severity: filters.severity,
    status: filters.status,
    vulnclass: filters.vulnclass,
    task: filters.task,
  });

  // 筛选条件（含搜索词）一变化就让分组视图回到第 1 页并收起已展开的分组（旧页 :509-522）。
  const filterSeed = useMemo(
    () =>
      JSON.stringify([
        applied,
        filters.sort,
        filters.severity,
        filters.status,
        filters.vulnclass,
        filters.task,
      ]),
    [applied, filters.sort, filters.severity, filters.status, filters.vulnclass, filters.task],
  );

  // 当前资产范围在树里从「全部资产」到该节点的路径，用于面包屑（P2:B22）。
  const assetPath = useMemo(
    () => (view === "asset" ? assetPathOf(tree.nodes, assetScope) : []),
    [view, tree.nodes, assetScope],
  );

  /** Merge a patch and (unless the patch is a page move) restart at page 1. */
  const update = useCallback((patch: Partial<FindingsFilters>): void => {
    setFilters((current) => ({
      ...current,
      ...patch,
      page: patch.page ?? 1,
    }));
  }, []);

  /**
   * 切视图只换视图，筛选/搜索/排序/页码原样保留（P2:B7「切换视图不丢失当前筛选条件」）。
   * @param next - 目标视图。
   */
  const changeView = useCallback((next: FindingsView): void => {
    setView(next);
  }, []);

  /**
   * 选中资产树上的一个节点（空串 = 全部资产）：换资产范围时回到第 1 页，其余筛选不动。
   * @param key - 树节点 key（形如 `a:` / `c:` / `r:` / `__none__`），空串表示全部。
   */
  const selectAssetScope = useCallback((key: string): void => {
    setAssetScope(key);
    setFilters((current) => ({ ...current, page: 1 }));
  }, []);

  const pageCount = Math.max(1, Math.ceil(state.total / FINDINGS_PAGE_SIZE));

  // A filter that empties the tail must not leave us on a page that no longer
  // exists: land on the last real page once the response knows the new total.
  useEffect(() => {
    if (state.phase !== "ready") return;
    if (filters.page > pageCount) update({ page: pageCount });
  }, [filters.page, pageCount, state.phase, update]);

  // A selected option can disappear from the aggregate (the row was reclassified
  // or its task deleted): fall back to 全部 instead of showing an empty list.
  useEffect(() => {
    if (stats.phase !== "ready" || stats.stats === null) return;
    const classes = stats.stats.vulnclasses ?? [];
    if (filters.vulnclass !== "all" && !classes.includes(filters.vulnclass)) update({ vulnclass: "all" });
    const tasks = stats.stats.tasks ?? [];
    if (
      filters.task !== "all" &&
      filters.task !== UNASSIGNED_TASK &&
      !tasks.some((option) => String(option.id) === filters.task)
    ) {
      update({ task: "all" });
    }
  }, [filters.task, filters.vulnclass, stats.phase, stats.stats, update]);

  const reloadAll = useCallback((): void => {
    state.reload();
    stats.reload();
    tree.reload();
  }, [state, stats, tree]);

  const pageIds = useMemo(() => state.items.map((finding) => findingRowId(finding)), [state.items]);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleSelected = useCallback((id: string, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** 本页全选（旧页 :268-277 的 `toggleSelectedPage`）。 */
  const selectPage = useCallback((): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of pageIds) next.add(id);
      return next;
    });
  }, [pageIds]);

  const clearSelected = useCallback((): void => setSelectedIds(new Set()), []);

  /**
   * 批量改状态：后端没有批量接口，所以按条串行调用同一条状态更新
   * （不并发、不重试、不做乐观更新），逐条统计成功 / 失败，最后如实报数并刷新。
   */
  const runBulkStatus = useCallback(
    (status: FindingStatus): void => {
      if (bulkBusy) return;
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      setBulkBusy(true);
      setBulkFailure(null);
      const failures: string[] = [];
      let done = 0;
      const step = (): Promise<void> => {
        const id = ids[done];
        if (id === undefined) return Promise.resolve();
        return setFindingStatus(id, status)
          .catch((reason: unknown) => {
            failures.push(`#${id}：${reason instanceof Error ? reason.message : String(reason)}`);
          })
          .then(() => {
            done += 1;
            return step();
          });
      };
      step()
        .then(() => {
          setBulkBusy(false);
          setBulkFailure(failures.length === 0 ? null : `${failures.length} 条失败（${failures[0]}）`);
          const ok = ids.length - failures.length;
          toast(
            failures.length === 0
              ? `已把 ${ok} 条发现改为「${findingStatusLabel(status)}」`
              : `已改 ${ok} 条，${failures.length} 条失败`,
          );
          setBulkStatus(null);
          setSelectedIds(new Set());
          reloadAll();
        });
    },
    [bulkBusy, reloadAll, selectedIds],
  );

  const openExport = useCallback((): void => setExportOpen(true), []);

  const exportFilters = useMemo(
    () => ({
      query: applied,
      sort: filters.sort,
      severity: filters.severity,
      status: filters.status,
      vulnclass: filters.vulnclass,
      task: filters.task,
    }),
    [applied, filters.sort, filters.severity, filters.status, filters.vulnclass, filters.task],
  );

  const statCards = useMemo(
    () => [
      { key: "total", label: "发现总数", value: stats.stats?.total, tone: css.statNeutral },
      { key: "pending", label: "待处理", value: stats.stats?.pending, tone: css.statWarn },
      { key: "critical", label: "严重", value: stats.stats?.critical, tone: css.statDanger },
      { key: "high", label: "高危", value: stats.stats?.high, tone: css.statDanger },
      { key: "medium", label: "中危", value: stats.stats?.medium, tone: css.statWarn },
      { key: "low", label: "低危", value: stats.stats?.low, tone: css.statNeutral },
    ],
    [stats.stats],
  );

  if (openId !== null) {
    return <FindingDetailView findingId={openId} onBack={closeFinding} />;
  }

  return (
    <>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>发现库</h1>
          <p className={css.lead}>跨任务漏洞汇总：按严重度、状态、类型与任务筛选。</p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="发现页头动作">
          <Button
            variant="outline"
            size="sm"
            onClick={reloadAll}
            title="重新读取列表与统计"
            data-data-page-action="refresh"
          >
            <IconRefreshOutlineRegular size={13} />
            刷新
          </Button>
        </div>
      </header>

      <div
        className={css.stats}
        role="group"
        aria-label="发现统计"
        data-findings-stats={stats.phase}
        data-data-page-summary="findings"
      >
        {statCards.map((card) => (
          <div key={card.key} className={css.statCard} data-findings-stat={card.key}>
            <span className={css.statLabel}>{card.label}</span>
            <span className={`${css.statValue} ${card.tone}`} data-findings-stat-value={card.key}>
              {card.value === undefined ? "—" : card.value}
            </span>
          </div>
        ))}
      </div>

      <div className={css.toolbar} role="toolbar" aria-label="发现列表筛选" data-data-page-toolbar="findings">
        <label className={css.search}>
          <IconSearchOutlineRegular size={13} className={css.searchIcon} />
          <input
            type="search"
            className={css.searchInput}
            value={filters.query}
            placeholder="搜索漏洞名称、类型或摘要"
            aria-label="搜索发现"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => update({ query: event.currentTarget.value })}
            data-data-page-filter="findings"
          />
        </label>
        <span className={css.filter}>
          <span>严重度</span>
          <SelectMenu
            value={filters.severity}
            ariaLabel="按严重度筛选"
            options={[
              { value: "all", label: "全部" },
              ...SEVERITY_FILTER_ORDER.map((severity) => ({ value: severity, label: severityLabel(severity) })),
            ]}
            onChange={(next) => update({ severity: next as SeverityFilter })}
          />
        </span>
        <span className={css.filter}>
          <span>状态</span>
          <SelectMenu
            value={filters.status}
            ariaLabel="按处理状态筛选"
            options={[
              { value: "all", label: "全部状态" },
              ...STATUS_FILTER_ORDER.map((status) => ({ value: status, label: findingStatusLabel(status) })),
            ]}
            onChange={(next) => update({ status: next as "all" | FindingStatus })}
          />
        </span>
        <span className={css.filter}>
          <span>类型</span>
          <SelectMenu
            value={filters.vulnclass}
            ariaLabel="按漏洞类型筛选"
            options={[
              { value: "all", label: "全部类型" },
              ...(stats.stats?.vulnclasses ?? []).map((vulnclass) => ({ value: vulnclass, label: vulnclass })),
            ]}
            onChange={(next) => update({ vulnclass: next })}
          />
        </span>
        <span className={css.filter}>
          <span>任务</span>
          <SelectMenu
            value={filters.task}
            ariaLabel="按所属任务筛选"
            options={[
              { value: "all", label: "全部任务" },
              { value: UNASSIGNED_TASK, label: "未关联 / 任务已删除" },
              ...(stats.stats?.tasks ?? []).map((task) => {
                const id = String(task.id);
                const label = task.name || task.description || `任务 #${id}（已删除）`;
                return { value: id, label: `${label}（${task.count}）` };
              }),
            ]}
            onChange={(next) => update({ task: next })}
          />
        </span>
        <span className={css.filter}>
          <span>排序</span>
          <SelectMenu
            value={filters.sort}
            ariaLabel="排序"
            options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(next) => update({ sort: next as FindingsSort })}
          />
        </span>
        <span className={css.count} data-data-page-count={state.phase === "ready" ? String(state.total) : ""}>
          {state.phase === "ready" ? `${state.total} 条` : state.phase === "loading" ? "读取中…" : "读取失败"}
        </span>
      </div>

      <div className={css.viewBar} role="group" aria-label="发现视图切换" data-findings-view={view}>
        <FilterBar<FindingsView>
          id="findings-view"
          label="发现视图"
          value={view}
          options={FINDINGS_VIEW_OPTIONS}
          onChange={changeView}
        />
        <span className={css.viewHint}>
          {view === "flat"
            ? "平铺：跨任务逐条列出，可按严重度 / 状态 / 类型 / 任务筛选。"
            : view === "grouped"
              ? "按任务分组：每组显示条数与严重等级分布，可逐个展开查看组内发现。"
              : "按资产：左侧选资产（含子树），右侧只列出该资产下的发现。"}
        </span>
      </div>

      <div className={css.bulkWrap}>
        <FindingsBulkBar
          selectedCount={selectedIds.size}
          pageCount={pageIds.length}
          pageAllSelected={pageAllSelected}
          busy={bulkBusy}
          failure={bulkFailure}
          onSelectPage={selectPage}
          onClear={clearSelected}
          onBulkStatus={setBulkStatus}
          onExport={openExport}
        />
      </div>

      {view === "grouped" ? (
        <div id="findings-view-grouped-panel" role="tabpanel" aria-labelledby="findings-view-grouped">
          <GroupedFindings
            query={applied}
            sort={filters.sort}
            filters={{
              severity: filters.severity,
              status: filters.status,
              vulnclass: filters.vulnclass,
              task: filters.task,
            }}
            seed={filterSeed}
            onOpen={openFinding}
          />
        </div>
      ) : null}

      {view === "asset" ? (
        <div
          id="findings-view-asset-panel"
          role="tabpanel"
          aria-labelledby="findings-view-asset"
          data-findings-asset-scope={assetScope === "" ? "all" : assetScope}
        >
          <div className={css.assetLayout}>
            <FindingsAssetTree
              nodes={tree.nodes}
              selected={assetScope}
              findingTotal={tree.findingTotal}
              truncated={tree.truncated}
              droppedKinds={tree.droppedKinds}
              loading={tree.phase === "loading"}
              onSelect={selectAssetScope}
              onRefresh={tree.reload}
            />
            <div className={css.assetMain}>
              {tree.phase === "offline" ? (
                <div className={css.stateError} role="alert" data-findings-tree-state="offline">
                  <span>资产树读取失败（{tree.error}）</span>
                  <Button variant="outline" size="sm" onClick={tree.reload} data-findings-tree-action="retry">
                    重试
                  </Button>
                </div>
              ) : null}
              {tree.phase === "loading" && tree.nodes.length === 0 ? (
                <div className={css.state} data-findings-tree-state="loading">
                  资产树读取中…
                </div>
              ) : null}
              <nav className={css.crumbBar} aria-label="资产面包屑" data-findings-breadcrumb="">
                <button
                  type="button"
                  className={
                    assetScope === "" ? `${css.crumbBtn} ${css.crumbCurrent}` : css.crumbBtn
                  }
                  onClick={() => selectAssetScope("")}
                  data-findings-crumb="all"
                >
                  全部资产
                </button>
                {assetPath.map((node) => (
                  <span key={node.key} className={css.crumbSep}>
                    <IconChevronRightOutlineRegular size={10} />
                    <button
                      type="button"
                      className={
                        node.key === assetScope ? `${css.crumbBtn} ${css.crumbCurrent}` : css.crumbBtn
                      }
                      title={node.label}
                      onClick={() => selectAssetScope(node.key)}
                      data-findings-crumb={node.key}
                    >
                      {node.display}
                    </button>
                  </span>
                ))}
                <span className={css.crumbCount}>
                  {state.phase === "ready" ? `${state.total} 条` : state.phase === "loading" ? "读取中…" : "读取失败"}
                </span>
              </nav>
            </div>
          </div>
        </div>
      ) : null}

      {view === "flat" ? (
        <div id="findings-view-flat-panel" role="tabpanel" aria-labelledby="findings-view-flat">
      {state.phase === "loading" ? (
        <div className={css.state} data-findings-state="loading">
          加载中…
        </div>
      ) : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} data-findings-state="offline">
          <span>未连接后端（{state.error}）</span>
          <Button variant="outline" size="sm" onClick={state.reload} data-findings-action="retry">
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && state.items.length === 0 ? (
        <div className={css.empty} data-findings-state="empty">
          <IconShieldOutlineRegular size={20} />
          <span className={css.emptyTitle}>{applied === "" ? "还没有发现" : "没有匹配的发现"}</span>
          <span className={css.emptyText}>
            {applied === ""
              ? "任务执行确认漏洞后会出现在这里：按严重度分档，并保留所属任务与时间。"
              : "换个关键词或筛选条件，或清空搜索后重试。"}
          </span>
        </div>
      ) : null}

      {state.phase === "ready" && state.items.length > 0 ? (
        <ul className={css.list} data-findings-rows="">
          {state.items.map((finding) => {
            const rowId = findingRowId(finding);
            const id = String(finding.finding_id ?? finding.id);
            const title = findingTitle(finding);
            const retest = retests[id];
            const checked = selectedIds.has(rowId);
            return (
              <li
                key={finding.finding_id ?? finding.id}
                className={checked ? `${css.row} ${css.rowSelected}` : css.row}
                role="button"
                tabIndex={0}
                aria-label={`打开发现详情：${title}`}
                data-data-page-row=""
                data-finding-id={id}
                data-finding-severity={finding.severity}
                data-findings-selected={checked ? "true" : undefined}
                data-findings-open=""
                onClick={() => openFinding(id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openFinding(id);
                }}
              >
                <span className={css.selectCell}>
                  <label
                    className={css.rowCheck}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`勾选：${title}`}
                      onChange={(event) => toggleSelected(rowId, event.currentTarget.checked)}
                      data-findings-select={id}
                    />
                  </label>
                </span>
                <span className={`${css.badge} ${severityClass(finding.severity)}`}>
                  {severityLabel(finding.severity)}
                </span>
                <span className={css.rowMain}>
                  <span className={css.rowTitle}>{title}</span>
                  <span className={css.rowSub}>{finding.summary || finding.vulnclass}</span>
                </span>
                <span className={css.rowMeta}>
                  <span className={css.mono}>{finding.vulnclass}</span>
                  <span className={css.status}>{findingStatusLabel(finding.status)}</span>
                  {retest === undefined ? null : (
                    <span className={css.retest} data-findings-retest={id} title="该发现正在复测会话中运行">
                      复测中
                    </span>
                  )}
                  <span className={css.time}>{formatFindingTime(finding.ts)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {state.phase === "ready" ? (
        <footer className={css.pager} data-data-page-pager="findings">
          <span data-findings-page-info="">
            第 {filters.page} / {pageCount} 页 · 共 {state.total} 条
          </span>
          <span className={css.pagerActions}>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() => update({ page: Math.max(1, filters.page - 1) })}
              data-findings-page="prev"
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page >= pageCount}
              onClick={() => update({ page: Math.min(pageCount, filters.page + 1) })}
              data-findings-page="next"
            >
              下一页
            </Button>
          </span>
        </footer>
      ) : null}
        </div>
      ) : null}

      {bulkStatus === null ? null : (
        <FindingBulkStatusDialog
          count={selectedIds.size}
          status={bulkStatus}
          busy={bulkBusy}
          failure={bulkFailure}
          onCancel={() => setBulkStatus(null)}
          onConfirm={() => runBulkStatus(bulkStatus)}
        />
      )}

      {exportOpen ? (
        <FindingsExportDialog
          selectedCount={selectedIds.size}
          filteredTotal={state.phase === "ready" ? state.total : 0}
          filters={exportFilters}
          selectedIds={[...selectedIds]}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </>
  );
}
