"use client";

/**
 * 任务概览适配器（会话视图 tab「概览」，对照表 P1:C1–C7，含 C6 任务级拦截规则）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/overview-tab.tsx:350-413（基本信息 + 统计 +
 * 任务内发现一次性读取）、:166-314（目标 / 约束 / 范围的读取与增删改）、:1069-1163（任务级拦截规则读写）。
 * DSH 依据：DSH 无任务概览页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：api.ts:280 task、:419 stats、:436 taskGoals 与 :439-445 写、:493 taskConstraints 与 :498-504 写、
 * :508-517 taskInterceptRules 与写、:520 taskScope 与 :522-525 写、:636 findings。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type {
  AssetInterceptAction,
  AssetInterceptKind,
  AssetInterceptRule,
  AssetInterceptRuleInput,
  ConstraintKind,
  Finding,
  Stats,
  Task,
  TaskConstraint,
  TaskGoal,
  TaskScopeRow,
} from "@/lib/types";

export type OverviewPhase = "loading" | "ready" | "offline";

/** 基本信息 + 统计 + 任务内发现（旧页一次 Promise.all 取完的三份数据）。 */
export interface OverviewSummaryState {
  phase: OverviewPhase;
  /** 后端 `GET /tasks/{id}` 的原文；加载中或失败时为 null。 */
  task: Task | null;
  /** 后端 `GET /stats?task=<id>`；加载中或失败时为 null。 */
  stats: Stats | null;
  /** 本任务的发现（`GET /exploration/findings?task=`）；失败时为空数组。 */
  findings: Finding[];
  /** 基本信息或统计读取失败的原因。 */
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个任务的基本信息、统计与任务内发现。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、任务、统计、发现、错误与重新读取。
 */
export function useOverviewSummary(taskId: string | null): OverviewSummaryState {
  const [phase, setPhase] = useState<OverviewPhase>("loading");
  const [task, setTask] = useState<Task | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    Promise.all([api.task(taskId), api.stats(taskId)])
      .then(([taskValue, statsValue]) => {
        if (!alive) return;
        setTask(taskValue);
        setStats(statsValue);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    // 发现列表失败不阻塞上面的基本信息（旧页 overview-tab.tsx:358-390 同样独立处理）。
    api
      .findings(taskId)
      .then((value) => {
        if (!alive) return;
        setFindings(value);
      })
      .catch(() => {
        if (!alive) return;
        setFindings([]);
      });
    return () => {
      alive = false;
    };
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, task, stats, findings, error, reload };
}

/** 目标列表。 */
export interface GoalListState {
  phase: OverviewPhase;
  goals: TaskGoal[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取本任务的目标列表（`GET /tasks/{id}/goals`，api.ts:436）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、目标、错误与重新读取。
 */
export function useTaskGoals(taskId: string | null): GoalListState {
  const [phase, setPhase] = useState<OverviewPhase>("loading");
  const [goals, setGoals] = useState<TaskGoal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskGoals(taskId)
      .then((value) => {
        if (!alive) return;
        setGoals(value.goals);
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, goals, error, reload };
}

/**
 * 新增目标（api.ts:439）：写入图谱并通知 planner、复活任务。
 * @param taskId - 任务 id。
 * @param text - 目标文本。
 * @param vulnclass - 漏洞类，可选。
 * @returns 后端返回的新目标；失败时抛出带后端信息的 Error。
 */
export function addTaskGoal(taskId: string, text: string, vulnclass?: string): Promise<TaskGoal> {
  return api.addGoal(taskId, text, vulnclass);
}

/**
 * 修改目标文本与漏洞类（api.ts:442）。
 * @param taskId - 任务 id。
 * @param goalId - 目标 id。
 * @param text - 新文本。
 * @param vulnclass - 漏洞类，可选。
 * @returns 后端返回的目标；失败时抛出带后端信息的 Error。
 */
export function updateTaskGoal(
  taskId: string,
  goalId: string,
  text: string,
  vulnclass?: string,
): Promise<TaskGoal> {
  return api.updateGoal(taskId, goalId, text, vulnclass);
}

/**
 * 删除目标（硬删除，api.ts:445；只通知 planner，不复活任务）。
 * @param taskId - 任务 id。
 * @param goalId - 目标 id。
 * @returns 后端的删除结果；失败时抛出带后端信息的 Error。
 */
export function deleteTaskGoal(taskId: string, goalId: string): Promise<{ ok: boolean }> {
  return api.deleteGoal(taskId, goalId);
}

/** 约束列表。 */
export interface ConstraintListState {
  phase: OverviewPhase;
  constraints: TaskConstraint[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取本任务的操作约束（`GET /tasks/{id}/constraints`，api.ts:493）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、约束、错误与重新读取。
 */
export function useTaskConstraints(taskId: string | null): ConstraintListState {
  const [phase, setPhase] = useState<OverviewPhase>("loading");
  const [constraints, setConstraints] = useState<TaskConstraint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskConstraints(taskId)
      .then((value) => {
        if (!alive) return;
        setConstraints(value.constraints);
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, constraints, error, reload };
}

/**
 * 新增约束（api.ts:498；不通知 planner，下一轮规划自然读到）。
 * @param taskId - 任务 id。
 * @param text - 约束文本。
 * @param kind - allow=允许 / deny=禁止。
 * @returns 后端返回的约束；失败时抛出带后端信息的 Error。
 */
export function addTaskConstraint(taskId: string, text: string, kind: ConstraintKind): Promise<TaskConstraint> {
  return api.addConstraint(taskId, text, kind);
}

/**
 * 修改约束（文本 + allow/deny，api.ts:501）。
 * @param taskId - 任务 id。
 * @param constraintId - 约束 id。
 * @param text - 新文本。
 * @param kind - allow=允许 / deny=禁止。
 * @returns 后端返回的约束；失败时抛出带后端信息的 Error。
 */
export function updateTaskConstraint(
  taskId: string,
  constraintId: string,
  text: string,
  kind: ConstraintKind,
): Promise<TaskConstraint> {
  return api.updateConstraint(taskId, constraintId, text, kind);
}

/**
 * 删除约束（api.ts:504）。
 * @param taskId - 任务 id。
 * @param constraintId - 约束 id。
 * @returns 后端的删除结果；失败时抛出带后端信息的 Error。
 */
export function deleteTaskConstraint(taskId: string, constraintId: string): Promise<{ ok: boolean }> {
  return api.deleteConstraint(taskId, constraintId);
}

/** 测试范围列表。 */
export interface ScopeListState {
  phase: OverviewPhase;
  scope: TaskScopeRow[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取本任务的测试范围（含继承自来源任务的行，`GET /tasks/{id}/scope`，api.ts:520）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、范围、错误与重新读取。
 */
export function useTaskScope(taskId: string | null): ScopeListState {
  const [phase, setPhase] = useState<OverviewPhase>("loading");
  const [scope, setScope] = useState<TaskScopeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskScope(taskId)
      .then((value) => {
        if (!alive) return;
        setScope(value.scope);
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, scope, error, reload };
}

/**
 * 手动新增一条测试范围（api.ts:522）。
 * @param taskId - 任务 id。
 * @param kind - company/root_domain/subdomain/ip/cidr/icp/keyword。
 * @param value - 范围值。
 * @param reason - 添加理由，可选。
 * @returns 后端返回的范围行；失败时抛出带后端信息的 Error。
 */
export function addTaskScopeRow(
  taskId: string,
  kind: string,
  value: string,
  reason?: string,
): Promise<TaskScopeRow> {
  return api.addTaskScope(taskId, kind, value, reason);
}

/**
 * 删除本任务的一条测试范围（api.ts:525）。
 * @param taskId - 任务 id。
 * @param scopeId - 范围行 id。
 * @returns 后端的删除结果；失败时抛出带后端信息的 Error。
 */
export function deleteTaskScopeRow(taskId: string, scopeId: number): Promise<{ ok: boolean }> {
  return api.deleteTaskScope(taskId, scopeId);
}

/** 测试范围一条的显示值：域名 / 网段 / 公司（旧页 overview-tab.tsx:58-64）。 */
export function scopeValue(row: TaskScopeRow): string {
  if (row.value !== undefined && row.value !== "") return row.value;
  if (row.domain !== undefined && row.domain !== "") return row.domain;
  if (row.net !== undefined && row.net !== "") return row.net;
  if (row.company_id !== undefined) {
    return row.company_name !== undefined && row.company_name.trim() !== ""
      ? row.company_name
      : `企业 #${row.company_id}`;
  }
  return "—";
}

/** 测试范围来源的中文名（旧页 overview-tab.tsx:76-80）。 */
export const SCOPE_SOURCE_LABEL: Record<TaskScopeRow["source"], string> = {
  auto: "自动",
  agent: "Agent",
  manual: "手动",
};

/* ---- C6：任务级资产拦截 / 允许规则（旧页 overview-tab.tsx:1053-1322 的 TaskInterceptRulesCard） ---- */

/**
 * 任务级规则的种类选项与输入提示（照抄旧页 overview-tab.tsx:1053-1061 的顺序与文案）。
 * 后端 `GET /tasks/{id}/intercept-rules` 返回的 `kind` 就是这几个值（types.ts:1352-1359）。
 */
export const TASK_RULE_KIND_OPTIONS: readonly { value: AssetInterceptKind; label: string; placeholder: string }[] = [
  { value: "exact_domain", label: "域名(全等)", placeholder: "example.gov.cn" },
  { value: "exact_ip", label: "IP(全等)", placeholder: "203.0.113.10" },
  { value: "exact_url", label: "URL(全等)", placeholder: "https://example.com/login" },
  { value: "fuzzy_domain", label: "域名(模糊)", placeholder: ".gov.cn" },
  { value: "fuzzy_ip", label: "IP(模糊)", placeholder: "203.0.113." },
  { value: "fuzzy_url", label: "URL(模糊)", placeholder: "/admin" },
  { value: "cidr", label: "CIDR 网段", placeholder: "192.168.0.0/16" },
];

/** 规则动作选项（旧页 overview-tab.tsx:1180-1183）：block=拦截、allow=允许。 */
export const TASK_RULE_ACTION_OPTIONS: readonly { value: AssetInterceptAction; label: string }[] = [
  { value: "block", label: "拦截" },
  { value: "allow", label: "允许" },
];

/** 规则种类中文名（旧页 overview-tab.tsx:1063-1065）。 */
export const TASK_RULE_KIND_LABEL: Record<AssetInterceptKind, string> = {
  exact_domain: "域名(全等)",
  exact_ip: "IP(全等)",
  exact_url: "URL(全等)",
  fuzzy_domain: "域名(模糊)",
  fuzzy_ip: "IP(模糊)",
  fuzzy_url: "URL(模糊)",
  cidr: "CIDR 网段",
};

/**
 * 规则动作的中文名；任务级规则缺 `action` 时按拦截处理（types.ts:1376 注明全局规则不带此字段）。
 * @param rule - 后端返回的规则行。
 * @returns 「允许」或「拦截」。
 */
export function taskRuleActionLabel(rule: AssetInterceptRule): string {
  return rule.action === "allow" ? "允许" : "拦截";
}

/** 任务级规则列表状态。 */
export interface TaskInterceptRuleListState {
  phase: OverviewPhase;
  rules: AssetInterceptRule[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取本任务的任务级资产拦截 / 允许规则（`GET /tasks/{id}/intercept-rules`，api.ts:508）。
 * 后端可能返回 `rules: null`，适配器已归一成空数组。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、规则、错误与重新读取。
 */
export function useTaskInterceptRules(taskId: string | null): TaskInterceptRuleListState {
  const [phase, setPhase] = useState<OverviewPhase>("loading");
  const [rules, setRules] = useState<AssetInterceptRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .taskInterceptRules(taskId)
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, rules, error, reload };
}

/**
 * 新增一条任务级规则（`POST /tasks/{id}/intercept-rules`，api.ts:510）。规则只在本任务生效，不进全局表。
 * @param taskId - 任务 id。
 * @param rule - 动作、种类、模式、备注与启用状态。
 * @returns 后端返回的规则；失败时抛出带后端信息的 Error。
 */
export function createTaskInterceptRule(
  taskId: string,
  rule: AssetInterceptRuleInput,
): Promise<AssetInterceptRule> {
  return api.createTaskInterceptRule(taskId, rule);
}

/**
 * 修改一条任务级规则（`PUT /tasks/{id}/intercept-rules/{ruleId}`，api.ts:512）。
 * @param taskId - 任务 id。
 * @param ruleId - 规则 id。
 * @param rule - 新的动作、种类、模式、备注与启用状态。
 * @returns 后端返回的规则；失败时抛出带后端信息的 Error。
 */
export function updateTaskInterceptRule(
  taskId: string,
  ruleId: number,
  rule: AssetInterceptRuleInput,
): Promise<AssetInterceptRule> {
  return api.updateTaskInterceptRule(taskId, ruleId, rule);
}

/**
 * 删除一条任务级规则（`DELETE /tasks/{id}/intercept-rules/{ruleId}`，api.ts:514）。
 * @param taskId - 任务 id。
 * @param ruleId - 规则 id。
 * @returns 后端的删除结果；失败时抛出带后端信息的 Error。
 */
export function deleteTaskInterceptRule(taskId: string, ruleId: number): Promise<{ deleted: boolean }> {
  return api.deleteTaskInterceptRule(taskId, ruleId);
}

/**
 * 启用或停用一条任务级规则（`POST /tasks/{id}/intercept-rules/{ruleId}/toggle`，api.ts:516）。
 * @param taskId - 任务 id。
 * @param ruleId - 规则 id。
 * @param enabled - 目标启用状态。
 * @returns 后端的启用状态；失败时抛出带后端信息的 Error。
 */
export function toggleTaskInterceptRule(
  taskId: string,
  ruleId: number,
  enabled: boolean,
): Promise<{ ok: boolean; enabled: boolean }> {
  return api.toggleTaskInterceptRule(taskId, ruleId, enabled);
}
