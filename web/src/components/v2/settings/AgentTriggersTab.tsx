"use client";

/**
 * Agent 编辑器第 5 个页签「触发器」：一个自定义 Agent 的 P3 调度触发器列表、
 * 列表行的启用开关、新建 / 编辑表单（6 种条件 + 每种条件各自的消息 + 工具调用
 * 触发的工具多选）和删除二次确认。内置 Agent 不支持触发器，只显示提示不渲染表单。
 *
 * 旧页面依据：ARTEX/web/src/components/agent-editor.tsx:776（列表读取）、
 * :785-806（表单重置）、:809-825（灌入编辑）、:828-902（提交 / 启停 / 删除）、
 * :904-913（条件摘要）、:1006-1098（6 种条件字段）、:1112-1156（已有触发器列表）。
 * DSH 依据：DSH 无触发器（近似 schedule_create 定时任务），按设置分节扩展；
 * 删除确认照 components/v2/data-pages/AssetDeleteDialog.tsx（Modal tone="warning"）。
 * 对照表行：P3:A12
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { AgentTrigger } from "@/lib/types";
import {
  createAgentTrigger,
  deleteAgentTrigger,
  formatLastFire,
  setAgentTriggerEnabled,
  triggerConditionSummary,
  updateAgentTrigger,
  useAgentTriggers,
  useTriggerToolCatalog,
  type AgentTriggerInput,
} from "@/v2/data/agent-triggers";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";

/** 表单草稿：定时秒数用字符串保存，编辑时才好清空重填。 */
interface TriggerDraft {
  intervalSec: string;
  onFinding: boolean;
  onGoalMet: boolean;
  onTaskTimeout: boolean;
  onToolCall: boolean;
  onTaskCreate: boolean;
  intervalMessage: string;
  findingMessage: string;
  goalMessage: string;
  taskTimeoutMessage: string;
  toolCallMessage: string;
  taskCreateMessage: string;
  toolNames: string[];
}

/** 新建时的空表单：6 种条件全不开（照旧页面 agent-editor.tsx:790-806）。 */
function emptyDraft(): TriggerDraft {
  return {
    intervalSec: "60",
    onFinding: false,
    onGoalMet: false,
    onTaskTimeout: false,
    onToolCall: false,
    onTaskCreate: false,
    intervalMessage: "",
    findingMessage: "",
    goalMessage: "",
    taskTimeoutMessage: "",
    toolCallMessage: "",
    taskCreateMessage: "",
    toolNames: [],
  };
}

/** 把一条已有触发器灌进表单（照旧页面 agent-editor.tsx:809-825）。 */
function draftFrom(trigger: AgentTrigger): TriggerDraft {
  return {
    intervalSec: trigger.interval_sec > 0 ? String(trigger.interval_sec) : "60",
    onFinding: trigger.on_finding,
    onGoalMet: trigger.on_goal_met,
    onTaskTimeout: trigger.on_task_timeout,
    onToolCall: trigger.on_tool_call,
    onTaskCreate: trigger.on_task_create,
    intervalMessage: trigger.interval_message,
    findingMessage: trigger.finding_message,
    goalMessage: trigger.goal_message,
    taskTimeoutMessage: trigger.task_timeout_message,
    toolCallMessage: trigger.tool_call_message,
    taskCreateMessage: trigger.task_create_message,
    toolNames: trigger.tool_names ?? [],
  };
}

/**
 * 表单草稿 → 提交体。字段名一律照 AgentTrigger（types.ts:767），不自造字段。
 * @param draft - 当前表单。
 * @param enabled - 启用态：新建恒为 false（红线：触发器会定时拉起运行），编辑保留原值。
 */
function draftToInput(draft: TriggerDraft, enabled: boolean): AgentTriggerInput {
  return {
    enabled,
    interval_sec: draft.intervalSec.trim() === "" ? 0 : Math.max(0, Math.floor(Number(draft.intervalSec) || 0)),
    on_finding: draft.onFinding,
    on_goal_met: draft.onGoalMet,
    on_task_timeout: draft.onTaskTimeout,
    on_tool_call: draft.onToolCall,
    on_task_create: draft.onTaskCreate,
    interval_message: draft.intervalMessage.trim(),
    finding_message: draft.findingMessage.trim(),
    goal_message: draft.goalMessage.trim(),
    task_timeout_message: draft.taskTimeoutMessage.trim(),
    tool_call_message: draft.toolCallMessage.trim(),
    task_create_message: draft.taskCreateMessage.trim(),
    tool_names: draft.onToolCall ? draft.toolNames : [],
  };
}

/** 新建 / 编辑表单：字段与 AgentTrigger 一一对应。 */
function TriggerForm({
  agentKey,
  trigger,
  onSaved,
  onCancel,
}: {
  agentKey: string;
  /** null = 新建；非 null = 正在编辑这一条（启用态保留原值）。 */
  trigger: AgentTrigger | null;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const tools = useTriggerToolCatalog();
  const [draft, setDraft] = React.useState<TriggerDraft>(() =>
    trigger === null ? emptyDraft() : draftFrom(trigger),
  );
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const set = (patch: Partial<TriggerDraft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleTool = (key: string): void =>
    setDraft((prev) => ({
      ...prev,
      toolNames: prev.toolNames.includes(key)
        ? prev.toolNames.filter((item) => item !== key)
        : [...prev.toolNames, key],
    }));

  const save = (): void => {
    const enabled = trigger === null ? false : trigger.enabled;
    const input = draftToInput(draft, enabled);
    if (
      input.interval_sec === 0 &&
      !input.on_finding &&
      !input.on_goal_met &&
      !input.on_task_timeout &&
      !input.on_tool_call &&
      !input.on_task_create
    ) {
      setFailure("至少选择一种触发条件（定时 / 发现 finding / 目标达成 / 任务超时 / 工具调用 / 任务创建）。");
      return;
    }
    if (input.on_tool_call && input.tool_names.length === 0) {
      setFailure("工具调用触发至少选择一个工具。");
      return;
    }
    setSaving(true);
    setFailure(null);
    const write = trigger === null ? createAgentTrigger(agentKey, input) : updateAgentTrigger(trigger.id, input);
    void write
      .then(() => {
        toast(trigger === null ? "已添加触发器（默认停用，不会自动运行）" : "触发器已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={css.formCard} data-trigger-form={trigger === null ? "new" : String(trigger.id)}>
      <div className={css.subTitle}>
        {trigger === null ? "新增触发器" : `编辑触发器 #${trigger.id}（改完点「保存修改」）`}
      </div>
      <p className={css.fieldHint}>
        触发后系统会新建一个会话运行该 Agent（在「Agent 对话」页可见），并把「本次为何触发 + 相关任务 / finding /
        目标」附在你写的消息后面。新建的触发器默认停用，需要用列表上的开关手动启用。
      </p>

      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Checkbox
          checked={Number(draft.intervalSec) > 0}
          label="定时触发"
          disabled={saving}
          onChange={(next) => set({ intervalSec: next ? "60" : "0" })}
        />
        <span>定时触发（每 N 秒）</span>
      </div>
      {Number(draft.intervalSec) > 0 ? (
        <>
          <label className={css.fieldLabel}>
            间隔（秒）
            <input
              className={css.textField}
              type="number"
              min={1}
              aria-label="定时间隔秒"
              value={draft.intervalSec}
              disabled={saving}
              onChange={(event) => set({ intervalSec: event.currentTarget.value })}
            />
          </label>
          <label className={css.fieldLabel}>
            定时触发的消息
            <textarea
              className={css.textArea}
              aria-label="定时触发消息"
              rows={2}
              placeholder="定时触发时发给 agent 的话，如：巡检所有任务"
              value={draft.intervalMessage}
              disabled={saving}
              onChange={(event) => set({ intervalMessage: event.currentTarget.value })}
            />
          </label>
        </>
      ) : null}

      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Checkbox
          checked={draft.onFinding}
          label="发现 finding 时触发"
          disabled={saving}
          onChange={(next) => set({ onFinding: next })}
        />
        <span>发现 finding 时触发</span>
      </div>
      {draft.onFinding ? (
        <label className={css.fieldLabel}>
          finding 触发的消息
          <textarea
            className={css.textArea}
            aria-label="finding 触发消息"
            rows={2}
            placeholder="发现 finding 时发给 agent 的话（系统会附带任务与 finding 详情）"
            value={draft.findingMessage}
            disabled={saving}
            onChange={(event) => set({ findingMessage: event.currentTarget.value })}
          />
        </label>
      ) : null}

      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Checkbox
          checked={draft.onGoalMet}
          label="目标达成时触发"
          disabled={saving}
          onChange={(next) => set({ onGoalMet: next })}
        />
        <span>目标达成时触发</span>
      </div>
      {draft.onGoalMet ? (
        <label className={css.fieldLabel}>
          目标达成触发的消息
          <textarea
            className={css.textArea}
            aria-label="目标达成触发消息"
            rows={2}
            placeholder="目标达成时发给 agent 的话（系统会附带任务与达成的目标）"
            value={draft.goalMessage}
            disabled={saving}
            onChange={(event) => set({ goalMessage: event.currentTarget.value })}
          />
        </label>
      ) : null}

      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Checkbox
          checked={draft.onTaskTimeout}
          label="任务超时时触发"
          disabled={saving}
          onChange={(next) => set({ onTaskTimeout: next })}
        />
        <span>任务超时时触发</span>
      </div>
      {draft.onTaskTimeout ? (
        <label className={css.fieldLabel}>
          任务超时触发的消息
          <textarea
            className={css.textArea}
            aria-label="任务超时触发消息"
            rows={2}
            placeholder="任务超时时发给 agent 的话（系统会附带任务编号与目标）"
            value={draft.taskTimeoutMessage}
            disabled={saving}
            onChange={(event) => set({ taskTimeoutMessage: event.currentTarget.value })}
          />
        </label>
      ) : null}

      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Checkbox
          checked={draft.onToolCall}
          label="工具调用时触发"
          disabled={saving}
          onChange={(next) => set({ onToolCall: next })}
        />
        <span>工具调用时触发</span>
      </div>
      {draft.onToolCall ? (
        <>
          <p className={css.fieldHint}>
            选择要监听的工具（至少一个）；任务执行中这些工具每次调用完成都会触发。已选 {draft.toolNames.length} 个。
          </p>
          {tools.phase === "loading" ? <p className={css.fieldHint}>读取工具目录…</p> : null}
          {tools.phase === "offline" ? (
            <>
              <p className={css.errorLine}>读不到工具目录，无法选择监听工具{tools.error === null ? "" : `：${tools.error}`}</p>
              <Button variant="outline" size="sm" disabled={saving} onClick={tools.reload}>
                重新读取工具目录
              </Button>
            </>
          ) : null}
          {tools.phase === "ready" && tools.tools.length === 0 ? (
            <p className={css.fieldHint}>（后端没有工具，无法选择监听工具）</p>
          ) : null}
          {tools.phase === "ready" && tools.tools.length > 0 ? (
            <div className={css.ruleList} style={{ maxHeight: 200, overflowY: "auto" }}>
              {tools.tools.map((tool) => (
                <div key={tool.key} className={css.checkRow}>
                  <Checkbox
                    checked={draft.toolNames.includes(tool.key)}
                    label={`监听工具 ${tool.key}`}
                    disabled={saving}
                    onChange={() => toggleTool(tool.key)}
                  />
                  <span>
                    {tool.key}
                    {tool.description === "" ? null : <span className={css.fieldHint}>{tool.description}</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <label className={css.fieldLabel}>
            工具调用触发的消息
            <textarea
              className={css.textArea}
              aria-label="工具调用触发消息"
              rows={2}
              placeholder="工具被调用时发给 agent 的话（系统会附带任务信息、工具入参与返回内容）"
              value={draft.toolCallMessage}
              disabled={saving}
              onChange={(event) => set({ toolCallMessage: event.currentTarget.value })}
            />
          </label>
        </>
      ) : null}

      <div className={css.checkInline} style={{ marginTop: 10 }}>
        <Checkbox
          checked={draft.onTaskCreate}
          label="任务创建时触发"
          disabled={saving}
          onChange={(next) => set({ onTaskCreate: next })}
        />
        <span>任务创建时触发</span>
      </div>
      {draft.onTaskCreate ? (
        <label className={css.fieldLabel}>
          任务创建触发的消息
          <textarea
            className={css.textArea}
            aria-label="任务创建触发消息"
            rows={2}
            placeholder="任务被创建时发给 agent 的话（系统会附带任务编号与目标）"
            value={draft.taskCreateMessage}
            disabled={saving}
            onChange={(event) => set({ taskCreateMessage: event.currentTarget.value })}
          />
        </label>
      ) : null}

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : trigger === null ? "添加触发器（停用）" : "保存修改"}
        </Button>
      </div>
    </div>
  );
}

/** 列表行：启用 Switch + 条件摘要 + 最后触发时间 + 编辑 / 删除。 */
function TriggerRow({
  trigger,
  onEdit,
  onDeleted,
  onReload,
}: {
  trigger: AgentTrigger;
  onEdit: () => void;
  onDeleted: () => void;
  onReload: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggle = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void setAgentTriggerEnabled(trigger, next)
      .then(() => {
        toast(next ? "触发器已启用" : "触发器已停用");
        onReload();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={css.ruleRow} data-trigger-id={trigger.id} data-trigger-enabled={trigger.enabled}>
      <Switch
        checked={trigger.enabled}
        disabled={busy}
        label={`启用触发器 #${trigger.id}`}
        onChange={toggle}
      />
      <div className={css.ruleMain}>
        <div className={css.ruleMeta}>
          <span className={css.rowLabel}>{triggerConditionSummary(trigger)}</span>
          <Tag tone={trigger.enabled ? "success" : "quiet"}>{trigger.enabled ? "已启用" : "已停用"}</Tag>
        </div>
        <div className={css.ruleMeta}>
          <span>{`最后触发：${formatLastFire(trigger.last_fire)}`}</span>
          {trigger.on_tool_call ? (
            <span>{`· 监听工具：${trigger.tool_names.length === 0 ? "（未选）" : trigger.tool_names.join("、")}`}</span>
          ) : null}
        </div>
        {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      </div>
      <div className={css.ruleActions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
          编辑
        </Button>
        <button type="button" className={css.dangerBtn} disabled={busy} onClick={onDeleted}>
          <IconTrashOutlineRegular size={13} /> 删除
        </button>
      </div>
    </div>
  );
}

/** 删除确认：Modal + tone="warning"（照 AssetDeleteDialog.tsx:68-97）。 */
function TriggerDeleteDialog({
  trigger,
  onClose,
  onDeleted,
}: {
  /** 要删的触发器，null 时弹窗关闭。 */
  trigger: AgentTrigger | null;
  onClose: () => void;
  onDeleted: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const confirm = (): void => {
    if (trigger === null || busy) return;
    setBusy(true);
    setFailure(null);
    void deleteAgentTrigger(trigger.id)
      .then(() => {
        toast("触发器已删除");
        onDeleted();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={trigger !== null}
      onClose={onClose}
      title="确认删除触发器"
      closeLabel="关闭"
      tone="warning"
      description="删除后该触发器不再排程运行，此操作不可撤销。"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={confirm} disabled={busy}>
            {busy ? "删除中…" : "确认删除"}
          </Button>
        </>
      }
    >
      <div className={css.dialogBodyText}>
        <p style={{ margin: 0 }}>
          {trigger === null ? "" : `触发器 #${trigger.id} · ${triggerConditionSummary(trigger)}`}
        </p>
        {failure === null ? null : <p className={css.errorLine}>删除失败：{failure}</p>}
      </div>
    </Modal>
  );
}

/**
 * 触发器页签。
 * @param props.agentKey - 正在编辑的 Agent。
 * @param props.builtin - 是否内置 Agent（内置不支持触发器，后端 POST 也返回 400）。
 * @returns 内置提示，或「列表 + 新建 / 编辑表单」。
 */
export function AgentTriggersTab({
  agentKey,
  builtin,
}: {
  agentKey: string;
  builtin: boolean;
}): React.ReactNode {
  const state = useAgentTriggers(builtin ? null : agentKey);
  /** undefined = 不显示表单；"new" = 新建；number = 编辑该条。 */
  const [editing, setEditing] = React.useState<"new" | number | undefined>(undefined);
  const [deleting, setDeleting] = React.useState<AgentTrigger | null>(null);

  React.useEffect(() => {
    setEditing(undefined);
    setDeleting(null);
  }, [agentKey]);

  if (builtin) {
    return (
      <div className={css.subForm} data-agent-tab-panel="triggers">
        <p className={css.fieldHint}>内置 Agent 不支持触发器（后端创建接口对内置 Agent 返回 400「触发器仅支持自定义 agent」）。</p>
      </div>
    );
  }

  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <div className={css.subForm} data-agent-tab-panel="triggers">
        <p className={css.fieldHint}>读取 GET /agents/{agentKey}/triggers …</p>
      </div>
    );
  }

  if (state.phase === "offline") {
    return (
      <div className={css.subForm} data-agent-tab-panel="triggers">
        <p className={css.fieldHint}>读不到这个 Agent 的触发器。</p>
        {state.error === null ? null : <p className={css.errorLine}>{state.error}</p>}
        <Button variant="outline" size="sm" aria-label="重新读取触发器" onClick={state.reload}>
          <IconRefreshOutlineRegular size={13} /> 重新读取
        </Button>
      </div>
    );
  }

  const editingTrigger = editing === undefined || editing === "new"
    ? null
    : state.triggers.find((item) => item.id === editing) ?? null;

  const closeForm = (): void => setEditing(undefined);
  const afterWrite = (): void => {
    setEditing(undefined);
    state.reload();
  };

  return (
    <div className={css.subForm} data-agent-tab-panel="triggers">
      <p className={css.fieldHint}>
        触发器让这个自定义 Agent 自动运行：每次触发都新建一个会话运行（在「Agent 对话」页可见）。可多选触发条件；系统会把「本次为何触发 +
        相关任务 / finding / 目标」附在你写的消息后面。新建的触发器默认停用。
      </p>

      <div className={css.filterBar}>
        <Button
          variant="outline"
          size="sm"
          disabled={editing === "new"}
          onClick={() => setEditing(editing === "new" ? undefined : "new")}
        >
          <IconPlusOutlineRegular size={13} /> 新增触发器
        </Button>
        <Button variant="ghost" size="sm" onClick={state.reload}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>

      {editing === "new" ? (
        <TriggerForm key="new" agentKey={agentKey} trigger={null} onSaved={afterWrite} onCancel={closeForm} />
      ) : null}

      {state.triggers.length === 0 ? (
        <p className={css.fieldHint}>该 Agent 还没有触发器。</p>
      ) : (
        <div className={css.ruleList}>
          {state.triggers.map((item) =>
            editing === item.id ? (
              <TriggerForm
                key={item.id}
                agentKey={agentKey}
                trigger={editingTrigger ?? item}
                onSaved={afterWrite}
                onCancel={closeForm}
              />
            ) : (
              <TriggerRow
                key={item.id}
                trigger={item}
                onEdit={() => setEditing(item.id)}
                onDeleted={() => setDeleting(item)}
                onReload={state.reload}
              />
            ),
          )}
        </div>
      )}

      <TriggerDeleteDialog
        trigger={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          if (deleting !== null && editing === deleting.id) setEditing(undefined);
          state.reload();
        }}
      />
    </div>
  );
}
