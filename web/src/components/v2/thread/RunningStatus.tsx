"use client";

/**
 * Running status at the tail of the chat stream.
 *
 * Port of `packages/client/ui-chat/src/client/chat/RunningStatus.tsx:25-48` and
 * its style block `ChatView.module.css:218-317`: the blue `data-chat-running`
 * row carries DSH's `chat.deepDiving` / `chat.deepDivingFor` copy (「深度求索中」
 * / 「深度求索中，用时 {duration} ···」), the whale glyph, the shimmering label
 * and the tail-slot divider. `running: false` returns `null`, so an idle stream
 * keeps zero footprint.
 *
 * The clock starts at the first observation of `running`: mioX's `chat/status`
 * answers `{running:boolean}` only, so the run start time is not exposed. The
 * first second shows the short copy, then the whole-second label counts from
 * that observation point (a lower bound of the real turn duration).
 */
import { useEffect, useState } from "react";

import { TextShimmer } from "@/vendor/dsh/primitives/TextShimmer";

import css from "./RunningStatus.module.css";

/** DSH's `chat.deepDiving` zh copy: the label before the clock is allocated. */
const SHORT_LABEL = "深度求索中";
/** DSH's `chat.deepDivingFor` zh template (`locale.ts:101`): `{duration}` is 「N秒」. */
const TIMED_TEMPLATE = (duration: string): string => `深度求索中，用时 ${duration} ···`;
/** Whole-second refresh, as DSH's `LIVE_RUN_CLOCK_INTERVAL_MS` (`message-chrome.ts:13`). */
const CLOCK_MS = 1000;

/** Static fallback glyph: `RunningWhaleTail.tsx:4` `REST_PATH` (16-unit viewBox). */
const WHALE_PATH =
  "M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742";

/**
 * Build the localized elapsed text; DSH floors to whole seconds and switches to
 * minutes at 60s and hours at 60min (`message-chrome.ts:54-63`).
 * @param ms - elapsed milliseconds since the clock started.
 * @returns e.g. `「12秒」`, `「1分15秒」`, `「1小时2分5秒」`.
 */
function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  let text = `${seconds}秒`;
  if (total >= 60) text = `${minutes}分${text}`;
  if (hours > 0) text = `${hours}小时${text}`;
  return text;
}

/** Props of the running row. */
export interface RunningStatusProps {
  /** True while the backend reports the selected task's turn as running. */
  readonly running: boolean;
  /**
   * Tail divider visibility. DSH raises it unless the previous visible row is an
   * input (`ChatView.module.css:240-245`), so a user bubble above keeps it off.
   */
  readonly divider?: boolean;
}

/**
 * Render the status row, or nothing while idle.
 * @param props.running - backend run flag owned by the shell's single poll.
 * @param props.divider - whether the row above the status is turn content.
 * @returns the `data-chat-running` row, or null when nothing runs.
 */
export function RunningStatus({ running, divider = false }: RunningStatusProps): React.ReactNode {
  /** First observation of `running`: the local clock origin (real start is not exposed). */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** Latest whole-second tick; null until the first second elapses. */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running) {
      setStartedAt(null);
      setNow(null);
      return;
    }
    setStartedAt(Date.now());
    setNow(null);
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [running]);

  if (!running) return null;

  const elapsed = startedAt === null || now === null ? null : Math.max(CLOCK_MS, now - startedAt);
  const label = elapsed === null ? SHORT_LABEL : TIMED_TEMPLATE(formatRunDuration(elapsed));

  return (
    <div className={css.running} data-chat-running data-divider={divider ? "" : undefined}>
      {/* DSH announces the short copy once in a polite live region
          (`RunningStatus.tsx:20,39`); the ticking visible text stays out of it. */}
      <span className={css.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {SHORT_LABEL}
      </span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent} aria-hidden="true">
        <span className={css.runningIcon}>
          <svg width="100%" height="100%" viewBox="0 0 16 16" fill="none">
            <path d={WHALE_PATH} stroke="currentColor" strokeWidth={1} />
          </svg>
        </span>
        <TextShimmer active className={css.runningText}>
          {label}
        </TextShimmer>
      </span>
    </div>
  );
}
