"use client";

/**
 * 工作区文件管理页适配器（对照表 P2:F1–P2:F4；B10 补 P2:F5–P2:F8，只增）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/workspace/page.tsx:79-170（读取 / 新建 / 上传）、
 * :47-61（大小与时间格式化）、:98-107（面包屑拆分）、
 * :109-130（读文件 / 保存）、:132-141（删除）、:201（刷新）、:255-265 与 :299-333（下载、只读判定）。
 * DSH 依据：DSH 无文件管理页，按「主区整页」扩展（总表 §4.1、§4）。
 * 接口：api.ts:530 workspaceList（GET /workspace/list?path=）、
 * :531 workspaceRead（GET /workspace/read?path=，内联文本）、
 * :532 workspaceWrite（POST /workspace/write {path,content}）、
 * :534 workspaceMkdir（POST /workspace/mkdir）、
 * :535 workspaceDelete（DELETE /workspace/delete?path=，文件或整个目录树）、
 * :536 workspaceUpload（POST /workspace/upload?path=，multipart）、
 * :549 workspaceDownload（GET /workspace/download?path=，返回 Blob 并自行触发浏览器下载）。
 * 类型：types.ts:346 WorkspaceEntry、types.ts:353 WorkspaceListing、
 * types.ts:357 WorkspaceFile（path / size / binary / too_large? / content?）。
 *
 * 右栏与 composer 的「@ 引用」用的是 `v2/data/workspace-files.ts`（只读根目录），
 * 与本文件互不影响：这是可以逐级进入、新建、上传的管理器。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { WorkspaceEntry, WorkspaceFile, WorkspaceListing } from "@/lib/types";

export type WorkspaceDirPhase = "loading" | "ready" | "offline";

export interface WorkspaceDirState {
  phase: WorkspaceDirPhase;
  /** 后端回显的当前目录（工作区相对路径，根目录为空串）。 */
  path: string;
  entries: WorkspaceEntry[];
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个目录。
 * @param path - 工作区相对路径；空串是根目录；不传 `null` 表示本次不请求。
 * @returns 阶段、回显路径、条目、错误与重新读取。
 */
export function useWorkspaceDir(path: string | null): WorkspaceDirState {
  const [phase, setPhase] = useState<WorkspaceDirPhase>("loading");
  const [current, setCurrent] = useState("");
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .workspaceList(path)
      .then((value: WorkspaceListing) => {
        if (!alive) return;
        setEntries(value.entries ?? []);
        setCurrent(value.path ?? path);
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
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, path: current, entries, error, reload };
}

/**
 * 新建一个文件夹（旧页 page.tsx:157-170）。
 * @param path - 工作区相对路径，例如 `a/b`。
 * @returns 后端确认的路径；失败时抛出带后端信息的 Error。
 */
export function createFolder(path: string): Promise<{ ok: boolean; path: string }> {
  return api.workspaceMkdir(path);
}

/**
 * 把一批文件上传到当前目录（旧页 page.tsx:143-155）。
 * @param dir - 目标目录的工作区相对路径。
 * @param files - 用户选择的文件。
 * @returns 后端报告的上传数量。
 */
export function uploadFiles(dir: string, files: File[]): Promise<{ uploaded: number }> {
  return api.workspaceUpload(dir, files);
}

/**
 * 拼接子路径：目录为空（根）时不出现前导斜杠（照旧页 page.tsx:160）。
 * @param dir - 父目录的工作区相对路径或空串。
 * @param name - 子项名称。
 * @returns 子项的工作区相对路径。
 */
export function joinWorkspacePath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

/** 面包屑的一节。 */
export interface WorkspaceCrumb {
  name: string;
  /** 这一节对应的工作区相对路径（根为空串）。 */
  path: string;
}

/**
 * 把当前目录拆成面包屑，首节固定是工作区根（旧页 page.tsx:98-107）。
 * @param path - 当前目录的工作区相对路径，空串表示根。
 * @returns 从根到当前目录的每一节。
 */
export function workspaceCrumbs(path: string): WorkspaceCrumb[] {
  const parts = path === "" ? [] : path.split("/").filter((part) => part !== "");
  const crumbs: WorkspaceCrumb[] = [{ name: "工作空间", path: "" }];
  let current = "";
  for (const part of parts) {
    current = joinWorkspacePath(current, part);
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

// ---------------------------------------------------------------------------
// B10（P2:F5–P2:F8）：读文件、写文件、删除、下载、只读判定。
// ---------------------------------------------------------------------------

export type WorkspaceFilePhase = "loading" | "ready" | "offline";

/** 一次文件读取的状态，供查看/编辑面板使用。 */
export interface WorkspaceFileState {
  phase: WorkspaceFilePhase;
  /** 后端回显的路径；读失败时为请求路径。 */
  path: string;
  /** 后端返回的完整读取结果（含 binary / too_large / content）；未读到时为 null。 */
  file: WorkspaceFile | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个文件的内联内容（旧页 page.tsx:109-114 `openFile`）。
 *
 * 二进制与过大的判定**全部沿用后端口径**，前端不自己按扩展名猜：
 * `ARTEX/server/workspace.go:22` 把上限定为 `maxWorkspaceRead = 2 << 20`（2 MiB），
 * `:120-123` 超限时只回 `{too_large:true, binary:true}` 且**不带 content**；
 * `:129-131` 内容含 NUL 或不是合法 UTF-8 时回 `{binary:true}` 也不带 content；
 * `:133` 其余情况回 `{binary:false, content}`。
 * 所以前端只需看 `binary` / `too_large` 两个字段，不需要任何白名单。
 *
 * @param path - 工作区相对路径；`null` 表示本次不读取。
 * @returns 阶段、回显路径、读取结果、错误与重新读取。
 */
export function useWorkspaceFile(path: string | null): WorkspaceFileState {
  const [phase, setPhase] = useState<WorkspaceFilePhase>("loading");
  const [current, setCurrent] = useState("");
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    setFile(null);
    api
      .workspaceRead(path)
      .then((value: WorkspaceFile) => {
        if (!alive) return;
        setFile(value);
        setCurrent(value.path ?? path);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setCurrent(path);
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, path: current, file, error, reload };
}

/**
 * 只读原因：把这个文件判为「只能看、不能改」的依据。
 * @param file - 后端返回的读取结果。
 * @returns 不可编辑的原因文案；可编辑时为 null。
 */
export function workspaceReadOnlyReason(file: WorkspaceFile): string | null {
  if (file.too_large === true) return "文件超过 2 MiB，不提供在线预览/编辑（可以下载）。";
  if (file.binary) return "二进制内容（含 NUL 字节或不是合法 UTF-8），不提供在线预览/编辑（可以下载）。";
  return null;
}

/**
 * 保存文本内容（旧页 page.tsx:116-130 `saveFile`）。
 * @param path - 工作区相对路径。
 * @param content - textarea 里的完整正文。
 * @returns 后端确认结果；失败时抛出带后端信息的 Error。
 */
export function writeFile(path: string, content: string): Promise<{ ok: boolean; path: string }> {
  return api.workspaceWrite(path, content);
}

/**
 * 删除一个文件或整个目录树（旧页 page.tsx:132-141 `del`）。
 * 后端 `ARTEX/server/workspace.go:187-208` 对目录用 `os.RemoveAll` 递归删除，
 * 且拒删工作区根目录；这里不做任何重试或补偿。
 * @param path - 工作区相对路径。
 * @returns 后端确认结果；失败时抛出带后端信息的 Error。
 */
export function deleteEntry(path: string): Promise<{ ok: boolean }> {
  return api.workspaceDelete(path);
}

/**
 * 下载一个文件（旧页 page.tsx:261、:304、:323；Blob 与 `<a download>` 的触发都在 api.ts:549-569 内完成）。
 * @param path - 工作区相对路径（必须是文件，目录会 404）。
 * @returns 浏览器下载动作完成的 Promise；失败时抛出 Error。
 */
export function downloadFile(path: string): Promise<void> {
  return api.workspaceDownload(path);
}

/**
 * 文件大小显示（旧页 page.tsx:47-52）。
 * @param size - 字节数。
 * @returns 带单位的文本。
 */
export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 修改时间显示（旧页 page.tsx:53-61，zh-CN 两位数年月日与时分）。
 * @param ms - unix 毫秒。
 * @returns 本地时间文本；时间戳无效时给空串。
 */
export function formatFileTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
