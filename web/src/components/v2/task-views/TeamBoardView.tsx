"use client";

/**
 * 团队任务板（会话视图 tab「团队」，对照表 P1:C13–C15）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/detail/_tabs/team-tab.tsx:57-336
 * DSH 依据：DSH 无此页，按「会话视图 tab 扩展」实现（100-实施计划总表 §4.2、ui-conversation/src/client/apply.ts:216,403）。
 *
 * 只渲染真实后端数据：读取 `GET /tasks/{id}/team`，写操作全部转发到 api。
 * 团队模式未开启的提示与旧页一致（team-tab.tsx:154-162：DSH TeamBoard.tsx:86 直接不渲染）。
 */
import { type ReactNode, useMemo, useState } from "react";

import type { Task, TeamTask } from "@/lib/types";
import { toast } from "@/components/v2/settings/Toast";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Input } from "@/vendor/dsh/primitives/Input";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import { IconChevronDownOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import {
  claimTeamTask,
  completeTeamTask,
  createTeamTask,
  deleteTeamTask,
  dependencyText,
  dispatchTeamTask,
  progressLabel,
  teamStatusLabel,
  teamStatusTone,
  useTeamBoard,
} from "@/v2/data/team-board";

import css from "./TeamBoardView.module.css";

/** 一次待确认的危险操作：派发或删除。 */
type ConfirmAction = { kind: "dispatch" | "delete"; item: TeamTask } | null;

/**
 * 渲染团队任务板。
 * @param props.task - 当前选中的任务，由会话视图注册表传入。
 * @returns 团队任务板。
 */
export function TeamBoardView({ task }: { task: Task }): ReactNode {
  const board = useTeamBoard(task.id);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ subject: string; detail: string; dependsOn: number[] }>({
    subject: "",
    detail: "",
    dependsOn: [],
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const summary = progressLabel(board.progress);
  const openTasks = useMemo(() => board.tasks.filter((item) => item.status !== "completed"), [board.tasks]);

  /** 写操作统一包一层：置忙、失败提示、成功后重读。 */
  const runWrite = async (id: number, label: string, action: () => Promise<unknown>): Promise<void> => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await action();
      board.reload();
    } catch (reason: unknown) {
      toast(`${label}失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusyId(null);
    }
  };

  const submitCreate = (): void => {
    const subject = form.subject.trim();
    if (subject === "" || creating) return;
    setCreating(true);
    setCreateError(null);
    createTeamTask(task.id, {
      subject,
      detail: form.detail.trim() === "" ? undefined : form.detail.trim(),
      dependsOn: form.dependsOn.length > 0 ? form.dependsOn : undefined,
    })
      .then(() => {
        setCreating(false);
        setCreateOpen(false);
        setForm({ subject: "", detail: "", dependsOn: [] });
        board.reload();
      })
      .catch((reason: unknown) => {
        setCreating(false);
        setCreateError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const toggleDepend = (id: number): void => {
    setForm((current) => ({
      ...current,
      dependsOn: current.dependsOn.includes(id)
        ? current.dependsOn.filter((value) => value !== id)
        : [...current.dependsOn, id],
    }));
  };

  const runConfirm = (): void => {
    if (confirm === null || confirmBusy) return;
    const { kind, item } = confirm;
    setConfirmBusy(true);
    const action = kind === "dispatch" ? () => dispatchTeamTask(item.id) : () => deleteTeamTask(item.id);
    action()
      .then(() => {
        setConfirmBusy(false);
        setConfirm(null);
        if (kind === "dispatch") toast("已派发，worker 会领取这条任务");
        board.reload();
      })
      .catch((reason: unknown) => {
        setConfirmBusy(false);
        setConfirm(null);
        toast(`${kind === "dispatch" ? "派发" : "删除"}失败：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  };

  if (task.team_mode !== true) {
    return (
      <div className={css.wrap} data-team-board="off">
        <p className={css.notice}>
          团队模式未开启：在会话头部的模式菜单里打开「团队模式」，这个任务才会出现共享任务板。
        </p>
      </div>
    );
  }

  return (
    <div className={css.wrap} data-team-board="">
      <div className={css.header}>
        <div className={css.summary} data-team-summary="">
          <span>{summary === "" ? "还没有团队任务" : summary}</span>
          {board.progress.blocked > 0 ? (
            <span className={css.blocked}>· {board.progress.blocked} 项被阻塞</span>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} data-team-create-open="">
          新建团队任务
        </Button>
      </div>

      {board.phase === "loading" ? <div className={css.state}>加载团队任务…</div> : null}

      {board.phase === "offline" ? (
        <div className={css.stateError} role="alert">
          <span>团队任务读取失败：{board.error}</span>
          <Button variant="outline" size="sm" onClick={board.reload}>
            重试
          </Button>
        </div>
      ) : null}

      {board.phase === "ready" && board.tasks.length === 0 ? (
        <p className={css.empty}>团队任务板是空的。新建一条，或让 planner 拆解目标后自动写入。</p>
      ) : null}

      {board.phase === "ready" && board.tasks.length > 0 ? (
        <ul className={css.list}>
          {board.tasks.map((item) => {
            const blocked = item.status === "pending" && !item.ready;
            const open = expanded === item.id;
            return (
              <li key={item.id} className={css.row} data-team-id={item.id} data-status={item.status}>
                <button
                  type="button"
                  className={css.rowHead}
                  aria-expanded={open}
                  data-team-row-toggle=""
                  onClick={() => setExpanded(open ? null : item.id)}
                >
                  <span className={css.subject} title={item.subject}>
                    {item.subject}
                  </span>
                  <Tag tone={teamStatusTone(item.status)}>{teamStatusLabel(item.status)}</Tag>
                  {blocked ? <Tag tone="warning">被阻塞</Tag> : null}
                  <span className={css.rowMeta}>{item.owner === "" ? "未分配" : item.owner}</span>
                  <span className={css.chevron} data-open={open ? "true" : "false"} aria-hidden="true">
                    <IconChevronDownOutlineRegular size={12} />
                  </span>
                </button>

                {open ? (
                  <div className={css.rowBody} data-team-row-detail="">
                    <p className={css.detail}>{item.detail === "" ? "（没有补充说明）" : item.detail}</p>
                    <p className={css.metaRow}>
                      <span className={css.metaLabel}>负责人：</span>
                      <span>{item.owner === "" ? "未分配" : item.owner}</span>
                    </p>
                    <p className={css.metaRow}>
                      <span className={css.metaLabel}>依赖：</span>
                      <span>{item.depends_on.length > 0 ? dependencyText(item.depends_on, board.tasks) : "无"}</span>
                    </p>
                    <p className={css.metaRow}>
                      <span className={css.metaLabel}>来源：</span>
                      <span>{item.source_intent_id === null ? "手动添加" : `意图 #${item.source_intent_id}`}</span>
                    </p>
                    <div className={css.actions}>
                      {item.status === "pending" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!item.ready || busyId === item.id}
                          title={item.ready ? "认领这条任务" : "依赖未完成，暂不可认领"}
                          data-team-claim=""
                          onClick={() => {
                            void runWrite(item.id, "认领", () => claimTeamTask(item.id));
                          }}
                        >
                          认领
                        </Button>
                      ) : null}
                      {item.status === "pending" && item.source_intent_id === null ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === item.id}
                          data-team-dispatch=""
                          onClick={() => setConfirm({ kind: "dispatch", item })}
                        >
                          派发
                        </Button>
                      ) : null}
                      {item.status !== "completed" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === item.id}
                          data-team-complete=""
                          onClick={() => {
                            void runWrite(item.id, "完成", () => completeTeamTask(item.id));
                          }}
                        >
                          完成
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === item.id}
                        data-team-delete=""
                        onClick={() => setConfirm({ kind: "delete", item })}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
        title="新建团队任务"
        closeLabel="关闭"
        description="这条任务只写进本任务的共享看板，不会自动派发。"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={creating}
              onClick={() => {
                setCreateOpen(false);
                setCreateError(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={creating || form.subject.trim() === ""}
              data-team-create-submit=""
              onClick={submitCreate}
            >
              {creating ? "创建中…" : "创建"}
            </Button>
          </>
        }
      >
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.fieldLabel}>标题</span>
            <Input
              value={form.subject}
              placeholder="要做什么"
              data-team-create-subject=""
              onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>说明（可选）</span>
            <textarea
              className={css.textarea}
              rows={3}
              value={form.detail}
              data-team-create-detail=""
              onChange={(event) => setForm((current) => ({ ...current, detail: event.target.value }))}
            />
          </label>
          {openTasks.length > 0 ? (
            <div className={css.field}>
              <span className={css.fieldLabel}>依赖（可选，勾选后要等这些任务完成）</span>
              <div className={css.dependList}>
                {openTasks.map((item) => (
                  <label key={item.id} className={css.dependRow}>
                    <input
                      type="checkbox"
                      checked={form.dependsOn.includes(item.id)}
                      data-team-create-depends={item.id}
                      onChange={() => toggleDepend(item.id)}
                    />
                    <span className={css.dependText}>
                      #{item.id} {item.subject}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {createError !== null ? (
            <p className={css.errorLine} role="alert">
              创建失败：{createError}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!confirmBusy) setConfirm(null);
        }}
        title={confirm?.kind === "dispatch" ? "确认派发" : "确认删除"}
        closeLabel="关闭"
        tone="warning"
        description={
          confirm?.kind === "dispatch"
            ? "派发后这条任务会变成意图，由 worker 领取执行，会消耗模型额度。"
            : "删除后这条团队任务不再出现在看板上，此操作不可撤销。"
        }
        footer={
          <>
            <Button variant="outline" size="sm" disabled={confirmBusy} onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={confirmBusy} data-team-confirm="" onClick={runConfirm}>
              {confirmBusy ? "处理中…" : confirm?.kind === "dispatch" ? "确认派发" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className={css.confirmText}>{confirm === null ? "" : confirm.item.subject}</p>
      </Modal>
    </div>
  );
}
