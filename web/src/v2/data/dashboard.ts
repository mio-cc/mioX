"use client";

/**
 * 总览页只读适配器：五张 KPI 卡、活动流、最近发现、最近任务表、系统状态与系统静态计数
 * （对照表 P2:A1–A7、P2:A11–A13、P2:A16、P2:A17）。
 * 旧页面依据：ARTEX/web/src/app/(main)/dashboard/page.tsx:153-180（任务 5s 轮询，签名不变不重渲染）、
 *   :183-219（快源 5s 批量）、:222-255（慢源 15s 批量）、:259-325（派生计数与最近项）、
 *   :505-586（五张 KPI 卡）、:847-908（活动流 + kind 计数）、:910-953（最近发现）、
 *   :956-1042（任务表）、:1130-1207（系统状态 + 待审批）。
 * DSH 依据：DSH 无轮询骨架，按「主区整页」扩展（100-实施计划总表 §4.1），interval 自建。
 * 接口：api.ts:278 tasks、:636 findings、:581 assetCounts、:880 traffic、:918 settings、
 *   :782 tokenStats、:816 activity、:1077 llmProfiles、:1337 interceptPending、
 *   :1121 agents、:1227 mcpServers、:1263 skills、:1209 tools、:419 stats（P2:A16 的 LLM 配置态）。
 * C03 图表（P2:A8–A10、A14、A15）追加在文件后半段：:433 usageStats、:790 tokenDaily、
 *   :791 conversationTokens，三路由 `useDashboardTokenUsage` 一并读取；其余是纯聚合函数。
 *
 * 轮询口径照旧页：失败**保留上一次成功值**（不把失败当空数据），只有「从未成功过」才把该组
 * 判成 `offline`。三组各自独立，所以某一组挂掉只让依赖它的卡片显示失败，不会拖垮整页。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { TagTone } from "@/vendor/dsh/primitives/Tag";
import type {
  Activity,
  Agent,
  ConvTokenSummary,
  DailyTokenBucket,
  Finding,
  InterceptPending,
  LLMProfile,
  MCPServer,
  Settings,
  SkillItem,
  Stats,
  Task,
  TokenTotal,
  Tool,
  TrafficExchange,
  UsageStats,
} from "@/lib/types";

/** 一组数据的状态；`offline` 表示一次都没读成功过。 */
export type DashboardPhase = "loading" | "ready" | "offline";

/** 任务组（最贵的一个源，单独轮询；旧页 page.tsx:153-180）。 */
export interface DashboardTasksState {
  phase: DashboardPhase;
  tasks: Task[];
  error: string | null;
  /** 手动重读一次（失败卡片上的「重试」），不清空已有数据。 */
  reload: () => void;
}

/** 快源组：旧页 page.tsx:190-198 的七路 Promise.all。 */
export interface DashboardFastState {
  phase: DashboardPhase;
  findings: Finding[];
  settings: Settings | null;
  pending: InterceptPending[];
  /** 最近活动（已去掉 kind=usage 的行，旧页 :858、:886-906 都不显示它）。 */
  activity: Activity[];
  tokens: TokenTotal | null;
  /** 后端 `GET /stats` 的 LLM 配置态（旧页 :1139）。 */
  stats: Stats | null;
  error: string | null;
  reload: () => void;
}

/** 慢源组：旧页 page.tsx:226-235 的八路 Promise.all（用量统计属 C03，本单元不取）。 */
export interface DashboardSlowState {
  phase: DashboardPhase;
  traffic: TrafficExchange[];
  /** 最近一页流量的总数与采集开关（`GET /traffic` 的 `count` / `enabled`）。 */
  trafficCount: number | null;
  trafficEnabled: boolean | null;
  assetCounts: Record<string, number>;
  agents: Agent[];
  mcpServers: MCPServer[];
  skills: SkillItem[];
  tools: Tool[];
  llmProfiles: LLMProfile[];
  error: string | null;
  reload: () => void;
}

/** 轮询间隔，照旧页 page.tsx:175、:214、:250。 */
export const DASHBOARD_TASK_POLL_MS = 5000;
export const DASHBOARD_FAST_POLL_MS = 5000;
export const DASHBOARD_SLOW_POLL_MS = 15000;
/** 活动流取多少条（旧页 page.tsx:195 `limit: 30`）。 */
export const DASHBOARD_ACTIVITY_LIMIT = 30;
/** 流量只取最近一页用于条数与「最近请求」（旧页 page.tsx:227 `traffic(0, 50)`）。 */
export const DASHBOARD_TRAFFIC_SIZE = 50;
/** 最近发现显示几条（旧页 page.tsx:282）。 */
export const DASHBOARD_RECENT_FINDINGS = 8;
/** 最近任务表显示几行（旧页 page.tsx:277）。 */
export const DASHBOARD_RECENT_TASKS = 5;
/** 活动流行数（旧页 page.tsx:291）。 */
export const DASHBOARD_RECENT_ACTIVITY = 6;

/** 把任意异常取成可显示的一段文本。 */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * 5 秒轮询任务列表。
 * @returns 阶段、任务、错误与重试。
 */
export function useDashboardTasks(): DashboardTasksState {
  const [phase, setPhase] = useState<DashboardPhase>("loading");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let loading = false;
    // 旧页 page.tsx:163-167：列表签名不变就不 setState，避免每 5 秒一次空渲染。
    let signature = "";
    let everLoaded = false;
    const load = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const value = await api.tasks();
        if (!alive) return;
        const next = JSON.stringify(value.tasks);
        everLoaded = true;
        if (next !== signature) {
          signature = next;
          setTasks(value.tasks);
        }
        setPhase("ready");
        setError(null);
      } catch (reason: unknown) {
        if (!alive) return;
        // 失败保留旧值：只有一次都没成功过才判离线（旧页 page.tsx:168-169）。
        if (!everLoaded) {
          setError(messageOf(reason));
          setPhase("offline");
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, DASHBOARD_TASK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, tasks, error, reload };
}

/**
 * 5 秒轮询快源（发现 / 设置 / 待审批 / 活动 / token / 统计）。
 * @returns 阶段、各源数据、错误与重试。
 */
export function useDashboardFast(): DashboardFastState {
  const [phase, setPhase] = useState<DashboardPhase>("loading");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pending, setPending] = useState<InterceptPending[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [tokens, setTokens] = useState<TokenTotal | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let loading = false;
    let everLoaded = false;
    const load = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const [findingList, settingsValue, pendingList, activityPage, tokenValue, statsValue] = await Promise.all([
          api.findings(),
          api.settings(),
          api.interceptPending(),
          api.activity(undefined, { limit: DASHBOARD_ACTIVITY_LIMIT }),
          api.tokenStats(),
          api.stats(),
        ]);
        if (!alive) return;
        everLoaded = true;
        setFindings(findingList);
        setSettings(settingsValue);
        setPending(pendingList);
        setActivity(activityPage.items.filter((row) => row.kind !== "usage"));
        setTokens(tokenValue.total ?? null);
        setStats(statsValue);
        setPhase("ready");
        setError(null);
      } catch (reason: unknown) {
        if (!alive) return;
        if (!everLoaded) {
          setError(messageOf(reason));
          setPhase("offline");
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, DASHBOARD_FAST_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, findings, settings, pending, activity, tokens, stats, error, reload };
}

/**
 * 15 秒轮询慢源（流量 / 资产计数 / 系统静态清单 / LLM 配置）。
 * @returns 阶段、各源数据、错误与重试。
 */
export function useDashboardSlow(): DashboardSlowState {
  const [phase, setPhase] = useState<DashboardPhase>("loading");
  const [traffic, setTraffic] = useState<TrafficExchange[]>([]);
  const [trafficCount, setTrafficCount] = useState<number | null>(null);
  const [trafficEnabled, setTrafficEnabled] = useState<boolean | null>(null);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [llmProfiles, setLlmProfiles] = useState<LLMProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let loading = false;
    let everLoaded = false;
    const load = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const [trafficValue, counts, agentList, mcpList, skillList, toolList, profileList] = await Promise.all([
          api.traffic(0, DASHBOARD_TRAFFIC_SIZE),
          api.assetCounts(),
          api.agents(),
          api.mcpServers(),
          api.skills(),
          api.tools(),
          api.llmProfiles(),
        ]);
        if (!alive) return;
        everLoaded = true;
        setTraffic(trafficValue.exchanges ?? []);
        setTrafficCount(typeof trafficValue.count === "number" ? trafficValue.count : null);
        setTrafficEnabled(typeof trafficValue.enabled === "boolean" ? trafficValue.enabled : null);
        setAssetCounts(counts ?? {});
        setAgents(agentList);
        setMcpServers(mcpList);
        setSkills(skillList);
        setTools(toolList);
        setLlmProfiles(profileList);
        setPhase("ready");
        setError(null);
      } catch (reason: unknown) {
        if (!alive) return;
        if (!everLoaded) {
          setError(messageOf(reason));
          setPhase("offline");
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, DASHBOARD_SLOW_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return {
    phase,
    traffic,
    trafficCount,
    trafficEnabled,
    assetCounts,
    agents,
    mcpServers,
    skills,
    tools,
    llmProfiles,
    error,
    reload,
  };
}

/** 任务状态的中文名（旧页 StatusBadge domain="task"）；未知值原样显示。 */
export const DASHBOARD_TASK_STATUS_LABEL: Record<string, string> = {
  created: "已创建",
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
  timeout: "超时",
};

/** Token 数的紧凑写法（旧页 page.tsx:66-70 `fmtTokens`）。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * 相对时间（旧页 page.tsx:54-64 `fmtRel`）。传入秒级或毫秒级时间戳、ISO 串都行。
 * @param ts - 后端时间戳；空值为 `—`。
 * @returns `12s 前` 这类相对文案。
 */
export function formatRelative(ts?: string | number | null): string {
  if (ts === undefined || ts === null || ts === "" || ts === 0) return "—";
  const ms = typeof ts === "number" ? ts * 1000 : Date.parse(ts);
  if (Number.isNaN(ms)) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  return `${Math.floor(h / 24)}d 前`;
}

/** 任务按最近活动倒序（旧页 page.tsx:276）。 */
export function sortTasksByActivity(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => (b.last_activity_unix ?? b.created_unix ?? 0) - (a.last_activity_unix ?? a.created_unix ?? 0),
  );
}

/** 资产各类型的节点总数（旧页 page.tsx:295）。 */
export function totalAssets(assetCounts: Record<string, number>): number {
  return Object.values(assetCounts).reduce((sum, n) => sum + n, 0);
}

/** 当前激活（默认）的 LLM 配置（旧页 page.tsx:323）。 */
export function activeProfile(profiles: readonly LLMProfile[]): LLMProfile | null {
  return profiles.find((profile) => profile.is_default) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// C03 总览图表（P2:A8、P2:A9、P2:A10）：token 用量与每日趋势
// ─────────────────────────────────────────────────────────────────────────────

/**
 * token 归桶口径（旧页 page.tsx:331-332 的「旧版 / 新版」数据源开关）。
 * `legacy` = 任务 `Task.tokens` + 会话 `ConvTokenSummary`（旧页 :348-381，含历史任务，
 * 但「每日」只能按创建日近似）；`ledger` = `llm_usage` 计量账本（旧页 :384-399，逐次调用精确，
 * 只覆盖启用之后）。
 */
export type TokenVersion = "legacy" | "ledger";

/** 每日柱图的横轴范围；边上「更多」用 14/60 两档（旧页 :768-775 是 7/30/90/180/365）。 */
export type TokenDays = 7 | 14 | 30 | 60;

/** 一个 profile 的 token 合计（旧页 page.tsx:345 的 Bucket）。 */
export interface TokenBucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 该桶覆盖的任务数（新版取 `ProfileUsage.tasks` 之和，旧版数任务条数）。 */
  taskCount: number;
}

/** 一天的三段 token（旧页 :430 `{input, output, cacheRead}`）。 */
export interface DailyTokenPoint {
  /** `YYYY-MM-DD`。 */
  date: string;
  input: number;
  output: number;
  cacheRead: number;
}

/** 图表需要的 token 数据；`error` 里按来源分别记录失败原因，`null` 表示读到。 */
export interface DashboardTokenUsage {
  phase: DashboardPhase;
  /** 旧版来源：任务 + 会话用量。 */
  profiles: LLMProfile[];
  usage: UsageStats | null;
  conversations: ConvTokenSummary[];
  daily: DailyTokenBucket[];
  error: string | null;
  reload: () => void;
}

/**
 * 读 token 图表的三路数据：`usageStats(days)`（api.ts:433）、`conversationTokens()`
 * （api.ts:791）、`tokenDaily(days)`（api.ts:790），与旧页 page.tsx:219-235 的取数一致。
 * 与 `useDashboardFast`/`useDashboardSlow` 同口径轮询（5 秒 / 15 秒），失败保留上一次成功值，
 * 只有一次都没成功过才判 `offline`。
 * @param days - 每日趋势的天数，进请求参数，切换范围会重新读取。
 * @returns 阶段、原始数据、错误与重试。
 */
export function useDashboardTokenUsage(days: TokenDays): DashboardTokenUsage {
  const [phase, setPhase] = useState<DashboardPhase>("loading");
  const [profiles, setProfiles] = useState<LLMProfile[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [conversations, setConversations] = useState<ConvTokenSummary[]>([]);
  const [daily, setDaily] = useState<DailyTokenBucket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let loading = false;
    let everLoaded = false;
    const load = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const [profileList, usageValue, conversationList, dailyList] = await Promise.all([
          api.llmProfiles(),
          api.usageStats(days),
          api.conversationTokens(),
          api.tokenDaily(days),
        ]);
        if (!alive) return;
        everLoaded = true;
        setProfiles(profileList);
        setUsage(usageValue);
        setConversations(conversationList);
        setDaily(dailyList);
        setPhase("ready");
        setError(null);
      } catch (reason: unknown) {
        if (!alive) return;
        if (!everLoaded) {
          setError(messageOf(reason));
          setPhase("offline");
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, DASHBOARD_SLOW_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [days, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, profiles, usage, conversations, daily, error, reload };
}

/** 空桶（旧页 page.tsx:351 的初值）。 */
function emptyBucket(): TokenBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, taskCount: 0 };
}

/**
 * 按 profile 归桶（旧页 page.tsx:348-381 的旧版口径）。`Task.llm_profile_id` 缺省的任务
 * 与 `ConvTokenSummary.llm_profile_id` 为空的会话，都记到当前默认 profile（旧页 :362、:373）。
 * @param tasks - 全部任务。
 * @param conversations - `GET /tokens/conversations`。
 * @param defaultProfileId - 默认 profile 的 id，没有默认配置时为 null。
 * @returns key 为 profile id（无默认配置时为 null）的桶。
 */
export function tokenByProfileLegacy(
  tasks: readonly Task[],
  conversations: readonly ConvTokenSummary[],
  defaultProfileId: number | null,
): Map<number | null, TokenBucket> {
  const map = new Map<number | null, TokenBucket>();
  const fold = (key: number | null, inp: number, out: number, cr: number, cw: number, addTask: boolean): void => {
    const prev = map.get(key) ?? emptyBucket();
    map.set(key, {
      input: prev.input + inp,
      output: prev.output + out,
      cacheRead: prev.cacheRead + cr,
      cacheWrite: prev.cacheWrite + cw,
      taskCount: prev.taskCount + (addTask ? 1 : 0),
    });
  };
  for (const task of tasks) {
    fold(
      task.llm_profile_id ?? defaultProfileId,
      task.tokens?.input_tokens ?? 0,
      task.tokens?.output_tokens ?? 0,
      task.tokens?.cache_read_tokens ?? 0,
      task.tokens?.cache_write_tokens ?? 0,
      true,
    );
  }
  for (const row of conversations) {
    fold(
      row.llm_profile_id ?? defaultProfileId,
      row.input_tokens,
      row.output_tokens,
      row.cache_read_tokens,
      row.cache_write_tokens,
      false,
    );
  }
  return map;
}

/**
 * 按 profile 归桶（旧页 page.tsx:384-399 的新版口径）。`profile_name` 对不上现有 profile
 * （改名 / 删除 / 空名）的桶记到默认 profile，仍计入「全部」。
 * @param usage - `GET /tokens/usage` 的 `by_profile`。
 * @param profiles - `GET /llm/profiles`，用来把 profile_name 映射回 id。
 * @param defaultProfileId - 默认 profile 的 id，没有默认配置时为 null。
 * @returns key 为 profile id 的桶。
 */
export function tokenByProfileLedger(
  usage: UsageStats | null,
  profiles: readonly LLMProfile[],
  defaultProfileId: number | null,
): Map<number | null, TokenBucket> {
  const idByName = new Map<string, number>();
  for (const profile of profiles) idByName.set(profile.name, Number(profile.id));
  const map = new Map<number | null, TokenBucket>();
  for (const row of usage?.by_profile ?? []) {
    const key = idByName.get(row.profile_name) ?? defaultProfileId;
    const prev = map.get(key) ?? emptyBucket();
    map.set(key, {
      input: prev.input + row.input_tokens,
      output: prev.output + row.output_tokens,
      cacheRead: prev.cacheRead + row.cache_read_tokens,
      cacheWrite: prev.cacheWrite + row.cache_write_tokens,
      taskCount: prev.taskCount + row.tasks,
    });
  }
  return map;
}

/** 一天的三段合计（旧页 page.tsx:430 的 m 值类型，便于两边合并）。 */
interface DailyFold {
  input: number;
  output: number;
  cacheRead: number;
}

/** 把一天折进映射（旧页 page.tsx:431-435、:461-466）。 */
function foldDay(map: Map<string, DailyFold>, date: string, input: number, output: number, cacheRead: number): void {
  const prev = map.get(date) ?? { input: 0, output: 0, cacheRead: 0 };
  map.set(date, {
    input: prev.input + input,
    output: prev.output + output,
    cacheRead: prev.cacheRead + cacheRead,
  });
}

/**
 * 两个数据源各一天的合计（旧页 page.tsx:426-450 的旧版 / :453-469 的新版）。
 * @param version - `legacy` 或 `ledger`。
 * @param tasks - 全部任务。
 * @param conversations - 会话用量。
 * @param usage - `GET /tokens/usage`。
 * @param profiles - LLM 配置列表。
 * @param days - 天数上限（含今天）。
 * @param profileId - `"all"` 表示全部；数字表示只算该 profile。
 * @returns 按日期升序的每日点，上限 `days` 天，日期升序。
 */
export function dailyTokenSeries(
  version: TokenVersion,
  tasks: readonly Task[],
  conversations: readonly ConvTokenSummary[],
  usage: UsageStats | null,
  profiles: readonly LLMProfile[],
  days: TokenDays,
  profileId: number | "all",
): DailyTokenPoint[] {
  const defaultProfileId = profiles.find((profile) => profile.is_default) === undefined
    ? null
    : Number(profiles.find((profile) => profile.is_default)?.id);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const map = new Map<string, DailyFold>();

  if (version === "legacy") {
    for (const task of tasks) {
      if (profileId !== "all" && (task.llm_profile_id ?? defaultProfileId) !== profileId) continue;
      const date = task.created_at.slice(0, 10);
      if (date < cutoffKey) continue;
      foldDay(
        map,
        date,
        task.tokens?.input_tokens ?? 0,
        task.tokens?.output_tokens ?? 0,
        task.tokens?.cache_read_tokens ?? 0,
      );
    }
    for (const row of conversations) {
      if (profileId !== "all" && (row.llm_profile_id ?? defaultProfileId) !== profileId) continue;
      const date = row.created_at.slice(0, 10);
      if (date < cutoffKey) continue;
      foldDay(map, date, row.input_tokens, row.output_tokens, row.cache_read_tokens);
    }
  } else {
    const idByName = new Map<string, number>();
    for (const profile of profiles) idByName.set(profile.name, Number(profile.id));
    for (const row of usage?.daily ?? []) {
      if (row.date < cutoffKey) continue;
      if (profileId !== "all" && (idByName.get(row.profile_name) ?? defaultProfileId) !== profileId) continue;
      foldDay(map, row.date, row.input_tokens, row.output_tokens, row.cache_read_tokens);
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, ...value }));
}

/**
 * 取某个 profile 页签的合计（旧页 page.tsx:403-423 `displayedTokens`）。
 * @param buckets - `tokenByProfileLegacy` / `tokenByProfileLedger` 的结果。
 * @param profileId - `"all"` 表示各桶相加；数字只取该桶。
 * @returns 合计桶。
 */
export function sumTokenBuckets(
  buckets: Map<number | null, TokenBucket>,
  profileId: number | "all",
): TokenBucket {
  if (profileId !== "all") return buckets.get(profileId) ?? emptyBucket();
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let taskCount = 0;
  for (const bucket of buckets.values()) {
    input += bucket.input;
    output += bucket.output;
    cacheRead += bucket.cacheRead;
    cacheWrite += bucket.cacheWrite;
    taskCount += bucket.taskCount;
  }
  return { input, output, cacheRead, cacheWrite, taskCount };
}

/**
 * 缓存命中率（旧页 page.tsx:736-750）：`input` 已含缓存，所以分母是总输入。
 * @param bucket - 合计桶。
 * @returns 0–100 的整数；没有输入时为 0。
 */
export function cacheHitPercent(bucket: TokenBucket): number {
  return bucket.input > 0 ? Math.round((bucket.cacheRead / bucket.input) * 100) : 0;
}

/** 旧页 page.tsx:72-79 的资产类型中文名；后端新增的类型原样显示。 */
export const DASHBOARD_ASSET_TYPE_LABEL: Record<string, string> = {
  root_domain: "根域名",
  ip: "IP",
  subdomain: "子域名",
  app: "应用",
  service: "服务",
  endpoint: "端点",
};

/**
 * 资产按类型分布（旧页 page.tsx:298-305）：只留计数大于 0 的项，从多到少取前 8 类。
 * @param assetCounts - `GET /assets/counts`。
 * @returns `[类型, 计数]` 数组，已排序截断。
 */
export function assetTypeRows(assetCounts: Record<string, number>): [string, number][] {
  return Object.entries(assetCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
}

/**
 * 流量状态码分档（旧页 page.tsx:308-317）：按百位归到 2xx / 3xx / 4xx / 5xx。
 * @param traffic - 最近一页流量。
 * @returns `{code, n}` 数组，按状态码升序。
 */
export function trafficStatusBuckets(traffic: readonly TrafficExchange[]): { code: number; n: number }[] {
  const map: Record<number, number> = {};
  for (const exchange of traffic) {
    const bucket = Math.floor(exchange.status / 100) * 100;
    map[bucket] = (map[bucket] ?? 0) + 1;
  }
  return Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([code, n]) => ({ code: Number(code), n }));
}

/** 状态码 → Tag 色调（旧页 page.tsx:90-95 `statusColor` 的语义）。 */
export function trafficStatusTone(code: number): TagTone {
  if (code < 300) return "success";
  if (code < 400) return "info";
  if (code < 500) return "warning";
  return "danger";
}

/**
 * 最近请求（旧页 page.tsx:320、:1078-1121 的「最近请求」，取 5 条）。
 * @param traffic - 最近一页流量。
 * @returns 按 ts 倒序的前 5 条。
 */
export function recentTrafficPage(traffic: readonly TrafficExchange[]): TrafficExchange[] {
  return [...traffic].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 5);
}

/**
 * 每个任务状态的计数（旧页 page.tsx:259-263），键是 `TaskStatus`。
 * @param tasks - 全部任务。
 * @returns 状态 → 计数。
 */
export function countTasksByStatus(tasks: readonly Task[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const task of tasks) map[task.status] = (map[task.status] ?? 0) + 1;
  return map;
}

/**
 * 每个发现处置状态的计数（与 `findingsBySeverity` 同口径，只数出现的状态）。
 * @param findings - `GET /exploration/findings`。
 * @returns 状态 → 计数。
 */
export function countFindingsByStatus(findings: readonly Finding[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const finding of findings) map[finding.status] = (map[finding.status] ?? 0) + 1;
  return map;
}

/** 进入主区某页（真实 SPA 导航：改 `?page=` 后通知 Shell 重新读取，照 TaskFindingsView.tsx:66-72）。 */
function goToPage(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", id);
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * 打开某个漏洞的详情（`/v2/shell?page=findings&finding=<id>`，同 TaskFindingsView.tsx:66-72）。
 * @param id - 漏洞 id。
 */
export function openFinding(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  url.searchParams.set("finding", id);
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** 跳到「发现」整页（旧页 page.tsx:919 的「全部」）。 */
export function openFindingsPage(): void {
  goToPage("findings");
}

/** 跳到「流量」整页。 */
export function openTrafficPage(): void {
  goToPage("traffic");
}

/**
 * 跳到某个任务。
 * 旧页 page.tsx:999 的 `/function/tasks/detail?id=` 在 /v2 没有对应路由（详情是会话视图），
 * 不是可直接构造的地址，所以适配器不提供「跳任务详情」；活动流与任务表的任务入口由页头说明，
 * 见 `ARTEX/web/src/components/v2/dashboard/DashboardPage.tsx` 的注释与 overlay note。
 * 离开整页回到会话就是清掉 `?page=`，Shell 的对话区即显示当前选中任务。
 */
export function openConversation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("page");
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
