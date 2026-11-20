"use client";

/**
 * Adapter for the finding detail view (C1 + the C6/C7/C10 write surface).
 *
 * The detail is the second level of the findings page, addressed by
 * `?finding=<id>` so the address alone can restore it
 * (`/v2/shell?page=findings&finding=<id>`, `/v2/findings?finding=<id>`).
 *
 * Reads: `GET /exploration/findings/{id}` via `api.getFinding` (`api.ts:687`).
 * Writes (this unit): severity/status pickers (`setFindingSeverity` /
 * `setFindingStatus`, `api.ts:760-761`), the edit form (`updateFinding`,
 * `api.ts:763`), delete (`deleteFinding`, `api.ts:768`), retest list + start
 * (`findingRetests` / `startFindingRetest`, `api.ts:769-775`) and deepen
 * (`deepenFinding`, `api.ts:779`). UI code stays behind this module.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { Edge, Finding, FindingRetest, FindingStatus, Severity, TaskNode } from "@/lib/types";

/** Detail phases: no id selected, first read, ready, row gone, backend unreachable. */
export type FindingDetailPhase = "idle" | "loading" | "ready" | "missing" | "offline";

export interface FindingDetailState {
  phase: FindingDetailPhase;
  finding: Finding | null;
  error: string | null;
  reload: () => void;
  /** Swap in the row a successful PATCH returned (no extra read). */
  applyRow: (row: Finding) => void;
}

/** `404` (or an explicit "not found") means the row no longer exists. */
function isMissing(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /\b404\b/.test(message) || /not[\s_-]?found|不存在|未找到/i.test(message);
}

/**
 * Read one finding for the detail view.
 * @param id - finding id from the `?finding=` address, or null when no detail is open.
 * @param contextTask - optional `context_task` the backend uses to resolve inherited rows.
 * @returns phase, the row and a reload callback.
 */
export function useFindingDetail(id: string | null, contextTask?: string): FindingDetailState {
  const [phase, setPhase] = useState<FindingDetailPhase>(id === null ? "idle" : "loading");
  const [finding, setFinding] = useState<Finding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (id === null) {
      setPhase("idle");
      setFinding(null);
      setError(null);
      return;
    }
    let alive = true;
    setPhase("loading");
    api
      .getFinding(id, contextTask || undefined)
      .then((row) => {
        if (!alive) return;
        setFinding(row);
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setFinding(null);
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase(isMissing(reason) ? "missing" : "offline");
      });
    return () => {
      alive = false;
    };
  }, [contextTask, id, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  /** Replace the row after a successful PATCH without re-reading the backend. */
  const applyRow = useCallback((row: Finding) => {
    setFinding(row);
    setError(null);
    setPhase("ready");
  }, []);
  return { phase, finding, error, reload, applyRow };
}

/**
 * Human task label for the status panel: the task description when the backend
 * still has it, else the id, else the "no task" wording.
 * @param finding - backend finding.
 * @returns the label to render beside 所属任务.
 */
export function findingTaskText(finding: Finding): string {
  if (!finding.task_id) return "—（未关联任务）";
  const description = finding.task_description ?? "";
  return description !== "" ? description : `任务 #${finding.task_id}`;
}

/**
 * Asset labels of one finding, in backend order.
 * @param finding - backend finding.
 * @returns `[{ id, text }]`; empty when the row is not bound to an asset.
 */
export function findingAssetLabels(finding: Finding): ReadonlyArray<{ id: string; text: string }> {
  return (finding.assets ?? []).map((asset) => ({ id: asset.id, text: asset.label }));
}

/** Fields the edit form may send; an omitted field is left untouched. */
export interface FindingWriteFields {
  name?: string;
  vulnclass?: string;
  severity?: Severity;
  status?: FindingStatus;
}

/** Which priority-10 worker intent a deepen request created. */
export interface FindingDeepenOutcome {
  taskId: string;
  intentId: string;
  queued: boolean;
}

/** One write surface of the detail page; every trigger disables itself while busy. */
export interface FindingWriteState {
  busy: boolean;
  failure: string | null;
  notice: string | null;
  clearNotice: () => void;
  setSeverity: (next: Severity) => Promise<boolean>;
  setStatus: (next: FindingStatus) => Promise<boolean>;
  update: (fields: FindingWriteFields) => Promise<boolean>;
  /** Delete; true only when the backend confirmed the row is gone. */
  remove: () => Promise<boolean>;
  startRetest: (notes: string) => Promise<FindingRetest | null>;
  deepen: (description: string) => Promise<FindingDeepenOutcome | null>;
}

/**
 * Writes of one finding: severity/status pickers, the edit form, delete, retest
 * start and deepen. Every mutation reports its failure inline instead of
 * throwing, and a successful PATCH is handed back so the header stays in sync.
 * @param id - finding id from `?finding=`.
 * @param onRow - receives the row `PATCH` returned.
 * @returns the write state.
 */
export function useFindingWrite(id: string | null, onRow?: (row: Finding) => void): FindingWriteState {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  /** Run one mutation: clears the failure, keeps `busy` honest, reports failures inline. */
  const runWrite = useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setFailure(null);
    try {
      return await action();
    } catch (reason) {
      setFailure(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const setSeverity = useCallback(
    async (next: Severity): Promise<boolean> => {
      if (id === null) return false;
      const row = await runWrite("修改严重等级", () => api.setFindingSeverity(id, next));
      if (row === null) return false;
      onRow?.(row);
      setNotice("严重等级已保存");
      return true;
    },
    [id, onRow, runWrite],
  );

  const setStatus = useCallback(
    async (next: FindingStatus): Promise<boolean> => {
      if (id === null) return false;
      const row = await runWrite("修改处理状态", () => api.setFindingStatus(id, next));
      if (row === null) return false;
      onRow?.(row);
      setNotice("处理状态已保存");
      return true;
    },
    [id, onRow, runWrite],
  );

  const update = useCallback(
    async (fields: FindingWriteFields): Promise<boolean> => {
      if (id === null || Object.keys(fields).length === 0) return false;
      const row = await runWrite("保存漏洞信息", () => api.updateFinding(id, fields));
      if (row === null) return false;
      onRow?.(row);
      setNotice("已保存");
      return true;
    },
    [id, onRow, runWrite],
  );

  const remove = useCallback(async (): Promise<boolean> => {
    if (id === null) return false;
    const res = await runWrite("删除漏洞", () => api.deleteFinding(id));
    return res !== null && res.deleted === true;
  }, [id, runWrite]);

  const startRetest = useCallback(
    async (notes: string): Promise<FindingRetest | null> => {
      if (id === null) return null;
      const res = await runWrite("发起复测", () => api.startFindingRetest(id, notes));
      if (res === null) return null;
      setNotice(res.created ? "复测已启动，可点击「复测中」查看会话" : "该漏洞正在复测，可查看已有会话");
      return res.retest;
    },
    [id, runWrite],
  );

  const deepen = useCallback(
    async (description: string): Promise<FindingDeepenOutcome | null> => {
      if (id === null) return null;
      const res = await runWrite("提交深入意图", () => api.deepenFinding(id, description));
      if (res === null) return null;
      setNotice(
        res.queued
          ? `深入意图 #${res.intent_id} 已进入任务队列`
          : `已创建高优先级 Worker 意图 #${res.intent_id}`,
      );
      return { taskId: res.task_id, intentId: res.intent_id, queued: res.queued };
    },
    [id, runWrite],
  );

  return { busy, failure, notice, clearNotice, setSeverity, setStatus, update, remove, startRetest, deepen };
}

/** A retest is still waiting for or inside its agent run. */
export function findingRetestActive(retest: FindingRetest): boolean {
  return retest.status === "pending" || retest.status === "running";
}

export type FindingRetestsPhase = "loading" | "ready" | "offline";

export interface FindingRetestsState {
  phase: FindingRetestsPhase;
  items: FindingRetest[];
  error: string | null;
  reload: () => void;
}

/** Cadence while a retest is pending/running (same as the old panel). */
export const FINDING_RETESTS_POLL_MS = 3_000;

/**
 * Retest history of one finding (`GET …/{id}/retests`), polled while a row is
 * pending/running so a finished run refreshes the panel and the detail.
 * @param id - finding id, or null when no detail is open.
 * @param onCompleted - called when a poll saw an active row turn terminal.
 * @returns phase, rows, error and a manual reload.
 */
export function useFindingRetests(id: string | null, onCompleted?: () => void): FindingRetestsState {  const [items, setItems] = useState<FindingRetest[]>([]);
  const [phase, setPhase] = useState<FindingRetestsPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const previous = useRef<FindingRetest[]>([]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (id === null) {
      setItems([]);
      setPhase("ready");
      setError(null);
      return;
    }
    const current = ++seq.current;
    setPhase("loading");
    api
      .findingRetests(id)
      .then((rows) => {
        if (current !== seq.current) return;
        const completed = previous.current.some(
          (item) => findingRetestActive(item) && rows.some((row) => row.id === item.id && !findingRetestActive(row)),
        );
        previous.current = rows;
        setItems(rows);
        setError(null);
        setPhase("ready");
        if (completed) onCompleted?.();
      })
      .catch((reason: unknown) => {
        if (current !== seq.current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      seq.current += 1;
    };
  }, [id, onCompleted, tick]);

  const hasActive = items.some(findingRetestActive);
  useEffect(() => {
    if (id === null || error !== null || !hasActive) return;
    const timer = setTimeout(() => setTick((n) => n + 1), FINDING_RETESTS_POLL_MS);
    return () => clearTimeout(timer);
  }, [error, hasActive, id]);

  return { phase, items, error, reload };
}

export type FindingLineagePhase = "loading" | "ready" | "offline";

export interface FindingLineageState {
  phase: FindingLineagePhase;
  /** 后端返回的节点与边；null 表示还没读成功。 */
  data: { nodes: TaskNode[]; edges: Edge[] } | null;
  error: string | null;
  reload: () => void;
}

/**
 * 读取一个发现的血缘链路（A14，`GET /exploration/findings/{id}/lineage`，api.ts:759）。
 * @param id - 发现 id；null 时不请求。
 * @returns 阶段、节点与边、错误与重新读取。
 */
export function useFindingLineage(id: string | null): FindingLineageState {
  const [phase, setPhase] = useState<FindingLineagePhase>("loading");
  const [data, setData] = useState<{ nodes: TaskNode[]; edges: Edge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (id === null) return;
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .findingLineage(id)
      .then((value) => {
        if (!alive) return;
        setData(value);
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
  return { phase, data, error, reload };
}
