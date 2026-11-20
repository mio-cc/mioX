"use client";

/**
 * Session row with its context menu, mirroring ui-workspace/session-actions:
 * order is pin → rename → read state → fork → (separator) copy id →
 * (separator) archive. Archived rows offer no pin/read-state; archiving a session
 * that still has running work must confirm what will be stopped first.
 *
 * C10（P1:A16）追加多选：`selectable` / `selected` / `onSelectedChange` 三个可选属性，
 * 只在侧栏多选模式下传入；传了就画行内勾选框，并且点行只切勾选、不切任务。
 * 旧页面依据：`ARTEX/web/src/app/(main)/function/tasks/page.tsx:930-935`（表头全选）、
 *   `:1183-1188`（每行勾选框）、`:992-996`（行传入 selected/onSelectedChange）。
 * 对照表行：P1:A16。
 */
import * as React from "react";
import { Button } from "@/vendor/dsh/primitives/Button";
import { Checkbox } from "@/vendor/dsh/primitives/Checkbox";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { IconEllipsisOutlineRegular, IconPinFillRegular } from "@/vendor/dsh/primitives/icons/index";
import type { TaskStatus } from "@/lib/types";
import { taskStatusTone, TASK_STATUS_LABEL } from "@/v2/data/tasks";
import { toast } from "../settings/Toast";
import css from "./SessionRow.module.css";

export interface Session {
  id: string;
  label: string;
  time: string;
  pinned?: boolean;
  archived?: boolean;
  unread?: boolean;
  running?: boolean;
  // ---- C09 行内补齐（P1:A30）：全部来自 `Task` 的真实字段，缺省即不画 ----
  /** 任务描述（`Task.description`），作为标题的提示文字。 */
  description?: string;
  /** 后端状态（`Task.status`），渲染成状态 Tag。 */
  status?: TaskStatus;
  /** 目标进度（`Task.goals_met/goals_total`），`—` 表示没有目标。 */
  goals?: string;
  /** 发现四档计数 `严重/高/中/低`（`Task.findings`）。 */
  findings?: string;
  /** 发现计数的完整提示文字。 */
  findingsTitle?: string;
  /** 在途意图数（`Task.in_flight`）。 */
  inFlight?: string;
  /** 运行时长（`Task.created_unix` / `completed_unix` 推出）。 */
  duration?: string;
  /** token 用量（`Task.tokens`）的紧凑文案。 */
  tokens?: string;
  /** 最近活动（`Task.last_activity_unix`）的相对时间。 */
  activity?: string;
  /** 后端标记的活动任务（`Task.active`）。 */
  active?: boolean;
}

export function SessionRow({
  session,
  active,
  onSelect,
  onChange,
  selectable = false,
  selected = false,
  onSelectedChange,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Session> | "remove") => void;
  /** C10 多选模式：为 true 时行左侧出现勾选框（P1:A16）。 */
  selectable?: boolean;
  /** C10 多选模式：该行当前是否被勾选。 */
  selected?: boolean;
  /** C10 多选模式：勾选状态变化；有它时点行只切勾选、不切任务。 */
  onSelectedChange?: (next: boolean) => void;
}): React.ReactNode {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(session.label);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const archived = session.archived === true;
  const trimmed = draft.trim();
  const renameBlocked = busy || trimmed === "" || trimmed === session.label;
  const selecting = selectable && onSelectedChange !== undefined;

  const items = [
    ...(archived ? [] : [{ id: "pin", label: session.pinned === true ? "取消置顶" : "置顶会话" }]),
    { id: "rename", label: "重命名" },
    { id: "fork", label: "分叉会话（后端未提供）", disabled: true },
    // C09 P1:A30：读状态没有任务字段，但「运行中」是真实的 `Task.status`，
    // 「标为未读」本身不成立（旧页也没有），故只保留运行状态这一条真实项。
    {
      id: "read",
      label:
        session.status === undefined
          ? "标为未读（任务无该字段）"
          : `状态 ${TASK_STATUS_LABEL[session.status]}`,
      disabled: true,
    },
    { id: "copy", label: "复制 Session ID", separatorBefore: true },
    { id: "archive", label: archived ? "取消归档" : "归档会话", separatorBefore: true },
  ];

  const run = (id: string): void => {
    setMenuOpen(false);
    if (id === "pin") { onChange({ pinned: session.pinned !== true }); return; }
    if (id === "rename") { setDraft(session.label); setRenaming(true); return; }
    if (id === "copy") {
      void navigator.clipboard.writeText(session.id).then(
        () => toast(`已复制 ${session.id}`),
        () => toast("复制失败：浏览器拒绝了剪贴板访问"),
      );
      return;
    }
    if (id === "archive") {
      if (archived) { onChange({ archived: false }); return; }
      // Running work must be named before it is stopped.
      if (session.running === true) { setConfirming(true); return; }
      onChange({ archived: true });
    }
  };

  // C09 P1:A30：行内补充真实字段。侧栏只有 264px，五个字段平铺只会全部被截成「目标 …
  // 发现 0/0/…」，所以第二行只放有信息量的两三项：有目标时的进度、有发现时的总数、
  // 在途数（>0 才显示）；完整的目标/发现/在途/时长/活动/token 进行的 tooltip（title）。
  const findingsTotal =
    session.findings === undefined
      ? 0
      : session.findings.split("/").reduce((sum, part) => sum + (Number.parseInt(part, 10) || 0), 0);
  const summary: string[] = [];
  if (session.goals !== undefined && session.goals !== "—" && session.goals !== "") summary.push(`目标 ${session.goals}`);
  if (findingsTotal > 0) summary.push(`发现 ${findingsTotal}`);
  if (session.inFlight !== undefined && session.inFlight !== "0") summary.push(`在途 ${session.inFlight}`);
  if (summary.length === 0 && session.duration !== undefined && session.duration !== "") summary.push(`时长 ${session.duration}`);
  const hasMeta = summary.length > 0;
  const detailLines = [
    session.description ?? session.label,
    session.goals === undefined ? null : `目标进度 ${session.goals}`,
    session.findingsTitle ?? null,
    session.inFlight === undefined ? null : `在途意图 ${session.inFlight}`,
    session.duration === undefined ? null : `运行时长 ${session.duration}`,
    session.activity === undefined ? null : `最近活动 ${session.activity}前`,
    session.tokens === undefined ? null : `Token ${session.tokens}`,
  ].filter((line): line is string => line !== null && line !== "");
  const title = detailLines.join("\n");
  const statusTone = session.status === undefined ? "neutral" : taskStatusTone(session.status);

  return (
    <>
      <div
        className={`${css.row} ${active ? css.rowActive : ""} ${hasMeta || session.status !== undefined ? css.rowTall : ""} ${selected ? css.rowSelected : ""}`}
        role="button"
        tabIndex={0}
        title={title}
        aria-label={session.status === undefined ? session.label : `${session.label}，${TASK_STATUS_LABEL[session.status]}`}
        aria-current={active ? "true" : undefined}
        data-task-id={session.id}
        data-task-status={session.status}
        data-task-selected={selected ? "true" : undefined}
        onClick={() => {
          // C10：多选模式下点行只切勾选，不切任务（总表派工第 5 条）。
          if (selecting) {
            onSelectedChange(!selected);
            return;
          }
          onSelect();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (selecting) {
            onSelectedChange(!selected);
            return;
          }
          onSelect();
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
      >
        <span className={css.line}>
          {selecting ? (
            <span
              className={css.checkSeat}
              // 勾选框自己处理点击，不让两次切换互相抵消。
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={selected}
                onChange={(next) => onSelectedChange(next)}
                label=""
                title={`选择任务 ${session.label}`}
                className={css.rowCheck}
              />
            </span>
          ) : (
            // Status is one dot, not a tag: a tag ate a third of the 264px row and
            // truncated every title. The full status stays in the label's tooltip
            // and in the row's accessible name.
            <span
              className={`${css.statusDot} ${css[`tone_${statusTone}`] ?? ""} ${session.running === true ? css.statusDotLive : ""}`}
              aria-hidden="true"
            />
          )}
          {session.unread === true ? <span className={css.dot} aria-label="未读" /> : null}
          <span className={css.label}>{session.label}</span>
          {session.pinned === true ? (
            <span className={css.pin} aria-label="已置顶" title="已置顶">
              <IconPinFillRegular size={11} />
            </span>
          ) : null}
          <span className={css.time}>{session.time}</span>
          <Menu
            open={menuOpen}
            portal
            align="end"
            anchor={
              <button
                type="button"
                className={css.more}
                aria-label="会话操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              >
                <IconEllipsisOutlineRegular size={14} />
              </button>
            }
            items={items}
            onSelect={run}
            onClose={() => setMenuOpen(false)}
          />
        </span>
        {hasMeta ? (
          <span className={css.meta}>
            {session.status !== undefined ? (
              <span className={`${css.metaStatus} ${css[`ink_${statusTone}`] ?? ""}`}>{TASK_STATUS_LABEL[session.status]}</span>
            ) : null}
            {summary.map((item) => (
              <span className={css.metaItem} key={item}>
                {item}
              </span>
            ))}
          </span>
        ) : session.status !== undefined ? (
          <span className={css.meta}>
            <span className={`${css.metaStatus} ${css[`ink_${statusTone}`] ?? ""}`}>{TASK_STATUS_LABEL[session.status]}</span>
          </span>
        ) : null}
      </div>

      <Modal
        open={renaming}
        onClose={() => { if (!busy) setRenaming(false); }}
        closeLabel="关闭"
        title="重命名会话"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setRenaming(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={renameBlocked}
              onClick={() => { onChange({ label: trimmed }); setRenaming(false); }}
            >
              重命名
            </Button>
          </>
        }
      >
        <input
          className={css.input}
          value={draft}
          aria-label="会话名称"
          autoFocus
          disabled={busy}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !renameBlocked) { onChange({ label: trimmed }); setRenaming(false); }
          }}
        />
      </Modal>

      <Modal
        open={confirming}
        onClose={() => { if (!busy) setConfirming(false); }}
        closeLabel="关闭"
        title="停止并归档此会话？"
        description={`「${session.label}」仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏「全部对话（显示已归档）」中恢复会话，被停止的工作不会自动继续。`}
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>取消</Button>
            <Button
              variant="outline"
              className={css.danger}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                window.setTimeout(() => { setBusy(false); setConfirming(false); onChange({ archived: true }); }, 300);
              }}
            >
              停止并归档
            </Button>
          </>
        }
      >
        <div className={css.stopped}>
          <span className={css.stoppedLabel}>将被停止的工作</span>
          <span className={css.stoppedRow}>进行中的回合</span>
        </div>
      </Modal>
    </>
  );
}
