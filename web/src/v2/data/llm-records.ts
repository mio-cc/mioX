"use client";

/**
 * LLM 录制整页（主区整页 `llm-records`）的适配器：录制记录分页列表、单条记录的
 * 请求 / 响应详情、任务下拉数据、按任务删除全部记录，以及录制开关（settings.llm_record）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/llm-records/page.tsx:200-217（列表读取与
 * 任务下拉同时拉）、:237-251（点行按需取详情）、:219-234（按任务删除后重读）、
 * :166-186（录制开关的读取与写入）、:51-77（时间 / 延迟 / token 文案与 JSON 排版）。
 * DSH 依据：DSH 无 LLM 录制页，按「主区整页」扩展（总表 §4.1、§4）。
 * 对照表行：P2:I1 P2:I2 P2:I3 P2:I4 P2:I5
 *
 * 接口：api.ts:1424 llmRecords（GET /llm/records?model&session&task&page&size）、
 * :1433 llmRecordDetail（GET /llm/records/{id}）、:1434 llmTasks（GET /llm/records/tasks）、
 * :1435 llmRecordsDeleteTask（DELETE /llm/records?task=）、:918 settings、:919 setSettings。
 * 类型：types.ts:1489 LLMRecordItem、:1506 LLMRecordDetail（含 raw_request / raw_response）、
 * :1517 LLMTask、:986 Settings.llm_record。
 *
 * 后端口径（只读核对，未改）：`ARTEX/db/commands.go:222-262` 的 model 是**精确匹配**、
 * session 是 ILIKE 模糊、task 是精确匹配；`ARTEX/llmrec/llmrec.go:296-303` 的 status 只有
 * `ok` / `error` 两种，所以「只看失败」= 前端按 `status !== "ok"` 过滤。
 * api.ts 里没有 LLM 记录统计接口，所以本页不画汇总数字（总表 §8）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { LLMRecordDetail, LLMRecordItem, Settings } from "@/lib/types";

/** 每页条数可选值，照旧页 llm-records/page.tsx:120 的 PAGE_SIZES。 */
export const LLM_RECORDS_PAGE_SIZES: readonly number[] = [25, 50, 100];

/** 默认每页条数，照旧页 llm-records/page.tsx:124 的初始 size 与 api.ts:1430 的默认值。 */
export const LLM_RECORDS_PAGE_SIZE = 50;

/** 模型下拉里的「全部」取值；后端不吃这个值，只在适配器里被翻译成「不传 model」。 */
export const LLM_MODEL_ALL = "__all__";

export type LlmRecordsPhase = "loading" | "ready" | "offline";

/** 一次列表查询的筛选条件；`all` / 空串都表示不过滤这一项。 */
export interface LlmRecordsQuery {
  /** 0-based 页码，照 api.ts:1424 的 page 参数。 */
  page: number;
  /** 每页条数，照 api.ts:1430 的 size 参数。 */
  size: number;
  /** 后端 `model` 参数（精确匹配）；空串表示不传。 */
  model?: string;
  /** 后端 `session` 参数（模糊匹配）；空串表示不传。 */
  session?: string;
  /** 后端 `task` 参数（精确匹配）；空串表示不传。 */
  task?: string;
  /** 只看失败：后端没有该参数（`db/commands.go:222` 只收 model/session/task），故在前端按 status 过滤。 */
  onlyFailed?: boolean;
}

/** 一行列表数据：后端记录 + 该行是否因前端过滤而未计入。 */
export interface LlmRecordsRow extends LLMRecordItem {}

export interface LlmRecordsState {
  phase: LlmRecordsPhase;
  /** 当前页（已按 onlyFailed 过滤）的记录。 */
  rows: LlmRecordsRow[];
  /** 当前页未过滤的记录条数。 */
  rawCount: number;
  /** 后端报告的匹配总数（不含前端过滤，因为后端没有 status 过滤能力）。 */
  total: number;
  error: string | null;
  reload: () => void;
}

/** `status` 是否算失败；后端只有 ok / error（llmrec.go:298-303），未知值按失败显示。 */
export function llmRecordFailed(record: LLMRecordItem): boolean {
  return record.status !== "ok";
}

/**
 * 读一页 LLM 录制记录。
 * 「只看失败」在前端过滤：后端没有 status 过滤参数，过滤后本页可能不足 size 条，
 * 所以 total 仍是后端的匹配总数，界面要如实说明这一点。
 * @param query - 页码、每页条数、三个后端筛选与前端「只看失败」。
 * @returns 阶段、本页符合条件的行、原始行数、后端总数与重新读取。
 */
export function useLlmRecords({
  page,
  size,
  model = "",
  session = "",
  task = "",
  onlyFailed = false,
}: LlmRecordsQuery): LlmRecordsState {
  const [phase, setPhase] = useState<LlmRecordsPhase>("loading");
  const [items, setItems] = useState<LLMRecordItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .llmRecords({
        model: model === "" ? undefined : model,
        session: session.trim() === "" ? undefined : session.trim(),
        task: task === "" ? undefined : task,
        page,
        size,
      })
      .then((res) => {
        if (!alive) return;
        setItems(res.records ?? []);
        setTotal(res.total ?? 0);
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
  }, [page, size, model, session, task, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const rows = onlyFailed ? items.filter((item) => llmRecordFailed(item)) : items;
  return { phase, rows, rawCount: items.length, total, error, reload };
}

export type LlmRecordDetailPhase = "loading" | "ready" | "offline";

export interface LlmRecordDetailState {
  phase: LlmRecordDetailPhase;
  detail: LLMRecordDetail | null;
  error: string | null;
  reload: () => void;
}

/**
 * 按需读取一条记录的完整请求 / 响应（旧页 llm-records/page.tsx:237-251：选中行才取）。
 * @param id - 记录 id；null 时不请求，返回 loading 且 detail 为 null。
 * @returns 阶段、详情、错误与重新读取。
 */
export function useLlmRecordDetail(id: number | null): LlmRecordDetailState {
  const [phase, setPhase] = useState<LlmRecordDetailPhase>("loading");
  const [detail, setDetail] = useState<LLMRecordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setDetail(null);
    if (id === null) {
      setPhase("loading");
      return;
    }
    let alive = true;
    setPhase("loading");
    api
      .llmRecordDetail(id)
      .then((value) => {
        if (!alive) return;
        setDetail(value);
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
  }, [id, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, detail, error, reload };
}

export type LlmTasksPhase = "loading" | "ready" | "offline";

export interface LlmTasksState {
  phase: LlmTasksPhase;
  /** 有录制记录的任务与各自的记录条数（后端 `GET /llm/records/tasks` 原样返回）。 */
  tasks: { task_id: string; count: number }[];
  error: string | null;
  reload: () => void;
}

/**
 * 读任务下拉数据（旧页 llm-records/page.tsx:212-215，与列表同时请求）。
 * @returns 阶段、任务与条数、错误与重新读取。
 */
export function useLlmRecordTasks(): LlmTasksState {
  const [phase, setPhase] = useState<LlmTasksPhase>("loading");
  const [tasks, setTasks] = useState<LlmTasksState["tasks"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .llmTasks()
      .then((res) => {
        if (!alive) return;
        setTasks(res.tasks ?? []);
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
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, tasks, error, reload };
}

export type LlmRecordTogglePhase = "loading" | "ready" | "offline";

export interface LlmRecordToggleState {
  phase: LlmRecordTogglePhase;
  /** 后端当前值（settings.llm_record，默认关；types.ts:986）。 */
  enabled: boolean;
  error: string | null;
  reload: () => void;
  /** 写入开关；成功返回 null，失败返回后端原因（照 finding-detail.ts 的统一报错口径）。 */
  setEnabled: (next: boolean) => Promise<string | null>;
}

/**
 * 读录制开关并写入（旧页 llm-records/page.tsx:166-186；`api.ts:918-919`）。
 * 这里不做乐观更新：写入成功以后端回显为准，失败时界面回退到上一次的值。
 * @returns 阶段、当前开关、错误、重新读取与写入函数。
 */
export function useLlmRecordToggle(): LlmRecordToggleState {
  const [phase, setPhase] = useState<LlmRecordTogglePhase>("loading");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .settings()
      .then((value: Settings) => {
        if (!alive) return;
        setEnabled(Boolean(value.llm_record));
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
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const setEnabledWriter = useCallback(async (next: boolean): Promise<string | null> => {
    try {
      const value = await api.setSettings({ llm_record: next });
      setEnabled(Boolean(value.llm_record));
      setError(null);
      setPhase("ready");
      return null;
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      return message;
    }
  }, []);

  return { phase, enabled, error, reload, setEnabled: setEnabledWriter };
}

/**
 * 删除一个任务的全部 LLM 记录（旧页 llm-records/page.tsx:219-234）。
 * 调用方必须先用二次确认弹窗确认（总表 §5.5）。
 * @param task - 任务 id；空串拒绝请求。
 * @returns 后端报告的删除条数。
 */
export function deleteLlmRecordsOfTask(task: string): Promise<{ deleted: number }> {
  return api.llmRecordsDeleteTask(task);
}

/** 请求 / 响应正文的两种视图：归一化视图与 provider 实际收发的 HTTP 原文。 */
export type LlmRecordBodyView = "normalized" | "raw";

/** 一条记录在两种视图下的正文，取自 LLMRecordDetail 的真实字段（types.ts:1506-1514）。 */
export interface LlmRecordBodies {
  request: string;
  response: string;
}

/**
 * 取一条记录在指定视图下的请求 / 响应正文。
 * 旧记录没有 raw_* 字段（types.ts:1512 注释「旧记录为空」），此时回退到归一化视图，
 * 与旧页 llm-records/page.tsx:146-156 的 hasRaw / showRaw 判定一致。
 * @param detail - 详情；null 时返回两个空串。
 * @param view - 期望的视图。
 * @returns 请求与响应正文（未格式化）。
 */
export function llmRecordBodies(detail: LLMRecordDetail | null, view: LlmRecordBodyView): LlmRecordBodies {
  if (detail === null) return { request: "", response: "" };
  const hasRaw = Boolean(detail.raw_request || detail.raw_response);
  if (view === "raw" && hasRaw) {
    return { request: detail.raw_request ?? "", response: detail.raw_response ?? "" };
  }
  return { request: detail.request_body ?? "", response: detail.response_body ?? "" };
}

/**
 * 该记录是否有 HTTP 原文可选（旧页 llm-records/page.tsx:146、:488-499 的禁用依据）。
 * @param detail - 详情；null 时为 false。
 * @returns 有任一原文为 true。
 */
export function llmRecordHasRaw(detail: LLMRecordDetail | null): boolean {
  return detail !== null && Boolean(detail.raw_request || detail.raw_response);
}

/**
 * 正文排版：请求体是 JSON，缩进后更易读；原文响应是 SSE 帧，解析失败时原样返回
 * （旧页 llm-records/page.tsx:71-77 的 tryFormatJSON）。
 * @param text - 原始正文。
 * @returns 紧凑 JSON 缩进成两空格，非 JSON 原样返回。
 */
export function prettyJsonText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

/**
 * 记录行的模型取值列表：只从当前页真实出现的记录里收集，不编造候选。
 * @param items - 记录。
 * @returns 去重后的模型名，按首次出现顺序。
 */
export function llmRecordModels(items: readonly LLMRecordItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) {
    const model = item.model.trim();
    if (model === "" || seen.includes(model)) continue;
    seen.push(model);
  }
  return seen;
}
