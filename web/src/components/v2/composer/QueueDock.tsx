"use client";

/**
 * Queue strip rendered above the composer editor while rows wait for their turn.
 *
 * Port of DSH's `ui-conversation/queue/QueueDock.tsx` (`:123-197`): `data-queue-dock`
 * wrapper, no header for a single row (the row carries the queue glyph, `:197`), a
 * collapsible count header from two rows up ("N 条排队消息", `locales.ts:383`) with a
 * chevron (`:185-187`) and the mute sending status while the list is hidden
 * (`:182-184`), one row per submission with a single-line text preview, a
 * "发送中…" state (`locales.ts:384`), and a `删除排队消息` action (`locales.ts:391`).
 * The list starts collapsed and stops rendering rows while collapsed (`:131-132`,
 * `:190-191`). This queue is page-level browser state (see `useComposerQueue.ts`),
 * text-only, so it has no edit, attachment, or steer controls — steer does not exist
 * in the ARTEX backend, so no placeholder is drawn for it.
 */
import * as React from "react";

import {
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconQueueOutlineRegular,
  IconTrashOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import css from "./QueueDock.module.css";

/** One row the dock renders, owned by `useComposerQueue`. */
export interface QueueDockRow {
  readonly id: string;
  readonly text: string;
  readonly status: "queued" | "sending" | "error";
  readonly error: string | null;
}

/**
 * Render the queue strip.
 * @param props.rows - queued submissions, head first.
 * @param props.onRemove - drops one row the hook is not sending.
 * @param props.held - a user stop kept the rows (DSH `keepInbox`); they wait for the next send.
 * @returns the dock, or nothing for an empty queue.
 */
export function QueueDock({
  rows,
  onRemove,
  held = false,
}: {
  readonly rows: readonly QueueDockRow[];
  readonly onRemove: (id: string) => void;
  readonly held?: boolean;
}): React.ReactNode {
  // Collapsed by default, and folded back as soon as the queue drains
  // (`QueueDock.tsx:128,131-132`).
  const [collapsed, setCollapsed] = React.useState(true);
  const listId = React.useId();
  const rowCount = rows.length;
  React.useEffect(() => {
    if (rowCount === 0 && !collapsed) setCollapsed(true);
  }, [collapsed, rowCount]);

  if (rowCount === 0) return null;

  const expanded = !collapsed;
  const listVisible = rowCount === 1 || expanded;
  const sendingPending = rows.some((row) => row.status === "sending");

  return (
    <div className={css.dock} data-queue-dock="" data-queue-count={rowCount} data-queue-held={held ? "" : undefined}>
      {/* mioX enhancement: the backend stop keeps the rows (DSH `keepInbox`), so the
          strip says why they are not draining. Shown only while the hold is on. */}
      {held ? (
        <div className={css.held} role="status">
          已停止，发送新消息后继续
        </div>
      ) : null}
      {rowCount > 1 ? (
        <button
          type="button"
          className={css.header}
          aria-controls={listId}
          aria-expanded={expanded}
          data-queue-header=""
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className={css.lead} aria-hidden="true">
            <IconQueueOutlineRegular size={14} />
          </span>
          {/* `queue.count` in the source zh locale (`locales.ts:383`). */}
          <span className={css.count}>{rowCount} 条排队消息</span>
          {!listVisible && sendingPending ? (
            // `queue.sending` = 发送中… (`locales.ts:384`), DSH `QueueDock.tsx:182-184`.
            <span className={css.status} role="status">
              发送中…
            </span>
          ) : null}
          <span className={css.chevron} aria-hidden="true">
            {expanded ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronUpOutlineRegular size={14} />}
          </span>
        </button>
      ) : null}
      <ul id={listId} className={css.list} hidden={!listVisible}>
        {listVisible
          ? rows.map((row) => (
              <li key={row.id} className={css.row} data-queue-item="" data-queue-status={row.status}>
                {/* A single-row strip has no count header, so the row carries the glyph. */}
                {rowCount === 1 ? (
                  <span className={css.lead} aria-hidden="true">
                    <IconQueueOutlineRegular size={14} />
                  </span>
                ) : null}
                <span className={css.preview} title={row.text}>
                  {row.text}
                </span>
                {row.status === "sending" ? (
                  <span className={css.status} role="status">
                    发送中…
                  </span>
                ) : null}
                {row.status === "error" ? (
                  <span className={css.error} role="status" title={row.error ?? "发送失败"}>
                    发送失败：{row.error ?? "未知错误"}
                  </span>
                ) : null}
                {/* `queue.remove` = 删除排队消息 (`locales.ts:391`), DSH sends no row index. */}
                <button
                  type="button"
                  className={css.remove}
                  aria-label="删除排队消息"
                  title="删除排队消息"
                  disabled={row.status === "sending"}
                  onClick={() => onRemove(row.id)}
                >
                  <IconTrashOutlineRegular size={14} />
                </button>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
