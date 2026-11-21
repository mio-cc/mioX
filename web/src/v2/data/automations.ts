"use client";

/**
 * 自动化（定时任务）数据层。后端 server/automations.go，接口文档 .tmp/d5-backend-api.md §3。
 *
 * 设计依据 .tmp/d5-goal-plan-schedule-design.md §3.3：侧栏一级页「自动化」，
 * 默认投递到任务主会话、默认只读巡检（safety=readonly：本轮以计划模式运行，非只读
 * 工具被拒绝），每次运行留记录（新发现数）。时间支持 一次 / 每隔 / 每天 / 每周 /
 * Cron（5 字段，DX-S3）。投递的消息带「⏱ 自动化」标记（S-4）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Automation, AutomationInput, AutomationRun, AutomationTiming, AutomationTimingKind } from "@/lib/types";

export type AutomationsPhase = "loading" | "ready" | "offline";

export interface AutomationsState {
  phase: AutomationsPhase;
  automations: Automation[];
  error: string | null;
  reload: () => void;
}

/** 列表轮询间隔：下次运行时间 / 运行中状态由后端调度器推进（每 5 秒 tick）。 */
const POLL_MS = 15_000;

/**
 * 读取自动化列表（可按任务过滤），页面可见时每 15 秒刷新一次。
 * @param taskId - 只看某个任务的自动化；省略为全部。
 * @returns 阶段、列表、错误与 reload。
 */
export function useAutomations(taskId?: string | null): AutomationsState {
  const [phase, setPhase] = useState<AutomationsPhase>("loading");
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!loaded.current) setPhase("loading");
    api
      .automations(taskId ?? undefined)
      .then((rows) => {
        if (!alive) return;
        loaded.current = true;
        setAutomations(rows);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        if (!loaded.current) setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [taskId, tick]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, automations, error, reload };
}

export interface AutomationRunsState {
  phase: AutomationsPhase;
  runs: AutomationRun[];
  hasMore: boolean;
  error: string | null;
  reload: () => void;
  loadMore: () => void;
}

/**
 * 读取一个自动化的运行记录（新→旧，分页）。
 * @param id - 自动化 id；null 时不读。
 * @returns 运行记录状态。
 */
export function useAutomationRuns(id: string | null): AutomationRunsState {
  const [phase, setPhase] = useState<AutomationsPhase>("loading");
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (id === null) return undefined;
    let alive = true;
    setPhase("loading");
    api
      .automationRuns(id)
      .then((page) => {
        if (!alive) return;
        setRuns(page.runs);
        setHasMore(page.hasMore);
        setNextBefore(page.nextBefore);
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
  }, [id, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const loadMore = useCallback(() => {
    if (id === null || nextBefore === null) return;
    void api.automationRuns(id, 20, nextBefore).then((page) => {
      setRuns((current) => [...current, ...page.runs]);
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    });
  }, [id, nextBefore]);
  return { phase, runs, hasMore, error, reload, loadMore };
}

/** 新建。 */
export function createAutomation(input: AutomationInput): Promise<Automation> {
  return api.createAutomation(input);
}

/** 修改（带 expected_updated_at 乐观锁；冲突时后端 409）。 */
export function updateAutomation(
  automation: Pick<Automation, "id" | "updated_at">,
  changes: Partial<AutomationInput>,
): Promise<Automation> {
  return api.updateAutomation(automation.id, { ...changes, expected_updated_at: automation.updated_at });
}

/** 启停。 */
export function setAutomationEnabled(automation: Pick<Automation, "id" | "updated_at">, enabled: boolean): Promise<Automation> {
  return updateAutomation(automation, { enabled });
}

/** 删除。 */
export function deleteAutomation(id: string): Promise<{ ok: boolean }> {
  return api.deleteAutomation(id);
}

/** 立即运行一次（不改变计划）。 */
export function runAutomationNow(id: string): Promise<{ outcome: string; run: AutomationRun }> {
  return api.runAutomation(id);
}

/** 预览接下来 N 次运行时间。 */
export function previewAutomation(kind: AutomationTimingKind, timing: AutomationTiming, count = 3): Promise<{ runs: string[]; tz: string }> {
  return api.previewAutomation(kind, timing, count);
}

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/** 秒数 → 「5 分钟 / 2 小时 / 1 天」。 */
export function formatEvery(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} 天`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

/**
 * 运行时间的一句话摘要：「每天 09:00」「每周一、三、五 09:00」「每隔 30 分钟」「11月22日 09:00 运行一次」。
 * @param kind - timing_kind。
 * @param timing - timing。
 * @returns 摘要文本。
 */
export function describeTiming(kind: AutomationTimingKind, timing: AutomationTiming): string {
  if (kind === "every") return `每隔 ${formatEvery(timing.every_sec ?? 0)}`;
  if (kind === "daily") return `每天 ${timing.time ?? "--:--"}`;
  if (kind === "weekly") {
    const days = [...(timing.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const label = days.length === 7 ? "每天" : days.length === 0 ? "每周（未选日期）" : `每${days.map((d) => WEEKDAY[d] ?? "?").join("、").replace(/、周/g, "、")}`;
    return `${label} ${timing.time ?? "--:--"}`;
  }
  if (kind === "once") return timing.at ? `${formatWhen(timing.at)} 运行一次` : "运行一次";
  if (kind === "cron") {
    return timing.expr === undefined || timing.expr === "" ? "Cron" : `Cron ${timing.expr}`;
  }
  return "自定义";
}

/** ISO 时间 → 「今天 09:00 / 明天 09:00 / 11月24日 09:00」。 */
export function formatWhen(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const dayDiff = Math.round((startOfDay(date.getTime()) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `明天 ${hm}`;
  if (dayDiff === -1) return `昨天 ${hm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
}

/** ISO 时间距现在的相对描述：「3 分钟后 / 2 小时前」。 */
export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = t - now;
  const abs = Math.abs(diff);
  const unit = abs < 3_600_000 ? [Math.max(1, Math.round(abs / 60_000)), "分钟"] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), "小时"] : [Math.round(abs / 86_400_000), "天"];
  return diff >= 0 ? `${unit[0]} ${unit[1]}后` : `${unit[0]} ${unit[1]}前`;
}

/** last_status / run.status → 中文 + 语气。 */
export function statusTone(status: string): { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" } {
  switch (status) {
    case "running":
      return { label: "运行中", tone: "info" };
    case "queued":
      return { label: "排队中", tone: "warning" };
    case "ok":
    case "done":
      return { label: "成功", tone: "success" };
    case "error":
    case "failed":
      return { label: "失败", tone: "danger" };
    case "skipped":
      return { label: "已跳过", tone: "neutral" };
    default:
      return { label: "未运行", tone: "neutral" };
  }
}

/**
 * 真实 SPA 导航到主区「自动化」页（DX-S3：会话头时钟等入口用它）。
 * 改 `?page=` 后派发 popstate，Shell 重新读取（与发现库深链同法）。
 * @param automationId - 可选：带上时地址为 `?page=automations&automation=<id>`，
 *   自动化页挂载时会定位（展开）该行。
 */
export function openAutomationsPage(automationId?: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "automations");
  url.searchParams.delete("finding");
  if (automationId === undefined || automationId === "") {
    url.searchParams.delete("automation");
  } else {
    url.searchParams.set("automation", automationId);
  }
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
