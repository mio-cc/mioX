"use client";

/**
 * 发现关联流量适配器（对照表 P2:C8、P2:K4）。
 * 旧页面依据：ARTEX/web/src/components/finding-traffic-panel.tsx:90-285（排序/编辑说明/解除绑定）、
 * finding-traffic-panel.tsx 顶部 ROLES 文案。
 * 接口：api.ts:691 findingTraffic、:695 bindFindingTraffic、:700 editFindingTraffic、
 * :711 removeFindingTraffic、:716 orderFindingTraffic、:721 findingTrafficDetail。
 *
 * 写操作都要带上一次读取得到的 `version`（乐观并发控制），成功后用新返回值整体替换本地状态。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { FindingTraffic, FindingTrafficBinding, TrafficEvidenceRef, TrafficEvidenceRole } from "@/lib/types";

/** 证据用途 → 中文（旧页 finding-traffic-panel.tsx ROLES）。 */
export const TRAFFIC_ROLE_LABEL: Record<TrafficEvidenceRole, string> = {
  baseline: "正常对照",
  proof: "漏洞证明",
  verification: "补充验证",
  supporting: "辅助证据",
};

/** 证据用途的展示顺序。 */
export const TRAFFIC_ROLE_ORDER: readonly TrafficEvidenceRole[] = [
  "baseline",
  "proof",
  "verification",
  "supporting",
];

export type FindingTrafficPhase = "loading" | "ready" | "offline";

export interface FindingTrafficState {
  phase: FindingTrafficPhase;
  /** 后端返回的绑定与 version；null 表示还没读成功。 */
  data: FindingTraffic | null;
  error: string | null;
  reload: () => void;
  /** 用写操作返回的新快照替换本地数据（避免多发一次 GET）。 */
  apply: (next: FindingTraffic) => void;
}

/**
 * 读取一个发现的关联流量。
 * @param findingId - 发现 id；null 时不请求。
 * @param contextTask - 可选的上下文任务 id（后端用它决定可见范围）。
 * @returns 阶段、数据、错误、重新读取与本地替换。
 */
export function useFindingTraffic(findingId: string | null, contextTask?: string): FindingTrafficState {
  const [phase, setPhase] = useState<FindingTrafficPhase>("loading");
  const [data, setData] = useState<FindingTraffic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (findingId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .findingTraffic(findingId, contextTask)
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
  }, [findingId, contextTask, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const apply = useCallback((next: FindingTraffic) => {
    setData(next);
    setPhase("ready");
  }, []);
  return { phase, data, error, reload, apply };
}

/**
 * 绑定流量到发现。
 * @param findingId - 发现 id。
 * @param refs - 要绑定的流量引用（traffic_id / 用途 / 说明）。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 新的关联流量快照。
 */
export function bindFindingTraffic(
  findingId: string,
  refs: TrafficEvidenceRef[],
  contextTask?: string,
): Promise<FindingTraffic> {
  return api.bindFindingTraffic(findingId, refs, contextTask);
}

/**
 * 修改一条绑定的用途与说明。
 * @param findingId - 发现 id。
 * @param bindingId - 绑定 id。
 * @param version - 读取时拿到的版本号。
 * @param fields - 新的 role / note。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 新的关联流量快照。
 */
export function editFindingTraffic(
  findingId: string,
  bindingId: string,
  version: number,
  fields: { role: TrafficEvidenceRole; note: string },
  contextTask?: string,
): Promise<FindingTraffic> {
  return api.editFindingTraffic(findingId, bindingId, version, fields, contextTask);
}

/**
 * 解除一条绑定。
 * @param findingId - 发现 id。
 * @param bindingId - 绑定 id。
 * @param version - 读取时拿到的版本号。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 新的关联流量快照。
 */
export function removeFindingTraffic(
  findingId: string,
  bindingId: string,
  version: number,
  contextTask?: string,
): Promise<FindingTraffic> {
  return api.removeFindingTraffic(findingId, bindingId, version, contextTask);
}

/**
 * 重排绑定顺序（按复现顺序组织）。
 * @param findingId - 发现 id。
 * @param bindingIds - 新的完整绑定 id 顺序。
 * @param version - 读取时拿到的版本号。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 新的关联流量快照。
 */
export function orderFindingTraffic(
  findingId: string,
  bindingIds: string[],
  version: number,
  contextTask?: string,
): Promise<FindingTraffic> {
  return api.orderFindingTraffic(findingId, bindingIds, version, contextTask);
}

/**
 * 读取一条绑定的请求/响应正文摘要（查看报文用；正文分页由 A11 的查看器负责）。
 * @param findingId - 发现 id。
 * @param bindingId - 绑定 id。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 绑定 + 请求/响应正文预览。
 */
export function findingTrafficDetail(
  findingId: string,
  bindingId: string,
  contextTask?: string,
): Promise<Awaited<ReturnType<typeof api.findingTrafficDetail>>> {
  return api.findingTrafficDetail(findingId, bindingId, contextTask);
}

// ---------------------------------------------------------------------------
// A11 · 流量证据查看器（对照表 P2:K2）
// 旧页面依据：ARTEX/web/src/components/traffic-evidence-viewer.tsx:16-124。
// 接口：api.ts:725 findingTrafficBody（按 offset 分页读正文）、
// :735 downloadFindingTrafficBody（下载完整正文，浏览器直接存文件）。
// ---------------------------------------------------------------------------

/** 报文两侧。 */
export type TrafficBodySide = "request" | "response";

/**
 * 按 offset 读取一条绑定某一侧的正文分页。
 * @param findingId - 发现 id。
 * @param bindingId - 绑定 id。
 * @param side - 请求或响应。
 * @param offset - 起始字节偏移；首页传 0，之后传上次返回的 next_offset。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 正文分页（content / offset / total / next_offset / truncated / binary）。
 */
export function findingTrafficBody(
  findingId: string,
  bindingId: string,
  side: TrafficBodySide,
  offset: number,
  contextTask?: string,
): Promise<Awaited<ReturnType<typeof api.findingTrafficBody>>> {
  return api.findingTrafficBody(findingId, bindingId, side, offset, contextTask);
}

/**
 * 下载一条绑定某一侧的完整正文（浏览器直接存为文件）。
 * @param findingId - 发现 id。
 * @param bindingId - 绑定 id。
 * @param side - 请求或响应。
 * @param contextTask - 可选的上下文任务 id。
 * @returns 下载完成时 resolve；失败时抛出带后端信息的 Error。
 */
export function downloadFindingTrafficBody(
  findingId: string,
  bindingId: string,
  side: TrafficBodySide,
  contextTask?: string,
): Promise<void> {
  return api.downloadFindingTrafficBody(findingId, bindingId, side, contextTask);
}

// ---------------------------------------------------------------------------
// A12 · 流量选择器（对照表 P2:K1）
// 旧页面依据：ARTEX/web/src/components/traffic-picker-dialog.tsx:52
//   （`alreadyBound = new Set(bound.map((b) => b.snapshot.source_traffic_id))`）。
// 这里只做纯数据整理：把已绑定列表换成「源流量 id」集合，供选择器禁用已绑定行。
// ---------------------------------------------------------------------------

/**
 * 取一组绑定所引用的源流量 id 集合（已是绑定的流量不能再选）。
 * @param bindings - 当前发现已绑定的列表。
 * @returns 源流量 id（snapshot.source_traffic_id）集合。
 */
export function boundTrafficIds(bindings: readonly FindingTrafficBinding[]): Set<string> {
  return new Set(bindings.map((binding) => binding.snapshot.source_traffic_id));
}
