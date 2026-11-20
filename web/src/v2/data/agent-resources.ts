"use client";

/**
 * Adapter for the resources one agent can be bound to: the MCP server and skill
 * catalogs its visibility switches read (GET /mcp, GET /skills) and the tool
 * catalog whose per-agent binding the tools tab rewrites (GET /tools).
 * `ARTEX/server/server_mgmt.go` owns every endpoint behind these calls.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { MCPServer, SkillItem, Tool } from "@/lib/types";

export type AgentResourcesPhase = "loading" | "ready" | "offline";

export interface AgentResourcesState {
  phase: AgentResourcesPhase;
  mcp: MCPServer[];
  skills: SkillItem[];
  tools: Tool[];
  error: string | null;
  reload: () => void;
}

/**
 * Read the three catalogs the agent editor binds against.
 * @returns phase, the three catalogs, an error message and a reload callback.
 */
export function useAgentResources(): AgentResourcesState {
  const [phase, setPhase] = useState<AgentResourcesPhase>("loading");
  const [mcp, setMcp] = useState<MCPServer[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    Promise.all([api.mcpServers(), api.skills(), api.tools()])
      .then(([servers, skillItems, toolItems]) => {
        if (!alive) return;
        setMcp(servers);
        setSkills(skillItems);
        setTools(toolItems);
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
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, mcp, skills, tools, error, reload };
}

/**
 * Bind or unbind one agent on one tool (PUT /tools/{key}). The backend stores the
 * whole tool record, so the untouched fields are sent back verbatim.
 * @param tool the tool as last read from GET /tools.
 * @param agentKey agent to add or remove from the tool's agent list.
 * @param bound whether the agent should be bound after the write.
 * @returns the tool's agent list after the write.
 */
export async function setToolBinding(tool: Tool, agentKey: string, bound: boolean): Promise<string[]> {
  const agents = bound
    ? tool.agents.includes(agentKey)
      ? tool.agents
      : [...tool.agents, agentKey]
    : tool.agents.filter((key) => key !== agentKey);
  await api.saveTool(tool.key, {
    description: tool.description,
    schema: tool.schema,
    agents,
    enabled: tool.enabled,
  });
  return agents;
}
