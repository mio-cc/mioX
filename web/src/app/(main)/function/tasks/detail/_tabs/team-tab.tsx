"use client";

/**
 * Team task board (ported from the reference TeamBoard): a shared work list with
 * a progress summary, one row per task, and claim/complete actions.
 *
 * Row shape mirrors the backend `TeamTask`: subject / status / owner / ready,
 * where `ready === false` on a pending row means it is blocked by a dependency.
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

export function TeamTab({ taskId }: { readonly taskId: string }) {
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
  const summary = [
    progress.completed > 0 ? `已完成 ${progress.completed}` : "",
    progress.active > 0 ? `进行中 ${progress.active}` : "",
    progress.pending > 0 ? `待处理 ${progress.pending}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className={styles.teamWrap} data-testid="team-board">
      <div className={styles.teamHeader}>
        <div className={styles.teamSummary} data-testid="team-summary">
          {summary || "还没有任务"}
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
          return (
            <li
              key={item.id}
              className={styles.teamRow}
              data-status={item.status}
              data-blocked={blocked ? "true" : "false"}
              data-testid="team-row"
              data-team-id={item.id}
            >
              <button
                type="button"
                className={styles.teamRowHead}
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : item.id)}
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
                <div className={styles.teamRowBody}>
                  {item.detail ? <p className={styles.teamDetail}>{item.detail}</p> : null}
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
