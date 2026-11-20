"use client";

/**
 * 意图列表与意图控制（会话视图 tab「意图」，对照表 P1:C8–C12）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/overview-tab.tsx:316-348（重跑）、
 * sessions-tab.tsx:586-632（暂停/恢复/取消）、sessions-tab.tsx:1534（给 worker 发消息）。
 * DSH 依据：DSH 无意图页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2）。
 */
import { type ReactNode, useMemo, useState } from "react";

import type { Task, TaskNode } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { SegmentedControl } from "@/vendor/dsh/primitives/SegmentedControl";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  controlIntent,
  isRerunnable,
  rerunBlocked,
  rerunIntent,
  sendWorkerMessage,
  useIntents,
} from "@/v2/data/intents";
import { intentStateLabel, intentTitle, sessionTime } from "@/v2/data/sessions";

import css from "./IntentsView.module.css";

/** 状态筛选值。 */
type StateFilter = "all" | "running" | "blocked" | "done" | "other";

const FILTER_OPTIONS: readonly { value: StateFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行中" },
  { value: "blocked", label: "受阻" },
  { value: "done", label: "已完成" },
  { value: "other", label: "其他" },
];

/**
 * 状态对应的 Tag 色调。
 * @param state - 后端意图状态。
 * @returns Tag 的 tone。
 */
function stateTone(state: string): "neutral" | "info" | "success" | "warning" | "danger" | "outline" {
  if (state === "done") return "success";
  if (state === "running") return "info";
  if (state === "blocked") return "danger";
  if (state === "paused" || state === "stopped") return "warning";
  if (state === "open") return "neutral";
  return "outline";
}

/**
 * 判断一条意图是否落在当前筛选里。
 * @param state - 后端意图状态。
 * @param filter - 当前筛选。
 * @returns 命中为 true。
 */
function matchesFilter(state: string, filter: StateFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return state === "running";
  if (filter === "blocked") return state === "blocked";
  if (filter === "done") return state === "done";
  return !["running", "blocked", "done"].includes(state);
}

/**
 * 渲染意图列表与控制面板。
 * @param props.task - 当前选中的任务。
 * @returns 意图视图。
 */
export function IntentsView({ task }: { task: Task }): ReactNode {
  const state = useIntents(task.id);
  const [filter, setFilter] = useState<StateFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [specialBusy, setSpecialBusy] = useState<"rerunAll" | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TaskNode | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelMode, setCancelMode] = useState<"soft" | "hard">("soft");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [messageFor, setMessageFor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const rows = useMemo(
    () => state.intents.filter((row) => matchesFilter(row.state, filter)),
    [state.intents, filter],
  );
  const blockedCount = useMemo(() => state.intents.filter((row) => row.state === "blocked").length, [state.intents]);

  /** 写操作统一入口：置忙、失败提示、成功后重读。 */
  const runControl = async (
    row: TaskNode,
    label: string,
    action: () => Promise<unknown>,
    done: string,
  ): Promise<void> => {
    if (busyId !== null) return;
    setBusyId(row.id);
    try {
      await action();
      toast(done);
      state.reload();
    } catch (reason: unknown) {
      toast(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusyId(null);
    }
  };

  const runRerunAll = (): void => {
    if (specialBusy !== null) return;
    setSpecialBusy("rerunAll");
    rerunBlocked(task.id)
      .then((result) => {
        toast(result.reopened > 0 ? `已重开 ${result.reopened} 条受阻意图` : "没有受阻的意图需要重跑");
        state.reload();
      })
      .catch((reason: unknown) => {
        toast(`重跑受阻意图失败：${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => {
        setSpecialBusy(null);
      });
  };

  const submitCancel = (): void => {
    if (cancelTarget === null || cancelBusy) return;
    const reason = cancelReason.trim();
    if (reason === "") return;
    setCancelBusy(true);
    controlIntent(task.id, cancelTarget.id, "cancel", reason, cancelMode)
      .then((result) => {
        setCancelBusy(false);
        setCancelTarget(null);
        setCancelReason("");
        if (cancelMode === "hard") {
          const deleted = result.deleted;
          const extra = deleted
            ? `（含 ${deleted.intents} 意图 / ${deleted.facts} 事实 / ${deleted.findings} 漏洞）`
            : "";
          toast(`已彻底删除该意图及其独占下游${extra}`);
        } else {
          toast("已删除（原因已记录，规划者将据此重新规划）");
        }
        state.reload();
      })
      .catch((reason: unknown) => {
        setCancelBusy(false);
        toast(`取消失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  const submitMessage = (row: TaskNode): void => {
    const text = message.trim();
    if (text === "" || sending) return;
    setSending(true);
    sendWorkerMessage(task.id, row.id, text)
      .then(() => {
        setSending(false);
        setMessage("");
        setMessageFor(null);
        toast("已发送，worker 会在下一步读取");
      })
      .catch((reason: unknown) => {
        setSending(false);
        toast(`发送失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  return (
    <div className={css.wrap} data-intents-view="">
      <div className={css.toolbar}>
        <SegmentedControl
          id="intents-filter"
          label="按状态筛选意图"
          value={filter}
          options={FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(next) => setFilter(next as StateFilter)}
        />
        <span className={css.count} data-intents-count={rows.length}>
          {rows.length} 条
        </span>
        <div className={css.toolbarRight}>
          <Button
            variant="outline"
            size="sm"
            disabled={blockedCount === 0 || specialBusy !== null}
            title={blockedCount === 0 ? "当前没有受阻的意图" : "把所有受阻意图置回待派发"}
            data-intents-rerun-blocked=""
            onClick={runRerunAll}
          >
            {specialBusy === "rerunAll" ? "重跑中…" : `重跑全部受阻（${blockedCount}）`}
          </Button>
          <Button variant="outline" size="sm" onClick={state.reload} data-intents-refresh="">
            刷新
          </Button>
        </div>
      </div>

      {state.phase === "loading" ? <div className={css.state}>加载意图…</div> : null}

      {state.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>意图读取失败：{state.error}</span>
          <Button variant="outline" size="sm" onClick={state.reload}>
            重试
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" && state.intents.length === 0 ? (
        <p className={css.empty}>这个任务还没有意图。让 planner 拆解目标后，意图会出现在这里。</p>
      ) : null}

      {state.phase === "ready" && state.intents.length > 0 && rows.length === 0 ? (
        <p className={css.empty}>当前筛选下没有意图。</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className={css.list}>
          {rows.map((row) => (
            <li key={row.id} className={css.row} data-intent-id={row.id} data-state={row.state}>
              <div className={css.rowHead}>
                <span className={css.title} title={intentTitle(row.payload, row.id)}>
                  {intentTitle(row.payload, row.id)}
                </span>
                <Tag tone={stateTone(row.state)}>{intentStateLabel(row.state)}</Tag>
                <span className={css.rowMeta}>
                  #{row.id}
                  {row.priority > 0 ? ` · 优先级 ${row.priority}` : ""}
                  {row.ts === "" ? "" : ` · ${sessionTime(row.ts)}`}
                </span>
              </div>
              <div className={css.actions}>
                {isRerunnable(row.state) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id}
                    data-intent-rerun=""
                    onClick={() => {
                      void runControl(
                        row,
                        "重跑",
                        () => rerunIntent(task.id, row.id),
                        `意图 #${row.id} 已置回待派发`,
                      );
                    }}
                  >
                    重跑
                  </Button>
                ) : null}
                {row.state === "running" || row.state === "open" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id}
                    data-intent-pause=""
                    onClick={() => {
                      void runControl(
                        row,
                        "暂停",
                        () => controlIntent(task.id, row.id, "pause"),
                        `意图 #${row.id} 已暂停`,
                      );
                    }}
                  >
                    暂停
                  </Button>
                ) : null}
                {row.state === "paused" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === row.id}
                    data-intent-resume=""
                    onClick={() => {
                      void runControl(
                        row,
                        "恢复",
                        () => controlIntent(task.id, row.id, "resume"),
                        `意图 #${row.id} 已恢复`,
                      );
                    }}
                  >
                    恢复
                  </Button>
                ) : null}
                {row.state !== "done" && row.state !== "deleted" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      data-intent-message-toggle=""
                      onClick={() => {
                        setMessageFor(messageFor === row.id ? null : row.id);
                        setMessage("");
                      }}
                    >
                      发消息
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      data-intent-cancel=""
                      onClick={() => {
                        setCancelTarget(row);
                        setCancelReason("");
                        setCancelMode("soft");
                      }}
                    >
                      取消意图
                    </Button>
                  </>
                ) : null}
              </div>
              {messageFor === row.id ? (
                <div className={css.messageRow}>
                  <Input
                    value={message}
                    placeholder="给这个 worker 的下一步指令"
                    data-intent-message-input={row.id}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitMessage(row);
                      }
                    }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={sending || message.trim() === ""}
                    data-intent-message-send=""
                    onClick={() => submitMessage(row)}
                  >
                    {sending ? "发送中…" : "发送"}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        open={cancelTarget !== null}
        onClose={() => {
          if (!cancelBusy) setCancelTarget(null);
        }}
        title="取消意图"
        closeLabel="关闭"
        tone="warning"
        description="取消会记录原因，规划者会据此重新规划。选「彻底删除」会同时移除该意图的独占下游。"
        footer={
          <>
            <Button variant="outline" size="sm" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={cancelBusy || cancelReason.trim() === ""}
              data-intent-cancel-submit=""
              onClick={submitCancel}
            >
              {cancelBusy ? "处理中…" : "确认取消"}
            </Button>
          </>
        }
      >
        <div className={css.form}>
          <p className={css.confirmText}>
            {cancelTarget === null ? "" : `#${cancelTarget.id} ${intentTitle(cancelTarget.payload, cancelTarget.id)}`}
          </p>
          <SegmentedControl
            id="intent-cancel-mode"
            label="取消方式"
            value={cancelMode}
            options={[
              { value: "soft", label: "标记删除（保留产出）" },
              { value: "hard", label: "彻底删除（含独占下游）" },
            ]}
            onChange={(next) => setCancelMode(next as "soft" | "hard")}
          />
          <label className={css.field}>
            <span className={css.fieldLabel}>取消原因（必填）</span>
            <textarea
              className={css.textarea}
              rows={3}
              value={cancelReason}
              data-intent-cancel-reason=""
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
