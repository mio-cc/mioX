"use client";

/**
 * 会话运行计量（DSH ui-chat `StatsPills.tsx` 的口径，按 mioX 后端的数据语义换算）。
 *
 * mioX 的两个数据事实（诊断见 .tmp/tps-diagnosis.md）：
 *   1. usage 活动行的 *_tokens 是**本次 Prompt 循环的累计值**（norma harness
 *      query.go:456-461 emit `&l.usage`），不是单次调用的用量。对它们直接求和会把
 *      前几步重复计入（多步回合 tok/s、缓存命中、上下文全部失真）。capture 自
 *      2026-11-21 16:1x 起在 metadata 里写 step_*_tokens（单步增量）；更早的行按
 *      「同一 worker 相邻 usage 行的差值」回推，累计值回落（新循环开始）时取该行本身。
 *   2. input_tokens **已包含**缓存读写（norma llm/anthropic.go:324-334 把 cache read /
 *      creation 并进 input；openai prompt_tokens 本就含 cached_tokens）。所以：
 *        - 已消耗 = input + output（再加 cacheRead/cacheWrite 就重复计数）；
 *        - 缓存命中 = cacheRead / input；
 *        - 上下文已用 = 最近一次调用的单步 input。
 *
 * 各指标：
 *   - 轮 / 步：DSH `stats.counts`——轮 = 用户消息数（无用户消息而有模型调用时记 1），
 *     步 = 模型调用次数（usage 行数）。
 *   - 耗时：本轮（最后一条用户消息起）到最后一条活动；运行中实时走表。
 *   - tok/s：DSH `decodeSpeed`（StatsPills.tsx:172-176,254）——只统计带 decode 计时的
 *     步：Σ 单步输出 ÷ Σ decode 耗时；**没有任何计时步就不显示**（不再用
 *     「全部输出 ÷ 最后一轮时长」这种分子分母范围不一致的回落口径）。
 *   - 已消耗 / 缓存命中：整任务口径，优先任务行 tokens（后端对每个循环的最终累计值
 *     求和 = 真实总量）；没有任务行时用单步增量求和。
 *   - 上下文已用：主 Agent 最近一步的单步 input（没有主 Agent 调用时取最近一步）÷
 *     生效 profile 的上下文窗口。
 */
import * as React from "react";

import type { Activity, Task } from "@/lib/types";

export interface ConversationUsageMetrics {
  /** 用户回合数。 */
  readonly turns: number;
  /** 模型调用次数（usage 行数）。 */
  readonly steps: number;
  /** 本轮耗时（秒）；没有用户消息时 null。 */
  readonly elapsedSecs: number | null;
  /** 解码速度 tok/s；没有任何带计时的步时 null（不显示）。 */
  readonly tokensPerSecond: number | null;
  /** 参与 tok/s 的计时步数。 */
  readonly timedSteps: number;
  /** 平均首 token 时延（毫秒）；无计时时 null。 */
  readonly avgTtftMs: number | null;
  /** 整任务 token 用量（input 含缓存 + output）。 */
  readonly totalTokens: number;
  /** 缓存命中百分数；无输入时 null。 */
  readonly cacheHitPercent: number | null;
  /** 最近一次调用的 prompt 大小（上下文压力分子）。 */
  readonly contextTokens: number | null;
  /** 上下文统计取自哪个会话（mainagent / planner / work#n）。 */
  readonly contextWorker: string | null;
  /** 当前生效 profile 的上下文窗口（tok）；缺省 null。 */
  readonly contextWindowTokens: number | null;
}

/** 空 metrics：任务未选中时。 */
export const EMPTY_USAGE: ConversationUsageMetrics = {
  turns: 0,
  steps: 0,
  elapsedSecs: null,
  tokensPerSecond: null,
  timedSteps: 0,
  avgTtftMs: null,
  totalTokens: 0,
  cacheHitPercent: null,
  contextTokens: null,
  contextWorker: null,
  contextWindowTokens: null,
};

/** 一次模型调用（一个 usage 行）的单步用量与计时。 */
export interface UsageStep {
  readonly seq: number;
  readonly worker: string;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly decodeMs: number | null;
  readonly ttftMs: number | null;
}

/** 单步解码速度超过这个值视为计时无效（旧版 capture 会把首 token 时刻清零后从中途起算）。 */
const IMPLAUSIBLE_TPS = 5000;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 把活动流里的 usage 行（循环累计值）还原成逐步增量。
 * @param activities - 按 seq 升序的活动。
 * @returns 每次模型调用一条。
 */
export function usageSteps(activities: readonly Activity[]): UsageStep[] {
  const prev = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>();
  const steps: UsageStep[] = [];
  for (const row of activities) {
    // 一个循环结束（result）后，同一 worker 的下一条 usage 从零累计。
    if (row.kind === "result") {
      prev.delete(row.worker);
      continue;
    }
    if (row.kind !== "usage") continue;
    const cum = {
      input: row.input_tokens ?? 0,
      output: row.output_tokens ?? 0,
      cacheRead: row.cache_read_tokens ?? 0,
      cacheWrite: row.cache_write_tokens ?? 0,
    };
    const meta = row.metadata;
    const last = prev.get(row.worker);
    // 累计值任何一项回落 = 新的循环开始（中途没有 result 行的情况），该行本身就是第一步。
    const reset =
      last === undefined ||
      cum.input < last.input ||
      cum.output < last.output ||
      cum.cacheRead < last.cacheRead ||
      cum.cacheWrite < last.cacheWrite;
    const base = reset ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : last;
    prev.set(row.worker, cum);
    steps.push({
      seq: row.seq,
      worker: row.worker,
      input: num(meta?.step_input_tokens) ?? cum.input - base.input,
      output: num(meta?.step_output_tokens) ?? cum.output - base.output,
      cacheRead: num(meta?.step_cache_read_tokens) ?? cum.cacheRead - base.cacheRead,
      cacheWrite: num(meta?.step_cache_write_tokens) ?? cum.cacheWrite - base.cacheWrite,
      decodeMs: num(meta?.decode_ms),
      ttftMs: num(meta?.ttft_ms),
    });
  }
  return steps;
}

/**
 * DSH decodeSpeed：只统计带 decode 计时、且速度在可信范围内的步。
 * @param steps - 单步用量。
 * @returns tok/s（null = 没有计时步）、计时步数、平均首 token 时延。
 */
export function decodeSpeed(steps: readonly UsageStep[]): { tps: number | null; timed: number; avgTtftMs: number | null } {
  let decodeMs = 0;
  let decodeTokens = 0;
  let timed = 0;
  let ttftSum = 0;
  let ttftCount = 0;
  for (const step of steps) {
    if (step.ttftMs !== null && step.ttftMs >= 0) {
      ttftSum += step.ttftMs;
      ttftCount += 1;
    }
    if (step.decodeMs === null || step.decodeMs <= 0 || step.output <= 0) continue;
    if (step.output / (step.decodeMs / 1000) > IMPLAUSIBLE_TPS) continue;
    decodeMs += step.decodeMs;
    decodeTokens += step.output;
    timed += 1;
  }
  return {
    tps: decodeMs > 0 ? decodeTokens / (decodeMs / 1000) : null,
    timed,
    avgTtftMs: ttftCount > 0 ? ttftSum / ttftCount : null,
  };
}

/** 运行时钟：running 时每秒走一拍。 */
function useTicker(running: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * 从活动流 + 任务行算当前会话的运行计量。
 * @param activities - 会话窗口的活动（真实 SSE/历史数据）。
 * @param task - 当前选中任务行（tokens / 生效 profile）。
 * @param running - 后端 chatRun 的 running。
 * @param contextWindowTokens - 当前生效 profile 的 `context_window_k * 1000`；未知传 null。
 * @returns 计量快照。
 */
export function useConversationUsage(
  activities: readonly Activity[],
  task: Task | null,
  running: boolean,
  contextWindowTokens: number | null,
): ConversationUsageMetrics {
  const now = useTicker(running);
  const steps = React.useMemo(() => usageSteps(activities), [activities]);
  return React.useMemo(() => {
    if (task === null) return EMPTY_USAGE;
    const userTurns = activities.filter((row) => row.kind === "user").length;
    const turns = userTurns === 0 && steps.length > 0 ? 1 : userTurns;

    let turnStart: number | null = null;
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      if (activities[index].kind === "user") {
        const ts = Date.parse(activities[index].ts);
        if (!Number.isNaN(ts)) turnStart = ts;
        break;
      }
    }
    const lastTs = activities.length > 0 ? Date.parse(activities[activities.length - 1].ts) : NaN;
    const endClock = running ? now : Number.isNaN(lastTs) ? now : lastTs;
    const elapsedSecs = turnStart !== null ? Math.max(0, Math.round((endClock - turnStart) / 1000)) : null;

    const speed = decodeSpeed(steps);

    // 整任务用量：任务行（每个循环最终累计值之和）优先，否则单步增量求和。
    const stepInput = steps.reduce((sum, step) => sum + step.input, 0);
    const stepOutput = steps.reduce((sum, step) => sum + step.output, 0);
    const stepCacheRead = steps.reduce((sum, step) => sum + step.cacheRead, 0);
    const input = task.tokens?.input_tokens ?? stepInput;
    const output = task.tokens?.output_tokens ?? stepOutput;
    const cacheRead = task.tokens?.cache_read_tokens ?? stepCacheRead;
    const totalTokens = input + output;
    const cacheHitPercent = input > 0 ? Math.round((Math.min(cacheRead, input) / input) * 100) : null;

    // 上下文：主 Agent 最近一步的 prompt 大小；没有主 Agent 调用时取最近一步。
    let contextStep: UsageStep | null = null;
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (steps[index].worker === "mainagent") {
        contextStep = steps[index];
        break;
      }
    }
    if (contextStep === null && steps.length > 0) contextStep = steps[steps.length - 1];

    return {
      turns,
      steps: steps.length,
      elapsedSecs,
      tokensPerSecond: speed.tps,
      timedSteps: speed.timed,
      avgTtftMs: speed.avgTtftMs,
      totalTokens,
      cacheHitPercent,
      contextTokens: contextStep === null ? null : contextStep.input,
      contextWorker: contextStep === null ? null : contextStep.worker,
      contextWindowTokens,
    };
  }, [activities, steps, task, running, now, contextWindowTokens]);
}

/** DSH `formatTokensPerSecond`（message-chrome.ts:71-74）：≥10 取整，<10 保留一位。 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/** DSH `formatTokens`：517 / 12.2K / 517K / 1.2M。 */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const scaled = value / 1000;
    return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}K`;
  }
  const scaled = value / 1_000_000;
  return `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}M`;
}

/** DSH `formatDuration`：45.2s / 2m42s。 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}
