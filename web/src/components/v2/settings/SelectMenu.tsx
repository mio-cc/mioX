"use client";

/**
 * Anchored select: a button anchor plus the vendored `Menu` surface.
 * Replaces native <select> so the open list uses DSH's menu material,
 * radius, item height and checkmark instead of the browser's own popup.
 */
import * as React from "react";
import { Menu } from "@/vendor/dsh/primitives/Menu";
import { IconChevronDownOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import css from "./SelectMenu.module.css";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export function SelectMenu(props: {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name for the trigger when the selected label alone is too generic. */
  ariaLabel?: string;
}): React.ReactNode {
  const [open, setOpen] = React.useState(false);
  const selected = props.options.find((o) => o.value === props.value);

  return (
    <Menu
      open={open}
      anchor={
        <button
          id={props.id}
          type="button"
          className={`${css.trigger} ${props.className ?? ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={props.ariaLabel}
          disabled={props.disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={css.value}>{selected?.label ?? props.value}</span>
          <IconChevronDownOutlineRegular size={12} className={css.caret} />
        </button>
      }
      items={props.options.map((o) => ({ id: o.value, label: o.label }))}
      selectedId={props.value}
      selection="check"
      onSelect={(id) => {
        props.onChange(id);
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
    />
  );
}
