"use client";

/**
 * 「资产黑名单」子页签：全局资产拦截规则的真实列表 + 新建 / 编辑 / 启停 / 删除。
 * 数据走 @/v2/data/asset-intercept（GET /asset-intercept/rules；写操作 POST / PUT /
 * DELETE / POST …/toggle）。全局规则只拦截、不带 action，表单字段就是后端的
 * enabled / kind / pattern / note 四项。删除用 Modal 二次确认（额度照总表 §5.5）。
 *
 * 版式（D3 设计重塑）：页头与子页签由 InterceptRulesPage 经 `head` 插槽渲染；
 * 正文 = Section → Card + Row（开关 · 等宽匹配内容 · 类型/内置徽标 · 备注 · ⋯ 菜单），
 * 末尾虚线位新建；编辑弹窗内用 kit 的 Field / TextInput。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/assets/page.tsx:177-346
 * （列表列：类型 / 匹配内容 / 备注 / 启用 / 操作；Sheet 表单：匹配类型 / 匹配内容 / 备注 / 启用此规则；
 * :156 的删除确认；:78 的默认值 fuzzy_domain + enabled；:81-88 的前端轻校验）。
 * DSH 依据：DSH 无拦截配置，按设置分节子页签扩展（总表 §4.3）。
 * 对照表行：P3:I9 P3:I10 P2:J1 P2:J2 P2:J3 P2:J4 P2:J5
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconGlobeOutlineRegular, IconPlusOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import {
  AddSlot,
  AddSlots,
  Badge,
  Card,
  Empty,
  Field,
  type KitTone,
  Meta,
  Notice,
  Row,
  Section,
  Skeleton,
  TextInput,
} from "@/components/v2/design/Kit";
import type { AssetInterceptKind, AssetInterceptRule } from "@/lib/types";
import {
  createAssetInterceptRule,
  deleteAssetInterceptRule,
  toggleAssetInterceptRule,
  updateAssetInterceptRule,
  useAssetInterceptRules,
  type AssetInterceptRuleInput,
} from "@/v2/data/asset-intercept";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import { errorText, type InterceptHead, RefreshButton, RowMenu } from "./InterceptAdvanced";
import shared from "./SettingsDialog.module.css";
import own from "./InterceptRulesPage.module.css";

/** kind 的元信息，照旧页面 KIND_OPTIONS（assets/page.tsx:24-32）：标签与输入提示。 */
const KIND_OPTIONS: readonly {
  value: AssetInterceptKind;
  label: string;
  placeholder: string;
}[] = [
  { value: "exact_domain", label: "域名（全等）", placeholder: "example.gov.cn" },
  { value: "exact_ip", label: "IP（全等）", placeholder: "203.0.113.10" },
  { value: "exact_url", label: "URL（全等）", placeholder: "https://example.gov.cn/login" },
  { value: "fuzzy_domain", label: "域名（模糊）", placeholder: ".gov.cn" },
  { value: "fuzzy_ip", label: "IP（模糊）", placeholder: "203.0.113." },
  { value: "fuzzy_url", label: "URL（模糊）", placeholder: "/admin" },
  { value: "cidr", label: "CIDR 网段", placeholder: "192.168.0.0/16" },
];

const KIND_LABEL: Record<AssetInterceptKind, string> = {
  exact_domain: "域名（全等）",
  exact_ip: "IP（全等）",
  exact_url: "URL（全等）",
  fuzzy_domain: "域名（模糊）",
  fuzzy_ip: "IP（模糊）",
  fuzzy_url: "URL（模糊）",
  cidr: "CIDR 网段",
};

/** 下拉选项：值与 form.kind 同类型，供 SelectMenu 使用。 */
const KIND_SELECT_OPTIONS = KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

/** 新建表单的初始值，照旧页面 defaultForm（assets/page.tsx:78）。 */
const NEW_RULE_DRAFT: AssetInterceptRuleInput = { enabled: true, kind: "fuzzy_domain", pattern: "", note: "" };

/** kind 的徽标色：网段 / 模糊 / 全等各有区分。 */
function kindTone(kind: AssetInterceptKind): KitTone {
  if (kind === "cidr") return "info";
  if (kind.startsWith("fuzzy_")) return "warning";
  return "done";
}

/** 匹配内容的输入提示：CIDR / 模糊 / 全等三类，照旧页面 :305-311。 */
function patternHint(kind: AssetInterceptKind): string {
  if (kind === "cidr") return "CIDR 网段，形如 192.168.0.0/16";
  if (kind.startsWith("fuzzy_")) return "模糊匹配：目标包含此内容即命中";
  return "全等匹配：目标需与此内容完全一致";
}

/** 前端轻校验，照旧页面 frontValidate（assets/page.tsx:81-88）：只校验非空和 CIDR 形状。 */
function validate(input: AssetInterceptRuleInput): string | null {
  const pattern = input.pattern.trim();
  if (pattern === "") return "匹配内容不能为空";
  if (input.kind === "cidr" && !/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(pattern)) {
    return "CIDR 格式无效，形如 192.168.0.0/16";
  }
  return null;
}

function ruleToInput(rule: AssetInterceptRule): AssetInterceptRuleInput {
  return { enabled: rule.enabled, kind: rule.kind, pattern: rule.pattern, note: rule.note };
}

const ASSETS_LEAD = "命中的域名、IP、URL 或网段会被全局拦截，Agent 不会对其执行任何操作。";

/** 「资产黑名单」子页签正文：真实列表 + 新建 / 编辑 / 启停 / 删除。 */
export function AssetInterceptRules({ head }: { head: InterceptHead }): React.ReactNode {
  const rules = useAssetInterceptRules();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AssetInterceptRule | null>(null);
  const [deleting, setDeleting] = React.useState<AssetInterceptRule | null>(null);
  const actions = <RefreshButton onClick={rules.reload} spinning={rules.phase === "loading"} />;

  const openNew = (): void => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (rule: AssetInterceptRule): void => {
    setEditing(rule);
    setEditorOpen(true);
  };

  if (rules.phase === "loading") {
    return (
      <>
        {head({ lead: ASSETS_LEAD, actions })}
        <Card>
          <Skeleton label="读取资产拦截规则" />
        </Card>
      </>
    );
  }

  if (rules.phase === "offline") {
    return (
      <>
        {head({ lead: ASSETS_LEAD, actions })}
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={rules.reload}>重新读取</Button>}>
          未连接后端（读不到资产拦截规则）{rules.error === null ? "" : `：${rules.error}`}
        </Notice>
      </>
    );
  }

  const enabledCount = rules.rules.filter((rule) => rule.enabled).length;

  return (
    <>
      {head({ lead: ASSETS_LEAD, actions })}
      <Section
        title="黑名单"
        count={rules.rules.length === 0 ? undefined : `${enabledCount}/${rules.rules.length} 启用`}
        hint={rules.rules.length === 0 ? undefined : "支持全等、模糊匹配与 CIDR 网段"}
      >
        {rules.rules.length === 0 ? (
          <Card data={{ "data-asset-rules-empty": "" }}>
            <Empty
              inCard
              icon={<IconGlobeOutlineRegular size={18} />}
              title="暂无资产拦截规则"
              text="把不允许触碰的域名、IP 或网段加进来，所有任务都会绕开它们。"
              action={
                <Button variant="outline" size="sm" onClick={openNew}>
                  <IconPlusOutlineRegular size={13} /> 新建第一条规则
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <Card>
              {rules.rules.map((rule) => (
                <AssetRuleRow
                  key={rule.id}
                  rule={rule}
                  onEdit={() => openEdit(rule)}
                  onDelete={() => setDeleting(rule)}
                  onChanged={rules.reload}
                />
              ))}
            </Card>
            <AddSlots>
              <AddSlot data={{ "data-asset-rule-new": "" }} onClick={openNew}>
                <IconPlusOutlineRegular size={13} /> 新建规则
              </AddSlot>
            </AddSlots>
          </>
        )}
      </Section>

      <AssetRuleEditor
        open={editorOpen}
        rule={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          rules.reload();
        }}
      />

      <AssetRuleDeleteDialog
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

/** 列表行：开关 · 匹配内容（等宽）· 类型徽标 · 备注 · ⋯ 菜单。 */
function AssetRuleRow({
  rule,
  onEdit,
  onDelete,
  onChanged,
}: {
  rule: AssetInterceptRule;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggle = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void toggleAssetInterceptRule(rule.id, next)
      .then(() => {
        toast(next ? "规则已启用" : "规则已停用");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      data={{ "data-asset-rule-id": String(rule.id), "data-asset-rule-enabled": String(rule.enabled) }}
      lead={<Switch checked={rule.enabled} disabled={busy} label={`启用资产拦截规则 ${rule.pattern}`} onChange={toggle} />}
      label={
        <span className={`${own.pattern} ${own.patternLabel} ${rule.enabled ? "" : own.labelOff}`} title={rule.pattern}>
          {rule.pattern}
        </span>
      }
      labelAdornment={
        <>
          <Badge tone={rule.enabled ? kindTone(rule.kind) : "neutral"}>{KIND_LABEL[rule.kind] ?? rule.kind}</Badge>
          {rule.builtin ? <Badge>内置</Badge> : null}
        </>
      }
      description={
        <>
          <Meta
            items={[
              rule.note.trim() === "" ? "无备注" : (
                <span key="note" className={`${own.metaClip} ${own.metaClipWide}`} title={rule.note}>
                  {rule.note}
                </span>
              ),
              rule.enabled ? null : "已停用",
            ]}
          />
          {failure === null ? null : <span className={own.rowError}>操作失败：{failure}</span>}
        </>
      }
    >
      <RowMenu
        label={`资产规则 ${rule.pattern} 的更多操作`}
        disabled={busy}
        data={{ "data-asset-rule-more": String(rule.id) }}
        items={[
          { label: "编辑", onSelect: onEdit, data: { "data-asset-rule-edit": String(rule.id) } },
          { label: "删除", onSelect: onDelete, danger: true, separatorBefore: true, data: { "data-asset-rule-delete": String(rule.id) } },
        ]}
      />
    </Row>
  );
}

/** 新建 / 编辑表单（Modal）：匹配类型、匹配内容、备注、启用此规则。 */
function AssetRuleEditor({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: AssetInterceptRule | null;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [draft, setDraft] = React.useState<AssetInterceptRuleInput>(NEW_RULE_DRAFT);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // 打开对话框时用当前行（或新建默认值）重置草稿，关闭后不保留上次的编辑。
  React.useEffect(() => {
    if (!open) return;
    setDraft(rule === null ? NEW_RULE_DRAFT : ruleToInput(rule));
    setFailure(null);
  }, [open, rule]);

  const patch = (next: Partial<AssetInterceptRuleInput>): void => setDraft((prev) => ({ ...prev, ...next }));

  const placeholder = KIND_OPTIONS.find((option) => option.value === draft.kind)?.placeholder ?? "";

  const save = (): void => {
    const invalid = validate(draft);
    if (invalid !== null) {
      setFailure(invalid);
      return;
    }
    setSaving(true);
    setFailure(null);
    const input: AssetInterceptRuleInput = { ...draft, pattern: draft.pattern.trim(), note: draft.note };
    const write = rule === null ? createAssetInterceptRule(input) : updateAssetInterceptRule(rule.id, input);
    void write
      .then(() => {
        toast(rule === null ? "资产拦截规则已创建" : "资产拦截规则已更新");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule === null ? "新建资产拦截规则" : "编辑资产拦截规则"}
      closeLabel="关闭"
      className={own.modal}
      contentClassName={own.modalContent}
      description="命中此规则的目标资产会被全局拦截"
      footer={
        <>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={save} data-modal-autofocus="">
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className={own.form}>
        <Field label="匹配类型" htmlFor={`${uid}-kind`}>
          <SelectMenu
            id={`${uid}-kind`}
            value={draft.kind}
            options={KIND_SELECT_OPTIONS}
            disabled={saving}
            ariaLabel="匹配类型"
            onChange={(value) => {
              const found = KIND_OPTIONS.find((option) => option.value === value);
              if (found !== undefined) patch({ kind: found.value });
            }}
          />
        </Field>
        <Field label="匹配内容" htmlFor={`${uid}-pattern`} hint={patternHint(draft.kind)}>
          <TextInput
            id={`${uid}-pattern`}
            mono
            aria-label="匹配内容"
            placeholder={placeholder}
            value={draft.pattern}
            disabled={saving}
            onChange={(event) => patch({ pattern: event.currentTarget.value })}
          />
        </Field>
        <Field label="备注" htmlFor={`${uid}-note`} optional>
          <textarea
            id={`${uid}-note`}
            className={own.textArea}
            aria-label="规则备注"
            rows={2}
            placeholder="说明这条规则的用途"
            value={draft.note}
            disabled={saving}
            onChange={(event) => patch({ note: event.currentTarget.value })}
          />
        </Field>
        <div className={shared.optionCard}>
          <Row label="启用此规则" description={rule === null ? "保存后生效。" : "关闭则保留规则但不拦截。"}>
            <Switch checked={draft.enabled} disabled={saving} label="启用此规则" onChange={(next) => patch({ enabled: next })} />
          </Row>
        </div>
        {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      </div>
    </Modal>
  );
}

/** 删除二次确认：Modal + tone="warning"，忙碌时两个按钮都禁用（总表 §5.5）。 */
function AssetRuleDeleteDialog({
  rule,
  onClose,
  onDeleted,
}: {
  rule: AssetInterceptRule | null;
  onClose: () => void;
  onDeleted: () => void;
}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (rule !== null) return;
    setFailure(null);
  }, [rule]);

  const confirm = (): void => {
    if (rule === null || busy) return;
    setBusy(true);
    setFailure(null);
    void deleteAssetInterceptRule(rule.id)
      .then(() => {
        toast("资产拦截规则已删除");
        onDeleted();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={rule !== null}
      onClose={onClose}
      title="确认删除"
      closeLabel="关闭"
      tone="warning"
      description={
        rule === null
          ? "将永久删除这条资产拦截规则，此操作不可撤销。"
          : `将永久删除资产拦截规则「${rule.pattern}」，此操作不可撤销；命中该目标的拦截随即失效。`
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={confirm} disabled={busy} data-asset-rule-delete-confirm="">
            {busy ? "删除中…" : "确认删除"}
          </Button>
        </>
      }
    >
      {rule === null ? null : (
        <div className={own.dialogStack}>
          <div className={own.target}>
            <Badge tone={kindTone(rule.kind)}>{KIND_LABEL[rule.kind] ?? rule.kind}</Badge>
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
