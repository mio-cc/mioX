"use client";

/**
 * Adapter for the paginated asset inventory page (`/v2/assets` and
 * `/v2/shell?page=assets`).
 *
 * `v2/data/assets.ts` keeps the merged "every type at once" snapshot the W7
 * toolbar was built on (that snapshot is what the 全部 tab still shows); this
 * module owns the per-type server pages, the type counters of the tab strip and
 * the read-only company attribution map. The page body only sees rows and
 * labels, never `@/lib/api`.
 *
 * Request shapes follow the Go handler (`server/assets.go:319-390`): `type` picks
 * the asset class, `limit`/`offset` page it and `total` is the full match count;
 * an absent `type` falls back to root domains only (`:370-378`), which is why the
 * tab strip never asks for "all types" in one request.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Asset, Company, NewAssetType } from "@/lib/types";

/** Asset classes of the tab strip, in the old page's tab order (`function/assets/page.tsx:102-110`). */
export const ASSET_TAB_TYPES: readonly NewAssetType[] = [
  "root_domain",
  "ip",
  "subdomain",
  "app",
  "service",
  "endpoint",
];

/** Tab captions, same wording as the old page (`assets/page.tsx:104-109`, `_harness/assets-list.tsx:25-33`). */
const ASSET_TYPE_LABEL: Record<string, string> = {
  root_domain: "根域名",
  ip: "IP",
  subdomain: "子域名",
  app: "应用",
  service: "服务",
  endpoint: "接口",
  company: "企业",
};

/**
 * Display name of an asset class.
 * @param type - backend `type` value.
 * @returns the Chinese caption, or the raw value for an unknown class.
 */
export function assetTypeLabel(type: string): string {
  return ASSET_TYPE_LABEL[type] ?? type;
}

/**
 * Page sizes the pager offers. The old page lists 25/50/100/200
 * (`assets/page.tsx:100`); 10 is added so a small local inventory still has a
 * second page to page through.
 */
export const ASSET_PAGE_SIZES: readonly number[] = [10, 25, 50, 100, 200];

/** Page size the page opens with (the old page starts at 50, `assets/page.tsx:122`). */
export const ASSET_DEFAULT_PAGE_SIZE = 50;

/** Largest page the backend serves (`server/assets.go:314-317`). */
const ASSET_MAX_PAGE_SIZE = 200;

export type AssetsPagePhase = "loading" | "ready" | "offline";

export interface AssetCountsState {
  phase: AssetsPagePhase;
  /** Rows per asset class from `GET /assets/counts`, missing classes read as 0. */
  counts: Record<string, number>;
  /** Sum of every class = the "共 N 项资产" figure (`assets/page.tsx:299-300`). */
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * Read the per-class asset counters that caption the tab strip.
 * @returns phase, counters, their sum and a reload callback.
 */
export function useAssetTypeCounts(): AssetCountsState {
  const [phase, setPhase] = useState<AssetsPagePhase>("loading");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase((current) => (current === "ready" ? current : "loading"));
    api
      .assetCounts()
      .then((value) => {
        if (!alive) return;
        setCounts(value ?? {});
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
  const total = Object.values(counts).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return { phase, counts, total, error, reload };
}

/**
 * Display name of an asset's 归属企业, from the company directory the backend
 * returns for `GET /companies` (`api.ts:608`) joined on the row's `company_id`
 * (`types.ts:237`).
 * @param companies - company rows by id.
 * @param companyId - the row's `company_id`; undefined means unassigned.
 * @returns the company name, "" when the id is missing or unknown to the directory.
 */
export function assetCompanyName(companies: Map<number, Company>, companyId: number | undefined): string {
  if (companyId === undefined) return "";
  return companies.get(companyId)?.name ?? "";
}

/**
 * Row count for a company's 资产数 column: the `asset_count` figure the company
 * endpoint returns (`types.ts:414`, rendered by the old page's 企业 tab at
 * `app/(main)/function/assets/page.tsx:374`).
 * @param companies - company rows by id.
 * @param companyId - the row's `company_id`.
 * @returns the backend count, or null when the company is not in the directory.
 */
export function assetCompanyCount(companies: Map<number, Company>, companyId: number | undefined): number | null {
  if (companyId === undefined) return null;
  const company = companies.get(companyId);
  return company === undefined ? null : company.asset_count;
}

export interface CompanyDirectoryState {
  phase: AssetsPagePhase;
  /** Company rows by id, for the 归属企业 cell (`assets/page.tsx:291-297`). */
  byId: Map<number, Company>;
  /** Every company row in the backend's order (the 企业 tab's table rows). */
  rows: Company[];
  error: string | null;
  reload: () => void;
}

/**
 * Read the companies the asset rows attribute to (read-only: company CRUD is
 * P2-5).
 * @returns phase, the company map, the company rows and a reload callback.
 */
export function useCompanyDirectory(): CompanyDirectoryState {
  const [phase, setPhase] = useState<AssetsPagePhase>("loading");
  const [byId, setById] = useState<Map<number, Company>>(() => new Map());
  const [rows, setRows] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase((current) => (current === "ready" ? current : "loading"));
    api
      .companies()
      .then((value) => {
        if (!alive) return;
        const next = new Map<number, Company>();
        const list = value ?? [];
        for (const company of list) next.set(company.id, company);
        setById(next);
        setRows(list);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        // Attribution is decoration: a failed read must not blank the inventory.
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, byId, rows, error, reload };
}

export interface AssetPageQuery {
  /** Asset class of the active type tab. */
  type: NewAssetType;
  /** Backend DSL search text; "" lists the class. */
  query: string;
  /** 0-based page cursor. */
  page: number;
  /** Rows per request, capped at {@link ASSET_MAX_PAGE_SIZE}. */
  size: number;
  /** Skip the request while another tab owns the table (defaults to true). */
  enabled?: boolean;
}

export interface AssetPageState {
  phase: AssetsPagePhase;
  assets: Asset[];
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * Read one server-side page of a single asset class.
 * @param query - class, DSL text, page cursor and page size.
 * @returns phase, the page rows, the full match count and a reload callback.
 */
export function useAssetPage({ type, query, page, size, enabled = true }: AssetPageQuery): AssetPageState {
  const [phase, setPhase] = useState<AssetsPagePhase>("loading");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Answers can arrive out of order; only the newest request may write state.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    const limit = Math.min(size, ASSET_MAX_PAGE_SIZE);
    const offset = page * limit;
    setPhase("loading");
    const load = query === "" ? api.assets(type, limit, offset) : api.searchAssets(query, type, limit, offset);
    load
      .then((value) => {
        if (requestRef.current !== request) return;
        setAssets(value.assets);
        setTotal(value.total);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (requestRef.current !== request) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setAssets([]);
        setTotal(0);
        setPhase("offline");
      });
  }, [type, query, page, size, enabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, assets, total, error, reload };
}

/**
 * Delete assets by id (D11: 多选 + 删除已选). The audit only opens the
 * confirmation and cancels — it never sends this request.
 * @param ids - asset ids the confirmation was opened with.
 * @returns how many rows the backend deleted.
 */
export async function deleteAssetsByIds(ids: number[]): Promise<number> {
  const result = await api.deleteAssets(ids);
  return result.deleted;
}
