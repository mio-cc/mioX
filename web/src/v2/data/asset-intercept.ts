"use client";

/**
 * 全局资产黑名单（资产拦截规则）的适配器。
 * 读走 GET /asset-intercept/rules（api.ts:1327）；写走 POST /asset-intercept/rules
 * （api.ts:1328）、PUT /asset-intercept/rules/{id}（api.ts:1330）、
 * DELETE /asset-intercept/rules/{id}（api.ts:1332）、
 * POST /asset-intercept/rules/{id}/toggle（api.ts:1333）。
 * 提交字段与 api 里的 Pick 保持一致：enabled / kind / pattern / note（types.ts:1373）；
 * 全局规则不带 action（types.ts:1376 的注释：全局规则恒为拦截）。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/assets/page.tsx:100-173（读取、保存、删除、启停）
 * DSH 依据：DSH 无拦截配置，按设置分节子页签扩展（总表 §4.3）；
 * 写操作一对一转发、不重试、不吞错误（总表 §5.3）。
 * 对照表行：P3:I9 P3:I10 P2:J1 P2:J2 P2:J3 P2:J4 P2:J5
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { AssetInterceptRule } from "@/lib/types";

/** create/update 的提交体，与 api.ts:1328 / :1330 的 Pick 完全一致。 */
export type AssetInterceptRuleInput = Pick<AssetInterceptRule, "enabled" | "kind" | "pattern" | "note">;

export type AssetRulesPhase = "loading" | "ready" | "offline";

export interface AssetRulesState {
  phase: AssetRulesPhase;
  rules: AssetInterceptRule[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取全局资产拦截规则一次。
 * @returns 阶段、规则列表、错误、重新读取。
 */
export function useAssetInterceptRules(): AssetRulesState {
  const [phase, setPhase] = useState<AssetRulesPhase>("loading");
  const [rules, setRules] = useState<AssetInterceptRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .assetInterceptRules()
      .then((value) => {
        if (!alive) return;
        setRules(value);
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
  return { phase, rules, error, reload };
}

/**
 * 新建全局资产拦截规则（POST /asset-intercept/rules）。
 * @param input - enabled / kind / pattern / note。
 * @returns 后端返回的新规则；失败时抛出带后端信息的 Error。
 */
export function createAssetInterceptRule(input: AssetInterceptRuleInput): Promise<AssetInterceptRule> {
  return api.createAssetInterceptRule(input);
}

/**
 * 更新全局资产拦截规则（PUT /asset-intercept/rules/{id}）。
 * @param id - 规则 id。
 * @param input - enabled / kind / pattern / note。
 * @returns 后端返回的已更新规则。
 */
export function updateAssetInterceptRule(id: number, input: AssetInterceptRuleInput): Promise<AssetInterceptRule> {
  return api.updateAssetInterceptRule(id, input);
}

/**
 * 删除全局资产拦截规则（DELETE /asset-intercept/rules/{id}）。
 * @param id - 规则 id。
 */
export function deleteAssetInterceptRule(id: number): Promise<void> {
  return api.deleteAssetInterceptRule(id).then(() => undefined);
}

/**
 * 启用 / 停用全局资产拦截规则（POST /asset-intercept/rules/{id}/toggle）。
 * @param id - 规则 id。
 * @param enabled - 目标状态。
 * @returns 后端的确认结果。
 */
export function toggleAssetInterceptRule(id: number, enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
  return api.toggleAssetInterceptRule(id, enabled);
}
