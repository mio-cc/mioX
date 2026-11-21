"use client";

/**
 * 拦截规则页：真实规则列表 + 新增/编辑/启停/删除，页内四个子页签
 * 「规则 / 工具范围 / 模型审批 / 资产黑名单」；中间两个由 InterceptAdvanced.tsx 提供，
 * 最后一个由 AssetInterceptRules.tsx 提供（全局资产黑名单，GET/POST /asset-intercept/rules）。
 * 数据走 @/v2/data/intercept-rules（GET/POST/PUT/DELETE /intercept/rules），
 * 交互文案对齐旧页 app/(main)/system/intercept/page.tsx：优先级越大越先匹配，
 * 首条命中生效。删除需要二次确认。
 *
 * 版式（D3 设计重塑）：SettingsPage → PageHead（随子页签换说明与动作）→ FilterBar 子页签 →
 * Section → Card + Row。规则一行：开关 · 名称 + 动作徽标 · 匹配目标/方式/模式元信息 ·
 * 行尾优先级格与 ⋯ 菜单（编辑 / 删除）；新建在列表末尾的虚线位；编辑与新建在弹窗里。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/page.tsx:654-759（拦截规则 / 模型配置两个页签）
 * DSH 依据：DSH 无拦截配置，按设置分节子页签扩展（总表 §4.3）。
 * 对照表行：P3:I1 P3:I2 P3:I3 P3:I4 P3:I5 P3:I6 P3:I7 P3:I8 P3:I9 P3:I10
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconPlusOutlineRegular, IconShieldOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import {
  AddSlot,
  AddSlots,
  Badge,
  Card,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  FilterBar,
  type KitTone,
  Meta,
  Notice,
  PageHead,
  Row,
  Section,
  SettingsPage,
  Skeleton,
  TextInput,
  UnitInput,
} from "@/components/v2/design/Kit";
import type { InterceptRule } from "@/lib/types";
import {
  createInterceptRule,
  deleteInterceptRule,
  toggleInterceptRule,
  updateInterceptRule,
  useInterceptRules,
  type InterceptRuleInput,
} from "@/v2/data/intercept-rules";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import { errorText, type InterceptHead, JudgePane, RefreshButton, RowMenu, ToolScopePane } from "./InterceptAdvanced";
import { AssetInterceptRules } from "./AssetInterceptRules";
import shared from "./SettingsDialog.module.css";
import own from "./InterceptRulesPage.module.css";

/** 页内子页签：规则列表 / 工具范围（P3:I6）/ 模型审批（P3:I7、P3:I8）/ 资产黑名单（P3:I9、P3:I10）。 */
const TABS = [
  { value: "rules", label: "规则" },
  { value: "tools", label: "工具范围" },
  { value: "judge", label: "模型审批" },
  { value: "assets", label: "资产黑名单" },
] as const;

type TabId = (typeof TABS)[number]["value"];

/** 设置分节「拦截规则」的入口：页头 + 子页签条 + 当前页签正文（页头内容由页签提供）。 */
export function InterceptPage(): React.ReactNode {
  const [tab, setTab] = React.useState<TabId>("rules");

  const head: InterceptHead = ({ lead, actions }) => (
    <div className={own.headBlock}>
      <PageHead title="拦截规则" lead={lead} actions={actions} />
      <FilterBar
        id="intercept-tab"
        label="拦截规则子页"
        className={own.tabs}
        options={TABS}
        value={tab}
        onChange={setTab}
        data={{ "data-intercept-tab": tab }}
      />
    </div>
  );

  return (
    <SettingsPage data={{ "data-settings-intercept": tab }}>
      {tab === "rules" ? <RulesPane head={head} /> : null}
      {tab === "tools" ? <ToolScopePane head={head} /> : null}
      {tab === "judge" ? <JudgePane head={head} /> : null}
      {tab === "assets" ? <AssetInterceptRules head={head} /> : null}
    </SettingsPage>
  );
}

const TARGET_OPTIONS = [
  { value: "tool_name", label: "工具名（tool_name）" },
  { value: "tool_input", label: "输入内容（tool_input JSON）" },
] as const;

const TYPE_OPTIONS = [
  { value: "string", label: "字符串包含" },
  { value: "regex", label: "正则表达式" },
] as const;

const ACTION_OPTIONS = [
  { value: "allow", label: "允许 — 直接放行，跳过后续规则" },
  { value: "deny", label: "禁止 — 阻断，返回拒绝消息给模型" },
  { value: "ask", label: "向用户申请 — 等待审批" },
] as const;

const TIMEOUT_OPTIONS = [
  { value: "deny", label: "自动拒绝" },
  { value: "allow", label: "自动允许" },
] as const;

const ACTION_LABEL: Record<string, string> = { allow: "允许", deny: "禁止", ask: "申请审批" };

const ACTION_TONE: Record<string, KitTone> = { allow: "success", deny: "danger", ask: "warning" };

const RULES_LEAD = "优先级越大越先匹配，首条命中生效；规则直接决定 Agent 工具能否执行。";

function ruleToInput(rule: InterceptRule): InterceptRuleInput {
  return {
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    match_target: rule.match_target,
    match_type: rule.match_type,
    pattern: rule.pattern,
    action: rule.action,
    message: rule.message,
    timeout_enabled: rule.timeout_enabled,
    timeout_seconds: rule.timeout_seconds,
    timeout_action: rule.timeout_action,
  };
}

/** 「规则」子页签正文：真实的拦截规则列表 + 新增/编辑/启停/删除。 */
function RulesPane({ head }: { head: InterceptHead }): React.ReactNode {
  const rules = useInterceptRules();
  const [editing, setEditing] = React.useState<InterceptRule | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<InterceptRule | null>(null);
  const actions = <RefreshButton onClick={rules.reload} spinning={rules.phase === "loading"} />;

  if (rules.phase === "loading") {
    return (
      <>
        {head({ lead: RULES_LEAD, actions })}
        <Card>
          <Skeleton label="读取拦截规则" />
        </Card>
      </>
    );
  }
  if (rules.phase === "offline") {
    return (
      <>
        {head({ lead: RULES_LEAD, actions })}
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={rules.reload}>重新读取</Button>}>
          未连接后端（读不到拦截规则）{rules.error === null ? "" : `：${rules.error}`}
        </Notice>
      </>
    );
  }

  const enabledCount = rules.rules.filter((rule) => rule.enabled).length;

  return (
    <>
      {head({ lead: RULES_LEAD, actions })}
      <Section
        title="规则"
        count={rules.rules.length === 0 ? undefined : `${enabledCount}/${rules.rules.length} 启用`}
        hint={rules.rules.length === 0 ? undefined : "按优先级从高到低匹配"}
      >
        {rules.rules.length === 0 ? (
          <Card>
            <Empty
              inCard
              icon={<IconShieldOutlineRegular size={18} />}
              title="还没有拦截规则"
              text="新建一条即生效：按工具名或输入内容匹配，命中后允许、禁止或转人工审批。"
            />
          </Card>
        ) : (
          <Card>
            {rules.rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onEdit={() => setEditing(rule)}
                onDelete={() => setDeleting(rule)}
                onChanged={rules.reload}
              />
            ))}
          </Card>
        )}
        <AddSlots>
          <AddSlot data={{ "data-rule-new": "" }} onClick={() => setEditing("new")}>
            <IconPlusOutlineRegular size={13} /> 新增规则
          </AddSlot>
        </AddSlots>
      </Section>

      {editing === null ? null : (
        <RuleEditor
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            rules.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <RuleDeleteDialog
        rule={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          rules.reload();
        }}
      />
    </>
  );
}

/** 列表行：开关 · 名称与动作 · 匹配元信息 · 优先级与 ⋯ 菜单。 */
function RuleRow({
  rule,
  onEdit,
  onDelete,
  onChanged,
}: {
  rule: InterceptRule;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggle = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void toggleInterceptRule(rule.id, next)
      .then(() => {
        toast(next ? "规则已启用" : "规则已停用");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  const message = rule.action !== "allow" && rule.message.trim() !== "" ? rule.message : null;

  return (
    <Row
      data={{ "data-rule-id": String(rule.id), "data-rule-enabled": String(rule.enabled) }}
      lead={<Switch checked={rule.enabled} disabled={busy} label={`启用规则 ${rule.name}`} onChange={toggle} />}
      label={<span className={rule.enabled ? undefined : own.labelOff}>{rule.name}</span>}
      labelAdornment={<Badge tone={rule.enabled ? (ACTION_TONE[rule.action] ?? "neutral") : "neutral"}>{ACTION_LABEL[rule.action] ?? rule.action}</Badge>}
      description={
        <>
          <Meta
            items={[
              rule.match_target === "tool_name" ? "工具名" : "输入内容",
              rule.match_type === "regex" ? "正则" : "包含",
              <span key="pattern" className={own.pattern} title={rule.pattern}>
                {rule.pattern}
              </span>,
              message === null ? null : (
                <span key="message" className={own.metaClip} title={message}>
                  消息：{message}
                </span>
              ),
              rule.timeout_enabled ? `超时 ${rule.timeout_seconds}s 自动${rule.timeout_action === "deny" ? "拒绝" : "允许"}` : null,
            ]}
          />
          {failure === null ? null : <span className={own.rowError}>操作失败：{failure}</span>}
        </>
      }
    >
      <span className={own.prio} title={`优先级 ${rule.priority}`} aria-label={`优先级 ${rule.priority}`}>
        {rule.priority}
      </span>
      <RowMenu
        label={`规则 ${rule.name} 的更多操作`}
        disabled={busy}
        data={{ "data-rule-more": String(rule.id) }}
        items={[
          { label: "编辑", onSelect: onEdit, data: { "data-rule-edit": String(rule.id) } },
          { label: "删除", onSelect: onDelete, danger: true, separatorBefore: true, data: { "data-rule-delete": String(rule.id) } },
        ]}
      />
    </Row>
  );
}

/** 删除二次确认：Modal + tone="warning"，忙碌时两个按钮都禁用。 */
function RuleDeleteDialog({
  rule,
  onClose,
  onDeleted,
}: {
  rule: InterceptRule | null;
  onClose: () => void;
  onDeleted: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (rule === null) setFailure(null);
  }, [rule]);

  const confirm = (): void => {
    if (rule === null || busy) return;
    setBusy(true);
    setFailure(null);
    void deleteInterceptRule(rule.id)
      .then(() => {
        toast("规则已删除");
        onDeleted();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={rule !== null}
      onClose={onClose}
      title="删除拦截规则"
      closeLabel="关闭"
      tone="warning"
      description={rule === null ? "" : `将永久删除规则「${rule.name}」，此操作不可撤销；命中它的工具调用将交给后续规则处理。`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={confirm} disabled={busy} data-rule-delete-confirm="">
            {busy ? "删除中…" : "确认删除"}
          </Button>
        </>
      }
    >
      {rule === null ? null : (
        <div className={own.dialogStack}>
          <div className={own.target}>
            <Badge tone={ACTION_TONE[rule.action] ?? "neutral"}>{ACTION_LABEL[rule.action] ?? rule.action}</Badge>
            <span className={own.targetText} title={rule.pattern}>
              {rule.pattern}
            </span>
          </div>
          {failure === null ? null : <Notice tone="danger">删除失败：{failure}</Notice>}
        </div>
      )}
    </Modal>
  );
}

/** 新建/编辑弹窗：字段与后端 InterceptRule 一一对应。 */
function RuleEditor({
  rule,
  onSaved,
  onCancel,
}: {
  rule: InterceptRule | null;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [draft, setDraft] = React.useState<InterceptRuleInput>(() =>
    rule === null
      ? {
          name: "",
          enabled: true,
          priority: 0,
          match_target: "tool_name",
          match_type: "string",
          pattern: "",
          action: "deny",
          message: "",
          timeout_enabled: false,
          timeout_seconds: 30,
          timeout_action: "deny",
        }
      : ruleToInput(rule),
  );
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const set = (patch: Partial<InterceptRuleInput>): void => setDraft((prev) => ({ ...prev, ...patch }));

  const regexError = React.useMemo(() => {
    if (draft.match_type !== "regex" || draft.pattern.trim() === "") return null;
    try {
      new RegExp(draft.pattern);
      return null;
    } catch (reason) {
      return errorText(reason);
    }
  }, [draft.match_type, draft.pattern]);

  const save = (): void => {
    if (draft.name.trim() === "") {
      setFailure("规则名称不能为空。");
      return;
    }
    if (draft.pattern.trim() === "") {
      setFailure("匹配模式不能为空。");
      return;
    }
    if (regexError !== null) {
      setFailure(`正则表达式无法编译：${regexError}`);
      return;
    }
    setSaving(true);
    setFailure(null);
    const input: InterceptRuleInput = {
      ...draft,
      name: draft.name.trim(),
      pattern: draft.pattern,
      priority: Number.isFinite(draft.priority) ? draft.priority : 0,
      timeout_seconds: Number.isFinite(draft.timeout_seconds) ? draft.timeout_seconds : 30,
    };
    const write = rule === null ? createInterceptRule(input) : updateInterceptRule(rule.id, input);
    void write
      .then(() => {
        toast(rule === null ? "拦截规则已创建" : "拦截规则已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={rule === null ? "新建拦截规则" : "编辑拦截规则"}
      closeLabel="关闭"
      className={own.modal}
      contentClassName={own.modalContent}
      footer={
        <>
          <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={save} data-rule-save="">
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className={own.form} data-rule-editor={rule === null ? "new" : String(rule.id)}>
        <EditorGroup title="基本">
          <FieldGrid>
            <Field label="名称" htmlFor={`${uid}-name`}>
              <TextInput
                id={`${uid}-name`}
                aria-label="规则名称"
                placeholder="给规则起个名字"
                value={draft.name}
                disabled={saving}
                data-modal-autofocus=""
                onChange={(event) => set({ name: event.currentTarget.value })}
              />
            </Field>
            <Field label="优先级" htmlFor={`${uid}-priority`} hint="数字越大越先匹配">
              <TextInput
                id={`${uid}-priority`}
                className={shared.numberInputKit}
                type="number"
                aria-label="规则优先级"
                value={String(draft.priority)}
                disabled={saving}
                onChange={(event) => set({ priority: Number.parseInt(event.currentTarget.value, 10) || 0 })}
              />
            </Field>
          </FieldGrid>
        </EditorGroup>

        <EditorGroup title="匹配">
          <FieldGrid>
            <Field label="匹配目标" htmlFor={`${uid}-target`}>
              <SelectMenu
                id={`${uid}-target`}
                value={draft.match_target}
                options={TARGET_OPTIONS}
                disabled={saving}
                ariaLabel="匹配目标"
                onChange={(value) => set({ match_target: value === "tool_input" ? "tool_input" : "tool_name" })}
              />
            </Field>
            <Field label="匹配类型" htmlFor={`${uid}-type`}>
              <SelectMenu
                id={`${uid}-type`}
                value={draft.match_type}
                options={TYPE_OPTIONS}
                disabled={saving}
                ariaLabel="匹配类型"
                onChange={(value) => set({ match_type: value === "regex" ? "regex" : "string" })}
              />
            </Field>
            <Field
              label="模式"
              htmlFor={`${uid}-pattern`}
              span
              hint={
                draft.match_type === "regex"
                  ? "Go RE2 正则；浏览器只能校验 JS 可编译的部分，服务端为最终校验方。"
                  : "对工具名或工具输入 JSON 做大小写不敏感的子串匹配。"
              }
            >
              <TextInput
                id={`${uid}-pattern`}
                mono
                aria-label="规则模式"
                placeholder={draft.match_type === "regex" ? "^Bash$" : "rm -rf"}
                value={draft.pattern}
                disabled={saving}
                onChange={(event) => set({ pattern: event.currentTarget.value })}
              />
            </Field>
          </FieldGrid>
          {regexError === null ? null : <Notice tone="warning">{regexError}</Notice>}
          {draft.match_type === "regex" && draft.pattern.includes("(?") ? (
            <Notice tone="neutral">包含 Go RE2 扩展语法（如 (?i)），浏览器无法预览，提交后由服务端验证。</Notice>
          ) : null}
        </EditorGroup>

        <EditorGroup title="处置">
          <Field label="拦截策略" htmlFor={`${uid}-action`}>
            <SelectMenu
              id={`${uid}-action`}
              value={draft.action}
              options={ACTION_OPTIONS}
              disabled={saving}
              ariaLabel="拦截策略"
              onChange={(value) => set({ action: value === "allow" ? "allow" : value === "ask" ? "ask" : "deny" })}
            />
          </Field>
          {draft.action !== "allow" ? (
            <Field
              label={draft.action === "deny" ? "拒绝消息" : "审批说明"}
              htmlFor={`${uid}-message`}
              optional={draft.action === "ask"}
              hint={draft.action === "deny" ? "返回给模型" : undefined}
            >
              <textarea
                id={`${uid}-message`}
                className={own.textArea}
                aria-label="拒绝消息"
                rows={2}
                placeholder={draft.action === "deny" ? "操作被安全策略阻止" : ""}
                value={draft.message}
                disabled={saving}
                onChange={(event) => set({ message: event.currentTarget.value })}
              />
            </Field>
          ) : null}
          <div className={shared.optionCard}>
            {draft.action === "ask" ? (
              <Row label="启用审批超时" description="超时后自动处置，避免调用一直挂起。">
                <Switch checked={draft.timeout_enabled} label="启用审批超时" disabled={saving} onChange={(next) => set({ timeout_enabled: next })} />
              </Row>
            ) : null}
            <Row label="立即启用" description={rule === null ? "保存后生效。" : "关闭则保留规则但不参与匹配。"}>
              <Switch checked={draft.enabled} label="启用规则" disabled={saving} onChange={(next) => set({ enabled: next })} />
            </Row>
          </div>
          {draft.action === "ask" && draft.timeout_enabled ? (
            <FieldGrid>
              <Field label="超时时间" htmlFor={`${uid}-timeout`}>
                <UnitInput unit="秒">
                  <TextInput
                    id={`${uid}-timeout`}
                    className={shared.numberInputKit}
                    type="number"
                    min={5}
                    aria-label="超时时间秒"
                    value={String(draft.timeout_seconds)}
                    disabled={saving}
                    onChange={(event) => {
                      const next = Number.parseInt(event.currentTarget.value, 10);
                      set({ timeout_seconds: Number.isFinite(next) && next > 0 ? next : 0 });
                    }}
                  />
                </UnitInput>
              </Field>
              <Field label="超时动作" htmlFor={`${uid}-timeout-action`}>
                <SelectMenu
                  id={`${uid}-timeout-action`}
                  value={draft.timeout_action}
                  options={TIMEOUT_OPTIONS}
                  disabled={saving}
                  ariaLabel="超时动作"
                  onChange={(value) => set({ timeout_action: value === "allow" ? "allow" : "deny" })}
                />
              </Field>
            </FieldGrid>
          ) : null}
        </EditorGroup>

        {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      </div>
    </Modal>
  );
}
