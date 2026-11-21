"use client";

/**
 * Agent 预设页：真实 GET /agents 列表 + 详情（GET /agents/{key}）+ 新建/改名与描述/删除。
 * 交互对齐旧页 app/(main)/system/agents/page.tsx:124-207（新建表单）与 :95-119（删除二次确认）。
 * 内置 Agent 由后端标记 builtin：改名/描述与删除都被服务端拒绝
 * （ARTEX/server/server_mgmt.go:287「内置 agent 不可修改名称/描述」、:315「内置 agent 不可删除」），
 * 因此这两类动作对内置项一律 disabled，不发请求。
 *
 * 版式（D3 设计重塑）：SettingsPage → PageHead（说明 + 刷新 + 新建）→「内置」「自定义」两个 Section；
 * 每个 Agent 一张 Card：Row（字母 tile、名称 + 类型 Badge、描述 + key/MCP/Skill/工具 元信息、⋯ 菜单）。
 * 点行展开为 Card selected 内的 AgentEditorPanel（基本信息 + 提示词/收尾/可见性/工具绑定/触发器分区），
 * 改名在「基本信息」组里就地编辑，删除走 ⋯ 菜单 + 卡内二次确认。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { IconChevronRightOutlineRegular, IconPlusOutlineRegular } from "@/vendor/dsh/primitives/icons/index";

import {
  Badge,
  Card,
  Editor,
  EditorActions,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  Meta,
  Notice,
  PageHead,
  Row,
  RowMenu,
  Section,
  SettingsPage,
  Skeleton,
  TextArea,
  TextInput,
  Tile,
} from "@/components/v2/design/Kit";
import type { Agent } from "@/lib/types";
import { AGENT_KEY_PATTERN, createAgent, deleteAgent, updateAgentMeta, useAgents } from "@/v2/data/agents";
import { AgentEditorPanel } from "./AgentEditor";
import { RefreshButton } from "./InterceptAdvanced";
import { toast } from "./Toast";
import own from "./AgentPresetsPage.module.css";

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 行首字母 tile：名称首字（中文取首字，英文取大写首字母）。 */
function AgentGlyph({ name }: { name: string }): React.ReactNode {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <Tile>
      <span className={own.glyph} aria-hidden="true">
        {letter}
      </span>
    </Tile>
  );
}

/** 改名 + 描述表单：只写 PATCH /agents/{key} 支持的两个字段（嵌在编辑器「基本信息」组里）。 */
function AgentMetaForm({
  agent,
  onSaved,
  onCancel,
}: {
  agent: Agent;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const dirty = name !== agent.name || description !== (agent.description ?? "");

  const save = (): void => {
    if (name.trim() === "") {
      setFailure("名称不能为空（后端 PATCH /agents/{key} 会拒绝空名称）。");
      return;
    }
    setSaving(true);
    setFailure(null);
    void updateAgentMeta(agent.key, name.trim(), description.trim())
      .then(() => {
        toast(`已保存 Agent「${name.trim()}」`);
        onSaved();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={own.basics} data-agent-form="edit">
      <FieldGrid>
        <Field label="名称" htmlFor={`${uid}-name`}>
          <TextInput
            id={`${uid}-name`}
            aria-label="Agent 名称"
            placeholder="如 研究助手"
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field label="Key" htmlFor={`${uid}-key`} hint="创建后不可修改。">
          <TextInput id={`${uid}-key`} mono value={agent.key} disabled readOnly aria-label="Agent Key（只读）" />
        </Field>
        <Field label="描述" htmlFor={`${uid}-desc`} span optional>
          <TextArea
            id={`${uid}-desc`}
            className={own.short}
            aria-label="Agent 描述"
            rows={2}
            placeholder="一句话说明这个 Agent 是干什么的"
            value={description}
            disabled={saving}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </Field>
      </FieldGrid>
      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
      <EditorActions>
        <Button variant="ghost" size="sm" disabled={saving} aria-label="取消编辑" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving || !dirty} aria-label="保存名称与描述" onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </EditorActions>
    </div>
  );
}

/** 新建表单：key 按后端正则校验（server_mgmt.go:65），重名由后端返回 409。 */
function AgentCreateCard({
  onCreated,
  onCancel,
}: {
  onCreated: (key: string) => void;
  onCancel: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const keyOk = AGENT_KEY_PATTERN.test(key.trim());
  const canCreate = keyOk && name.trim() !== "" && !saving;

  const create = (): void => {
    setSaving(true);
    setFailure(null);
    void createAgent({ key: key.trim(), name: name.trim(), description: description.trim() })
      .then((agent) => {
        toast(`已创建 Agent「${agent.name}」`);
        onCreated(agent.key);
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <Card selected data={{ "data-agent-form": "create" }}>
      <Row
        lead={
          <Tile>
            <IconPlusOutlineRegular size={14} />
          </Tile>
        }
        label="新建自定义 Agent"
        description="创建后再在编辑器里配置提示词、模型、工具与触发器。"
      />
      <Editor inCard>
        <EditorGroup>
          <FieldGrid>
            <Field
              label="Key"
              htmlFor={`${uid}-key`}
              hint="小写字母开头，仅含小写字母 / 数字 / 下划线；创建后不可更改。"
            >
              <TextInput
                id={`${uid}-key`}
                mono
                aria-label="新 Agent Key"
                placeholder="research_helper"
                value={key}
                disabled={saving}
                onChange={(event) => setKey(event.currentTarget.value)}
              />
            </Field>
            <Field label="名称" htmlFor={`${uid}-name`}>
              <TextInput
                id={`${uid}-name`}
                aria-label="新 Agent 名称"
                placeholder="如 研究助手"
                value={name}
                disabled={saving}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
            <Field label="描述" htmlFor={`${uid}-desc`} span optional>
              <TextArea
                id={`${uid}-desc`}
                className={own.short}
                aria-label="新 Agent 描述"
                rows={2}
                placeholder="一句话说明这个 Agent 是干什么的"
                value={description}
                disabled={saving}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </Field>
          </FieldGrid>
        </EditorGroup>
        {key.trim() !== "" && !keyOk ? <Notice tone="warning">key 不符合后端规则，无法创建。</Notice> : null}
        {failure === null ? null : <Notice tone="danger">{failure}</Notice>}
        <EditorActions>
          <Button variant="ghost" size="sm" disabled={saving} aria-label="取消新建" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={!canCreate} aria-label="创建 Agent" onClick={create}>
            {saving ? "创建中…" : "创建"}
          </Button>
        </EditorActions>
      </Editor>
    </Card>
  );
}

/** 一个 Agent：摘要行（点击展开）+ 展开后的编辑器；改名在编辑器里，删除走 ⋯ 菜单 + 卡内确认。 */
function AgentCard({
  agent,
  open,
  onToggle,
  onChanged,
  onGone,
}: {
  agent: Agent;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onGone: () => void;
}): React.ReactNode {
  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // 收起时丢掉就地状态，避免下次展开还停在改名表单里。
  React.useEffect(() => {
    if (open) return;
    setEditing(false);
    setFailure(null);
  }, [open]);

  const remove = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteAgent(agent.key)
      .then(() => {
        toast(`已删除 Agent「${agent.name}」`);
        onGone();
      })
      .catch((reason: unknown) => setFailure(errorText(reason)))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  const description = agent.description ?? "";
  const builtin = agent.builtin ? "true" : "false";

  return (
    <Card selected={open}>
      <Row
        data={{ "data-agent-card": agent.key, "data-agent-builtin": builtin }}
        onClick={onToggle}
        muted={!agent.enabled}
        lead={<AgentGlyph name={agent.name} />}
        label={agent.name}
        labelAdornment={
          <>
            <Badge tone={agent.builtin ? "neutral" : "info"}>{agent.builtin ? "内置" : "自定义"}</Badge>
            {agent.enabled ? null : <Badge tone="warning">已停用</Badge>}
          </>
        }
        description={
          <span className={own.summary}>
            <span className={description === "" ? `${own.summaryText} ${own.summaryEmpty}` : own.summaryText} title={description}>
              {description === "" ? "无描述" : description}
            </span>
            <Meta
              items={[
                <span key="key" className={own.mono}>
                  {agent.key}
                </span>,
                <span key="mcp" className={own.tabular}>{`MCP ${agent.mcp_count ?? 0}`}</span>,
                <span key="skill" className={own.tabular}>{`Skill ${agent.skill_count ?? 0}`}</span>,
                <span key="tool" className={own.tabular}>{`工具 ${agent.tool_count ?? 0}`}</span>,
              ]}
            />
          </span>
        }
      >
        <span className={own.rowTrail}>
          <RowMenu
            label={`${agent.name} 的更多操作`}
            disabled={busy}
            items={[
              {
                label: open ? "收起编辑器" : "打开编辑器",
                onSelect: onToggle,
                data: { "data-agent-action": "open" },
              },
              {
                label: "编辑名称与描述",
                disabled: agent.builtin,
                onSelect: () => {
                  if (!open) onToggle();
                  setEditing(true);
                },
                data: { "data-agent-action": "edit" },
              },
              {
                label: agent.builtin ? "删除 Agent（内置不可删）" : "删除 Agent",
                danger: true,
                separatorBefore: true,
                disabled: agent.builtin,
                onSelect: () => setConfirming(true),
                data: { "data-agent-action": "delete" },
              },
            ]}
          />
          <span className={`${own.chevron} ${open ? own.chevronOpen : ""}`} aria-hidden="true">
            <IconChevronRightOutlineRegular size={14} />
          </span>
        </span>
      </Row>

      {confirming ? (
        <div className={own.cardNotice}>
          <Notice
            tone="danger"
            action={
              <span className={own.noticeActions}>
                <Button variant="ghost" size="sm" disabled={busy} aria-label="取消删除" onClick={() => setConfirming(false)}>
                  取消
                </Button>
                <Button variant="outline" size="sm" disabled={busy} aria-label="确认删除 Agent" onClick={remove}>
                  {busy ? "删除中…" : "确认删除"}
                </Button>
              </span>
            }
          >
            删除「{agent.name}」将一并删除它的提示词、变量、可见性与工具绑定，且不可撤销。
          </Notice>
        </div>
      ) : null}
      {failure === null ? null : (
        <div className={own.cardNotice}>
          <Notice tone="danger">{failure}</Notice>
        </div>
      )}

      {open ? (
        <div data-agent-pane={agent.key} data-agent-builtin={builtin}>
          <AgentEditorPanel
            agentKey={agent.key}
            onSaved={onChanged}
            metaEditor={
              editing ? (
                <AgentMetaForm
                  agent={agent}
                  onSaved={() => {
                    setEditing(false);
                    onChanged();
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : undefined
            }
            metaAction={
              agent.builtin ? (
                <span className={own.hint} title="server_mgmt.go:287、:315">
                  内置 Agent 名称与描述不可修改
                </span>
              ) : editing ? undefined : (
                <Button variant="ghost" size="sm" aria-label="编辑名称与描述" disabled={busy} onClick={() => setEditing(true)}>
                  编辑
                </Button>
              )
            }
          />
        </div>
      ) : null}
    </Card>
  );
}

/** Agent 预设：列表 + 新建 / 改名 / 删除 / 编辑器。 */
export function AgentPresetsPage(): React.ReactNode {
  const agents = useAgents();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const head = (lead: React.ReactNode): React.ReactNode => (
    <PageHead
      title="Agent 预设"
      lead={lead}
      actions={
        <>
          <RefreshButton label="刷新 Agent 预设" onClick={agents.reload} spinning={agents.phase === "loading"} />
          <Button
            variant="primary"
            size="sm"
            aria-label="新建 Agent"
            icon={<IconPlusOutlineRegular size={14} />}
            disabled={creating}
            onClick={() => {
              setCreating(true);
              setSelected(null);
            }}
          >
            新建 Agent
          </Button>
        </>
      }
    />
  );

  // 首次读取时给骨架；已有列表时不要整页切走 —— 否则写操作后的
  // agents.reload() 会把整个面板（含正在编辑的提示词草稿）卸载掉。
  if (agents.phase === "loading" && agents.agents.length === 0) {
    return (
      <SettingsPage data={{ "data-agent-presets-phase": "loading" }}>
        {head("管理各个 Agent 的提示词、模型、工具与触发器。")}
        <Card>
          <Skeleton label="读取 Agent 预设" />
        </Card>
      </SettingsPage>
    );
  }
  if (agents.phase === "offline") {
    return (
      <SettingsPage data={{ "data-agent-presets-phase": "offline" }}>
        {head("管理各个 Agent 的提示词、模型、工具与触发器。")}
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={agents.reload}>
              重新读取
            </Button>
          }
        >
          未连接后端（读不到 Agent 预设）{agents.error === null ? "" : `：${agents.error}`}
        </Notice>
      </SettingsPage>
    );
  }

  const builtinList = agents.agents.filter((agent) => agent.builtin);
  const customList = agents.agents.filter((agent) => !agent.builtin);

  const renderCard = (agent: Agent): React.ReactNode => (
    <AgentCard
      key={agent.key}
      agent={agent}
      open={agent.key === selected}
      onToggle={() => {
        setCreating(false);
        setSelected((value) => (value === agent.key ? null : agent.key));
      }}
      onChanged={agents.reload}
      onGone={() => {
        setSelected(null);
        agents.reload();
      }}
    />
  );

  return (
    <SettingsPage data={{ "data-agent-presets-phase": "ready" }}>
      {head(
        `${agents.agents.length} 个 Agent（内置 ${builtinList.length} · 自定义 ${customList.length}）。展开一项即可编辑提示词、模型、可见性、工具绑定与触发器。`,
      )}

      {creating ? (
        <AgentCreateCard
          onCreated={(key) => {
            setCreating(false);
            setSelected(key);
            agents.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {builtinList.length === 0 ? null : (
        <Section title="内置" count={builtinList.length} hint="名称与描述由系统维护，提示词与配置可调。">
          {builtinList.map(renderCard)}
        </Section>
      )}

      <Section title="自定义" count={customList.length} hint="可改名、删除，并支持触发器。">
        {customList.length === 0 ? (
          <Card>
            <Empty
              inCard
              icon={<IconPlusOutlineRegular size={16} />}
              title="还没有自定义 Agent"
              text="新建一个自定义 Agent，给它专门的提示词、工具与触发器。"
              action={
                creating ? undefined : (
                  <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                    新建 Agent
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          customList.map(renderCard)
        )}
      </Section>
    </SettingsPage>
  );
}
