"use client";

/**
 * 右栏「证据」页签的取数适配器（对照表 P1:E8 的证据页签部分，单元 C23）。
 * 旧页面依据：ARTEX/web/src/components/layout/right-panel.tsx:23-31（右栏「证据」页签）、
 * :344-386（`EvidenceTab`：无任务空态、加载态、`发现` 段标题 + 条数、发现行 = 名称 + 严重级 +
 * 状态）、:383（页脚说明「证据在主区发现页看」）。
 * 新实现的口径按 100a-单元卡片 C23：右栏「证据」列的是**当前任务发现已绑定的流量证据**
 * （按角色分组，显示 method/status/url），点行跳到 `?page=findings&finding=<id>`；
 * 严重级/状态仍是发现行的主标识，所以行标题沿用 `findings-page.ts` 的 `findingTitle`。
 * DSH 依据：DSH 无流量证据页，按「右栏 tab 扩展」实现（100-实施计划总表 §4）。
 *
 * 接口（全部复用 A07 已建的适配器，本模块只加「发现 → 绑定」的组装，不新增请求形状）：
 * - `api.findings(task)`（api.ts:636，经 `v2/data/findings.ts` 的 `useFindings`）取当前任务的发现；
 * - `api.findingTraffic(id, contextTask)`（api.ts:691-694，经 `v2/data/finding-traffic.ts` 的
 *   `useFindingTraffic`）取每条发现的已绑定流量。
 * 发现条数可能很多：只对「前 N 条有绑定的发现」并发读取，N 见 `EVIDENCE_FINDING_LIMIT`，
 * 超出的部分在界面上如实说明「只列前 N 条」，不假装全量。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Finding, FindingTraffic, TrafficEvidenceRole } from "@/lib/types";

/** 一次并发展开多少条发现的绑定（右栏是辅助视图，不做全量扫描）。 */
export const EVIDENCE_FINDING_LIMIT = 12;

/** 证据用途的展示顺序（`finding-traffic.ts:26-31` 的 `TRAFFIC_ROLE_ORDER`）。 */
const ROLE_ORDER: readonly TrafficEvidenceRole[] = ["proof", "baseline", "verification", "supporting"];

export type RightPanelEvidencePhase = "loading" | "ready" | "offline";

/** 一条已绑定的流量证据，带上它所属的发现与用途。 */
export interface EvidenceRow {
  /** 绑定 id（行 key）。 */
  readonly bindingId: string;
  /** 所属发现的后端行 id（跳详情用，`?finding=`）。 */
  readonly findingId: string;
  /** 所属发现的名称（行副标题）。 */
  readonly findingTitle: string;
  /** 证据用途。 */
  readonly role: TrafficEvidenceRole;
  readonly method: string;
  readonly status: number;
  readonly url: string;
}

export interface EvidenceGroup {
  readonly role: TrafficEvidenceRole;
  readonly rows: readonly EvidenceRow[];
}

export interface RightPanelEvidenceState {
  phase: RightPanelEvidencePhase;
  /** 按用途分好组的证据；空数组 = 当前任务的发现都没有绑定流量。 */
  groups: readonly EvidenceGroup[];
  /** 证据总条数（分组后各组合计）。 */
  count: number;
  /** 有发现但读取某条发现的绑定时失败的原因（部分失败；全失败时 phase 为 offline）。 */
  error: string | null;
  /** 因 `EVIDENCE_FINDING_LIMIT` 未展开的发现条数；0 表示全部展开过。 */
  skippedFindings: number;
  reload: () => void;
}

/**
 * 按用途把证据行分组，组内按发现顺序保持稳定（不排序、不丢行）。
 * @param rows - 已展开的绑定证据行。
 * @returns 只含有行的用途组，顺序照 `ROLE_ORDER`。
 */
function groupByRole(rows: readonly EvidenceRow[]): EvidenceGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    rows: rows.filter((row) => row.role === role),
  })).filter((group) => group.rows.length > 0);
}

/**
 * 读取当前任务发现已绑定的流量证据（按用途分组）。
 * @param taskId - 任务 id；null 时不请求，阶段停在 `ready` 且列表为空。
 * @returns 阶段、分组、条数、部分错误与重新读取。
 */
export function useRightPanelEvidence(taskId: string | null): RightPanelEvidenceState {
  const [phase, setPhase] = useState<RightPanelEvidencePhase>("loading");
  const [groups, setGroups] = useState<readonly EvidenceGroup[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [skippedFindings, setSkippedFindings] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setGroups([]);
    setCount(0);
    setError(null);
    setSkippedFindings(0);
    if (taskId === null) {
      setPhase("ready");
      return undefined;
    }
    let alive = true;
    setPhase("loading");

    const run = async (): Promise<void> => {
      const findings: Finding[] = await api.findings(taskId);
      if (!alive) return;
      const scope = findings.slice(0, EVIDENCE_FINDING_LIMIT);
      const skipped = findings.length - scope.length;
      // 每条发现的绑定额外并发读取：读失败的那条记录原因，其余照常显示。
      const results = await Promise.all(
        scope.map(async (finding) => {
          try {
            const traffic: FindingTraffic = await api.findingTraffic(finding.id, taskId);
            return { finding, traffic, failure: null as string | null };
          } catch (reason: unknown) {
            return {
              finding,
              traffic: null as FindingTraffic | null,
              failure: reason instanceof Error ? reason.message : String(reason),
            };
          }
        }),
      );
      if (!alive) return;
      const rows: EvidenceRow[] = [];
      const failures: string[] = [];
      for (const result of results) {
        if (result.failure !== null) {
          failures.push(result.failure);
          continue;
        }
        if (result.traffic === null) continue;
        const title = (result.finding.name?.trim() ?? "") !== "" ? result.finding.name ?? "" : result.finding.vulnclass;
        for (const binding of result.traffic.bindings) {
          rows.push({
            bindingId: binding.id,
            findingId: result.finding.id,
            findingTitle: title === "" ? `#${result.finding.id}` : title,
            role: binding.role,
            method: binding.snapshot.method,
            status: binding.snapshot.status,
            url: binding.snapshot.url,
          });
        }
      }
      setGroups(groupByRole(rows));
      setCount(rows.length);
      setSkippedFindings(skipped > 0 ? skipped : 0);
      // 一条没成功且确实有发现可查：整页算读不到；部分失败只挂错误行。
      if (rows.length === 0 && scope.length > 0 && failures.length === scope.length) {
        setError(failures[0] ?? "");
        setPhase("offline");
        return;
      }
      setError(failures.length > 0 ? `有 ${failures.length} 条发现的证据读取失败：${failures[0] ?? ""}` : null);
      setPhase("ready");
    };

    void run().catch((reason: unknown) => {
      if (!alive) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setGroups([]);
      setCount(0);
      setPhase("offline");
    });

    return () => {
      alive = false;
    };
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, groups, count, error, skippedFindings, reload };
}

/**
 * 真实 SPA 导航到主区「发现」页并选中某条发现
 * （`/v2/shell?page=findings&finding=<id>`，写法照抄 `components/v2/task-views/TaskFindingsView.tsx:66-72`）。
 * @param id - 发现 id。
 */
export function openFindingEvidence(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  url.searchParams.set("finding", id);
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
