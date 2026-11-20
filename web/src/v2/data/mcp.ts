"use client";

/**
 * MCP 管理适配器：服务器列表、按服务器的工具缓存 / 工具明细、启用开关、
 * 新建/编辑、删除、刷新工具，以及「按 Agent 授权可见」。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/mcp/page.tsx:60-74（列表 + 可见性）、
 *   :126-135（工具明细）、:185-198（刷新工具）、:200-229（删除 / 启停 / 可见性写入）
 * DSH 依据：DSH 无 MCP 管理页；按 设置分节 扩展（总表 §4.3，ui-settings 的
 *   packages/client/ui-settings/src/client/contract/slots.ts:57 导航项语义）。
 * 对照表行：P3:M1 P3:M2 P3:M3 P3:M4 P3:M5 P3:M6
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { MCPServer, MCPTool } from "@/lib/types";

/** 后端支持的传输方式（types.ts:1251）。 */
export type McpTransport = MCPServer["transport"];

/**
 * 保存表单的输入。字段与 `POST /mcp` 接受的 body 一一对应
 * （api.ts:1228 `saveMcpServer(m: Partial<MCPServer>)`）；
 * 不带 `id` 为新建，带 `id` 为编辑，与旧页 page.tsx:169-174 的写法一致。
 */
export type McpServerInput = Partial<MCPServer>;

export type McpPhase = "loading" | "ready" | "offline";

export interface McpServersState {
  phase: McpPhase;
  servers: MCPServer[];
  /** serverId → 可见该服务器的 agent id 列表（GET /visibility/mcp/{id}）。 */
  visibility: Record<number, string[]>;
  error: string | null;
  reload: () => void;
}

/**
 * 读取 MCP 服务器列表，再逐个读取它的可见性（旧页 page.tsx:60-74 是同一套流程）。
 * 可见性失败只影响那一个服务器，不会把整个列表判成离线。
 * @returns 阶段、服务器列表、可见性映射、错误、重新读取。
 */
export function useMcpServers(): McpServersState {
  const [phase, setPhase] = useState<McpPhase>("loading");
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [visibility, setVisibility] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .mcpServers()
      .then((value) => {
        if (!alive) return;
        setServers(value);
        setPhase("ready");
        for (const server of value) {
          api
            .resourceVisibility("mcp", server.id)
            .then((agentIds) => {
              if (!alive) return;
              setVisibility((prev) => ({ ...prev, [server.id]: agentIds }));
            })
            .catch(() => {
              // 单个服务器的可见性读不到时保持未知，其余照常显示。
            });
        }
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, servers, visibility, error, reload };
}

export type McpToolsPhase = "idle" | "loading" | "ready" | "offline";

export interface McpToolsState {
  phase: McpToolsPhase;
  tools: MCPTool[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个服务器的工具明细（GET /mcp/{id}/tools，api.ts:1230）。
 * @param serverId - 服务器 id；null 表示还没展开任何服务器，不发请求。
 * @returns 阶段、工具列表、错误、重新读取。
 */
export function useMcpTools(serverId: number | null): McpToolsState {
  const [phase, setPhase] = useState<McpToolsPhase>("idle");
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (serverId === null) {
      setPhase("idle");
      setTools([]);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    api
      .mcpTools(serverId)
      .then((value) => {
        if (!alive) return;
        setTools(value);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [serverId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, tools, error, reload };
}

/**
 * 新建或编辑一个 MCP 服务器（POST /mcp，api.ts:1228）。
 * 编辑时必须带回 `id`；新建时不带 `id`，后端负责分配。
 * @param input - 表单整理后的服务器字段。
 * @returns 后端返回的服务器 id。
 */
export async function saveMcpServer(input: McpServerInput): Promise<number> {
  const result = await api.saveMcpServer(input);
  return result.id;
}

/**
 * 切换服务器的启用态。旧页 page.tsx:211-218 用整条记录回写，这里保持一致：
 * 只翻转 `enabled`，其余字段原样带回，避免丢配置。
 * @param server - 当前服务器记录。
 * @param enabled - 目标启用态。
 * @returns 后端返回的服务器 id。
 */
export async function setMcpServerEnabled(server: MCPServer, enabled: boolean): Promise<number> {
  const result = await api.saveMcpServer({ ...server, enabled });
  return result.id;
}

/**
 * 删除一个 MCP 服务器（DELETE /mcp/{id}，api.ts:1229）。
 * @param id - 服务器 id。
 */
export async function deleteMcpServer(id: number): Promise<void> {
  await api.deleteMcpServer(id);
}

/**
 * 重新发现某个服务器的工具（POST /mcp/{id}/refresh，api.ts:1231）。
 * @param id - 服务器 id。
 * @returns 后端刷新后返回的工具列表（旧页 page.tsx:189 直接用它更新界面）。
 */
export function refreshMcpServer(id: number): Promise<MCPTool[]> {
  return api.refreshMcpServer(id);
}

/**
 * 授予或撤销某个 Agent 对一个 MCP 服务器的可见性
 * （POST /visibility/toggle，api.ts:1308）。
 * @param agentId - Agent id（字符串，见 api.ts:1305 的注释）。
 * @param serverId - 服务器 id；资源类型固定 `mcp`。
 * @param visible - 目标可见态。
 */
export async function toggleMcpVisibility(agentId: string, serverId: number, visible: boolean): Promise<void> {
  await api.toggleVisibility(agentId, "mcp", serverId, visible);
}
