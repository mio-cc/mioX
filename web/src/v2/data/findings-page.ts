"use client";

/**
 * Adapter for the whole-page findings list (`/v2/findings` and
 * `/v2/shell?page=findings`).
 *
 * The right panel keeps its own adapter (`v2/data/findings.ts`, `findings-map.ts`)
 * for the compact tab; this one owns the server-paged view: page cursor, page
 * size, backend search (`q`) and the two backend sort keys. The body only sees
 * rows and labels, never `@/lib/api`.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type {
  ActiveFindingRetest,
  Finding,
  FindingAssetNode,
  FindingAssetTree,
  FindingGroup,
  FindingGroupsPage,
  FindingStats,
  FindingStatus,
} from "@/lib/types";

/** Rows per page of the server-paged list (B2: 25 per page). */
export const FINDINGS_PAGE_SIZE = 25;

/** Backend sort keys accepted by `GET /exploration/findings?sort=`. */
export type FindingsSort = "severity" | "time";

/**
 * Task filter value the backend reads as "no task, or the task was deleted".
 * Mirrors the old page's sentinel (`function/findings/_components/findings-table.tsx:57`);
 * `GET /exploration/findings?task_id=__unassigned__` returns those rows.
 */
export const UNASSIGNED_TASK = "__unassigned__";

/** Severity values the toolbar can filter by, most severe first (B4). */
export const SEVERITY_FILTER_ORDER = ["critical", "high", "medium", "low"] as const;

/** Every disposition status the backend accepts as `?status=` (B9: all 9 + 全部). */
export const STATUS_FILTER_ORDER: readonly FindingStatus[] = [
  "pending",
  "in_progress",
  "confirmed",
  "resolved",
  "fixed",
  "false_positive",
  "ignored",
  "duplicate",
  "risk_accepted",
];

/** Running-retest poll cadence; one light request covers every row on screen. */
export const ACTIVE_RETESTS_POLL_MS = 5_000;

export type FindingsPhase = "loading" | "ready" | "offline";

export interface FindingsState {
  phase: FindingsPhase;
  items: Finding[];
  total: number;
  error: string | null;
  reload: () => void;
}

export interface FindingsQuery {
  /** 1-based page cursor. */
  page: number;
  /** Backend search text (empty lists everything). */
  query: string;
  /** `time` = newest first, `severity` = critical first then newest. */
  sort: FindingsSort;
  /** `all` = no severity filter; the backend omits the param (B4). */
  severity?: "all" | (typeof SEVERITY_FILTER_ORDER)[number];
  /** `all` = no status filter (B9). */
  status?: "all" | FindingStatus;
  /** `all` = no vulnclass filter; any other value is one of `stats.vulnclasses` (B10). */
  vulnclass?: string;
  /** `all`, `UNASSIGNED_TASK` or a task id; the backend reads it as `task_id` (B11). */
  task?: string;
  /**
   * 资产树节点 key（`a:` / `c:` / `r:` / `__none__`），选中即该节点整棵子树；
   * 只有「按资产」视图会传（C08，旧页 `findings/page.tsx:317`）。空 / 不传 = 不按资产筛。
   */
  assetScope?: string;
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: "严重",
  high: "高危",
  medium: "中危",
  low: "低危",
  info: "提示",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  in_progress: "处理中",
  confirmed: "已确认",
  resolved: "已处理",
  fixed: "已修复",
  false_positive: "误报",
  ignored: "已忽略",
  duplicate: "重复",
  risk_accepted: "风险接受",
};

/**
 * Read one page of the global findings table.
 * @param query - page cursor, backend search text, sort key, the four filters and
 *   the optional asset-tree scope (only the 按资产 view passes it, C08).
 * @returns phase, page rows, matching total and a reload callback.
 */
export function useFindingsPage({
  page,
  query,
  sort,
  severity = "all",
  status = "all",
  vulnclass = "all",
  task = "all",
  assetScope,
}: FindingsQuery): FindingsState {
  const [phase, setPhase] = useState<FindingsPhase>("loading");
  const [items, setItems] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .findingsPage({
        page,
        pageSize: FINDINGS_PAGE_SIZE,
        query: query || undefined,
        sort,
        severity,
        status,
        vulnclass,
        task,
        assetScope,
      })
      .then((res) => {
        if (!alive) return;
        setItems(res.items ?? []);
        setTotal(res.total ?? 0);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [page, query, sort, severity, status, vulnclass, task, assetScope, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

/**
 * Localized severity label.
 * @param severity - backend severity value.
 * @returns the label, or the raw value when the backend adds a new one.
 */
export function severityLabel(severity: string): string {
  return SEVERITY_LABEL[severity] ?? severity;
}

/**
 * Localized disposition-status label.
 * @param status - backend finding status.
 * @returns the label, or the raw value when the backend adds a new one.
 */
export function findingStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * Row title: the vuln name when the finding has one, else its class.
 * @param finding - backend finding.
 * @returns the primary text of the row.
 */
export function findingTitle(finding: Finding): string {
  const name = finding.name ?? "";
  return name !== "" ? name : finding.vulnclass;
}

/**
 * Compact timestamp for the row meta line.
 * @param ts - ISO timestamp from the backend.
 * @returns `MM-DD HH:mm`, or the raw value when it cannot be parsed.
 */
export function formatFindingTime(ts: string): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return ts;
  return at.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Full timestamp for the detail status panel (the list keeps `formatFindingTime`).
 * @param ts - ISO timestamp from the backend.
 * @returns `YYYY-MM-DD HH:mm:ss`, or the raw value when it cannot be parsed.
 */
export function formatFindingDateTime(ts: string): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return ts;
  return at.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export type FindingsStatsPhase = "loading" | "ready" | "offline";

export interface FindingsStatsState {
  phase: FindingsStatsPhase;
  /** Last successful aggregate snapshot; null before the first success. */
  stats: FindingStats | null;
  error: string | null;
  reload: () => void;
}

/**
 * Whole-table aggregate behind the statistics strip and the vulnclass/task
 * option lists (B8/B10/B11). It is independent of the current page, so the
 * numbers stay the table-wide truth while the list pages.
 * @returns phase, last aggregate snapshot and a reload callback.
 */
export function useFindingStats(): FindingsStatsState {
  const [phase, setPhase] = useState<FindingsStatsPhase>("loading");
  const [stats, setStats] = useState<FindingStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .findingStats()
      .then((next) => {
        if (!alive) return;
        setStats(next);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, stats, error, reload };
}

/**
 * 单条改处置状态的第二把句柄（C07 批量改状态用）。
 * 后端没有批量改状态的接口：`api.ts` 里 grep `batch` 只有任务分类/任务控制/归档/
 * 会话删除四处，没有任何 `findings/batch`；`ARTEX/server/server.go` 里也没有对应路由
 * （唯一的批量写是 `GET /api/exploration/findings/export`，server.go:805）。
 * 所以「批量」只能逐条调用已有的 `api.setFindingStatus`（api.ts:760，
 * `PATCH /exploration/findings/{id}`，成功返回整行）。这里只做一对一转发，
 * 不重试、不吞错误、不做乐观更新（总表 §5.3）。
 * @param id - findings 表的行 id（`Finding.finding_id`，取不到时退回 `Finding.id`）。
 * @param status - 目标处置状态。
 * @returns 后端返回的整行。
 */
export function setFindingStatus(id: string, status: FindingStatus): Promise<Finding> {
  return api.setFindingStatus(id, status);
}

export type FindingsExportFormat = "md-single" | "md-zip" | "csv" | "json";

export type FindingsExportScope = "filtered" | "all" | "selected";

export interface FindingsExportOptions {
  format: FindingsExportFormat;
  scope: FindingsExportScope;
  /** `scope=filtered` 时的筛选条件（不含分页），直接交给后端导出全部命中行。 */
  filters?: Omit<FindingsQuery, "page">;
  /** `scope=selected` 时的行 id 列表（`finding_id`）。 */
  ids?: string[];
}

/**
 * 导出发现（`api.exportFindings`，api.ts:654-686）。
 * 后端按同一份筛选条件导出「全部命中行」而不是当前页：`server.go:2228-2260` 只读
 * `scope`/`format`/筛选参数，`ListFindingsForExport(filter, ids)` 不分页，
 * 所以「导出当前筛选」= 全部筛选结果，不是当前页。
 * 文件名取后端 `Content-Disposition`（api.ts:674-677）。本函数只转发，
 * 不做前端 CSV 拼接、不新增后端接口。
 * @param opts - 格式、范围、筛选或勾选 id。
 * @returns 下载完成后 resolve；失败时抛出带后端信息的 Error。
 */
export function exportFindings(opts: FindingsExportOptions): Promise<void> {
  return api.exportFindings(opts);
}

/**
 * Poll the running-retest snapshot (B24). One light request covers every row on
 * screen, so the list never fetches a retest history per finding. A failed poll
 * keeps the previous snapshot: the badge is advisory, and a transient backend
 * hiccup must not replace a working list with an error state.
 * @returns running retests keyed by finding id.
 */
export function useActiveFindingRetests(): Readonly<Record<string, ActiveFindingRetest>> {
  const [byFinding, setByFinding] = useState<Record<string, ActiveFindingRetest>>({});

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = (): void => {
      api
        .activeFindingRetests()
        .then((rows) => {
          if (disposed) return;
          setByFinding(Object.fromEntries(rows.map((row) => [row.finding_id, row])));
          timer = setTimeout(poll, ACTIVE_RETESTS_POLL_MS);
        })
        .catch(() => {
          if (disposed) return;
          timer = setTimeout(poll, ACTIVE_RETESTS_POLL_MS);
        });
    };
    poll();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return byFinding;
}

/* ---- C08 分组视图与资产视图（P2:B7 / P2:B20–B22） ------------------------- */

/** 「平铺 / 按任务分组 / 按资产」三视图的取值（旧页 `findings/page.tsx:74` 的 `FindingView`）。 */
export type FindingsView = "flat" | "grouped" | "asset";

/** 三视图的分段选项（旧页 :828-830 的三个 tab，顺序一致）。 */
export const FINDINGS_VIEW_OPTIONS: ReadonlyArray<{ value: FindingsView; label: string }> = [
  { value: "flat", label: "平铺" },
  { value: "grouped", label: "按任务分组" },
  { value: "asset", label: "按资产" },
];

/** 分组视图的分组分页每页条数上限（旧页 :1127 的 `pageSizeOptions=[5,10,20]`，默认 10）。 */
export const FINDING_GROUPS_PAGE_SIZE = 10;

/** 分组视图里每组展开后的组内分页每页条数（旧页 :472 / :1030 的默认 `pageSize` 10）。 */
export const FINDING_GROUP_ROWS_PAGE_SIZE = 10;

/** 资产树里「全部资产」这一行的 key：不传 `assetScope` 即全部。 */
export const ASSET_TREE_ALL_KEY = "";

/**
 * 分组数组里一组的稳定 key：任务 id，未关联 / 任务已删除用 `UNASSIGNED_TASK`
 * （旧页 `findings/page.tsx:118-120` 的 `findingGroupKey`）。
 * @param group - 后端返回的一个分组。
 * @returns 该组的 key。
 */
export function findingGroupKey(group: FindingGroup): string {
  return group.task_id === null ? UNASSIGNED_TASK : String(group.task_id);
}

/**
 * 分组的标题：有任务名时带任务编号，否则只有编号，未关联时给说明文案
 * （旧页 `findings/page.tsx:1051-1056`）。
 * @param group - 后端返回的一个分组。
 * @returns 组头标题。
 */
export function findingGroupTitle(group: FindingGroup): string {
  if (group.task_id === null) return "未关联 / 任务已删除";
  const name = group.task_name?.trim() ?? "";
  if (name !== "") return `${name}（任务 #${group.task_id}）`;
  return `任务 #${group.task_id}`;
}

export type FindingGroupsPhase = "loading" | "ready" | "offline";

export interface FindingGroupsState {
  phase: FindingGroupsPhase;
  items: FindingGroup[];
  /** 分组总数（= 有发现的 task 数），驱动分组分页条。 */
  total: number;
  /** 当前筛选下的发现总条数（后端 `finding_total`）。 */
  findingTotal: number;
  error: string | null;
  reload: () => void;
}

/**
 * 「按任务分组」页的查询参数：分组页游标 + 可选的每页组数 + 本页四类筛选。
 * 与平铺列表同一份筛选，不含 `assetScope`（分组视图不按资产筛）。
 */
export interface FindingGroupsQuery extends Omit<FindingsQuery, "assetScope"> {
  /** 每页组数（5/10/20，默认 `FINDING_GROUPS_PAGE_SIZE`）。 */
  pageSize?: number;
}

/**
 * 按任务分组页（`api.findingGroups`，api.ts:643-648）：与平铺列表同一份筛选条件，
 * 服务端按 task 聚合并分页（旧页 `refreshGroups` :371-393）。
 * @param query - 分组分页游标、每页组数与本页的四类筛选。
 * @returns phase / 分组 / 分组总数 / 发现总数 / 错误 / 重读。
 */
export function useFindingGroups({
  page,
  pageSize = FINDING_GROUPS_PAGE_SIZE,
  query,
  sort,
  severity = "all",
  status = "all",
  vulnclass = "all",
  task = "all",
}: FindingGroupsQuery): FindingGroupsState {
  const [phase, setPhase] = useState<FindingGroupsPhase>("loading");
  const [items, setItems] = useState<FindingGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [findingTotal, setFindingTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .findingGroups({
        page,
        pageSize,
        query: query || undefined,
        sort,
        severity,
        status,
        vulnclass,
        task,
      })
      .then((res: FindingGroupsPage) => {
        if (!alive) return;
        setItems(res.items ?? []);
        setTotal(res.total ?? 0);
        setFindingTotal(res.finding_total ?? 0);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [page, pageSize, query, sort, severity, status, vulnclass, task, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, findingTotal, error, reload };
}

export type FindingGroupRowsPhase = "loading" | "ready" | "offline";

export interface FindingGroupRowsState {
  phase: FindingGroupRowsPhase;
  items: Finding[];
  total: number;
  error: string | null;
  reload: () => void;
}

export interface FindingGroupRowsQuery {
  /** 组 key（`findingGroupKey`）；`UNASSIGNED_TASK` 表示未关联 / 任务已删除。 */
  taskKey: string;
  page: number;
  query: string;
  sort: FindingsSort;
  severity?: "all" | (typeof SEVERITY_FILTER_ORDER)[number];
  status?: "all" | FindingStatus;
  vulnclass?: string;
}

/**
 * 一组展开后的组内发现（旧页 `loadGroup` :395-461）：同一份筛选条件 + 该组的 task，
 * 走普通分页列表接口 `api.findingsPage`（api.ts:637-642），组内自带页码与 10 条/页。
 * @param q - 组 key、组内页码与筛选条件。
 * @returns phase / 组内行 / 组内命中总数 / 错误 / 重读。
 */
export function useFindingGroupRows({
  taskKey,
  page,
  query,
  sort,
  severity = "all",
  status = "all",
  vulnclass = "all",
}: FindingGroupRowsQuery): FindingGroupRowsState {
  const [phase, setPhase] = useState<FindingGroupRowsPhase>("loading");
  const [items, setItems] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .findingsPage({
        page,
        pageSize: FINDING_GROUP_ROWS_PAGE_SIZE,
        query: query || undefined,
        sort,
        severity,
        status,
        vulnclass,
        task: taskKey,
      })
      .then((res) => {
        if (!alive) return;
        setItems(res.items ?? []);
        setTotal(res.total ?? 0);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [taskKey, page, query, sort, severity, status, vulnclass, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

export type FindingAssetTreePhase = "loading" | "ready" | "offline";

export interface FindingAssetTreeState {
  phase: FindingAssetTreePhase;
  /** 后端一次取完的节点数组（父子关系在 `parent` 里，不含嵌套 children）。 */
  nodes: FindingAssetNode[];
  /** 未选节点时的发现总数（「全部资产」那一行的计数）。 */
  findingTotal: number;
  /** 后端因资产过多截断了某些层级。 */
  truncated: boolean;
  /** 被截断的层级种类（`FindingAssetKind` 原值）。 */
  droppedKinds: string[];
  error: string | null;
  reload: () => void;
}

/**
 * 「按资产」视图的左侧树（`api.findingAssetTree`，api.ts:649-652）：与列表同一份筛选
 * 条件，但**不**带 `assetScope`（选一个节点就塌成一条链，旧页注释 :346-348）。
 * 树不分页，一次取完；筛选变化或点刷新时重读。
 * @param query - 本页四类筛选与排序（不含分页与资产范围）。
 * @returns phase / 节点 / 发现总数 / 截断信息 / 错误 / 重读。
 */
export function useFindingAssetTree({
  query,
  sort,
  severity = "all",
  status = "all",
  vulnclass = "all",
  task = "all",
}: Omit<FindingsQuery, "page">): FindingAssetTreeState {
  const [phase, setPhase] = useState<FindingAssetTreePhase>("loading");
  const [nodes, setNodes] = useState<FindingAssetNode[]>([]);
  const [findingTotal, setFindingTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [droppedKinds, setDroppedKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .findingAssetTree({
        query: query || undefined,
        sort,
        severity,
        status,
        vulnclass,
        task,
      })
      .then((res: FindingAssetTree) => {
        if (!alive) return;
        setNodes(res.nodes ?? []);
        setFindingTotal(res.finding_total ?? 0);
        setTruncated(res.truncated === true);
        setDroppedKinds(res.dropped_kinds ?? []);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [query, sort, severity, status, vulnclass, task, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, nodes, findingTotal, truncated, droppedKinds, error, reload };
}
