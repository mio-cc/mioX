"use client";

/**
 * 设置分节「MCP」：外部 MCP 工具服务器的管理页。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/mcp/page.tsx:362-430（卡片列表：名称 / transport 标记 /
 *   启用 Switch / 删除 / 工具数 / 按 Agent 的可见性勾选）、:231-329（添加/编辑表单：传输方式、
 *   名称、命令、参数、远程 URL、请求头/环境变量）、:331-360（工具明细 + 刷新）、:200-209（删除）。
 * DSH 依据：DSH 无 MCP 管理页；按 设置分节 扩展（总表 §4.3），行/卡片素材复用
 *   SettingsDialog.module.css（ruleList / ruleRow / formCard / fieldLabel …）。
 * 对照表行：P3:M1 P3:M2 P3:M3 P3:M4 P3:M5 P3:M6
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { MCPTool, MCPServer } from "@/lib/types";
import { useAgents } from "@/v2/data/agents";
import {
  deleteMcpServer,
  refreshMcpServer,
  saveMcpServer,
  setMcpServerEnabled,
  toggleMcpVisibility,
  useMcpServers,
  useMcpTools,
  type McpTransport,
} from "@/v2/data/mcp";
import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";

const TRANSPORT_OPTIONS = [
  { value: "stdio", label: "stdio（本地起进程）" },
  { value: "http", label: "http（远程 Streamable HTTP）" },
  { value: "sse", label: "sse（旧版远程 SSE）" },
] as const;

/** 表单草稿；`env` 保持多行文本形态，提交时再解析成键值对。 */
interface ServerDraft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
  insecure: boolean;
}

const EMPTY_DRAFT: ServerDraft = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  insecure: false,
};

/**
 * 把多行「KEY=VALUE」文本解析成对象；没有 `=` 或键为空的行忽略
 * （与旧页 page.tsx:83-95 的 parseEnv 一致）。
 * @param text - 用户输入的多行文本。
 * @returns 键值对。
 */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (key !== "") out[key] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

/**
 * 把已存的环境变量渲染回多行文本（旧页 page.tsx:96-100 的 envToText）。
 * @param env - 服务器上已存的键值对。
 * @returns 每行一个 `KEY=VALUE` 的文本。
 */
function envToText(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/** 把一条服务器记录转成表单草稿。 */
function draftFromServer(server: MCPServer): ServerDraft {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join(" "),
    url: server.url ?? "",
    env: envToText(server.env),
    insecure: server.insecure === true,
  };
}

/** 列表里的状态标记：名字 + 类型 + 工具数 + 启用态。 */
function ServerTags({ server }: { server: MCPServer }): React.ReactNode {
  const toolCount = server.tools?.length ?? 0;
  return (
    <>
      <Tag tone="outline">{server.transport}</Tag>
      <Tag tone={toolCount > 0 ? "neutral" : "quiet"}>
        {toolCount > 0 ? `${toolCount} 个工具` : "尚未发现工具"}
      </Tag>
      <Tag tone={server.enabled ? "success" : "quiet"}>{server.enabled ? "已启用" : "已停用"}</Tag>
    </>
  );
}

/** 可见性：按 Agent 勾选，写入走 POST /visibility/toggle。 */
function VisibilityRow({
  serverId,
  visibleIds,
  scope,
  onChanged,
}: {
  serverId: number;
  visibleIds: string[] | undefined;
  scope: "group" | "list";
  onChanged: () => void;
}): React.ReactNode {
  const agents = useAgents();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggle = (agentId: string, agentName: string, next: boolean): void => {
    setBusy(agentId);
    setFailure(null);
    void toggleMcpVisibility(agentId, serverId, next)
      .then(() => {
        toast(`${next ? "授予" : "取消"}「${agentName}」可见`);
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(null));
  };

  const body = (): React.ReactNode => {
    if (agents.phase === "loading") return <p className={css.fieldHint}>读取 Agent 列表…</p>;
    if (agents.phase === "offline") {
      return (
        <>
          <p className={css.fieldHint}>未连接后端（读不到 Agent 列表）</p>
          {agents.error === null ? null : <p className={css.errorLine}>{agents.error}</p>}
          <Button variant="outline" size="sm" onClick={agents.reload}>
            重新读取
          </Button>
        </>
      );
    }
    if (agents.agents.length === 0) return <p className={css.fieldHint}>暂无 Agent</p>;
    if (visibleIds === undefined) {
      return (
        <p className={css.fieldHint}>
          可见性读取中…（读不到时不会勾选任何 Agent，避免误判为已授权）
        </p>
      );
    }
    return (
      <div className={css.ruleMeta}>
        {agents.agents.map((agent) => {
          const checked = visibleIds.includes(agent.id);
          return (
            <span key={agent.id} className={css.checkInline} data-mcp-visibility-agent={agent.id}>
              <Switch
                checked={checked}
                disabled={busy !== null}
                label={`${agent.name} 可见该 MCP 服务器`}
                onChange={(next) => toggle(agent.id, agent.name, next)}
              />
              <span>{agent.name}</span>
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div data-mcp-visibility={scope} style={scope === "group" ? { display: "flex", flexDirection: "column", gap: 4 } : undefined}>
      {body()}
      {failure === null ? null : <p className={css.errorLine}>可见性保存失败：{failure}</p>}
    </div>
  );
}

/** 服务器行：启用 Switch、名称/类型/工具数、展开工具、编辑、刷新、删除（二次确认）。 */
function ServerRow({
  server,
  visibleIds,
  onChanged,
}: {
  server: MCPServer;
  visibleIds: string[] | undefined;
  onChanged: () => void;
}): React.ReactNode {
  const [expanded, setExpanded] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggleEnabled = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void setMcpServerEnabled(server, next)
      .then(() => {
        toast(next ? "服务器已启用" : "服务器已停用");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const reloadTools = (): void => {
    setBusy(true);
    setFailure(null);
    void refreshMcpServer(server.id)
      .then((tools) => {
        toast(`发现 ${tools.length} 个工具`);
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  const confirmDelete = (): void => {
    setBusy(true);
    setFailure(null);
    void deleteMcpServer(server.id)
      .then(() => {
        toast(`已删除：${server.name}`);
        setDeleting(false);
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  if (editing) {
    return (
      <ServerForm
        server={server}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <>
      <div className={css.ruleRow} data-mcp-server-id={server.id} data-mcp-transport={server.transport}>
        <Switch
          checked={server.enabled}
          disabled={busy}
          label={`启用 MCP 服务器 ${server.name}`}
          onChange={toggleEnabled}
        />
        <div className={css.ruleMain}>
          <div className={css.ruleMeta}>
            <span className={css.rowLabel}>{server.name}</span>
            <ServerTags server={server} />
          </div>
          <div className={css.ruleMeta}>
            {server.transport === "stdio" ? (
              <span className={css.rulePattern}>
                {[server.command ?? "", ...(server.args ?? [])].join(" ")}
              </span>
            ) : (
              <span className={css.rulePattern}>{server.url ?? ""}</span>
            )}
          </div>
          {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
        </div>
        <div className={css.ruleActions}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起工具" : "工具明细"}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
            编辑
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={reloadTools}>
            <IconRefreshOutlineRegular size={13} /> 刷新工具
          </Button>
          <button type="button" className={css.dangerBtn} disabled={busy} onClick={() => setDeleting(true)}>
            <IconTrashOutlineRegular size={13} /> 删除
          </button>
        </div>
      </div>

      {expanded ? (
        <div data-mcp-tools-for={server.id} style={{ paddingLeft: 12 }}>
          <ToolsPanel serverId={server.id} />
          <div className={css.subSection}>
            <div className={css.subSectionTitle}>可见性（按 Agent 授权）</div>
            <VisibilityRow serverId={server.id} visibleIds={visibleIds} scope="list" onChanged={onChanged} />
          </div>
        </div>
      ) : null}

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="确认删除 MCP 服务器"
        closeLabel="关闭"
        tone="warning"
        description={`将永久删除「${server.name}」及其已缓存的工具列表，以及所有 Agent 对它的可见性授权；此操作不可撤销。`}
        footer={
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleting(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={confirmDelete}>
              {busy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className={css.dialogBodyText}>
          已连接的 Agent 会在下一次工具发现时失去这些工具。删除后需要重新添加服务器。
        </p>
        {failure === null ? null : <p className={css.errorLine}>删除失败：{failure}</p>}
      </Modal>
    </>
  );
}

/** 一个服务器的工具明细：GET /mcp/{id}/tools，四种状态齐全。 */
function ToolsPanel({ serverId }: { serverId: number }): React.ReactNode {
  const tools = useMcpTools(serverId);

  if (tools.phase === "idle" || tools.phase === "loading") {
    return <p className={css.fieldHint}>读取工具列表…</p>;
  }
  if (tools.phase === "offline") {
    return (
      <>
        <p className={css.fieldHint}>读取失败：{tools.error}</p>
        <Button variant="outline" size="sm" onClick={tools.reload}>
          重试
        </Button>
      </>
    );
  }
  if (tools.tools.length === 0) {
    return <p className={css.fieldHint}>尚未发现工具，点该服务器的「刷新工具」重新获取。</p>;
  }
  return (
    <div className={css.deliveryList}>
      {tools.tools.map((tool: MCPTool) => (
        <div key={tool.name} className={css.deliveryRow} data-mcp-tool={tool.name}>
          <span className={css.rulePattern}>{tool.name}</span>
          {tool.description === "" ? null : (
            <span className={css.deliveryError} title={tool.description}>
              {tool.description}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** 添加 / 编辑表单：字段按传输方式切换，只提交真实存在的字段。 */
function ServerForm({
  server,
  onSaved,
  onCancel,
}: {
  server: MCPServer | null;
  onSaved: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const [draft, setDraft] = React.useState<ServerDraft>(() =>
    server === null ? EMPTY_DRAFT : draftFromServer(server),
  );
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const set = (patch: Partial<ServerDraft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  const save = (): void => {
    if (draft.name.trim() === "") {
      setFailure("请填写名称。");
      return;
    }
    if (draft.transport === "stdio" && draft.command.trim() === "") {
      setFailure("stdio 传输需要填写命令。");
      return;
    }
    if (draft.transport !== "stdio" && draft.url.trim() === "") {
      setFailure("远程传输需要填写 URL。");
      return;
    }
    setSaving(true);
    setFailure(null);
    const payload =
      draft.transport === "stdio"
        ? {
            transport: "stdio" as const,
            command: draft.command.trim(),
            args: draft.args.trim() === "" ? [] : draft.args.trim().split(/\s+/),
            env: parseEnv(draft.env),
            insecure: false,
            url: "",
          }
        : {
            transport: draft.transport,
            command: "",
            args: [] as string[],
            url: draft.url.trim(),
            // 远程模式下 env 即请求头（旧页 page.tsx:152-168）。
            env: parseEnv(draft.env),
            insecure: draft.insecure,
          };
    void saveMcpServer({
      ...(server === null ? {} : { id: server.id }),
      name: draft.name.trim(),
      enabled: server === null ? true : server.enabled,
      ...payload,
    })
      .then(() => {
        toast(server === null ? "MCP 服务器已添加" : "MCP 服务器已保存");
        onSaved();
      })
      .catch((reason: unknown) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setSaving(false));
  };

  const remote = draft.transport !== "stdio";

  return (
    <div className={css.formCard}>
      <div className={css.subTitle}>
        {server === null ? "添加 MCP 服务器" : `编辑 MCP 服务器 · ${server.name}`}
      </div>
      <p className={css.fieldHint}>
        stdio 在本地起进程；http / sse 连接远程 MCP 端点。保存后点列表上的「刷新工具」拉取工具清单。
      </p>

      <div className={css.formRow}>
        <div className={css.fieldBlock} style={{ flex: "0 0 220px" }}>
          <div className={css.fieldLabel}>传输方式</div>
          <SelectMenu
            value={draft.transport}
            options={TRANSPORT_OPTIONS}
            disabled={saving}
            ariaLabel="传输方式"
            onChange={(value) =>
              set({ transport: value === "http" ? "http" : value === "sse" ? "sse" : "stdio" })
            }
          />
        </div>
      </div>

      <label className={css.fieldLabel}>
        名称
        <input
          className={css.textField}
          aria-label="MCP 服务器名称"
          placeholder="server-name"
          value={draft.name}
          disabled={saving}
          onChange={(event) => set({ name: event.currentTarget.value })}
        />
      </label>

      {remote ? (
        <label className={css.fieldLabel}>
          远程 URL
          <input
            className={css.textField}
            aria-label="远程 URL"
            placeholder="https://host/mcp"
            value={draft.url}
            disabled={saving}
            onChange={(event) => set({ url: event.currentTarget.value })}
          />
        </label>
      ) : (
        <>
          <label className={css.fieldLabel}>
            命令
            <input
              className={css.textField}
              aria-label="启动命令"
              placeholder="npx"
              value={draft.command}
              disabled={saving}
              onChange={(event) => set({ command: event.currentTarget.value })}
            />
          </label>
          <label className={css.fieldLabel}>
            参数（空格分隔）
            <input
              className={css.textField}
              aria-label="启动参数"
              placeholder="-y mcp-server"
              value={draft.args}
              disabled={saving}
              onChange={(event) => set({ args: event.currentTarget.value })}
            />
          </label>
        </>
      )}

      {remote ? (
        <div className={css.checkInline} style={{ marginTop: 12 }}>
          <Switch
            checked={draft.insecure}
            disabled={saving}
            label="跳过 TLS 证书校验"
            onChange={(next) => set({ insecure: next })}
          />
          <span>跳过 TLS 证书校验（自签证书）</span>
        </div>
      ) : null}

      <label className={css.fieldLabel}>
        {remote ? "请求头（每行 KEY=VALUE，如 Authorization=Bearer …）" : "环境变量（每行 KEY=VALUE）"}
        <textarea
          className={css.textArea}
          aria-label={remote ? "请求头" : "环境变量"}
          rows={4}
          value={draft.env}
          disabled={saving}
          onChange={(event) => set({ env: event.currentTarget.value })}
        />
      </label>

      {failure === null ? null : <p className={css.errorLine}>{failure}</p>}
      <div className={css.formActions}>
        <Button variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : server === null ? "添加" : "保存"}
        </Button>
      </div>
    </div>
  );
}

export function McpPage(): React.ReactNode {
  const servers = useMcpServers();
  const [adding, setAdding] = React.useState(false);

  if (servers.phase === "loading") return <p className={css.pageLead}>读取 MCP 服务器…</p>;
  if (servers.phase === "offline") {
    return (
      <>
        <h2 className={css.pageTitle}>MCP</h2>
        <p className={css.pageLead}>未连接后端（读不到 MCP 服务器）</p>
        {servers.error === null ? null : <p className={css.errorLine}>{servers.error}</p>}
        <Button variant="outline" size="sm" onClick={servers.reload}>
          重新读取
        </Button>
      </>
    );
  }

  return (
    <>
      <h2 className={css.pageTitle}>MCP</h2>
      <p className={css.pageLead}>
        来自 GET /mcp，共 {servers.servers.length} 个外部 MCP 工具服务器 · 按 Agent 授权可见。
      </p>
      <div className={css.pageToolbar}>
        <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
          <IconPlusOutlineRegular size={13} /> 添加 MCP 服务器
        </Button>
        <Button variant="ghost" size="sm" onClick={servers.reload}>
          <IconRefreshOutlineRegular size={13} /> 刷新
        </Button>
      </div>

      {adding ? (
        <ServerForm
          server={null}
          onSaved={() => {
            setAdding(false);
            servers.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {servers.servers.length === 0 ? (
        <p className={css.pageLead}>暂无 MCP 服务器；点「添加 MCP 服务器」新建一个。</p>
      ) : (
        <div className={css.ruleList}>
          {servers.servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              visibleIds={servers.visibility[server.id]}
              onChanged={servers.reload}
            />
          ))}
        </div>
      )}
    </>
  );
}
