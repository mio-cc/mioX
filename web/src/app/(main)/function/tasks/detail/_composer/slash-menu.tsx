"use client";

/**
 * Slash-command palette for the task composer. Extracted from
 * task-workspace-dsh: the composer owns the draft and the command table, this
 * file owns the popup. Styling rides the workspace's CSS module so the palette
 * is the same material as the model popover beside it.
 */

import * as React from "react";

import styles from "../task-workspace-dsh.module.css";

/** One slash command offered by the composer palette. */
export type CommandItem = {
  readonly name: string;
  readonly title: string;
  readonly hint: string;
  readonly disabled?: boolean;
  readonly reason?: string;
  readonly run: () => void;
};

/**
 * The textarea keeps focus (it owns the draft), so the highlight is virtual:
 * ↑↓ move it, Enter/Tab run it, Esc dismisses. Rows are buttons for pointer
 * users but stay out of the tab order — a popup whose next keystroke closes it
 * must not become a tab stop.
 */
export function CommandMenu({
  items,
  activeIndex,
  onHover,
  onRun,
}: {
  readonly items: CommandItem[];
  readonly activeIndex: number;
  readonly onHover: (index: number) => void;
  readonly onRun: (item: CommandItem) => void;
}) {
  return (
    <div
      id="composer-command-list"
      className={styles.commandPanel}
      role="listbox"
      aria-label="斜杠命令"
      data-testid="composer-commands"
    >
      <div className={styles.commandHead}>
        <span>命令</span>
        <span className={styles.commandCount}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className={styles.commandEmpty}>没有匹配的命令</div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.name}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === activeIndex}
            aria-disabled={item.disabled ? "true" : undefined}
            data-active={index === activeIndex ? "true" : "false"}
            data-command={item.name}
            data-action="command"
            data-testid="composer-command-option"
            className={styles.commandRow}
            title={item.disabled ? item.reason ?? item.hint : item.hint}
            onMouseEnter={() => onHover(index)}
            onClick={() => onRun(item)}
          >
            <span className={styles.commandName}>{item.name}</span>
            <span className={styles.commandTitle}>{item.title}</span>
            <span className={styles.commandHint}>{item.disabled ? item.reason ?? item.hint : item.hint}</span>
          </button>
        ))
      )}
    </div>
  );
}
