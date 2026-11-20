"use client";

/**
 * Session-header background-jobs chip.
 *
 * Port of `ui-jobs/src/client/JobListAction.tsx:567-594`: the trigger is a
 * 28px icon button carrying the live glyph and the count label, it is only
 * mounted when the roster has a live row, and it opens a list of those rows.
 * ARTEX has no job RPC, so the roster is the task list filtered to
 * `status === "running"`: selecting a row opens that task, and the row's
 * two-press control pauses it through `POST /tasks/{id}/control`
 * (`api.controlTask`). Timing constants and the two-press state machine mirror
 * `JobListAction.tsx:54-58,177,459-498`.
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";

import clsx from "clsx";

import type { Task } from "@/lib/types";
import { IconStopFillRegular } from "@/vendor/dsh/primitives/icons/index";
import { Menu } from "@/vendor/dsh/primitives/Menu";

import css from "./ConversationRoot.module.css";
import { taskTitle } from "./contract";

/** How long an armed pause waits for its confirming press before disarming. */
const PAUSE_ARM_MS = 3_000;

/** How long a rejected pause keeps its failure hint before the control resets. */
const PAUSE_FAILED_MS = 4_000;

/** Running rows tick their elapsed label at this cadence. */
const ELAPSED_TICK_MS = 1_000;

/** Two-press pause affordance state (idle rows carry no explicit state). */
type PauseState = "idle" | "armed" | "pending" | "failed";

/** The armed/pending/failed phase of exactly one row, like `killPhase` upstream. */
interface PausePhase {
  readonly key: string;
  readonly state: Exclude<PauseState, "idle">;
}

/**
 * Seconds a live row has been observed running.
 * @param now - latest clock sample.
 * @param startedAt - first sample that saw the task running, if any.
 * @returns whole elapsed seconds, never negative.
 */
function elapsedSeconds(now: number, startedAt: number | undefined): number {
  if (startedAt === undefined) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}

/**
 * Accessible/tooltip copy for the two-press pause control.
 * @param state - the row's pause phase.
 * @param title - the task title the control acts on.
 * @returns the label DSH puts on its kill control (`kill.confirm` /
 * `kill.failed` / `kill.stop`).
 */
function pauseLabel(state: PauseState, title: string): string {
  if (state === "armed") return "确认暂停";
  if (state === "failed") return "暂停失败";
  if (state === "pending") return "正在暂停…";
  return `暂停任务：${title}`;
}

/**
 * Render the running-jobs chip and its roster menu.
 * @param props.tasks - candidate tasks; only `running` rows are listed.
 * @param props.activeTaskId - selected task id, used to mark the current row.
 * @param props.onOpenTask - select a running task from the roster.
 * @param props.onPauseTask - pause a running task; resolves once the backend
 * accepted the control and the roster snapshot was refreshed.
 * @returns the chip, or null when nothing is running.
 */
export function BackgroundJobsChip({
  tasks,
  activeTaskId,
  onOpenTask,
  onPauseTask,
}: {
  readonly tasks: readonly Task[];
  readonly activeTaskId: string;
  readonly onOpenTask: (id: string) => void;
  readonly onPauseTask: (id: string) => Promise<void>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [phase, setPhase] = useState<PausePhase | undefined>(undefined);
  // The backend exposes no run-start timestamp, so "已运行" counts from the
  // first poll that saw the task running (a page loaded mid-run starts at 0s).
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  const live = useMemo(() => tasks.filter((task) => task.status === "running"), [tasks]);
  const liveKey = live.map((task) => task.id).join(",");

  // One ticker runs while the roster is live; it only re-renders this chip.
  useEffect(() => {
    if (liveKey === "") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [liveKey]);

  // First-seen timestamps: prune rows that stopped running, stamp new ones.
  useEffect(() => {
    const ids = liveKey === "" ? [] : liveKey.split(",");
    const stamp = Date.now();
    setStartedAt((current) => {
      let changed = Object.keys(current).length !== ids.length;
      const next: Record<string, number> = {};
      for (const id of ids) {
        next[id] = current[id] ?? stamp;
        if (current[id] === undefined) changed = true;
      }
      return changed ? next : current;
    });
  }, [liveKey]);

  // A vanished roster closes the popover; it would otherwise reopen stale.
  useEffect(() => {
    if (liveKey === "") setOpen(false);
  }, [liveKey]);

  // An armed pause disarms on a timer; a failed one drops its hint. The pending
  // phase instead waits for the RPC and the refreshed roster.
  useEffect(() => {
    if (phase === undefined || phase.state === "pending") return;
    const timer = setTimeout(
      () => setPhase(undefined),
      phase.state === "armed" ? PAUSE_ARM_MS : PAUSE_FAILED_MS,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  // A phase whose row stopped being running (paused elsewhere, finished,
  // removed) has no control to describe any more.
  useEffect(() => {
    if (phase === undefined) return;
    if (!live.some((task) => task.id === phase.key)) setPhase(undefined);
  }, [phase, live]);

  /**
   * First press arms the row, a confirming press inside the arm window sends
   * the pause request. A rejected request shows its failure hint for 4s.
   * @param task - the running task whose pause control was pressed.
   */
  const pressPause = (task: Task): void => {
    const key = task.id;
    if (phase?.key !== key || phase.state !== "armed") {
      setPhase({ key, state: "armed" });
      return;
    }
    setPhase({ key, state: "pending" });
    void onPauseTask(key).then(
      () => {
        setPhase((current) => (current?.key === key && current.state === "pending" ? undefined : current));
      },
      () => {
        setPhase((current) =>
          current?.key === key && current.state === "pending" ? { key, state: "failed" } : current,
        );
      },
    );
  };

  if (live.length === 0) return null;

  const count = live.length;
  const label = `${count} 个后台任务`;

  return (
    <Menu
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      anchor={
        <button
          type="button"
          className={css.jobsTrigger}
          data-jobs-chip=""
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {/* DSH shows the spinner while jobs are live and the layers glyph
              when idle (JobListAction.tsx:587-590); this chip only mounts with
              a live row, so the spinner is the only reachable state. */}
          <span className={css.jobsActivity} aria-hidden="true">
            <span className={css.jobsSpinner} data-jobs-spinner="" />
          </span>
          <span className={css.jobsCount} data-job-count={count}>
            {label}
          </span>
        </button>
      }
      align="end"
      side="bottom"
      portal
      listClassName={css.jobsMenu}
    >
      <div className={css.jobsSectionHeader} data-jobs-menu-header="" aria-hidden="true">
        进行中
      </div>
      <ul className={css.jobsRoster} aria-label="运行中的后台任务">
        {live.map((task) => {
          const state: PauseState = phase?.key === task.id ? phase.state : "idle";
          const title = taskTitle(task);
          const seconds = elapsedSeconds(now, startedAt[task.id]);
          return (
            <li
              key={task.id}
              className={css.jobsItem}
              data-job-id={task.id}
              data-job-status={task.status}
              data-job-current={task.id === activeTaskId ? "" : undefined}
            >
              <div className={css.jobsRowLine}>
                <button
                  type="button"
                  className={css.jobsRow}
                  title={`打开任务：${title}`}
                  onClick={() => {
                    setOpen(false);
                    onOpenTask(task.id);
                  }}
                >
                  <span className={css.jobsDot} aria-hidden="true" />
                  <span className={css.jobsMain}>
                    <span className={css.jobsLabel}>{title}</span>
                    <span className={css.jobsMeta}>
                      <span className={css.jobsState}>运行中</span>
                      {/* Every live row ticks its own elapsed label. */}
                      <span className={css.jobsDuration} data-job-elapsed={seconds}>
                        已运行 {seconds}s
                      </span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={clsx(
                    css.jobsStop,
                    state === "armed" && css.jobsStopArmed,
                    state === "failed" && css.jobsStopFailed,
                  )}
                  data-job-pause={task.id}
                  data-pause-state={state}
                  disabled={state === "pending"}
                  aria-label={pauseLabel(state, title)}
                  title={pauseLabel(state, title)}
                  onClick={() => {
                    pressPause(task);
                  }}
                >
                  <IconStopFillRegular size={10} />
                  {/* The armed press must be legible without hover: the button
                      widens into a labeled confirm pill instead of a tint only
                      (JobListAction.tsx:283-286). */}
                  {state === "armed" || state === "failed" ? (
                    <span className={css.jobsStopLabel}>{state === "armed" ? "确认暂停" : "暂停失败"}</span>
                  ) : null}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Menu>
  );
}
