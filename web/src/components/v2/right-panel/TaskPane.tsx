"use client";

/**
 * 右栏「任务」页签（收口 P1:E8 的最后一个缺口）。
 *
 * 旧页面依据：ARTEX/web/src/components/layout/right-panel.tsx:15（`RightTab` 首项 `"task"`）、
 * :24（页签清单首项 `{ id: "task", label: "任务" }`，位置在「资产」之前，是右栏的第一页）、
 * :194-309（`TaskTab`：无任务空态 :195-197、加载态 :198、任务不可用态 :200-202、
 * 进度条 :203-205 与 :243-256（`goals_met / goals_total` → `role="progressbar"`）、
 * 「任务概况」kv :216-257（目标 / 进度 / 发现 / token）、待审批区块 :259-284、当前资产区块 :286-304）。
 * DSH 依据：DSH 右栏没有任务页，本页按「右栏 tab 扩展」实现（100-实施计划总表 §4 决策表：
 * 和某一个任务有关、属于辅助信息 → 右栏 tab）。页体沿用同目录 `FindingsPane` / `AssetsPane` 的写法：
 * 38px 头行 + 一段滚动区 + 四态，chrome 走 `pane-chrome.tsx` 与 `Panes.module.css`
 * （结构依据 `ui-sidebar-files FilesBody.tsx:63-116`、`FilesBody.module.css:162-180`）。
 *
 * 数据：全部来自 `v2/data/task-overview.ts` 的真实读取，本组件不直接调 `api`：
 * - 任务本体（目标数 / 已达数 / 状态）← `useOverviewSummary`（`api.task` api.ts:280 + `api.stats` api.ts:419）；
 * - 约束列表 ← `useTaskConstraints`（`api.taskConstraints` api.ts:493）；
 * - 测试范围 ← `useTaskScope`（`api.taskScope` api.ts:520）。
 * 三种读取各自有 loading / ready / offline：任一失败都按「失败可重试」如实显示后端原因，
 * 不吞错、不画假数据。在途 worker 数取任务自身字段之间的**候选值**（`Task.in_flight`），
 * 没有该字段就显示「—」，见 `taskWorkerText`。
 *
 * 与旧页的差异（写在这里，因为 DOM 上看得见）：
 * - 旧页 `TaskTab` 还画「待审批」与「当前资产」两块摘要；/v2 右栏已有独立的「审批」「资产」两个页签
 *   （`Panes.tsx:282` / `AssetsPane.tsx:52`），本页不重复取那两份数据，也不重复画。
 * - 旧页右栏的「任务」是第一个页签；/v2 的页签顺序由 `RightPanel.tsx` 的 `TABS` 决定，本单元按旧页
 *   把它插在第一位（`RightPanel.tsx:80`）。
 * - 「打开概览」：旧页是同一个 SPA 里的整页 `/function/tasks/detail`。`/v2` 的会话视图挂在
 *   `ConversationMainPanel` 的内部 tab 状态上，右栏改不动它（`v2/data/pages.ts` 也没有 tasks 整页），
 *   所以本页**不画**假链接：没有真实目标时只给引导文案，见 `overviewTarget` 与页尾「概览」区块。
 */
import * as React from "react";

import type { Task, TaskConstraint, TaskScopeRow } from "@/lib/types";
import {
  type ConstraintListState,
  type GoalListState,
  type OverviewSummaryState,
  type ScopeListState,
  scopeValue,
} from "@/v2/data/task-overview";
import {
  IconChecklistOutlineRegular,
  IconFlatListOutlineRegular,
  IconGoalOutlineRegular,
  IconNewChatOutlineRegular,
  IconRefreshOutlineRegular,
  IconShieldOutlineRegular,
  IconWarningOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import type { TagTone } from "@/vendor/dsh/primitives/Tag";

import { EmptyState, LoadingRows, PaneHeader, ToolButton } from "./pane-chrome";
import css from "./Panes.module.css";

/**
 * 约束 / 范围各最多列几条（旧页把约束与范围折进「任务概况」的 kv 行，只给数字；
 * 本页把它们展开成列表，所以设一个上限，超出部分如实写「还有 N 条」）。
 */
export const RIGHT_PANEL_TASK_LIST_LIMIT = 5;

/** 任务状态的中文名与色调，与 `Panes.tsx:499-507` 的 `TASK_STATUS` 同口径。 */
const TASK_STATUS: Record<Task["status"], { readonly label: string; readonly tone: TagTone }> = {
  created: { label: "已创建", tone: "outline" },
  queued: { label: "排队中", tone: "outline" },
  running: { label: "运行中", tone: "success" },
  paused: { label: "已暂停", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  timeout: { label: "超时", tone: "danger" },
};

/** 约束种类的中文名（`ConstraintKind` types.ts:509；旧页 overview-tab 的约束行同口径）。 */
const CONSTRAINT_KIND: Record<TaskConstraint["kind"], { readonly label: string; readonly tone: TagTone }> = {
  allow: { label: "允许", tone: "success" },
  deny: { label: "禁止", tone: "danger" },
};

/**
 * 范围种类的中文名（`TaskScopeRow["kind"]` types.ts:369）。种类是分类事实，不是状态，统一 `outline`。
 */
const SCOPE_KIND: Record<TaskScopeRow["kind"], string> = {
  company: "企业",
  root_domain: "根域",
  subdomain: "子域",
  ip: "IP",
  cidr: "网段",
  icp: "备案",
  keyword: "关键词",
};

/**
 * 目标进度比例，照旧页 right-panel.tsx:203-205：`goals_total` 为 0 时按 0 处理，
 * 上不封顶到 100（后端可能给出 `goals_met > goals_total` 的脏数据，进度条不能溢出）。
 * @param task - 任务本体。
 * @returns `{ met, total, percent }`。
 */
export function taskGoalProgress(task: Task): { met: number; total: number; percent: number } {
  const total = task.goals_total ?? 0;
  const met = task.goals_met ?? 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((met / total) * 100))) : 0;
  return { met, total, percent };
}

/**
 * 「在途 worker 数」的显示文案。`Task` 上没有「当前在跑的 worker 数」这个字段
 * （types.ts:7-54 只有 `in_flight`：该任务后端当前在途的请求数，可能是审批 / 工具调用而非 worker），
 * 所以不做数量和语义上的推断：字段存在就显示数字，缺省显示 `—`。
 * @param task - 任务本体。
 * @returns 数字字符串或 `—`。
 */
export function taskWorkerText(task: Task): string {
  return task.in_flight === undefined ? "—" : String(task.in_flight);
}

/**
 * 「打开概览」的真实目标。`/v2` 的会话视图 tab 状态在 `ConversationMainPanel` 内部，
 * 右栏改不动；`v2/data/pages.ts` 也没有注册 tasks 整页。因此这里只能返回 `null`，
 * 页签据此只显示引导文案，绝不画一个点了没反应的链接。
 * @returns 永远是 `null`（留成函数是为了让「没有真实目标」这件事在代码里可核实）。
 */
export function overviewTarget(): string | null {
  return null;
}

/** 一条「还有 N 条」的收尾提示。 */
function RemainingHint({ count }: { readonly count: number }): React.ReactNode {
  if (count <= 0) return null;
  return <p className={css.taskRemain}>还有 {count} 条</p>;
}

/**
 * 页内的一段列表（约束 / 范围）：标题 + 条数，各自独立的加载 / 失败 / 空 / 有数据四态，
 * 只列前 `limit` 条，超出部分如实写「还有 N 条」。
 * 失败态只写后端原因；重读走页头的「刷新任务概览」（它同时重读三类数据）。
 * @param props.title - 这一段的名字（同时是 `data-rp-task-section` 的值）。
 * @param props.state - 这一段自己的 `phase` 与 `error`。
 * @param props.count - 这一段拿到多少条（`ready` 时才是真数字）。
 * @param props.limit - 最多列几条。
 * @param props.emptyText - `ready` 且 0 条时的空态文案。
 * @param props.children - `ready` 且有条数时的正文。
 * @returns 这一段的正文。
 */
function ListSection({
  title,
  state,
  count,
  limit,
  emptyText,
  children,
}: {
  readonly title: string;
  readonly state: { readonly phase: ConstraintListState["phase"]; readonly error: string | null };
  readonly count: number;
  readonly limit: number;
  readonly emptyText: string;
  readonly children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className={css.section} data-rp-task-section={title}>
      <h3 className={css.sectionTitle}>
        <span className={css.sectionIcon} aria-hidden="true">
          {title === "约束" ? <IconChecklistOutlineRegular size={13} /> : <IconFlatListOutlineRegular size={13} />}
        </span>
        {title}
        {state.phase === "ready" ? <span className={css.taskSectionCount}>{count} 条</span> : null}
      </h3>
      {state.phase === "loading" ? <LoadingRows count={2} /> : null}
      {state.phase === "offline" ? (
        <p className={css.taskError} role="alert">
          {state.error === null ? `${title}读取失败` : `读取失败：${state.error}`}
        </p>
      ) : null}
      {state.phase === "ready" && count === 0 ? <p className={css.taskEmpty}>{emptyText}</p> : null}
      {state.phase === "ready" && count > 0 ? children : null}
      {state.phase === "ready" ? <RemainingHint count={count - limit} /> : null}
    </section>
  );
}

export interface TaskPaneProps {
  /** 当前选中任务；null/undefined 时显示「先选择一个任务」。 */
  readonly task?: Task | null;
  /**
   * 任务概览读取（`useOverviewSummary`）。页签自己在没有任务时不调用它，
   * 由调用方按 `task` 传入，使右栏换任务时只有这一条数据源变化。
   */
  readonly summary: OverviewSummaryState;
  /** 约束读取（`useTaskConstraints`）。 */
  readonly constraints: ConstraintListState;
  /** 测试范围读取（`useTaskScope`）。 */
  readonly scope: ScopeListState;
  /** 目标读取（`useTaskGoals`）；本页只用它的阶段来说明目标数是否可信。 */
  readonly goals: GoalListState;
}

/**
 * 右栏任务页签：当前任务的目标进度、约束、测试范围与在途 worker 数。
 * @param props.task - 当前选中的任务。
 * @param props.summary - 任务本体与统计的读取状态。
 * @param props.constraints - 约束列表读取状态。
 * @param props.scope - 测试范围读取状态。
 * @param props.goals - 目标列表读取状态（只读阶段）。
 * @returns the page.
 */
export function TaskPane({ task = null, summary, constraints, scope, goals }: TaskPaneProps): React.ReactNode {
  const hasTask = task !== null && task !== undefined;
  const reloadAll = (): void => {
    summary.reload();
    constraints.reload();
    scope.reload();
    goals.reload();
  };

  return (
    <div className={css.page} data-rp-task-page="">
      <PaneHeader
        actions={
          hasTask ? (
            <ToolButton label="刷新任务概览" onClick={reloadAll}>
              <IconRefreshOutlineRegular size={15} />
            </ToolButton>
          ) : undefined
        }
      >
        <span className={css.count}>{hasTask ? "任务" : "任务概览"}</span>
        {hasTask && summary.task !== null ? <Tag tone={TASK_STATUS[summary.task.status].tone}>{TASK_STATUS[summary.task.status].label}</Tag> : null}
      </PaneHeader>

      {!hasTask ? (
        <EmptyState
          icon={<IconNewChatOutlineRegular size={26} />}
          title="先选择一个任务"
          hint="在左侧会话列表选中任务后，这里显示它的目标进度、约束、测试范围与在途 worker 数"
        />
      ) : null}

      {hasTask && summary.phase === "loading" ? <LoadingRows count={4} /> : null}

      {hasTask && summary.phase === "offline" ? (
        <EmptyState
          icon={<IconWarningOutlineRegular size={26} />}
          title="未连接后端（任务概览不可用）"
          hint={summary.error === null ? "GET /tasks/{id} 读取失败，后端恢复后点刷新重试" : `读取失败：${summary.error}`}
        />
      ) : null}

      {hasTask && summary.phase === "ready" && summary.task !== null ? (
        <div className={css.scroll}>
          <div className={css.session}>
            <section className={css.section} data-rp-task-section="目标">
              <h3 className={css.sectionTitle}>
                <span className={css.sectionIcon} aria-hidden="true"><IconGoalOutlineRegular size={13} /></span>
                任务目标
              </h3>
              <p className={css.sessionDescription}>
                {summary.task.goal === "" ? "（未填写目标）" : summary.task.goal}
              </p>
            </section>

            <section className={css.section} data-rp-task-section="进度">
              <h3 className={css.sectionTitle}>
                <span className={css.sectionIcon} aria-hidden="true"><IconGoalOutlineRegular size={13} /></span>
                目标进度
                {goals.phase === "offline" ? <Tag tone="warning">目标列表读取失败</Tag> : null}
              </h3>
              <div className={css.progressRow}>
                <span
                  className={css.progressTrack}
                  role="progressbar"
                  aria-label="目标完成进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={taskGoalProgress(summary.task).percent}
                  data-rp-task-goal-progress={taskGoalProgress(summary.task).percent}
                >
                  <span className={css.progressFill} style={{ width: `${taskGoalProgress(summary.task).percent}%` }} />
                </span>
                <span className={css.progressText}>
                  {taskGoalProgress(summary.task).met} / {taskGoalProgress(summary.task).total === 0 ? "—" : taskGoalProgress(summary.task).total}
                </span>
              </div>
              <dl className={css.metaList}>
                <div className={css.metaRow}>
                  <dt className={css.metaLabel}>目标数</dt>
                  <dd className={css.metaValue} data-rp-task-goals-total={summary.task.goals_total ?? 0}>
                    {summary.task.goals_total ?? 0}
                  </dd>
                </div>
                <div className={css.metaRow}>
                  <dt className={css.metaLabel}>已达</dt>
                  <dd className={css.metaValue} data-rp-task-goals-met={summary.task.goals_met ?? 0}>
                    {summary.task.goals_met ?? 0}
                  </dd>
                </div>
                <div className={css.metaRow}>
                  <dt className={css.metaLabel}>在途 worker</dt>
                  <dd className={css.metaValue} data-rp-task-workers={taskWorkerText(summary.task)}>
                    {taskWorkerText(summary.task)}
                  </dd>
                </div>
              </dl>
            </section>

            <ListSection
              title="约束"
              state={constraints}
              count={constraints.constraints.length}
              limit={RIGHT_PANEL_TASK_LIST_LIMIT}
              emptyText="该任务还没有操作约束"
            >
              <ul className={css.taskList}>
                {constraints.constraints.slice(0, RIGHT_PANEL_TASK_LIST_LIMIT).map((row) => (
                  <li key={row.id} className={css.taskRow} data-rp-task-constraint={row.id}>
                    <Tag tone={CONSTRAINT_KIND[row.kind].tone}>{CONSTRAINT_KIND[row.kind].label}</Tag>
                    <span className={css.taskRowText} title={row.text}>{row.text}</span>
                  </li>
                ))}
              </ul>
            </ListSection>

            <ListSection
              title="范围"
              state={scope}
              count={scope.scope.length}
              limit={RIGHT_PANEL_TASK_LIST_LIMIT}
              emptyText="该任务还没有测试范围"
            >
              <ul className={css.taskList}>
                {scope.scope.slice(0, RIGHT_PANEL_TASK_LIST_LIMIT).map((row) => (
                  <li key={row.id} className={css.taskRow} data-rp-task-scope={row.id}>
                    <Tag tone="outline">{SCOPE_KIND[row.kind]}</Tag>
                    <span className={css.taskRowText} title={scopeValue(row)}>{scopeValue(row)}</span>
                  </li>
                ))}
              </ul>
            </ListSection>

            <section className={css.section} data-rp-task-section="概览">
              <h3 className={css.sectionTitle}>概览</h3>
              {overviewTarget() === null ? (
                <p className={css.sessionDescription}>
                  完整任务概览（目标 / 约束 / 范围的增删改、拦截规则、统计）在会话的「概览」视图里：
                  在中间主区切到该任务的会话，再点会话头部页签「概览」。右栏不另画入口。
                </p>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}

      {hasTask && summary.phase === "ready" && summary.task === null ? (
        <EmptyState
          icon={<IconShieldOutlineRegular size={26} />}
          title="任务不可用"
          hint={summary.error === null ? "任务可能已被归档或删除" : `读取失败：${summary.error}`}
        />
      ) : null}
    </div>
  );
}
