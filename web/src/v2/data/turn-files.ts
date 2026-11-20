"use client";

/**
 * 每个主 Agent 回合的改动文件（回合末尾的「本轮改动」卡 / 交付物条）。
 *
 * 数据只由后端从**记录下来的成功 Write/Edit/MultiEdit 调用**推导
 * （`api.ts:828-834` → GET /tasks/{id}/turn-files?seg=&all=1），绝不解剖模型回复
 * 文本（`types.ts:716-734`；DSH 同一条规则见 `turn-deliverables.ts:1-7`）。界面侧
 * 不做任何文件名解析：拿到的 `TurnChangedFiles[]` 直接按 `end`（收尾该回合的
 * result 活动 id）建索引。
 *
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/detail/task-workspace-dsh.tsx:667-761`
 *   （`ChangedFilesCard` 只显示路径 + 操作名 + 改写次数，行展开时按
 *   `call.seq` 读 `api.activityDetail` 取参数 JSON 画 diff）、`:2107-2141`
 *   （只有 `main:<seg>` 车道才有回合，取数键 = 收尾 result 的 seq；端点不可用时
 *   静默退化为「没有卡」）。
 * DSH 依据：`dsh-upstream/packages/client/ui-deliverables/src/client/ChangedFiles.tsx:37-106`
 *   （回合末单文件卡 / 多文件折叠表；行内预览该文件的对比）、
 *   `turn-deliverables.ts:162-170`（`selectProducedFiles`：回合没产出文件就拒绝
 *   挂载 turn-tail，不留空壳）。
 * 对照表行：P1:B31
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { TurnChangedFile, TurnChangedFiles } from "@/lib/types";

import { fetchActivityDetail } from "./message-detail";

/** 四态：读取中 / 就绪 / 读取失败 / 未选中主 Agent 车道（不请求）。 */
export type TurnFilesPhase = "loading" | "ready" | "offline" | "idle";

/** 一次 `api.turnFiles` 的结果，按键 = 收尾该回合的 result seq（0 = 进行中的回合）。 */
export interface TurnFilesIndex {
  readonly phase: TurnFilesPhase;
  /** 回合边界 → 该回合改动的文件；没有改动的回合不在表里。 */
  readonly byEnd: Readonly<Record<number, readonly TurnChangedFile[]>>;
  readonly error: string | null;
  /** 重新读取（回合边界变化时由 hook 自己触发，失败时由卡片上的「重试」触发）。 */
  readonly reload: () => void;
}

/** `TurnChangedFile.ops` 的展示名（后端只回 write / edit，见旧页 `:668`）。 */
export const TURN_FILE_OP_LABEL: Record<string, string> = { write: "新建/覆写", edit: "修改" };

/** 多文件时折叠前显示的行数（DSH `ChangedFiles.tsx:18` `COLLAPSED_ROWS`）。 */
export const TURN_FILES_COLLAPSED_ROWS = 4;

/**
 * 把后端返回的回合列表折成 `end → files` 索引，顺手丢掉没有文件的回合。
 * @param turns - `api.turnFiles` 返回的 `turns`。
 * @returns 只有真正改了文件的回合。
 */
export function indexTurnFiles(turns: readonly TurnChangedFiles[]): Record<number, readonly TurnChangedFile[]> {
  const byEnd: Record<number, readonly TurnChangedFile[]> = {};
  for (const turn of turns) {
    if (turn.files.length === 0) continue;
    byEnd[turn.end] = turn.files;
  }
  return byEnd;
}

/**
 * 一个回合的写入次数合计（旧页 `:688` 的卡头「N 次写入」）。
 * @param files - 该回合改动的文件。
 * @returns `count` 之和。
 */
export function turnWriteTotal(files: readonly TurnChangedFile[]): number {
  return files.reduce((total, file) => total + file.count, 0);
}

/** 一条改写调用的参数，展开时用来画对比；`null` = 该行读不出 JSON 参数。 */
type TurnCallPayload = Readonly<Record<string, unknown>> | null;

/** 某个文件的展开结果：读取中 / 已读到的每一条调用参数 / 读取失败原因。 */
export interface TurnFileDetail {
  readonly loading: boolean;
  readonly calls: readonly TurnCallPayload[] | null;
  readonly error: string | null;
}

/** 空表（没有回合改过文件）。 */
const EMPTY_INDEX: Record<number, readonly TurnChangedFile[]> = {};

/** 从参数 JSON 里取一个字符串字段（Write `file_path`/`content`、Edit `old_string`/`new_string`）。 */
function payloadField(payload: TurnCallPayload, key: string): string | undefined {
  if (payload === null) return undefined;
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/** 某条调用要画的 (before, after)；两条都取不到时返回 null（该约定返回空对比）。 */
export interface TurnCallText {
  readonly before: string | undefined;
  readonly after: string | undefined;
}

/**
 * 一条改写调用的前后文本。
 *
 * Write 只带 `content`（没有 before），Edit 带 `old_string`/`new_string`；
 * 字段名照 `activity-blocks.ts:144` 的同一约定（`file_path` 之外三件）。
 * @param payload - `api.activityDetail` 解出来的参数对象，或 null。
 * @returns 前后文本；两边都没有时返回空对象。
 */
export function turnCallText(payload: TurnCallPayload): TurnCallText {
  return {
    before: payloadField(payload, "old_string"),
    after: payloadField(payload, "new_string") ?? payloadField(payload, "content"),
  };
}

/**
 * 展开一个文件时按 `call.seq` 逐条读参数 JSON（旧页 `:696-716` 同一口径：
 * 列表载荷里只有截断的 summary，参数只在 tool_use 活动的 detail 上）。单条读不到
 * 时记 null 并继续，不因为一条失败丢掉整个文件的对比。
 * @param taskId - 任务 id。
 * @param file - 该回合的一行文件。
 * @returns 每条调用的参数对象（按 `calls` 顺序）；整轮读取失败时抛错。
 */
export async function loadTurnFileCalls(
  taskId: string,
  file: TurnChangedFile,
): Promise<readonly TurnCallPayload[]> {
  const parts = await Promise.all(
    file.calls.map((call) =>
      fetchActivityDetail(taskId, call.seq).then(
        (detail) => {
          try {
            const parsed: unknown = JSON.parse(detail === "" ? "{}" : detail);
            return parsed !== null && typeof parsed === "object" ? (parsed as Readonly<Record<string, unknown>>) : null;
          } catch {
            return null;
          }
        },
        () => null,
      ),
    ),
  );
  return parts;
}

/**
 * 读取一个任务主 Agent 车道的回合改动文件。
 *
 * 只有 `main:<seg>` 车道有回合（旧页 `:2120-2123`）：其他车道传 null，hook 不请求、
 * 返回 `idle`，界面不渲染这一块。回合边界一变（`boundary` 变化，调用方传
 * 「当前窗口里所有 result 的 seq 串」）就重取一次，与旧页 `:2111-2141` 同策略。
 * @param taskId - 任务 id；没有选中任务时传 null。
 * @param seg - 主 Agent 分段号；非主 Agent 车道传 null。
 * @param boundary - 回合边界签名（result seq 串），变化即重取。
 * @returns 阶段、`end → files` 索引、错误、重新读取。
 */
export function useTurnFiles(taskId: string | null, seg: number | null, boundary: string): TurnFilesIndex {
  const [phase, setPhase] = useState<TurnFilesPhase>("idle");
  const [byEnd, setByEnd] = useState<Record<number, readonly TurnChangedFile[]>>(EMPTY_INDEX);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // 换任务 / 换车道就清空旧回合，绝不把上一个任务的文件挂到这一段对话上。
  useEffect(() => {
    setByEnd(EMPTY_INDEX);
    setError(null);
  }, [taskId, seg]);

  useEffect(() => {
    if (taskId === null || seg === null) {
      setPhase("idle");
      return;
    }
    let current = true;
    setPhase("loading");
    api
      .turnFiles(taskId, seg)
      .then((response) => {
        if (!live.current || !current) return;
        setByEnd(indexTurnFiles(response.turns));
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!live.current || !current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setByEnd(EMPTY_INDEX);
        setPhase("offline");
      });
    return () => {
      current = false;
    };
  }, [taskId, seg, boundary, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const indexed = useMemo(() => byEnd, [byEnd]);
  return { phase, byEnd: indexed, error, reload };
}
