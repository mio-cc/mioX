"use client";

/**
 * Agent 编辑器「触发器」分区：一个自定义 Agent 的 P3 调度触发器列表、
 * 列表行的启用开关、新建 / 编辑表单（6 种条件 + 每种条件各自的消息 + 工具调用
 * 触发的工具多选）和删除二次确认。内置 Agent 不支持触发器，只显示提示不渲染表单。
 *
 * 旧页面依据：ARTEX/web/src/components/agent-editor.tsx:776（列表读取）、
 * :785-806（表单重置）、:809-825（灌入编辑）、:828-902（提交 / 启停 / 删除）、
 * :904-913（条件摘要）、:1006-1098（6 种条件字段）、:1112-1156（已有触发器列表）。
 * DSH 依据：DSH 无触发器（近似 schedule_create 定时任务），按设置分节扩展；
 * 删除确认照 components/v2/data-pages/AssetDeleteDialog.tsx（Modal tone="warning"）。
 * 对照表行：P3:A12
 *
 * 版式（D3 设计重塑）：嵌在 AgentEditor 的填充模块里——触发器列表是 layer-1 小卡里的 kit Row
 * （启用开关 + 条件摘要 + 最后触发时间 + ⋯ 菜单），新建/编辑是一张 layer-1 子编辑器：六种条件各一行
 * 开关，打开后在下方展开该条件的字段；列表末尾用 AddSlot 新增。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconPlusOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import {
  AddSlot,
  Badge,
  Dot,
  EditorActions,
  Field,
  Meta,
  Notice,
  Row,
  RowMenu,
  Skeleton,
  TextArea,
  TextInput,
  UnitInput,
} from "@/components/v2/design/Kit";
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
import { RefreshButton } from "./InterceptAdvanced";
import { toast } from "./Toast";
import shared from "./SettingsDialog.module.css";
import own from "./AgentPresetsPage.module.css";

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

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

/** 一种触发条件：一行开关 + 打开后的字段。 */
function Condition({
  label,
  description,
  on,
  disabled,
  onToggle,
  children,
}: {
  label: string;
  description: string;
  on: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className={own.cond}>
      <Row label={label} description={description}>
        <Switch checked={on} label={label} disabled={disabled} onChange={onToggle} />
      </Row>
      {on ? <div className={own.condBody}>{children}</div> : null}
    </div>
  );
}

/** 某个条件下发给 Agent 的消息框。 */
function MessageField({
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}): React.ReactNode {
  return (
    <TextArea
      className={own.short}
      aria-label={label}
      rows={2}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
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
  const uid = React.useId();
  const tools = useTriggerToolCatalog();
  const [draft, setDraft] = React.useState<TriggerDraft>(() => (trigger === null ? emptyDraft() : draftFrom(trigger)));
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const set = (patch: Partial<TriggerDraft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleTool = (key: string): void =>
    setDraft((prev) => ({
      ...prev,
      toolNames: prev.toolNames.includes(key) ? prev.toolNames.filter((item) => item !== key) : [...prev.toolNames, key],
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
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={own.subEditor} data-trigger-form={trigger === null ? "new" : String(trigger.id)}>
      <div className={own.subEditorTitle}>{trigger === null ? "新增触发器" : `编辑触发器 #${trigger.id}`}</div>
      <p className={own.hint}>
        触发后系统会新建一个会话运行该 Agent，并把「本次为何触发 + 相关任务 / finding / 目标」附在你写的消息后面。
        {trigger === null ? "新建的触发器默认停用，需要在列表上手动启用。" : ""}
      </p>

      <div className={own.conds}>
        <Condition
          label="定时触发"
          description="每隔 N 秒运行一次。"
          on={Number(draft.intervalSec) > 0}
          disabled={saving}
          onToggle={(next) => set({ intervalSec: next ? "60" : "0" })}
        >
          <Field label="间隔" htmlFor={`${uid}-interval`}>
            <div className={own.narrow}>
              <UnitInput unit="秒">
                <TextInput
                  id={`${uid}-interval`}
                  className={shared.numberInputKit}
                  type="number"
                  min={1}
                  aria-label="定时间隔秒"
                  value={draft.intervalSec}
                  disabled={saving}
                  onChange={(event) => set({ intervalSec: event.currentTarget.value })}
                />
              </UnitInput>
            </div>
          </Field>
          <MessageField
            label="定时触发消息"
            placeholder="定时触发时发给 agent 的话，如：巡检所有任务"
            value={draft.intervalMessage}
            disabled={saving}
            onChange={(next) => set({ intervalMessage: next })}
          />
        </Condition>

        <Condition
          label="发现 finding 时触发"
          description="系统会附带任务与 finding 详情。"
          on={draft.onFinding}
          disabled={saving}
          onToggle={(next) => set({ onFinding: next })}
        >
          <MessageField
            label="finding 触发消息"
            placeholder="发现 finding 时发给 agent 的话"
            value={draft.findingMessage}
            disabled={saving}
            onChange={(next) => set({ findingMessage: next })}
          />
        </Condition>

        <Condition
          label="目标达成时触发"
          description="系统会附带任务与达成的目标。"
          on={draft.onGoalMet}
          disabled={saving}
          onToggle={(next) => set({ onGoalMet: next })}
        >
          <MessageField
            label="目标达成触发消息"
            placeholder="目标达成时发给 agent 的话"
            value={draft.goalMessage}
            disabled={saving}
            onChange={(next) => set({ goalMessage: next })}
          />
        </Condition>

        <Condition
          label="任务超时时触发"
          description="系统会附带任务编号与目标。"
          on={draft.onTaskTimeout}
          disabled={saving}
          onToggle={(next) => set({ onTaskTimeout: next })}
        >
          <MessageField
            label="任务超时触发消息"
            placeholder="任务超时时发给 agent 的话"
            value={draft.taskTimeoutMessage}
            disabled={saving}
            onChange={(next) => set({ taskTimeoutMessage: next })}
          />
        </Condition>

        <Condition
          label="工具调用时触发"
          description="所选工具每次调用完成都会触发，附带入参与返回内容。"
          on={draft.onToolCall}
          disabled={saving}
          onToggle={(next) => set({ onToolCall: next })}
        >
          <Field label={`监听工具（已选 ${draft.toolNames.length}）`} hint="至少选择一个。">
            {tools.phase === "loading" ? <Skeleton label="读取工具目录" /> : null}
            {tools.phase === "offline" ? (
              <Notice
                tone="danger"
                action={
                  <Button variant="ghost" size="sm" disabled={saving} onClick={tools.reload}>
                    重新读取
                  </Button>
                }
              >
                读不到工具目录，无法选择监听工具{tools.error === null ? "" : `：${tools.error}`}
              </Notice>
            ) : null}
            {tools.phase === "ready" && tools.tools.length === 0 ? (
              <p className={own.hint}>后端没有工具，无法选择监听工具。</p>
            ) : null}
            {tools.phase === "ready" && tools.tools.length > 0 ? (
              <div className={own.pick}>
                {tools.tools.map((tool) => (
                  <span key={tool.key} className={own.pickItem} title={tool.description}>
                    <Checkbox
                      checked={draft.toolNames.includes(tool.key)}
                      label={tool.key}
                      disabled={saving}
                      onChange={() => toggleTool(tool.key)}
                    />
                    {tool.description === "" ? null : <span className={own.pickDesc}>{tool.description}</span>}
                  </span>
                ))}
              </div>
            ) : null}
          </Field>
          <MessageField
            label="工具调用触发消息"
            placeholder="工具被调用时发给 agent 的话"
            value={draft.toolCallMessage}
            disabled={saving}
            onChange={(next) => set({ toolCallMessage: next })}
          />
        </Condition>

        <Condition
          label="任务创建时触发"
          description="系统会附带任务编号与目标。"
          on={draft.onTaskCreate}
          disabled={saving}
          onToggle={(next) => set({ onTaskCreate: next })}
        >
          <MessageField
            label="任务创建触发消息"
            placeholder="任务被创建时发给 agent 的话"
            value={draft.taskCreateMessage}
            disabled={saving}
            onChange={(next) => set({ taskCreateMessage: next })}
          />
        </Condition>
      </div>

      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      <EditorActions>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : trigger === null ? "添加触发器（停用）" : "保存修改"}
        </Button>
      </EditorActions>
    </div>
  );
}

/** 列表行：启用 Switch + 条件摘要 + 最后触发时间 + ⋯（编辑 / 删除）。 */
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
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      top
      muted={!trigger.enabled}
      data={{ "data-trigger-id": String(trigger.id), "data-trigger-enabled": String(trigger.enabled) }}
      label={triggerConditionSummary(trigger)}
      labelAdornment={
        <Badge tone={trigger.enabled ? "success" : "neutral"}>
          {trigger.enabled ? <Dot tone="success" /> : null}
          {trigger.enabled ? "已启用" : "已停用"}
        </Badge>
      }
      description={
        <>
          <Meta
            items={[
              `#${trigger.id}`,
              `最后触发：${formatLastFire(trigger.last_fire)}`,
              trigger.on_tool_call
                ? `监听：${trigger.tool_names.length === 0 ? "（未选）" : trigger.tool_names.join("、")}`
                : null,
            ]}
          />
          {failure === null ? null : <span className={shared.errorLine}>{failure}</span>}
        </>
      }
    >
      <Switch checked={trigger.enabled} disabled={busy} label={`启用触发器 #${trigger.id}`} onChange={toggle} />
      <RowMenu
        label={`触发器 #${trigger.id} 的更多操作`}
        disabled={busy}
        items={[
          { label: "编辑", onSelect: onEdit, data: { "data-trigger-action": "edit" } },
          { label: "删除", danger: true, separatorBefore: true, onSelect: onDeleted, data: { "data-trigger-action": "delete" } },
        ]}
      />
    </Row>
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
      .catch((reason: unknown) => setFailure(errorText(reason)))
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
      <div className={own.dialogStack}>
        <div className={own.targetBox}>
          {trigger === null ? "" : `触发器 #${trigger.id} · ${triggerConditionSummary(trigger)}`}
        </div>
        {failure === null ? null : <Notice tone="danger">删除失败：{failure}</Notice>}
      </div>
    </Modal>
  );
}

/**
 * 触发器分区。
 * @param props.agentKey - 正在编辑的 Agent。
 * @param props.builtin - 是否内置 Agent（内置不支持触发器，后端 POST 也返回 400）。
 * @returns 内置提示，或「列表 + 新建 / 编辑表单」。
 */
export function AgentTriggersTab({ agentKey, builtin }: { agentKey: string; builtin: boolean }): React.ReactNode {
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
      <div className={own.panel} data-agent-tab-panel="triggers">
        <Notice>内置 Agent 不支持触发器（后端创建接口对内置 Agent 返回 400「触发器仅支持自定义 agent」）。</Notice>
      </div>
    );
  }

  if (state.phase === "loading" || state.phase === "idle") {
    return (
      <div className={own.panel} data-agent-tab-panel="triggers">
        <Skeleton label="读取触发器" />
      </div>
    );
  }

  if (state.phase === "offline") {
    return (
      <div className={own.panel} data-agent-tab-panel="triggers">
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" aria-label="重新读取触发器" onClick={state.reload}>
              重新读取
            </Button>
          }
        >
          读不到这个 Agent 的触发器{state.error === null ? "" : `：${state.error}`}
        </Notice>
      </div>
    );
  }

  const editingTrigger =
    editing === undefined || editing === "new" ? null : (state.triggers.find((item) => item.id === editing) ?? null);

  const closeForm = (): void => setEditing(undefined);
  const afterWrite = (): void => {
    setEditing(undefined);
    state.reload();
  };
  const enabledCount = state.triggers.filter((item) => item.enabled).length;

  return (
    <div className={own.panel} data-agent-tab-panel="triggers">
      <div className={own.subHead}>
        <span>触发器</span>
        <span className={own.groupCount}>{`${enabledCount} 启用 / 共 ${state.triggers.length}`}</span>
        <span className={own.groupHeadEnd}>
          <RefreshButton label="刷新触发器" onClick={state.reload} />
        </span>
      </div>
      <p className={own.hint}>
        触发器让这个自定义 Agent 自动运行：每次触发都新建一个会话（在「Agent 对话」页可见）。可多选触发条件；新建的触发器默认停用。
      </p>

      {state.triggers.length === 0 ? null : (
        <div className={`${shared.optionCard} ${own.optionRows}`}>
          {state.triggers.map((item) =>
            editing === item.id ? null : (
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

      {editingTrigger === null ? null : (
        <TriggerForm
          key={editingTrigger.id}
          agentKey={agentKey}
          trigger={editingTrigger}
          onSaved={afterWrite}
          onCancel={closeForm}
        />
      )}

      {editing === "new" ? (
        <TriggerForm key="new" agentKey={agentKey} trigger={null} onSaved={afterWrite} onCancel={closeForm} />
      ) : (
        <AddSlot data={{ "data-trigger-new": "" }} onClick={() => setEditing("new")}>
          <IconPlusOutlineRegular size={13} /> {state.triggers.length === 0 ? "添加第一个触发器" : "新增触发器"}
        </AddSlot>
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
