"use client";

/**
 * GoalBar —— 任务级「目标」的指示条,停在输入框上方(input dock strip)。
 * 参照 DSH @deepseek-ai/dsh-client-ui-goal/src/client/GoalBar.tsx:
 *   - :1-10   一个在场的目标显示:目标图标 + 阶段标签 + 截断目标 + 图标动作
 *             (编辑=同一条里展开内联表单 / 清除 / armed 时暂停、否则恢复);
 *             目标创建在 `/goal` 命令里,不在这里;
 *             loading(undefined)/已完成(complete) 一律不渲染;
 *   - :30-41  阶段标签只有 active / paused / blocked;
 *   - :132-133 恢复/暂停是同一个按钮的两种形态:phase!=='active' 时是「恢复」。
 *
 * 与 DSH 的差异(有意为之):DSH 还有 active.disarmed 子态(进程内激活态),
 * 我们目前没有"disarmed"这个进程内概念,所以只按持久化 phase 渲染。
 * 另一处差异(U3):无目标(null)时不再 return null,而是渲染一条「设置目标」
 * 空态入口,点开是同一个内联表单,保存走 onCreate(等价于 /goal 命令)。
 */

import * as React from "react";
import { Check, Pause, Pencil, Play, Target, Trash2, X } from "lucide-react";

import type { GoalSnapshot } from "@/lib/types";
import styles from "../task-workspace-dsh.module.css";

const PHASE_LABELS: Record<GoalSnapshot["phase"], string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "已阻塞",
  complete: "已完成",
};

export function GoalBar({
  goal,
  busy,
  error,
  onCreate,
  onEdit,
  onPause,
  onResume,
  onClear,
}: {
  readonly goal: GoalSnapshot | null | undefined;
  readonly busy: boolean;
  readonly error: string;
  /** 创建目标(等价 /goal 命令):成功(true)才收起内联表单。 */
  readonly onCreate: (objective: string) => Promise<boolean>;
  /** 保存编辑:成功(true)才收起内联表单(DSH GoalBar.tsx:74-79 `if (result?.ok) setEditing(false)`)。 */
  readonly onEdit: (objective: string) => Promise<boolean>;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onClear: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const goalId = goal?.id;

  // 目标身份变了(被替换/清除/外部修改)→ 丢掉本地编辑态,否则残留草稿的
  // Enter 会写到新目标上(DSH GoalBar.tsx:51-58 同一考虑)。
  React.useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [goalId]);

  // loading(undefined)不渲染;无目标(null)渲染「设置目标」空态入口(U3);
  // 已完成(complete)不渲染(DSH GoalBar.tsx:87 口径)。
  if (goal === undefined) return null;
  const empty = goal === null;
  if (!empty && goal.phase === "complete") return null;

  const resume = empty ? false : goal.phase !== "active";

  if (editing) {
    const save = async () => {
      const trimmed = draft.trim();
      if (trimmed === "" || busy) return;
      // 保存失败时保持表单打开,让用户看到 goal-error 并改(而不是静默丢弃)。
      const ok = empty ? await onCreate(trimmed) : await onEdit(trimmed);
      if (ok) setEditing(false);
    };
    return (
      <div
        className={styles.goalDock}
        data-testid="goal-bar"
        data-goal-phase={empty ? "empty" : goal.phase}
        data-editing="true"
      >
        <div className={`${styles.goalBar} ${styles.goalBarEdit}`}>
          <span className={styles.goalGlyph} aria-hidden="true">
            <Target size={14} />
          </span>
          <input
            className={styles.goalEditInput}
            value={draft}
            placeholder="写下要达成的最终结果"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void save();
              } else if (event.key === "Escape") {
                setEditing(false);
              }
            }}
            aria-label="目标内容"
            data-testid="goal-edit-input"
            autoFocus
          />
          {error !== "" ? (
            <span className={styles.goalError} role="alert" data-testid="goal-error">
              {error}
            </span>
          ) : null}
          <div className={styles.goalActions}>
            <button
              type="button"
              className={styles.goalIconBtn}
              onClick={() => void save()}
              disabled={busy || draft.trim() === ""}
              aria-label="保存目标"
              title="保存目标"
              data-testid="goal-save"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className={styles.goalIconBtn}
              onClick={() => setEditing(false)}
              disabled={busy}
              aria-label="取消编辑"
              title="取消编辑"
              data-testid="goal-cancel"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (empty) {
    // 空态入口(U3):以前这里 return null,新任务完全看不到"目标"这个位置。
    return (
      <div className={styles.goalDock} data-testid="goal-bar" data-goal-empty="true">
        <div className={styles.goalBar}>
          <span className={styles.goalGlyph} aria-hidden="true">
            <Target size={14} />
          </span>
          <span className={styles.goalPhase} data-testid="goal-phase" data-phase="empty">
            无目标
          </span>
          <span className={styles.goalObjective} title="设置目标后，agent 每轮都会围绕它推进">
            设置目标后，agent 每轮都会围绕它推进（也可以用 /goal 命令）
          </span>
          {error !== "" ? (
            <span className={styles.goalError} role="alert" data-testid="goal-error">
              {error}
            </span>
          ) : null}
          <div className={styles.goalActions}>
            <button
              type="button"
              className={styles.goalIconBtn}
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
              aria-label="设置目标"
              title="设置目标"
              data-testid="goal-create"
            >
              <Pencil size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.goalDock} data-testid="goal-bar" data-goal-phase={goal.phase} data-goal-revision={goal.revision}>
      <div className={styles.goalBar}>
        <span className={styles.goalGlyph} aria-hidden="true">
          <Target size={14} />
        </span>
        <span className={styles.goalPhase} data-testid="goal-phase" data-phase={goal.phase}>
          {PHASE_LABELS[goal.phase]}
        </span>
        {/* 截断展示:完整目标在 title 里,条上只留一行。 */}
        <span className={styles.goalObjective} title={goal.objective} data-testid="goal-objective">
          {goal.objective}
        </span>
        {error !== "" ? (
          <span className={styles.goalError} role="alert" data-testid="goal-error">
            {error}
          </span>
        ) : null}
        <div className={styles.goalActions}>
          <button
            type="button"
            className={styles.goalIconBtn}
            disabled={busy}
            onClick={() => {
              setDraft(goal.objective);
              setEditing(true);
            }}
            aria-label="编辑目标"
            title="编辑目标"
            data-testid="goal-edit"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={styles.goalIconBtn}
            disabled={busy}
            onClick={onClear}
            aria-label="清除目标"
            title="清除目标"
            data-testid="goal-clear"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className={styles.goalIconBtn}
            disabled={busy}
            onClick={resume ? onResume : onPause}
            aria-label={resume ? "恢复目标" : "暂停目标"}
            title={resume ? "恢复目标" : "暂停目标"}
            data-testid={resume ? "goal-resume" : "goal-pause"}
          >
            {resume ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
