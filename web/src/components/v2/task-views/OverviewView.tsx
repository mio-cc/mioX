"use client";

/**
 * 任务概览（会话视图 tab「概览」，对照表 P1:C1–C7）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/overview-tab.tsx:433-452（描述与目标）、
 * :455-574（目标管理）、:578-702（操作约束）、:808-893（测试范围）、:894-938（心跳）、:1043-1048（统计数字）、
 * :1053-1322（任务级资产拦截 / 允许规则，含新增表单、行内编辑、是否启用开关、删除）。
 * DSH 依据：DSH 无任务概览页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：全部走 `v2/data/task-overview.ts`（api.ts:280/419/436/439-445/493/498-504/508-517/520/522-525/636）。
 */
import { type ReactNode, useEffect, useState } from "react";

import type {
  AssetInterceptAction,
  AssetInterceptKind,
  AssetInterceptRule,
  ConstraintKind,
  Finding,
  Stats,
  Task,
  TaskConstraint,
  TaskGoal,
  TaskScopeRow,
} from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag, type TagTone } from "@/vendor/dsh/primitives/Tag";
import {
  findingStatusLabel,
  formatFindingTime,
  severityLabel,
} from "@/v2/data/findings-page";
import {
  addTaskConstraint,
  addTaskGoal,
  addTaskScopeRow,
  createTaskInterceptRule,
  deleteTaskConstraint,
  deleteTaskGoal,
  deleteTaskInterceptRule,
  deleteTaskScopeRow,
  scopeValue,
  SCOPE_SOURCE_LABEL,
  TASK_RULE_ACTION_OPTIONS,
  TASK_RULE_KIND_LABEL,
  TASK_RULE_KIND_OPTIONS,
  taskRuleActionLabel,
  toggleTaskInterceptRule,
  updateTaskConstraint,
  updateTaskGoal,
  updateTaskInterceptRule,
  useOverviewSummary,
  useTaskConstraints,
  useTaskGoals,
  useTaskInterceptRules,
  useTaskScope,
} from "@/v2/data/task-overview";
import {
  AUDIT_RECENT_LIMIT,
  activityKindLabel,
  auditActionLabel,
  auditTimeText,
  FRONTIER_LIMIT,
  frontierRows,
  frontierStateTone,
  overviewStatsItems,
  useTaskAudit,
  useTaskFrontier,
  OVERVIEW_ACTIVITY_RECENT,
} from "@/v2/data/task-frontier";
import { useActivities } from "@/v2/data/activity";

import css from "./OverviewView.module.css";

/** 约束种类的下拉选项（旧页 overview-tab.tsx:590-597 的「禁止 / 允许」顺序）。 */
const CONSTRAINT_KIND_OPTIONS: readonly { value: ConstraintKind; label: string }[] = [
  { value: "deny", label: "禁止" },
  { value: "allow", label: "允许" },
];

/** 新增范围可选种类与中文名（旧页 overview-tab.tsx:66-74、:821-833）。 */
const SCOPE_KIND_OPTIONS: readonly { value: TaskScopeRow["kind"]; label: string }[] = [
  { value: "root_domain", label: "根域名" },
  { value: "subdomain", label: "子域名" },
  { value: "ip", label: "IP" },
  { value: "cidr", label: "网段" },
  { value: "icp", label: "ICP" },
  { value: "keyword", label: "关键词" },
  { value: "company", label: "公司" },
];

/** 范围种类中文名。 */
const SCOPE_KIND_LABEL: Record<TaskScopeRow["kind"], string> = {
  company: "公司",
  root_domain: "根域名",
  subdomain: "子域名",
  ip: "IP",
  cidr: "网段",
  icp: "ICP",
  keyword: "关键词",
};

/**
 * 数量加千分位。
 *
 * 后端 `GET /stats` 的实际字段是 assets / engine_mode / llm_configured /
 * exploration / traffic / traffic_enabled / active_task；`lib/types.ts` 里还声明了
 * `findings_confirmed` 与 `roe_enabled`，但 Go 后端从来不发这两个字段（2026-11-20 实测）。
 * 直接 `value.toLocaleString()` 会在缺字段时抛 `undefined.toLocaleString`，把整个概览页打崩，
 * 所以这里按「缺就是没有」返回「—」，不补 0（不造假数据）。
 * @param value - 原始数值；缺省或非有限数表示后端没有这个统计。
 * @returns 千分位文本，缺省时为「—」。
 */
function num(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN");
}

/**
 * 任务级统计里的流量条数（W-5）。
 *
 * `Stats`（types.ts）没声明 `traffic`，但 `GET /stats?task=` 实测返回（2026-11-20 用
 * task=133 抓包核对过）；这是「类型声明与后端契约不一致」的反向版本——上次是后端不
 * 返回、类型却声明（`findings_confirmed` 崩溃），这次是后端返回、类型没声明。红线禁
 * 改 types.ts，所以在本地把字段补进交叉类型；后端真没给时按「—」诚实显示。
 * @param stats - 任务级统计快照。
 * @returns 流量条数；后端没给该字段时为 undefined。
 */
function statsTraffic(stats: Stats): number | undefined {
  const withTraffic = stats as Stats & { traffic?: number };
  const value = withTraffic.traffic;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 时间戳的本地化文本。
 * @param value - 后端返回的 ISO 时间（可能为空）。
 * @returns 本地时间文本，无法解析或为空时为「—」。
 */
function timeText(value: string | undefined): string {
  const raw = value ?? "";
  if (raw === "") return "—";
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return raw;
  return at.toLocaleString("zh-CN");
}

/**
 * unix 秒的本地化文本。
 * @param value - unix 秒；0/缺省表示没有。
 * @returns 本地时间文本，没有时为「—」。
 */
function unixText(value: number | undefined): string {
  if (value === undefined || value === 0) return "—";
  return new Date(value * 1000).toLocaleString("zh-CN");
}

/**
 * 严重等级对应的 Tag 色调（与任务内发现视图一致）。
 * @param severity - 后端严重等级。
 * @returns Tag 的 tone。
 */
function severityTone(severity: string): TagTone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "neutral";
  return "outline";
}

/**
 * 一条发现的标题：优先漏洞名称，否则漏洞类型。
 * @param finding - 后端发现行。
 * @returns 显示名。
 */
function findingTitle(finding: Finding): string {
  const name = finding.name?.trim() ?? "";
  if (name !== "") return name;
  const vulnclass = finding.vulnclass?.trim() ?? "";
  return vulnclass === "" ? "未分类" : vulnclass;
}

/**
 * 打开某个发现的详情（真实 SPA 导航：改地址后通知 Shell 重新读取 `?page=`）。
 * 写法照抄 `components/v2/task-views/ReportView.tsx:38-44` 的 `openFindingDetail`。
 * @param id - 发现的写句柄（`finding_id` 优先，否则 `id`）。
 */
function openFindingDetail(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "findings");
  url.searchParams.set("finding", id);
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * 活动行的时间文本（后端 `Activity.ts` 是 ISO 时间字符串，types.ts:696）。
 * @param ts - 后端时间。
 * @returns 本地时间文本；空或无法解析时为「—」。
 */
function activityRowTime(ts: string): string {
  const raw = (ts ?? "").trim();
  if (raw === "") return "—";
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return raw;
  return at.toLocaleString("zh-CN");
}

/**
 * 打开某个任务（真实 SPA 导航：写 `?task=<id>` 并清掉 `?page=`，再通知 Shell 重新读取）。
 * Shell 初始化与 popstate 都读 `?task=`（`components/v2/shell/Shell.tsx` 的 `readShellTaskParam`），
 * 所以这一个步骤就让会话区切到该任务。写法照本文件 `openFindingDetail`。
 * @param id - 任务 id（后端 `task_id`）。
 */
function openTaskConversation(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("task", id);
  url.searchParams.delete("page");
  window.history.pushState(window.history.state, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** 一条待确认的删除操作。 */
type DeleteTarget =
  | { kind: "goal"; id: string; text: string }
  | { kind: "constraint"; id: string; text: string }
  | { kind: "scope"; id: number; text: string }
  | { kind: "intercept"; id: number; text: string };

/**
 * 删除确认的目标名称。
 * @param target - 待删除的对象。
 * @returns 标题。
 */
function deleteTitle(target: DeleteTarget): string {
  if (target.kind === "goal") return "确认删除目标";
  if (target.kind === "constraint") return "确认删除约束";
  if (target.kind === "intercept") return "确认删除任务级拦截规则";
  return "确认删除测试范围";
}

/**
 * 删除确认的后果说明。
 * @param target - 待删除的对象。
 * @returns 说明文本。
 */
function deleteDescription(target: DeleteTarget): string {
  if (target.kind === "goal") return "目标会被硬删除，并通知规划者；此操作不可撤销。";
  if (target.kind === "constraint") return "约束会被删除，下一轮规划不再受它限制；此操作不可撤销。";
  if (target.kind === "intercept") {
    return "这条规则会从本任务删除，此后不再对命中的资产起拦截或放行作用；此操作不可撤销。";
  }
  return "这条范围会从本任务移除，覆盖度的分母随之变化；此操作不可撤销。";
}

/** C6 行内编辑中的一条任务级规则（id 与原始 `enabled` 保留，保存时原样回传）。 */
interface InterceptEditDraft {
  id: number;
  action: AssetInterceptAction;
  kind: AssetInterceptKind;
  pattern: string;
  note: string;
  enabled: boolean;
}

/** C6 待确认的启停操作：启用/停用不可撤销地改变本任务的实际拦截行为，必须先确认。 */
interface InterceptToggleTarget {
  id: number;
  action: string;
  pattern: string;
  nextEnabled: boolean;
}

/**
 * 渲染任务概览视图。
 * @param props.task - 当前选中的任务。
 * @returns 概览视图。
 */
export function OverviewView({ task }: { task: Task }): ReactNode {
  const summary = useOverviewSummary(task.id);
  const goals = useTaskGoals(task.id);
  const constraints = useTaskConstraints(task.id);
  const scope = useTaskScope(task.id);
  // C18：前沿与审计。统计数字复用上面 `summary.stats`，不重复请求 `api.stats`。
  const frontier = useTaskFrontier(task.id);
  const audit = useTaskAudit(task.id);
  // P2:A11：活动流。与 Shell 会话区用的是同一个 `useActivities`（同一条 SSE/游标链），
  // 只是这里只渲染最近几行；点行时若该行有真实 `task_id` 就深链过去，没有就不画成可点。
  const activity = useActivities(task.id);
  // C6：任务级拦截 / 允许规则。
  const intercept = useTaskInterceptRules(task.id);

  // 目标：新增表单 + 行内编辑。
  const [goalText, setGoalText] = useState("");
  const [goalVuln, setGoalVuln] = useState("");
  const [editingGoal, setEditingGoal] = useState<{ id: string; text: string; vuln: string } | null>(null);
  // 约束：新增表单 + 行内编辑。
  const [conText, setConText] = useState("");
  const [conKind, setConKind] = useState<ConstraintKind>("deny");
  const [editingCon, setEditingCon] = useState<{ id: string; text: string; kind: ConstraintKind } | null>(null);
  // 范围：新增表单。
  const [scopeKind, setScopeKind] = useState<TaskScopeRow["kind"]>("root_domain");
  const [scopeValueInput, setScopeValueInput] = useState("");
  // C6：新增表单 + 行内编辑 + 待确认的启停。
  const [ruleAction, setRuleAction] = useState<AssetInterceptAction>("block");
  const [ruleKind, setRuleKind] = useState<AssetInterceptKind>("fuzzy_domain");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleNote, setRuleNote] = useState("");
  const [editingRule, setEditingRule] = useState<InterceptEditDraft | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<InterceptToggleTarget | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  // 写操作：一次只允许一处写；失败原因写在页面上（toast 只在 /v2/shell 里显示）。
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DeleteTarget | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // 换任务时清掉未提交的表单与行内编辑状态。
  useEffect(() => {
    setGoalText("");
    setGoalVuln("");
    setEditingGoal(null);
    setConText("");
    setConKind("deny");
    setEditingCon(null);
    setScopeKind("root_domain");
    setScopeValueInput("");
    setRuleAction("block");
    setRuleKind("fuzzy_domain");
    setRulePattern("");
    setRuleNote("");
    setEditingRule(null);
    setConfirmToggle(null);
    setWriteError(null);
    setConfirm(null);
  }, [task.id]);

  /** 统一写操作：置忙、失败原因写页面、成功后重读对应列表。 */
  const runWrite = (label: string, action: () => Promise<unknown>, after: () => void): void => {
    if (busy) return;
    setBusy(true);
    setWriteError(null);
    action()
      .then(() => {
        setBusy(false);
        toast(label);
        after();
      })
      .catch((reason: unknown) => {
        setBusy(false);
        setWriteError(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const submitGoal = (): void => {
    const text = goalText.trim();
    if (text === "" || busy) return;
    const vuln = goalVuln.trim();
    runWrite(
      "新增目标",
      () => addTaskGoal(task.id, text, vuln === "" ? undefined : vuln),
      () => {
        setGoalText("");
        setGoalVuln("");
        goals.reload();
        summary.reload();
      },
    );
  };

  const saveGoal = (row: TaskGoal): void => {
    if (editingGoal === null || editingGoal.id !== row.id) return;
    const text = editingGoal.text.trim();
    if (text === "" || busy) return;
    const vuln = editingGoal.vuln.trim();
    runWrite(
      "保存目标",
      () => updateTaskGoal(task.id, row.id, text, vuln === "" ? undefined : vuln),
      () => {
        setEditingGoal(null);
        goals.reload();
        summary.reload();
      },
    );
  };

  const submitConstraint = (): void => {
    const text = conText.trim();
    if (text === "" || busy) return;
    runWrite(
      "新增约束",
      () => addTaskConstraint(task.id, text, conKind),
      () => {
        setConText("");
        constraints.reload();
      },
    );
  };

  const saveConstraint = (row: TaskConstraint): void => {
    if (editingCon === null || editingCon.id !== row.id) return;
    const text = editingCon.text.trim();
    if (text === "" || busy) return;
    runWrite(
      "保存约束",
      () => updateTaskConstraint(task.id, row.id, text, editingCon.kind),
      () => {
        setEditingCon(null);
        constraints.reload();
      },
    );
  };

  const submitScope = (): void => {
    const value = scopeValueInput.trim();
    if (value === "" || busy) return;
    runWrite(
      "新增范围",
      () => addTaskScopeRow(task.id, scopeKind, value),
      () => {
        setScopeValueInput("");
        scope.reload();
      },
    );
  };

  const runConfirm = (): void => {
    if (confirm === null || confirmBusy) return;
    const target = confirm;
    const action =
      target.kind === "goal"
        ? () => deleteTaskGoal(task.id, target.id)
        : target.kind === "constraint"
          ? () => deleteTaskConstraint(task.id, target.id)
          : target.kind === "intercept"
            ? () => deleteTaskInterceptRule(task.id, target.id)
            : () => deleteTaskScopeRow(task.id, target.id);
    const label =
      target.kind === "goal"
        ? "删除目标"
        : target.kind === "constraint"
          ? "删除约束"
          : target.kind === "intercept"
            ? "删除拦截规则"
            : "删除范围";
    const after =
      target.kind === "goal"
        ? () => {
            goals.reload();
            summary.reload();
          }
        : target.kind === "constraint"
          ? () => constraints.reload()
          : target.kind === "intercept"
            ? () => intercept.reload()
            : () => scope.reload();
    setConfirmBusy(true);
    setWriteError(null);
    action()
      .then(() => {
        setConfirmBusy(false);
        setConfirm(null);
        toast(label);
        after();
      })
      .catch((reason: unknown) => {
        setConfirmBusy(false);
        setConfirm(null);
        setWriteError(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  /** C6：新增一条任务级规则（旧页 overview-tab.tsx:1095-1115）。新规则固定 enabled=true。 */
  const submitRule = (): void => {
    const pattern = rulePattern.trim();
    if (pattern === "" || busy) return;
    runWrite(
      "新增拦截规则",
      () =>
        createTaskInterceptRule(task.id, {
          action: ruleAction,
          kind: ruleKind,
          pattern,
          note: ruleNote.trim(),
          enabled: true,
        }),
      () => {
        setRulePattern("");
        setRuleNote("");
        intercept.reload();
      },
    );
  };

  /** C6：保存行内编辑（旧页 overview-tab.tsx:1126-1145）；`enabled` 原样回传，改启停走下面的确认流程。 */
  const saveRule = (rule: AssetInterceptRule): void => {
    if (editingRule === null || editingRule.id !== rule.id) return;
    const pattern = editingRule.pattern.trim();
    if (pattern === "" || busy) return;
    runWrite(
      "保存拦截规则",
      () =>
        updateTaskInterceptRule(task.id, rule.id, {
          action: editingRule.action,
          kind: editingRule.kind,
          pattern,
          note: editingRule.note.trim(),
          enabled: editingRule.enabled,
        }),
      () => {
        setEditingRule(null);
        intercept.reload();
      },
    );
  };

  /** C6：执行已确认的启停（旧页 overview-tab.tsx:1156-1163；计划要求先二次确认）。 */
  const runToggleConfirm = (): void => {
    if (confirmToggle === null || toggleBusy) return;
    const target = confirmToggle;
    const label = target.nextEnabled ? "启用拦截规则" : "停用拦截规则";
    setToggleBusy(true);
    setWriteError(null);
    toggleTaskInterceptRule(task.id, target.id, target.nextEnabled)
      .then(() => {
        setToggleBusy(false);
        setConfirmToggle(null);
        toast(label);
        intercept.reload();
      })
      .catch((reason: unknown) => {
        setToggleBusy(false);
        setConfirmToggle(null);
        setWriteError(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const base = summary.task ?? task;
  const stats = summary.stats;
  return (
    <div className={css.wrap} data-task-overview="">
      {writeError === null ? null : (
        <div className={css.stateError} role="alert" data-task-overview-write-error="">
          {writeError}
        </div>
      )}

      {/* C1：任务基本信息（旧页 :433-452 描述与目标 + :894-938 心跳里的状态字段）。 */}
      <section className={css.section} data-overview-basic="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>任务信息</span>
          <span className={css.sectionHint}>本任务的基本信息，来自任务详情接口。</span>
          <Button variant="outline" size="sm" onClick={summary.reload} data-overview-refresh="">
            刷新
          </Button>
        </div>
        {summary.phase === "loading" ? (
          <div className={css.state} data-overview-basic-state="loading">
            加载任务信息…
          </div>
        ) : null}
        {summary.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-basic-state="offline">
            <span>任务信息读取失败：{summary.error}</span>
            <Button variant="outline" size="sm" onClick={summary.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {summary.phase === "ready" ? (
          <div className={css.fields}>
            <div className={css.field}>
              <span className={css.fieldLabel}>名称</span>
              <span className={css.fieldValue} data-overview-name="">
                {(base.name ?? "").trim() === "" ? "（未命名）" : base.name}
              </span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>状态</span>
              <span className={css.fieldValue}>
                <Tag tone={base.status === "failed" ? "danger" : base.status === "done" ? "success" : "info"}>
                  {base.status}
                </Tag>
                {base.paused === true ? <Tag tone="warning">已暂停</Tag> : null}
                {base.queued === true ? <Tag tone="neutral">排队中</Tag> : null}
              </span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>创建时间</span>
              <span className={css.fieldValue}>{timeText(base.created_at)}</span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>完成时间</span>
              <span className={css.fieldValue}>{timeText(base.completed_at)}</span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>最近活动</span>
              <span className={css.fieldValue}>{timeText(base.last_activity)}</span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>分类</span>
              <span className={css.fieldValue}>
                {base.category_name === undefined || base.category_name === "" ? "—" : base.category_name}
              </span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>任务 id</span>
              <span className={`${css.fieldValue} ${css.mono}`}>{base.id}</span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>引擎态</span>
              <span className={css.fieldValue}>{stats === null ? (base.engine_mode ?? "—") : stats.engine_mode}</span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>目标进度</span>
              <span className={css.fieldValue} data-overview-goal-progress="">
                {`${num(base.goals_met ?? 0)} / ${num(base.goals_total ?? 0)}`}
              </span>
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>运行中</span>
              <span className={css.fieldValue}>{num(base.in_flight ?? 0)}</span>
            </div>
            {base.source_task_ids !== undefined && base.source_task_ids.length > 0 ? (
              <div className={`${css.field} ${css.fieldWide}`}>
                <span className={css.fieldLabel}>来源任务（直接关联，只读继承）</span>
                <span className={`${css.fieldValue} ${css.mono}`}>{base.source_task_ids.join("、")}</span>
              </div>
            ) : null}
            <div className={`${css.field} ${css.fieldWide}`}>
              <span className={css.fieldLabel}>描述</span>
              <p className={css.textBlock}>{base.description.trim() === "" ? "—" : base.description}</p>
            </div>
            <div className={`${css.field} ${css.fieldWide}`}>
              <span className={css.fieldLabel}>目标（创建时填写）</span>
              <p className={css.textBlock}>{base.goal.trim() === "" ? "—" : base.goal}</p>
            </div>
          </div>
        ) : null}
      </section>

      {/* C2：统计数字（旧页 :894-938 心跳 + :1043-1048 统计卡片，数据来自 `GET /stats?task=`）。 */}
      <section className={css.section} data-overview-stats="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>统计</span>
          <span className={css.sectionHint}>本任务的统计数字，来自统计接口（按本任务过滤）。</span>
        </div>
        {summary.phase === "loading" ? (
          <div className={css.state} data-overview-stats-state="loading">
            加载统计…
          </div>
        ) : null}
        {summary.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-stats-state="offline">
            统计读取失败：{summary.error}
          </div>
        ) : null}
        {summary.phase === "ready" && stats === null ? (
          <p className={css.empty} data-overview-stats-state="empty">
            暂无统计数据。
          </p>
        ) : null}
        {summary.phase === "ready" && stats !== null ? (
          <div className={css.stats} data-overview-stats-grid="">
            <div className={css.statCard}>
              <span className={css.statLabel}>资产</span>
              <span className={css.statValue}>{num(stats.assets)}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>本任务已确认</span>
              {/* W-5：后端 `/stats` 从不返回 findings_confirmed（types.ts 声明为必填但 Go 端
                  没有这个统计），此前直接 num() 把概览页打崩过。这里改用本任务发现列表里
                  status==="confirmed" 的计数，与下一格「本任务发现」互补，全是真实数据。 */}
              <span className={css.statValue} data-overview-stat-confirmed="">
                {summary.phase === "ready"
                  ? num(summary.findings.filter((finding) => finding.status === "confirmed").length)
                  : "—"}
              </span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>本任务发现</span>
              <span className={css.statValue} data-overview-stat-findings="">
                {summary.phase === "ready" ? num(summary.findings.length) : "—"}
              </span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>引擎态</span>
              <span className={css.statValue}>{stats.engine_mode}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>模型已配置</span>
              <span className={css.statValue}>{stats.llm_configured ? "是" : "否"}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>本任务流量</span>
              {/* W-5：`/stats` 从不返回 roe_enabled（全库端点已核查无此字段），不造假；
                  该卡换为本任务已捕获的流量条数（`GET /stats?task=` 是任务级口径，实测
                  traffic 字段真实存在），卡片语义与数据源一致。 */}
              <span className={css.statValue} data-overview-stat-traffic="">
                {num(statsTraffic(stats))}
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {/* C3：目标管理（旧页 :455-574）。 */}
      <section className={css.section} data-overview-goals="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>目标管理</span>
          <span className={css.sectionHint}>最终可核验的目标；新增与修改会通知规划者并复活任务，删除只通知规划者。</span>
          <span className={css.count}>{goals.phase === "ready" ? `${goals.goals.length} 条` : ""}</span>
        </div>
        <div className={css.formRow}>
          <span className={css.grow}>
            <Input
              value={goalText}
              placeholder="新增目标，如「拿到管理员账号的越权访问」"
              disabled={busy}
              data-overview-goal-input=""
              onChange={(event) => setGoalText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitGoal();
              }}
            />
          </span>
          <span className={css.narrow}>
            <Input
              value={goalVuln}
              placeholder="漏洞类（可选）"
              disabled={busy}
              data-overview-goal-vuln=""
              onChange={(event) => setGoalVuln(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitGoal();
              }}
            />
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || goalText.trim() === ""}
            data-overview-goal-add=""
            onClick={submitGoal}
          >
            {busy ? "处理中…" : "添加"}
          </Button>
        </div>
        {goals.phase === "loading" ? (
          <div className={css.state} data-overview-goals-state="loading">
            加载目标…
          </div>
        ) : null}
        {goals.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-goals-state="offline">
            <span>目标读取失败：{goals.error}</span>
            <Button variant="outline" size="sm" onClick={goals.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {goals.phase === "ready" && goals.goals.length === 0 ? (
          <p className={css.empty} data-overview-goals-state="empty">
            暂无目标。添加后规划者会据此派发探索意图并判定达成。
          </p>
        ) : null}
        {goals.phase === "ready" && goals.goals.length > 0 ? (
          <ul className={css.list} data-overview-goal-rows="">
            {goals.goals.map((row) =>
              editingGoal !== null && editingGoal.id === row.id ? (
                <li key={row.id} className={css.editRow} data-overview-goal-edit={row.id}>
                  <span className={css.grow}>
                    <Input
                      value={editingGoal.text}
                      disabled={busy}
                      data-overview-goal-edit-text={row.id}
                      onChange={(event) =>
                        setEditingGoal((current) =>
                          current === null ? current : { ...current, text: event.currentTarget.value },
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveGoal(row);
                        if (event.key === "Escape") setEditingGoal(null);
                      }}
                    />
                  </span>
                  <span className={css.narrow}>
                    <Input
                      value={editingGoal.vuln}
                      placeholder="漏洞类（可选）"
                      disabled={busy}
                      data-overview-goal-edit-vuln={row.id}
                      onChange={(event) =>
                        setEditingGoal((current) =>
                          current === null ? current : { ...current, vuln: event.currentTarget.value },
                        )
                      }
                    />
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || editingGoal.text.trim() === ""}
                    data-overview-goal-save={row.id}
                    onClick={() => saveGoal(row)}
                  >
                    保存
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditingGoal(null)}>
                    取消
                  </Button>
                </li>
              ) : (
                <li key={row.id} className={css.row} data-overview-goal={row.id}>
                  <div className={css.rowMain}>
                    <Tag tone="outline">{row.state}</Tag>
                    <span className={css.rowText} title={row.text}>
                      {row.text}
                    </span>
                    {(row.vulnclass ?? "") === "" ? null : <span className={css.rowVuln}>{row.vulnclass}</span>}
                  </div>
                  <span className={css.rowMeta}>{timeText(row.ts)}</span>
                  <div className={css.rowActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-overview-goal-edit-open={row.id}
                      onClick={() => setEditingGoal({ id: row.id, text: row.text, vuln: row.vulnclass ?? "" })}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-overview-goal-delete={row.id}
                      onClick={() => setConfirm({ kind: "goal", id: row.id, text: row.text })}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </section>

      {/* C4：操作约束（旧页 :578-702）。 */}
      <section className={css.section} data-overview-constraints="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>操作约束</span>
          <span className={css.sectionHint}>框定 planner/worker 的探索边界；改动在下一轮规划生效。</span>
          <span className={css.count}>
            {constraints.phase === "ready" ? `${constraints.constraints.length} 条` : ""}
          </span>
        </div>
        <div className={css.formRow}>
          <SelectMenu
            ariaLabel="新增约束的种类"
            value={conKind}
            options={CONSTRAINT_KIND_OPTIONS}
            disabled={busy}
            onChange={(value) => setConKind(value === "allow" ? "allow" : "deny")}
          />
          <span className={css.grow}>
            <Input
              value={conText}
              placeholder="一条操作约束，如「仅测当前端口，不扫其他端口」"
              disabled={busy}
              data-overview-constraint-input=""
              onChange={(event) => setConText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitConstraint();
              }}
            />
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || conText.trim() === ""}
            data-overview-constraint-add=""
            onClick={submitConstraint}
          >
            {busy ? "处理中…" : "添加"}
          </Button>
        </div>
        {constraints.phase === "loading" ? (
          <div className={css.state} data-overview-constraints-state="loading">
            加载约束…
          </div>
        ) : null}
        {constraints.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-constraints-state="offline">
            <span>约束读取失败：{constraints.error}</span>
            <Button variant="outline" size="sm" onClick={constraints.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {constraints.phase === "ready" && constraints.constraints.length === 0 ? (
          <p className={css.empty} data-overview-constraints-state="empty">
            暂无操作约束。建任务时会自动从描述/目标抽取；也可在此手动增删改，用来框定「允许/禁止做哪些操作」。
          </p>
        ) : null}
        {constraints.phase === "ready" && constraints.constraints.length > 0 ? (
          <ul className={css.list} data-overview-constraint-rows="">
            {constraints.constraints.map((row) =>
              editingCon !== null && editingCon.id === row.id ? (
                <li key={row.id} className={css.editRow} data-overview-constraint-edit={row.id}>
                  <SelectMenu
                    ariaLabel="约束种类"
                    value={editingCon.kind}
                    options={CONSTRAINT_KIND_OPTIONS}
                    disabled={busy}
                    onChange={(value) =>
                      setEditingCon((current) =>
                        current === null ? current : { ...current, kind: value === "allow" ? "allow" : "deny" },
                      )
                    }
                  />
                  <span className={css.grow}>
                    <Input
                      value={editingCon.text}
                      disabled={busy}
                      data-overview-constraint-edit-text={row.id}
                      onChange={(event) =>
                        setEditingCon((current) =>
                          current === null ? current : { ...current, text: event.currentTarget.value },
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveConstraint(row);
                        if (event.key === "Escape") setEditingCon(null);
                      }}
                    />
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || editingCon.text.trim() === ""}
                    data-overview-constraint-save={row.id}
                    onClick={() => saveConstraint(row)}
                  >
                    保存
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditingCon(null)}>
                    取消
                  </Button>
                </li>
              ) : (
                <li key={row.id} className={css.row} data-overview-constraint={row.id}>
                  <div className={css.rowMain}>
                    <Tag tone={row.kind === "allow" ? "success" : "danger"}>
                      {row.kind === "allow" ? "允许" : "禁止"}
                    </Tag>
                    <span className={css.rowText} title={row.text}>
                      {row.text}
                    </span>
                  </div>
                  <div className={css.rowActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-overview-constraint-edit-open={row.id}
                      onClick={() => setEditingCon({ id: row.id, text: row.text, kind: row.kind })}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-overview-constraint-delete={row.id}
                      onClick={() => setConfirm({ kind: "constraint", id: row.id, text: row.text })}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </section>

      {/* C5：测试范围（旧页 :808-893）。 */}
      <section className={css.section} data-overview-scope="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>测试范围</span>
          <span className={css.sectionHint}>覆盖度分母 + 授权边界；继承自来源任务的行不能删除。</span>
          <span className={css.count}>{scope.phase === "ready" ? `${scope.scope.length} 条` : ""}</span>
        </div>
        <div className={css.formRow}>
          <SelectMenu
            ariaLabel="新增范围的种类"
            value={scopeKind}
            options={SCOPE_KIND_OPTIONS}
            disabled={busy}
            onChange={(value) => {
              const hit = SCOPE_KIND_OPTIONS.find((option) => option.value === value);
              if (hit !== undefined) setScopeKind(hit.value);
            }}
          />
          <span className={css.grow}>
            <Input
              value={scopeValueInput}
              placeholder={
                scopeKind === "company"
                  ? "公司名或 id"
                  : scopeKind === "ip" || scopeKind === "cidr"
                    ? "如 10.0.0.1 或 10.0.0.0/24"
                    : scopeKind === "icp"
                      ? "如 京ICP备12345678号-1"
                      : scopeKind === "keyword"
                        ? "如 企业名称关键词"
                        : "如 example.com"
              }
              disabled={busy}
              data-overview-scope-input=""
              onChange={(event) => setScopeValueInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitScope();
              }}
            />
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || scopeValueInput.trim() === ""}
            data-overview-scope-add=""
            onClick={submitScope}
          >
            {busy ? "处理中…" : "添加"}
          </Button>
        </div>
        {scope.phase === "loading" ? (
          <div className={css.state} data-overview-scope-state="loading">
            加载测试范围…
          </div>
        ) : null}
        {scope.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-scope-state="offline">
            <span>测试范围读取失败：{scope.error}</span>
            <Button variant="outline" size="sm" onClick={scope.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {scope.phase === "ready" && scope.scope.length === 0 ? (
          <p className={css.empty} data-overview-scope-state="empty">
            暂无测试范围。添加后可作为资产覆盖度的分母。
          </p>
        ) : null}
        {scope.phase === "ready" && scope.scope.length > 0 ? (
          <ul className={css.list} data-overview-scope-rows="">
            {scope.scope.map((row) => (
              <li key={row.id} className={css.row} data-overview-scope={row.id}>
                <div className={css.rowMain}>
                  <Tag tone="outline">{SCOPE_KIND_LABEL[row.kind]}</Tag>
                  <span className={`${css.rowText} ${css.mono}`} title={scopeValue(row)}>
                    {scopeValue(row)}
                  </span>
                </div>
                <span className={css.rowMeta}>{SCOPE_SOURCE_LABEL[row.source]}</span>
                {String(row.task_id) === task.id ? (
                  <div className={css.rowActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      data-overview-scope-delete={row.id}
                      onClick={() => setConfirm({ kind: "scope", id: row.id, text: scopeValue(row) })}
                    >
                      删除
                    </Button>
                  </div>
                ) : (
                  <span className={css.rowMeta}>继承</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* C6：任务级资产拦截 / 允许规则（旧页 overview-tab.tsx:1053-1322）。只本任务生效，不进全局表。 */}
      <section className={css.section} data-overview-intercept="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>任务级资产拦截 / 允许</span>
          <span className={css.sectionHint}>
            仅本任务生效，不进全局表；先拦截后允许。「拦截」命中即禁止测试，「允许」为白名单。
          </span>
          <span className={css.count}>{intercept.phase === "ready" ? `${intercept.rules.length} 条` : ""}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={intercept.reload}
            disabled={intercept.phase === "loading"}
            data-overview-intercept-refresh=""
          >
            刷新
          </Button>
        </div>
        <div className={css.formRow}>
          <SelectMenu
            ariaLabel="新增规则的动作"
            value={ruleAction}
            options={TASK_RULE_ACTION_OPTIONS}
            disabled={busy}
            onChange={(value) => setRuleAction(value === "allow" ? "allow" : "block")}
          />
          <SelectMenu
            ariaLabel="新增规则的种类"
            value={ruleKind}
            options={TASK_RULE_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            disabled={busy}
            onChange={(value) => {
              const hit = TASK_RULE_KIND_OPTIONS.find((option) => option.value === value);
              if (hit !== undefined) setRuleKind(hit.value);
            }}
          />
          <span className={css.grow}>
            <Input
              value={rulePattern}
              placeholder={
                TASK_RULE_KIND_OPTIONS.find((option) => option.value === ruleKind)?.placeholder ?? ""
              }
              disabled={busy}
              data-overview-intercept-input=""
              onChange={(event) => setRulePattern(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRule();
              }}
            />
          </span>
          <span className={css.narrow}>
            <Input
              value={ruleNote}
              placeholder="备注(可选)"
              disabled={busy}
              data-overview-intercept-note=""
              onChange={(event) => setRuleNote(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRule();
              }}
            />
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || rulePattern.trim() === ""}
            data-overview-intercept-add=""
            onClick={submitRule}
          >
            {busy ? "处理中…" : "添加"}
          </Button>
        </div>
        {intercept.phase === "loading" ? (
          <div className={css.state} data-overview-intercept-state="loading">
            加载拦截规则…
          </div>
        ) : null}
        {intercept.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-intercept-state="offline">
            <span>拦截规则读取失败：{intercept.error}</span>
            <Button variant="outline" size="sm" onClick={intercept.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {intercept.phase === "ready" && intercept.rules.length === 0 ? (
          <p className={css.empty} data-overview-intercept-state="empty">
            暂无任务级规则。「拦截」命中即禁止测试；「允许」为白名单——配置后本任务只允许命中允许规则的资产（未配置则不启用白名单）。
          </p>
        ) : null}
        {intercept.phase === "ready" && intercept.rules.length > 0 ? (
          <ul className={css.list} data-overview-intercept-rows="">
            {intercept.rules.map((row) =>
              editingRule !== null && editingRule.id === row.id ? (
                <li key={row.id} className={css.editRow} data-overview-intercept-edit={row.id}>
                  <SelectMenu
                    ariaLabel="规则动作"
                    value={editingRule.action}
                    options={TASK_RULE_ACTION_OPTIONS}
                    disabled={busy}
                    onChange={(value) =>
                      setEditingRule((current) =>
                        current === null ? current : { ...current, action: value === "allow" ? "allow" : "block" },
                      )
                    }
                  />
                  <SelectMenu
                    ariaLabel="规则种类"
                    value={editingRule.kind}
                    options={TASK_RULE_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    disabled={busy}
                    onChange={(value) => {
                      const hit = TASK_RULE_KIND_OPTIONS.find((option) => option.value === value);
                      if (hit === undefined) return;
                      setEditingRule((current) => (current === null ? current : { ...current, kind: hit.value }));
                    }}
                  />
                  <span className={css.grow}>
                    <Input
                      value={editingRule.pattern}
                      disabled={busy}
                      data-overview-intercept-edit-pattern={row.id}
                      onChange={(event) =>
                        setEditingRule((current) =>
                          current === null ? current : { ...current, pattern: event.currentTarget.value },
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveRule(row);
                        if (event.key === "Escape") setEditingRule(null);
                      }}
                    />
                  </span>
                  <span className={css.narrow}>
                    <Input
                      value={editingRule.note}
                      placeholder="备注(可选)"
                      disabled={busy}
                      data-overview-intercept-edit-note={row.id}
                      onChange={(event) =>
                        setEditingRule((current) =>
                          current === null ? current : { ...current, note: event.currentTarget.value },
                        )
                      }
                    />
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || editingRule.pattern.trim() === ""}
                    data-overview-intercept-save={row.id}
                    onClick={() => saveRule(row)}
                  >
                    保存
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditingRule(null)}>
                    取消
                  </Button>
                </li>
              ) : (
                <li key={row.id} className={css.row} data-overview-intercept={row.id}>
                  <div className={css.rowMain}>
                    <Tag tone={row.action === "allow" ? "success" : "danger"}>{taskRuleActionLabel(row)}</Tag>
                    <span className={css.rowMeta}>{TASK_RULE_KIND_LABEL[row.kind] ?? row.kind}</span>
                    <span className={`${css.rowText} ${css.mono}`} title={row.pattern}>
                      {row.pattern}
                    </span>
                    {(row.note ?? "") === "" ? null : (
                      <span className={css.rowVuln} title={row.note}>
                        {row.note}
                      </span>
                    )}
                  </div>
                  <div className={css.rowActions}>
                    <Switch
                      checked={row.enabled}
                      disabled={busy || toggleBusy}
                      label={`启用任务级规则 ${row.pattern}`}
                      onChange={(next) =>
                        setConfirmToggle({
                          id: row.id,
                          action: taskRuleActionLabel(row),
                          pattern: row.pattern,
                          nextEnabled: next,
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || toggleBusy}
                      data-overview-intercept-edit-open={row.id}
                      onClick={() =>
                        setEditingRule({
                          id: row.id,
                          action: row.action === "allow" ? "allow" : "block",
                          kind: row.kind,
                          pattern: row.pattern,
                          note: row.note ?? "",
                          enabled: row.enabled,
                        })
                      }
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || toggleBusy}
                      data-overview-intercept-delete={row.id}
                      onClick={() => setConfirm({ kind: "intercept", id: row.id, text: `${taskRuleActionLabel(row)} ${row.pattern}` })}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </section>

      {/* C7：任务内发现（只读；旧页 :985-1000 最近发现）。 */}
      <section className={css.section} data-overview-findings="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>任务内发现</span>
          <span className={css.sectionHint}>只读列表，点「打开详情」跳到发现页。</span>
          <span className={css.count}>
            {summary.phase === "ready" ? `${summary.findings.length} 条` : ""}
          </span>
        </div>
        {summary.phase === "loading" ? (
          <div className={css.state} data-overview-findings-state="loading">
            加载发现…
          </div>
        ) : null}
        {summary.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-findings-state="offline">
            发现读取失败：{summary.error}
          </div>
        ) : null}
        {summary.phase === "ready" && summary.findings.length === 0 ? (
          <p className={css.empty} data-overview-findings-state="empty">
            暂无发现。
          </p>
        ) : null}
        {summary.phase === "ready" && summary.findings.length > 0 ? (
          <ul className={css.list} data-overview-finding-rows="">
            {summary.findings.map((row) => {
              const handle = row.finding_id ?? row.id;
              return (
                <li key={row.finding_id ?? row.id} className={css.row} data-overview-finding={handle}>
                  <div className={css.rowMain}>
                    <span className={css.rowText} title={findingTitle(row)}>
                      {findingTitle(row)}
                    </span>
                    <Tag tone={severityTone(row.severity)}>{severityLabel(row.severity)}</Tag>
                    <Tag tone="neutral">{findingStatusLabel(row.status)}</Tag>
                  </div>
                  <span className={css.rowMeta}>{formatFindingTime(row.ts)}</span>
                  <div className={css.rowActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-overview-finding-open={handle}
                      onClick={() => openFindingDetail(handle)}
                    >
                      打开详情
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {/* C18 / L3：前沿（当前可做的意图）。数据来自 `api.frontier`（api.ts:635），旧页 overview-tab.tsx:415-417,976,1045。 */}
      <section className={css.section} data-overview-frontier="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>前沿（可做意图）</span>
          <span className={css.sectionHint}>
            {`当前可领取的意图，最多显示 ${FRONTIER_LIMIT} 条；本区块只读，不派发、不领取。`}
          </span>
          <span className={css.count}>{frontier.phase === "ready" ? `${frontier.nodes.length} 条` : ""}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={frontier.reload}
            disabled={frontier.phase === "loading"}
            data-overview-frontier-refresh=""
          >
            刷新
          </Button>
        </div>
        {frontier.phase === "loading" ? (
          <div className={css.state} data-overview-frontier-state="loading">
            加载前沿…
          </div>
        ) : null}
        {frontier.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-frontier-state="offline">
            <span>前沿读取失败：{frontier.error}</span>
            <Button variant="outline" size="sm" onClick={frontier.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {frontier.phase === "ready" && frontier.nodes.length === 0 ? (
          <p className={css.empty} data-overview-frontier-state="empty">
            前沿为空：当前没有可领取的意图。规划者派出新意图、或任务被唤醒后会再出现。
          </p>
        ) : null}
        {frontier.phase === "ready" && frontier.nodes.length > 0 ? (
          <ul className={css.list} data-overview-frontier-rows="">
            {frontierRows(frontier.nodes).map((row) => (
              <li key={row.id} className={css.row} data-overview-frontier={row.id}>
                <div className={css.rowMain}>
                  <Tag tone={frontierStateTone(row.stateKey)}>{row.stateLabel}</Tag>
                  <span className={css.rowText} title={row.payload === "" ? row.title : row.payload}>
                    {row.title}
                  </span>
                </div>
                <span className={css.rowMeta}>优先级 {row.priority}</span>
                <span className={css.rowMeta}>{row.created === "" ? "—" : row.created}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* C18 / L5：统计与审计。统计复用本页上方 `useOverviewSummary` 的 stats（不再请求一次），审计来自 `api.audit`（api.ts:879）。 */}
      <section className={css.section} data-overview-stats-audit="">
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>统计与审计</span>
          <span className={css.sectionHint}>只读：统计数字来自统计接口，审计来自工具拦截审计接口。</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              summary.reload();
              audit.reload();
            }}
            disabled={summary.phase === "loading" || audit.phase === "loading"}
            data-overview-stats-audit-refresh=""
          >
            刷新
          </Button>
        </div>

        {/* 统计 */}
        <div className={css.subHead}>
          <span className={css.subTitle}>统计</span>
        </div>
        {summary.phase === "loading" ? (
          <div className={css.state} data-overview-stats-audit-stats-state="loading">
            加载统计…
          </div>
        ) : null}
        {summary.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-stats-audit-stats-state="offline">
            <span>统计读取失败：{summary.error}</span>
            <Button variant="outline" size="sm" onClick={summary.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {summary.phase === "ready" ? (
          <div className={css.stats} data-overview-stats-audit-stats="">
            {overviewStatsItems(stats, {
              met: base.goals_met ?? 0,
              total: base.goals_total ?? 0,
            }).map((item) => (
              <div key={item.key} className={css.statCard} data-overview-stats-audit-stat={item.key}>
                <span className={css.statLabel}>{item.label}</span>
                <span className={css.statValue}>{num(item.value)}</span>
              </div>
            ))}
            <div className={css.statCard} data-overview-stats-audit-stat="engine_mode">
              <span className={css.statLabel}>引擎态</span>
              <span className={css.statValue}>{stats === null ? "—" : stats.engine_mode}</span>
            </div>
            <div className={css.statCard} data-overview-stats-audit-stat="llm_configured">
              <span className={css.statLabel}>模型已配置</span>
              <span className={css.statValue}>{stats === null ? "—" : stats.llm_configured ? "是" : "否"}</span>
            </div>
            <div className={css.statCard} data-overview-stats-audit-stat="traffic">
              <span className={css.statLabel}>本任务流量</span>
              {/* W-5：roe_enabled 后端不存在（已核查 /stats、/settings、intercept 配置）；
                  该卡与本任务统计区一致换为真实的任务级流量条数。 */}
              <span className={css.statValue}>{stats === null ? "—" : num(statsTraffic(stats))}</span>
            </div>
            {stats === null ? (
              <p className={css.empty} data-overview-stats-audit-stats-state="empty">
                统计接口没有返回数据。
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 审计 */}
        <div className={css.subHead}>
          <span className={css.subTitle}>审计</span>
          <span className={css.count}>
            {audit.phase === "ready" ? `最近 ${AUDIT_RECENT_LIMIT} 条` : ""}
          </span>
        </div>
        {audit.phase === "loading" ? (
          <div className={css.state} data-overview-audit-state="loading">
            加载审计…
          </div>
        ) : null}
        {audit.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-audit-state="offline">
            <span>审计读取失败：{audit.error}</span>
            <Button variant="outline" size="sm" onClick={audit.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {audit.phase === "ready" && audit.entries.length === 0 ? (
          <p className={css.empty} data-overview-audit-state="empty">
            暂无审计记录。工具调用被放行或拦截后会出现在这里。
          </p>
        ) : null}
        {audit.phase === "ready" && audit.entries.length > 0 ? (
          <ul className={css.list} data-overview-audit-rows="">
            {audit.entries.map((entry, index) => (
              <li key={`${entry.ts}-${entry.tool}-${String(index)}`} className={css.auditRow}>
                <div className={css.rowMain}>
                  <Tag tone={entry.action === "block" ? "danger" : "success"}>{auditActionLabel(entry.action)}</Tag>
                  <span className={`${css.rowText} ${css.mono}`} title={entry.tool}>
                    {entry.tool === "" ? "（未记录工具名）" : entry.tool}
                  </span>
                </div>
                <span className={css.rowMeta}>{auditTimeText(entry.ts)}</span>
                {entry.reason === undefined || entry.reason === "" ? null : (
                  <p className={css.auditLine}>原因：{entry.reason}</p>
                )}
                {entry.command === undefined || entry.command === "" ? null : (
                  <p className={`${css.auditLine} ${css.mono}`}>命令：{entry.command}</p>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {audit.phase === "ready" && audit.attributions.length > 0 ? (
          <div className={css.attrBlock}>
            <span className={css.subTitle}>失败归因</span>
            <div className={css.attrChips}>
              {audit.attributions.map((row) => (
                <Tag key={row.key} tone="outline">{`${row.key} × ${num(row.count)}`}</Tag>
              ))}
            </div>
          </div>
        ) : null}

        {/* C18 / P2:A11：活动流（最近几行）。旧页 dashboard/page.tsx:847-908 的活动流只显示
            worker / kind / summary / 相对时间，不点行；总览页的任务行（:956-1042）才是入口。
            /v2 的「任务详情」就是会话视图，所以这里用 `?task=<id>` 深链（Shell 支持该参数）。
            后端给不出可跳的 task 时整行保持不可点（红线 3：不画假链接）。 */}
        <div className={css.subHead}>
          <span className={css.subTitle}>活动流</span>
          <span className={css.count}>
            {activity.phase === "ready" ? `最近 ${Math.min(OVERVIEW_ACTIVITY_RECENT, activity.activities.length)} 条` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={activity.reload}
            disabled={activity.phase === "loading"}
            data-overview-activity-refresh=""
          >
            刷新
          </Button>
        </div>
        {activity.phase === "loading" || activity.phase === "idle" ? (
          <div className={css.state} data-overview-activity-state="loading">
            加载活动流…
          </div>
        ) : null}
        {activity.phase === "offline" ? (
          <div className={css.stateError} role="alert" data-overview-activity-state="offline">
            <span>活动流读取失败：{activity.error ?? "未知原因"}</span>
            <Button variant="outline" size="sm" onClick={activity.reload}>
              重试
            </Button>
          </div>
        ) : null}
        {activity.phase === "ready" && activity.activities.length === 0 ? (
          <p className={css.empty} data-overview-activity-state="empty">
            暂无活动记录。
          </p>
        ) : null}
        {activity.phase === "ready" && activity.activities.length > 0 ? (
          <ul className={css.list} data-overview-activity-rows="">
            {activity.activities
              .slice(Math.max(0, activity.activities.length - OVERVIEW_ACTIVITY_RECENT))
              .reverse()
              .map((row) => {
                const target =
                  row.source_task_id !== undefined && row.source_task_id.trim() !== ""
                    ? row.source_task_id.trim()
                    : task.id;
                return (
                  <li key={row.seq} className={css.row} data-overview-activity={row.seq}>
                    <button
                      type="button"
                      className={css.activityRowBtn}
                      title={`打开任务 ${target} 的会话`}
                      data-overview-activity-open={target}
                      onClick={() => openTaskConversation(target)}
                    >
                      <Tag tone="outline">{row.worker}</Tag>
                      <span className={css.rowMain}>
                        <span className={css.rowText}>{activityKindLabel(row)}</span>
                        <span className={css.rowMeta} title={row.summary}>
                          {row.summary}
                        </span>
                      </span>
                      <span className={css.rowActions}>
                        <Tag tone={row.is_error === true ? "danger" : "outline"}>{row.kind}</Tag>
                        <span className={css.rowMeta}>{activityRowTime(row.ts)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        ) : null}
      </section>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        title={confirm === null ? "确认删除" : deleteTitle(confirm)}
        closeLabel="关闭"
        tone="warning"
        description={confirm === null ? undefined : deleteDescription(confirm)}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={confirmBusy}
              data-overview-delete-cancel=""
              onClick={() => setConfirm(null)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={confirmBusy}
              data-overview-delete-confirm=""
              onClick={runConfirm}
            >
              {confirmBusy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className={css.confirmText} data-overview-delete-target="">
          {confirm === null ? "" : confirm.text}
        </p>
      </Modal>

      {/* C6：启停的二次确认（计划 §5.5：切换本任务实际拦截行为的危险操作）。 */}
      <Modal
        open={confirmToggle !== null}
        onClose={() => {
          if (!toggleBusy) setConfirmToggle(null);
        }}
        title={confirmToggle !== null && confirmToggle.nextEnabled ? "确认启用规则" : "确认停用规则"}
        closeLabel="关闭"
        tone="warning"
        description={
          confirmToggle === null
            ? undefined
            : confirmToggle.nextEnabled
              ? "启用后这条规则立即对本任务生效，命中的资产会被拦截或放行。"
              : "停用后这条规则不再对本任务生效，命中的资产将不再被拦截或放行。"
        }
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={toggleBusy}
              data-overview-intercept-toggle-cancel=""
              onClick={() => setConfirmToggle(null)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={toggleBusy}
              data-overview-intercept-toggle-confirm=""
              onClick={runToggleConfirm}
            >
              {toggleBusy ? "处理中…" : confirmToggle !== null && confirmToggle.nextEnabled ? "确认启用" : "确认停用"}
            </Button>
          </>
        }
      >
        <p className={css.confirmText} data-overview-intercept-toggle-target="">
          {confirmToggle === null ? "" : `${confirmToggle.action} ${confirmToggle.pattern}`}
        </p>
      </Modal>
    </div>
  );
}
