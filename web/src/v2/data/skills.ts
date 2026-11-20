"use client";

/**
 * 技能（Skill）适配器：技能库列表与调用统计、被点名但缺失的技能、
 * 新建技能、上传 zip、删除技能；技能详情的文件树 / 文件读写 / 元数据 /
 * 调用明细 / 按 Agent 可见性（B03，见文件下半部）。
 * 旧页面依据：ARTEX/web/src/app/(main)/system/skills/page.tsx:343-356（load：skills / missing）、
 *   :156-175（调用排行 / 最近调用 / 从未使用的聚合口径）、:567-579（新建入参）、
 *   :360-386（上传 zip 与「覆盖同名」）、:500-512（删除）；
 *   :66-124（文件树拼接与排序）、:396-420（选中后拉调用明细 / 文件内容）、
 *   :446-537（新建文件 / 文件夹、删除路径、保存）、:539-565（MCP 关联与可见性）。
 * DSH 依据：DSH 无技能库管理页；按 设置分节 扩展（总表 §4.3，
 *   packages/client/ui-settings/src/client/contract/slots.ts:57 导航项语义）。
 * 对照表行：P3:K1 P3:K2 P3:K3 P3:K4 P3:K5 P3:K6 P3:K7 P3:K8 P3:K9 P3:K10 P3:K11 P3:K12
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { MissingSkill, SkillCall, SkillItem } from "@/lib/types";

export type SkillsPhase = "loading" | "ready" | "offline";

/**
 * 新建技能的入参，与 `POST /skills` 接受的 body 一致
 * （api.ts:1264-1271 `createSkill(s)`；旧页 page.tsx:573-579 只传非空可选字段）。
 */
export interface SkillCreateInput {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  mcps?: string[];
  instructions?: string;
}

export interface SkillsState {
  phase: SkillsPhase;
  skills: SkillItem[];
  /** null 表示缺口清单这次没读到（接口失败），与「读到且为空」区分开。 */
  missing: MissingSkill[] | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取技能库：先读 `GET /skills`（api.ts:1263），成功后并发读
 * `GET /skills/missing?limit=20`（api.ts:1302，旧页 page.tsx:347 也是 limit 默认 20）。
 * 缺口接口失败只让 `missing` 为 null，不把整个页面判成离线。
 * @returns 阶段、技能列表、缺失清单、错误、重新读取。
 */
export function useSkills(): SkillsState {
  const [phase, setPhase] = useState<SkillsPhase>("loading");
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [missing, setMissing] = useState<MissingSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .skills()
      .then((value) => {
        if (!alive) return;
        setSkills(value);
        setMissing(null);
        setPhase("ready");
        api
          .missingSkills()
          .then((list) => {
            if (!alive) return;
            setMissing(list);
          })
          .catch(() => {
            // 缺口清单是辅助信息：读不到就保持 null，界面隐藏该块。
          });
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
  return { phase, skills, missing, error, reload };
}

/**
 * 新建一个技能（POST /skills，api.ts:1264-1271）。
 * 旧页 page.tsx:575-578：license / compatibility / mcps / instructions 为空时不传。
 * @param input - 表单整理后的技能字段。
 * @returns 后端返回的技能名称。
 */
export async function createSkill(input: SkillCreateInput): Promise<string> {
  const result = await api.createSkill({
    name: input.name,
    description: input.description,
    ...(input.license === undefined || input.license === "" ? {} : { license: input.license }),
    ...(input.compatibility === undefined || input.compatibility === ""
      ? {}
      : { compatibility: input.compatibility }),
    ...(input.mcps === undefined || input.mcps.length === 0 ? {} : { mcps: input.mcps }),
    ...(input.instructions === undefined || input.instructions === ""
      ? {}
      : { instructions: input.instructions }),
  });
  return result.name;
}

/**
 * 从 .zip 安装一个技能（POST /skills/upload，api.ts:1274-1287，multipart）。
 * 后端失败时抛出的 Error 消息里带中文原因（如「已存在」「缺少 SKILL.md」），直接展示。
 * @param file - 用户选的 zip 文件。
 * @param overwrite - 是否覆盖同名技能（写入 `?overwrite=true`）。
 * @returns 后端返回的技能名称与写入的文件数。
 */
export function uploadSkillZip(file: File, overwrite = false): Promise<{ name: string; files: number }> {
  return api.uploadSkill(file, overwrite);
}

/**
 * 删除一个技能（DELETE /skills/{name}，api.ts:1288）。
 * @param name - 技能目录名（唯一键，types.ts:1270）。
 */
export async function deleteSkill(name: string): Promise<void> {
  await api.deleteSkill(name);
}

/** 调用排行里的一行。 */
export interface SkillRankRow {
  name: string;
  calls: number;
}

/** 最近调用里的一行。 */
export interface SkillRecentRow {
  name: string;
  lastUsed: string;
}

/** 技能库总览：全部由 `useSkills` 的返回值在组件里算出来，没有额外的假数据。 */
export interface SkillsOverview {
  totalCalls: number;
  usedCount: number;
  /** 调用次数从高到低，最多 5 条（卡片要求「前 5」）。 */
  ranked: SkillRankRow[];
  rankedTopCalls: number;
  /** 按 last_used 倒序，最多 6 条（旧页 page.tsx:161-164 的口径）。 */
  recent: SkillRecentRow[];
  neverUsed: string[];
}

/**
 * 汇总技能库总览（纯函数，口径抄旧页 page.tsx:156-175）。
 * @param skills - `GET /skills` 返回的技能列表。
 * @returns 总调用数、被调用过的数量、调用排行前 5、最近调用、从未使用。
 */
export function summarizeSkills(skills: SkillItem[]): SkillsOverview {
  const totalCalls = skills.reduce((sum, item) => sum + item.calls, 0);
  const used = skills.filter((item) => item.calls > 0);
  const ranked: SkillRankRow[] = [...used]
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 5)
    .map((item) => ({ name: item.name, calls: item.calls }));
  const recent: SkillRecentRow[] = skills
    .filter((item) => item.last_used !== undefined && item.last_used !== "")
    .sort((a, b) => ((a.last_used ?? "") < (b.last_used ?? "") ? 1 : -1))
    .slice(0, 6)
    .map((item) => ({ name: item.name, lastUsed: item.last_used ?? "" }));
  const neverUsed = skills.filter((item) => item.calls === 0).map((item) => item.name);
  return {
    totalCalls,
    usedCount: used.length,
    ranked,
    rankedTopCalls: ranked.length > 0 ? ranked[0].calls : 0,
    recent,
    neverUsed,
  };
}

/**
 * 把后端时间戳格式化成「月-日 时:分」（旧页 page.tsx:48-56 的 fmtTime）。
 * @param ts - ISO 时间字符串；空值时返回「从未调用」。
 * @returns 本地化短时间文本。
 */
export function formatSkillTime(ts: string | undefined): string {
  if (ts === undefined || ts === "") return "从未调用";
  const value = new Date(ts);
  if (Number.isNaN(value.getTime())) return ts;
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// B03 技能详情：文件树 / 文件读写 / 元数据 / 调用明细 / 可见性
// 旧页面依据：ARTEX/web/src/app/(main)/system/skills/page.tsx:344-355（load）、
//   :396-420（选中后拉 MCP / 调用明细 / 文件内容）、:446-537（新建文件 / 文件夹、
//   删除、保存）、:539-565（MCP 关联回滚、可见性切换）。
// 对照表行：P3:K5 P3:K6 P3:K7 P3:K8 P3:K9 P3:K10 P3:K11 P3:K12
// ---------------------------------------------------------------------------

/** 单个技能最近调用一次的字段（types.ts:1284-1290 SkillCall）。 */
export type SkillCallRow = SkillCall;

/** 技能目录里的一个条目：后端把目录返回成 `dir/`（带尾斜杠），文件返回 `dir/a.py`。 */
export interface SkillTreeEntry {
  name: string;
  /** 相对技能根目录的路径；目录不带尾斜杠（旧页 page.tsx:59-64）。 */
  path: string;
  type: "file" | "dir";
  children: SkillTreeEntry[];
}

/**
 * 把 `skillFiles` 的路径列表拼成树（口径抄旧页 page.tsx:66-124 buildTree / sortNodes）。
 * @param entries - `GET /skills/{name}/files` 返回的路径列表。
 * @returns 目录在前、同类型按名称不区分大小写排序的树。
 */
export function buildSkillTree(entries: string[]): SkillTreeEntry[] {
  const root: SkillTreeEntry[] = [];
  const dirMap = new Map<string, SkillTreeEntry>();

  /** 逐级建出目录节点，返回该目录的 children 数组。 */
  function ensureDir(dirPath: string): SkillTreeEntry[] {
    const parts = dirPath.split("/");
    let nodes = root;
    let cur = "";
    for (const part of parts) {
      cur = cur === "" ? part : `${cur}/${part}`;
      let node = dirMap.get(cur);
      if (node === undefined) {
        node = { name: part, path: cur, type: "dir", children: [] };
        nodes.push(node);
        dirMap.set(cur, node);
      }
      nodes = node.children;
    }
    return nodes;
  }

  for (const entry of [...entries].sort()) {
    if (entry.endsWith("/")) {
      ensureDir(entry.slice(0, -1));
      continue;
    }
    const parts = entry.split("/");
    const fname = parts[parts.length - 1];
    if (fname === undefined || fname === "") continue;
    const parents = ensureDir(parts.slice(0, -1).join("/"));
    parents.push({ name: fname, path: entry, type: "file", children: [] });
  }

  /** 每层目录在前、文件在后，再按名称排序。 */
  function sortNodes(nodes: SkillTreeEntry[]): void {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  }
  sortNodes(root);
  return root;
}

/**
 * 判断扩展名是否属于二进制文件（这些文件后端会返回乱码，界面禁用编辑，旧页 page.tsx:413-420 直接当文本渲染）。
 * @param path - 相对技能根目录的文件路径。
 * @returns 是否按二进制处理。
 */
export function isBinarySkillFile(path: string): boolean {
  const name = path.toLowerCase();
  return /\.(zip|gz|tgz|bz2|xz|7z|rar|png|jpe?g|gif|webp|ico|bmp|pdf|docx?|xlsx?|pptx?|wasm|so|dll|exe|bin|pyc|woff2?|ttf|otf|mp[34]|wav|ogg|webm|mp4)$/.test(
    name,
  );
}

/**
 * 编辑区一次能容纳的文本上限（字符数）。超过就不进编辑区，避免把大文件塞进 textarea。
 * 旧页没有这个判断；这里取 512 KiB 字符作为保守上限，超过后只提示、不编辑。
 */
export const SKILL_FILE_EDIT_LIMIT = 512 * 1024;

export type SkillTreePhase = "loading" | "ready" | "offline";

export interface SkillFilesState {
  phase: SkillTreePhase;
  entries: string[];
  /** 拼好的文件树；`entries` 为空时是空数组。 */
  tree: SkillTreeEntry[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个技能的文件清单（`GET /skills/{name}/files`，api.ts:1294）。
 * @param name - 技能目录名；null 时不请求。
 * @returns 阶段、原始路径、树、错误、重新读取。
 */
export function useSkillFiles(name: string | null): SkillFilesState {
  const [phase, setPhase] = useState<SkillTreePhase>("loading");
  const [entries, setEntries] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (name === null) return;
    let alive = true;
    setPhase("loading");
    api
      .skillFiles(name)
      .then((value) => {
        if (!alive) return;
        setEntries(value);
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
  }, [name, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const tree = buildSkillTree(entries);
  return { phase, entries, tree, error, reload };
}

export type SkillFilePhase = "idle" | "loading" | "ready" | "offline";

export interface SkillFileState {
  phase: SkillFilePhase;
  content: string;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个技能文件的内容（`GET /skills/{name}/files/{file}`，api.ts:1295）。
 * @param name - 技能目录名；null 时不请求。
 * @param file - 相对技能根目录的文件路径；null 时不请求。
 * @returns 阶段、内容、错误、重新读取。
 */
export function useSkillFile(name: string | null, file: string | null): SkillFileState {
  const [phase, setPhase] = useState<SkillFilePhase>("idle");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (name === null || file === null) {
      setPhase("idle");
      setContent("");
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    api
      .readSkillFile(name, file)
      .then((value) => {
        if (!alive) return;
        setContent(value);
        setError(null);
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
  }, [name, file, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, content, error, reload };
}

/**
 * 保存一个技能文件（`PUT /skills/{name}/files/{file}`，api.ts:1297）。
 * @param name - 技能目录名。
 * @param file - 相对技能根目录的文件路径。
 * @param content - 新正文。
 */
export async function writeSkillFile(name: string, file: string, content: string): Promise<void> {
  await api.writeSkillFile(name, file, content);
}

/**
 * 新建一个空文件（旧页 page.tsx:475 就是 `writeSkillFile(skill, path, "")`）。
 * @param name - 技能目录名。
 * @param file - 相对技能根目录的新文件路径。
 */
export async function createSkillFile(name: string, file: string): Promise<void> {
  await api.writeSkillFile(name, file, "");
}

/**
 * 新建一个文件夹（`POST /skills/{skill}/dirs`，api.ts:1293）。
 * @param name - 技能目录名。
 * @param path - 相对技能根目录的新目录路径。
 */
export async function createSkillDir(name: string, path: string): Promise<void> {
  await api.createSkillDir(name, path);
}

/**
 * 删除一个文件或目录（`DELETE /skills/{skill}/files/{path}`，api.ts:1299）。
 * @param name - 技能目录名。
 * @param path - 相对技能根目录的文件或目录路径。
 */
export async function deleteSkillPath(name: string, path: string): Promise<void> {
  await api.deleteSkillPath(name, path);
}

/** 技能元数据可编辑字段，与 `PUT /skills/{name}/meta` 的 body 一致（api.ts:1289-1292）。 */
export interface SkillMetaInput {
  description?: string;
  license?: string;
  compatibility?: string;
  mcps?: string[];
}

/**
 * 编辑技能元数据（描述 / license / compatibility / MCP 关联）。
 * 空字符串也照发：旧页 page.tsx:545 只改 mcps，这里允许把 field 清空。
 * @param name - 技能目录名。
 * @param meta - 只放要改的字段。
 */
export async function updateSkillMeta(name: string, meta: SkillMetaInput): Promise<void> {
  await api.updateSkillMeta(name, meta);
}

export type SkillUsagePhase = "loading" | "ready" | "offline";

export interface SkillUsageState {
  phase: SkillUsagePhase;
  calls: SkillCallRow[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个技能的最近调用明细（`GET /skills/{name}/usage?limit`，api.ts:1300）。
 * @param name - 技能目录名；null 时不请求。
 * @param limit - 最多返回多少条；默认 20（旧页 page.tsx:407 就是 20）。
 * @returns 阶段、调用明细、错误、重新读取。
 */
export function useSkillUsage(name: string | null, limit = 20): SkillUsageState {
  const [phase, setPhase] = useState<SkillUsagePhase>("loading");
  const [calls, setCalls] = useState<SkillCallRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (name === null) return;
    let alive = true;
    setPhase("loading");
    api
      .skillUsage(name, limit)
      .then((value) => {
        if (!alive) return;
        setCalls(value);
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
  }, [name, limit, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, calls, error, reload };
}

export type SkillVisibilityPhase = "loading" | "ready" | "offline";

export interface SkillVisibilityState {
  phase: SkillVisibilityPhase;
  /** 可见的 agent id 列表（`GET /visibility/skill/{name}` 的返回值，api.ts:1312）。 */
  agentIds: string[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个技能对哪些 agent 可见（`GET /visibility/skill/{name}`，api.ts:1312）。
 * @param name - 技能目录名；null 时不请求。
 * @returns 阶段、可见 agent id、错误、重新读取。
 */
export function useSkillVisibility(name: string | null): SkillVisibilityState {
  const [phase, setPhase] = useState<SkillVisibilityPhase>("loading");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (name === null) return;
    let alive = true;
    setPhase("loading");
    api
      .skillVisibility(name)
      .then((value) => {
        if (!alive) return;
        setAgentIds(value);
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
  }, [name, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, agentIds, error, reload };
}

/**
 * 授予 / 取消一个 agent 对一个技能的可见性（`POST /visibility/skill/toggle`，api.ts:1313）。
 * 不吞错误、不重试：调用方自己重新读 `skillVisibility` 拿到权威状态（旧页 page.tsx:558-561 同口径）。
 * @param agentId - agent 的 id（types.ts:1191 `Agent.id`）。
 * @param skillName - 技能目录名。
 * @param visible - 目标状态。
 */
export async function toggleSkillVisibility(agentId: string, skillName: string, visible: boolean): Promise<void> {
  await api.toggleSkillVisibility(agentId, skillName, visible);
}
