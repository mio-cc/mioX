"use client";

/**
 * 任务概览（会话视图 tab「概览」，对照表 P1:C1–C7）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/overview-tab.tsx:433-452（描述与目标）、
 * :455-574（目标与验收项，DX-OV 与总目标行合并）、:578-702（操作约束）、:808-893（测试范围）、:894-938（心跳）、:1043-1048（统计数字）、
 * :1053-1322（任务级资产拦截 / 允许规则，含新增表单、行内编辑、是否启用开关、删除）。
 * DSH 依据：DSH 无任务概览页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 * 接口：全部走 `v2/data/task-overview.ts`（api.ts:280/419/436/439-445/493/498-504/508-517/520/522-525/636）。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";

import type {
  AssetInterceptAction,
  AssetInterceptKind,
  AssetInterceptRule,
  ConstraintKind,
  Stats,
  Task,
  TaskConstraint,
  TaskGoal,
  TaskScopeRow,
} from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { SelectMenu } from "@/components/v2/settings/SelectMenu";
import {
  Badge,
  Card,
  Dot,
  Empty,
  Facts,
  FilterBar,
  IconButton,
  kit,
  type KitTone,
  Meta,
  Metrics,
  Notice,
  Page,
  PageHead,
  Row,
  RowMenu,
  Section,
  Skeleton,
} from "@/components/v2/design/Kit";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconEditOutlineRegular,
  IconLayersOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconShieldOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";
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
// DX-OV：总目标行（task_goals）与「在会话中设置目标」动作。
import { useTaskGoal, type GoalActionResult } from "@/v2/data/goal";
import { prefillComposer } from "@/v2/data/composer-prefill";
import { setConversationView } from "@/v2/data/conversation-view-url";
import {
  AUDIT_RECENT_LIMIT,
  auditActionLabel,
  auditTimeText,
  FRONTIER_LIMIT,
  frontierRows,
  frontierStateTone,
  overviewStatsItems,
  useTaskAudit,
  useTaskFrontier,
} from "@/v2/data/task-frontier";

import css from "./OverviewView.module.css";
import { TaskModelView } from "./TaskModelView";

/** U2：概览的两个子视图。 */
const OVERVIEW_TABS = [
  { value: "status", label: "状态", data: { "data-view-sub-option": "status" } },
  { value: "config", label: "配置", data: { "data-view-sub-option": "config" } },
] as const;

/** 权限档中文名（与输入框 Composer.tsx PERMISSIONS 同一份口径）。 */
function permissionLabel(level: string | undefined): string {
  switch (level) {
    case "read-only":
      return "仅可查看";
    case "workspace-write":
      return "工作区内修改";
    case "danger-full":
      return "完全权限";
    case undefined:
    case "":
    case "auto":
      return "自动";
    default:
      return level;
  }
}

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

/** 任务状态的中文名与色调（types.ts:4 的七个取值；未知值原样显示）。 */
const TASK_STATUS_META: Record<string, { label: string; tone: KitTone }> = {
  created: { label: "已创建", tone: "neutral" },
  queued: { label: "排队中", tone: "neutral" },
  running: { label: "运行中", tone: "info" },
  paused: { label: "已暂停", tone: "warning" },
  done: { label: "已完成", tone: "done" },
  failed: { label: "失败", tone: "danger" },
  timeout: { label: "超时", tone: "danger" },
};

/**
 * 任务状态的展示信息。
 * @param status - 后端任务状态。
 * @returns 中文名与色调。
 */
function taskStatusMeta(status: string): { label: string; tone: KitTone } {
  return TASK_STATUS_META[status] ?? { label: status === "" ? "未知" : status, tone: "neutral" };
}

/** 引擎态的中文名与色调（types.ts:5 的四个取值；未知值原样显示）。 */
const ENGINE_MODE_META: Record<string, { label: string; tone: KitTone }> = {
  exploring: { label: "探索中", tone: "info" },
  paused: { label: "已暂停", tone: "warning" },
  stalled: { label: "停滞", tone: "warning" },
  idle: { label: "空闲", tone: "neutral" },
};

/**
 * 引擎态的展示信息。
 * @param mode - 后端引擎态；缺省表示没有。
 * @returns 中文名与色调；缺省时为 null。
 */
function engineModeMeta(mode: string | undefined | null): { label: string; tone: KitTone; raw: string } | null {
  if (mode === undefined || mode === null || mode === "") return null;
  const hit = ENGINE_MODE_META[mode];
  return hit === undefined ? { label: mode, tone: "neutral", raw: mode } : { ...hit, raw: mode };
}

/** 目标状态的中文名与色调（types.ts:420 GoalState；未知值原样显示）。 */
function goalStateMeta(state: string): { label: string; tone: KitTone } {
  if (state === "open") return { label: "未达成", tone: "neutral" };
  if (state === "met") return { label: "已达成", tone: "success" };
  if (state === "abandoned") return { label: "已放弃", tone: "warning" };
  return { label: state === "" ? "未知" : state, tone: "neutral" };
}

/**
 * 前沿状态色调：`frontierStateTone` 返回 Tag 色调，kit 没有 outline，按 neutral 显示。
 * @param stateKey - `frontierRows` 的 stateKey。
 * @returns kit 色调。
 */
function frontierKitTone(stateKey: string): KitTone {
  const tone = frontierStateTone(stateKey);
  return tone === "outline" ? "neutral" : tone;
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
  if (target.kind === "goal") return "确认删除验收项";
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
  if (target.kind === "goal") return "验收项会被硬删除，并通知规划者；此操作不可撤销。";
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
 * DX-OV 概念统一（.tmp/d5-goal-plan-schedule-design.md §3.1.1）：
 * 「目标」= 用户用 `/goal` 设的那一条总目标（task_goals）；
 * 规划者拆出的 goal 节点一律称「验收项」（本节下方列表）。
 */

/** 总目标阶段的中文话术与 Dot 色调；用词对齐 `composer/GoalBar.tsx:66-70`。 */
const TARGET_GOAL_PHASE_META: Record<string, { label: string; tone: KitTone }> = {
  active: { label: "进行中", tone: "info" },
  paused: { label: "已暂停", tone: "warning" },
  blocked: { label: "受阻", tone: "danger" },
  complete: { label: "已达成", tone: "done" },
};

/**
 * 「在会话中设置目标」：切回「对话」tab（U1 的 `setConversationView`）并预填 `/goal `。
 * 草稿与聚焦由 Composer 订阅 `miox:composer-prefill` 完成（`v2/data/composer-prefill.ts`）。
 */
function startGoalInSession(): void {
  prefillComposer("/goal ");
  setConversationView("chat");
}

/** 总目标一条的目标文本（单行省略，全文在 title 提示里）。 */
function targetGoalText(objective: string): ReactNode {
  return (
    <span title={objective} data-overview-goal-target-text="">
      {objective}
    </span>
  );
}

/**
 * 「目标与验收项」节的顶行：总目标（`task_goals`）的阶段、文本与动作。
 * 数据与目标条共用同一个 `useTaskGoal`（同一份轮询与 CAS revision），两处永远一致；
 * 本行不提供第二套「设目标」表单——没有目标时只有一个「在会话中设置目标」按钮。
 * @param props.task - 当前选中的任务。
 * @returns 总目标行（加载/离线/空态/实体四态）。
 */
function OverallGoalRow({ task }: { task: Task }): ReactNode {
  const target = useTaskGoal(task.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const goal = target.goal;
  const goalId = goal?.id;
  // 换了目标身份（清除/替换/切任务）就废弃本地编辑态，避免旧草稿 Enter 覆盖新目标
  // （同 `composer/GoalBar.tsx:127-134`）。
  useEffect(() => {
    setEditing(false);
    setDraft("");
    setActionError(null);
    setConfirmClear(false);
  }, [goalId, task.id]);

  /** 串起一次写：置忙、失败留在行内（同 GoalBar 的 runAction）。 */
  const runAction = async (action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
    if (pendingRef.current) return undefined;
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    const result = await action();
    pendingRef.current = false;
    setPending(false);
    if (!result.ok && result.error !== undefined) setActionError(result.error.message);
    return result;
  };

  const save = async (): Promise<void> => {
    const text = draft.trim();
    if (text === "" || goal === null) return;
    const result = await runAction(() => target.actions.edit(text));
    if (result?.ok === true) setEditing(false);
  };

  const clear = async (): Promise<void> => {
    const result = await runAction(() => target.actions.clear());
    if (result?.ok === true) setConfirmClear(false);
  };

  if (target.phase === "loading") {
    return (
      <div data-overview-goal-target-state="loading" className={css.cardInset}>
        <Skeleton label="加载总目标" />
      </div>
    );
  }

  if (target.phase === "offline") {
    return (
      <div data-overview-goal-target-state="offline" className={css.cardInset}>
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={target.reload}>
              重试
            </Button>
          }
        >
          总目标读取失败：{target.error}
        </Notice>
      </div>
    );
  }

  if (goal === null) {
    return (
      <Row
        muted
        data={{ "data-overview-goal-target-state": "empty" }}
        label="还没有设定总目标"
        description="总目标用 /goal 命令设定，会持续注入规划者的系统提示；设定后这里与输入框上方的目标条同步展示。"
      >
        <Button variant="outline" size="sm" data-overview-goal-target-set-in-chat="" onClick={startGoalInSession}>
          在会话中设置目标
        </Button>
      </Row>
    );
  }

  const meta = TARGET_GOAL_PHASE_META[goal.phase] ?? {
    label: goal.phase,
    tone: "neutral" as KitTone,
  };
  const done = goal.phase === "complete";

  // 清除是删除动作：二次确认行（同 GoalBar 的 confirm 条）。
  if (confirmClear) {
    return (
      <Row
        data={{ "data-overview-goal-target-state": "confirm-clear" }}
        lead={
          <span className={css.inlineState}>
            <Dot tone={meta.tone} />
            {meta.label}
          </span>
        }
        label="确认清除目标？"
        description="清除后总目标不再注入系统提示；已拆出的验收项保留。"
      >
        <span className={css.rowActions}>
          {actionError === null ? null : (
            <span className={css.tgoalError} role="alert">
              {actionError}
            </span>
          )}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmClear(false)}>
            取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            data-overview-goal-target-clear=""
            onClick={() => void clear()}
          >
            清除目标
          </Button>
        </span>
      </Row>
    );
  }

  // 内联编辑：Enter 保存（带 snapshot 的 revision 做 CAS），Esc 取消。
  if (editing) {
    return (
      <Row
        stacked
        className={css.editRow}
        data={{ "data-overview-goal-target-state": "editing" }}
        label="编辑总目标"
        description="Enter 保存，Esc 取消；revision 来自当前快照，目标已在别处更新会返回 409"
      >
        <div className={css.formLine}>
          <span className={css.grow}>
            <Input
              value={draft}
              autoFocus
              disabled={pending}
              data-overview-goal-target-input=""
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
                if (event.key === "Escape") setEditing(false);
              }}
            />
          </span>
          <span className={css.formEnd}>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending || draft.trim() === ""}
              data-overview-goal-target-save=""
              onClick={() => void save()}
            >
              保存
            </Button>
          </span>
        </div>
      </Row>
    );
  }

  const resume = goal.phase !== "active" && !done;
  return (
    <Row
      data={{ "data-overview-goal-target-state": goal.phase, "data-overview-goal-target": "" }}
      lead={
        <span className={css.inlineState}>
          <Dot tone={meta.tone} title={meta.label} />
          {meta.label}
        </span>
      }
      label={targetGoalText(goal.objective)}
      description={
        <Meta
          items={[
            "总目标 · 由 /goal 设定",
            `修订 v${goal.revision}`,
            done ? "已达成，不再注入系统提示" : "与输入框上方的目标条同源同步",
          ]}
        />
      }
    >
      <span className={css.rowActions}>
        {actionError === null ? null : (
          <span className={css.tgoalError} role="alert">
            {actionError}
          </span>
        )}
        <IconButton
          label="编辑目标"
          disabled={pending}
          data-overview-goal-target-edit=""
          onClick={() => {
            setDraft(goal.objective);
            setEditing(true);
          }}
        >
          <IconEditOutlineRegular size={14} />
        </IconButton>
        {done ? null : (
          <IconButton
            label={resume ? "恢复目标" : "暂停目标"}
            disabled={pending}
            data-overview-goal-target-toggle={resume ? "resume" : "pause"}
            onClick={() => void runAction(() => (resume ? target.actions.resume() : target.actions.pause()))}
          >
            {resume ? <IconPlayOutlineRegular size={14} /> : <IconPauseOutlineRegular size={14} />}
          </IconButton>
        )}
        <RowMenu
          label="目标的更多操作"
          disabled={pending}
          data={{ "data-overview-goal-target-more": "" }}
          items={[
            ...(done
              ? []
              : [
                  {
                    label: "标记为已达成",
                    onSelect: () => void runAction(() => target.actions.complete()),
                    data: { "data-overview-goal-target-complete": "" },
                  },
                ]),
            {
              label: "清除目标…",
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                setActionError(null);
                setConfirmClear(true);
              },
              data: { "data-overview-goal-target-clear-open": "" },
            },
          ]}
        />
      </span>
    </Row>
  );
}

/**
 * 渲染任务概览视图。
 * @param props.task - 当前选中的任务。
 * @returns 概览视图。
 */
export function OverviewView({ task, sub }: { task: Task; sub?: string }): ReactNode {
  // U2：概览 ▸ 状态 | 配置（`?view=overview.config`；旧「模型」tab 别名到配置）。
  const tab: "status" | "config" = sub === "config" ? "config" : "status";
  const summary = useOverviewSummary(task.id);
  const goals = useTaskGoals(task.id);
  const constraints = useTaskConstraints(task.id);
  const scope = useTaskScope(task.id);
  // C18：前沿与审计。统计数字复用上面 `summary.stats`，不重复请求 `api.stats`。
  const frontier = useTaskFrontier(task.id);
  const audit = useTaskAudit(task.id);
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
      "新增验收项",
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
      "保存验收项",
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
  const status = taskStatusMeta(base.status);
  const engine = engineModeMeta(stats === null ? base.engine_mode : stats.engine_mode);
  const goalsMet = base.goals_met ?? 0;
  const goalsTotal = base.goals_total ?? 0;
  const goalRatio = goalsTotal > 0 ? Math.min(1, goalsMet / goalsTotal) : 0;
  const description = base.description.trim();
  const goalText0 = base.goal.trim();
  const confirmedCount = summary.findings.filter((finding) => finding.status === "confirmed").length;
  const trafficCount = stats === null ? undefined : statsTraffic(stats);
  const deleteIcon = <IconTrashOutlineRegular size={14} />;
  const editIcon = <IconEditOutlineRegular size={14} />;
  return (
    <Page data={{ "data-task-overview": "" }}>
      <PageHead
        title={
          <span data-overview-name="">{(base.name ?? "").trim() === "" ? "未命名任务" : base.name}</span>
        }
        adornment={
          <span className={css.headBadges}>
            <Badge tone={status.tone} title={base.status}>
              {status.label}
            </Badge>
            {base.paused === true && base.status !== "paused" ? <Badge tone="warning">已暂停</Badge> : null}
            {base.queued === true && base.status !== "queued" ? <Badge>排队中</Badge> : null}
          </span>
        }
        lead={
          description === "" ? undefined : (
            <span className={css.leadLine} title={description}>
              {description}
            </span>
          )
        }
        actions={
          <IconButton
            label="刷新"
            spinning={summary.phase === "loading"}
            onClick={summary.reload}
            data-overview-refresh=""
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      />

      {writeError === null ? null : (
        <Notice
          tone="danger"
          data={{ "data-task-overview-write-error": "" }}
          action={
            <Button variant="ghost" size="sm" onClick={() => setWriteError(null)}>
              知道了
            </Button>
          }
        >
          {writeError}
        </Notice>
      )}

      <FilterBar
        id="view-overview"
        label="概览视图"
        value={tab}
        options={OVERVIEW_TABS}
        onChange={(next) => setConversationView(`overview.${next}`)}
        data={{ "data-view-hub": "overview", "data-view-sub": tab }}
      />

      {tab === "status" ? (
      <>
      {/* C1：任务基本信息（旧页 :433-452 描述与目标 + :894-938 心跳里的状态字段）。 */}
      <Section title="任务信息" hint="来自任务详情接口" data={{ "data-overview-basic": "" }}>
        <Card>
          {summary.phase === "loading" ? (
            <div data-overview-basic-state="loading">
              <Skeleton label="加载任务信息" />
            </div>
          ) : null}
          {summary.phase === "offline" ? (
            <div className={css.cardInset}>
              <Notice
                tone="danger"
                data={{ "data-overview-basic-state": "offline" }}
                action={
                  <Button variant="ghost" size="sm" onClick={summary.reload}>
                    重试
                  </Button>
                }
              >
                任务信息读取失败：{summary.error}
              </Notice>
            </div>
          ) : null}
          {summary.phase === "ready" ? (
            <>
              <Facts
                items={[
                  {
                    key: "status",
                    label: "状态",
                    value: (
                      <span className={css.inlineState}>
                        <Dot tone={status.tone} pulse={base.status === "running"} />
                        {status.label}
                      </span>
                    ),
                  },
                  {
                    key: "engine",
                    label: "引擎态",
                    value:
                      engine === null ? (
                        "—"
                      ) : (
                        <span className={css.inlineState} title={engine.raw}>
                          <Dot tone={engine.tone} />
                          {engine.label}
                        </span>
                      ),
                  },
                  {
                    key: "progress",
                    label: "目标进度",
                    value: (
                      <span className={css.progress} data-overview-goal-progress="">
                        <span className={css.num}>{`${num(goalsMet)} / ${num(goalsTotal)}`}</span>
                        {goalsTotal > 0 ? (
                          <span className={css.progressTrack} aria-hidden="true">
                            <span className={css.progressFill} style={{ width: `${Math.round(goalRatio * 100)}%` }} />
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  { key: "inflight", label: "运行中", value: <span className={css.num}>{num(base.in_flight ?? 0)}</span> },
                  // U3：原右栏「会话」页签独有的运行档位并入这里（权限 / 计划 / 团队）。
                  { key: "permission", label: "权限档", value: permissionLabel(base.permission_level) },
                  { key: "plan", label: "计划模式", value: base.plan_mode === true ? "开启" : "关闭" },
                  { key: "team", label: "团队模式", value: base.team_mode === true ? "开启" : "关闭" },
                  { key: "created", label: "创建时间", value: <span className={css.num}>{timeText(base.created_at)}</span> },
                  { key: "completed", label: "完成时间", value: <span className={css.num}>{timeText(base.completed_at)}</span> },
                  { key: "last", label: "最近活动", value: <span className={css.num}>{timeText(base.last_activity)}</span> },
                  {
                    key: "category",
                    label: "分类",
                    value: base.category_name === undefined || base.category_name === "" ? "—" : base.category_name,
                  },
                  { key: "id", label: "任务 id", value: base.id, mono: true, title: base.id },
                  ...(base.source_task_ids !== undefined && base.source_task_ids.length > 0
                    ? [
                        {
                          key: "sources",
                          label: "来源任务（只读继承）",
                          value: base.source_task_ids.join("、"),
                          mono: true,
                          wrap: true,
                        },
                      ]
                    : []),
                ]}
              />
              <div className={css.prose}>
                <div className={css.proseItem}>
                  <span className={css.proseLabel}>描述</span>
                  <p className={description === "" ? `${css.proseText} ${css.proseEmpty}` : css.proseText}>
                    {description === "" ? "未填写" : base.description}
                  </p>
                </div>
                <div className={css.proseItem}>
                  <span className={css.proseLabel}>目标（创建时填写）</span>
                  <p className={goalText0 === "" ? `${css.proseText} ${css.proseEmpty}` : css.proseText}>
                    {goalText0 === "" ? "未填写" : base.goal}
                  </p>
                </div>
              </div>
            </>
          ) : null}
        </Card>
      </Section>

      {/* C2：统计数字（旧页 :894-938 心跳 + :1043-1048 统计卡片，数据来自 `GET /stats?task=`）。 */}
      <Section title="统计" hint="统计接口，按本任务过滤" data={{ "data-overview-stats": "" }}>
        {summary.phase === "loading" ? (
          <Card>
            <div data-overview-stats-state="loading">
              <Skeleton label="加载统计" />
            </div>
          </Card>
        ) : null}
        {summary.phase === "offline" ? (
          <Notice tone="danger" data={{ "data-overview-stats-state": "offline" }}>
            统计读取失败：{summary.error}
          </Notice>
        ) : null}
        {summary.phase === "ready" && stats === null ? (
          <Card>
            <Empty inCard data={{ "data-overview-stats-state": "empty" }} title="暂无统计数据" text="统计接口没有返回本任务的数字。" />
          </Card>
        ) : null}
        {summary.phase === "ready" && stats !== null ? (
          <div data-overview-stats-grid="">
            {/* W-5：后端 `/stats` 从不返回 findings_confirmed 与 roe_enabled（types.ts 声明了但 Go 端
                没有），此前直接 num() 把概览页打崩过。「已确认」用本任务发现列表里 status==="confirmed"
                的计数；「流量」用 `GET /stats?task=` 实测存在的 traffic 字段，缺省按「—」诚实显示。 */}
            <Metrics
              items={[
                {
                  key: "assets",
                  label: "资产",
                  value: <span className={css.statValue}>{num(stats.assets)}</span>,
                  muted: stats.assets === 0,
                },
                {
                  key: "findings",
                  label: "本任务发现",
                  value: (
                    <span className={css.statValue} data-overview-stat-findings="">
                      {num(summary.findings.length)}
                    </span>
                  ),
                  muted: summary.findings.length === 0,
                },
                {
                  key: "confirmed",
                  label: "本任务已确认",
                  tone: confirmedCount > 0 ? "success" : undefined,
                  value: (
                    <span className={css.statValue} data-overview-stat-confirmed="">
                      {num(confirmedCount)}
                    </span>
                  ),
                  muted: confirmedCount === 0,
                },
                {
                  key: "traffic",
                  label: "本任务流量",
                  value: (
                    <span className={css.statValue} data-overview-stat-traffic="">
                      {num(trafficCount)}
                    </span>
                  ),
                  muted: trafficCount === undefined || trafficCount === 0,
                },
                {
                  key: "llm",
                  label: "模型",
                  tone: stats.llm_configured ? "success" : "warning",
                  value: <span className={css.statWord}>{stats.llm_configured ? "已配置" : "未配置"}</span>,
                  foot: engine === null ? undefined : `引擎 ${engine.label}`,
                  muted: !stats.llm_configured,
                },
              ]}
            />
          </div>
        ) : null}
      </Section>
      </>
      ) : null}

      {tab === "config" ? (
      <>
      {/* C3 + DX-OV：目标与验收项。顶行是总目标（task_goals，与目标条同源），
          下方是规划者拆出的验收项（原「目标管理」行与增删改，行为不变）。 */}
      <Section
        title="目标与验收项"
        count={
          goals.phase === "ready" ? (
            <span className={css.num}>
              验收项 {goals.goals.filter((row) => row.state === "met").length}/{goals.goals.length} 已证实
            </span>
          ) : undefined
        }
        hint="顶行总目标由 /goal 设定并持续注入规划者；下方验收项增改会通知规划者并复活任务，删除只通知规划者"
        data={{ "data-overview-goals": "" }}
      >
        <Card>
          <OverallGoalRow task={task} />
          <div className={css.goalsSubHead}>
            <span className={css.goalsSubTitle}>验收项</span>
            <span>规划者按总目标拆出的可核验子目标，由发现或事实逐条证实</span>
          </div>
          {goals.phase === "loading" ? (
            <div data-overview-goals-state="loading">
              <Skeleton label="加载验收项" />
            </div>
          ) : null}
          {goals.phase === "offline" ? (
            <div className={css.cardInset}>
              <Notice
                tone="danger"
                data={{ "data-overview-goals-state": "offline" }}
                action={
                  <Button variant="ghost" size="sm" onClick={goals.reload}>
                    重试
                  </Button>
                }
              >
                验收项读取失败：{goals.error}
              </Notice>
            </div>
          ) : null}
          {goals.phase === "ready" && goals.goals.length === 0 ? (
            <Empty
              inCard
              data={{ "data-overview-goals-state": "empty" }}
              icon={<IconSparkleRegular size={18} />}
              title="还没有验收项"
              text="在下方添加后，规划者会据此派发探索意图并判定达成。"
            />
          ) : null}
          {goals.phase === "ready" && goals.goals.length > 0 ? (
            <div className={css.rows} data-overview-goal-rows="">
              {goals.goals.map((row) => {
                if (editingGoal !== null && editingGoal.id === row.id) {
                  return (
                    <Row
                      key={row.id}
                      stacked
                      className={css.editRow}
                      data={{ "data-overview-goal-edit": row.id }}
                      label="编辑验收项"
                      description="Enter 保存，Esc 取消"
                    >
                      <div className={css.formLine}>
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
                        <span className={css.formEnd}>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingGoal(null)}>
                            取消
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={busy || editingGoal.text.trim() === ""}
                            data-overview-goal-save={row.id}
                            onClick={() => saveGoal(row)}
                          >
                            保存
                          </Button>
                        </span>
                      </div>
                    </Row>
                  );
                }
                const state = goalStateMeta(row.state);
                return (
                  <Row
                    key={row.id}
                    data={{ "data-overview-goal": row.id }}
                    lead={<Dot tone={state.tone} title={state.label} />}
                    label={<span title={row.text}>{row.text}</span>}
                    description={
                      <Meta
                        items={[
                          state.label,
                          (row.vulnclass ?? "") === "" ? null : (
                            <span key="v" className={kit.mono}>
                              {row.vulnclass}
                            </span>
                          ),
                          <span key="t" className={css.num}>
                            {timeText(row.ts)}
                          </span>,
                        ]}
                      />
                    }
                  >
                    <span className={css.rowActions}>
                      <IconButton
                        label="编辑验收项"
                        disabled={busy}
                        data-overview-goal-edit-open={row.id}
                        onClick={() => setEditingGoal({ id: row.id, text: row.text, vuln: row.vulnclass ?? "" })}
                      >
                        {editIcon}
                      </IconButton>
                      <IconButton
                        label="删除验收项"
                        className={css.dangerIcon}
                        disabled={busy}
                        data-overview-goal-delete={row.id}
                        onClick={() => setConfirm({ kind: "goal", id: row.id, text: row.text })}
                      >
                        {deleteIcon}
                      </IconButton>
                    </span>
                  </Row>
                );
              })}
            </div>
          ) : null}
          <div className={css.addBar}>
            <span className={css.addLabel}>
              <IconPlusOutlineRegular size={12} />
              新增
            </span>
            <span className={css.grow}>
              <Input
                value={goalText}
                placeholder="如「拿到管理员账号的越权访问」"
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
        </Card>
      </Section>

      {/* C4：操作约束（旧页 :578-702）。 */}
      <Section
        title="操作约束"
        count={constraints.phase === "ready" ? constraints.constraints.length : undefined}
        hint="框定 planner / worker 的探索边界，下一轮规划生效"
        data={{ "data-overview-constraints": "" }}
      >
        <Card>
          {constraints.phase === "loading" ? (
            <div data-overview-constraints-state="loading">
              <Skeleton label="加载约束" />
            </div>
          ) : null}
          {constraints.phase === "offline" ? (
            <div className={css.cardInset}>
              <Notice
                tone="danger"
                data={{ "data-overview-constraints-state": "offline" }}
                action={
                  <Button variant="ghost" size="sm" onClick={constraints.reload}>
                    重试
                  </Button>
                }
              >
                约束读取失败：{constraints.error}
              </Notice>
            </div>
          ) : null}
          {constraints.phase === "ready" && constraints.constraints.length === 0 ? (
            <Empty
              inCard
              data={{ "data-overview-constraints-state": "empty" }}
              icon={<IconShieldOutlineRegular size={18} />}
              title="还没有操作约束"
              text="建任务时会从描述与目标自动抽取；也可在下方手动添加「允许 / 禁止」的操作。"
            />
          ) : null}
          {constraints.phase === "ready" && constraints.constraints.length > 0 ? (
            <div className={css.rows} data-overview-constraint-rows="">
              {constraints.constraints.map((row) =>
                editingCon !== null && editingCon.id === row.id ? (
                  <Row
                    key={row.id}
                    stacked
                    className={css.editRow}
                    data={{ "data-overview-constraint-edit": row.id }}
                    label="编辑约束"
                    description="Enter 保存，Esc 取消"
                  >
                    <div className={css.formLine}>
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
                      <span className={css.formEnd}>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingCon(null)}>
                          取消
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy || editingCon.text.trim() === ""}
                          data-overview-constraint-save={row.id}
                          onClick={() => saveConstraint(row)}
                        >
                          保存
                        </Button>
                      </span>
                    </div>
                  </Row>
                ) : (
                  <Row
                    key={row.id}
                    data={{ "data-overview-constraint": row.id }}
                    lead={
                      <span className={css.leadBadge}>
                        <Badge tone={row.kind === "allow" ? "success" : "danger"}>
                          {row.kind === "allow" ? "允许" : "禁止"}
                        </Badge>
                      </span>
                    }
                    label={<span title={row.text}>{row.text}</span>}
                  >
                    <span className={css.rowActions}>
                      <IconButton
                        label="编辑约束"
                        disabled={busy}
                        data-overview-constraint-edit-open={row.id}
                        onClick={() => setEditingCon({ id: row.id, text: row.text, kind: row.kind })}
                      >
                        {editIcon}
                      </IconButton>
                      <IconButton
                        label="删除约束"
                        className={css.dangerIcon}
                        disabled={busy}
                        data-overview-constraint-delete={row.id}
                        onClick={() => setConfirm({ kind: "constraint", id: row.id, text: row.text })}
                      >
                        {deleteIcon}
                      </IconButton>
                    </span>
                  </Row>
                ),
              )}
            </div>
          ) : null}
          <div className={css.addBar}>
            <span className={css.addLabel}>
              <IconPlusOutlineRegular size={12} />
              新增
            </span>
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
                placeholder="如「仅测当前端口，不扫其他端口」"
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
        </Card>
      </Section>

      {/* C5：测试范围（旧页 :808-893）。 */}
      <Section
        title="测试范围"
        count={scope.phase === "ready" ? scope.scope.length : undefined}
        hint="覆盖度分母与授权边界；继承自来源任务的行不能删除"
        data={{ "data-overview-scope": "" }}
      >
        <Card>
          {scope.phase === "loading" ? (
            <div data-overview-scope-state="loading">
              <Skeleton label="加载测试范围" />
            </div>
          ) : null}
          {scope.phase === "offline" ? (
            <div className={css.cardInset}>
              <Notice
                tone="danger"
                data={{ "data-overview-scope-state": "offline" }}
                action={
                  <Button variant="ghost" size="sm" onClick={scope.reload}>
                    重试
                  </Button>
                }
              >
                测试范围读取失败：{scope.error}
              </Notice>
            </div>
          ) : null}
          {scope.phase === "ready" && scope.scope.length === 0 ? (
            <Empty
              inCard
              data={{ "data-overview-scope-state": "empty" }}
              icon={<IconSearchOutlineRegular size={18} />}
              title="还没有测试范围"
              text="添加根域名、IP、网段等后，它们会成为资产覆盖度的分母。"
            />
          ) : null}
          {scope.phase === "ready" && scope.scope.length > 0 ? (
            <div className={css.rows} data-overview-scope-rows="">
              {scope.scope.map((row) => {
                const own = String(row.task_id) === task.id;
                return (
                  <Row
                    key={row.id}
                    data={{ "data-overview-scope": String(row.id) }}
                    lead={
                      <span className={css.leadBadge}>
                        <Badge>{SCOPE_KIND_LABEL[row.kind]}</Badge>
                      </span>
                    }
                    label={
                      <span className={css.rowMono} title={scopeValue(row)}>
                        {scopeValue(row)}
                      </span>
                    }
                    description={<Meta items={[SCOPE_SOURCE_LABEL[row.source], own ? null : "继承自来源任务"]} />}
                  >
                    {own ? (
                      <IconButton
                        label="删除范围"
                        className={css.dangerIcon}
                        disabled={busy}
                        data-overview-scope-delete={row.id}
                        onClick={() => setConfirm({ kind: "scope", id: row.id, text: scopeValue(row) })}
                      >
                        {deleteIcon}
                      </IconButton>
                    ) : (
                      <Badge title="继承自来源任务，只读">继承</Badge>
                    )}
                  </Row>
                );
              })}
            </div>
          ) : null}
          <div className={css.addBar}>
            <span className={css.addLabel}>
              <IconPlusOutlineRegular size={12} />
              新增
            </span>
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
        </Card>
      </Section>

      {/* C6：任务级资产拦截 / 允许规则（旧页 overview-tab.tsx:1053-1322）。只本任务生效，不进全局表。 */}
      <Section
        title="任务级资产拦截 / 允许"
        count={intercept.phase === "ready" ? intercept.rules.length : undefined}
        hint="仅本任务生效；先拦截后允许，「允许」即白名单"
        data={{ "data-overview-intercept": "" }}
        actions={
          <IconButton
            label="刷新拦截规则"
            spinning={intercept.phase === "loading"}
            onClick={intercept.reload}
            disabled={intercept.phase === "loading"}
            data-overview-intercept-refresh=""
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      >
        <Card>
          {intercept.phase === "loading" ? (
            <div data-overview-intercept-state="loading">
              <Skeleton label="加载拦截规则" />
            </div>
          ) : null}
          {intercept.phase === "offline" ? (
            <div className={css.cardInset}>
              <Notice
                tone="danger"
                data={{ "data-overview-intercept-state": "offline" }}
                action={
                  <Button variant="ghost" size="sm" onClick={intercept.reload}>
                    重试
                  </Button>
                }
              >
                拦截规则读取失败：{intercept.error}
              </Notice>
            </div>
          ) : null}
          {intercept.phase === "ready" && intercept.rules.length === 0 ? (
            <Empty
              inCard
              data={{ "data-overview-intercept-state": "empty" }}
              icon={<IconShieldOutlineRegular size={18} />}
              title="还没有任务级规则"
              text="「拦截」命中即禁止测试；配置「允许」后本任务只测命中白名单的资产，未配置则不启用白名单。"
            />
          ) : null}
          {intercept.phase === "ready" && intercept.rules.length > 0 ? (
            <div className={css.rows} data-overview-intercept-rows="">
              {intercept.rules.map((row) =>
                editingRule !== null && editingRule.id === row.id ? (
                  <Row
                    key={row.id}
                    stacked
                    className={css.editRow}
                    data={{ "data-overview-intercept-edit": String(row.id) }}
                    label="编辑规则"
                    description="启用状态保持不变；改启停请用行尾开关"
                  >
                    <div className={css.formLine}>
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
                          placeholder="备注（可选）"
                          disabled={busy}
                          data-overview-intercept-edit-note={row.id}
                          onChange={(event) =>
                            setEditingRule((current) =>
                              current === null ? current : { ...current, note: event.currentTarget.value },
                            )
                          }
                        />
                      </span>
                      <span className={css.formEnd}>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingRule(null)}>
                          取消
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy || editingRule.pattern.trim() === ""}
                          data-overview-intercept-save={row.id}
                          onClick={() => saveRule(row)}
                        >
                          保存
                        </Button>
                      </span>
                    </div>
                  </Row>
                ) : (
                  <Row
                    key={row.id}
                    data={{ "data-overview-intercept": String(row.id) }}
                    lead={
                      <span className={css.leadBadge}>
                        <Badge tone={row.action === "allow" ? "success" : "danger"}>{taskRuleActionLabel(row)}</Badge>
                      </span>
                    }
                    label={
                      <span className={css.rowMono} title={row.pattern}>
                        {row.pattern}
                      </span>
                    }
                    description={
                      <Meta
                        items={[
                          TASK_RULE_KIND_LABEL[row.kind] ?? row.kind,
                          (row.note ?? "") === "" ? null : (
                            <span key="n" title={row.note}>
                              {row.note}
                            </span>
                          ),
                          row.enabled ? null : "已停用",
                        ]}
                      />
                    }
                  >
                    <span className={`${css.rowActions} ${css.rowActionsSwitch}`}>
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
                      <span className={css.rowActions}>
                        <IconButton
                          label="编辑规则"
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
                          {editIcon}
                        </IconButton>
                        <IconButton
                          label="删除规则"
                          className={css.dangerIcon}
                          disabled={busy || toggleBusy}
                          data-overview-intercept-delete={row.id}
                          onClick={() =>
                            setConfirm({ kind: "intercept", id: row.id, text: `${taskRuleActionLabel(row)} ${row.pattern}` })
                          }
                        >
                          {deleteIcon}
                        </IconButton>
                      </span>
                    </span>
                  </Row>
                ),
              )}
            </div>
          ) : null}
          <div className={css.addBar}>
            <span className={css.addLabel}>
              <IconPlusOutlineRegular size={12} />
              新增
            </span>
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
              placeholder="备注（可选）"
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
        </Card>
      </Section>

      {/* U2：模型绑定与 Token 用量并入「配置」（原「模型」tab，组件复用）。 */}
      <TaskModelView task={task} embedded />
      </>
      ) : null}

      {tab === "status" ? (
      <>
      {/* U2：原「任务内发现」列表与「活动流」列表是发现视图 / 对话的副本，删去，
          只留计数与跳转（.tmp/d6-ia-inventory.md §4.2）。 */}
      <Section title="产出与过程" data={{ "data-overview-findings": "" }}>
        <Card>
          <Row
            label="任务内发现"
            description={
              summary.phase === "ready"
                ? `${num(summary.findings.length)} 条，其中已确认 ${num(confirmedCount)} 条`
                : summary.phase === "offline"
                  ? `读取失败：${summary.error ?? "未知原因"}`
                  : "读取中…"
            }
          >
            <Button
              variant="ghost"
              size="sm"
              data-overview-open-findings=""
              onClick={() => setConversationView("findings")}
            >
              在发现视图打开 →
            </Button>
          </Row>
          <Row label="活动流" description="planner / worker / 主 Agent 的每一步都在对话与轨迹里。">
            <Button variant="ghost" size="sm" data-overview-open-chat="" onClick={() => setConversationView("chat")}>
              在对话中查看 →
            </Button>
          </Row>
        </Card>
      </Section>
      {/* C18 / L3：前沿（当前可做的意图）。数据来自 `api.frontier`（api.ts:635），旧页 overview-tab.tsx:415-417,976,1045。 */}
      <Section
        title="前沿（可做意图）"
        count={frontier.phase === "ready" ? frontier.nodes.length : undefined}
        hint={`只读，最多显示 ${FRONTIER_LIMIT} 条，不派发、不领取`}
        data={{ "data-overview-frontier": "" }}
        actions={
          <IconButton
            label="刷新前沿"
            spinning={frontier.phase === "loading"}
            onClick={frontier.reload}
            disabled={frontier.phase === "loading"}
            data-overview-frontier-refresh=""
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      >
        <Card>
          {frontier.phase === "loading" ? (
            <div data-overview-frontier-state="loading">
              <Skeleton label="加载前沿" />
            </div>
          ) : null}
          {frontier.phase === "offline" ? (
            <div className={css.cardInset}>
              <Notice
                tone="danger"
                data={{ "data-overview-frontier-state": "offline" }}
                action={
                  <Button variant="ghost" size="sm" onClick={frontier.reload}>
                    重试
                  </Button>
                }
              >
                前沿读取失败：{frontier.error}
              </Notice>
            </div>
          ) : null}
          {frontier.phase === "ready" && frontier.nodes.length === 0 ? (
            <Empty
              inCard
              data={{ "data-overview-frontier-state": "empty" }}
              icon={<IconLayersOutlineRegular size={18} />}
              title="前沿为空"
              text="当前没有可领取的意图；规划者派出新意图或任务被唤醒后会再出现。"
            />
          ) : null}
          {frontier.phase === "ready" && frontier.nodes.length > 0 ? (
            <div className={css.rows} data-overview-frontier-rows="">
              {frontierRows(frontier.nodes).map((row) => {
                const tone = frontierKitTone(row.stateKey);
                return (
                  <Row
                    key={row.id}
                    data={{ "data-overview-frontier": row.id }}
                    lead={<Dot tone={tone} pulse={row.stateKey === "running"} title={row.stateLabel} />}
                    label={<span title={row.payload === "" ? row.title : row.payload}>{row.title}</span>}
                    description={
                      <Meta
                        items={[
                          row.stateLabel,
                          <span key="p" className={css.num}>
                            优先级 {row.priority}
                          </span>,
                        ]}
                      />
                    }
                  >
                    <span className={css.time}>{row.created === "" ? "—" : row.created}</span>
                  </Row>
                );
              })}
            </div>
          ) : null}
        </Card>
      </Section>

      {/* C18 / L5：统计与审计。统计复用本页上方 `useOverviewSummary` 的 stats（不再请求一次），审计来自 `api.audit`（api.ts:879）。 */}
      <Section
        title="统计与审计"
        hint="只读：统计接口 + 工具拦截审计接口"
        data={{ "data-overview-stats-audit": "" }}
        actions={
          <IconButton
            label="刷新统计与审计"
            spinning={summary.phase === "loading" || audit.phase === "loading"}
            onClick={() => {
              summary.reload();
              audit.reload();
            }}
            disabled={summary.phase === "loading" || audit.phase === "loading"}
            data-overview-stats-audit-refresh=""
          >
            <IconRefreshOutlineRegular size={14} />
          </IconButton>
        }
      >
        {summary.phase === "loading" ? (
          <Card>
            <div data-overview-stats-audit-stats-state="loading">
              <Skeleton label="加载统计" />
            </div>
          </Card>
        ) : null}
        {summary.phase === "offline" ? (
          <Notice
            tone="danger"
            data={{ "data-overview-stats-audit-stats-state": "offline" }}
            action={
              <Button variant="ghost" size="sm" onClick={summary.reload}>
                重试
              </Button>
            }
          >
            统计读取失败：{summary.error}
          </Notice>
        ) : null}
        {summary.phase === "ready" ? (
          <div data-overview-stats-audit-stats="">
            <Metrics
              items={[
                ...overviewStatsItems(stats, { met: goalsMet, total: goalsTotal }).map((item) => ({
                  key: item.key,
                  label: item.label,
                  value: <span data-overview-stats-audit-stat={item.key}>{num(item.value)}</span>,
                  // 后端可能缺字段（findings_confirmed 从不返回），缺 / 0 都按弱化显示。
                  muted: !Number.isFinite(item.value) || item.value === 0,
                })),
                {
                  key: "engine_mode",
                  label: "引擎态",
                  tone: engine?.tone,
                  value: (
                    <span className={css.statWord} data-overview-stats-audit-stat="engine_mode" title={engine?.raw}>
                      {stats === null || engine === null ? "—" : engine.label}
                    </span>
                  ),
                  muted: stats === null,
                },
                {
                  key: "llm_configured",
                  label: "模型",
                  tone: stats === null ? undefined : stats.llm_configured ? "success" : "warning",
                  value: (
                    <span className={css.statWord} data-overview-stats-audit-stat="llm_configured">
                      {stats === null ? "—" : stats.llm_configured ? "已配置" : "未配置"}
                    </span>
                  ),
                  muted: stats === null || !stats.llm_configured,
                },
                {
                  key: "traffic",
                  label: "本任务流量",
                  // W-5：roe_enabled 后端不存在；与本任务统计区一致换为真实的任务级流量条数。
                  value: (
                    <span data-overview-stats-audit-stat="traffic">{stats === null ? "—" : num(trafficCount)}</span>
                  ),
                  muted: trafficCount === undefined || trafficCount === 0,
                },
              ]}
            />
            {stats === null ? (
              <p className={css.footNote} data-overview-stats-audit-stats-state="empty">
                统计接口没有返回数据。
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 审计 */}
        <Section
          className={css.subSection}
          title="审计"
          count={audit.phase === "ready" ? `最近 ${AUDIT_RECENT_LIMIT} 条` : undefined}
        >
          <Card>
            {audit.phase === "loading" ? (
              <div data-overview-audit-state="loading">
                <Skeleton label="加载审计" />
              </div>
            ) : null}
            {audit.phase === "offline" ? (
              <div className={css.cardInset}>
                <Notice
                  tone="danger"
                  data={{ "data-overview-audit-state": "offline" }}
                  action={
                    <Button variant="ghost" size="sm" onClick={audit.reload}>
                      重试
                    </Button>
                  }
                >
                  审计读取失败：{audit.error}
                </Notice>
              </div>
            ) : null}
            {audit.phase === "ready" && audit.entries.length === 0 ? (
              <Empty
                inCard
                data={{ "data-overview-audit-state": "empty" }}
                icon={<IconShieldOutlineRegular size={18} />}
                title="暂无审计记录"
                text="工具调用被放行或拦截后会出现在这里。"
              />
            ) : null}
            {audit.phase === "ready" && audit.entries.length > 0 ? (
              <div className={css.rows} data-overview-audit-rows="">
                {audit.entries.map((entry, index) => {
                  const hasReason = entry.reason !== undefined && entry.reason !== "";
                  const hasCommand = entry.command !== undefined && entry.command !== "";
                  return (
                    <Row
                      key={`${entry.ts}-${entry.tool}-${String(index)}`}
                      top={hasReason || hasCommand}
                      lead={
                        <span className={css.leadBadge}>
                          <Badge tone={entry.action === "block" ? "danger" : "success"}>
                            {auditActionLabel(entry.action)}
                          </Badge>
                        </span>
                      }
                      label={
                        <span className={css.rowMono} title={entry.tool}>
                          {entry.tool === "" ? "（未记录工具名）" : entry.tool}
                        </span>
                      }
                      description={
                        hasReason || hasCommand ? (
                          <span className={css.auditLines}>
                            {hasReason ? <span className={css.auditLine}>原因：{entry.reason}</span> : null}
                            {hasCommand ? (
                              <span className={css.auditLine}>
                                命令：<span className={css.auditCode}>{entry.command}</span>
                              </span>
                            ) : null}
                          </span>
                        ) : undefined
                      }
                    >
                      <span className={css.time}>{auditTimeText(entry.ts)}</span>
                    </Row>
                  );
                })}
              </div>
            ) : null}
            {audit.phase === "ready" && audit.attributions.length > 0 ? (
              <Row label="失败归因" description="按原因聚合的拦截次数" wideControl>
                <span className={css.chips}>
                  {audit.attributions.map((row) => (
                    <Badge key={row.key}>{`${row.key} × ${num(row.count)}`}</Badge>
                  ))}
                </span>
              </Row>
            ) : null}
          </Card>
        </Section>

      </Section>
      </>
      ) : null}

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
    </Page>
  );
}
