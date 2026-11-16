"use client";

/**
 * Trajectory timeline (port of DSH `ui-trajectory/TrajectoryTimeline`).
 *
 * Three lanes, turn boundaries as vertical lines, one bar per operation. Hovering a bar
 * shows its label; clicking jumps to that operation in the chat. The projection switch
 * mirrors DSH's mode buttons.
 */

import * as React from "react";

import type { Activity } from "@/lib/types";

import {
  deriveTrajectory,
  spanRect,
  TRAJECTORY_LANES,
  TRAJECTORY_MODES,
  type TrajectoryMode,
  type TrajectorySpan,
} from "./trajectory";
import styles from "./trajectory.module.css";

export function TrajectoryTimeline({
  activities,
  onJump,
}: {
  readonly activities: readonly Activity[];
  readonly onJump?: (seq: number) => void;
}) {
  const [mode, setMode] = React.useState<TrajectoryMode>("sequence");
  const [hover, setHover] = React.useState<{ span: TrajectorySpan; x: number; y: number } | null>(null);

  const model = React.useMemo(() => deriveTrajectory(activities, mode), [activities, mode]);

  if (!model) {
    return (
      <div className={styles.empty} data-testid="trajectory-empty">
        还没有可展示的轨迹
      </div>
    );
  }

  return (
    <section className={styles.root} aria-label="任务轨迹" data-testid="trajectory">
      <header className={styles.head}>
        <div className={styles.modes} role="tablist" aria-label="投影方式">
          {TRAJECTORY_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={mode === option.value}
              className={styles.mode}
              data-active={mode === option.value || undefined}
              title={option.hint}
              data-testid={`trajectory-mode-${option.value}`}
              onClick={() => setMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className={styles.stats} data-testid="trajectory-stats">
          {model.spans.length} 步 · {model.turns} 回合
        </div>
      </header>

      <div className={styles.plot}>
        <div className={styles.laneLabels} aria-hidden="true">
          {TRAJECTORY_LANES.map((lane) => (
            <span key={lane.index} className={styles.laneLabel}>
              {lane.label}
            </span>
          ))}
        </div>
        <div className={styles.track} data-testid="trajectory-track">
          {model.boundaries
            .map((boundary) => (
              <span
                key={`${boundary.turn}-${boundary.at}`}
                className={styles.boundary}
                style={{ left: `${((boundary.at - model.start) / (model.end - model.start || 1)) * 100}%` }}
                data-testid="trajectory-boundary"
                title={`回合 ${boundary.turn}`}
              />
            ))}
          {TRAJECTORY_LANES.map((lane) => (
            <div key={lane.index} className={styles.lane} data-lane={lane.index}>
              {model.spans
                .filter((span) => span.lane === lane.index)
                .map((span) => {
                  const rect = spanRect(span, model);
                  return (
                    <button
                      key={span.seq}
                      type="button"
                      className={styles.span}
                      data-kind={span.kind}
                      data-error={span.isError || undefined}
                      data-testid="trajectory-span"
                      data-seq={span.seq}
                      style={{ left: `${rect.left}%`, width: `${rect.width}%` }}
                      aria-label={`${span.worker} · ${span.kind} · ${span.label}`}
                      onMouseEnter={(event) =>
                        setHover({
                          span,
                          x: event.currentTarget.getBoundingClientRect().left,
                          y: event.currentTarget.getBoundingClientRect().top,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                      onClick={() => onJump?.(span.seq)}
                    />
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {hover ? (
        <div
          className={styles.tooltip}
          style={{ left: Math.min(hover.x, window.innerWidth - 280), top: hover.y - 44 }}
          role="tooltip"
          data-testid="trajectory-tooltip"
        >
          <span className={styles.tooltipKind}>{hover.span.kind}</span>
          <span className={styles.tooltipLabel}>{hover.span.label}</span>
        </div>
      ) : null}
    </section>
  );
}
