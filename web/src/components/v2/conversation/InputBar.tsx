"use client";

/**
 * Composer bar seat.
 *
 * Port of `ui-conversation/src/client/skeleton/InputBar.tsx:437-438` and
 * `InputBar.module.css:1-34`: the bar is a centered column with the side
 * clearance, and the hero variant drops the docked footer pad. The input
 * surface itself is the shell-provided `Composer`, so this wrapper only owns
 * the seat geometry and the `data-composer-card` hook.
 */
import type { ReactNode } from "react";

import clsx from "clsx";

import css from "./InputBar.module.css";

/**
 * Render the composer bar shell.
 * @param props.variant - `composer` for the docked bar, `hero` for the blank home.
 * @param props.children - the composer surface.
 * @returns the bar wrapper.
 */
export function InputBar({
  variant,
  children,
}: {
  readonly variant: "composer" | "hero";
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={clsx(css.root, variant === "hero" && css.hero)} data-composer-bar="" data-composer-card="">
      {children}
    </div>
  );
}
