"use client";

/**
 * 拦截高级配置：「工具范围」与「模型审批」两个子页签的正文。
 * 工具范围 = GET /tools 的工具目录 + GET /intercept/tool-config 的 enabled_tools，
 * 勾选后「保存」才 PUT /intercept/tool-config；模型审批 = GET/PUT /intercept/judge
 * （判定模型 / 策略 / 人工审批超时 / 审批提示词）与 GET /intercept/judge/usage?days=30
 * 的近 30 天 token 统计。未改动时保存按钮禁用，改动了不保存不写后端。
 *
 * 旧页面依据：ARTEX/web/src/app/(main)/system/intercept/page.tsx:208-276（模型兜底卡片与保存 /
 * 恢复默认模板）、:278-356（启用开关、用量统计、提示词编辑器）、:360-424（判定模型与策略）、
 * :462-469 与 :565-599（工具范围读取 / 勾选 / 保存）、:601、:130-143（工具分组）、
 * :926-982（拦截范围勾选弹窗）、:65-100（fmtTokens 与统计块）。
 * DSH 依据：DSH 无拦截配置，按设置分节子页签扩展（总表 §4.3）；
 * 子页签样式复用 SettingsDialog.module.css 的 agentTabs / agentTab / agentTabActive
 * （同 AgentEditor.tsx:832-845 的写法）。
 * 对照表行：P3:I6 P3:I7 P3:I8
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconRefreshOutlineRegular, IconShieldOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

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
import css from "./SettingsDialog.module.css";

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

/** 统计卡片：标签 + 数值，照旧页面 intercept/page.tsx:72-79 JudgeStat。 */
function JudgeStat({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className={css.checkRow}>
      <div className={css.ruleMain}>
        <span className={css.rowHint}>{label}</span>
        <span className={css.rowLabel}>{value}</span>
      </div>
    </div>
  );
}

/**
 * 工具范围子页签（P3:I6）。
 * @returns 加载 / 错误 / 空 / 有数据四态齐备的工具勾选清单 + 保存。
 */
export function ToolScopePane(): React.ReactNode {
  const scope = useToolScope();

  if (scope.phase === "loading") return <p className={css.pageLead}>读取工具目录与拦截范围…</p>;
  if (scope.phase === "offline") {
    return (
      <>
        <p className={css.pageLead} role="alert">
          读取失败：{scope.error}
        </p>
        <Button variant="outline" size="sm" onClick={scope.reload}>
          <IconRefreshOutlineRegular size={13} /> 重试
        </Button>
      </>
    );
  }

  return <ToolScopeEditor scope={scope} />;
}

/** 工具勾选与保存：scope 已就绪，这里只管理草稿与保存状态。 */
function ToolScopeEditor({ scope }: { scope: ReturnType<typeof useToolScope> }): React.ReactNode {
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  const reset = (): void => {
    setSelected(scope.enabledTools);
    setFailure(null);
  };

  const total = scope.groups.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <>
      <p className={css.pageLead}>
        只有勾选的工具会进入拦截规则匹配与模型兜底判定，其余工具直接放行。目录来自 GET /tools，已勾选 {selected.length} 个。
      </p>
      {selected.length === 0 ? (
        <p className={css.warn}>当前未启用任何工具：拦截规则与模型兜底都不会生效。</p>
      ) : null}

      {total === 0 ? (
        <p className={css.pageLead}>工具目录为空（GET /tools 没有返回任何工具）。</p>
      ) : (
        scope.groups.map((group) => (
          <ToolScopeGroupBlock
            key={group.key}
            group={group}
            selected={selectedSet}
            disabled={saving}
            onToggle={toggle}
          />
        ))
      )}

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving || !dirty} onClick={reset}>
          撤销改动
        </Button>
        <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </>
  );
}

/** 一个工具分组：标题 + 每行的 Checkbox、key、描述、类型标签。 */
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
  return (
    <div className={css.subSection} data-tool-group={group.key}>
      <div className={css.subSectionTitle}>
        {group.label}（{group.tools.length}）
      </div>
      <div className={css.ruleList}>
        {group.tools.map((tool: Tool) => (
          <div key={tool.key} className={css.ruleRow} data-tool-key={tool.key}>
            <Checkbox
              checked={selected.has(tool.key)}
              disabled={disabled}
              label={`拦截工具 ${tool.key}`}
              onChange={(next) => onToggle(tool.key, next)}
            />
            <div className={css.ruleMain}>
              <div className={css.ruleMeta}>
                <span className={css.rowLabel}>{tool.key}</span>
                {tool.system === true ? <Tag tone="neutral">内置</Tag> : <Tag tone="info">{tool.kind ?? "custom"}</Tag>}
                {tool.enabled ? null : <Tag tone="quiet">目录已停用</Tag>}
              </div>
              {tool.description.trim() === "" ? null : <div className={css.ruleMeta}>{tool.description}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 模型审批子页签（P3:I7 + P3:I8）。
 * @returns 加载 / 错误 / 有数据三态，附近 30 天审批 token 统计。
 */
export function JudgePane(): React.ReactNode {
  const judge = useJudgeConfig();

  if (judge.phase === "loading") return <p className={css.pageLead}>读取模型兜底审批配置…</p>;
  if (judge.phase === "offline" || judge.config === null) {
    return (
      <>
        <p className={css.pageLead} role="alert">
          读取失败：{judge.error}
        </p>
        <Button variant="outline" size="sm" onClick={judge.reload}>
          <IconRefreshOutlineRegular size={13} /> 重试
        </Button>
      </>
    );
  }
  return <JudgeEditor config={judge.config} onSaved={judge.reload} />;
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  const profileOptions = React.useMemo(
    () => judgeProfileOptions(profiles.phase === "ready" ? profiles.profiles : []),
    [profiles.phase, profiles.profiles],
  );

  return (
    <>
      <div className={css.formCard}>
        <div className={css.ruleMeta}>
          <IconShieldOutlineRegular size={14} />
          <span className={css.rowLabel}>模型兜底审批</span>
          <Tag tone={draft.enabled ? "success" : "quiet"}>{draft.enabled ? "已启用" : "未启用"}</Tag>
        </div>
        <p className={css.fieldHint}>
          在拦截范围内、且没有任何拦截规则命中的工具调用，才由模型做语义判断（放行 / 转人工 / 拦截）。
        </p>
        <div className={css.checkInline} style={{ marginTop: 10 }}>
          <Switch
            checked={draft.enabled}
            disabled={saving}
            label="启用模型兜底审批"
            onChange={(next) => patch({ enabled: next })}
          />
          <span>{draft.enabled ? "已启用" : "未启用"}</span>
        </div>
      </div>

      <div className={css.formRow}>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>审批模型</div>
          <SelectMenu
            value={String(draft.profile_id)}
            options={profileOptions}
            disabled={saving}
            ariaLabel="审批模型"
            onChange={(value) => patch({ profile_id: Number.parseInt(value, 10) || 0 })}
          />
        </div>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>模型判定超时（秒）</div>
          <Input
            type="number"
            min={1}
            aria-label="模型判定超时秒"
            value={String(draft.timeout_seconds)}
            disabled={saving}
            onChange={(event) => {
              const next = Number.parseInt(event.currentTarget.value, 10);
              if (Number.isFinite(next) && next > 0) patch({ timeout_seconds: next });
            }}
          />
        </div>
        <div className={css.fieldBlock}>
          <div className={css.fieldLabel}>模型失败时（出错 / 超时 / 无法解析）</div>
          <SelectMenu
            value={draft.fail_action}
            options={FAIL_ACTION_OPTIONS}
            disabled={saving}
            ariaLabel="模型失败时的动作"
            onChange={(value) =>
              patch({ fail_action: value === "allow" ? "allow" : value === "ask" ? "ask" : "deny" })
            }
          />
        </div>
      </div>
      {profiles.phase === "offline" ? (
        <p className={css.warn}>
          读不到 LLM 配置列表：{profiles.error}。下拉只显示「跟随激活配置」，可点「重新读取」重试。
        </p>
      ) : null}
      {profiles.phase === "offline" ? (
        <Button variant="outline" size="sm" disabled={saving} onClick={profiles.reload}>
          <IconRefreshOutlineRegular size={13} /> 重新读取 LLM 配置
        </Button>
      ) : null}

      <div className={css.subSection}>
        <div className={css.subSectionTitle}>人工审批（模型判为「转人工」时）</div>
        <div className={css.formRow}>
          <div className={css.fieldBlock}>
            <div className={css.fieldLabel}>审批等待超时（秒）</div>
            <Input
              type="number"
              min={5}
              aria-label="人工审批等待超时秒"
              value={String(draft.ask_timeout_seconds)}
              disabled={saving}
              onChange={(event) => {
                const next = Number.parseInt(event.currentTarget.value, 10);
                if (Number.isFinite(next) && next > 0) patch({ ask_timeout_seconds: next });
              }}
            />
          </div>
          <div className={css.fieldBlock}>
            <div className={css.fieldLabel}>超时后默认动作</div>
            <SelectMenu
              value={draft.ask_timeout_action}
              options={ASK_TIMEOUT_ACTION_OPTIONS}
              disabled={saving}
              ariaLabel="人工审批超时后的动作"
              onChange={(value) => patch({ ask_timeout_action: value === "allow" ? "allow" : "deny" })}
            />
          </div>
        </div>
      </div>

      <div className={css.fieldLabel}>审批提示词（留空保存即恢复内置模板）</div>
      <div className={css.pageToolbar}>
        <Button variant="ghost" size="sm" disabled={saving} onClick={restorePrompt}>
          恢复默认模板
        </Button>
        <span className={css.rowHint}>{draft.prompt.length} 字</span>
      </div>
      <textarea
        className={css.promptArea}
        aria-label="审批提示词"
        spellCheck={false}
        value={draft.prompt}
        disabled={saving}
        onChange={(event) => patch({ prompt: event.currentTarget.value })}
      />

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>

      <JudgeUsageSection />
    </>
  );
}

/** 近 30 天 judge 通道 token 统计（P3:I8）：GET /intercept/judge/usage?days=30。 */
function JudgeUsageSection(): React.ReactNode {
  const usage = useJudgeUsage(30);
  const data: JudgeUsage | null = usage.usage;

  return (
    <div className={css.subSection} data-judge-usage={usage.phase}>
      <div className={css.subSectionTitle}>近 30 天审批 token 统计</div>
      <p className={css.fieldHint}>
        模型兜底审批的累计用量，单独计量（worker=judge），不与各模型配置的统计混在一起。
      </p>
      {usage.phase === "loading" ? <p className={css.pageLead}>读取中…</p> : null}
      <div className={css.pageToolbar}>
        <Button variant="ghost" size="sm" disabled={usage.phase === "loading"} onClick={usage.reload}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>
      {usage.phase === "offline" ? (
        <p className={css.errorLine} role="alert">
          读取失败：{usage.error}
        </p>
      ) : null}
      {usage.phase === "ready" && data !== null ? (
        <>
          <div className={css.formRow}>
            <JudgeStat label="审批调用" value={data.calls.toLocaleString("zh-CN")} />
            <JudgeStat label="输入 Token" value={formatTokens(data.input_tokens)} />
            <JudgeStat label="输出 Token" value={formatTokens(data.output_tokens)} />
            <JudgeStat label="缓存读" value={formatTokens(data.cache_read_tokens)} />
            <JudgeStat label="缓存写" value={formatTokens(data.cache_write_tokens)} />
          </div>
          {data.daily.length === 0 ? (
            <p className={css.pageLead}>近 30 天没有审批调用记录。</p>
          ) : (
            <DailyUsageList daily={data.daily} />
          )}
        </>
      ) : null}
    </div>
  );
}

/** 每日消耗明细：日期、调用次数、输入 + 输出 token（照旧页面 :323-330 的日序列）。 */
function DailyUsageList({ daily }: { daily: JudgeUsage["daily"] }): React.ReactNode {
  return (
    <div className={css.subSection}>
      <div className={css.subSectionTitle}>近 30 天每日消耗（输入 + 输出）</div>
      <div className={css.ruleList}>
        {daily.map((day) => (
          <div key={day.date} className={css.ruleRow}>
            <div className={css.ruleMain}>
              <div className={css.ruleMeta}>
                <span className={css.rowLabel}>{day.date}</span>
                <Tag tone="outline">{day.calls} 次</Tag>
                <span>
                  {formatTokens(day.input_tokens)} 输入 + {formatTokens(day.output_tokens)} 输出
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
