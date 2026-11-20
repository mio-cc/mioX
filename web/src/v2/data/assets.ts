"use client";

/** Adapter for the asset inventory list and its server-side DSL search. */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Asset, NewAssetType } from "@/lib/types";

export type AssetsPhase = "loading" | "ready" | "offline";

export interface AssetsState {
  phase: AssetsPhase;
  assets: Asset[];
  total: number;
  error: string | null;
  reload: () => void;
}

/** Asset types in the order the inventory page lists them. */
const ASSET_TYPES: NewAssetType[] = ["root_domain", "subdomain", "ip", "service", "app", "endpoint"];

/**
 * Read the whole inventory, one request per populated type: the list endpoint
 * defaults an absent `type` to root domains only (`server/assets.go:370-378`), so
 * a single unfiltered call would hide every other asset class.
 */
async function listAllAssets(limit: number): Promise<{ assets: Asset[]; total: number }> {
  const counts = await api.assetCounts();
  const types = ASSET_TYPES.filter((type) => (counts[type] ?? 0) > 0);
  const pages = await Promise.all(types.map((type) => api.assets(type, limit, 0)));
  return {
    assets: pages.flatMap((page) => page.assets),
    total: types.reduce((sum, type) => sum + (counts[type] ?? 0), 0),
  };
}

/**
 * Read the asset inventory, filtered by a backend DSL query when one is given.
 * @param query - DSL expression from the page filter ("" lists every asset).
 * @param limit - page size of each request.
 * @param enabled - skip the requests while another tab owns the table (defaults
 *   to true, so the W7 toolbar keeps its behaviour).
 * @returns phase, rows, matching total and a reload callback.
 */
export function useAssets(query = "", limit = 200, enabled = true): AssetsState {
  const [phase, setPhase] = useState<AssetsPhase>("loading");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setPhase("loading");
    const load = query === "" ? listAllAssets(limit) : api.searchAssets(query, "", limit, 0);
    load
      .then((value) => {
        if (!alive) return;
        // both paths wrap the rows: { assets, total }.
        setAssets(value.assets);
        setTotal(value.total);
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
  }, [query, limit, enabled, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, assets, total, error, reload };
}
