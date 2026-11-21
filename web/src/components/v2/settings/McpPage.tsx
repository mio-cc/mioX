"use client";

/**
 * 设置分节「MCP」：外部 MCP 工具服务器的管理页。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/mcp/page.tsx:362-430（卡片列表：名称 / transport 标记 /
 *   启用 Switch / 删除 / 工具数 / 按 Agent 的可见性勾选）、:231-329（添加/编辑表单：传输方式、
 *   名称、命令、参数、远程 URL、请求头/环境变量）、:331-360（工具明细 + 刷新）、:200-209（删除）。
 * DSH 依据：DSH 无 MCP 管理页；按 设置分节 扩展（总表 §4.3）。
 *
 * 版式（D3 设计重塑）：SettingsPage → PageHead（说明 + 刷新）→ Section「服务器」：每个服务器一张
 * Card，摘要 Row = 传输字形 tile · 名称 · 传输 Badge + 启用 Dot · 命令/URL 等宽截断；行尾「工具 n」
 * 展开钮 + 启用 Switch + ⋯ 菜单（工具明细 / 编辑 / 刷新工具 / 删除）。工具明细与 Agent 可见性在卡内
 * 填充面板里展开；编辑在卡内展开 kit Editor；列表末尾 AddSlot 展开新增 Editor。
 * 对照表行：P3:M1 P3:M2 P3:M3 P3:M4 P3:M5 P3:M6
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import {
  IconApiOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCodeOutlineRegular,
  IconGlobeOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import {
  AddSlot,
  AddSlots,
  Badge,
  Card,
  Dot,
  Editor,
  EditorActions,
  EditorGroup,
  Empty,
  Field,
  FieldGrid,
  IconButton,
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
import shared from "./SettingsDialog.module.css";
import own from "./McpPage.module.css";

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

/** 卡内展开的是哪一块：工具明细 / 编辑器 / 都不展开。 */
type CardPanel = "tools" | "edit" | null;

/** 把异常转成可展示文案。 */
function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

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

/** 服务器的启动方式一行：stdio 是命令 + 参数，远程是 URL。 */
function endpointOf(server: MCPServer): string {
  return server.transport === "stdio" ? [server.command ?? "", ...(server.args ?? [])].join(" ").trim() : (server.url ?? "");
}

/** 传输字形：本地进程用代码符号，远程端点用地球。 */
function TransportGlyph({ transport }: { transport: McpTransport }): React.ReactNode {
  return <Tile>{transport === "stdio" ? <IconCodeOutlineRegular size={15} /> : <IconGlobeOutlineRegular size={15} />}</Tile>;
}

/** 可见性：按 Agent 开关，写入走 POST /visibility/toggle。 */
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
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setBusy(null));
  };

  const body = (): React.ReactNode => {
    if (agents.phase === "loading") return <p className={own.panelState}>读取 Agent 列表…</p>;
    if (agents.phase === "offline") {
      return (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={agents.reload}>
              重新读取
            </Button>
          }
        >
          未连接后端（读不到 Agent 列表）{agents.error === null ? "" : `：${agents.error}`}
        </Notice>
      );
    }
    if (agents.agents.length === 0) return <p className={own.panelState}>暂无 Agent</p>;
    if (visibleIds === undefined) {
      return <p className={own.panelState}>可见性读取中…（读不到时不会勾选任何 Agent，避免误判为已授权）</p>;
    }
    return agents.agents.map((agent) => {
      const checked = visibleIds.includes(agent.id);
      return (
        <Row
          key={agent.id}
          lead={<Tile small>{(agent.name.trim()[0] ?? "?").toUpperCase()}</Tile>}
          label={agent.name}
          muted={!checked}
          description={checked ? "可调用该服务器的工具" : "不可见"}
          data={{ "data-mcp-visibility-agent": agent.id }}
        >
          <Switch
            checked={checked}
            disabled={busy !== null}
            label={`${agent.name} 可见该 MCP 服务器`}
            onChange={(next) => toggle(agent.id, agent.name, next)}
          />
        </Row>
      );
    });
  };

  const ready = agents.phase === "ready" && agents.agents.length > 0 && visibleIds !== undefined;
  return (
    <div className={own.panelGroup} data-mcp-visibility={scope}>
      <div className={own.panelHead}>
        <span className={own.panelTitle}>Agent 可见性</span>
        {ready ? (
          <span className={own.panelCount}>
            {agents.agents.filter((agent) => visibleIds.includes(agent.id)).length}/{agents.agents.length}
          </span>
        ) : null}
        <span className={own.panelHint}>只有被授权的 Agent 能发现并调用这里的工具</span>
      </div>
      {agents.phase === "offline" ? body() : <div className={own.innerCard}>{body()}</div>}
      {failure === null ? null : <Notice tone="danger">可见性保存失败：{failure}</Notice>}
    </div>
  );
}

/** 一个服务器的工具明细：GET /mcp/{id}/tools，四种状态齐全。 */
function ToolsPanel({ serverId, onRefresh, refreshing }: { serverId: number; onRefresh: () => void; refreshing: boolean }): React.ReactNode {
  const tools = useMcpTools(serverId);
  const count = tools.phase === "ready" ? tools.tools.length : null;

  const body = (): React.ReactNode => {
    if (tools.phase === "idle" || tools.phase === "loading") {
      return (
        <div className={own.innerCard}>
          <Skeleton label="读取工具列表" />
        </div>
      );
    }
    if (tools.phase === "offline") {
      return (
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={tools.reload}>
              重试
            </Button>
          }
        >
          读取失败：{tools.error}
        </Notice>
      );
    }
    if (tools.tools.length === 0) {
      return (
        <div className={own.innerCard}>
          <Empty inCard icon={<IconApiOutlineRegular size={18} />} title="尚未发现工具" text="点右上角「刷新工具」重新连接服务器并拉取工具清单。" />
        </div>
      );
    }
    return (
      <div className={`${own.innerCard} ${own.innerScroll}`}>
        {tools.tools.map((tool: MCPTool) => (
          <Row
            key={tool.name}
            top
            label={<span className={own.toolName}>{tool.name}</span>}
            description={
              tool.description === "" ? (
                "（无说明）"
              ) : (
                <span className={own.toolDesc} title={tool.description}>
                  {tool.description}
                </span>
              )
            }
            data={{ "data-mcp-tool": tool.name }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={own.panelGroup}>
      <div className={own.panelHead}>
        <span className={own.panelTitle}>工具</span>
        {count === null ? null : <span className={own.panelCount}>{count}</span>}
        <span className={own.panelHint}>来自服务器的 tools/list，缓存在本地</span>
        <span className={own.panelActions}>
          <Button variant="ghost" size="sm" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "刷新中…" : "刷新工具"}
          </Button>
        </span>
      </div>
      {body()}
    </div>
  );
}

/** 服务器卡：摘要行（启用 Switch、名称/类型/命令、工具展开、⋯ 菜单），卡内展开工具明细或编辑器。 */
function ServerCard({
  server,
  visibleIds,
  onChanged,
}: {
  server: MCPServer;
  visibleIds: string[] | undefined;
  onChanged: () => void;
}): React.ReactNode {
  const [panel, setPanel] = React.useState<CardPanel>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const toggleEnabled = (next: boolean): void => {
    setBusy(true);
    setFailure(null);
    void setMcpServerEnabled(server, next)
      .then(() => {
        toast(next ? "服务器已启用" : "服务器已停用");
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setBusy(false));
  };

  const reloadTools = (): void => {
    setBusy(true);
    setRefreshing(true);
    setFailure(null);
    void refreshMcpServer(server.id)
      .then((tools) => {
        toast(`发现 ${tools.length} 个工具`);
        onChanged();
      })
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => {
        setBusy(false);
        setRefreshing(false);
      });
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
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setBusy(false));
  };

  const togglePanel = (next: Exclude<CardPanel, null>): void => setPanel((value) => (value === next ? null : next));

  const toolCount = server.tools?.length ?? 0;
  const endpoint = endpointOf(server);

  return (
    <Card selected={panel !== null} data={{ "data-mcp-server-id": String(server.id), "data-mcp-transport": server.transport }}>
      <Row
        lead={<TransportGlyph transport={server.transport} />}
        label={server.name}
        muted={!server.enabled}
        labelAdornment={
          <>
            <Badge>{server.transport}</Badge>
            <Dot tone={server.enabled ? "success" : "neutral"} title={server.enabled ? "已启用" : "已停用"} />
          </>
        }
        description={
          <Meta
            items={[
              endpoint === "" ? (
                "未配置启动方式"
              ) : (
                <span key="endpoint" className={own.command} title={endpoint}>
                  {endpoint}
                </span>
              ),
              server.enabled ? "已启用" : "已停用",
              Object.keys(server.env ?? {}).length > 0
                ? `${server.transport === "stdio" ? "环境变量" : "请求头"} ${Object.keys(server.env ?? {}).length} 项`
                : null,
              server.transport !== "stdio" && server.insecure === true ? "跳过 TLS 校验" : null,
            ]}
          />
        }
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={busy && !refreshing}
          aria-expanded={panel === "tools"}
          aria-label={panel === "tools" ? "收起工具明细" : "展开工具明细"}
          data-mcp-tools-toggle={String(server.id)}
          onClick={() => togglePanel("tools")}
        >
          <span className={own.toolsToggle}>
            {toolCount > 0 ? `${toolCount} 个工具` : "无工具"}
            <span className={`${own.toolsChevron} ${panel === "tools" ? own.toolsChevronOpen : ""}`}>
              <IconChevronRightOutlineRegular size={12} />
            </span>
          </span>
        </Button>
        <Switch checked={server.enabled} disabled={busy} label={`启用 MCP 服务器 ${server.name}`} onChange={toggleEnabled} />
        <RowMenu
          label={`MCP 服务器 ${server.name} 的更多操作`}
          disabled={busy}
          data={{ "data-mcp-more": String(server.id) }}
          items={[
            { label: panel === "tools" ? "收起工具明细" : "工具明细", onSelect: () => togglePanel("tools"), data: { "data-mcp-tools": String(server.id) } },
            { label: panel === "edit" ? "收起编辑" : "编辑", onSelect: () => togglePanel("edit"), data: { "data-mcp-edit": String(server.id) } },
            { label: "刷新工具", onSelect: reloadTools, data: { "data-mcp-refresh": String(server.id) } },
            {
              label: "删除",
              danger: true,
              separatorBefore: true,
              onSelect: () => setDeleting(true),
              data: { "data-mcp-delete": String(server.id) },
            },
          ]}
        />
      </Row>

      {failure === null || deleting ? null : (
        <div className={own.cardNotice}>
          <Notice tone="danger">{failure}</Notice>
        </div>
      )}

      {panel === "tools" ? (
        <div className={own.panel} data-mcp-tools-for={server.id}>
          <ToolsPanel serverId={server.id} onRefresh={reloadTools} refreshing={refreshing} />
          <VisibilityRow serverId={server.id} visibleIds={visibleIds} scope="list" onChanged={onChanged} />
        </div>
      ) : null}

      {panel === "edit" ? (
        <ServerEditor
          server={server}
          onSaved={() => {
            setPanel(null);
            onChanged();
          }}
          onCancel={() => setPanel(null)}
          onRequestDelete={() => setDeleting(true)}
        />
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
            <Button variant="primary" size="sm" disabled={busy} onClick={confirmDelete} data-mcp-delete-confirm="">
              {busy ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className={own.dialogStack}>
          <div className={own.targetBox}>
            <TransportGlyph transport={server.transport} />
            <span className={own.targetText}>
              <span className={own.targetName}>{server.name}</span>
              <Meta items={[server.transport, toolCount > 0 ? `${toolCount} 个工具` : "无工具"]} />
            </span>
          </div>
          <p className={own.dialogText}>已连接的 Agent 会在下一次工具发现时失去这些工具。删除后需要重新添加服务器。</p>
          {failure === null ? null : <Notice tone="danger">删除失败：{failure}</Notice>}
        </div>
      </Modal>
    </Card>
  );
}

/** 添加 / 编辑编辑器：字段按传输方式切换，只提交真实存在的字段。 */
function ServerEditor({
  server,
  onSaved,
  onCancel,
  onRequestDelete,
}: {
  server: MCPServer | null;
  onSaved: () => void;
  onCancel: () => void;
  /** 编辑已有服务器时，底栏左侧的删除入口（打开二次确认）。 */
  onRequestDelete?: () => void;
}): React.ReactNode {
  const uid = React.useId();
  const [draft, setDraft] = React.useState<ServerDraft>(() => (server === null ? EMPTY_DRAFT : draftFromServer(server)));
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
      .catch((reason: unknown) => setFailure(reasonText(reason)))
      .finally(() => setSaving(false));
  };

  const remote = draft.transport !== "stdio";

  return (
    <Editor inCard data={{ "data-mcp-editor": server === null ? "new" : String(server.id) }}>
      <EditorGroup title="连接">
        <FieldGrid>
          <Field label="名称" htmlFor={`${uid}-name`} hint="在工具名前作为命名空间，建议用短横线小写。">
            <TextInput
              id={`${uid}-name`}
              mono
              aria-label="MCP 服务器名称"
              placeholder="server-name"
              value={draft.name}
              disabled={saving}
              onChange={(event) => set({ name: event.currentTarget.value })}
            />
          </Field>
          <Field label="传输方式" htmlFor={`${uid}-transport`} hint={remote ? "连接远程 MCP 端点。" : "在本机起一个子进程，经标准输入输出通信。"}>
            <SelectMenu
              id={`${uid}-transport`}
              value={draft.transport}
              options={TRANSPORT_OPTIONS}
              disabled={saving}
              ariaLabel="传输方式"
              onChange={(value) => set({ transport: value === "http" ? "http" : value === "sse" ? "sse" : "stdio" })}
            />
          </Field>
          {remote ? (
            <Field label="远程 URL" htmlFor={`${uid}-url`} span>
              <TextInput
                id={`${uid}-url`}
                mono
                aria-label="远程 URL"
                placeholder="https://host/mcp"
                value={draft.url}
                disabled={saving}
                onChange={(event) => set({ url: event.currentTarget.value })}
              />
            </Field>
          ) : (
            <>
              <Field label="命令" htmlFor={`${uid}-command`}>
                <TextInput
                  id={`${uid}-command`}
                  mono
                  aria-label="启动命令"
                  placeholder="npx"
                  value={draft.command}
                  disabled={saving}
                  onChange={(event) => set({ command: event.currentTarget.value })}
                />
              </Field>
              <Field label="参数" htmlFor={`${uid}-args`} hint="空格分隔" optional>
                <TextInput
                  id={`${uid}-args`}
                  mono
                  aria-label="启动参数"
                  placeholder="-y mcp-server"
                  value={draft.args}
                  disabled={saving}
                  onChange={(event) => set({ args: event.currentTarget.value })}
                />
              </Field>
            </>
          )}
        </FieldGrid>
      </EditorGroup>

      <EditorGroup title={remote ? "请求头与安全" : "环境变量"}>
        <Field
          label={remote ? "请求头" : "环境变量"}
          htmlFor={`${uid}-env`}
          optional
          hint={remote ? "每行一个 KEY=VALUE，如 Authorization=Bearer …" : "每行一个 KEY=VALUE，只传给这个子进程。"}
        >
          <TextArea
            id={`${uid}-env`}
            mono
            className={own.envArea}
            aria-label={remote ? "请求头" : "环境变量"}
            rows={4}
            value={draft.env}
            disabled={saving}
            onChange={(event) => set({ env: event.currentTarget.value })}
          />
        </Field>
        {remote ? (
          <div className={shared.optionCard}>
            <Row label="跳过 TLS 证书校验" description="仅用于自签证书的内网端点；会失去中间人防护。">
              <Switch checked={draft.insecure} disabled={saving} label="跳过 TLS 证书校验" onChange={(next) => set({ insecure: next })} />
            </Row>
          </div>
        ) : null}
      </EditorGroup>

      {failure === null ? null : <Notice tone="danger">{failure}</Notice>}

      <EditorActions
        start={
          server === null || onRequestDelete === undefined ? undefined : (
            <button type="button" className={shared.dangerBtn} disabled={saving} onClick={onRequestDelete}>
              删除服务器
            </button>
          )
        }
      >
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>
          {saving ? "保存中…" : server === null ? "添加" : "保存"}
        </Button>
      </EditorActions>
    </Editor>
  );
}

export function McpPage(): React.ReactNode {
  const servers = useMcpServers();
  const [adding, setAdding] = React.useState(false);

  const refresh = (
    <IconButton label="刷新" spinning={servers.phase === "loading"} onClick={servers.reload}>
      <IconRefreshOutlineRegular size={14} />
    </IconButton>
  );

  if (servers.phase === "loading") {
    return (
      <SettingsPage data={{ "data-settings-mcp": "loading" }}>
        <PageHead title="MCP" lead="外部 MCP 工具服务器：本地进程或远程端点，按 Agent 授权可见。" actions={refresh} />
        <Card>
          <Skeleton label="读取 MCP 服务器" />
        </Card>
      </SettingsPage>
    );
  }
  if (servers.phase === "offline") {
    return (
      <SettingsPage data={{ "data-settings-mcp": "offline" }}>
        <PageHead title="MCP" lead="外部 MCP 工具服务器：本地进程或远程端点，按 Agent 授权可见。" actions={refresh} />
        <Notice
          tone="danger"
          action={
            <Button variant="ghost" size="sm" onClick={servers.reload}>
              重新读取
            </Button>
          }
        >
          未连接后端（读不到 MCP 服务器）{servers.error === null ? "" : `：${servers.error}`}
        </Notice>
      </SettingsPage>
    );
  }

  const list = servers.servers;
  const enabledCount = list.filter((server) => server.enabled).length;
  const toolTotal = list.reduce((sum, server) => sum + (server.tools?.length ?? 0), 0);

  return (
    <SettingsPage data={{ "data-settings-mcp": "ready" }}>
      <PageHead
        title="MCP"
        lead={
          list.length === 0
            ? "接入外部 MCP 工具服务器，让 Agent 获得新的工具。"
            : `${list.length} 个服务器，${enabledCount} 个已启用，共缓存 ${toolTotal} 个工具。每个服务器按 Agent 单独授权可见。`
        }
        actions={refresh}
      />

      <Section title="服务器" count={list.length === 0 ? undefined : list.length} hint={list.length === 0 ? undefined : "stdio 在本机起进程 · http / sse 连接远程端点"}>
        {list.length === 0 && !adding ? (
          <Card>
            <Empty
              inCard
              icon={<IconApiOutlineRegular size={18} />}
              title="还没有 MCP 服务器"
              text="添加一个服务器并刷新工具后，被授权的 Agent 就能调用它提供的工具。"
            />
          </Card>
        ) : null}

        {list.map((server) => (
          <ServerCard key={server.id} server={server} visibleIds={servers.visibility[server.id]} onChanged={servers.reload} />
        ))}

        {adding ? (
          <Card selected data={{ "data-mcp-new": "" }}>
            <Row
              lead={
                <Tile>
                  <IconPlusOutlineRegular size={15} />
                </Tile>
              }
              label="添加 MCP 服务器"
              description="保存后在卡片的 ⋯ 菜单里「刷新工具」拉取工具清单。"
            />
            <ServerEditor
              server={null}
              onSaved={() => {
                setAdding(false);
                servers.reload();
              }}
              onCancel={() => setAdding(false)}
            />
          </Card>
        ) : (
          <AddSlots>
            <AddSlot data={{ "data-mcp-add": "" }} onClick={() => setAdding(true)}>
              <IconPlusOutlineRegular size={13} /> 添加 MCP 服务器
            </AddSlot>
          </AddSlots>
        )}
      </Section>
    </SettingsPage>
  );
}
