"use client";

/**
 * 拦截高级配置：「工具范围」与「模型审批」两个子页签的正文，外加本节三个文件共用的
 * 小件（页头插槽类型、行尾 ⋯ 菜单、错误文本）。
 * 工具范围 = GET /tools 的工具目录 + GET /intercept/tool-config 的 enabled_tools，
 * 勾选后「保存」才 PUT /intercept/tool-config；模型审批 = GET/PUT /intercept/judge
 * （判定模型 / 策略 / 人工审批超时 / 审批提示词）与 GET /intercept/judge/usage?days=30
 * 的近 30 天 token 统计。未改动时保存按钮禁用，改动了不保存不写后端。
 *
 * 版式（D3 设计重塑）：页头与子页签由 InterceptRulesPage 提供（经 `head` 插槽渲染），
 * 正文是 kit 的 Section → Card → Row；保存栏粘在设置面板底部，有改动才可点。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/page.tsx:208-276（模型兜底卡片与保存 /
 * 恢复默认模板）、:278-356（启用开关、用量统计、提示词编辑器）、:360-424（判定模型与策略）、
 * :462-469 与 :565-599（工具范围读取 / 勾选 / 保存）、:601、:130-143（工具分组）、
 * :926-982（拦截范围勾选弹窗）、:65-100（fmtTokens 与统计块）。
 * 对照表行：P3:I6 P3:I7 P3:I8
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Menu, MenuItemButton } from "@/vendor/dsh/primitives/Menu";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconEllipsisOutlineRegular, IconRefreshOutlineRegular, IconSettingsOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import {
  Badge,
  Card,
  Dot,
  Empty,
  IconButton,
  kit,
  Metrics,
  Notice,
  Row,
  Section,
  Skeleton,
  UnitInput,
} from "@/components/v2/design/Kit";
import type { JudgeConfig, JudgeUsage, Tool } from "@/lib/types";
import {
  formatTokens,
  judgeProfileOptions,
  restoreJudgePromptTemplate,
  saveJudgeConfig,
  saveToolScope,
  useJudgeConfig,
  useJudgeUsage,
  useToolScope,
  type ToolScopeGroup,
} from "@/v2/data/intercept-config";
import { useLlmProfiles } from "@/v2/data/llm-profiles";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import shared from "./SettingsDialog.module.css";
import own from "./InterceptRulesPage.module.css";

/* ---------------- 本节共用小件 ---------------- */

/** 页头插槽：子页签把自己的说明与右侧动作交给外层页头渲染（页头下方是子页签条）。 */
export type InterceptHead = (props: { lead: React.ReactNode; actions?: React.ReactNode }) => React.ReactNode;

/** 把任意异常转成一句文本。 */
export function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export interface RowMenuItem {
  label: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
  /** 验收钩子，如 `{ "data-rule-edit": "" }`。 */
  data?: Record<`data-${string}`, string>;
}

/**
 * 行尾 ⋯ 菜单：次要动作收进这里，行面只保留开关与关键信息。
 * @param props.label - 触发按钮的无障碍名称。
 * @param props.items - 菜单项（危险项放最后并加分隔）。
 * @returns 锚定在行尾的菜单。
 */
export function RowMenu({
  label,
  items,
  disabled = false,
  data,
}: {
  label: string;
  items: readonly RowMenuItem[];
  disabled?: boolean;
  data?: Record<`data-${string}`, string>;
}): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      portal
      anchor={
        <IconButton
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          {...data}
        >
          <IconEllipsisOutlineRegular size={15} />
        </IconButton>
      }
    >
      {items.map((item, index) => (
        <MenuItemButton
          key={index}
          danger={item.danger}
          separatorBefore={item.separatorBefore}
          onSelect={() => {
            setOpen(false);
            item.onSelect();
          }}
          {...item.data}
        >
          {item.label}
        </MenuItemButton>
      ))}
    </Menu>
  );
}

/** 刷新图标按钮（页头 / 节头共用）。 */
export function RefreshButton({ onClick, label = "刷新", spinning = false }: { onClick: () => void; label?: string; spinning?: boolean }): React.ReactNode {
  return (
    <IconButton label={label} spinning={spinning} onClick={onClick}>
      <IconRefreshOutlineRegular size={14} />
    </IconButton>
  );
}

/** 受控数字输入：只在得到正整数时回写（与旧表单一致：清空或 0 不改草稿）。 */
function PositiveNumber({ value, min, label, disabled, onChange }: { value: number; min: number; label: string; disabled: boolean; onChange: (next: number) => void }): React.ReactNode {
  return (
    <input
      className={`${kit.input} ${shared.numberInputKit}`}
      type="number"
      min={min}
      aria-label={label}
      value={String(value)}
      disabled={disabled}
      onChange={(event) => {
        const next = Number.parseInt(event.currentTarget.value, 10);
        if (Number.isFinite(next) && next > 0) onChange(next);
      }}
    />
  );
}

/** 粘底保存栏：左侧状态，右侧次 / 主动作。 */
function SaveBar({ dirty, note, children }: { dirty: boolean; note: React.ReactNode; children: React.ReactNode }): React.ReactNode {
  return (
    <div className={own.saveBar} data-intercept-savebar={dirty ? "dirty" : "clean"}>
      <span className={own.saveBarNote}>
        {dirty ? <Dot tone="warning" /> : null}
        {dirty ? "有未保存的改动" : note}
      </span>
      {children}
    </div>
  );
}

/* ---------------- 工具范围 ---------------- */

const TOOLS_LEAD = "只有勾选的工具会进入拦截规则匹配与模型兜底判定，其余工具直接放行。";

/**
 * 工具范围子页签（P3:I6）。
 * @param props.head - 外层页头插槽。
 * @returns 加载 / 错误 / 空 / 有数据四态齐备的工具勾选清单 + 保存。
 */
export function ToolScopePane({ head }: { head: InterceptHead }): React.ReactNode {
  const scope = useToolScope();
  const actions = <RefreshButton onClick={scope.reload} spinning={scope.phase === "loading"} />;

  if (scope.phase === "loading") {
    return (
      <>
        {head({ lead: TOOLS_LEAD, actions })}
        <Card>
          <Skeleton label="读取工具目录与拦截范围" />
        </Card>
      </>
    );
  }
  if (scope.phase === "offline") {
    return (
      <>
        {head({ lead: TOOLS_LEAD, actions })}
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={scope.reload}>重试</Button>}>
          读取失败：{scope.error}
        </Notice>
      </>
    );
  }

  return <ToolScopeEditor scope={scope} head={head} actions={actions} />;
}

/** 工具勾选与保存：scope 已就绪，这里只管理草稿与保存状态。 */
function ToolScopeEditor({ scope, head, actions }: { scope: ReturnType<typeof useToolScope>; head: InterceptHead; actions: React.ReactNode }): React.ReactNode {
  const [selected, setSelected] = React.useState<string[]>(scope.enabledTools);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // 重新读取（或保存后回读）把后端值换成新的对象时，草稿跟着重置。
  const savedKey = scope.enabledTools.join("\n");
  React.useEffect(() => {
    setSelected(scope.enabledTools);
    // enabledTools 是每次请求新建的数组，用拼接后的字符串做稳定依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const dirty =
    selected.length !== scope.enabledTools.length ||
    selected.some((key) => !scope.enabledTools.includes(key));

  const toggle = (key: string, next: boolean): void => {
    setSelected((prev) => (next ? [...prev, key] : prev.filter((item) => item !== key)));
  };

  const save = (): void => {
    setSaving(true);
    setFailure(null);
    void saveToolScope(selected)
      .then(() => {
        toast("拦截范围已保存");
        scope.reload();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  const reset = (): void => {
    setSelected(scope.enabledTools);
    setFailure(null);
  };

  const total = scope.groups.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <>
      {head({ lead: TOOLS_LEAD, actions })}
      {selected.length === 0 && total > 0 ? (
        <Notice tone="warning">当前未启用任何工具：拦截规则与模型兜底都不会生效。</Notice>
      ) : null}

      {total === 0 ? (
        <Card>
          <Empty inCard icon={<IconSettingsOutlineRegular size={18} />} title="工具目录为空" text="GET /tools 没有返回任何工具。" />
        </Card>
      ) : (
        scope.groups.map((group) => (
          <ToolScopeGroupBlock key={group.key} group={group} selected={selectedSet} disabled={saving} onToggle={toggle} />
        ))
      )}

      {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}
      {total === 0 ? null : (
        <SaveBar dirty={dirty} note={`已勾选 ${selected.length} / ${total} 个工具`}>
          <Button variant="ghost" size="sm" disabled={saving || !dirty} onClick={reset}>
            撤销改动
          </Button>
          <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={save}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </SaveBar>
      )}
    </>
  );
}

/** 一个工具分组：节标题 + 卡内每行的复选框、key、类型标签与一行描述。 */
function ToolScopeGroupBlock({
  group,
  selected,
  disabled,
  onToggle,
}: {
  group: ToolScopeGroup;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (key: string, next: boolean) => void;
}): React.ReactNode {
  const on = group.tools.filter((tool) => selected.has(tool.key)).length;
  return (
    <Section title={group.label} count={`${on}/${group.tools.length}`} data={{ "data-tool-group": group.key }}>
      <Card>
        {group.tools.map((tool: Tool) => (
          <Row
            key={tool.key}
            data={{ "data-tool-key": tool.key }}
            lead={
              <Checkbox
                checked={selected.has(tool.key)}
                disabled={disabled}
                label={`拦截工具 ${tool.key}`}
                onChange={(next) => onToggle(tool.key, next)}
              />
            }
            label={<span className={`${kit.mono} ${selected.has(tool.key) ? "" : own.labelOff}`}>{tool.key}</span>}
            labelAdornment={
              <>
                {tool.system === true ? <Badge>内置</Badge> : <Badge tone="info">{tool.kind ?? "custom"}</Badge>}
                {tool.enabled ? null : <Badge tone="warning">目录已停用</Badge>}
              </>
            }
            description={
              tool.description.trim() === "" ? undefined : (
                <span className={own.clamp} title={tool.description}>
                  {tool.description}
                </span>
              )
            }
          />
        ))}
      </Card>
    </Section>
  );
}

/* ---------------- 模型审批 ---------------- */

/** 判定模型失败（出错 / 超时 / 无法解析）时的回退动作，照旧页面 :389-398。 */
const FAIL_ACTION_OPTIONS = [
  { value: "allow", label: "放行" },
  { value: "ask", label: "转人工审批" },
  { value: "deny", label: "拦截" },
] as const;

/** 人工审批超时后的默认动作，照旧页面 :416-422。 */
const ASK_TIMEOUT_ACTION_OPTIONS = [
  { value: "deny", label: "拦截" },
  { value: "allow", label: "放行" },
] as const;

const JUDGE_LEAD = "在拦截范围内、且没有任何拦截规则命中的工具调用，才交给模型做语义判断：放行、转人工或拦截。";

/**
 * 模型审批子页签（P3:I7 + P3:I8）。
 * @param props.head - 外层页头插槽。
 * @returns 加载 / 错误 / 有数据三态，附近 30 天审批 token 统计。
 */
export function JudgePane({ head }: { head: InterceptHead }): React.ReactNode {
  const judge = useJudgeConfig();
  const actions = <RefreshButton onClick={judge.reload} spinning={judge.phase === "loading"} />;

  if (judge.phase === "loading") {
    return (
      <>
        {head({ lead: JUDGE_LEAD, actions })}
        <Card>
          <Skeleton label="读取模型兜底审批配置" />
        </Card>
      </>
    );
  }
  if (judge.phase === "offline" || judge.config === null) {
    return (
      <>
        {head({ lead: JUDGE_LEAD, actions })}
        <Notice tone="danger" action={<Button variant="ghost" size="sm" onClick={judge.reload}>重试</Button>}>
          读取失败：{judge.error}
        </Notice>
      </>
    );
  }
  return (
    <>
      {head({
        lead: JUDGE_LEAD,
        actions,
      })}
      <JudgeEditor config={judge.config} onSaved={judge.reload} />
    </>
  );
}

/** 配置表单：草稿由后端值初始化，只有「保存」才写后端。 */
function JudgeEditor({ config, onSaved }: { config: JudgeConfig; onSaved: () => void }): React.ReactNode {
  const [draft, setDraft] = React.useState<JudgeConfig>(config);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const profiles = useLlmProfiles();

  // 保存后回读（或恢复默认模板）拿到新对象时，草稿同步成后端值。
  React.useEffect(() => {
    setDraft(config);
  }, [config]);

  const patch = (next: Partial<JudgeConfig>): void => setDraft((prev) => ({ ...prev, ...next }));

  const dirty =
    draft.enabled !== config.enabled ||
    draft.profile_id !== config.profile_id ||
    draft.prompt !== config.prompt ||
    draft.timeout_seconds !== config.timeout_seconds ||
    draft.fail_action !== config.fail_action ||
    draft.ask_timeout_seconds !== config.ask_timeout_seconds ||
    draft.ask_timeout_action !== config.ask_timeout_action;

  const save = (): void => {
    setSaving(true);
    setFailure(null);
    void saveJudgeConfig(draft)
      .then(() => {
        toast("模型兜底审批配置已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  const restorePrompt = (): void => {
    setSaving(true);
    setFailure(null);
    void restoreJudgePromptTemplate(draft)
      .then((next) => {
        setDraft(next);
        toast("已恢复内置默认模板");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  const profileOptions = React.useMemo(
    () => judgeProfileOptions(profiles.phase === "ready" ? profiles.profiles : []),
    [profiles.phase, profiles.profiles],
  );

  return (
    <>
      <Section title="模型兜底">
        <Card>
          <Row
            label="启用模型兜底审批"
            labelAdornment={draft.enabled ? <Badge tone="success">已启用</Badge> : <Badge>未启用</Badge>}
            description="关闭时，未命中规则的调用直接放行。"
          >
            <Switch checked={draft.enabled} disabled={saving} label="启用模型兜底审批" onChange={(next) => patch({ enabled: next })} />
          </Row>
          <Row label="审批模型" description="跟随激活配置，或指定一个模型配置专做审批。">
            <span className={own.selectBox}>
              <SelectMenu
                value={String(draft.profile_id)}
                options={profileOptions}
                disabled={saving}
                ariaLabel="审批模型"
                onChange={(value) => patch({ profile_id: Number.parseInt(value, 10) || 0 })}
              />
            </span>
          </Row>
          <Row label="模型判定超时" description="单次判定的最长等待。">
            <span className={own.unitBox}>
              <UnitInput unit="秒">
                <PositiveNumber value={draft.timeout_seconds} min={1} label="模型判定超时秒" disabled={saving} onChange={(next) => patch({ timeout_seconds: next })} />
              </UnitInput>
            </span>
          </Row>
          <Row label="模型失败时" description="出错、超时或无法解析判定结果时的回退动作。">
            <span className={own.selectBox}>
              <SelectMenu
                value={draft.fail_action}
                options={FAIL_ACTION_OPTIONS}
                disabled={saving}
                ariaLabel="模型失败时的动作"
                onChange={(value) => patch({ fail_action: value === "allow" ? "allow" : value === "ask" ? "ask" : "deny" })}
              />
            </span>
          </Row>
        </Card>
        {profiles.phase === "offline" ? (
          <Notice
            tone="warning"
            action={
              <Button variant="ghost" size="sm" disabled={saving} onClick={profiles.reload}>
                重新读取
              </Button>
            }
          >
            读不到 LLM 配置列表：{profiles.error}。下拉只显示「跟随激活配置」。
          </Notice>
        ) : null}
      </Section>

      <Section title="人工审批" hint="模型判为「转人工」时生效">
        <Card>
          <Row label="审批等待超时" description="等待人工处理的最长时间。">
            <span className={own.unitBox}>
              <UnitInput unit="秒">
                <PositiveNumber value={draft.ask_timeout_seconds} min={5} label="人工审批等待超时秒" disabled={saving} onChange={(next) => patch({ ask_timeout_seconds: next })} />
              </UnitInput>
            </span>
          </Row>
          <Row label="超时后默认动作" description="无人处理时自动执行。">
            <span className={own.selectBox}>
              <SelectMenu
                value={draft.ask_timeout_action}
                options={ASK_TIMEOUT_ACTION_OPTIONS}
                disabled={saving}
                ariaLabel="人工审批超时后的动作"
                onChange={(value) => patch({ ask_timeout_action: value === "allow" ? "allow" : "deny" })}
              />
            </span>
          </Row>
        </Card>
      </Section>

      <Section
        title="审批提示词"
        hint="留空保存即恢复内置模板"
        actions={
          <>
            <span className={own.promptMeta}>{draft.prompt.length} 字</span>
            <Button variant="ghost" size="sm" disabled={saving} onClick={restorePrompt}>
              恢复默认模板
            </Button>
          </>
        }
      >
        <textarea
          className={`${own.textArea} ${own.prompt}`}
          aria-label="审批提示词"
          spellCheck={false}
          value={draft.prompt}
          disabled={saving}
          onChange={(event) => patch({ prompt: event.currentTarget.value })}
        />
      </Section>

      {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}
      <SaveBar dirty={dirty} note="配置与后端一致">
        <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </SaveBar>

      <JudgeUsageSection />
    </>
  );
}

/** 近 30 天 judge 通道 token 统计（P3:I8）：GET /intercept/judge/usage?days=30。 */
function JudgeUsageSection(): React.ReactNode {
  const usage = useJudgeUsage(30);
  const data: JudgeUsage | null = usage.usage;

  return (
    <Section
      title="近 30 天用量"
      hint="单独计量（worker=judge），不计入各模型配置"
      actions={<RefreshButton onClick={usage.reload} spinning={usage.phase === "loading"} />}
      data={{ "data-judge-usage": usage.phase }}
    >
      {usage.phase === "loading" && data === null ? (
        <Card>
          <Skeleton label="读取审批用量" />
        </Card>
      ) : null}
      {usage.phase === "offline" ? <Notice tone="danger">读取失败：{usage.error}</Notice> : null}
      {usage.phase === "ready" && data !== null ? (
        <>
          <Metrics
            items={[
              { label: "审批调用", value: data.calls.toLocaleString("zh-CN"), muted: data.calls === 0 },
              { label: "输入 Token", value: formatTokens(data.input_tokens), muted: data.input_tokens === 0 },
              { label: "输出 Token", value: formatTokens(data.output_tokens), muted: data.output_tokens === 0 },
              { label: "缓存读", value: formatTokens(data.cache_read_tokens), muted: data.cache_read_tokens === 0 },
              { label: "缓存写", value: formatTokens(data.cache_write_tokens), muted: data.cache_write_tokens === 0 },
            ]}
          />
          {data.daily.length === 0 ? (
            <Card>
              <Empty inCard title="近 30 天没有审批调用" text="模型兜底审批被触发后，这里按天列出调用次数与 token。" />
            </Card>
          ) : (
            <DailyUsageTable daily={data.daily} />
          )}
        </>
      ) : null}
    </Section>
  );
}

/** 每日消耗明细：日期、调用次数、输入、输出 token（照旧页面 :323-330 的日序列）。 */
function DailyUsageTable({ daily }: { daily: JudgeUsage["daily"] }): React.ReactNode {
  return (
    <Card>
      <div className={kit.tableWrap}>
        <table className={kit.table} aria-label="近 30 天每日审批消耗">
          <thead>
            <tr>
              <th>日期</th>
              <th>调用</th>
              <th>输入</th>
              <th>输出</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.calls} 次</td>
                <td>{formatTokens(day.input_tokens)}</td>
                <td>{formatTokens(day.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
