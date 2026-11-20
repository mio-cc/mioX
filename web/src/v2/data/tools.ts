"use client";

/**
 * Adapter for the tool catalog (GET /tools) and the custom-tool lifecycle:
 * create (POST /tools/custom), update (PUT /tools/custom/{key}), delete
 * (DELETE /tools/custom/{key}), and the unsaved dry run (POST /tools/custom/test).
 *
 * Built-in rows are code-defined: their key, parameter names and types are welded
 * to the Go handler, so the page only moves per-parameter description/default,
 * the tool description, the agent binding and the enabled flag. Custom rows carry
 * a `kind` plus an `exec` spec that the backend executes directly.
 *
 * `ARTEX/server/server_mgmt.go` owns GET/PUT/reset of the catalog and
 * `ARTEX/server/customtool.go` owns the custom CRUD and dry run.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Tool } from "@/lib/types";

export type ToolsPhase = "loading" | "ready" | "offline";

export interface ToolsCatalog {
  phase: ToolsPhase;
  tools: Tool[];
  error: string | null;
  reload: () => void;
}

/**
 * Read the whole tool catalog once and keep it until `reload()` runs.
 * @returns phase, every tool row, the last error message and a reload callback.
 */
export function useToolsCatalog(): ToolsCatalog {
  const [phase, setPhase] = useState<ToolsPhase>("loading");
  const [tools, setTools] = useState<Tool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .tools()
      .then((rows) => {
        if (!alive) return;
        setTools(rows);
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
  return { phase, tools, error, reload };
}

/** A custom tool row is one the user defined; system rows are code-defined. */
export function isCustomTool(tool: Tool): tool is Tool & { kind: CustomToolKind } {
  return tool.system !== true;
}

export type CustomToolKind = "command" | "script" | "http" | "shell";

/** The kinds the backend accepts (`customtool.go` pgCreateCustomTool). */
export const CUSTOM_TOOL_KINDS: readonly CustomToolKind[] = ["command", "script", "http", "shell"];

/**
 * One editable parameter row of a tool's JSON Schema.
 * `name`/`type`/`required` are read-only for built-in tools.
 */
export interface ParamRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
  /** Declared default rendered as text; "" means no default. */
  defaultStr: string;
  /** Whether a default can be expressed (scalar params only). */
  scalar: boolean;
  /** Parent array parameter name for a sub-field row. */
  parentKey?: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

/**
 * Flatten a tool schema's parameters (including array-item sub-fields) into rows.
 * @param schema the tool schema as read from GET /tools.
 * @returns one row per editable parameter, in declaration order.
 */
export function paramRows(schema: JsonObject | undefined): ParamRow[] {
  const props = asObject(schema?.properties);
  if (props === null) return [];
  const required = new Set<string>(Array.isArray(schema?.required) ? (schema.required as unknown[]).map(String) : []);
  const rows: ParamRow[] = [];
  for (const [name, raw] of Object.entries(props)) {
    const param = asObject(raw) ?? {};
    const type = String(param.type ?? "");
    const hasDefault = param.default !== undefined && param.default !== null;
    rows.push({
      name,
      type,
      required: required.has(name),
      description: String(param.description ?? ""),
      defaultStr: hasDefault ? String(param.default) : "",
      scalar: ["string", "integer", "number", "boolean"].includes(type),
    });
    if (type !== "array") continue;
    const items = asObject(param.items);
    const itemProps = asObject(items?.properties);
    if (itemProps === null) continue;
    const itemRequired = new Set<string>(
      Array.isArray(items?.required) ? (items.required as unknown[]).map(String) : [],
    );
    for (const [subName, subRaw] of Object.entries(itemProps)) {
      const sub = asObject(subRaw) ?? {};
      const subType = String(sub.type ?? "");
      const subHasDefault = sub.default !== undefined && sub.default !== null;
      rows.push({
        name: subName,
        type: subType,
        required: itemRequired.has(subName),
        description: String(sub.description ?? ""),
        defaultStr: subHasDefault ? String(sub.default) : "",
        scalar: ["string", "integer", "number", "boolean"].includes(subType),
        parentKey: name,
      });
    }
  }
  return rows;
}

/**
 * Write edited descriptions and defaults back into a deep copy of the schema.
 * Parameter names, types and required flags are never touched.
 * @param schema the schema as read from the backend.
 * @param rows edited rows from `paramRows`.
 * @returns a new schema object with the same structure.
 */
export function withParamRows(schema: JsonObject | undefined, rows: ParamRow[]): JsonObject {
  const next = structuredClone(schema ?? {}) as JsonObject;
  const props = asObject(next.properties);
  for (const row of rows) {
    const target = row.parentKey === undefined ? props?.[row.name] : asObject(asObject(props?.[row.parentKey])?.items)?.properties;
    const param = asObject(asObject(target)?.[row.name]);
    if (param === null) continue;
    param.description = row.description;
    const typed = coerceDefault(row.type, row.defaultStr);
    if (typed === undefined) delete param.default;
    else param.default = typed;
  }
  return next;
}

function coerceDefault(type: string, raw: string): unknown {
  const text = raw.trim();
  if (text === "") return undefined;
  if (type === "integer" || type === "number") {
    const n = Number(text);
    return Number.isNaN(n) ? undefined : n;
  }
  if (type === "boolean") return text === "true";
  return raw;
}

/** Number of parameters a tool declares (array-item sub-fields included). */
export function countParams(schema: JsonObject | undefined): number {
  return paramRows(schema).length;
}

/** Count the `{placeholder}` slots an exec template uses, for the editor hint. */
export function templateParams(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/\{([A-Za-z_][\w]*)\}/g)) out.add(match[1]);
  return [...out];
}

export interface BuiltinToolPatch {
  description: string;
  schema: JsonObject;
  agents: string[];
  enabled: boolean;
}

/**
 * Save the editable fields of one catalog row (PUT /tools/{key}).
 * @param key tool key taken from the row; it never changes.
 * @param patch the complete editable state; untouched fields are sent verbatim.
 */
export async function saveTool(key: string, patch: BuiltinToolPatch): Promise<void> {
  await api.saveTool(key, {
    description: patch.description,
    schema: patch.schema,
    agents: patch.agents,
    enabled: patch.enabled,
  });
}

/**
 * Restore a built-in tool to its code-defined description and schema
 * (POST /tools/{key}/reset). Re-enables the tool and re-binds its seed agents.
 * @param key built-in tool key.
 */
export async function resetTool(key: string): Promise<void> {
  await api.resetTool(key);
}

/** Every field a custom tool write carries; `key` is fixed after creation. */
export interface CustomToolDraft {
  key: string;
  description: string;
  schema: JsonObject;
  agents: string[];
  enabled: boolean;
  kind: CustomToolKind;
  exec: JsonObject;
  deferred: boolean;
}

/**
 * Create a custom tool (POST /tools/custom).
 * @param draft the complete definition; the backend rejects a key that exists.
 * @returns the created key echoed by the backend.
 */
export async function createCustomTool(draft: CustomToolDraft): Promise<string> {
  const created = await api.createCustomTool({
    key: draft.key,
    description: draft.description,
    schema: draft.schema,
    agents: draft.agents,
    enabled: draft.enabled,
    kind: draft.kind,
    exec: draft.exec,
    deferred: draft.deferred,
  });
  return created.key;
}

/**
 * Replace a custom tool's definition (PUT /tools/custom/{key}).
 * @param draft the complete definition; `draft.key` must be the existing key.
 */
export async function updateCustomTool(draft: CustomToolDraft): Promise<void> {
  await api.updateCustomTool(draft.key, {
    description: draft.description,
    schema: draft.schema,
    agents: draft.agents,
    enabled: draft.enabled,
    kind: draft.kind,
    exec: draft.exec,
    deferred: draft.deferred,
  });
}

/**
 * Delete a custom tool (DELETE /tools/custom/{key}).
 * @param key custom tool key.
 */
export async function deleteCustomTool(key: string): Promise<void> {
  await api.deleteCustomTool(key);
}

/** Result of one unsaved dry run (POST /tools/custom/test). */
export interface CustomToolRun {
  output: string;
  is_error: boolean;
}

/**
 * Run one exec spec without saving it (POST /tools/custom/test). This executes
 * the command/script/request on the server, so callers must only pass
 * side-effect-free specs while auditing.
 * @param kind command | script | http.
 * @param exec the exec spec exactly as the editor holds it.
 * @param params sample parameter values substituted into the templates.
 * @returns raw output and whether the executor treated it as an error.
 */
export async function testCustomTool(
  kind: "command" | "script" | "http",
  exec: JsonObject,
  params: JsonObject,
): Promise<CustomToolRun> {
  return api.testCustomTool({ kind, exec, params });
}

/**
 * Parse the JSON text of the schema editor.
 * @param text raw textarea content.
 * @returns the parsed object, or an error message when it is not a JSON object.
 */
export function parseSchema(text: string): { value: JsonObject | null; error: string | null } {
  if (text.trim() === "") return { value: {}, error: null };
  try {
    const parsed: unknown = JSON.parse(text);
    const obj = asObject(parsed);
    if (obj === null) return { value: null, error: "schema 必须是 JSON 对象" };
    return { value: obj, error: null };
  } catch (reason: unknown) {
    return { value: null, error: reason instanceof Error ? reason.message : String(reason) };
  }
}

/**
 * Parse the JSON text of an exec spec or a dry-run parameter map.
 * @param text raw textarea content.
 * @returns the parsed object, or an error message when it is not a JSON object.
 */
export function parseJsonObject(text: string): { value: JsonObject | null; error: string | null } {
  if (text.trim() === "") return { value: {}, error: null };
  try {
    const parsed: unknown = JSON.parse(text);
    const obj = asObject(parsed);
    if (obj === null) return { value: null, error: "必须是 JSON 对象" };
    return { value: obj, error: null };
  } catch (reason: unknown) {
    return { value: null, error: reason instanceof Error ? reason.message : String(reason) };
  }
}

/** Human label of a row's kind, for the list badge. */
export function toolKindLabel(tool: Tool): string {
  if (tool.system === true) return "内置";
  return tool.kind ?? "custom";
}

/**
 * Kind of a custom (non-system) row, for the list badge. `Tool.kind`
 * (`types.ts:1312`) also admits `"builtin"`, which is not a custom kind, so such
 * a row is reported as `custom` instead of a type the editor cannot round-trip.
 * @param tool any catalog row; system rows are reported as `内置`.
 */
export function rowKindLabel(tool: Tool): string {
  if (tool.system === true) return "内置";
  const kind = tool.kind;
  return kind === undefined || kind === "builtin" ? "custom" : kind;
}

/**
 * Build the exec spec a draft of the given kind needs, keeping the fields the
 * backend's executor reads (`customtool.go` commandExec/scriptExec/httpExec).
 * @param kind the selected kind.
 * @returns an empty spec for that kind.
 */
export function emptyExec(kind: CustomToolKind): JsonObject {
  switch (kind) {
    case "command":
      return { command: "", timeout_ms: 60000 };
    case "script":
      return { code: "", timeout_ms: 120000 };
    case "http":
      return { method: "GET", url: "", headers: {}, body: "", timeout_ms: 30000, proxy: "", use_recording_proxy: false };
    case "shell":
      return {};
  }
}
