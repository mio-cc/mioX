"use client";

/**
 * 企业（`type=company` 的资产节点 + 资产范围规则）的读取与写操作适配器。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/assets/page.tsx:352-410（企业列表）、
 * :1000-1053（新增企业：名称唯一 + 范围逐行解析 + 保存）、:1074-1136（覆盖保存 + 归属依据）、
 * :1153-1214（追加范围 + 归属依据）、:208-226（删除：可选同时删除资产）、
 * :956-974（warnings 展示、已存范围回填）。
 * DSH 依据：DSH 无企业管理页，按「主区整页」扩展（总表 §4.1）；适配器写法照
 * `v2/data/agents.ts:38-67`（只读）与 `v2/data/finding-detail.ts:156-167`（写操作统一报错）。
 * 对照表行：P2:D3 P2:D4 P2:D5 P2:D6 P2:D7
 *
 * 接口签名逐条核对自 `ARTEX/web/src/lib/api.ts`：
 * `companies` :608、`createCompany` :609、`addCompanyScope` :617、`updateCompanyScope` :622、
 * `deleteCompany` :628。返回类型见 `ARTEX/web/src/lib/types.ts:382-416`。
 * 所有请求都在本文件里发出，界面组件不直接调 `api`（总表红线 4）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Company, CompanyScopeMutation, CompanyScopeRule, ScopeRow } from "@/lib/types";

export type CompaniesPhase = "loading" | "ready" | "offline";

export interface CompaniesState {
  phase: CompaniesPhase;
  companies: Company[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取企业列表（GET /companies，api.ts:608）。
 * @returns 阶段、企业列表、错误与重新读取。
 */
export function useCompanies(): CompaniesState {
  const [phase, setPhase] = useState<CompaniesPhase>("loading");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .companies()
      .then((value) => {
        if (!alive) return;
        setCompanies(value);
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
  return { phase, companies, error, reload };
}

/** 新建企业时提交的资产范围行（逐行）。 */
export interface CreateCompanyInput {
  name: string;
  scope: CompanyScopeRule[];
}

/**
 * 新建企业（POST /companies，api.ts:609）。名称唯一，冲突时后端返回 409。
 * @param input - 企业名称与范围规则。
 * @returns 后端结果：`created`、`scope_added`、`scope_invalid`、`scope_errors`。
 */
export async function createCompany(input: CreateCompanyInput): Promise<{
  id: number;
  created: boolean;
  scope_added: number;
  scope_invalid: number;
  scope_errors: string[];
}> {
  const result = await api.createCompany(input.name, input.scope);
  return {
    id: result.id,
    created: result.created,
    scope_added: result.scope_added ?? 0,
    scope_invalid: result.scope_invalid ?? 0,
    scope_errors: result.scope_errors ?? [],
  };
}

/**
 * 追加资产范围（POST /companies/{id}/scope，api.ts:617）。
 * @param id - 企业 id。
 * @param scope - 追加的范围规则。
 * @param reason - 归属依据。
 * @returns 后端结果：`added`、`skipped`、`invalid`、`errors`、`warnings`。
 */
export async function addCompanyScope(
  id: number,
  scope: CompanyScopeRule[],
  reason: string,
): Promise<CompanyScopeMutation> {
  return api.addCompanyScope(id, scope, reason);
}

/**
 * 覆盖保存资产范围（POST /companies/{id}/scope + `reset:true`，api.ts:622）。
 * @param id - 企业 id。
 * @param scope - 覆盖后的完整范围规则。
 * @param reason - 归属依据。
 * @returns 后端结果：`added`、`skipped`、`invalid`、`errors`、`warnings`。
 */
export async function updateCompanyScope(
  id: number,
  scope: CompanyScopeRule[],
  reason: string,
): Promise<CompanyScopeMutation> {
  return api.updateCompanyScope(id, scope, reason);
}

/**
 * 删除企业（DELETE /companies/{id}，api.ts:628）。
 * @param id - 企业 id。
 * @param deleteAssets - 是否同时删除该企业下所有资产；默认 false（只取消归属关系）。
 * @returns 后端结果：删除的企业数与资产数。
 */
export async function deleteCompany(
  id: number,
  deleteAssets = false,
): Promise<{ deleted: number; assets_deleted: number }> {
  return api.deleteCompany(id, deleteAssets);
}

/**
 * 已保存的范围规则，用于回填编辑器（旧页 :964-974）。
 * @param company - 企业。
 * @returns 非空 raw 值转成的规则数组。
 */
export function savedScopeRules(company: Company): CompanyScopeRule[] {
  return (company.scope ?? [])
    .map((scope: ScopeRow) => ({ kind: scope.kind, value: scope.raw.trim() }))
    .filter((scope) => scope.value !== "");
}

/**
 * 已保存范围的多行文本，覆盖保存弹窗打开时回填（旧页 :970-974）。
 * @param company - 企业。
 * @returns 每行一条范围。
 */
export function savedScopeText(company: Company): string {
  return savedScopeRules(company)
    .map((scope) => scope.value)
    .join("\n");
}

/**
 * 后端返回的 warnings 是既有数据问题（保存本身已成功），逐条展示（旧页 :956-962）。
 * @param result - 范围写操作结果。
 * @returns 警告文案数组，没有则空数组。
 */
export function scopeMutationMessages(result: CompanyScopeMutation): string[] {
  const messages: string[] = [];
  if (result.invalid > 0) messages.push(`${result.invalid} 行范围无效`);
  messages.push(...(result.warnings ?? []));
  return messages;
}

/** 资产范围种类的中文名（旧页 `components/scope-text-editor.tsx:11-17`）。 */
export const SCOPE_KIND_LABELS: Record<CompanyScopeRule["kind"], string> = {
  domain: "域名",
  ip: "IP",
  cidr: "CIDR",
  icp: "ICP",
  keyword: "关键词",
};
