"use client";

/**
 * 总览页图表区（对照表 P2:A8、P2:A9、P2:A10、P2:A14、P2:A15）：token 消耗图（数据源切换 +
 * profile 页签 + 每日范围）、发现分布（按严重等级 / 按处置状态）、资产分布、流量状态码与最近请求、
 * 任务状态分布。
 * 旧页面依据：ARTEX/web/src/app/(main)/dashboard/page.tsx:589-845（LLM Token 消耗卡：:597-627 旧版/新版
 *   数据源开关、:629-675 profile 页签、:681-751 合计与三段占比及缓存命中率、:753-843 每日柱图与
 *   7/30/90/180/365 天范围）、:1046-1074（资产分布）、:1076-1123（流量状态码 + 最近请求）、
 *   :259-263（任务状态计数）；发现按严重等级复用 C02 的 KPI 派生口径 :265-271。
 * DSH 依据：DSH 无图表原语，按「主区整页」扩展（100-实施计划总表 §4.1）。条形图用 div 宽度百分比，
 *   每日趋势用内联 `<svg>` 堆叠柱 + 折线（不引入图表库），颜色只用 `--dsw-*`。
 * 数据全部来自 `v2/data/dashboard.ts`：token 三路由 `useDashboardTokenUsage`（15 秒轮询，失败保留旧值），
 *   资产与流量复用 C02 的慢源 `useDashboardSlow`，任务与发现复用任务组 / 快源。
 *
 * 四种状态（总表 §5.4）：每张图表卡都有加载 / 失败（显示原因 + 重试）/ 空 / 有数据。
 */

import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { FilterBar, type FilterOption } from "@/components/v2/design/Kit";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconRefreshOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import type { TrafficExchange } from "@/lib/types";
import {
  DASHBOARD_ASSET_TYPE_LABEL,
  DASHBOARD_TASK_STATUS_LABEL,
  type DailyTokenPoint,
  type DashboardFastState,
  type DashboardPhase,
  type DashboardSlowState,
  type DashboardTasksState,
  type TokenBucket,
  type TokenDays,
  type TokenVersion,
  assetTypeRows,
  cacheHitPercent,
  countFindingsByStatus,
  countTasksByStatus,
  dailyTokenSeries,
  formatRelative,
  formatTokens,
  recentTrafficPage,
  sumTokenBuckets,
  totalAssets,
  tokenByProfileLegacy,
  tokenByProfileLedger,
  trafficStatusBuckets,
  trafficStatusTone,
  useDashboardTokenUsage,
} from "@/v2/data/dashboard";

import css from "./dashboard.module.css";

/** 每日趋势的范围档位（`TokenDays`）；旧页 :768-775 的 90 岁以上长尾不画，改用「更多」保留 60 天。 */
const TOKEN_DAY_OPTIONS: readonly FilterOption<string>[] = [
  { value: "7", label: "7 天" },
  { value: "14", label: "14 天" },
  { value: "30", label: "30 天" },
  { value: "60", label: "更多" },
];

/** 数据源档位（旧页 :597-612）。 */
const TOKEN_VERSION_OPTIONS: readonly FilterOption<string>[] = [
  { value: "legacy", label: "旧版" },
  { value: "ledger", label: "新版" },
];

/** 数据源说明（旧页 :608-612 的 title 文案）。 */
const TOKEN_VERSION_HINT: Record<TokenVersion, string> = {
  legacy: "旧版：来自 activity 统计（含历史任务），中断消耗不计、无法精确到模型",
  ledger: "新版：来自 llm_usage 计量账本，逐次调用精确、含中断消耗；仅覆盖启用后的数据",
};

/** 严重度的中文名（与 DashboardPage.tsx / findings-page.ts 同口径）。 */
function severityLabel(severity: string): string {
  if (severity === "critical") return "严重";
  if (severity === "high") return "高危";
  if (severity === "medium") return "中危";
  if (severity === "low") return "低危";
  return severity;
}

/** 发现处置状态的中文名（与 `v2/data/findings-page.ts` 的 STATUS_LABEL 同口径）。 */
const FINDING_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  in_progress: "处理中",
  confirmed: "已确认",
  resolved: "已处理",
  fixed: "已修复",
  false_positive: "误报",
  ignored: "忽略",
  duplicate: "重复",
  risk_accepted: "风险接受",
};

/**
 * 一段文字的条形行（div 宽度百分比，旧页 :1057-1069 的资产条形同款）。
 * @param props.label - 左侧名称。
 * @param props.count - 数值。
 * @param props.max - 比例基准（最大那一项）。
 * @param props.tone - 填充色用哪支 `--dsw-*` 状态色。
 * @returns 一行条形。
 */
function BarRow({
  label,
  count,
  max,
  tone,
  slot,
}: {
  label: string;
  count: number;
  max: number;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  slot: string;
}): ReactNode {
  const pct = max > 0 ? Math.max(0, Math.min(100, (count / max) * 100)) : 0;
  return (
    <div className={css.barRow} data-dashboard-bar={slot}>
      <span className={css.barLabel} title={label}>
        {label}
      </span>
      <span className={css.barTrack} aria-hidden="true">
        <span className={css.barFill} data-tone={tone} style={{ width: `${pct}%` }} />
      </span>
      <span className={css.barValue}>{count}</span>
    </div>
  );
}

/** 图表卡的四态；有数据时返回 null，由调用方画图。 */
function ChartState({
  phase,
  error,
  empty,
  emptyText,
  onRetry,
  slot,
}: {
  phase: DashboardPhase;
  error: string | null;
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
  slot: string;
}): ReactNode {
  if (phase === "loading") {
    return (
      <div className={css.state} data-dashboard-chart-state={slot}>
        加载中…
      </div>
    );
  }
  if (phase === "offline") {
    return (
      <div className={css.stateError} role="alert" data-dashboard-chart-state={slot}>
        <span>读取失败：{error ?? "未知错误"}</span>
        <Button variant="outline" size="sm" onClick={onRetry} data-dashboard-chart-action={`retry-${slot}`}>
          重试
        </Button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className={css.empty} data-dashboard-chart-state={slot}>
        {emptyText}
      </div>
    );
  }
  return null;
}

/** 每日柱图的一段填充色（旧页 :837-839 的 input / output / cacheRead 三色）。 */
const DAILY_SEGMENTS = [
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cacheRead", label: "缓存读" },
] as const;

/**
 * 每日趋势的堆叠柱 + 折线（内联 svg，`viewBox` 固定、宽度 100% 自适应窄主区）。
 * @param props.points - 按日期升序的每日点。
 * @returns svg 元素。
 */
function DailyChart({ points }: { points: readonly DailyTokenPoint[] }): ReactNode {
  // viewBox 坐标；实际尺寸交给 CSS（width: 100%），窄主区不会溢出。
  const width = 560;
  const height = 200;
  const padLeft = 6;
  const padRight = 6;
  const padTop = 8;
  const padBottom = 24;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = Math.max(
    ...points.map((point) => point.input + point.output + point.cacheRead),
    1,
  );
  const slot = plotW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(28, slot * 0.6));

  /** 总高度里的折线点（合计 / max）。 */
  const linePoints = points
    .map((point, index) => {
      const total = point.input + point.output + point.cacheRead;
      const x = padLeft + slot * index + slot / 2;
      const y = padTop + plotH - (total / max) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  /** 只给少数日期打刻度，避免 60 天时挤在一起。 */
  const tickEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <svg
      className={css.dailyChart}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`近 ${points.length} 天 token 每日用量`}
      data-dashboard-chart="daily"
    >
      <line
        className={css.chartAxis}
        x1={padLeft}
        y1={padTop + plotH}
        x2={padLeft + plotW}
        y2={padTop + plotH}
      />
      {points.map((point, index) => {
        const total = point.input + point.output + point.cacheRead;
        const x = padLeft + slot * index + (slot - barW) / 2;
        const hInput = (point.input / max) * plotH;
        const hOutput = (point.output / max) * plotH;
        const hCache = (point.cacheRead / max) * plotH;
        let cursor = padTop + plotH;
        const segments = [
          { h: hInput, tone: "input" },
          { h: hOutput, tone: "output" },
          { h: hCache, tone: "cacheRead" },
        ].filter((segment) => segment.h > 0);
        return (
          <g key={point.date}>
            {segments.map((segment) => {
              cursor -= segment.h;
              return (
                <rect
                  key={segment.tone}
                  x={x}
                  y={cursor}
                  width={barW}
                  height={segment.h}
                  className={css.chartBar}
                  data-tone={segment.tone}
                >
                  <title>{`${point.date} · 合计 ${formatTokens(total)}`}</title>
                </rect>
              );
            })}
            {index % tickEvery === 0 ? (
              <text
                className={css.chartTick}
                x={padLeft + slot * index + slot / 2}
                y={height - 6}
                textAnchor="middle"
              >
                {point.date.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
      {points.length > 1 ? <polyline className={css.chartLine} points={linePoints} /> : null}
    </svg>
  );
}

/** 三段占比条（旧页 :692-733）：输入未命中 / 缓存命中 / 输出，三段不重叠。 */
function TokenTypeBars({ bucket }: { bucket: TokenBucket }): ReactNode {
  const total = bucket.input + bucket.output;
  const unmetered = Math.max(0, bucket.input - bucket.cacheRead);
  const rows = [
    { label: "输入(未命中)", value: unmetered, tone: "info" as const },
    { label: "缓存命中", value: bucket.cacheRead, tone: "success" as const },
    { label: "输出", value: bucket.output, tone: "neutral" as const },
  ];
  const max = Math.max(unmetered, bucket.cacheRead, bucket.output, 1);
  return (
    <div className={css.chartBars} data-dashboard-chart="token-types">
      {rows.map((row) => {
        const pct = total > 0 ? (row.value / total) * 100 : 0;
        return (
          <div key={row.label} className={css.barRow}>
            <span className={css.barLabel}>{row.label}</span>
            <span className={css.barTrack} aria-hidden="true">
              <span
                className={css.barFill}
                data-tone={row.tone}
                style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (row.value / max) * 100)) : 0}%` }}
              />
            </span>
            <span className={css.barValue}>
              {formatTokens(row.value)}
              <span className={css.dim}> · {Math.round(pct)}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 渲染总览页的图表区。
 * @param props.tasks - C02 任务组状态（任务状态分布用）。
 * @param props.fast - C02 快源状态（发现按严重等级 / 按状态聚合用）。
 * @param props.slow - C02 慢源状态（资产分布、流量状态码与最近请求用）。
 * @returns 五张图表卡，窄主区（约 513px）下纵向堆叠、宽度 100%。
 */
export function DashboardCharts({
  tasks,
  fast,
  slow,
}: {
  tasks: DashboardTasksState;
  fast: DashboardFastState;
  slow: DashboardSlowState;
}): ReactNode {
  const [tokenDays, setTokenDays] = useState<TokenDays>(14);
  const [tokenVersion, setTokenVersion] = useState<TokenVersion>("legacy");
  const [tokenTab, setTokenTab] = useState<string>("all");

  const tokenUsage = useDashboardTokenUsage(tokenDays);

  const profiles = tokenUsage.profiles;
  const defaultProfileId = useMemo(() => {
    const found = profiles.find((profile) => profile.is_default);
    return found === undefined ? null : Number(found.id);
  }, [profiles]);

  /** profile 页签：默认配置的桶用「全部」之外的独立项表达（旧页 :642-674）。 */
  const profileOptions = useMemo<readonly FilterOption<string>[]>(() => {
    const options: FilterOption<string>[] = [{ value: "all", label: "全部" }];
    for (const profile of profiles) {
      options.push({
        value: String(profile.id),
        label: profile.is_default ? `${profile.name}（默认）` : profile.name,
      });
    }
    return options;
  }, [profiles]);

  /** 选中的 profile；页签指向已删除的配置时退回「全部」。 */
  const selectedProfile = tokenTab === "all" || profileOptions.some((option) => option.value === tokenTab)
    ? tokenTab
    : "all";

  /** 每日趋势按当前数据源与 profile 页签过滤（旧页 :426-471）。 */
  const dailyPoints = useMemo(
    () =>
      dailyTokenSeries(
        tokenVersion,
        tasks.tasks,
        tokenUsage.conversations,
        tokenUsage.usage,
        profiles,
        tokenDays,
        selectedProfile === "all" ? "all" : Number(selectedProfile),
      ),
    [tokenVersion, tasks.tasks, tokenUsage.conversations, tokenUsage.usage, profiles, tokenDays, selectedProfile],
  );

  /** 合计桶：旧版来自任务 + 会话，新版来自 llm_usage（旧页 :348-423）。 */
  const tokenTotalBucket = useMemo(() => {
    const source = tokenVersion === "legacy"
      ? tokenByProfileLegacy(tasks.tasks, tokenUsage.conversations, defaultProfileId)
      : tokenByProfileLedger(tokenUsage.usage, profiles, defaultProfileId);
    return sumTokenBuckets(source, selectedProfile === "all" ? "all" : Number(selectedProfile));
  }, [
    tokenVersion,
    tasks.tasks,
    tokenUsage.conversations,
    tokenUsage.usage,
    profiles,
    defaultProfileId,
    selectedProfile,
  ]);

  /** 发现按严重等级（旧页 :265-271，与 C02 的 KPI 同口径）。 */
  const findingsBySeverity = useMemo(() => {
    const map = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of fast.findings) {
      if (finding.severity in map) map[finding.severity as keyof typeof map] += 1;
    }
    return map;
  }, [fast.findings]);

  const findingsByStatus = useMemo(() => countFindingsByStatus(fast.findings), [fast.findings]);

  const tasksByStatus = useMemo(() => countTasksByStatus(tasks.tasks), [tasks.tasks]);

  const assetRows = useMemo(() => assetTypeRows(slow.assetCounts), [slow.assetCounts]);
  const assetTotal = useMemo(() => totalAssets(slow.assetCounts), [slow.assetCounts]);

  const statusBuckets = useMemo(() => trafficStatusBuckets(slow.traffic), [slow.traffic]);
  const recentTraffic = useMemo(() => recentTrafficPage(slow.traffic), [slow.traffic]);

  const tokenBytes = cacheHitPercent(tokenTotalBucket);
  const tokenSum = tokenTotalBucket.input + tokenTotalBucket.output;

  return (
    <div className={css.chartGrid} role="group" aria-label="总览图表" data-dashboard-charts="">
      {/* ── Token 消耗（P2:A8 数据源切换、P2:A9 profile 页签、P2:A10 时间范围） ── */}
      <section
        className={css.chartCard}
        data-dashboard-chart-card="tokens"
        data-dashboard-chart-phase={tokenUsage.phase}
      >
        <header className={css.chartHead}>
          <h2 className={css.chartTitle}>LLM Token 消耗</h2>
          <div className={css.chartTools} role="toolbar" aria-label="Token 图表设置">
            <FilterBar
              id="dashboard-token-version"
              value={tokenVersion}
              options={TOKEN_VERSION_OPTIONS}
              onChange={(next) => setTokenVersion(next === "ledger" ? "ledger" : "legacy")}
              label="Token 数据源"
            />
            <FilterBar
              id="dashboard-token-days"
              value={String(tokenDays)}
              options={TOKEN_DAY_OPTIONS}
              onChange={(next) => {
                const days = Number(next);
                if (days === 7 || days === 14 || days === 30 || days === 60) setTokenDays(days);
              }}
              label="每日趋势范围"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={tokenUsage.reload}
              title="立即重读 token 图表数据"
              aria-label="立即重读 token 图表数据"
              icon={<IconRefreshOutlineRegular size={13} />}
              data-dashboard-chart-action="refresh-tokens"
            />
          </div>
        </header>
        <p className={css.chartHint} title={TOKEN_VERSION_HINT[tokenVersion]}>
          {TOKEN_VERSION_HINT[tokenVersion]}
        </p>

        <ChartState
          phase={tokenUsage.phase}
          error={tokenUsage.error}
          empty={false}
          emptyText="暂无 token 数据"
          onRetry={tokenUsage.reload}
          slot="tokens"
        />

        {tokenUsage.phase === "ready" ? (
          <>
            {profileOptions.length > 1 ? (
              <FilterBar
                id="dashboard-token-profile"
                value={selectedProfile}
                options={profileOptions}
                onChange={setTokenTab}
                label="Token 按 LLM 配置"
              />
            ) : null}

            <div className={css.tokenStats} data-dashboard-token-total={tokenSum}>
              <div className={css.tokenStat}>
                <span className={css.tokenStatLabel}>合计 (输入+输出)</span>
                <span className={css.tokenStatValue}>{formatTokens(tokenSum)}</span>
                <span className={css.tokenStatMeta}>{tokenTotalBucket.taskCount} 个任务</span>
              </div>
              <div className={css.tokenStat}>
                <span className={css.tokenStatLabel}>缓存命中率</span>
                <span className={css.tokenStatValue}>{tokenBytes}%</span>
                <span className={css.tokenStatMeta}>
                  缓存读 {formatTokens(tokenTotalBucket.cacheRead)} / 缓存写 {formatTokens(tokenTotalBucket.cacheWrite)}
                </span>
              </div>
            </div>

            <TokenTypeBars bucket={tokenTotalBucket} />

            {dailyPoints.length === 0 ? (
              <div className={css.empty} data-dashboard-chart-state="daily">
                近 {tokenDays} 天暂无每日用量
              </div>
            ) : (
              <>
                <div className={css.chartLegend}>
                  {DAILY_SEGMENTS.map((segment) => (
                    <span key={segment.key} className={css.legendItem}>
                      <span className={css.legendSwatch} data-tone={segment.key} aria-hidden="true" />
                      {segment.label}
                    </span>
                  ))}
                  <span className={css.dim}>折线 = 当日合计</span>
                </div>
                <DailyChart points={dailyPoints} />
              </>
            )}
          </>
        ) : null}
      </section>

      {/* ── 发现分布（按严重等级 / 按状态） ── */}
      <section className={css.chartCard} data-dashboard-chart-card="findings" data-dashboard-chart-phase={fast.phase}>
        <header className={css.chartHead}>
          <h2 className={css.chartTitle}>发现分布</h2>
          <span className={css.chartCount}>{fast.phase === "ready" ? `${fast.findings.length} 条` : null}</span>
        </header>
        <ChartState
          phase={fast.phase}
          error={fast.error}
          empty={fast.findings.length === 0}
          emptyText="暂无发现"
          onRetry={fast.reload}
          slot="findings"
        />
        {fast.phase === "ready" && fast.findings.length > 0 ? (
          <div className={css.chartBars}>
            <div className={css.barGroupTitle}>按严重等级</div>
            {(["critical", "high", "medium", "low"] as const).map((severity) => (
              <BarRow
                key={severity}
                label={severityLabel(severity)}
                count={findingsBySeverity[severity]}
                max={Math.max(...Object.values(findingsBySeverity), 1)}
                tone={severity === "critical" ? "danger" : severity === "high" ? "warning" : severity === "medium" ? "info" : "neutral"}
                slot={`severity-${severity}`}
              />
            ))}
            <div className={css.barGroupTitle}>按处置状态</div>
            {Object.keys(findingsByStatus).length === 0 ? (
              <div className={css.dim}>暂无处置状态</div>
            ) : (
              Object.entries(findingsByStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <BarRow
                    key={status}
                    label={FINDING_STATUS_LABEL[status] ?? status}
                    count={count}
                    max={Math.max(...Object.values(findingsByStatus), 1)}
                    tone="info"
                    slot={`status-${status}`}
                  />
                ))
            )}
          </div>
        ) : null}
      </section>

      {/* ── 资产分布（P2:A14） ── */}
      <section className={css.chartCard} data-dashboard-chart-card="assets" data-dashboard-chart-phase={slow.phase}>
        <header className={css.chartHead}>
          <h2 className={css.chartTitle}>资产分布</h2>
          <span className={css.chartCount}>{slow.phase === "ready" ? "按类型" : null}</span>
        </header>
        <ChartState
          phase={slow.phase}
          error={slow.error}
          empty={assetRows.length === 0}
          emptyText="暂无资产数据"
          onRetry={slow.reload}
          slot="assets"
        />
        {slow.phase === "ready" && assetRows.length > 0 ? (
          <>
            <div className={css.chartBars}>
              {assetRows.map(([type, count]) => (
                <BarRow
                  key={type}
                  label={DASHBOARD_ASSET_TYPE_LABEL[type] ?? type}
                  count={count}
                  max={assetRows[0]?.[1] ?? 1}
                  tone="info"
                  slot={`asset-${type}`}
                />
              ))}
            </div>
            <div className={css.chartFoot}>共 {assetTotal} 节点</div>
          </>
        ) : null}
      </section>

      {/* ── 流量状态码 + 最近请求（P2:A15） ── */}
      <section className={css.chartCard} data-dashboard-chart-card="traffic" data-dashboard-chart-phase={slow.phase}>
        <header className={css.chartHead}>
          <h2 className={css.chartTitle}>流量状态码</h2>
          <span className={css.chartCount}>{slow.phase === "ready" ? `${slow.traffic.length} 次请求` : null}</span>
        </header>
        <ChartState
          phase={slow.phase}
          error={slow.error}
          empty={slow.traffic.length === 0}
          emptyText="暂无流量数据"
          onRetry={slow.reload}
          slot="traffic"
        />
        {slow.phase === "ready" && slow.traffic.length > 0 ? (
          <>
            <div className={css.codeBars} data-dashboard-chart="traffic-codes">
              {statusBuckets.map((bucket) => {
                const max = Math.max(...statusBuckets.map((row) => row.n), 1);
                return (
                  <div key={bucket.code} className={css.codeBar}>
                    <span className={css.codeBarValue}>{bucket.n}</span>
                    <span className={css.codeBarTrack} aria-hidden="true">
                      <span
                        className={css.barFill}
                        data-tone={trafficStatusTone(bucket.code)}
                        style={{ height: `${Math.max(6, (bucket.n / max) * 100)}%` }}
                      />
                    </span>
                    <Tag tone={trafficStatusTone(bucket.code)}>{bucket.code}</Tag>
                  </div>
                );
              })}
            </div>
            <div className={css.chartFoot}>最近请求</div>
            <ul className={css.trafficList}>
              {recentTraffic.map((exchange: TrafficExchange) => (
                <li key={exchange.id} className={css.trafficRow} data-dashboard-traffic={exchange.id}>
                  <Tag tone={exchange.method === "GET" ? "success" : "info"}>{exchange.method}</Tag>
                  <span className={css.trafficUrl} title={exchange.url}>
                    {exchange.host}
                    {exchange.url.replace(/^https?:\/\/[^/]+/, "")}
                  </span>
                  <Tag tone={trafficStatusTone(exchange.status)}>{exchange.status}</Tag>
                  <span className={css.time}>{formatRelative(exchange.ts)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* ── 任务状态分布（旧页 :259-263 的 tasksByStatus） ── */}
      <section className={css.chartCard} data-dashboard-chart-card="tasks" data-dashboard-chart-phase={tasks.phase}>
        <header className={css.chartHead}>
          <h2 className={css.chartTitle}>任务状态</h2>
          <span className={css.chartCount}>{tasks.phase === "ready" ? `${tasks.tasks.length} 个任务` : null}</span>
        </header>
        <ChartState
          phase={tasks.phase}
          error={tasks.error}
          empty={tasks.tasks.length === 0}
          emptyText="暂无任务"
          onRetry={tasks.reload}
          slot="tasks"
        />
        {tasks.phase === "ready" && tasks.tasks.length > 0 ? (
          <div className={css.chartBars}>
            {Object.entries(tasksByStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => (
                <BarRow
                  key={status}
                  label={DASHBOARD_TASK_STATUS_LABEL[status] ?? status}
                  count={count}
                  max={Math.max(...Object.values(tasksByStatus), 1)}
                  tone={
                    status === "done"
                      ? "success"
                      : status === "failed" || status === "timeout"
                        ? "danger"
                        : status === "running"
                          ? "info"
                          : "neutral"
                  }
                  slot={`task-${status}`}
                />
              ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
