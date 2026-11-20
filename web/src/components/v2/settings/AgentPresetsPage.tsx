"use client";

/**
 * Agent 预设页：真实 GET /agents 列表 + 详情（GET /agents/{key}）+ 新建/改名与描述/删除。
 * 交互对齐旧页 app/(main)/system/agents/page.tsx:124-207（新建表单）与 :95-119（删除二次确认）。
 * 内置 Agent 由后端标记 builtin：改名/描述与删除都被服务端拒绝
 * （ARTEX/server/server_mgmt.go:287「内置 agent 不可修改名称/描述」、:315「内置 agent 不可删除」），
 * 因此这两类按钮对内置项一律 disabled，不发请求。
 * 「提示词与配置」展开 AgentEditorPanel：提示词/版本/变量/预览、收尾词、运行配置、
 * 可见性、工具绑定（P3-B4b，旧页 components/agent-editor.tsx）。触发器（P3:A12）不在此面板。
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { Agent, AgentDetail } from "@/lib/types";
import {
  AGENT_KEY_PATTERN,
  createAgent,
  deleteAgent,
  updateAgentMeta,
  useAgentDetail,
  useAgents,
  type AgentDetailState,
} from "@/v2/data/agents";
import { AgentEditorPanel } from "./AgentEditor";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";

/** One label/value line of the getAgent detail (`data-agent-field` is the JSON field name). */
function DetailField({ field, label, value }: { field: string; label: string; value: string }): React.ReactNode {
  return (
    <div className={css.row} data-agent-field={field}>
      <div className={css.rowText}>
        <div className={css.rowLabel}>{label}</div>
        <div className={css.rowHint}>
          <span data-agent-field-value>{value}</span>
        </div>
      </div>
    </div>
  );
}

/** 只读详情：字段值全部来自 GET /agents/{key} 的 agent 对象，不做本地推断。 */
function AgentDetailBlock({ state }: { state: AgentDetailState }): React.ReactNode {
  if (state.phase === "loading" || state.phase === "idle") {
    return <p className={css.fieldHint}>读取详情（GET /agents/{"{key}"}）…</p>;
  }
  if (state.detail === null) {
    return (
      <>
        <p className={css.fieldHint}>读不到这个 Agent 的详情。</p>
        {state.error === null ? null : <p className={css.errorLine}>{state.error}</p>}
      </>
    );
  }
  const agent: Agent = state.detail.agent;
  const description = agent.description ?? "";
  return (
    <div className={css.subSection} data-agent-detail={agent.key}>
      <div className={css.subSectionTitle}>{`详情 · GET /agents/${agent.key}`}</div>
      <DetailField field="name" label="名称" value={agent.name} />
      <DetailField field="key" label="Key" value={agent.key} />
      <DetailField field="description" label="描述" value={description === "" ? "（无描述）" : description} />
      <DetailField field="role" label="角色" value={agent.role} />
      <DetailField field="builtin" label="内置" value={agent.builtin ? "是" : "否"} />
      <DetailField field="enabled" label="已启用" value={agent.enabled ? "是" : "否"} />
    </div>
  );
}

/** 改名 + 描述表单：只写 PATCH /agents/{key} 支持的两个字段。 */
function AgentMetaForm({
  agent,
  onSaved,
  onCancel,
}: {
  agent: Agent;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const [name, setName] = React.useState(agent.name);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={css.formCard} data-agent-form="edit">
      <div className={css.subTitle}>编辑名称与描述 · {agent.key}</div>
      <label className={css.fieldLabel}>
        名称
        <input
          className={css.textField}
          aria-label="Agent 名称"
          placeholder="如 研究助手"
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label className={css.fieldLabel}>
        描述
        <textarea
          className={css.textArea}
          aria-label="Agent 描述"
          rows={2}
          placeholder="一句话说明这个 Agent 是干什么的"
          value={description}
          disabled={saving}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <p className={css.fieldHint}>key 创建后不可修改；提示词与配置在后续单元补齐。</p>
      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} aria-label="取消编辑" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} aria-label="保存名称与描述" onClick={save}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

/** 新建表单：key 按后端正则校验（server_mgmt.go:65），重名由后端返回 409。 */
function AgentCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (key: string) => void;
  onCancel: () => void;
}): React.ReactNode {
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
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={css.formCard} data-agent-form="create">
      <div className={css.subTitle}>新建自定义 Agent</div>
      <label className={css.fieldLabel}>
        Key
        <input
          className={css.textField}
          aria-label="新 Agent Key"
          placeholder="如 research_helper"
          value={key}
          disabled={saving}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
      </label>
      <p className={css.fieldHint}>小写字母开头，仅含小写字母/数字/下划线；创建后不可更改。</p>
      {key.trim() !== "" && !keyOk ? <p className={css.warn}>key 不符合后端规则，无法创建。</p> : null}
      <label className={css.fieldLabel}>
        名称
        <input
          className={css.textField}
          aria-label="新 Agent 名称"
          placeholder="如 研究助手"
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label className={css.fieldLabel}>
        描述
        <textarea
          className={css.textArea}
          aria-label="新 Agent 描述"
          rows={2}
          placeholder="一句话说明这个 Agent 是干什么的"
          value={description}
          disabled={saving}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} aria-label="取消新建" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={!canCreate} aria-label="创建 Agent" onClick={create}>
          {saving ? "创建中…" : "创建"}
        </Button>
      </div>
    </div>
  );
}

/** 右侧管理面板：选中 Agent 的详情 / 改名 / 删除（内置项禁用后两者）。 */
function AgentManagePane({
  agent,
  onChanged,
  onGone,
}: {
  agent: Agent;
  onChanged: () => void;
  onGone: () => void;
}): React.ReactNode {
  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const detail = useAgentDetail(detailOpen ? agent.key : null);

  // 换选中项时收起所有就地状态，避免把上一个 Agent 的草稿带过来。
  React.useEffect(() => {
    setEditing(false);
    setConfirming(false);
    setDetailOpen(false);
    setEditorOpen(false);
    setFailure(null);
  }, [agent.key]);

  const remove = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteAgent(agent.key)
      .then(() => {
        toast(`已删除 Agent「${agent.name}」`);
        onGone();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <div className={css.agentPane} data-agent-pane={agent.key} data-agent-builtin={agent.builtin ? "true" : "false"}>
      <div className={css.agentCardHead}>
        <span className={css.agentName}>{agent.name}</span>
        <Tag tone={agent.builtin ? "quiet" : "outline"}>{agent.builtin ? "内置" : "自定义"}</Tag>
        {agent.enabled ? null : <Tag tone="warning">已停用</Tag>}
      </div>
      <span className={css.agentKey}>{agent.key}</span>
      <p className={css.agentDesc}>{agent.description === "" ? "（无描述）" : agent.description}</p>
      <div className={css.ruleMeta}>
        <span>MCP {agent.mcp_count ?? 0}</span>
        <span>Skill {agent.skill_count ?? 0}</span>
        <span>工具 {agent.tool_count ?? 0}</span>
      </div>

      <div className={css.ruleActions}>
        <Button
          variant="outline"
          size="sm"
          aria-label="提示词与配置"
          aria-pressed={editorOpen}
          onClick={() => setEditorOpen((open) => !open)}
        >
          {editorOpen ? "收起提示词与配置" : "提示词与配置"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="查看详情"
          onClick={() => setDetailOpen((open) => !open)}
        >
          {detailOpen ? "收起详情" : "详情"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="编辑名称与描述"
          disabled={agent.builtin || busy}
          onClick={() => setEditing((open) => !open)}
        >
          编辑
        </Button>
        {confirming ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label="确认删除 Agent"
              onClick={remove}
            >
              <IconTrashOutlineRegular size={13} /> 确认删除
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label="取消删除"
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
          </>
        ) : (
          <button
            type="button"
            className={css.dangerBtn}
            data-agent-action="delete"
            aria-label="删除 Agent"
            disabled={agent.builtin || busy}
            title={agent.builtin ? "内置 Agent 不可删除" : `删除 Agent「${agent.name}」`}
            onClick={() => setConfirming(true)}
          >
            删除
          </button>
        )}
      </div>

      {agent.builtin ? (
        <p className={css.fieldHint}>
          内置 Agent 由后端标记 builtin：改名/描述与删除都会被服务端拒绝（server_mgmt.go:287、:315）。
        </p>
      ) : null}
      {confirming ? (
        <p className={css.warn}>
          删除「{agent.name}」将一并删除它的提示词、变量、可见性与工具绑定，且不可撤销。
        </p>
      ) : null}
      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}

      {editing ? (
        <AgentMetaForm
          agent={agent}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      {detailOpen ? <AgentDetailBlock state={detail} /> : null}
      {editorOpen ? <AgentEditorPanel agentKey={agent.key} onSaved={onChanged} /> : null}
    </div>
  );
}

/** Agent 预设：列表 + 新建 / 改名 / 删除 / 详情。 */
export function AgentPresetsPage(): React.ReactNode {
  const agents = useAgents();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  // 首次读取时给一行占位；已有列表时不要整页切走 —— 否则写操作后的
  // agents.reload() 会把整个面板（含正在编辑的提示词草稿）卸载掉。
  if (agents.phase === "loading" && agents.agents.length === 0) {
    return <p className={css.pageLead}>读取 Agent 预设…</p>;
  }
  if (agents.phase === "offline") {
    return (
      <>
        <p className={css.pageLead}>未连接后端（读不到 Agent 预设）</p>
        {agents.error === null ? null : <p className={css.errorLine}>{agents.error}</p>}
        <Button variant="outline" size="sm" onClick={agents.reload}>
          重新读取
        </Button>
      </>
    );
  }

  const current = agents.agents.find((agent) => agent.key === selected) ?? null;

  return (
    <div data-agent-presets-phase="ready">
      <h2 className={css.pageTitle}>Agent 预设</h2>
      <p className={css.pageLead}>
        来自 GET /agents，共 {agents.agents.length} 项。内置 Agent 只能查看详情；自定义 Agent
        可改名/描述或删除（删除需二次确认）。
      </p>
      <div className={css.pageToolbar}>
        <Button
          variant="outline"
          size="sm"
          aria-label="新建 Agent"
          onClick={() => {
            setCreating((open) => !open);
            setSelected(null);
          }}
        >
          <IconPlusOutlineRegular size={13} /> 新建 Agent
        </Button>
        <Button variant="ghost" size="sm" aria-label="刷新 Agent 预设" onClick={agents.reload}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>

      {agents.agents.length === 0 ? (
        <p className={css.pageLead}>还没有 Agent 预设；新建一个自定义 Agent 即可。</p>
      ) : (
        <div className={css.agentLayout}>
          <div className={css.agentList}>
            {agents.agents.map((agent) => (
              <button
                key={agent.key}
                type="button"
                className={`${css.agentCard} ${agent.key === selected ? css.agentCardActive : ""}`}
                data-agent-card={agent.key}
                data-agent-builtin={agent.builtin ? "true" : "false"}
                aria-label={`选择 Agent ${agent.name}`}
                aria-pressed={agent.key === selected}
                onClick={() => {
                  setCreating(false);
                  setSelected(agent.key);
                }}
              >
                <span className={css.agentCardHead}>
                  <span className={css.agentName}>{agent.name}</span>
                  <Tag tone={agent.builtin ? "quiet" : "outline"}>{agent.builtin ? "内置" : "自定义"}</Tag>
                </span>
                <span className={css.agentKey}>{agent.key}</span>
                <span className={css.agentDesc}>{agent.description === "" ? "（无描述）" : agent.description}</span>
                <span className={css.agentCounts}>
                  <span>MCP {agent.mcp_count ?? 0}</span>
                  <span>Skill {agent.skill_count ?? 0}</span>
                  <span>工具 {agent.tool_count ?? 0}</span>
                </span>
              </button>
            ))}
          </div>
          <div className={css.agentEditor}>
            {creating ? (
              <AgentCreateForm
                onCreated={(key) => {
                  setCreating(false);
                  setSelected(key);
                  agents.reload();
                }}
                onCancel={() => setCreating(false)}
              />
            ) : current === null ? (
              <p className={css.fieldHint}>从左侧选择一个 Agent：查看详情、改名/描述，或删除自定义 Agent。</p>
            ) : (
              <AgentManagePane
                key={current.key}
                agent={current}
                onChanged={agents.reload}
                onGone={() => {
                  setSelected(null);
                  agents.reload();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
