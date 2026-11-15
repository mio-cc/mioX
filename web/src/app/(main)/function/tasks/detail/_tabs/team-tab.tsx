"use client";

/**
 * Team task board (ported from the reference TeamBoard): a shared work list with
 * a progress summary, one row per task, and claim/complete actions.
 *
 * Row shape mirrors the backend `TeamTask`: subject / status / owner / ready,
 * where `ready === false` on a pending row means it is blocked by a dependency.
 *
 * The board itself is gated on the session-level team mode: the reference
 * renders nothing when `agentTeam.enabled` is false (TeamBoard.tsx:86), so the
 * switch in the model menu is what makes this tab meaningful.
 */

import * as React from "react";

import { Check, ChevronDown, Loader2, Plus, Trash2, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import type { TeamTask, TeamTaskProgress } from "@/lib/types";

import styles from "../task-workspace-dsh.module.css";

type Board = { tasks: TeamTask[]; progress: TeamTaskProgress };

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

const EMPTY_PROGRESS: TeamTaskProgress = { total: 0, completed: 0, active: 0, pending: 0, blocked: 0 };

/**
 * 进度摘要：DSH TeamBoard.tsx:29-38 —— 三段「{count} 已完成 / {count} 进行中 /
 * {count} 待处理」，只用 `\u2002·\u2002` 连接，且**只显示非零项**（全零时返回空串）。
 */
function progressLabel(progress: TeamTaskProgress): string {
  return [
    ...(progress.completed > 0 ? [`${progress.completed} 已完成`] : []),
    ...(progress.active > 0 ? [`${progress.active} 进行中`] : []),
    ...(progress.pending > 0 ? [`${progress.pending} 待处理`] : []),
  ].join("\u2002·\u2002");
}

/** 依赖项的展示文案：#id 标题（状态）；已被删掉的依赖只留 #id。 */
function dependencyText(ids: readonly number[], tasks: readonly TeamTask[]): string {
  return ids
    .map((id) => {
      const target = tasks.find((item) => item.id === id);
      return target ? `#${id} ${target.subject}（${STATUS_LABEL[target.status] ?? target.status}）` : `#${id}`;
    })
    .join("、");
}

export function TeamTab({ taskId, teamMode }: { readonly taskId: string; readonly teamMode: boolean }) {
  const [board, setBoard] = React.useState<Board>({ tasks: [], progress: EMPTY_PROGRESS });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const load = React.useCallback(() => {
    setError("");
    return api
      .teamBoard(taskId)
      .then((next) => setBoard({ tasks: next.tasks, progress: next.progress }))
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [taskId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const text = subject.trim();
    if (text === "" || creating) return;
    setCreating(true);
    try {
      await api.createTeamTask(taskId, text);
      setSubject("");
      await load();
    } catch (createError) {
      toast.error((createError as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const claim = async (item: TeamTask) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    try {
      await api.claimTeamTask(item.id, "operator");
      await load();
    } catch (claimError) {
      toast.error((claimError as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (item: TeamTask) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    try {
      await api.completeTeamTask(item.id);
      await load();
    } catch (completeError) {
      toast.error((completeError as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  // Dispatch turns a manual board row into an intent so the scheduler picks it up.
  const dispatch = async (item: TeamTask) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    try {
      await api.dispatchTeamTask(item.id);
      toast.success("已派发，worker 会领取这条任务");
      await load();
    } catch (dispatchError) {
      toast.error((dispatchError as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: TeamTask) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    try {
      await api.deleteTeamTask(item.id);
      await load();
    } catch (removeError) {
      toast.error((removeError as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const { progress } = board;
  const summary = progressLabel(progress);

  // 会话级团队模式关闭时整块看板不渲染（DSH TeamBoard.tsx:86
  // `if (!team?.enabled) return null`）。这里比源码多一句说明文案：mioX 的看板是
  // 独立 tab，纯空白会让人以为坏了；DSH 的看板挂在子 agent 目录下方，没有这个问题。
  if (!teamMode) {
    return (
      <div className={styles.teamWrap} data-testid="team-board-off">
        <p className={styles.teamEmpty}>
          团队模式未开启：在输入框的「模型」菜单里打开「团队模式」，这个会话才会出现共享任务板。
        </p>
      </div>
    );
  }

  return (
    <div className={styles.teamWrap} data-testid="team-board">
      <div className={styles.teamHeader}>
        <div className={styles.teamSummary} data-testid="team-summary">
          <span data-testid="team-progress">{summary || "还没有任务"}</span>
          {progress.blocked > 0 ? <span className={styles.teamBlocked}>· {progress.blocked} 项被阻塞</span> : null}
        </div>
        <div className={styles.teamComposer}>
          <input
            className={styles.teamInput}
            value={subject}
            placeholder="添加一条团队任务…"
            aria-label="添加团队任务"
            onChange={(event) => setSubject(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
            data-testid="team-input"
          />
          <button
            type="button"
            className={styles.teamAdd}
            onClick={() => void create()}
            disabled={creating || subject.trim() === ""}
            aria-label="添加团队任务"
            data-action="team-create"
            data-testid="team-create"
          >
            {creating ? <Loader2 size={13} className={styles.spinner} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
            添加
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.stateRow}>
          <Loader2 size={13} className={styles.spinner} aria-hidden="true" />
          <span>加载团队任务…</span>
        </div>
      ) : null}
      {error ? (
        <div className={styles.stateError} role="alert">
          <span className={styles.stateErrorTitle}>团队任务加载失败</span>
          <span className={styles.stateErrorBody}>{error}</span>
          <button type="button" className={styles.stateRetry} onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      {!loading && !error && board.tasks.length === 0 ? (
        <p className={styles.teamEmpty}>团队任务板是空的。添加一条，或让 planner 拆解目标后自动写入。</p>
      ) : null}

      <ul className={styles.teamList}>
        {board.tasks.map((item) => {
          const blocked = item.status === "pending" && !item.ready;
          const open = expanded === item.id;
          const detailsId = `team-task-details-${item.id}`;
          return (
            <li
              key={item.id}
              className={styles.teamRow}
              data-status={item.status}
              data-blocked={blocked ? "true" : "false"}
              data-expanded={open ? "true" : "false"}
              data-testid="team-row"
              data-team-id={item.id}
            >
              <button
                type="button"
                className={styles.teamRowHead}
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setExpanded(open ? null : item.id)}
                data-testid="team-row-toggle"
              >
                <span className={styles.teamDot} data-state={blocked ? "blocked" : item.status} aria-hidden="true" />
                <span className={styles.teamSubject}>{item.subject}</span>
                <span className={styles.teamMeta}>
                  {blocked ? "被阻塞" : STATUS_LABEL[item.status] ?? item.status}
                  {item.owner ? ` · ${item.owner}` : ""}
                </span>
                <ChevronDown size={12} aria-hidden="true" className={styles.teamChevron} data-open={open ? "true" : "false"} />
              </button>
              {open ? (
                <div className={styles.teamRowBody} id={detailsId} data-testid="team-row-details">
                  {/* 内容：DSH 展开区先放 description（TeamBoard.tsx:68）。 */}
                  <p className={styles.teamDetail} data-testid="team-detail">
                    {item.detail ? item.detail : "（没有补充说明）"}
                  </p>
                  {/* 负责人：DSH `data-team-task-owner`（TeamBoard.tsx:69-74）；
                      空 owner 用 DSH 的 unowned 文案（locales.ts:33 '未分配'）。 */}
                  <p className={styles.teamMetaRow} data-testid="team-row-owner">
                    <span className={styles.teamMetaLabel}>负责人：</span>
                    <span>{item.owner ? item.owner : "未分配"}</span>
                  </p>
                  {/* 依赖：mioX 的 team_tasks 有 depends_on（DSH TeamTaskView 无此字段）。 */}
                  <p className={styles.teamMetaRow} data-testid="team-row-deps" data-deps={item.depends_on.join(",")}>
                    <span className={styles.teamMetaLabel}>依赖：</span>
                    <span>{item.depends_on.length > 0 ? dependencyText(item.depends_on, board.tasks) : "无"}</span>
                  </p>
                  {/* 来源：手动添加 vs 由探索意图投影而来（team_tasks.source_intent_id）。 */}
                  <p className={styles.teamMetaRow} data-testid="team-row-source">
                    <span className={styles.teamMetaLabel}>来源：</span>
                    <span>{item.source_intent_id ? `意图 #${item.source_intent_id}` : "手动添加"}</span>
                  </p>
                  <div className={styles.teamActions}>
                    {item.status === "pending" ? (
                      <button
                        type="button"
                        className={styles.teamAction}
                        onClick={() => void claim(item)}
                        disabled={!item.ready || busyId === item.id}
                        title={item.ready ? "认领这条任务" : "依赖未完成，暂不可认领"}
                        data-action="team-claim"
                        data-testid="team-claim"
                      >
                        <UserPlus size={12} aria-hidden="true" />
                        认领
                      </button>
                    ) : null}
                    {item.status === "pending" && !item.source_intent_id ? (
                      <button
                        type="button"
                        className={styles.teamAction}
                        onClick={() => void dispatch(item)}
                        disabled={busyId === item.id}
                        title="把这条任务交给 worker 执行"
                        data-action="team-dispatch"
                        data-testid="team-dispatch"
                      >
                        <Send size={12} aria-hidden="true" />
                        派发
                      </button>
                    ) : null}
                    {item.status !== "completed" ? (
                      <button
                        type="button"
                        className={styles.teamAction}
                        onClick={() => void complete(item)}
                        disabled={busyId === item.id}
                        data-action="team-complete"
                        data-testid="team-complete"
                      >
                        <Check size={12} aria-hidden="true" />
                        完成
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`${styles.teamAction} ${styles.teamActionDanger}`}
                      onClick={() => void remove(item)}
                      disabled={busyId === item.id}
                      data-action="team-delete"
                      data-testid="team-delete"
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      删除
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
