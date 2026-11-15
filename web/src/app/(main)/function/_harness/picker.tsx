"use client";

import * as React from "react";

import { ChevronDown } from "lucide-react";

import styles from "./list.module.css";

/**
 * Minimal single-select popover. Replaces native <select>: native option lists
 * cannot be styled and look out of place in this shell.
 */
export function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ value: T; label: string }>;
  readonly onChange: (next: T) => void;
  readonly testId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  React.useEffect(() => {
    if (!open) return;
    setCursor(Math.max(0, options.findIndex((option) => option.value === value)));
    const frame = window.requestAnimationFrame(() => listRef.current?.focus());
    const onDocDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDocDown);
    };
  }, [open, options, value]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        type="button"
        className={styles.pickerTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
      >
        <span className={styles.pickerValue}>{current?.label ?? label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={listRef}
          className={styles.pickerMenu}
          role="listbox"
          tabIndex={0}
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((i) => Math.min(options.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              commit(cursor);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              className={styles.pickerOption}
              data-active={index === cursor ? "true" : "false"}
              onMouseEnter={() => setCursor(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
