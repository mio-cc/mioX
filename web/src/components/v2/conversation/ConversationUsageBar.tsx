"use client";

/**
 * 输入卡下方的统计条（照抄 DSH ui-chat `StatsPills.tsx` 的 pill 三件套：
 * ActivityPill `{turns} 轮 {steps} 步`（IconGauge）+ `{tps} tok/s`，
 * UsagePill `已消耗 {count} tok`（IconDatabase）+ `缓存命中 {percent}%` + `上下文 x%`——
 * 有窗口时给百分比，没窗口时给绝对值 `上下文 43.2K`，与已消耗/缓存命中同一
 * 中点分隔（DSH 上下文口径见 `ContextMeter`：最近一次调用的 prompt ÷ 窗口）。
 * 字号 pill 12px（DSH `StatsPills.module.css` .anchor 的 13px-1px）。
 */
import * as React from "react";

import type { Activity, Task } from "@/lib/types";
import {
  formatDuration,
  formatTokens,
  formatTokensPerSecond,
  useConversationUsage,
} from "@/v2/data/conversation-usage";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import { IconDatabaseOutlineRegular, IconGaugeOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import css from "./ConversationUsageBar.module.css";

function percentOf(contextTokens: number | null, windowTokens: number | null): number | null {
  if (contextTokens === null || windowTokens === null || windowTokens <= 0) return null;
  return Math.min(100, Math.round((contextTokens / windowTokens) * 100));
}

/** DSH `.pill` 的 span 形式（静态读数）：`icon label`；title 写明每个数字的口径。 */
function PlainPill({
  stat,
  icon,
  title,
  children,
}: {
  stat: string;
  icon: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <span className={css.pill} data-composer-stat={stat} title={title}>
      {icon}
      <span className={css.label}>{children}</span>
    </span>
  );
}

export interface ConversationUsageBarProps {
  /** 会话窗口的活动流（真实 SSE/历史）。 */
  readonly activities: readonly Activity[];
  /** 当前选中任务行（tokens / 生效 profile）。 */
  readonly task: Task | null;
  /** 后端 chatRun 的 running。 */
  readonly running: boolean;
}

/**
 * 渲染 DSH 三件套统计条；无任何 usage 数据时返回 null（不占位）。
 * @param props - 活动流、任务行、运行态。
 * @returns 卡下状态条。
 */
export function ConversationUsageBar({ activities, task, running }: ConversationUsageBarProps): React.ReactNode {
  const profiles = useLlmProfiles();
  const contextWindowTokens = React.useMemo(() => {
    if (task === null) return null;
    const id = task.active_llm_profile_id ?? task.llm_profile_id;
    const byId = id === undefined ? undefined : profiles.profiles.find((row) => Number(row.id) === Number(id));
    const profile =
      byId ??
      (id === undefined
        ? (profiles.profiles.find((row) => row.is_default === true) ?? profiles.profiles[0])
        : undefined);
    if (profile === undefined) return null;
    // Same resolution as the backend's compaction window (agent/provider.go:123-134
    // CompactionWindow): 0/unset → 200K default, clamped to [32K, 1M]. The bar then
    // shows how close the main agent is to the point where its context is compacted.
    const raw = profile.context_window_k;
    const k = typeof raw === "number" && raw > 0 ? Math.min(1000, Math.max(32, raw)) : 200;
    return k * 1000;
  }, [profiles.profiles, task]);

  const usage = useConversationUsage(activities, task, running, contextWindowTokens);
  if (task === null || usage.steps === 0) return null;

  const percent = percentOf(usage.contextTokens, usage.contextWindowTokens);
  const gauge = <IconGaugeOutlineRegular />;
  const database = <IconDatabaseOutlineRegular />;
  const tps = usage.tokensPerSecond;
  const activityTitle = [
    `${usage.turns} 轮用户回合，${usage.steps} 次模型调用`,
    usage.elapsedSecs === null ? null : `本轮耗时 ${formatDuration(usage.elapsedSecs)}`,
    tps === null
      ? "解码速度：暂无计时数据（只统计带首 token 计时的调用）"
      : `解码速度 ${formatTokensPerSecond(tps)} tok/s（${usage.timedSteps} 次计时调用：输出 token ÷ 解码耗时，不含等待首 token 与工具执行）`,
    usage.avgTtftMs === null ? null : `平均首 token ${formatDuration(usage.avgTtftMs / 1000)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return (
    <div className={css.row} data-usage-bar="" data-running={running ? "" : undefined}>
      {/* ActivityPill：counts +（运行中）elapsed + tok/s；分隔点照抄 DSH .sep。 */}
      <PlainPill stat="activity" icon={gauge} title={activityTitle}>
        {usage.turns} 轮 {usage.steps} 步
        {usage.elapsedSecs !== null ? (
          <>
            <span className={css.sep} aria-hidden="true">
              ·
            </span>
            {formatDuration(usage.elapsedSecs)}
          </>
        ) : null}
        {tps !== null ? (
          <>
            <span className={css.sep} aria-hidden="true">
              ·
            </span>
            <span data-usage-tps={formatTokensPerSecond(tps)}>{formatTokensPerSecond(tps)} tok/s</span>
          </>
        ) : null}
      </PlainPill>
      {/* UsagePill：已消耗 {count} tok · 缓存命中 {percent}%。 */}
      <PlainPill
        stat="usage"
        icon={database}
        title={`整任务 token：输入（含缓存）+ 输出 = ${usage.totalTokens.toLocaleString("zh-CN")}${usage.cacheHitPercent === null ? "" : `；缓存命中 = 缓存读 ÷ 输入 = ${usage.cacheHitPercent}%`}`}
      >
        已消耗 {formatTokens(usage.totalTokens)} tok
        {usage.cacheHitPercent !== null ? (
          <>
            <span className={css.sep} aria-hidden="true">
              ·
            </span>
            缓存命中 {usage.cacheHitPercent}%
          </>
        ) : null}
        {/* 上下文段：与已消耗/缓存命中同一中点分隔。分子 = 主 Agent 最近一步的提示
            大小（conversation-usage 的单步增量口径）；窗口 = 后端压缩窗口（配置的
            context_window_k，未设置按 200K，与 agent/provider.go CompactionWindow 一致）。 */}
        {usage.contextTokens !== null ? (
          <span
            className={css.contextText}
            data-usage-context=""
            title={
              usage.contextWindowTokens !== null && usage.contextWindowTokens > 0
                ? `上下文 ${formatTokens(usage.contextTokens)} / ${formatTokens(usage.contextWindowTokens)}（主 Agent 最近一步的提示 ÷ 上下文窗口；配置未填窗口时按后端默认 200K 计）`
                : `上下文 ${formatTokens(usage.contextTokens)}（主 Agent 最近一步的提示大小）`
            }
          >
            <span className={css.sep} aria-hidden="true">
              ·
            </span>
            {percent !== null ? `上下文 ${percent}%` : `上下文 ${formatTokens(usage.contextTokens)}`}
          </span>
        ) : null}
      </PlainPill>
    </div>
  );
}
