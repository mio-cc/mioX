"use client";

/**
 * 工具目录页（设置弹窗「工具」分节）：内置工具 + 自定义工具。
 *
 * 内置行来自 GET /tools（system=true），key/参数名/类型焊在 Go 处理器上，本页只
 * 改描述、每个参数的描述与默认值、Agent 绑定与启用态；「恢复默认」走
 * POST /tools/{key}/reset 回到代码定义。自定义行（system=false）带 kind 与 exec
 * 规格，本页做新建/编辑/删除与「测试运行」（POST /tools/custom/test，不落库）。
 *
 * 全部取数经 @/v2/data/tools 适配器；Agent 绑定开关复用 @/v2/data/agent-resources
 * 的 setToolBinding，与 Agent 编辑器的工具绑定 tab 走同一条写入路径。
 * 旧页依据：app/(main)/system/tools/page.tsx（T1–T10）。
 * DSH 依据：DSH 无工具目录页；按 ui-settings config-form 扩展（整页放在主区）。
 * 对照表行：P3:T1 P3:T2 P3:T3 P3:T4 P3:T5 P3:T6 P3:T7 P3:T8 P3:T9 P3:T10
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { Tool } from "@/lib/types";
import { setToolBinding } from "@/v2/data/agent-resources";
import { useAgents } from "@/v2/data/agents";
import {
  CUSTOM_TOOL_KINDS,
  type CustomToolDraft,
  type CustomToolKind,
  type ParamRow,
  countParams,
  createCustomTool,
  deleteCustomTool,
  emptyExec,
  isCustomTool,
  paramRows,
  parseJsonObject,
  parseSchema,
  resetTool,
  rowKindLabel,
  saveTool,
  testCustomTool,
  updateCustomTool,
  useToolsCatalog,
  withParamRows,
} from "@/v2/data/tools";
import { toast } from "../settings/Toast";
import css from "./ToolsPage.module.css";

const KIND_OPTIONS = CUSTOM_TOOL_KINDS.map((kind) => ({ value: kind, label: kind }));
const TABS = [
  { value: "builtin", label: "内置工具" },
  { value: "custom", label: "自定义工具" },
] as const;

type Tab = (typeof TABS)[number]["value"];

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 一个自定义工具行的 kind；system 行不会出现在自定义 tab，故回落 command。 */
function customKindOf(tool: Tool | null): CustomToolKind {
  const kind = tool?.kind;
  return kind === "command" || kind === "script" || kind === "http" || kind === "shell" ? kind : "command";
}

/** 搜索过滤：key / 描述 / 绑定 Agent（大小写与全角不敏感）。 */
function matches(tool: { key: string; description: string; agents: string[] }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [tool.key, tool.description, tool.agents.join(" ")].some((text) => text.toLowerCase().includes(q));
}

/**
 * 工具目录页主体：两个 tab（内置 / 自定义），共用一条搜索框。
 * @returns 设置弹窗「工具」分节的整页内容。
 */
export function ToolsPage(): React.ReactNode {
  const catalog = useToolsCatalog();
  const agents = useAgents();
  const [tab, setTab] = React.useState<Tab>("builtin");
  const [query, setQuery] = React.useState("");

  if (catalog.phase === "loading") {
    return (
      <p className={css.state} data-tools-page="loading" role="status">
        读取工具目录…
      </p>
    );
  }
  if (catalog.phase === "offline") {
    return (
      <div className={css.stateError} data-tools-page="offline" role="alert">
        <span>读取失败：{catalog.error ?? "未连接后端"}</span>
        <Button variant="outline" size="sm" onClick={catalog.reload}>
          重试
        </Button>
      </div>
    );
  }

  const builtin = catalog.tools.filter((tool) => tool.system === true);
  const custom = catalog.tools.filter((tool) => !isCustomTool(tool));
  const agentKeys = agents.agents.map((agent) => agent.key);

  return (
    <div className={css.page} data-tools-page="ready">
      <div className={css.head}>
        <div>
          <h2 className={css.title}>工具目录</h2>
          <p className={css.lead}>
            内置 {builtin.length} 个 · 自定义 {custom.length} 个。内置工具的参数名与类型由后端处理器固定，只能改描述、参数说明与默认值。
          </p>
        </div>
        <div className={css.headActions}>
          <span data-tools-tabs="">
            <SegmentedControl id="tools-tab" label="工具分类" value={tab} options={TABS} onChange={setTab} />
          </span>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={catalog.reload}>
            重新读取
          </Button>
        </div>
      </div>

      <div className={css.search}>
        <Input
          value={query}
          placeholder="搜索名称 / 描述 / 绑定的 Agent"
          aria-label="搜索工具"
          data-tools-search=""
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {tab === "builtin" ? (
        <BuiltinTab tools={builtin} query={query} agentKeys={agentKeys} onChanged={catalog.reload} />
      ) : (
        <CustomTab tools={custom} query={query} agentKeys={agentKeys} onChanged={catalog.reload} />
      )}
    </div>
  );
}

/** 内置工具 tab：列表 + 选中行的编辑器。 */
function BuiltinTab({
  tools,
  query,
  agentKeys,
  onChanged,
}: {
  tools: Tool[];
  query: string;
  agentKeys: string[];
  onChanged: () => void;
}): React.ReactNode {
  const [selected, setSelected] = React.useState<string | null>(null);
  const rows = tools.filter((tool) => matches(tool, query));
  const current = rows.find((tool) => tool.key === selected) ?? null;

  return (
    <div className={css.split}>
      <ul className={css.list} aria-label="内置工具列表">
        {rows.length === 0 ? <li className={css.empty}>没有匹配的内置工具。</li> : null}
        {rows.map((tool) => (
          <li key={tool.key}>
            <button
              type="button"
              className={`${css.row} ${tool.key === selected ? css.rowActive : ""}`}
              data-tool-row={tool.key}
              onClick={() => setSelected(tool.key === selected ? null : tool.key)}
            >
              <span className={css.rowKey}>{tool.key}</span>
              <span className={css.rowDesc}>{tool.description === "" ? "（无描述）" : tool.description}</span>
              <span className={css.rowMeta}>
                {countParams(tool.schema)} 参数 · 绑定 {tool.agents.length} · {tool.enabled ? "启用" : "停用"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className={css.detail}>
        {current === null ? (
          <p className={css.lead}>从左侧选一个内置工具查看并编辑它的描述、参数说明与绑定。</p>
        ) : (
          <BuiltinEditor key={current.key} tool={current} agentKeys={agentKeys} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

/** 内置工具编辑器：描述 + 参数说明/默认值 + 启用 + Agent 绑定 + 恢复默认。 */
function BuiltinEditor({
  tool,
  agentKeys,
  onChanged,
}: {
  tool: Tool;
  agentKeys: string[];
  onChanged: () => void;
}): React.ReactNode {
  const [description, setDescription] = React.useState(tool.description);
  const [schemaRows, setSchemaRows] = React.useState<ParamRow[]>(() => paramRows(tool.schema));
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);

  const bound = tool.agents;
  const run = async (action: () => Promise<void>, done: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      toast(done);
      onChanged();
    } catch (reason: unknown) {
      setFailure(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const editRow = (name: string, parentKey: string | undefined, patch: Partial<ParamRow>): void => {
    setSchemaRows((rows) =>
      rows.map((row) => (row.name === name && row.parentKey === parentKey ? { ...row, ...patch } : row)),
    );
  };

  return (
    <section className={css.editor} data-builtin-editor={tool.key}>
      <header className={css.editorHead}>
        <div>
          <div className={css.editorKey}>{tool.key}</div>
          <div className={css.rowMeta}>内置工具 · 参数名与类型不可改 · 调用 {tool.calls ?? 0} 次</div>
        </div>
        <div className={css.headActions}>
          <Button
            variant="outline"
            size="sm"
            data-tool-reset=""
            disabled={busy}
            onClick={() => setResetOpen(true)}
          >
            恢复默认
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-tool-save=""
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  saveTool(tool.key, {
                    description,
                    schema: withParamRows(tool.schema, schemaRows),
                    agents: bound,
                    enabled: tool.enabled,
                  }),
                `已保存 ${tool.key}`,
              )
            }
          >
            保存
          </Button>
        </div>
      </header>

      <label className={css.field}>
        <span className={css.fieldLabel}>工具描述</span>
        <textarea
          className={css.textarea}
          data-tool-field="description"
          value={description}
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={css.field}>
        <span className={css.fieldLabel}>参数（{schemaRows.length}）</span>
        {schemaRows.length === 0 ? <p className={css.lead}>该工具没有参数。</p> : null}
        <div className={css.params}>
          {schemaRows.map((row) => (
            <div className={css.paramRow} key={`${row.parentKey ?? ""}.${row.name}`} data-tool-param={row.name}>
              <div className={css.paramName}>
                <span>{row.parentKey === undefined ? row.name : `${row.parentKey}[].${row.name}`}</span>
                <Tag tone="outline">{row.type === "" ? "any" : row.type}</Tag>
                {row.required ? <Tag tone="info">必填</Tag> : null}
              </div>
              <Input
                className={css.paramInput}
                value={row.description}
                placeholder="参数说明"
                aria-label={`${row.name} 参数说明`}
                disabled={busy}
                onChange={(event) => editRow(row.name, row.parentKey, { description: event.target.value })}
              />
              <Input
                className={css.paramInput}
                value={row.defaultStr}
                placeholder="默认值（留空表示不声明）"
                aria-label={`${row.name} 默认值`}
                disabled={busy || !row.scalar}
                data-tool-param-default={row.name}
                onChange={(event) => editRow(row.name, row.parentKey, { defaultStr: event.target.value })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className={css.rowLine}>
        <div>
          <div className={css.fieldLabel}>启用</div>
          <div className={css.hint}>停用的工具不会出现在任何 Agent 的工具清单里。</div>
        </div>
        <span data-tool-enabled={tool.enabled ? "true" : "false"}>
          <Switch
            checked={tool.enabled}
            label={`启用 ${tool.key}`}
            disabled={busy}
            onChange={(next) =>
              void run(
                () =>
                  saveTool(tool.key, {
                    description: tool.description,
                    schema: tool.schema,
                    agents: tool.agents,
                    enabled: next,
                  }),
                next ? `已启用 ${tool.key}` : `已停用 ${tool.key}`,
              )
            }
          />
        </span>
      </div>

      <div className={css.field}>
        <span className={css.fieldLabel}>绑定 Agent（{bound.length}）</span>
        <div className={css.bindList} data-tool-bind-list="">
          {agentKeys.length === 0 ? <p className={css.hint}>读不到 Agent 列表。</p> : null}
          {agentKeys.map((agentKey) => (
            <span className={css.bindItem} key={agentKey} data-tool-bind={agentKey}>
              <Checkbox
                checked={bound.includes(agentKey)}
                label={agentKey}
                disabled={busy}
                onChange={(next) =>
                  void run(
                    () => setToolBinding(tool, agentKey, next).then(() => undefined),
                    next ? `已绑定 ${agentKey}` : `已解绑 ${agentKey}`,
                  )
                }
              />
            </span>
          ))}
        </div>
      </div>

      {failure === null ? null : <p className={css.error}>保存失败：{failure}</p>}

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`恢复「${tool.key}」为代码默认`}
        description="后端会把该工具的描述、参数说明与默认值改回 Go 处理器里的代码定义，并重新启用、重新绑定种子 Agent。页面上尚未保存的修改会丢失，此操作不可撤销。"
        closeLabel="关闭"
        tone="warning"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setResetOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-tool-reset-confirm=""
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await resetTool(tool.key);
                  setResetOpen(false);
                }, `已把 ${tool.key} 恢复默认`)
              }
            >
              确认恢复默认
            </Button>
          </>
        }
      />
    </section>
  );
}

/** 自定义工具 tab：列表 + 新建/编辑表单。 */
function CustomTab({
  tools,
  query,
  agentKeys,
  onChanged,
}: {
  tools: Tool[];
  query: string;
  agentKeys: string[];
  onChanged: () => void;
}): React.ReactNode {
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const rows = tools.filter((tool) => matches(tool, query));

  return (
    <div className={css.split}>
      <div>
        <div className={css.toolbar}>
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlusOutlineRegular size={14} />}
            data-custom-new=""
            onClick={() => setEditing("new")}
          >
            新建自定义工具
          </Button>
        </div>
        <ul className={css.list} aria-label="自定义工具列表">
          {rows.length === 0 ? <li className={css.empty}>还没有自定义工具。</li> : null}
          {rows.map((tool) => (
            <li key={tool.key}>
              <button
                type="button"
                className={`${css.row} ${tool.key === editing ? css.rowActive : ""}`}
                data-tool-row={tool.key}
                onClick={() => setEditing(tool.key)}
              >
                <span className={css.rowKey}>{tool.key}</span>
                <span className={css.rowDesc}>{tool.description === "" ? "（无描述）" : tool.description}</span>
                <span className={css.rowMeta}>
                  <Tag tone="outline">{rowKindLabel(tool)}</Tag> {countParams(tool.schema)} 参数 ·{" "}
                  {tool.enabled ? "启用" : "停用"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className={css.detail}>
        {editing === null ? (
          <p className={css.lead}>从左侧选一个自定义工具编辑，或新建一个。</p>
        ) : (
          <CustomEditor
            key={editing}
            tool={editing === "new" ? null : (tools.find((tool) => tool.key === editing) ?? null)}
            agentKeys={agentKeys}
            onChanged={onChanged}
            onDeleted={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

interface ExecState {
  command: string;
  commandTimeout: string;
  code: string;
  scriptTimeout: string;
  method: string;
  url: string;
  headers: string;
  body: string;
  httpTimeout: string;
  proxy: string;
  useRecordingProxy: boolean;
}

function execStateOf(tool: Tool | null, kind: CustomToolKind): ExecState {
  const exec = tool?.exec ?? emptyExec(kind);
  const str = (key: string): string => (typeof exec[key] === "string" ? String(exec[key]) : "");
  const num = (key: string, fallback: string): string =>
    typeof exec[key] === "number" ? String(exec[key]) : fallback;
  return {
    command: str("command"),
    commandTimeout: num("timeout_ms", "60000"),
    code: str("code"),
    scriptTimeout: num("timeout_ms", "120000"),
    method: str("method") === "" ? "GET" : str("method"),
    url: str("url"),
    headers: exec.headers === undefined ? "{}" : JSON.stringify(exec.headers, null, 2),
    body: str("body"),
    httpTimeout: num("timeout_ms", "30000"),
    proxy: str("proxy"),
    useRecordingProxy: exec.use_recording_proxy === true,
  };
}

/** 自定义工具编辑器：新建与编辑共用，含测试运行与删除。 */
function CustomEditor({
  tool,
  agentKeys,
  onChanged,
  onDeleted,
}: {
  tool: Tool | null;
  agentKeys: string[];
  onChanged: () => void;
  onDeleted: () => void;
}): React.ReactNode {
  const initialKind: CustomToolKind = customKindOf(tool);
  const [key, setKey] = React.useState(tool?.key ?? "");
  const [description, setDescription] = React.useState(tool?.description ?? "");
  const [kind, setKind] = React.useState<CustomToolKind>(initialKind);
  const [enabled, setEnabled] = React.useState(tool?.enabled ?? true);
  const [deferred, setDeferred] = React.useState(tool?.deferred === true);
  const [agentList, setAgentList] = React.useState<string[]>(tool?.agents ?? []);
  const [schemaText, setSchemaText] = React.useState(JSON.stringify(tool?.schema ?? { type: "object", properties: {} }, null, 2));
  const [exec, setExec] = React.useState<ExecState>(() => execStateOf(tool, initialKind));
  const [paramsText, setParamsText] = React.useState("{}");
  const [output, setOutput] = React.useState<{ text: string; isError: boolean } | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const isNew = tool === null;
  const setExecField = <K extends keyof ExecState>(field: K, value: ExecState[K]): void => {
    setExec((prev) => ({ ...prev, [field]: value }));
  };

  const buildDraft = (): CustomToolDraft | null => {
    const schema = parseSchema(schemaText);
    if (schema.value === null) {
      setFailure(`schema：${schema.error ?? "解析失败"}`);
      return null;
    }
    const headers = parseJsonObject(exec.headers);
    if (headers.value === null) {
      setFailure(`HTTP headers：${headers.error ?? "解析失败"}`);
      return null;
    }
    let execSpec: Record<string, unknown>;
    if (kind === "command") {
      execSpec = { command: exec.command, timeout_ms: Number(exec.commandTimeout) || 0 };
    } else if (kind === "script") {
      execSpec = { code: exec.code, timeout_ms: Number(exec.scriptTimeout) || 0 };
    } else if (kind === "http") {
      execSpec = {
        method: exec.method,
        url: exec.url,
        headers: headers.value,
        body: exec.body,
        timeout_ms: Number(exec.httpTimeout) || 0,
        proxy: exec.proxy,
        use_recording_proxy: exec.useRecordingProxy,
      };
    } else {
      execSpec = {};
    }
    return {
      key,
      description,
      schema: schema.value,
      agents: agentList,
      enabled,
      kind,
      exec: execSpec,
      deferred,
    };
  };

  const run = async (action: () => Promise<void>, done: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      toast(done);
      onChanged();
    } catch (reason: unknown) {
      setFailure(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={css.editor} data-custom-editor={isNew ? "new" : key}>
      <header className={css.editorHead}>
        <div>
          <div className={css.editorKey}>{isNew ? "新建自定义工具" : key}</div>
          <div className={css.rowMeta}>
            自定义工具 · key 创建后不可改 · {isNew ? "尚未保存" : "改动需点保存"}
          </div>
        </div>
        <div className={css.headActions}>
          {isNew ? null : (
            <Button
              variant="outline"
              size="sm"
              data-custom-delete=""
              disabled={busy}
              icon={<IconTrashOutlineRegular size={14} />}
              onClick={() => setDeleteOpen(true)}
            >
              删除
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            data-custom-save=""
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const draft = buildDraft();
                if (draft === null) return;
                if (isNew) await createCustomTool(draft);
                else await updateCustomTool(draft);
              }, isNew ? "已创建自定义工具" : `已保存 ${key}`)
            }
          >
            保存
          </Button>
        </div>
      </header>

      <div className={css.formGrid}>
        <label className={css.field}>
          <span className={css.fieldLabel}>key</span>
          <Input
            value={key}
            data-custom-key=""
            placeholder="小写字母开头，仅小写字母/数字/下划线"
            disabled={busy || !isNew}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>类型</span>
          <span data-custom-kind={kind}>
            <SegmentedControl
              id="custom-tool-kind"
              label="自定义工具类型"
              value={kind}
              options={KIND_OPTIONS}
              disabled={busy}
              onChange={(next) => setKind(next as CustomToolKind)}
            />
          </span>
        </label>
      </div>

      <label className={css.field}>
        <span className={css.fieldLabel}>描述</span>
        <textarea
          className={css.textarea}
          rows={2}
          data-custom-description=""
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={css.rowLine}>
        <div>
          <div className={css.fieldLabel}>启用</div>
          <div className={css.hint}>停用后不进入 Agent 工具清单。</div>
        </div>
        <Switch checked={enabled} label="启用该自定义工具" disabled={busy} onChange={setEnabled} />
      </div>
      <div className={css.rowLine}>
        <div>
          <div className={css.fieldLabel}>延迟 schema</div>
          <div className={css.hint}>开启后参数 schema 走搜索/执行工具延迟下发，省上下文。</div>
        </div>
        <Switch checked={deferred} label="延迟 schema" disabled={busy} onChange={setDeferred} />
      </div>

      {kind === "shell" ? (
        <p className={css.hint}>shell 类型只作为环境提示进入 Bash 工具描述，不产生可调用工具，也没有执行规格。</p>
      ) : null}

      {kind === "command" ? (
        <label className={css.field}>
          <span className={css.fieldLabel}>命令模板（参数用 {"{name}"} 占位）</span>
          <textarea
            className={css.textarea}
            rows={3}
            data-custom-exec-command=""
            value={exec.command}
            onChange={(event) => setExecField("command", event.target.value)}
          />
        </label>
      ) : null}

      {kind === "script" ? (
        <label className={css.field}>
          <span className={css.fieldLabel}>Python 脚本（参数 JSON 从 stdin 传入，标量同时镜像成 TOOL_&lt;NAME&gt;）</span>
          <textarea
            className={css.textarea}
            rows={6}
            data-custom-exec-code=""
            value={exec.code}
            onChange={(event) => setExecField("code", event.target.value)}
          />
        </label>
      ) : null}

      {kind === "http" ? (
        <>
          <div className={css.formGrid}>
            <label className={css.field}>
              <span className={css.fieldLabel}>方法</span>
              <Input value={exec.method} onChange={(event) => setExecField("method", event.target.value)} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>URL（参数用 {"{name}"} 占位）</span>
              <Input
                value={exec.url}
                data-custom-exec-url=""
                placeholder="http(s)://…"
                onChange={(event) => setExecField("url", event.target.value)}
              />
            </label>
          </div>
          <label className={css.field}>
            <span className={css.fieldLabel}>Headers（JSON 对象）</span>
            <textarea
              className={css.textarea}
              rows={3}
              value={exec.headers}
              onChange={(event) => setExecField("headers", event.target.value)}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>请求体（参数用 {"{name}"} 占位）</span>
            <textarea
              className={css.textarea}
              rows={3}
              value={exec.body}
              onChange={(event) => setExecField("body", event.target.value)}
            />
          </label>
          <div className={css.formGrid}>
            <label className={css.field}>
              <span className={css.fieldLabel}>代理（可留空）</span>
              <Input value={exec.proxy} onChange={(event) => setExecField("proxy", event.target.value)} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>超时（毫秒）</span>
              <Input value={exec.httpTimeout} onChange={(event) => setExecField("httpTimeout", event.target.value)} />
            </label>
          </div>
          <Checkbox
            checked={exec.useRecordingProxy}
            label="走流量录制代理（信任其 CA）"
            disabled={busy}
            onChange={(next) => setExecField("useRecordingProxy", next)}
          />
        </>
      ) : null}

      {kind === "command" || kind === "script" ? (
        <div className={css.formGrid}>
          <label className={css.field}>
            <span className={css.fieldLabel}>超时（毫秒）</span>
            <Input
              value={kind === "command" ? exec.commandTimeout : exec.scriptTimeout}
              onChange={(event) =>
                setExecField(kind === "command" ? "commandTimeout" : "scriptTimeout", event.target.value)
              }
            />
          </label>
        </div>
      ) : null}

      <label className={css.field}>
        <span className={css.fieldLabel}>参数 JSON Schema</span>
        <textarea
          className={css.textarea}
          rows={5}
          data-custom-schema=""
          value={schemaText}
          onChange={(event) => setSchemaText(event.target.value)}
        />
      </label>

      <div className={css.field}>
        <span className={css.fieldLabel}>绑定 Agent（{agentList.length}）</span>
        <div className={css.bindList}>
          {agentKeys.map((agentKey) => (
            <span className={css.bindItem} key={agentKey} data-custom-bind={agentKey}>
              <Checkbox
                checked={agentList.includes(agentKey)}
                label={agentKey}
                disabled={busy}
                onChange={(next) =>
                  setAgentList((prev) => (next ? [...prev, agentKey] : prev.filter((item) => item !== agentKey)))
                }
              />
            </span>
          ))}
        </div>
      </div>

      <div className={css.testBox}>
        <div className={css.fieldLabel}>测试运行（不保存，直接执行下面的执行规格）</div>
        <label className={css.field}>
          <span className={css.hint}>示例参数（JSON 对象，用于渲染 {"{name}"} 占位）</span>
          <textarea
            className={css.textarea}
            rows={2}
            data-custom-test-params=""
            value={paramsText}
            onChange={(event) => setParamsText(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          icon={<IconPlayOutlineRegular size={14} />}
          data-custom-test=""
          disabled={busy || kind === "shell"}
          onClick={() =>
            void run(async () => {
              const draft = buildDraft();
              if (draft === null) return;
              const params = parseJsonObject(paramsText);
              if (params.value === null) {
                setFailure(`示例参数：${params.error ?? "解析失败"}`);
                return;
              }
              const result = await testCustomTool(kind === "shell" ? "command" : kind, draft.exec, params.value);
              setOutput({ text: result.output === "" ? "（无输出）" : result.output, isError: result.is_error });
            }, "测试运行完成")
          }
        >
          测试运行
        </Button>
        {output === null ? null : (
          <pre
            className={output.isError ? css.outputError : css.output}
            data-custom-test-output={output.isError ? "error" : "ok"}
          >
            {output.text}
          </pre>
        )}
      </div>

      {failure === null ? null : <p className={css.error}>操作失败：{failure}</p>}

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`删除自定义工具「${key}」`}
        description="后端会删掉这条自定义工具定义，已绑定它的 Agent 将不再拥有该工具。该操作不可撤销。"
        closeLabel="关闭"
        tone="warning"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-custom-delete-confirm=""
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await deleteCustomTool(key);
                  setDeleteOpen(false);
                  onDeleted();
                }, `已删除 ${key}`)
              }
            >
              确认删除
            </Button>
          </>
        }
      />
    </section>
  );
}
