"use client";

/**
 * 总览页（对照表 P2:A1–A7、P2:A11–A13、P2:A16、P2:A17）：整页只读仪表盘，
 * 五张 KPI 卡、活动流、最近发现、最近任务表、系统状态与系统静态计数。
 * 旧页面依据：ARTEX/web/src/app/(main)/dashboard/page.tsx:494-587（页头 + 五张 KPI 卡）、
 *   :847-953（活动流与最近发现）、:956-1042（任务表）、:1129-1207（系统状态 + 待审批）。
 * DSH 依据：DSH 无总览页，按「主区整页」扩展（100-实施计划总表 §4.1）；卡片外框照抄
 *   `components/v2/findings/FindingsDataPage.tsx:232-249` 的标题/说明/右侧动作几何，
 *   四种状态照 §5.4。
 * 图表（Token 消耗与每日趋势、发现分布、资产分布、流量状态码、任务状态）由 C03 的
 * `DashboardCharts.tsx` 渲染，本文件只挂载一行，不动已有卡片。
 *
 * 数据全部来自 `v2/data/dashboard.ts`：三组独立轮询（任务 5s / 快源 5s / 慢源 15s），
 * 失败保留上一次的值；所以一组的失败只会让依赖它的卡片显示该卡失败，整页仍是可用的。
 *
 * 任务入口的说明（红线 3，不画假链接）：旧页 page.tsx:999 的
 * `/function/tasks/detail?id=` 是旧路由，/v2 里任务详情就是会话视图，没有可构造的地址；
 * Shell 也不导出「选中任务」的接口（`Shell.tsx:116` 的 active 是组件内 state）。因此活动流
 * 行与任务表行**不做假跳转**，只显示真实字段，并提供「返回会话」真实 SPA 导航。
 * 漏洞行与「全部」有真实目的地（`?page=findings&finding=<id>` / `?page=findings`）。
 */
import { type ReactNode, useMemo } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag, type TagTone } from "@/vendor/dsh/primitives/Tag";
import {
  IconGoalOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconShieldOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import type { Activity, Finding, Task } from "@/lib/types";
import {
  DASHBOARD_RECENT_ACTIVITY,
  DASHBOARD_RECENT_FINDINGS,
  DASHBOARD_RECENT_TASKS,
  DASHBOARD_TASK_STATUS_LABEL,
  activeProfile,
  formatRelative,
  formatTokens,
  openConversation,
  openFinding,
  openFindingsPage,
  openTrafficPage,
  sortTasksByActivity,
  totalAssets,
  useDashboardFast,
  useDashboardSlow,
  useDashboardTasks,
} from "@/v2/data/dashboard";

import css from "./dashboard.module.css";
import { DashboardCharts } from "./DashboardCharts";

/** 五张 KPI 卡在上、四块详情在下：窄主区（右栏打开时约 513px）自动换行。 */
const KPI_LABEL = {
  tasks: "活跃任务",
  findings: "确认发现",
  assets: "资产节点",
  traffic: "流量交互",
  tokens: "Token 用量",
} as const;

/** 任务状态 → Tag 色调（旧页 StatusBadge domain="task" 的配色语义）。 */
function taskStatusTone(status: string): TagTone {
  if (status === "running") return "info";
  if (status === "paused") return "warning";
  if (status === "done") return "success";
  if (status === "failed" || status === "timeout") return "danger";
  return "neutral";
}

/** 严重度 → Tag 色调，与发现页一致。 */
function severityTone(severity: string): TagTone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "neutral";
  return "outline";
}

/** 严重度的中文名（与 `v2/data/findings-page.ts:severityLabel` 同口径）。 */
function severityLabel(severity: string): string {
  if (severity === "critical") return "严重";
  if (severity === "high") return "高危";
  if (severity === "medium") return "中危";
  if (severity === "low") return "低危";
  return severity;
}

/** 活动 kind → 中文名；tool_use 显示具体工具名（旧页 page.tsx:474-478 `kindLabel`）。 */
function activityKindLabel(row: Activity): string {
  if (row.kind === "tool_use") return row.tool !== undefined && row.tool !== "" ? row.tool : "tool_use";
  return row.kind;
}

/** 活动 kind 的计数徽标要按固定顺序展示（旧页 page.tsx:870）。 */
const ACTIVITY_KINDS = ["tool_use", "tool_result", "text", "thinking", "result"] as const;

/**
 * 一张卡的外框：标题 + 右侧动作 + 状态区。
 * @param props.title - 卡片标题。
 * @param props.actions - 右上角的入口（可能为空）。
 * @param props.state - 卡片当前状态，渲染在 `data-dashboard-state` 上供审计。
 * @returns 卡片元素。
 */
function Card({
  title,
  slot,
  actions,
  state,
  children,
}: {
  title: string;
  slot: string;
  actions?: ReactNode;
  state: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className={css.card} data-dashboard-card={slot} data-dashboard-state={state}>
      <header className={css.cardHead}>
        <h2 className={css.cardTitle}>{title}</h2>
        {actions === undefined ? null : (
          <div className={css.cardActions} role="toolbar" aria-label={`${title}动作`}>
            {actions}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

/** 卡片内的加载 / 失败（可重试）/ 空三态；有数据时由调用方自己渲染列表。 */
function CardState({
  phase,
  error,
  empty,
  emptyText,
  onRetry,
  slot,
}: {
  phase: "loading" | "ready" | "offline";
  error: string | null;
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
  slot: string;
}): ReactNode {
  if (phase === "loading") {
    return (
      <div className={css.state} data-dashboard-card-state={slot}>
        加载中…
      </div>
    );
  }
  if (phase === "offline") {
    return (
      <div className={css.stateError} role="alert" data-dashboard-card-state={slot}>
        <span>读取失败：{error ?? "未知错误"}</span>
        <Button variant="outline" size="sm" onClick={onRetry} data-dashboard-action={`retry-${slot}`}>
          重试
        </Button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className={css.empty} data-dashboard-card-state={slot}>
        {emptyText}
      </div>
    );
  }
  return null;
}

/** 一行小号键值（系统状态用）。 */
function StatusRow({ label, children, field }: { label: string; children: ReactNode; field: string }): ReactNode {
  return (
    <div className={css.statusRow} data-dashboard-status={field}>
      <span className={css.statusLabel}>{label}</span>
      <span className={css.statusValue}>{children}</span>
    </div>
  );
}

/** 最近任务表的一行（窄主区靠外层横向滚动，表格不压扁列）。 */
function TaskRow({ task }: { task: Task }): ReactNode {
  const pct = task.goals_total !== undefined && task.goals_total > 0
    ? Math.round(((task.goals_met ?? 0) / task.goals_total) * 100)
    : null;
  return (
    <tr data-dashboard-task={task.id}>
      <td className={css.cellTask}>
        <span className={css.taskDesc}>{task.name !== undefined && task.name !== "" ? task.name : task.description}</span>
        <span className={css.mono}>{task.id}</span>
      </td>
      <td>
        <Tag tone={taskStatusTone(task.status)}>{DASHBOARD_TASK_STATUS_LABEL[task.status] ?? task.status}</Tag>
      </td>
      <td className={css.cellNum}>
        {pct === null ? (
          <span className={css.dim}>—</span>
        ) : (
          <span className={css.progress}>
            <span className={css.progressTrack} aria-hidden="true">
              <span className={css.progressFill} style={{ width: `${pct}%` }} />
            </span>
            <span className={css.progressText}>
              {task.goals_met ?? 0}/{task.goals_total}
            </span>
          </span>
        )}
      </td>
      <td className={css.cellNum}>
        {(task.in_flight ?? 0) > 0 ? <span className={css.strong}>{task.in_flight}</span> : <span className={css.dim}>—</span>}
      </td>
      <td className={css.cellTime}>{formatRelative(task.last_activity_unix ?? task.created_unix)}</td>
    </tr>
  );
}

/**
 * 渲染总览页。
 * @returns 页头、五张 KPI 卡、活动流、最近发现、最近任务表、系统状态与系统静态计数。
 */
export function DashboardPage(): ReactNode {
  const tasks = useDashboardTasks();
  const fast = useDashboardFast();
  const slow = useDashboardSlow();

  /** 任务状态计数（旧页 page.tsx:259-263）。 */
  const tasksByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of tasks.tasks) map[task.status] = (map[task.status] ?? 0) + 1;
    return map;
  }, [tasks.tasks]);

  /** 发现按严重度计数（旧页 page.tsx:265-271）。 */
  const findingsBySeverity = useMemo(() => {
    const map = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of fast.findings) {
      if (finding.severity in map) map[finding.severity as keyof typeof map] += 1;
    }
    return map;
  }, [fast.findings]);

  const recentTasks = useMemo(
    () => sortTasksByActivity(tasks.tasks).slice(0, DASHBOARD_RECENT_TASKS),
    [tasks.tasks],
  );

  const recentFindings = useMemo(
    () => [...fast.findings].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, DASHBOARD_RECENT_FINDINGS),
    [fast.findings],
  );

  const recentActivity = useMemo(
    () => [...fast.activity].sort((a, b) => b.seq - a.seq).slice(0, DASHBOARD_RECENT_ACTIVITY),
    [fast.activity],
  );

  /** 活动 kind 计数（旧页 page.tsx:870-878）。 */
  const activityByKind = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of fast.activity) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return counts;
  }, [fast.activity]);

  const assets = useMemo(() => totalAssets(slow.assetCounts), [slow.assetCounts]);

  const profile = useMemo(() => activeProfile(slow.llmProfiles), [slow.llmProfiles]);

  const pendingCount = fast.pending.length;

  /** KPI 卡的三态：只要有任一组仍在读且没有可显示的值就显示加载；对应组离线就显示失败。 */
  const tasksPhase = tasks.phase;
  const tokenTotal =
    fast.tokens === null ? null : fast.tokens.input_tokens + fast.tokens.output_tokens;

  return (
    <div data-data-page="dashboard" data-data-page-frame="shell" className={css.page}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>总览</h1>
          <p className={css.lead}>
            系统全局状态 · 实时刷新（任务与快源 5 秒，流量与系统清单 15 秒；读取失败保留上一次的值）
          </p>
        </div>
        <div className={css.headActions} role="toolbar" aria-label="总览页头动作">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              tasks.reload();
              fast.reload();
              slow.reload();
            }}
            title="立即重读全部三组数据"
            aria-label="立即重读全部三组数据"
            icon={<IconRefreshOutlineRegular size={13} />}
            data-data-page-action="refresh"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={openConversation}
            icon={<IconRightUpOutlineRegular size={13} />}
            data-dashboard-action="back-to-conversation"
          >
            返回会话
          </Button>
        </div>
      </header>

      {/* ── 五张 KPI 卡（P2:A3–A7） ── */}
      <div className={css.kpiGrid} role="group" aria-label="总览指标" data-data-page-summary="dashboard">
        <section className={css.kpi} data-dashboard-kpi="tasks" data-dashboard-phase={tasksPhase}>
          <span className={css.kpiLabel}>
            <IconGoalOutlineRegular size={13} />
            {KPI_LABEL.tasks}
          </span>
          {tasksPhase === "offline" ? (
            <span className={css.kpiError} role="alert">
              <span>读取失败：{tasks.error ?? "未知错误"}</span>
              <Button variant="outline" size="sm" onClick={tasks.reload} data-dashboard-action="retry-tasks">
                重试
              </Button>
            </span>
          ) : (
            <>
              <span className={css.kpiValue} data-dashboard-kpi-value="tasks-running">
                {tasksPhase === "loading" ? "…" : (tasksByStatus.running ?? 0)}
                <span className={css.kpiUnit}>/ {tasksPhase === "loading" ? "…" : tasks.tasks.length}</span>
              </span>
              <span className={css.kpiMeta}>
                {tasksPhase === "ready" && tasks.tasks.length === 0 ? (
                  <span className={css.dim}>暂无任务</span>
                ) : (
                  <>
                    {(tasksByStatus.running ?? 0) > 0 ? <span>运行 {tasksByStatus.running}</span> : null}
                    {(tasksByStatus.paused ?? 0) > 0 ? <span>暂停 {tasksByStatus.paused}</span> : null}
                    {(tasksByStatus.done ?? 0) > 0 ? <span>完成 {tasksByStatus.done}</span> : null}
                    {(tasksByStatus.failed ?? 0) + (tasksByStatus.timeout ?? 0) > 0 ? (
                      <span className={css.warn}>
                        失败 {(tasksByStatus.failed ?? 0) + (tasksByStatus.timeout ?? 0)}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </>
          )}
        </section>

        <section className={css.kpi} data-dashboard-kpi="findings" data-dashboard-phase={fast.phase}>
          <span className={css.kpiLabel}>
            <IconShieldOutlineRegular size={13} />
            {KPI_LABEL.findings}
          </span>
          {fast.phase === "offline" ? (
            <span className={css.kpiError} role="alert">
              <span>读取失败：{fast.error ?? "未知错误"}</span>
              <Button variant="outline" size="sm" onClick={fast.reload} data-dashboard-action="retry-findings">
                重试
              </Button>
            </span>
          ) : (
            <>
              <span className={css.kpiValue} data-dashboard-kpi-value="findings">
                {fast.phase === "loading" ? "…" : fast.findings.length}
              </span>
              <span className={css.kpiMeta}>
                {fast.phase === "loading" ? null : (
                  <>
                    <span>严重 {findingsBySeverity.critical}</span>
                    <span>高危 {findingsBySeverity.high}</span>
                    <span>中危 {findingsBySeverity.medium}</span>
                    <span>低危 {findingsBySeverity.low}</span>
                  </>
                )}
              </span>
            </>
          )}
        </section>

        <section className={css.kpi} data-dashboard-kpi="assets" data-dashboard-phase={slow.phase}>
          <span className={css.kpiLabel}>
            <IconGoalOutlineRegular size={13} />
            {KPI_LABEL.assets}
          </span>
          {slow.phase === "offline" ? (
            <span className={css.kpiError} role="alert">
              <span>读取失败：{slow.error ?? "未知错误"}</span>
              <Button variant="outline" size="sm" onClick={slow.reload} data-dashboard-action="retry-assets">
                重试
              </Button>
            </span>
          ) : (
            <>
              <span className={css.kpiValue} data-dashboard-kpi-value="assets">
                {slow.phase === "loading" ? "…" : assets}
              </span>
              <span className={css.kpiMeta}>跨任务共享</span>
            </>
          )}
        </section>

        <section className={css.kpi} data-dashboard-kpi="traffic" data-dashboard-phase={slow.phase}>
          <span className={css.kpiLabel}>
            <IconGoalOutlineRegular size={13} />
            {KPI_LABEL.traffic}
          </span>
          {slow.phase === "offline" ? (
            <span className={css.kpiError} role="alert">
              <span>读取失败：{slow.error ?? "未知错误"}</span>
              <Button variant="outline" size="sm" onClick={slow.reload} data-dashboard-action="retry-traffic">
                重试
              </Button>
            </span>
          ) : (
            <>
              <span className={css.kpiValue} data-dashboard-kpi-value="traffic">
                {slow.phase === "loading" ? "…" : (slow.trafficCount ?? slow.traffic.length)}
              </span>
              <span className={css.kpiMeta}>
                {slow.phase === "loading" ? null : (
                  <>
                    <Tag tone={slow.trafficEnabled === true ? "success" : "neutral"}>
                      {slow.trafficEnabled === true ? "录制中" : "捕获未开启"}
                    </Tag>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={openTrafficPage}
                      title="打开流量整页"
                      data-dashboard-action="open-traffic"
                    >
                      流量
                      <IconRightUpOutlineRegular size={12} />
                    </Button>
                  </>
                )}
              </span>
            </>
          )}
        </section>

        <section className={css.kpi} data-dashboard-kpi="tokens" data-dashboard-phase={fast.phase}>
          <span className={css.kpiLabel}>
            <IconGoalOutlineRegular size={13} />
            {KPI_LABEL.tokens}
          </span>
          {fast.phase === "offline" ? (
            <span className={css.kpiError} role="alert">
              <span>读取失败：{fast.error ?? "未知错误"}</span>
              <Button variant="outline" size="sm" onClick={fast.reload} data-dashboard-action="retry-tokens">
                重试
              </Button>
            </span>
          ) : (
            <>
              <span className={css.kpiValue} data-dashboard-kpi-value="tokens">
                {fast.phase === "loading" ? "…" : tokenTotal === null ? "—" : formatTokens(tokenTotal)}
              </span>
              <span className={css.kpiMeta}>
                {fast.phase === "loading" || fast.tokens === null ? null : (
                  <>
                    <span>入 {formatTokens(fast.tokens.input_tokens)}</span>
                    <span>缓存读 {formatTokens(fast.tokens.cache_read_tokens)}</span>
                    <span>出 {formatTokens(fast.tokens.output_tokens)}</span>
                  </>
                )}
              </span>
            </>
          )}
        </section>
      </div>

      {/* ── 图表区（P2:A8–A10、P2:A14、P2:A15，C03 的 DashboardCharts.tsx） ── */}
      <DashboardCharts tasks={tasks} fast={fast} slow={slow} />

      {/* ── 活动流 | 最近发现（P2:A11、P2:A12） ── */}
      <div className={css.pairGrid}>
        <Card
          title="活动流"
          slot="activity"
          state={fast.phase}
          actions={
            <>
              <span className={css.cardCount}>{fast.phase === "ready" ? `${fast.activity.length} 条事件` : null}</span>
              <Button variant="ghost" size="sm" onClick={openConversation} data-dashboard-action="activity-back">
                返回会话
              </Button>
            </>
          }
        >
          <CardState
            phase={fast.phase}
            error={fast.error}
            empty={fast.activity.length === 0}
            emptyText="暂无活动记录"
            onRetry={fast.reload}
            slot="activity"
          />
          {fast.phase === "ready" && fast.activity.length > 0 ? (
            <>
              <div className={css.kindBar} data-dashboard-kindbar="">
                {ACTIVITY_KINDS.map((kind) => {
                  const count = activityByKind[kind] ?? 0;
                  if (count === 0) return null;
                  return (
                    <Tag key={kind} tone="quiet">
                      {kind} {count}
                    </Tag>
                  );
                })}
              </div>
              <ul className={css.activityList}>
                {recentActivity.map((row) => (
                  <li key={row.seq} className={css.activityRow} data-dashboard-activity={row.seq}>
                    <Tag tone="outline">{row.worker}</Tag>
                    <span className={css.activityMain}>
                      <span className={css.activityTitle}>{activityKindLabel(row)}</span>
                      <span className={css.activitySummary}>{row.summary}</span>
                    </span>
                    <span className={css.activityMeta}>
                      <Tag tone={row.is_error === true ? "danger" : "quiet"}>{row.kind}</Tag>
                      <span className={css.time}>{formatRelative(row.ts)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>

        <Card
          title="最近发现"
          slot="findings"
          state={fast.phase}
          actions={
            <Button variant="ghost" size="sm" onClick={openFindingsPage} data-dashboard-action="findings-all">
              全部
              <IconRightUpOutlineRegular size={12} />
            </Button>
          }
        >
          <CardState
            phase={fast.phase}
            error={fast.error}
            empty={fast.findings.length === 0}
            emptyText="暂无发现"
            onRetry={fast.reload}
            slot="findings"
          />
          {fast.phase === "ready" && fast.findings.length > 0 ? (
            <ul className={css.findingList}>
              {recentFindings.map((finding: Finding) => (
                <li key={finding.id}>
                  <button
                    type="button"
                    className={css.findingRow}
                    title="打开发现详情"
                    onClick={() => openFinding(finding.id)}
                    data-dashboard-finding={finding.id}
                  >
                    <Tag tone={severityTone(finding.severity)}>{severityLabel(finding.severity)}</Tag>
                    <span className={css.findingMain}>
                      <span className={css.findingTitle}>{finding.name ?? finding.vulnclass}</span>
                      {finding.task_description !== undefined && finding.task_description !== "" ? (
                        <span className={css.findingTask}>{finding.task_description}</span>
                      ) : null}
                      <span className={css.findingSummary}>{finding.summary}</span>
                    </span>
                    <span className={css.time}>{formatRelative(finding.ts)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      {/* ── 最近任务表（P2:A13） ── */}
      <Card
        title="最近任务"
        slot="tasks"
        state={tasks.phase}
        actions={
          <>
            <span className={css.cardCount}>{tasks.phase === "ready" ? `${tasks.tasks.length} 个任务` : null}</span>
            <Button variant="ghost" size="sm" onClick={openConversation} data-dashboard-action="tasks-back">
              返回会话
            </Button>
          </>
        }
      >
        <CardState
          phase={tasks.phase}
          error={tasks.error}
          empty={tasks.tasks.length === 0}
          emptyText="暂无任务"
          onRetry={tasks.reload}
          slot="tasks"
        />
        {tasks.phase === "ready" && tasks.tasks.length > 0 ? (
          <div className={css.tableWrap}>
            <table className={css.table} data-dashboard-tasks="">
              <thead>
                <tr>
                  <th scope="col">任务</th>
                  <th scope="col">状态</th>
                  <th scope="col">目标进度</th>
                  <th scope="col">在途</th>
                  <th scope="col">最近活动</th>
                </tr>
              </thead>
              <tbody>
                {recentTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {/* ── 系统状态 | 系统静态计数（P2:A16、P2:A17） ── */}
      <div className={css.pairGrid}>
        <Card title="系统状态" slot="system" state={fast.phase === "offline" || slow.phase === "offline" ? "offline" : fast.phase === "loading" || slow.phase === "loading" ? "loading" : "ready"}>
          <div className={css.statusList}>
            <StatusRow label="LLM 配置" field="llm">
              {fast.phase === "loading" ? (
                <span className={css.dim}>…</span>
              ) : fast.stats === null ? (
                <Tag tone="neutral">读取失败</Tag>
              ) : (
                <Tag tone={fast.stats.llm_configured ? "success" : "danger"}>
                  {fast.stats.llm_configured ? "已配置" : "未配置"}
                </Tag>
              )}
            </StatusRow>
            <StatusRow label="流量捕获" field="capture">
              {slow.phase === "loading" ? (
                <span className={css.dim}>…</span>
              ) : slow.phase === "offline" ? (
                <Tag tone="neutral">读取失败</Tag>
              ) : (
                <Tag tone={slow.trafficEnabled === true ? "success" : "neutral"}>
                  {slow.trafficEnabled === true ? "开启" : "关闭"}
                </Tag>
              )}
            </StatusRow>
            <StatusRow label="激活模型" field="model">
              {slow.phase === "loading" ? (
                <span className={css.dim}>…</span>
              ) : slow.phase === "offline" ? (
                <Tag tone="neutral">读取失败</Tag>
              ) : profile === null ? (
                <span className={css.dim}>未指定默认配置</span>
              ) : (
                <span className={css.mono} title={profile.name}>
                  {profile.model}
                </span>
              )}
            </StatusRow>
          </div>

          <div className={css.pendingBlock} data-dashboard-pending={pendingCount}>
            {fast.phase === "loading" ? (
              <div className={css.state}>加载中…</div>
            ) : fast.phase === "offline" ? (
              <div className={css.stateError} role="alert">
                <span>待审批读取失败：{fast.error ?? "未知错误"}</span>
                <Button variant="outline" size="sm" onClick={fast.reload}>
                  重试
                </Button>
              </div>
            ) : pendingCount === 0 ? (
              <div className={css.empty}>
                <IconShieldOutlineRegular size={16} />
                无待审批拦截
              </div>
            ) : (
              <>
                <div className={css.pendingHead}>待审批（{pendingCount}）</div>
                <ul className={css.pendingList}>
                  {fast.pending.slice(0, 3).map((item) => (
                    <li key={item.id} className={css.pendingRow}>
                      <span className={css.pendingTool}>{item.tool_name}</span>
                      <span className={css.pendingAgent}>{item.agent_name}</span>
                    </li>
                  ))}
                </ul>
                {pendingCount > 3 ? <div className={css.dim}>还有 {pendingCount - 3} 条…</div> : null}
              </>
            )}
          </div>
        </Card>

        <Card title="系统计数" slot="counts" state={slow.phase}>
          <CardState
            phase={slow.phase}
            error={slow.error}
            empty={false}
            emptyText="暂无数据"
            onRetry={slow.reload}
            slot="counts"
          />
          {slow.phase === "ready" ? (
            <dl className={css.countGrid} data-data-page-summary="dashboard-counts">
              <div className={css.countItem} data-dashboard-count="agents">
                <dt>Agent</dt>
                <dd>{slow.agents.length}</dd>
              </div>
              <div className={css.countItem} data-dashboard-count="mcp">
                <dt>MCP</dt>
                <dd>{slow.mcpServers.length}</dd>
              </div>
              <div className={css.countItem} data-dashboard-count="skills">
                <dt>技能</dt>
                <dd>{slow.skills.length}</dd>
              </div>
              <div className={css.countItem} data-dashboard-count="tools">
                <dt>工具</dt>
                <dd>
                  {slow.tools.length}
                  <span className={css.countSub}>
                    （启用 {slow.tools.filter((tool) => tool.enabled).length}）
                  </span>
                </dd>
              </div>
            </dl>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
