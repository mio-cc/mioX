"use client";

/**
 * 审批历史适配器（对照表 P1:E2–E4、P3:I11）。
 * 旧页面依据：ARTEX/web/src/components/approval-records.tsx:40-129（来源/来源标签/状态文案）、
 * ARTEX/web/src/app/(main)/system/intercept/approvals/page.tsx。
 * 接口：api.ts:1359 interceptHistory、:1360 interceptHistoryPage、:1369 interceptTaskPage、
 * :1358 interceptDetail、:1354 interceptExecution。只读，不调任何写接口。
 *
 * 注意：本机 `intercept_pending` 表当前为空，历史列表会是 0 条；界面必须如实显示空态。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type {
  Activity,
  InterceptApprovalFilter,
  InterceptApprovalRow,
  InterceptDetail,
  InterceptPending,
} from "@/lib/types";

/** 状态筛选：`all` 表示不传 filter。 */
export type ApprovalStatusFilter = "all" | InterceptPending["status"];

/** 判定来源筛选：`all` 表示不传 filter（后端还接受 `plan`，types 未收录，与旧页一致不给）。 */
export type ApprovalSourceFilter = "all" | "rule" | "model" | "unknown";

export interface ApprovalHistoryQuery {
  /** 1 基页码。 */
  page: number;
  /** 每页条数。 */
  size: number;
  status: ApprovalStatusFilter;
  source: ApprovalSourceFilter;
  /** 非空时只看这个任务（走 `/intercept/task/{id}` 分页）。 */
  taskId: string | null;
}

export type ApprovalHistoryPhase = "loading" | "ready" | "offline";

export interface ApprovalHistoryState {
  phase: ApprovalHistoryPhase;
  items: InterceptApprovalRow[];
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * 把界面筛选拼成后端 filter。
 * @param status - 状态筛选。
 * @param source - 来源筛选。
 * @returns 后端 filter；全部为「全部」时返回空对象。
 */
function toFilter(status: ApprovalStatusFilter, source: ApprovalSourceFilter): InterceptApprovalFilter {
  const filter: InterceptApprovalFilter = {};
  if (status !== "all") filter.status = status;
  if (source !== "all") filter.decision_source = source;
  return filter;
}

/**
 * 读取审批历史一页。
 * @param query - 页码、条数、筛选与任务范围。
 * @returns 阶段、行、总数、错误与重新读取。
 */
export function useApprovalHistory(query: ApprovalHistoryQuery): ApprovalHistoryState {
  const { page, size, status, source, taskId } = query;
  const [phase, setPhase] = useState<ApprovalHistoryPhase>("loading");
  const [items, setItems] = useState<InterceptApprovalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    const filter = toFilter(status, source);
    const request =
      taskId === null
        ? api.interceptHistoryPage(page, size, filter)
        : api.interceptTaskPage(taskId, page, size, filter);
    request
      .then((value) => {
        if (!alive) return;
        setItems(value.items);
        setTotal(value.total);
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
  }, [page, size, status, source, taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

export type ApprovalDetailPhase = "loading" | "ready" | "offline";

export interface ApprovalDetailState {
  phase: ApprovalDetailPhase;
  detail: InterceptDetail | null;
  error: string | null;
}

/**
 * 读取一条审批记录的详情（含 audit 字段）。
 * @param id - 审批 id；null 时不请求。
 * @returns 阶段、详情与错误。
 */
export function useApprovalDetail(id: number | null): ApprovalDetailState {
  const [phase, setPhase] = useState<ApprovalDetailPhase>("loading");
  const [detail, setDetail] = useState<InterceptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) {
      setPhase("loading");
      setDetail(null);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .interceptDetail(id)
      .then((value) => {
        if (!alive) return;
        setDetail(value);
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
  }, [id]);

  return { phase, detail, error };
}

export type ApprovalExecutionPhase = "loading" | "ready" | "offline";

export interface ApprovalExecutionState {
  phase: ApprovalExecutionPhase;
  items: Activity[];
  error: string | null;
}

/**
 * 读取一条审批对应的执行链路（会话里的活动行）。
 * @param id - 审批 id；null 时不请求。
 * @param conversationId - 关联对话 id，后端用它定位执行。
 * @returns 阶段、活动行与错误。
 */
export function useApprovalExecution(id: number | null, conversationId?: number): ApprovalExecutionState {
  const [phase, setPhase] = useState<ApprovalExecutionPhase>("loading");
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) {
      setPhase("loading");
      setItems([]);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .interceptExecution(id, conversationId)
      .then((value) => {
        if (!alive) return;
        setItems(value.items);
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
  }, [id, conversationId]);

  return { phase, items, error };
}

/** 审批状态中文（旧页 approval-records.tsx:102-109）。 */
const STATUS_LABEL: Record<string, string> = {
  pending: "待审批",
  allowed: "已允许",
  denied: "已拒绝",
  timeout: "已超时",
};

/**
 * 审批状态文案。
 * @param status - 后端状态。
 * @returns 中文状态。
 */
export function approvalStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * 状态对应的 Tag 色调。
 * @param status - 后端状态。
 * @returns Tag 的 tone。
 */
export function approvalStatusTone(status: string): "neutral" | "success" | "danger" | "warning" | "outline" {
  if (status === "allowed") return "success";
  if (status === "denied") return "danger";
  if (status === "timeout") return "warning";
  if (status === "pending") return "neutral";
  return "outline";
}

/**
 * 判定来源：优先后端字段，其次规则 id，再次理由前缀（旧页 approval-records.tsx:50-54）。
 * @param row - 审批行。
 * @returns rule / model / unknown。
 */
export function approvalSource(row: InterceptApprovalRow): "rule" | "model" | "unknown" {
  if (row.decision_source === "rule" || row.decision_source === "model" || row.decision_source === "unknown") {
    return row.decision_source;
  }
  if (row.rule_id !== undefined && row.rule_id > 0) return "rule";
  return row.reason?.startsWith("[模型]") === true ? "model" : "unknown";
}

/**
 * 来源标签：任务 id、对话 #id、或「—」（旧页 approval-records.tsx:56-60）。
 * @param row - 审批行。
 * @returns 来源文案。
 */
export function approvalOriginLabel(row: InterceptApprovalRow): string {
  if (row.task_id !== undefined && row.task_id !== "") return row.task_id;
  if (row.conversation_id !== undefined && row.conversation_id > 0) return `对话 #${row.conversation_id}`;
  return "—";
}

/** 工具调用的单行摘要：命令、文件路径或理由（与右栏待审批卡同口径，Panes.tsx:322）。 */
/**
 * 工具调用的单行摘要。
 * @param row - 审批行。
 * @returns 摘要文本。
 */
export function approvalSummary(row: InterceptApprovalRow): string {
  const input = row.tool_input ?? {};
  const command = input.command ?? input.file_path ?? row.reason ?? "";
  return typeof command === "string" ? command : String(command);
}

/**
 * 时间文案：MM-DD HH:mm:ss（旧页 approval-records.tsx:40-48）。
 * @param value - ISO 时间串，可为空。
 * @returns 时间文案或「—」。
 */
export function approvalTime(value?: string): string {
  if (value === undefined || value === "") return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
