"use client";

/**
 * One agent's editor: system prompt + versions, prompt variables and the
 * backend render preview (P3:A6–A8), the per-run and task-timeout wrapup
 * prompts (A9/A10), the run config (A11), MCP/skill visibility (A13) and the
 * per-agent tool bindings (A14) and the P3 trigger list/form (A12).
 *
 * Every value shown comes from GET /agents/{key} (prompt, variables, versions,
 * visibility, config) or the catalogs in GET /mcp, GET /skills and GET /tools.
 * The old page is app/(main)/system/agents/page.tsx + components/agent-editor.tsx
 * (:115-179 prompt/preview, :502-580 wrapup, :284-362 config, :915-1156 triggers,
 * :216-252 visibility + tools). Triggers (P3:A12) get their own tab, wired to
 * /agents/{key}/triggers (see AgentTriggersTab.tsx).
 *
 * 版式（D3 设计重塑）：整个编辑器是 kit 的填充模块 <Editor inCard>，第一组「基本信息」
 * 是 GET /agents/{key} 的只读 Facts（或页面传入的改名表单），第二组用 FilterBar 在
 * 提示词与版本 / 模型与运行 / 收尾 / 可见性 / 工具绑定 / 触发器之间切换；每个分区各自
 * 一条 EditorActions，因为它们写的是不同的接口。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { IconCloseOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import {
  Badge,
  Disclosure,
  Editor,
  EditorActions,
  EditorGroup,
  Facts,
  Field,
  FieldGrid,
  FilterBar,
  IconButton,
  Meta,
  Notice,
  Row,
  Skeleton,
  TextArea,
  TextInput,
  UnitInput,
} from "@/components/v2/design/Kit";
import type { PromptVersion } from "@/lib/types";
import { useAgentResources, setToolBinding } from "@/v2/data/agent-resources";
import {
  previewPrompt,
  resetPrompt,
  resetTaskTimeoutWrapup,
  resetWrapup,
  saveAgentConfig,
  savePrompt,
  saveTaskTimeoutWrapup,
  saveVisibility,
  saveWrapup,
  useAgentEditor,
  type AgentConfigPatch,
} from "@/v2/data/agents";
import { useSettings } from "@/v2/data/settings";
import { AgentTriggersTab } from "./AgentTriggersTab";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import shared from "./SettingsDialog.module.css";
import own from "./AgentPresetsPage.module.css";

/** Tabs the panel renders; the value doubles as the `data-agent-tab` marker. */
const TABS = [
  { id: "prompt", label: "模型与提示词" },
  { id: "wrapup", label: "收尾" },
  { id: "visibility", label: "可见性" },
  { id: "tools", label: "工具绑定" },
  { id: "triggers", label: "触发器" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Line-level diff, capped so a huge history cannot stall the dialog. */
function diffLines(oldText: string, newText: string): { type: "same" | "del" | "add"; text: string }[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length * b.length > 250000) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: { type: "same" | "del" | "add"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      out.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: "add", text: b[j] });
    j += 1;
  }
  return out;
}

function toInt(value: string): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function formatTs(ts: string): string {
  if (ts === "") return "";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString("zh-CN");
}

/** 只读代码块：标题栏（可带动作）+ 等宽正文。 */
function CodeBlock({
  title,
  actions,
  children,
  data,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  data?: Record<`data-${string}`, string>;
}): React.ReactNode {
  return (
    <div className={own.code} {...data}>
      <div className={own.codeHead}>
        <span className={own.codeTitle}>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** 面板内的小标题（12px/500）+ 计数 + 右侧动作。 */
function SubHead({ title, count, actions }: { title: React.ReactNode; count?: React.ReactNode; actions?: React.ReactNode }): React.ReactNode {
  return (
    <div className={own.subHead}>
      <span>{title}</span>
      {count === undefined ? null : <span className={own.groupCount}>{count}</span>}
      {actions === undefined ? null : <span className={own.groupHeadEnd}>{actions}</span>}
    </div>
  );
}

/** 「内置默认」折叠块：默认收起，避免长文本压住编辑区。 */
function DefaultText({ text }: { text: string }): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  if (text === "") return null;
  return (
    <>
      <Disclosure open={open} onToggle={() => setOpen((value) => !value)} hint="只读，供参考">
        内置默认
      </Disclosure>
      {open ? (
        <CodeBlock title="内置默认">
          <pre className={own.codeBody}>{text}</pre>
        </CodeBlock>
      ) : null}
    </>
  );
}

/* ---------------- 提示词与版本（A6/A7/A8） ---------------- */

function PromptTab({
  agentKey,
  prompt,
  variables,
  versions,
  onSaved,
}: {
  agentKey: string;
  prompt: string;
  variables: { name: string; description: string; example: string; source: string }[];
  versions: PromptVersion[];
  onSaved: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [draft, setDraft] = React.useState(prompt);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [rendered, setRendered] = React.useState<string | null>(null);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<PromptVersion | null>(null);
  const [comparing, setComparing] = React.useState<PromptVersion | null>(null);

  // 换 Agent 或后端值变了就重置草稿，避免把上一个 Agent 的草稿带过来。
  React.useEffect(() => setDraft(prompt), [prompt, agentKey]);

  const current = versions[0] ?? null;

  const doPreview = (): void => {
    setBusy(true);
    setRenderError(null);
    void previewPrompt(agentKey, draft)
      .then((result) => {
        setRendered(result.rendered);
        setRenderError(result.error);
      })
      .catch((reason: unknown) => setRenderError(errorText(reason)))
      .finally(() => setBusy(false));
  };

  const save = (): void => {
    setBusy(true);
    setFailure(null);
    void savePrompt(agentKey, draft, note.trim())
      .then((version) => {
        toast(`已保存为版本 v${version}`);
        setNote("");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  const restore = (): void => {
    setBusy(true);
    setFailure(null);
    void resetPrompt(agentKey)
      .then((version) => {
        toast(`已恢复为内置默认（v${version}）`);
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className={own.subBlock}>
        <SubHead
          title="系统提示词"
          actions={current === null ? <Badge>内置默认</Badge> : <Badge tone="info">{`当前 v${current.version}`}</Badge>}
        />
        <div className={own.vars} aria-label="可用变量">
          {variables.length === 0 ? <span className={own.hint}>该 Agent 没有可用变量。</span> : null}
          {variables.map((variable) => (
            <button
              key={variable.name}
              type="button"
              className={own.varChip}
              data-prompt-var={variable.name}
              disabled={busy}
              title={`${variable.description}（示例：${variable.example}）· 点击插入`}
              onClick={() => setDraft((text) => `${text}{{.${variable.name}}}`)}
            >
              {`{{.${variable.name}}}`}
              <span className={own.varSource}>{variable.source}</span>
            </button>
          ))}
        </div>
        <TextArea
          mono
          className={own.prompt}
          aria-label="系统提示词"
          value={draft}
          disabled={busy}
          spellCheck={false}
          placeholder="留空则使用内置默认提示词"
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <Field label="版本备注" htmlFor={`${uid}-note`} optional hint="保存时写入版本历史，便于回溯。">
          <TextInput
            id={`${uid}-note`}
            aria-label="版本备注"
            value={note}
            disabled={busy}
            placeholder="如：收紧范围"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </Field>
        {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
        <EditorActions
          start={
            <Button variant="ghost" size="sm" aria-label="恢复默认提示词" disabled={busy} onClick={restore}>
              恢复默认
            </Button>
          }
        >
          <Button variant="outline" size="sm" aria-label="预览渲染" disabled={busy} onClick={doPreview}>
            预览渲染
          </Button>
          <Button variant="primary" size="sm" aria-label="保存提示词" disabled={busy} onClick={save}>
            保存为新版本
          </Button>
        </EditorActions>
        {rendered === null ? null : (
          <CodeBlock
            title="渲染预览 · 变量已由后端替换，未调用模型"
            data={{ "data-prompt-preview": "" }}
            actions={
              <IconButton label="关闭渲染预览" onClick={() => setRendered(null)}>
                <IconCloseOutlineRegular size={12} />
              </IconButton>
            }
          >
            {renderError === null ? null : (
              <div className={own.codeError}>
                <Notice tone="danger">{`渲染错误：${renderError}`}</Notice>
              </div>
            )}
            <pre className={own.codeBody}>{rendered}</pre>
          </CodeBlock>
        )}
      </div>

      <div className={own.subBlock}>
        <SubHead title="版本历史" count={versions.length} />
        {versions.length === 0 ? (
          <p className={own.hint}>暂无保存的版本，当前使用内置默认提示词。</p>
        ) : (
          <div className={`${shared.optionCard} ${own.optionRows}`}>
            {versions.map((version) => {
              const isCurrent = current !== null && version.version === current.version;
              return (
                <Row
                  key={version.version}
                  data={{ "data-prompt-version": String(version.version) }}
                  label={<span className={own.version}>{`v${version.version}`}</span>}
                  labelAdornment={isCurrent ? <Badge tone="success">当前</Badge> : null}
                  description={
                    <Meta
                      items={[
                        version.note === "" ? <span key="n" className={own.summaryEmpty}>无备注</span> : version.note,
                        formatTs(version.ts),
                      ]}
                    />
                  }
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`查看版本 v${version.version}`}
                    onClick={() => setViewing(version)}
                  >
                    查看
                  </Button>
                  {current !== null && !isCurrent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`对比版本 v${version.version}`}
                      onClick={() => setComparing(version)}
                    >
                      对比
                    </Button>
                  ) : null}
                </Row>
              );
            })}
          </div>
        )}

        {viewing === null ? null : (
          <CodeBlock
            title={`v${viewing.version} 正文`}
            data={{ "data-prompt-version-view": String(viewing.version) }}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`加载版本 v${viewing.version} 到编辑器`}
                  onClick={() => {
                    setDraft(viewing.template_text);
                    setViewing(null);
                    toast(`已加载 v${viewing.version} 到编辑器，确认后点「保存为新版本」`);
                  }}
                >
                  加载到编辑器
                </Button>
                <IconButton label="关闭版本查看" onClick={() => setViewing(null)}>
                  <IconCloseOutlineRegular size={12} />
                </IconButton>
              </>
            }
          >
            <pre className={own.codeBody}>{viewing.template_text === "" ? "（空）" : viewing.template_text}</pre>
          </CodeBlock>
        )}

        {comparing === null || current === null ? null : (
          <CodeBlock
            title={`版本对比：v${comparing.version} → v${current.version}`}
            data={{ "data-prompt-version-diff": `${comparing.version}->${current.version}` }}
            actions={
              <IconButton label="关闭版本对比" onClick={() => setComparing(null)}>
                <IconCloseOutlineRegular size={12} />
              </IconButton>
            }
          >
            <pre className={own.codeBody}>
              {diffLines(comparing.template_text, current.template_text).map((line, index) => (
                <span
                  key={index}
                  className={`${own.diffLine} ${line.type === "add" ? own.diffAdd : line.type === "del" ? own.diffDel : ""}`}
                >
                  {`${line.type === "del" ? "-" : line.type === "add" ? "+" : " "} ${line.text}`}
                </span>
              ))}
            </pre>
          </CodeBlock>
        )}
      </div>
    </>
  );
}

/* ---------------- 模型与运行（A11） ---------------- */

interface RunConfig {
  llmProfileId: number | null;
  profiles: { id: number; name: string; model: string; is_default: boolean }[];
  maxTurns: number;
  runSeconds: number;
  webSearch: boolean;
  interactiveShell: boolean;
  showConfig: boolean;
  showWebSearch: boolean;
  showInteractiveShell: boolean;
}

function ConfigTab({
  agentKey,
  config,
  globalSearchOn,
  onSaved,
}: {
  agentKey: string;
  config: RunConfig;
  globalSearchOn: boolean;
  onSaved: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [maxTurns, setMaxTurns] = React.useState(String(config.maxTurns));
  const [runSeconds, setRunSeconds] = React.useState(String(config.runSeconds));
  const [profileId, setProfileId] = React.useState(config.llmProfileId === null ? "" : String(config.llmProfileId));
  const [webSearch, setWebSearch] = React.useState(config.webSearch);
  const [interactiveShell, setInteractiveShell] = React.useState(config.interactiveShell);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMaxTurns(String(config.maxTurns));
    setRunSeconds(String(config.runSeconds));
    setProfileId(config.llmProfileId === null ? "" : String(config.llmProfileId));
    setWebSearch(config.webSearch);
    setInteractiveShell(config.interactiveShell);
  }, [agentKey, config.maxTurns, config.runSeconds, config.llmProfileId, config.webSearch, config.interactiveShell]);

  const saveConfig = (): void => {
    setBusy(true);
    setFailure(null);
    const patch: AgentConfigPatch = { llm_profile_id: profileId === "" ? null : Number(profileId) };
    if (config.showConfig) {
      patch.max_turns = toInt(maxTurns);
      patch.run_seconds = toInt(runSeconds);
    }
    if (config.showWebSearch) patch.web_search = webSearch;
    if (config.showInteractiveShell) patch.interactive_shell = interactiveShell;
    void saveAgentConfig(agentKey, patch)
      .then(() => {
        toast("已保存运行配置（立即生效）");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  const hasToggles = config.showWebSearch || config.showInteractiveShell;

  return (
    <div className={own.subBlock} data-agent-config="">
      <SubHead title="模型与运行" />
      <FieldGrid>
        <Field label="默认模型" htmlFor={`${uid}-profile`} span hint="不指定时跟随任务 / 会话 / 全局激活的模型配置。">
          <SelectMenu
            id={`${uid}-profile`}
            ariaLabel="默认模型"
            value={profileId}
            disabled={busy}
            onChange={(value) => setProfileId(value)}
            options={[
              { value: "", label: "跟随任务 / 全局激活配置" },
              ...config.profiles.map((profile) => ({
                value: String(profile.id),
                label: `${profile.name}（${profile.model}）${profile.is_default ? " · 默认" : ""}`,
              })),
            ]}
          />
        </Field>
        {config.showConfig ? (
          <>
            <Field label="最大循环次数" htmlFor={`${uid}-turns`} hint="0 = 不限">
              <UnitInput unit="轮">
                <TextInput
                  id={`${uid}-turns`}
                  className={shared.numberInputKit}
                  type="number"
                  min={0}
                  aria-label="最大循环次数"
                  value={maxTurns}
                  disabled={busy}
                  onChange={(event) => setMaxTurns(event.currentTarget.value)}
                />
              </UnitInput>
            </Field>
            <Field label="运行时长" htmlFor={`${uid}-seconds`} hint="单次运行墙钟上限，0 = 不限">
              <UnitInput unit="秒">
                <TextInput
                  id={`${uid}-seconds`}
                  className={shared.numberInputKit}
                  type="number"
                  min={0}
                  aria-label="运行时长"
                  value={runSeconds}
                  disabled={busy}
                  onChange={(event) => setRunSeconds(event.currentTarget.value)}
                />
              </UnitInput>
            </Field>
          </>
        ) : null}
      </FieldGrid>

      {hasToggles ? (
        <div className={`${shared.optionCard} ${own.optionRows}`}>
          {config.showWebSearch ? (
            <Row
              label="网络搜索"
              muted={!globalSearchOn}
              description={
                globalSearchOn
                  ? "开启后可用 web_search 联网检索。"
                  : "需先在「通用设置」开启网络搜索并配置后端，才能在此启用。"
              }
            >
              <Switch checked={webSearch} onChange={setWebSearch} label="网络搜索" disabled={busy || !globalSearchOn} />
            </Row>
          ) : null}
          {config.showInteractiveShell ? (
            <Row
              label="交互式 Shell"
              description={
                <>
                  允许使用持久 PTY 会话工具族（<span className={own.mono}>shell_open/send/read/close/list</span>）。
                </>
              }
            >
              <Switch checked={interactiveShell} onChange={setInteractiveShell} label="交互式 Shell" disabled={busy} />
            </Row>
          ) : null}
        </div>
      ) : null}

      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      <EditorActions>
        <Button variant="primary" size="sm" aria-label="保存运行配置" disabled={busy} onClick={saveConfig}>
          保存运行配置
        </Button>
      </EditorActions>
    </div>
  );
}

/* ---------------- 收尾（A9/A10） ---------------- */

function WrapupTab({
  agentKey,
  wrapup,
  wrapupDefault,
  wrapupTurns,
  wrapupTurnsDefault,
  taskTimeoutSupported,
  taskTimeoutWrapup,
  taskTimeoutDefault,
  taskTimeoutTurns,
  taskTimeoutTurnsDefault,
  onSaved,
}: {
  agentKey: string;
  wrapup: string;
  wrapupDefault: string;
  wrapupTurns: number;
  wrapupTurnsDefault: number;
  taskTimeoutSupported: boolean;
  taskTimeoutWrapup: string;
  taskTimeoutDefault: string;
  taskTimeoutTurns: number;
  taskTimeoutTurnsDefault: number;
  onSaved: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [body, setBody] = React.useState(wrapup);
  const [turns, setTurns] = React.useState(String(wrapupTurns));
  const [ttBody, setTtBody] = React.useState(taskTimeoutWrapup);
  const [ttTurns, setTtTurns] = React.useState(String(taskTimeoutTurns));
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBody(wrapup);
    setTurns(String(wrapupTurns));
    setTtBody(taskTimeoutWrapup);
    setTtTurns(String(taskTimeoutTurns));
  }, [agentKey, wrapup, wrapupTurns, taskTimeoutWrapup, taskTimeoutTurns]);

  const run = (label: string, work: () => Promise<void>): void => {
    setBusy(true);
    setFailure(null);
    void work()
      .then(() => {
        toast(label);
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={own.panel} data-agent-tab-panel="wrapup">
      <div className={own.subBlock}>
        <SubHead title="每次运行收尾" />
        <p className={own.hint}>
          因超时或步数耗尽被终止时，系统注入这段收尾提示词跑一轮收尾：先写回已识别但未落库的内容，再输出一句总结。留空则使用内置默认。
        </p>
        <TextArea
          mono
          className={own.medium}
          aria-label="收尾提示词"
          value={body}
          disabled={busy}
          spellCheck={false}
          placeholder={wrapupDefault === "" ? "留空则使用内置默认收尾提示词" : wrapupDefault}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
        <Field label="收尾轮数" htmlFor={`${uid}-turns`} hint={`0 = 使用内置默认 ${wrapupTurnsDefault} 轮`}>
          <div className={own.narrow}>
            <UnitInput unit="轮">
              <TextInput
                id={`${uid}-turns`}
                className={shared.numberInputKit}
                type="number"
                min={0}
                aria-label="收尾轮数"
                value={turns}
                disabled={busy}
                onChange={(event) => setTurns(event.currentTarget.value)}
              />
            </UnitInput>
          </div>
        </Field>
        <DefaultText text={wrapupDefault} />
        {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
        <EditorActions
          start={
            <Button
              variant="ghost"
              size="sm"
              aria-label="恢复默认收尾提示词"
              disabled={busy}
              onClick={() => run("已恢复为内置默认", () => resetWrapup(agentKey))}
            >
              恢复默认
            </Button>
          }
        >
          <Button
            variant="primary"
            size="sm"
            aria-label="保存收尾提示词"
            disabled={busy}
            onClick={() =>
              run(body.trim() === "" && toInt(turns) === 0 ? "已清空，将使用内置默认" : "收尾配置已保存（下次运行生效）", () =>
                saveWrapup(agentKey, body, toInt(turns)),
              )
            }
          >
            保存
          </Button>
        </EditorActions>
      </div>

      {taskTimeoutSupported ? (
        <div className={own.subBlock} data-task-timeout-section="">
          <SubHead title="任务超时收尾" />
          <p className={own.hint}>与上面的每次运行收尾是两套：整个任务到达超时上限、即将结束时注入。留空则用内置默认。</p>
          <TextArea
            mono
            className={own.medium}
            aria-label="任务超时收尾提示词"
            value={ttBody}
            disabled={busy}
            spellCheck={false}
            placeholder={taskTimeoutDefault === "" ? "留空则使用内置默认任务超时收尾提示词" : taskTimeoutDefault}
            onChange={(event) => setTtBody(event.currentTarget.value)}
          />
          <Field label="收尾轮数" htmlFor={`${uid}-tt-turns`} hint={`0 = 使用内置默认 ${taskTimeoutTurnsDefault} 轮`}>
            <div className={own.narrow}>
              <UnitInput unit="轮">
                <TextInput
                  id={`${uid}-tt-turns`}
                  className={shared.numberInputKit}
                  type="number"
                  min={0}
                  aria-label="任务超时收尾轮数"
                  value={ttTurns}
                  disabled={busy}
                  onChange={(event) => setTtTurns(event.currentTarget.value)}
                />
              </UnitInput>
            </div>
          </Field>
          <DefaultText text={taskTimeoutDefault} />
          <EditorActions
            start={
              <Button
                variant="ghost"
                size="sm"
                aria-label="恢复默认任务超时收尾词"
                disabled={busy}
                onClick={() => run("已恢复为内置默认", () => resetTaskTimeoutWrapup(agentKey))}
              >
                恢复默认
              </Button>
            }
          >
            <Button
              variant="primary"
              size="sm"
              aria-label="保存任务超时收尾词"
              disabled={busy}
              onClick={() =>
                run("任务超时收尾配置已保存（下次运行生效）", () => saveTaskTimeoutWrapup(agentKey, ttBody, toInt(ttTurns)))
              }
            >
              保存
            </Button>
          </EditorActions>
        </div>
      ) : (
        <p className={own.hint}>该 Agent 不支持任务超时收尾词（后端 task_timeout_wrapup_supported=false）。</p>
      )}
    </div>
  );
}

/* ---------------- 可见性 + 工具绑定（A13/A14） ---------------- */

function BindingTab({
  agentKey,
  mode,
  visibleMcp,
  visibleSkills,
  onSaved,
}: {
  agentKey: string;
  mode: "visibility" | "tools";
  visibleMcp: number[];
  visibleSkills: string[];
  onSaved: () => void;
}): React.ReactNode {
  const resources = useAgentResources();
  const [mcp, setMcp] = React.useState<number[]>(visibleMcp);
  const [skills, setSkills] = React.useState<string[]>(visibleSkills);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMcp(visibleMcp);
    setSkills(visibleSkills);
  }, [agentKey, visibleMcp, visibleSkills]);

  if (resources.phase === "loading") {
    return (
      <div className={own.panel} data-agent-tab-panel={mode}>
        <Skeleton label="读取 MCP / 技能 / 工具目录" />
      </div>
    );
  }
  if (resources.phase === "offline") {
    return (
      <div className={own.panel} data-agent-tab-panel={mode}>
        <Notice tone="danger">读不到 MCP / 技能 / 工具目录{resources.error === null ? "" : `：${resources.error}`}</Notice>
      </div>
    );
  }

  const writeVisibility = (nextMcp: number[], nextSkills: string[]): void => {
    const prevMcp = mcp;
    const prevSkills = skills;
    setMcp(nextMcp);
    setSkills(nextSkills);
    setBusy(true);
    setFailure(null);
    void saveVisibility(agentKey, nextMcp, nextSkills)
      .then(() => {
        toast("可见性已保存");
        onSaved();
      })
      .catch((reason: unknown) => {
        setMcp(prevMcp);
        setSkills(prevSkills);
        setFailure(errorText(reason));
      })
      .finally(() => setBusy(false));
  };

  if (mode === "visibility") {
    return (
      <div className={own.panel} data-agent-tab-panel="visibility">
        <p className={own.hint}>只有开启的 MCP 服务器与技能对这个 Agent 可见；每个开关立即写入。</p>
        {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
        <div className={own.subBlock}>
          <SubHead title="MCP 服务器" count={`${mcp.length}/${resources.mcp.length}`} />
          {resources.mcp.length === 0 ? (
            <p className={own.hint}>后端没有配置 MCP 服务器。</p>
          ) : (
            <div className={`${shared.optionCard} ${own.optionRows}`}>
              {resources.mcp.map((server) => (
                <Row
                  key={server.id}
                  data={{ "data-vis-mcp": String(server.id) }}
                  label={server.name}
                  muted={!server.enabled}
                  labelAdornment={server.enabled ? null : <Badge tone="warning">已停用</Badge>}
                  description={<span className={own.mono}>{server.transport}</span>}
                >
                  <Switch
                    checked={mcp.includes(server.id)}
                    disabled={busy}
                    label={`MCP 可见 ${server.name}`}
                    onChange={(next) =>
                      writeVisibility(next ? [...mcp, server.id] : mcp.filter((id) => id !== server.id), skills)
                    }
                  />
                </Row>
              ))}
            </div>
          )}
        </div>
        <div className={own.subBlock}>
          <SubHead title="技能" count={`${skills.length}/${resources.skills.length}`} />
          {resources.skills.length === 0 ? (
            <p className={own.hint}>后端没有安装技能。</p>
          ) : (
            <div className={`${shared.optionCard} ${own.optionRows}`}>
              {resources.skills.map((skill) => (
                <Row
                  key={skill.name}
                  data={{ "data-vis-skill": skill.name }}
                  label={<span className={own.mono}>{skill.name}</span>}
                  description={
                    skill.description === undefined || skill.description === "" ? undefined : (
                      <span className={own.clamp2}>{skill.description}</span>
                    )
                  }
                >
                  <Switch
                    checked={skills.includes(skill.name)}
                    disabled={busy}
                    label={`技能可见 ${skill.name}`}
                    onChange={(next) =>
                      writeVisibility(mcp, next ? [...skills, skill.name] : skills.filter((name) => name !== skill.name))
                    }
                  />
                </Row>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const boundCount = resources.tools.filter((tool) => tool.agents.includes(agentKey)).length;
  return (
    <div className={own.panel} data-agent-tab-panel="tools">
      <p className={own.hint}>
        每个开关写一次 <span className={own.mono}>PUT /tools/{"{key}"}</span>（后端按工具保存绑定列表）。系统工具的参数结构不可改，这里只改绑定。
      </p>
      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      <div className={own.subBlock}>
        <SubHead title="工具" count={`${boundCount}/${resources.tools.length}`} />
        {resources.tools.length === 0 ? (
          <p className={own.hint}>后端没有工具。</p>
        ) : (
          <div className={`${shared.optionCard} ${own.optionRows}`}>
            {resources.tools.map((tool) => {
              const bound = tool.agents.includes(agentKey);
              return (
                <Row
                  key={tool.key}
                  data={{ "data-tool-binding": tool.key }}
                  label={<span className={own.mono}>{tool.key}</span>}
                  muted={!tool.enabled}
                  labelAdornment={
                    <>
                      <Badge>{tool.system ? "系统" : "自定义"}</Badge>
                      {tool.enabled ? null : <Badge tone="warning">已停用</Badge>}
                    </>
                  }
                  description={tool.description === "" ? undefined : <span className={own.clamp2}>{tool.description}</span>}
                >
                  <Switch
                    checked={bound}
                    disabled={busy}
                    label={`绑定工具 ${tool.key}`}
                    onChange={(next) => {
                      setBusy(true);
                      setFailure(null);
                      void setToolBinding(tool, agentKey, next)
                        .then((agents) => {
                          toast(`${next ? "已绑定" : "已解绑"}工具「${tool.key}」（当前 ${agents.length} 个 Agent）`);
                          resources.reload();
                          onSaved();
                        })
                        .catch((reason: unknown) => setFailure(errorText(reason)))
                        .finally(() => setBusy(false));
                    }}
                  />
                </Row>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 面板 ---------------- */

/** 包住一个只读字段值，保留 `data-agent-field` / `data-agent-field-value` 验收钩子。 */
function FieldValue({ field, value }: { field: string; value: React.ReactNode }): React.ReactNode {
  return (
    <span data-agent-field={field}>
      <span data-agent-field-value="">{value}</span>
    </span>
  );
}

/**
 * The agent editor: a filled kit Editor whose first group is the read-only
 * GET /agents/{key} facts (or the caller's rename form) and whose second group
 * switches between the prompt / config / wrapup / visibility / tools / triggers panels.
 * @param props.agentKey - which agent to edit.
 * @param props.onSaved - notified after any successful write so the list reloads.
 * @param props.metaEditor - replaces the facts while the caller edits name/description.
 * @param props.metaAction - trailing control of the 基本信息 group head (the 编辑 button).
 * @returns the editor, or its loading / error state.
 */
export function AgentEditorPanel({
  agentKey,
  onSaved,
  metaEditor,
  metaAction,
}: {
  agentKey: string;
  onSaved?: () => void;
  metaEditor?: React.ReactNode;
  metaAction?: React.ReactNode;
}): React.ReactNode {
  const editor = useAgentEditor(agentKey);
  const settings = useSettings();
  const [tab, setTab] = React.useState<TabId>("prompt");

  React.useEffect(() => setTab("prompt"), [agentKey]);

  const refresh = (): void => {
    editor.reload();
    onSaved?.();
  };

  // 只在还没有任何数据时显示读取占位；写操作后的重读不能让整个面板卸载，
  // 否则正在编辑的草稿与当前 tab 都会丢。
  if (editor.detail === null && (editor.phase === "loading" || editor.phase === "idle")) {
    return (
      <Editor inCard>
        <Skeleton label="读取 Agent 提示词与配置" />
      </Editor>
    );
  }
  if (editor.detail === null) {
    return (
      <Editor inCard>
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" aria-label="重新读取 Agent 编辑数据" onClick={editor.reload}>
              重新读取
            </Button>
          }
        >
          读不到这个 Agent 的提示词与配置{editor.error === null ? "" : `：${editor.error}`}
        </Notice>
      </Editor>
    );
  }

  const detail = editor.detail;
  const agent = detail.agent;
  const isGoals = agent.key === "goals";
  const description = agent.description ?? "";
  const profile = (detail.llm_profiles ?? []).find((item) => item.id === agent.llm_profile_id);

  return (
    <Editor inCard data={{ "data-agent-editor": agent.key }}>
      <EditorGroup
        title={
          <span className={own.groupHead}>
            基本信息
            {metaAction === undefined ? null : <span className={own.groupHeadEnd}>{metaAction}</span>}
          </span>
        }
      >
        {metaEditor !== undefined && metaEditor !== null ? (
          metaEditor
        ) : (
          <div className={own.basics} data-agent-detail={agent.key}>
            <Facts
              columns={3}
              items={[
                { key: "name", label: "名称", value: <FieldValue field="name" value={agent.name} /> },
                { key: "key", label: "Key", mono: true, value: <FieldValue field="key" value={agent.key} /> },
                { key: "role", label: "角色", value: <FieldValue field="role" value={agent.role} /> },
                {
                  key: "builtin",
                  label: "类型",
                  value: <FieldValue field="builtin" value={agent.builtin ? "内置" : "自定义"} />,
                },
                {
                  key: "enabled",
                  label: "状态",
                  value: <FieldValue field="enabled" value={agent.enabled ? "已启用" : "已停用"} />,
                },
                {
                  key: "model",
                  label: "默认模型",
                  value: profile === undefined ? "跟随任务 / 全局" : profile.name,
                  title: profile === undefined ? undefined : profile.model,
                },
              ]}
            />
            <p className={own.descText}>
              <FieldValue
                field="description"
                value={description === "" ? <span className={own.summaryEmpty}>（无描述）</span> : description}
              />
            </p>
          </div>
        )}
      </EditorGroup>

      <EditorGroup>
        <FilterBar
          id={`agent-tab-${agent.key}`}
          label="Agent 配置分区"
          value={tab}
          onChange={setTab}
          options={TABS.map((item) => ({
            value: item.id,
            label: item.label,
            data: { "data-agent-tab": item.id },
            count:
              item.id === "prompt" && (detail.versions ?? []).length > 0
                ? `v${(detail.versions ?? [])[0]?.version ?? ""}`
                : undefined,
          }))}
        />

        {tab === "prompt" ? (
          <div className={own.panel} data-agent-tab-panel="prompt">
          <ConfigTab
            agentKey={agent.key}
            globalSearchOn={settings.data === null ? false : Boolean(settings.data.web_search_enabled)}
            config={{
              llmProfileId: agent.llm_profile_id ?? null,
              profiles: detail.llm_profiles ?? [],
              maxTurns: agent.max_turns ?? 0,
              runSeconds: agent.run_seconds ?? 600,
              webSearch: Boolean(agent.web_search),
              interactiveShell: Boolean(agent.interactive_shell),
              showConfig: !isGoals && agent.key !== "mainagent",
              showWebSearch: !isGoals,
              showInteractiveShell: !isGoals,
            }}
            onSaved={refresh}
          />
          <PromptTab
            agentKey={agent.key}
            prompt={detail.prompt ?? ""}
            variables={detail.variables ?? []}
            versions={detail.versions ?? []}
            onSaved={refresh}
          />
          </div>
        ) : null}

        {tab === "wrapup" ? (
          <WrapupTab
            agentKey={agent.key}
            wrapup={detail.wrapup_prompt ?? ""}
            wrapupDefault={detail.wrapup_default ?? ""}
            wrapupTurns={detail.wrapup_max_turns ?? 0}
            wrapupTurnsDefault={detail.wrapup_max_turns_default ?? 5}
            taskTimeoutSupported={Boolean(detail.task_timeout_wrapup_supported)}
            taskTimeoutWrapup={detail.task_timeout_wrapup_prompt ?? ""}
            taskTimeoutDefault={detail.task_timeout_wrapup_default ?? ""}
            taskTimeoutTurns={detail.task_timeout_wrapup_max_turns ?? 0}
            taskTimeoutTurnsDefault={detail.task_timeout_wrapup_max_turns_default ?? 5}
            onSaved={refresh}
          />
        ) : null}

        {tab === "visibility" ? (
          <BindingTab
            agentKey={agent.key}
            mode="visibility"
            visibleMcp={detail.visibility?.mcp ?? []}
            visibleSkills={detail.visibility?.skill ?? []}
            onSaved={onSaved ?? (() => undefined)}
          />
        ) : null}

        {tab === "tools" ? (
          <BindingTab agentKey={agent.key} mode="tools" visibleMcp={[]} visibleSkills={[]} onSaved={onSaved ?? (() => undefined)} />
        ) : null}

        {tab === "triggers" ? <AgentTriggersTab agentKey={agent.key} builtin={agent.builtin} /> : null}
      </EditorGroup>
    </Editor>
  );
}
