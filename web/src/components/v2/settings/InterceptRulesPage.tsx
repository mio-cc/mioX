"use client";

/**
 * 拦截规则页：真实规则列表 + 新增/编辑/启停/删除，页内四个子页签
 * 「规则 / 工具范围 / 模型审批 / 资产黑名单」；中间两个由 InterceptAdvanced.tsx 提供，
 * 最后一个由 AssetInterceptRules.tsx 提供（全局资产黑名单，GET/POST /asset-intercept/rules）。
 * 数据走 @/v2/data/intercept-rules（GET/POST/PUT/DELETE /intercept/rules），
 * 交互文案对齐旧页 app/(main)/system/intercept/page.tsx：优先级越大越先匹配，
 * 首条命中生效。删除需要二次确认。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/page.tsx:654-759（拦截规则 / 模型配置两个页签）
 * DSH 依据：DSH 无拦截配置，按设置分节子页签扩展（总表 §4.3）；
 * 子页签样式复用 SettingsDialog.module.css 的 agentTabs / agentTab / agentTabActive。
 * 对照表行：P3:I1 P3:I2 P3:I3 P3:I4 P3:I5 P3:I6 P3:I7 P3:I8 P3:I9 P3:I10
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

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
import { JudgePane, ToolScopePane } from "./InterceptAdvanced";
import { AssetInterceptRules } from "./AssetInterceptRules";
import css from "./SettingsDialog.module.css";

/** 页内子页签：规则列表 / 工具范围（P3:I6）/ 模型审批（P3:I7、P3:I8）/ 资产黑名单（P3:I9、P3:I10）。 */
const TABS = [
  { id: "rules", label: "规则" },
  { id: "tools", label: "工具范围" },
  { id: "judge", label: "模型审批" },
  { id: "assets", label: "资产黑名单" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** 设置分节「拦截规则」的入口：一个页内页签条 + 当前页签正文。 */
export function InterceptPage(): React.ReactNode {
  const [tab, setTab] = React.useState<TabId>("rules");
  return (
    <>
      <div className={css.agentTabs}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${css.agentTab} ${tab === item.id ? css.agentTabActive : ""}`}
            data-intercept-tab={item.id}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "tools" ? <ToolScopePane /> : null}
      {tab === "judge" ? <JudgePane /> : null}
      {tab === "assets" ? <AssetInterceptRules /> : null}
      {tab === "rules" ? <RulesPane /> : null}
    </>
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

/** 一句话摘要：匹配目标/类型/策略/优先级。 */
function ruleSummary(rule: InterceptRule): string {
  return `${rule.match_target === "tool_name" ? "工具名" : "输入内容"} · ${
    rule.match_type === "regex" ? "正则" : "包含"
  } · ${ACTION_LABEL[rule.action] ?? rule.action} · 优先级 ${rule.priority}`;
}

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
function RulesPane(): React.ReactNode {
  const rules = useInterceptRules();
  const [editing, setEditing] = React.useState<number | "new" | null>(null);

  if (rules.phase === "loading") return <p className={css.pageLead}>读取拦截规则…</p>;
  if (rules.phase === "offline") {
    return (
      <>
        <p className={css.pageLead}>未连接后端（读不到拦截规则）</p>
        {rules.error === null ? null : <p className={css.errorLine}>{rules.error}</p>}
        <Button variant="outline" size="sm" onClick={rules.reload}>
          重新读取
        </Button>
      </>
    );
  }

  return (
    <>
      <h2 className={css.pageTitle}>拦截规则</h2>
      <p className={css.pageLead}>
        来自 GET /intercept/rules，共 {rules.rules.length} 条。优先级越大越先匹配，首条命中规则生效；规则直接决定 Agent
        工具能否执行。
      </p>
      <div className={css.pageToolbar}>
        <Button variant="outline" size="sm" onClick={() => setEditing(editing === "new" ? null : "new")}>
          <IconPlusOutlineRegular size={13} /> 新增规则
        </Button>
        <Button variant="ghost" size="sm" onClick={rules.reload}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>

      {editing === "new" ? (
        <RuleEditor
          rule={null}
          onSaved={() => {
            setEditing(null);
            rules.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {rules.rules.length === 0 ? (
        <p className={css.pageLead}>还没有拦截规则；新建一条即生效。</p>
      ) : (
        <div className={css.ruleList}>
          {rules.rules.map((rule) =>
            editing === rule.id ? (
              <RuleEditor
                key={rule.id}
                rule={rule}
                onSaved={() => {
                  setEditing(null);
                  rules.reload();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <RuleRow
                key={rule.id}
                rule={rule}
                onEdit={() => setEditing(rule.id)}
                onChanged={rules.reload}
              />
            ),
          )}
        </div>
      )}
    </>
  );
}

/** 列表行：启用态 + 摘要 + 模式，动作只做真实能力。 */
function RuleRow({
  rule,
  onEdit,
  onChanged,
}: {
  rule: InterceptRule;
  onEdit: () => void;
  onChanged: () => void;
}): React.ReactNode {
  const [confirming, setConfirming] = React.useState(false);
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const remove = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteInterceptRule(rule.id)
      .then(() => {
        toast("规则已删除");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <div className={css.ruleRow} data-rule-id={rule.id} data-rule-enabled={rule.enabled}>
      <Switch
        checked={rule.enabled}
        disabled={busy}
        label={`启用规则 ${rule.name}`}
        onChange={toggle}
      />
      <div className={css.ruleMain}>
        <div className={css.ruleMeta}>
          <span className={css.rowLabel}>{rule.name}</span>
          <Tag tone={rule.enabled ? "success" : "quiet"}>{rule.enabled ? "已启用" : "已停用"}</Tag>
          <Tag tone="outline">{ACTION_LABEL[rule.action] ?? rule.action}</Tag>
        </div>
        <div className={css.rulePattern}>{rule.pattern}</div>
        <div className={css.ruleMeta}>
          <span>{ruleSummary(rule)}</span>
          {rule.action !== "allow" && rule.message.trim() !== "" ? <span>· 消息：{rule.message}</span> : null}
          {rule.timeout_enabled ? <span>· 超时 {rule.timeout_seconds}s 后自动{rule.timeout_action === "deny" ? "拒绝" : "允许"}</span> : null}
        </div>
        {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      </div>
      <div className={css.ruleActions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
          编辑
        </Button>
        {confirming ? (
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
              <IconTrashOutlineRegular size={13} /> 确认删除
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </Button>
          </>
        ) : (
          <button type="button" className={css.dangerBtn} disabled={busy} onClick={() => setConfirming(true)}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}

/** 新建/编辑表单：字段与后端 InterceptRule 一一对应。 */
function RuleEditor({
  rule,
  onSaved,
  onCancel,
}: {
  rule: InterceptRule | null;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
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
      return reason instanceof Error ? reason.message : String(reason);
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={css.formCard}>
      <div className={css.subTitle}>{rule === null ? "新建拦截规则" : `编辑拦截规则 · ${rule.name}`}</div>
      <label className={css.fieldLabel}>
        名称
        <input
          className={css.textField}
          aria-label="规则名称"
          placeholder="给规则起个名字"
          value={draft.name}
          disabled={saving}
          onChange={(event) => set({ name: event.currentTarget.value })}
        />
      </label>
      <label className={css.fieldLabel}>
        优先级（数字越大越先匹配）
        <input
          className={css.textField}
          type="number"
          aria-label="规则优先级"
          value={String(draft.priority)}
          disabled={saving}
          onChange={(event) => set({ priority: Number.parseInt(event.currentTarget.value, 10) || 0 })}
        />
      </label>

      <div className={css.formRow}>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>匹配目标</div>
          <SelectMenu
            value={draft.match_target}
            options={TARGET_OPTIONS}
            disabled={saving}
            onChange={(value) => set({ match_target: value === "tool_input" ? "tool_input" : "tool_name" })}
          />
        </div>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>匹配类型</div>
          <SelectMenu
            value={draft.match_type}
            options={TYPE_OPTIONS}
            disabled={saving}
            onChange={(value) => set({ match_type: value === "regex" ? "regex" : "string" })}
          />
        </div>
      </div>

      <label className={css.fieldLabel}>
        模式
        <input
          className={css.textField}
          aria-label="规则模式"
          placeholder={draft.match_type === "regex" ? "^Bash$" : "rm -rf"}
          value={draft.pattern}
          disabled={saving}
          onChange={(event) => set({ pattern: event.currentTarget.value })}
        />
      </label>
      <p className={css.fieldHint}>
        {draft.match_type === "regex"
          ? "Go RE2 正则；浏览器只能校验 JS 可编译的部分，服务端为最终校验方。"
          : "对工具名或工具输入 JSON 做大小写不敏感的子串匹配。"}
      </p>
      {regexError === null ? null : <p className={css.warn}>{regexError}</p>}
      {draft.match_type === "regex" && draft.pattern.includes("(?") ? (
        <p className={css.warn}>包含 Go RE2 扩展语法（如 (?i)），浏览器无法预览，提交后由服务端验证。</p>
      ) : null}

      <div className={css.fieldLabel}>拦截策略</div>
      <SelectMenu
        value={draft.action}
        options={ACTION_OPTIONS}
        disabled={saving}
        onChange={(value) =>
          set({ action: value === "allow" ? "allow" : value === "ask" ? "ask" : "deny" })
        }
      />

      {draft.action !== "allow" ? (
        <label className={css.fieldLabel}>
          {draft.action === "deny" ? "拒绝消息（返回给模型）" : "审批说明（可选）"}
          <textarea
            className={css.textArea}
            aria-label="拒绝消息"
            rows={2}
            placeholder={draft.action === "deny" ? "操作被安全策略阻止" : ""}
            value={draft.message}
            disabled={saving}
            onChange={(event) => set({ message: event.currentTarget.value })}
          />
        </label>
      ) : null}

      {draft.action === "ask" ? (
        <>
          <div className={css.formRow}>
            <div className={css.checkInline}>
              <Switch
                checked={draft.timeout_enabled}
                label="启用审批超时"
                disabled={saving}
                onChange={(next) => set({ timeout_enabled: next })}
              />
              <span>启用审批超时（超时后自动处置）</span>
            </div>
          </div>
          {draft.timeout_enabled ? (
            <div className={css.formRow}>
              <label className={css.fieldLabel}>
                超时时间（秒）
                <input
                  className={css.textField}
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
              </label>
              <div className={css.fieldBlock}>
                <div className={css.fieldLabel}>超时动作</div>
                <SelectMenu
                  value={draft.timeout_action}
                  options={TIMEOUT_OPTIONS}
                  disabled={saving}
                  onChange={(value) => set({ timeout_action: value === "allow" ? "allow" : "deny" })}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className={css.checkInline} style={{ marginTop: 12 }}>
        <Switch checked={draft.enabled} label="启用规则" disabled={saving} onChange={(next) => set({ enabled: next })} />
        <span>立即启用{rule === null ? "（保存后生效）" : ""}</span>
      </div>

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
