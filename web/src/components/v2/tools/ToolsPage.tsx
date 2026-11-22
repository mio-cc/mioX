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
 *
 * 版式（D3 设计重塑）：SettingsPage → PageHead（计数说明 + 刷新）→ FilterBar（内置 / 自定义，带计数）+ 搜索框
 * → 主从分栏：左 = 内置按语义分组（每组成一个 kit Section：眉题 + 数目 + Card 行列表，组序固定见
 * BUILTIN_GROUPS，组内按 key 稳定排序），自定义列表末尾 AddSlot 新建；
 * 右 = Card 内的 kit Editor（描述 / 参数表 / 状态与绑定 …），底栏 EditorActions；未选中时是 Empty。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconCodeOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconSlidersTwoOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import {
  AddSlot,
  Badge,
  Card,
  Dot,
  Editor,
  EditorActions,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  FilterBar,
  IconButton,
  Meta,
  Notice,
  PageHead,
  Row,
  Section,
  SettingsPage,
  Skeleton,
  TextArea,
  TextInput,
  UnitInput,
} from "@/components/v2/design/Kit";
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
import shared from "../settings/SettingsDialog.module.css";
import css from "./ToolsPage.module.css";

const KIND_OPTIONS = CUSTOM_TOOL_KINDS.map((kind) => ({ value: kind, label: kind }));

type Tab = "builtin" | "custom";

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
 * 内置工具分组（DX-S1，2026-11-21）。
 *
 * 分组依据：后端 GET /tools（`Tool`，见 lib/types.ts）只有 key/system/kind 等字段，没有
 * category/group；kind 对内置行恒为 "builtin"。因此按 key 命名规则归组，不写死 key 名单：
 * - 大写驼峰 key（Monitor/TaskList/TaskOutput/TaskStop）是 harness 会话工具的移植命名，自成一组；
 * - 其余小写 key 是平台的业务处理器，按语义前缀（intent/work/task/asset/compan/scope/
 *   fact/graph/hint/goal/constraint/finding/report/traffic/memory/team/skill/mcp/custom_tool/
 *   llm_profile）从前到后先命中先归组，组序固定；
 * - 没被任何谓词命中的 key 落到「其它」兜底组（目前为空），不丢行。
 * 组内按 key 字典序稳定排序（key 全 ASCII）。
 */
const BUILTIN_GROUPS: readonly { id: string; title: string; test: RegExp }[] = [
  { id: "session", title: "会话监控", test: /^[A-Z]/ },
  { id: "taskctl", title: "任务派发", test: /^(add_intent|kill_work|list_tasks|pause_task|spawn_task|steer_work)$/ },
  { id: "tasktrace", title: "任务过程", test: /^(get_task_|list_task_|get_worker_(output|trace)|search_.*worker_traces)/ },
  { id: "assets", title: "资产与范围", test: /(asset|compan|scope)/ },
  { id: "graph", title: "图谱与事实", test: /^(add_hint|add_task_hint|expand_digest|graph_overview|list_facts|list_findings|node_detail|record_fact)$/ },
  { id: "goal", title: "目标与约束", test: /(goal|constraint)/ },
  { id: "finding", title: "漏洞与复测", test: /(finding|report)/ },
  { id: "traffic", title: "流量取证", test: /^traffic_/ },
  { id: "memory", title: "记忆与团队", test: /(memory|^team_)/ },
  { id: "platform", title: "平台扩展", test: /(custom_tool|_mcp$|skill|llm_profile)/ },
];

interface BuiltinGroup {
  id: string;
  title: string;
  tools: Tool[];
}

/** 把过滤后的内置工具装进上述固定顺序的组；空组不渲染，组内稳定排序。 */
function groupBuiltinTools(tools: Tool[]): BuiltinGroup[] {
  const buckets = BUILTIN_GROUPS.map((group): BuiltinGroup => ({ id: group.id, title: group.title, tools: [] }));
  const rest: BuiltinGroup = { id: "other", title: "其它", tools: [] };
  for (const tool of tools) {
    const index = BUILTIN_GROUPS.findIndex((group) => group.test.test(tool.key));
    (index === -1 ? rest : buckets[index]).tools.push(tool);
  }
  const groups = [...buckets, rest].filter((group) => group.tools.length > 0);
  for (const group of groups) group.tools.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

/**
 * 工具目录页主体：两个子页（内置 / 自定义），共用一条搜索框。
 * @returns 设置弹窗「工具」分节的整页内容。
 */
export function ToolsPage(): React.ReactNode {
  const catalog = useToolsCatalog();
  const agents = useAgents();
  const [tab, setTab] = React.useState<Tab>("builtin");
  const [query, setQuery] = React.useState("");

  const refresh = (
    <IconButton label="重新读取工具目录" spinning={catalog.phase === "loading"} onClick={catalog.reload}>
      <IconRefreshOutlineRegular size={14} />
    </IconButton>
  );

  if (catalog.phase === "loading") {
    return (
      <SettingsPage data={{ "data-tools-page": "loading" }}>
        <PageHead title="工具" lead="内置工具与自定义工具的描述、参数与 Agent 绑定。" actions={refresh} />
        <Card>
          <Skeleton label="读取工具目录" />
        </Card>
      </SettingsPage>
    );
  }
  if (catalog.phase === "offline") {
    return (
      <SettingsPage data={{ "data-tools-page": "offline" }}>
        <PageHead title="工具" lead="内置工具与自定义工具的描述、参数与 Agent 绑定。" actions={refresh} />
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={catalog.reload}>
              重试
            </Button>
          }
        >
          读取失败：{catalog.error ?? "未连接后端"}
        </Notice>
      </SettingsPage>
    );
  }

  const builtin = catalog.tools.filter((tool) => tool.system === true);
  // isCustomTool 本身就是 system !== true；早先写成 !isCustomTool(tool)，
  // 会把全部内置工具也数进「自定义」（DX-S1 修复）。
  const custom = catalog.tools.filter((tool) => isCustomTool(tool));
  const agentKeys = agents.agents.map((agent) => agent.key);

  return (
    <SettingsPage data={{ "data-tools-page": "ready" }}>
      <PageHead
        title="工具"
        lead={`内置 ${builtin.length} 个 · 自定义 ${custom.length} 个。内置工具的参数名与类型由后端处理器固定，只能改描述、参数说明、默认值与绑定。`}
        actions={refresh}
      />

      <div className={css.filterRow}>
        <span data-tools-tabs="">
          <FilterBar<Tab>
            id="tools-tab"
            label="工具分类"
            value={tab}
            onChange={setTab}
            options={[
              { value: "builtin", label: "内置工具", count: builtin.length, data: { "data-tools-tab": "builtin" } },
              { value: "custom", label: "自定义工具", count: custom.length, data: { "data-tools-tab": "custom" } },
            ]}
          />
        </span>
        <label className={css.search}>
          <span className={css.searchIcon}>
            <IconSearchOutlineRegular size={14} />
          </span>
          <TextInput
            className={css.searchInput}
            value={query}
            placeholder="搜索名称 / 描述 / 绑定的 Agent"
            aria-label="搜索工具"
            data-tools-search=""
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {tab === "builtin" ? (
        <BuiltinTab tools={builtin} query={query} agentKeys={agentKeys} onChanged={catalog.reload} />
      ) : (
        <CustomTab tools={custom} query={query} agentKeys={agentKeys} onChanged={catalog.reload} />
      )}
    </SettingsPage>
  );
}

/** 列表行：等宽名称 + 两行描述 + 参数 / 绑定 / 启用元信息。 */
function ToolRow({
  tool,
  active,
  kind,
  onClick,
}: {
  tool: Tool;
  active: boolean;
  kind?: string;
  onClick: () => void;
}): React.ReactNode {
  const params = countParams(tool.schema);
  return (
    <Row
      data={{ "data-tool-row": tool.key }}
      className={active ? css.rowActive : undefined}
      onClick={onClick}
      muted={!tool.enabled}
      label={<span className={css.key}>{tool.key}</span>}
      labelAdornment={kind === undefined ? null : <Badge>{kind}</Badge>}
      description={
        <span className={css.desc}>
          <span className={tool.description === "" ? `${css.clamp2} ${css.dimmed}` : css.clamp2}>
            {tool.description === "" ? "无描述" : tool.description}
          </span>
          <Meta
            items={[
              <span key="p" className={css.tabular}>{`${params} 参数`}</span>,
              <span key="b" className={css.tabular}>{`绑定 ${tool.agents.length}`}</span>,
              <span key="e">
                <Dot tone={tool.enabled ? "success" : "neutral"} />
                {tool.enabled ? "启用" : "停用"}
              </span>,
            ]}
          />
        </span>
      }
    />
  );
}

/** 内置工具子页：列表 + 选中行的编辑器。 */
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
  const groups = groupBuiltinTools(rows);
  const current = rows.find((tool) => tool.key === selected) ?? null;

  return (
    <div className={css.split} id="tools-tab-builtin-panel" role="tabpanel" aria-labelledby="tools-tab-builtin">
      <div className={css.master}>
        {rows.length === 0 ? (
          <Card>
            <Empty
              inCard
              icon={<IconSearchOutlineRegular size={16} />}
              title={query.trim() === "" ? "没有内置工具" : "没有匹配的内置工具"}
              text={query.trim() === "" ? "后端没有返回 system 工具。" : "换个关键词，或清空搜索。"}
            />
          </Card>
        ) : (
          <div className={css.masterScroll} data-tool-groups={groups.length}>
            {groups.map((group) => (
              <Section key={group.id} title={group.title} count={group.tools.length} data={{ "data-tool-group": group.id }}>
                <Card className={css.groupCard}>
                  {group.tools.map((tool) => (
                    <ToolRow
                      key={tool.key}
                      tool={tool}
                      active={tool.key === selected}
                      onClick={() => setSelected(tool.key === selected ? null : tool.key)}
                    />
                  ))}
                </Card>
              </Section>
            ))}
          </div>
        )}
      </div>
      <div className={css.detail}>
        {current === null ? (
          <Card className={css.placeholder}>
            <Empty
              inCard
              icon={<IconSlidersTwoOutlineRegular size={16} />}
              title="选择一个内置工具"
              text="在左侧选中一个工具，查看并编辑它的描述、参数说明与 Agent 绑定。"
            />
          </Card>
        ) : (
          <BuiltinEditor key={current.key} tool={current} agentKeys={agentKeys} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

/** 编辑器卡头：等宽名称 + 类型 Badge + 一行元信息。 */
function EditorHead({ title, badge, meta }: { title: React.ReactNode; badge: React.ReactNode; meta: React.ReactNode[] }): React.ReactNode {
  return (
    <Row
      lead={
        <span className={shared.providerGlyph} aria-hidden="true">
          <IconCodeOutlineRegular size={14} />
        </span>
      }
      label={<span className={css.key}>{title}</span>}
      labelAdornment={badge}
      description={<Meta items={meta} />}
    />
  );
}

/** Agent 绑定复选网格。 */
function BindGrid({
  agentKeys,
  bound,
  disabled,
  hook,
  onToggle,
}: {
  agentKeys: string[];
  bound: string[];
  disabled: boolean;
  hook: "data-tool-bind" | "data-custom-bind";
  onToggle: (agentKey: string, next: boolean) => void;
}): React.ReactNode {
  if (agentKeys.length === 0) return <p className={css.hint}>读不到 Agent 列表。</p>;
  return (
    <div className={css.bindGrid} data-tool-bind-list="">
      {agentKeys.map((agentKey) => (
        <span className={css.bindItem} key={agentKey} {...{ [hook]: agentKey }} title={agentKey}>
          <Checkbox
            checked={bound.includes(agentKey)}
            label={agentKey}
            disabled={disabled}
            onChange={(next) => onToggle(agentKey, next)}
          />
        </span>
      ))}
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
  const uid = React.useId();
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
    setSchemaRows((rows) => rows.map((row) => (row.name === name && row.parentKey === parentKey ? { ...row, ...patch } : row)));
  };

  return (
    <Card selected className={css.editorCard} data={{ "data-builtin-editor": tool.key }}>
      <EditorHead
        title={tool.key}
        badge={<Badge>内置</Badge>}
        meta={[
          "参数名与类型不可改",
          <span key="calls" className={css.tabular}>{`调用 ${tool.calls ?? 0} 次`}</span>,
        ]}
      />
      <Editor inCard>
        <EditorGroup title="描述">
          <TextArea
            id={`${uid}-desc`}
            aria-label="工具描述"
            data-tool-field="description"
            value={description}
            rows={3}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </EditorGroup>

        <EditorGroup
          title={
            <span className={css.groupHead}>
              参数
              <span className={css.groupCount}>{schemaRows.length}</span>
            </span>
          }
        >
          {schemaRows.length === 0 ? (
            <p className={css.hint}>该工具没有参数。</p>
          ) : (
            <div className={css.params}>
              {schemaRows.map((row) => (
                <div className={css.paramRow} key={`${row.parentKey ?? ""}.${row.name}`} data-tool-param={row.name}>
                  <div className={css.paramName}>
                    <span className={css.paramKey}>{row.parentKey === undefined ? row.name : `${row.parentKey}[].${row.name}`}</span>
                    <span className={css.paramTags}>
                      <Badge>{row.type === "" ? "any" : row.type}</Badge>
                      {row.required ? <Badge tone="info">必填</Badge> : null}
                    </span>
                  </div>
                  <TextInput
                    value={row.description}
                    placeholder="参数说明"
                    aria-label={`${row.name} 参数说明`}
                    disabled={busy}
                    onChange={(event) => editRow(row.name, row.parentKey, { description: event.target.value })}
                  />
                  <TextInput
                    mono
                    value={row.defaultStr}
                    placeholder={row.scalar ? "默认值（可留空）" : "非标量，无默认值"}
                    aria-label={`${row.name} 默认值`}
                    disabled={busy || !row.scalar}
                    data-tool-param-default={row.name}
                    onChange={(event) => editRow(row.name, row.parentKey, { defaultStr: event.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
        </EditorGroup>

        <EditorGroup title="状态与绑定">
          <div className={`${shared.optionCard} ${css.optionRows}`}>
            <Row label="启用" description="停用的工具不会出现在任何 Agent 的工具清单里；开关立即写入。">
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
            </Row>
          </div>
          <Field label={`绑定 Agent（${bound.length}）`} hint="勾选立即写入绑定列表。">
            <BindGrid
              agentKeys={agentKeys}
              bound={bound}
              disabled={busy}
              hook="data-tool-bind"
              onToggle={(agentKey, next) =>
                void run(
                  () => setToolBinding(tool, agentKey, next).then(() => undefined),
                  next ? `已绑定 ${agentKey}` : `已解绑 ${agentKey}`,
                )
              }
            />
          </Field>
        </EditorGroup>

        {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}

        <EditorActions
          start={
            <Button variant="ghost" size="sm" data-tool-reset="" disabled={busy} onClick={() => setResetOpen(true)}>
              恢复默认
            </Button>
          }
        >
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
        </EditorActions>
      </Editor>

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
    </Card>
  );
}

/** 自定义工具子页：列表 + 新建/编辑表单。 */
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
    <div className={css.split} id="tools-tab-custom-panel" role="tabpanel" aria-labelledby="tools-tab-custom">
      <div className={css.master}>
        {rows.length === 0 ? (
          <Card>
            <Empty
              inCard
              icon={<IconCodeOutlineRegular size={16} />}
              title={tools.length === 0 ? "还没有自定义工具" : "没有匹配的自定义工具"}
              text={
                tools.length === 0
                  ? "把一条命令、一段 Python 脚本或一个 HTTP 接口包装成 Agent 可调用的工具。"
                  : "换个关键词，或清空搜索。"
              }
            />
          </Card>
        ) : (
          <Card className={css.listCard}>
            {rows.map((tool) => (
              <ToolRow
                key={tool.key}
                tool={tool}
                kind={rowKindLabel(tool)}
                active={tool.key === editing}
                onClick={() => setEditing(tool.key)}
              />
            ))}
          </Card>
        )}
        <AddSlot data={{ "data-custom-new": "" }} disabled={editing === "new"} onClick={() => setEditing("new")}>
          <IconPlusOutlineRegular size={13} /> 新建自定义工具
        </AddSlot>
      </div>
      <div className={css.detail}>
        {editing === null ? (
          <Card className={css.placeholder}>
            <Empty
              inCard
              icon={<IconSlidersTwoOutlineRegular size={16} />}
              title="选择或新建一个自定义工具"
              text="编辑执行规格、参数 Schema 与绑定，保存前可以先测试运行。"
            />
          </Card>
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
  const num = (key: string, fallback: string): string => (typeof exec[key] === "number" ? String(exec[key]) : fallback);
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
  const uid = React.useId();
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

  const timeoutField = (field: "commandTimeout" | "scriptTimeout" | "httpTimeout"): React.ReactNode => (
    <Field label="超时" htmlFor={`${uid}-${field}`}>
      <UnitInput unit="ms">
        <TextInput
          id={`${uid}-${field}`}
          inputMode="numeric"
          aria-label="超时（毫秒）"
          value={exec[field]}
          disabled={busy}
          onChange={(event) => setExecField(field, event.target.value)}
        />
      </UnitInput>
    </Field>
  );

  return (
    <Card selected className={css.editorCard} data={{ "data-custom-editor": isNew ? "new" : key }}>
      <EditorHead
        title={isNew ? "新建自定义工具" : key}
        badge={<Badge tone="info">{kind}</Badge>}
        meta={[
          "key 创建后不可改",
          isNew ? "尚未保存" : "改动需点保存",
          isNew ? null : <span key="calls" className={css.tabular}>{`调用 ${tool?.calls ?? 0} 次`}</span>,
        ]}
      />
      <Editor inCard>
        <EditorGroup title="基本信息">
          <FieldGrid>
            <Field label="Key" htmlFor={`${uid}-key`} hint={isNew ? "小写字母开头，仅小写字母 / 数字 / 下划线。" : undefined}>
              <TextInput
                id={`${uid}-key`}
                mono
                value={key}
                data-custom-key=""
                placeholder="my_tool"
                disabled={busy || !isNew}
                onChange={(event) => setKey(event.target.value)}
              />
            </Field>
            <Field label="类型">
              <span data-custom-kind={kind}>
                <FilterBar
                  id="custom-tool-kind"
                  label="自定义工具类型"
                  value={kind}
                  options={KIND_OPTIONS}
                  disabled={busy}
                  onChange={(next) => setKind(next as CustomToolKind)}
                />
              </span>
            </Field>
            <Field label="描述" htmlFor={`${uid}-desc`} span>
              <TextArea
                id={`${uid}-desc`}
                className={css.short}
                rows={2}
                data-custom-description=""
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </FieldGrid>
        </EditorGroup>

        <EditorGroup title={`执行规格 · ${kind}`}>
          {kind === "shell" ? (
            <Notice>shell 类型只作为环境提示进入 Bash 工具描述，不产生可调用工具，也没有执行规格。</Notice>
          ) : null}

          {kind === "command" ? (
            <FieldGrid>
              <Field label="命令模板" htmlFor={`${uid}-command`} span hint="参数用 {name} 占位。">
                <TextArea
                  id={`${uid}-command`}
                  mono
                  className={css.code}
                  rows={3}
                  spellCheck={false}
                  data-custom-exec-command=""
                  value={exec.command}
                  disabled={busy}
                  onChange={(event) => setExecField("command", event.target.value)}
                />
              </Field>
              {timeoutField("commandTimeout")}
            </FieldGrid>
          ) : null}

          {kind === "script" ? (
            <FieldGrid>
              <Field
                label="Python 脚本"
                htmlFor={`${uid}-code`}
                span
                hint="参数 JSON 从 stdin 传入，标量同时镜像成 TOOL_<NAME> 环境变量。"
              >
                <TextArea
                  id={`${uid}-code`}
                  mono
                  className={css.codeTall}
                  rows={6}
                  spellCheck={false}
                  data-custom-exec-code=""
                  value={exec.code}
                  disabled={busy}
                  onChange={(event) => setExecField("code", event.target.value)}
                />
              </Field>
              {timeoutField("scriptTimeout")}
            </FieldGrid>
          ) : null}

          {kind === "http" ? (
            <>
              <FieldGrid columns={3}>
                <Field label="方法" htmlFor={`${uid}-method`}>
                  <TextInput
                    id={`${uid}-method`}
                    mono
                    value={exec.method}
                    disabled={busy}
                    onChange={(event) => setExecField("method", event.target.value)}
                  />
                </Field>
                {timeoutField("httpTimeout")}
                <Field label="代理" htmlFor={`${uid}-proxy`} optional>
                  <TextInput
                    id={`${uid}-proxy`}
                    mono
                    value={exec.proxy}
                    disabled={busy}
                    onChange={(event) => setExecField("proxy", event.target.value)}
                  />
                </Field>
                <Field label="URL" htmlFor={`${uid}-url`} span hint="参数用 {name} 占位。">
                  <TextInput
                    id={`${uid}-url`}
                    mono
                    value={exec.url}
                    data-custom-exec-url=""
                    placeholder="https://…"
                    disabled={busy}
                    onChange={(event) => setExecField("url", event.target.value)}
                  />
                </Field>
              </FieldGrid>
              <FieldGrid>
                <Field label="Headers" htmlFor={`${uid}-headers`} hint="JSON 对象。">
                  <TextArea
                    id={`${uid}-headers`}
                    mono
                    className={css.code}
                    rows={3}
                    spellCheck={false}
                    value={exec.headers}
                    disabled={busy}
                    onChange={(event) => setExecField("headers", event.target.value)}
                  />
                </Field>
                <Field label="请求体" htmlFor={`${uid}-body`} hint="参数用 {name} 占位。">
                  <TextArea
                    id={`${uid}-body`}
                    mono
                    className={css.code}
                    rows={3}
                    spellCheck={false}
                    value={exec.body}
                    disabled={busy}
                    onChange={(event) => setExecField("body", event.target.value)}
                  />
                </Field>
              </FieldGrid>
              <div className={`${shared.optionCard} ${css.optionRows}`}>
                <Row label="走流量录制代理" description="请求经流量录制代理转发，并信任其 CA。">
                  <Switch
                    checked={exec.useRecordingProxy}
                    label="走流量录制代理（信任其 CA）"
                    disabled={busy}
                    onChange={(next) => setExecField("useRecordingProxy", next)}
                  />
                </Row>
              </div>
            </>
          ) : null}
        </EditorGroup>

        <EditorGroup title="参数 JSON Schema">
          <TextArea
            mono
            className={css.codeTall}
            rows={5}
            spellCheck={false}
            aria-label="参数 JSON Schema"
            data-custom-schema=""
            value={schemaText}
            disabled={busy}
            onChange={(event) => setSchemaText(event.target.value)}
          />
        </EditorGroup>

        <EditorGroup title="状态与绑定">
          <div className={`${shared.optionCard} ${css.optionRows}`}>
            <Row label="启用" description="停用后不进入 Agent 工具清单。">
              <Switch checked={enabled} label="启用该自定义工具" disabled={busy} onChange={setEnabled} />
            </Row>
            <Row label="延迟 schema" description="参数 schema 走搜索 / 执行工具延迟下发，节省上下文。">
              <Switch checked={deferred} label="延迟 schema" disabled={busy} onChange={setDeferred} />
            </Row>
          </div>
          <Field label={`绑定 Agent（${agentList.length}）`} hint="随保存一起写入。">
            <BindGrid
              agentKeys={agentKeys}
              bound={agentList}
              disabled={busy}
              hook="data-custom-bind"
              onToggle={(agentKey, next) =>
                setAgentList((prev) => (next ? [...prev, agentKey] : prev.filter((item) => item !== agentKey)))
              }
            />
          </Field>
        </EditorGroup>

        <EditorGroup title="测试运行">
          <p className={css.hint}>不保存，直接按上面的执行规格执行一次；示例参数用于渲染 {"{name}"} 占位。</p>
          <TextArea
            mono
            className={css.short}
            rows={2}
            spellCheck={false}
            aria-label="示例参数（JSON 对象）"
            data-custom-test-params=""
            value={paramsText}
            disabled={busy}
            onChange={(event) => setParamsText(event.target.value)}
          />
          {output === null ? null : (
            <pre className={output.isError ? css.outputError : css.output} data-custom-test-output={output.isError ? "error" : "ok"}>
              {output.text}
            </pre>
          )}
        </EditorGroup>

        {failure === null ? null : <Notice tone="danger">操作失败：{failure}</Notice>}

        <EditorActions
          start={
            isNew ? undefined : (
              <button
                type="button"
                className={shared.dangerBtn}
                data-custom-delete=""
                disabled={busy}
                onClick={() => setDeleteOpen(true)}
              >
                删除工具
              </button>
            )
          }
        >
          <Button
            variant="outline"
            size="sm"
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
        </EditorActions>
      </Editor>

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
    </Card>
  );
}
