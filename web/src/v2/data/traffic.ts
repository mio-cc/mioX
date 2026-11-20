"use client";

/** Adapter for the captured traffic list and its server-side search. */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { TrafficResp } from "@/lib/types";

export type TrafficPhase = "loading" | "ready" | "offline";

export interface TrafficState {
  phase: TrafficPhase;
  data: TrafficResp | null;
  error: string | null;
  reload: () => void;
}

/**
 * Read one page of captured exchanges.
 * The filter is the backend's broad search box (`q`): it matches metadata
 * columns or captured request/response text (`traffic/traffic.go:820`).
 * @param query - search text from the page filter ("" lists everything).
 * @param size - page size.
 * @returns phase, payload (includes `enabled` and `exchanges`) and a reload.
 */
export function useTraffic(query = "", size = 200): TrafficState {
  const [phase, setPhase] = useState<TrafficPhase>("loading");
  const [data, setData] = useState<TrafficResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .traffic(0, size, "", "", query)
      .then((value) => {
        if (!alive) return;
        setData(value);
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
  }, [query, size, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, data, error, reload };
}

/** 状态码桶（旧页 traffic/page.tsx:112 STATUS_BUCKETS）。 */
export const STATUS_BUCKETS = ["2xx", "3xx", "4xx", "5xx"] as const;

/** 服务端可排序字段（旧页 traffic/page.tsx:106 SORT_FIELDS）。 */
export const SORT_FIELDS = ["ts", "status", "resp_len"] as const;

export type TrafficSortField = (typeof SORT_FIELDS)[number];
export type TrafficSortDirection = "asc" | "desc";

/** 每页条数选项（旧页同口径）。 */
export const TRAFFIC_PAGE_SIZES = [50, 100, 200] as const;

/**
 * 一页流量的完整筛选参数（A08）。
 * `page` 为 1 基页码；其余空串 / `all` 表示不过滤。
 */
export interface TrafficPageQuery {
  page: number;
  size: number;
  host: string;
  method: string;
  q: string;
  body: string;
  path: string;
  status: string;
  respMin: string;
  respMax: string;
  sort: TrafficSortField;
  order: TrafficSortDirection;
}

/**
 * 读取一页流量（A08：方法 / 状态桶 / 高级筛选 / 排序 / 分页全部下推到后端）。
 * @param query - 完整筛选参数。
 * @returns 阶段、payload（含 enabled / total / exchanges）、错误与重新读取。
 */
export function useTrafficPage(query: TrafficPageQuery): TrafficState {
  const [phase, setPhase] = useState<TrafficPhase>("loading");
  const [data, setData] = useState<TrafficResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .traffic(query.page - 1, query.size, query.host, query.method, query.q, {
        body: query.body,
        path: query.path,
        status: query.status,
        respMin: query.respMin,
        respMax: query.respMax,
        sort: query.sort,
        order: query.order,
      })
      .then((value) => {
        if (!alive) return;
        setData(value);
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
  }, [query.page, query.size, query.host, query.method, query.q, query.body, query.path, query.status, query.respMin, query.respMax, query.sort, query.order, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, data, error, reload };
}

/** 按目标管理：host + 包数（A09）。 */
export interface TrafficHostsState {
  phase: TrafficPhase;
  hosts: { host: string; count: number }[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取流量里出现过的目标 host 及包数。
 * @returns 阶段、host 列表、错误与重新读取。
 */
export function useTrafficHosts(): TrafficHostsState {
  const [phase, setPhase] = useState<TrafficPhase>("loading");
  const [hosts, setHosts] = useState<{ host: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .trafficHosts()
      .then((value) => {
        if (!alive) return;
        // 后端在「一条流量都没有」时返回 {"hosts":null}（server 侧 nil slice），
        // 直接塞进 state 会让 `[...hosts]` 抛 TypeError 把整页打崩，这里归一为空数组。
        const rows = Array.isArray(value?.hosts) ? value.hosts : [];
        setHosts(rows.map((row) => ({ host: row.host ?? "", count: Number(row.count ?? 0) })));
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
  return { phase, hosts, error, reload };
}

/**
 * 删除某个目标的全部流量。
 * @param host - 目标 host。
 * @returns 删除条数。
 */
export function deleteTrafficHost(host: string): Promise<{ deleted: number }> {
  return api.trafficDeleteHost(host);
}

/**
 * 批量删除多个目标的全部流量。
 * @param hosts - 目标 host 列表。
 * @returns 删除条数。
 */
export function deleteTrafficHosts(hosts: string[]): Promise<{ deleted: number }> {
  return api.trafficDeleteHosts(hosts);
}

/**
 * 清空全部流量记录（后端会压实索引；已绑定到漏洞的证据保留）。
 * @returns 删除条数与回收字节数。
 */
export function deleteAllTraffic(): Promise<{ deleted: number; reclaimed: number }> {
  return api.trafficDeleteAll();
}

/**
 * 读取一条流量的完整请求/响应（A10 详情抽屉）。
 * @param id - 流量 id。
 * @returns 请求与响应原文。
 */
export function trafficExchange(id: string): Promise<{ req: string; resp: string }> {
  return api.trafficExchange(id);
}
