"use client";

/**
 * 报告与复测记录适配器（对照表 P1:C18、P1:C19）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/report-tab.tsx:14-90、
 * retests-tab.tsx:26-168。
 * 接口：api.ts:970 report（返回 Markdown 文本）、:637 findingsPage（本任务漏洞分页）。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Finding, FindingsPage } from "@/lib/types";

export type ReportPhase = "loading" | "ready" | "offline";

export interface ReportState {
  phase: ReportPhase;
  /** 后端返回的 Markdown 原文；空串表示这个任务还没有报告。 */
  text: string;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个任务的渗透测试报告（Markdown 原文）。
 * @param taskId - 任务 id；null 时不请求。
 * @returns 阶段、原文、错误与重新读取。
 */
export function useTaskReport(taskId: string | null): ReportState {
  const [phase, setPhase] = useState<ReportPhase>("loading");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .report(taskId)
      .then((value) => {
        if (!alive) return;
        setText(value);
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
  }, [taskId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, text, error, reload };
}

export type TaskFindingsPhase = "loading" | "ready" | "offline";

export interface TaskFindingsState {
  phase: TaskFindingsPhase;
  items: Finding[];
  total: number;
  error: string | null;
  reload: () => void;
}

/**
 * 读取本任务的漏洞分页（复测记录左侧列表，旧页 retests-tab.tsx:41 每页 20 条、按时间排序）。
 * @param taskId - 任务 id；null 时不请求。
 * @param page - 1 基页码。
 * @param pageSize - 每页条数。
 * @returns 阶段、行、总数、错误与重新读取。
 */
export function useTaskFindings(taskId: string | null, page: number, pageSize: number): TaskFindingsState {
  const [phase, setPhase] = useState<TaskFindingsPhase>("loading");
  const [items, setItems] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (taskId === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    const query: { task: string; page: number; pageSize: number; sort: "time" } = {
      task: taskId,
      page,
      pageSize,
      sort: "time",
    };
    api
      .findingsPage(query)
      .then((value: FindingsPage) => {
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
  }, [taskId, page, pageSize, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, items, total, error, reload };
}

/** 复测记录每页条数（旧页 retests-tab.tsx:20）。 */
export const RETESTS_PAGE_SIZE = 20;

/**
 * 漏洞显示名：优先 name，否则 vulnclass（旧页 retests-tab.tsx:22-24）。
 * @param finding - 后端漏洞行。
 * @returns 显示名。
 */
export function findingLabel(finding: Finding): string {
  const name = finding.name?.trim() ?? "";
  if (name !== "") return name;
  const vulnclass = finding.vulnclass?.trim() ?? "";
  return vulnclass === "" ? "未分类" : vulnclass;
}
