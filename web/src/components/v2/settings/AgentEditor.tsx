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
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconRefreshOutlineRegular,
  IconSaveOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

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
import css from "./SettingsDialog.module.css";

/** Tabs the panel renders; the value doubles as the `data-agent-tab` marker. */
const TABS = [
  { id: "prompt", label: "提示词" },
  { id: "wrapup", label: "收尾提示词" },
  { id: "visibility", label: "可见性" },
  { id: "tools", label: "工具绑定" },
  { id: "triggers", label: "触发器" },
] as const;
type TabId = (typeof TABS)[number]["id"];

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

/** 提示词 + 变量 + 预览 + 版本历史 + 运行配置（A6/A7/A8/A11）。 */
function PromptTab({
  agentKey,
  prompt,
  variables,
  versions,
  config,
  globalSearchOn,
  onSaved,
}: {
  agentKey: string;
  prompt: string;
  variables: { name: string; description: string; example: string; source: string }[];
  versions: PromptVersion[];
  config: {
    llmProfileId: number | null;
    profiles: { id: number; name: string; model: string; is_default: boolean }[];
    maxTurns: number;
    runSeconds: number;
    webSearch: boolean;
    interactiveShell: boolean;
    showConfig: boolean;
    showWebSearch: boolean;
    showInteractiveShell: boolean;
  };
  globalSearchOn: boolean;
  onSaved: () => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState(prompt);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [rendered, setRendered] = React.useState<string | null>(null);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<PromptVersion | null>(null);
  const [comparing, setComparing] = React.useState<PromptVersion | null>(null);

  const [maxTurns, setMaxTurns] = React.useState(String(config.maxTurns));
  const [runSeconds, setRunSeconds] = React.useState(String(config.runSeconds));
  const [profileId, setProfileId] = React.useState(config.llmProfileId === null ? "" : String(config.llmProfileId));
  const [webSearch, setWebSearch] = React.useState(config.webSearch);
  const [interactiveShell, setInteractiveShell] = React.useState(config.interactiveShell);
  const [configFailure, setConfigFailure] = React.useState<string | null>(null);

  // 换 Agent 或后端值变了就重置草稿，避免把上一个 Agent 的草稿带过来。
  React.useEffect(() => setDraft(prompt), [prompt, agentKey]);
  React.useEffect(() => {
    setMaxTurns(String(config.maxTurns));
    setRunSeconds(String(config.runSeconds));
    setProfileId(config.llmProfileId === null ? "" : String(config.llmProfileId));
    setWebSearch(config.webSearch);
    setInteractiveShell(config.interactiveShell);
  }, [agentKey, config.maxTurns, config.runSeconds, config.llmProfileId, config.webSearch, config.interactiveShell]);

  const current = versions[0] ?? null;

  const doPreview = (): void => {
    setBusy(true);
    setRenderError(null);
    void previewPrompt(agentKey, draft)
      .then((result) => {
        setRendered(result.rendered);
        setRenderError(result.error);
      })
      .catch((reason: unknown) => setRenderError(reason instanceof Error ? reason.message : String(reason)))
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const saveConfig = (): void => {
    setBusy(true);
    setConfigFailure(null);
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
      .catch((reason: unknown) => setConfigFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={css.subForm} data-agent-tab-panel="prompt">
      <div className={css.subSection}>
        <div className={css.subSectionTitle}>运行配置 · PUT /agents/{agentKey}/config</div>
        <label className={css.fieldLabel}>
          默认模型（LLM 配置）
          <SelectMenu
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
        </label>
        {config.showConfig ? (
          <div className={css.formRow}>
            <label className={css.fieldLabel}>
              最大循环次数（0=不限）
              <input
                className={css.textField}
                type="number"
                min={0}
                aria-label="最大循环次数"
                value={maxTurns}
                disabled={busy}
                onChange={(event) => setMaxTurns(event.currentTarget.value)}
              />
            </label>
            <label className={css.fieldLabel}>
              运行时长（秒，0=不限）
              <input
                className={css.textField}
                type="number"
                min={0}
                aria-label="运行时长"
                value={runSeconds}
                disabled={busy}
                onChange={(event) => setRunSeconds(event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
        {config.showWebSearch ? (
          <div className={css.checkRow}>
            <Switch
              checked={webSearch}
              onChange={setWebSearch}
              label="网络搜索"
              disabled={busy || !globalSearchOn}
            />
            <span>
              网络搜索
              <span className={css.fieldHint}>
                {globalSearchOn
                  ? "为该 Agent 开启后可用 web_search 联网检索（点「保存运行配置」生效）"
                  : "需先在「系统配置」开启网络搜索并配置后端，才能在此启用"}
              </span>
            </span>
          </div>
        ) : null}
        {config.showInteractiveShell ? (
          <div className={css.checkRow}>
            <Switch checked={interactiveShell} onChange={setInteractiveShell} label="交互式 Shell" disabled={busy} />
            <span>
              交互式 Shell
              <span className={css.fieldHint}>允许使用持久 PTY 会话工具族（shell_open/send/read/close/list）</span>
            </span>
          </div>
        ) : null}
        {configFailure === null ? null : <p className={css.errorLine}>{configFailure}</p>}
        <div className={css.formActions}>
          <Button variant="outline" size="sm" aria-label="保存运行配置" disabled={busy} onClick={saveConfig}>
            <IconSaveOutlineRegular size={13} /> 保存运行配置
          </Button>
        </div>
      </div>

      <div className={css.subSection}>
        <div className={css.subSectionTitle}>系统提示词 · PUT /agents/{agentKey}/prompt</div>
        <p className={css.fieldHint}>
          可用变量（点击插入占位符，渲染时由运行时数据替换）：
          {variables.length === 0 ? "（无变量）" : null}
        </p>
        <div className={css.varChips}>
          {variables.map((variable) => (
            <button
              key={variable.name}
              type="button"
              className={css.varChip}
              data-prompt-var={variable.name}
              title={`${variable.description}（示例：${variable.example}）`}
              onClick={() => setDraft((text) => `${text}{{.${variable.name}}}`)}
            >
              {`{{.${variable.name}}} · ${variable.source}`}
            </button>
          ))}
        </div>
        <textarea
          className={css.promptArea}
          aria-label="系统提示词"
          value={draft}
          disabled={busy}
          placeholder="留空则使用内置默认提示词"
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <label className={css.fieldLabel}>
          版本备注（可选）
          <input
            className={css.textField}
            aria-label="版本备注"
            value={note}
            disabled={busy}
            placeholder="如：收紧范围"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>
        {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
        <div className={css.formActions}>
          <Button variant="outline" size="sm" aria-label="预览渲染" disabled={busy} onClick={doPreview}>
            预览渲染
          </Button>
          <Button variant="outline" size="sm" aria-label="恢复默认提示词" disabled={busy} onClick={restore}>
            恢复默认
          </Button>
          <Button variant="primary" size="sm" aria-label="保存提示词" disabled={busy} onClick={save}>
            <IconSaveOutlineRegular size={13} /> 保存为新版本
          </Button>
        </div>
        {rendered === null ? null : (
          <div className={css.readonlyBox} data-prompt-preview>
            <div className={css.rowLabel}>渲染预览（{"{key}"} 已由后端替换，未调用模型）</div>
            {renderError === null ? null : <p className={css.errorLine}>{`渲染错误：${renderError}`}</p>}
            <pre className={css.readonlyPre}>{rendered}</pre>
          </div>
        )}
      </div>

      <div className={css.subSection}>
        <div className={css.subSectionTitle}>版本历史 · GET /agents/{agentKey}/prompts</div>
        {versions.length === 0 ? (
          <p className={css.fieldHint}>（暂无保存的版本，使用内置默认）</p>
        ) : (
          versions.map((version) => (
            <div key={version.version} className={css.row} data-prompt-version={version.version}>
              <div className={css.rowText}>
                <div className={css.rowLabel}>
                  {`v${version.version}`}
                  {current !== null && version.version === current.version ? <Tag tone="quiet">当前</Tag> : null}
                </div>
                <div className={css.rowHint}>
                  {version.note === "" ? "（无备注）" : version.note}
                  {version.ts === "" ? "" : ` · ${new Date(version.ts).toLocaleString("zh-CN")}`}
                </div>
              </div>
              <div className={css.rowControl}>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`查看版本 v${version.version}`}
                  onClick={() => setViewing(version)}
                >
                  查看
                </Button>
                {current !== null && version.version !== current.version ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`对比版本 v${version.version}`}
                    onClick={() => setComparing(version)}
                  >
                    对比
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {viewing === null ? null : (
        <div className={css.readonlyBox} data-prompt-version-view={viewing.version}>
          <div className={css.rowLabel}>
            {`v${viewing.version} 正文`}
            <Button variant="ghost" size="sm" aria-label="关闭版本查看" onClick={() => setViewing(null)}>
              关闭
            </Button>
            <Button
              variant="outline"
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
          </div>
          <pre className={css.readonlyPre}>{viewing.template_text === "" ? "（空）" : viewing.template_text}</pre>
        </div>
      )}

      {comparing === null || current === null ? null : (
        <div className={css.readonlyBox} data-prompt-version-diff={`${comparing.version}->${current.version}`}>
          <div className={css.rowLabel}>
            {`版本对比：v${comparing.version} → v${current.version}`}
            <Button variant="ghost" size="sm" aria-label="关闭版本对比" onClick={() => setComparing(null)}>
              关闭
            </Button>
          </div>
          <pre className={css.readonlyPre}>
            {diffLines(comparing.template_text, current.template_text)
              .map((line) => `${line.type === "del" ? "-" : line.type === "add" ? "+" : " "} ${line.text}`)
              .join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

/** 收尾提示词 + 任务超时收尾词（A9/A10）。 */
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={css.subForm} data-agent-tab-panel="wrapup">
      <div className={css.subSection}>
        <div className={css.subSectionTitle}>收尾提示词 · PUT /agents/{agentKey}/wrapup</div>
        <p className={css.fieldHint}>
          因超时或步数耗尽被终止时，系统注入这段收尾提示词跑一轮收尾：先写回已识别但未落库的内容，再输出一句总结。留空则使用内置默认。
        </p>
        <textarea
          className={css.promptArea}
          aria-label="收尾提示词"
          value={body}
          disabled={busy}
          placeholder={wrapupDefault === "" ? "留空则使用内置默认收尾提示词" : wrapupDefault}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
        <label className={css.fieldLabel}>
          {`收尾轮数（0=用内置默认 ${wrapupTurnsDefault} 轮）`}
          <input
            className={css.textField}
            type="number"
            min={0}
            aria-label="收尾轮数"
            value={turns}
            disabled={busy}
            onChange={(event) => setTurns(event.currentTarget.value)}
          />
        </label>
        {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
        <div className={css.formActions}>
          <Button
            variant="outline"
            size="sm"
            aria-label="恢复默认收尾提示词"
            disabled={busy}
            onClick={() => run("已恢复为内置默认", () => resetWrapup(agentKey))}
          >
            恢复默认
          </Button>
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
            <IconSaveOutlineRegular size={13} /> 保存
          </Button>
        </div>
        {wrapupDefault === "" ? null : (
          <div className={css.readonlyBox}>
            <div className={css.rowLabel}>内置默认（只读，供参考）</div>
            <pre className={css.readonlyPre}>{wrapupDefault}</pre>
          </div>
        )}
      </div>

      {taskTimeoutSupported ? (
        <div className={css.subSection} data-task-timeout-section>
          <div className={css.subSectionTitle}>任务超时收尾 · PUT /agents/{agentKey}/wrapup/task-timeout</div>
          <p className={css.fieldHint}>
            与上面的 per-run 收尾是两套：整个任务到达超时上限、即将结束时注入。留空则用内置默认。
          </p>
          <textarea
            className={css.promptArea}
            aria-label="任务超时收尾提示词"
            value={ttBody}
            disabled={busy}
            placeholder={taskTimeoutDefault === "" ? "留空则使用内置默认任务超时收尾提示词" : taskTimeoutDefault}
            onChange={(event) => setTtBody(event.currentTarget.value)}
          />
          <label className={css.fieldLabel}>
            {`收尾轮数（0=用内置默认 ${taskTimeoutTurnsDefault} 轮）`}
            <input
              className={css.textField}
              type="number"
              min={0}
              aria-label="任务超时收尾轮数"
              value={ttTurns}
              disabled={busy}
              onChange={(event) => setTtTurns(event.currentTarget.value)}
            />
          </label>
          <div className={css.formActions}>
            <Button
              variant="outline"
              size="sm"
              aria-label="恢复默认任务超时收尾词"
              disabled={busy}
              onClick={() => run("已恢复为内置默认", () => resetTaskTimeoutWrapup(agentKey))}
            >
              恢复默认
            </Button>
            <Button
              variant="primary"
              size="sm"
              aria-label="保存任务超时收尾词"
              disabled={busy}
              onClick={() =>
                run("任务超时收尾配置已保存（下次运行生效）", () =>
                  saveTaskTimeoutWrapup(agentKey, ttBody, toInt(ttTurns)),
                )
              }
            >
              <IconSaveOutlineRegular size={13} /> 保存
            </Button>
          </div>
          {taskTimeoutDefault === "" ? null : (
            <div className={css.readonlyBox}>
              <div className={css.rowLabel}>内置默认（只读，供参考）</div>
              <pre className={css.readonlyPre}>{taskTimeoutDefault}</pre>
            </div>
          )}
        </div>
      ) : (
        <p className={css.fieldHint}>该 Agent 不支持任务超时收尾词（后端 task_timeout_wrapup_supported=false）。</p>
      )}
    </div>
  );
}

/** MCP / 技能可见性 + 工具绑定（A13/A14）：两处都只写真实接口。 */
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

  if (resources.phase === "loading") return <p className={css.fieldHint}>读取 MCP / 技能 / 工具目录…</p>;
  if (resources.phase === "offline") {
    return (
      <>
        <p className={css.fieldHint}>读不到 MCP / 技能 / 工具目录。</p>
        {resources.error === null ? null : <p className={css.errorLine}>{resources.error}</p>}
      </>
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
        setFailure(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusy(false));
  };

  if (mode === "visibility") {
    return (
      <div className={css.subForm} data-agent-tab-panel="visibility">
        <p className={css.fieldHint}>
          只有勾选（开启）的 MCP 服务器与技能对这个 Agent 可见。写 PUT /agents/{agentKey}/visibility。
        </p>
        <div className={css.subSection}>
          <div className={css.subSectionTitle}>{`MCP 服务器 · GET /mcp（${resources.mcp.length} 项）`}</div>
          {resources.mcp.length === 0 ? (
            <p className={css.fieldHint}>（后端没有配置 MCP 服务器）</p>
          ) : (
            resources.mcp.map((server) => (
              <div key={server.id} className={css.checkRow} data-vis-mcp={server.id}>
                <Switch
                  checked={mcp.includes(server.id)}
                  disabled={busy}
                  label={`MCP 可见 ${server.name}`}
                  onChange={(next) =>
                    writeVisibility(
                      next ? [...mcp, server.id] : mcp.filter((id) => id !== server.id),
                      skills,
                    )
                  }
                />
                <span>
                  {server.name}
                  <span className={css.fieldHint}>{`${server.transport}${server.enabled ? "" : " · 已停用"}`}</span>
                </span>
              </div>
            ))
          )}
        </div>
        <div className={css.subSection}>
          <div className={css.subSectionTitle}>{`技能 · GET /skills（${resources.skills.length} 项）`}</div>
          {resources.skills.length === 0 ? (
            <p className={css.fieldHint}>（后端没有安装技能）</p>
          ) : (
            resources.skills.map((skill) => (
              <div key={skill.name} className={css.checkRow} data-vis-skill={skill.name}>
                <Switch
                  checked={skills.includes(skill.name)}
                  disabled={busy}
                  label={`技能可见 ${skill.name}`}
                  onChange={(next) =>
                    writeVisibility(
                      mcp,
                      next ? [...skills, skill.name] : skills.filter((name) => name !== skill.name),
                    )
                  }
                />
                <span>
                  {skill.name}
                  <span className={css.fieldHint}>{skill.description ?? ""}</span>
                </span>
              </div>
            ))
          )}
        </div>
        {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      </div>
    );
  }

  return (
    <div className={css.subForm} data-agent-tab-panel="tools">
      <p className={css.fieldHint}>
        每个开关写一次 PUT /tools/{"{key}"}（后端按工具保存绑定列表）。系统工具的参数结构不可改，这里只改绑定。
      </p>
      <div className={css.subSectionTitle}>{`工具 · GET /tools（${resources.tools.length} 项）`}</div>
      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      {resources.tools.length === 0 ? (
        <p className={css.fieldHint}>（后端没有工具）</p>
      ) : (
        resources.tools.map((tool) => {
          const bound = tool.agents.includes(agentKey);
          return (
            <div key={tool.key} className={css.checkRow} data-tool-binding={tool.key}>
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
                    .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
                    .finally(() => setBusy(false));
                }}
              />
              <span>
                {tool.key}
                <span className={css.fieldHint}>
                  {tool.description}
                  {` · ${tool.system ? "系统工具" : "自定义工具"}${tool.enabled ? "" : " · 已停用"}`}
                </span>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * The agent editor panel: one tab per concern, every tab reading the payload of
 * a single GET /agents/{key}.
 * @param props.agentKey - which agent to edit.
 * @param props.onSaved - notified after any successful write so the list reloads.
 * @returns the tabbed panel, or a read-state line while the payload loads.
 */
export function AgentEditorPanel({
  agentKey,
  onSaved,
}: {
  agentKey: string;
  onSaved?: () => void;
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
    return <p className={css.fieldHint}>读取 GET /agents/{"{key}"} …</p>;
  }
  if (editor.detail === null) {
    return (
      <>
        <p className={css.fieldHint}>读不到这个 Agent 的提示词与配置。</p>
        {editor.error === null ? null : <p className={css.errorLine}>{editor.error}</p>}
        <Button variant="outline" size="sm" aria-label="重新读取 Agent 编辑数据" onClick={editor.reload}>
          <IconRefreshOutlineRegular size={13} /> 重新读取
        </Button>
      </>
    );
  }

  const detail = editor.detail;
  const agent = detail.agent;
  const isGoals = agent.key === "goals";

  return (
    <div className={css.subSection} data-agent-editor={agent.key}>
      <div className={css.agentTabs}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${css.agentTab} ${tab === item.id ? css.agentTabActive : ""}`}
            data-agent-tab={item.id}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "prompt" ? (
        <PromptTab
          agentKey={agent.key}
          prompt={detail.prompt ?? ""}
          variables={detail.variables ?? []}
          versions={detail.versions ?? []}
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
    </div>
  );
}
