"use client";

/**
 * 拦截高级配置的适配器：全局工具拦截范围（GET/PUT /intercept/tool-config）、
 * 模型兜底审批配置（GET/PUT /intercept/judge）与近 N 天审批 token 用量
 * （GET /intercept/judge/usage?days=N）。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/page.tsx:208-276（模型兜底 JudgesCard）、
 * :462-469 与 :565-599（工具范围读取与保存）、:601（工具分组）、:218（用量读取）、
 * :65-100（fmtTokens 与统计块）。
 * DSH 依据：DSH 无拦截配置，按设置分节子页签扩展（总表 §4.3）；
 * 写操作一对一转发、不重试、不吞错误（总表 §5.3）。
 * 对照表行：P3:I6 P3:I7 P3:I8
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { JudgeConfig, JudgeUsage, Tool } from "@/lib/types";

// ---------------------------------------------------------------------------
// 工具拦截范围（P3:I6）
// ---------------------------------------------------------------------------

/**
 * 工具在拦截范围配置里的分组，照旧页面 groupTools（intercept/page.tsx:130-143）
 * 的四个分组，只是不自造工具名：组的成员全部来自 GET /tools。
 * 「内置工具」= system === true；「自定义工具」= 其余（照 tools.ts:66 isCustomTool）。
 */
export interface ToolScopeGroup {
  key: "builtin" | "custom";
  label: string;
  tools: Tool[];
}

export type ToolScopePhase = "loading" | "ready" | "offline";

export interface ToolScopeState {
  phase: ToolScopePhase;
  /** 后端已保存的拦截范围（enabled_tools），原样保存，未排序也未补全。 */
  enabledTools: string[];
  /** GET /tools 的完整工具目录，供勾选；离线时为空。 */
  groups: ToolScopeGroup[];
  error: string | null;
  reload: () => void;
}

/**
 * 把工具目录按内置 / 自定义分组；空组不返回，顺序固定。
 * @param tools - GET /tools 返回的完整目录。
 * @returns 非空分组，最多两组。
 */
function groupScopeTools(tools: Tool[]): ToolScopeGroup[] {
  const builtin: Tool[] = [];
  const custom: Tool[] = [];
  for (const tool of tools) {
    if (tool.system === true) builtin.push(tool);
    else custom.push(tool);
  }
  const groups: ToolScopeGroup[] = [
    { key: "builtin", label: "内置工具", tools: builtin },
    { key: "custom", label: "自定义工具", tools: custom },
  ];
  return groups.filter((group) => group.tools.length > 0);
}

/**
 * 读取拦截范围（工具清单 + 已启用的工具名）。
 * @returns 阶段、已启用工具名、按组划分的工具目录、错误、重新读取。
 */
export function useToolScope(): ToolScopeState {
  const [phase, setPhase] = useState<ToolScopePhase>("loading");
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [groups, setGroups] = useState<ToolScopeGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    Promise.all([api.tools(), api.interceptGetToolConfig()])
      .then(([tools, config]) => {
        if (!alive) return;
        setEnabledTools(config.enabled_tools);
        setGroups(groupScopeTools(tools));
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
  return { phase, enabledTools, groups, error, reload };
}

/**
 * 保存拦截范围（PUT /intercept/tool-config）。只由「保存」按钮调用。
 * @param enabledTools - 被勾选的工具名，原样提交，前端不排序也不去重补全。
 */
export function saveToolScope(enabledTools: string[]): Promise<void> {
  return api.interceptSetToolConfig(enabledTools);
}

// ---------------------------------------------------------------------------
// 模型兜底审批（P3:I7）与审批用量（P3:I8）
// ---------------------------------------------------------------------------

export type JudgePhase = "loading" | "ready" | "offline";

export interface JudgeState {
  phase: JudgePhase;
  /** 后端当前配置；离线时为 null。prompt 未设置时后端回填内置模板全文。 */
  config: JudgeConfig | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取模型兜底审批配置（GET /intercept/judge）。
 * @returns 阶段、配置、错误、重新读取。
 */
export function useJudgeConfig(): JudgeState {
  const [phase, setPhase] = useState<JudgePhase>("loading");
  const [config, setConfig] = useState<JudgeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .interceptGetJudgeConfig()
      .then((value) => {
        if (!alive) return;
        setConfig(value);
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
  return { phase, config, error, reload };
}

/**
 * 保存模型兜底审批配置（PUT /intercept/judge）。只由「保存」按钮调用。
 * 提交体就是读到的 JudgeConfig 全字段（types.ts:1402），不自造字段。
 * @param config - 当前表单的完整配置。
 */
export async function saveJudgeConfig(config: JudgeConfig): Promise<void> {
  await api.interceptSetJudgeConfig(config);
}

/**
 * 清空提示词并保存，让服务端下次回填内置模板（照旧页面 intercept/page.tsx:263-276
 * restorePrompt）：先 PUT prompt=""，再 GET 回读，返回回填后的配置。
 * @returns 回读到的配置；prompt 已由后端填回内置模板全文。
 */
export async function restoreJudgePromptTemplate(config: JudgeConfig): Promise<JudgeConfig> {
  await api.interceptSetJudgeConfig({ ...config, prompt: "" });
  return api.interceptGetJudgeConfig();
}

export type JudgeUsagePhase = "loading" | "ready" | "offline";

export interface JudgeUsageState {
  phase: JudgeUsagePhase;
  /** 后端用量汇总；离线时为 null。 */
  usage: JudgeUsage | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取近 N 天 judge 通道 token 用量（GET /intercept/judge/usage?days=N）。
 * @param days - 统计天数，固定传 30（卡片要求近 30 天）。
 * @returns 阶段、用量、错误、重新读取。
 */
export function useJudgeUsage(days: number): JudgeUsageState {
  const [phase, setPhase] = useState<JudgeUsagePhase>("loading");
  const [usage, setUsage] = useState<JudgeUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .interceptJudgeUsage(days)
      .then((value) => {
        if (!alive) return;
        setUsage(value);
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
  }, [days, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, usage, error, reload };
}

/**
 * 压缩 token 数（照旧页面 intercept/page.tsx:65-69 fmtTokens）：1.2k / 3.4M。
 * @param n - 原始 token 数。
 * @returns 展示文本。
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

/**
 * 判定模型下拉的选项：首项 = 跟随激活配置（profile_id 0，照旧页面 :196,369），
 * 其余来自真实 LLM profile 列表。
 * @param profiles - GET /llm/profiles 返回的配置。
 * @returns 下拉选项，value 为 profile_id 的字符串形式。
 */
export function judgeProfileOptions(profiles: { id: string; name: string; model: string }[]): {
  value: string;
  label: string;
}[] {
  return [
    { value: "0", label: "跟随激活配置" },
    ...profiles.map((profile) => ({ value: profile.id, label: `${profile.name}（${profile.model}）` })),
  ];
}
