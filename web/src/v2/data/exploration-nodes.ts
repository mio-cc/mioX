"use client";

/**
 * 播报板适配器（会话视图 tab「播报」，对照表 P1:C23、P2:L2）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/broadcast-tab.tsx:37-38（PAGE_SIZES 20/50/100、POLL_MS 8000）、
 * broadcast-tab.tsx:98-126（关系/状态文案）、:456-510（直播位与未读计数）、:558-565（按天分组）。
 * DSH 依据：DSH 无播报板；按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 这里只做取数、轮询与纯函数整理：读 GET /exploration/nodes（api.ts:797，参数见 types.ts:452）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Edge, ExploreKind, TaskNode } from "@/lib/types";

/** 每页条数的可选值（旧页 broadcast-tab.tsx:37）。 */
export const BROADCAST_PAGE_SIZES: readonly number[] = [20, 50, 100];

/** 轮询间隔（旧页 broadcast-tab.tsx:38 的 POLL_MS）。 */
export const BROADCAST_POLL_MS = 8_000;

export type BroadcastPhase = "loading" | "ready" | "offline";

export interface BroadcastQuery {
  /** 1 起的页码（后端分页）。 */
  page: number;
  /** 每页条数，取 `BROADCAST_PAGE_SIZES` 之一。 */
  size: number;
  /** 类型多选；空数组表示不过滤。 */
  kinds: readonly ExploreKind[];
  /** 状态多选；空数组表示不过滤。 */
  states: readonly string[];
  /** 关键词，空串表示不过滤。 */
  q: string;
  /** 排序方向：`desc` 最新在前（创建顺序倒序），`asc` 最早在前。 */
  order: "asc" | "desc";
}

export interface BroadcastPage {
  /** 本页节点，后端顺序原样保留。 */
  items: TaskNode[];
  /** 匹配的总条数。 */
  total: number;
  /** 本页涉及的边。 */
  edges: Edge[];
  /** 边另一端的节点（id → 节点）。 */
  refs: Record<string, TaskNode>;
}

export interface BroadcastState {
  phase: BroadcastPhase;
  /** 成功时为最近一次成功的整页数据，加载中与失败时为 null。 */
  data: BroadcastPage | null;
  error: string | null;
  /** 手动重读一次。 */
  reload: () => void;
}

/**
 * 读一页播报节点，并在页面可见时每 8 秒刷新一次。
 * 轮询失败只保留上一次成功的内容，下一轮自动重试（旧页 broadcast-tab.tsx:513-515）；
 * 页面不可见时（`document.visibilityState`）跳过这一轮。
 * @param taskId - 任务 id；null 时不请求（保持 loading）。
 * @param query - 页码、每页条数、类型/状态多选、关键词与排序。
 * @param live - 是否开启轮询。
 * @returns 阶段、整页数据、错误与手动重读。
 */
export function useBroadcastPage(taskId: string | null, query: BroadcastQuery, live: boolean): BroadcastState {
  const [phase, setPhase] = useState<BroadcastPhase>("loading");
  const [data, setData] = useState<BroadcastPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // 依赖数组元素个数固定：多选数组先拼成稳定字符串再参与比较（§5.2）。
  const kindsKey = query.kinds.join(",");
  const statesKey = query.states.join(",");
  const page = query.page;
  const size = query.size;
  const q = query.q;
  const order = query.order;

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    let rendered = false;
    setPhase("loading");
    setError(null);

    const load = (): void => {
      api
        .explorationNodes(taskId, {
          page,
          size,
          kinds: kindsKey === "" ? [] : (kindsKey.split(",") as ExploreKind[]),
          states: statesKey === "" ? [] : statesKey.split(","),
          q,
          order,
        })
        .then((value) => {
          if (!alive) return;
          rendered = true;
          setData({ items: value.items, total: value.total, edges: value.edges, refs: value.refs });
          setPhase("ready");
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!alive) return;
          if (rendered) return;
          setError(reason instanceof Error ? reason.message : String(reason));
          setPhase("offline");
        });
    };

    load();
    if (!live) {
      return () => {
        alive = false;
      };
    }
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      load();
    }, BROADCAST_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [taskId, page, size, kindsKey, statesKey, q, order, live, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, data, error, reload };
}

export interface NodeRelation {
  /** 关系类型原文（后端 `rel`）。 */
  rel: string;
  /** 对端节点 id。 */
  id: string;
  /** 对端节点；后端 refs 与同页节点里都没有时为 null。 */
  node: TaskNode | null;
}

/**
 * 从本页的边里挑出与某个节点相关的上游/下游。
 * 只读后端返回的 `edges` 与 `refs`，不补造对端（旧页 broadcast-tab.tsx:345-346、540-546）。
 * @param nodeId - 当前行节点 id。
 * @param edges - 本页边。
 * @param index - id → 节点表；同页节点应先并进 `refs` 再传入。
 * @returns 上游（指向本节点）与下游（本节点指出）。
 */
export function broadcastRelations(
  nodeId: string,
  edges: readonly Edge[],
  index: Record<string, TaskNode>,
): { upstream: NodeRelation[]; downstream: NodeRelation[] } {
  const pick = (id: string, rel: string): NodeRelation => ({ rel, id, node: index[id] ?? null });  return {
    upstream: edges.filter((edge) => edge.dst === nodeId).map((edge) => pick(edge.src, String(edge.rel))),
    downstream: edges.filter((edge) => edge.src === nodeId).map((edge) => pick(edge.dst, String(edge.rel))),
  };
}

/**
 * 把本页节点并进 refs，得到「同页 + 邻居」的完整索引（旧页 broadcast-tab.tsx:542-546）。
 * @param page - 本页数据；null 时返回空表。
 * @returns id → 节点。
 */
export function broadcastNodeIndex(page: BroadcastPage | null): Record<string, TaskNode> {
  if (page === null) return {};
  const index: Record<string, TaskNode> = { ...page.refs };
  for (const node of page.items) index[node.id] = node;
  return index;
}

/**
 * 状态过滤器的一个选项。
 * @param value - 传给后端的 `state` 值。
 * @param label - 中文。
 */
export interface BroadcastStateOption {
  readonly value: string;
  readonly label: string;
}

/**
 * 状态过滤档位（取值见 types.ts:420-423 的 Goal/Intent/Finding/Hint State，另加已删除与起点）。
 * 文案照旧页 broadcast-tab.tsx:108-126，与「意图」视图的 `intentStateLabel` 保持一致。
 */
export const BROADCAST_STATE_OPTIONS: readonly BroadcastStateOption[] = [
  { value: "open", label: "待派发" },
  { value: "running", label: "运行中" },
  { value: "paused", label: "已暂停" },
  { value: "done", label: "已完成" },
  { value: "blocked", label: "受阻" },
  { value: "exhausted", label: "已耗尽" },
  { value: "stopped", label: "已停止" },
  { value: "met", label: "已达成" },
  { value: "abandoned", label: "已放弃" },
  { value: "confirmed", label: "已确认" },
  { value: "dismissed", label: "已排除" },
  { value: "active", label: "有效" },
  { value: "consumed", label: "已用" },
  { value: "origin", label: "起点" },
  { value: "deleted", label: "已删除" },
];

const REL_LABEL: Record<string, string> = {
  spawns: "派生",
  derived_from: "意图链",
  yields: "产出",
  proves: "证明",
  covers: "压缩",
};

/**
 * 关系类型中文（旧页 broadcast-tab.tsx:98-104）；未知关系原样返回。
 * @param rel - 后端 `rel`。
 * @returns 中文关系名。
 */
export function broadcastRelLabel(rel: string): string {
  return REL_LABEL[rel] ?? rel;
}

const dayFmt = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" });
const clockFmt = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * 播报时间：日期（按天分组的键）与「时:分:秒」。时间戳解析不了时返回后端原文。
 * @param ts - 后端节点时间。
 * @returns 日期键与时钟文本。
 */
export function broadcastTime(ts: string): { day: string; clock: string } {
  const at = Date.parse(ts);
  if (Number.isNaN(at)) return { day: "未知日期", clock: ts === "" ? "--:--:--" : ts };
  return { day: dayFmt.format(at), clock: clockFmt.format(at) };
}

/**
 * 把节点按日期连续分组（旧页 broadcast-tab.tsx:558-565）。
 * @param nodes - 后端本页节点。
 * @returns 分组，顺序原样保留。
 */
export function groupBroadcastByDay(nodes: readonly TaskNode[]): { day: string; rows: TaskNode[] }[] {
  const groups: { day: string; rows: TaskNode[] }[] = [];
  for (const node of nodes) {
    const day = broadcastTime(node.ts).day;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) last.rows.push(node);
    else groups.push({ day, rows: [node] });
  }
  return groups;
}

export interface BroadcastFresh {
  /** 本轮新出现的节点 id（换流后的第一轮为空）。 */
  freshIds: ReadonlySet<string>;
  /** 离开直播位后新增的条数。 */
  pending: number;
  /** 是否处在直播位（最新在前且第 1 页）。 */
  atLive: boolean;
}

/**
 * 直播位标记与未读计数（旧页 broadcast-tab.tsx:456-510）：
 * 只有「最新在前的第 1 页」每轮刷新列表，其它位置只更新未读数。
 * 换任务 / 换类型 / 换关键词 / 换排序算换流，翻页不算。
 * @param taskId - 任务 id。
 * @param pageData - 当前整页数据；null 时不处理。
 * @param query - 当前查询。
 * @returns 「新」标记集合、未读条数与是否直播位。
 */
export function useBroadcastFresh(
  taskId: string | null,
  pageData: BroadcastPage | null,
  query: BroadcastQuery,
): BroadcastFresh {
  const atLive = query.page === 1 && query.order === "desc";
  const stream = `${taskId ?? ""}|${query.kinds.join(",")}|${query.q}|${query.order}`;
  const seenRef = useRef<Set<string>>(new Set());
  const baselineRef = useRef<number | null>(null);
  const streamRef = useRef("");
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (pageData === null) return;
    const ids = pageData.items.map((node) => node.id);
    if (streamRef.current !== stream) {
      // 换流：清掉「新」标记与未读基线；这一轮只建立基线。
      streamRef.current = stream;
      seenRef.current = new Set(atLive ? ids : []);
      baselineRef.current = atLive ? pageData.total : null;
      setFreshIds(new Set());
      setPending(0);
      return;
    }
    if (atLive) {
      const seen = seenRef.current;
      const fresh = seen.size === 0 ? [] : ids.filter((id) => !seen.has(id));
      seenRef.current = new Set(ids);
      baselineRef.current = pageData.total;
      setFreshIds(new Set(fresh));
      setPending(0);
      return;
    }
    const base = baselineRef.current;
    setPending(base === null ? 0 : Math.max(0, pageData.total - base));
  }, [pageData, stream, atLive]);

  return { freshIds, pending, atLive };
}
