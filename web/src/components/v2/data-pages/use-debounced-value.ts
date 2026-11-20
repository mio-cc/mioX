"use client";

/** Debounce for the data pages' filter box: keystrokes must not each be a query. */
import { useEffect, useState } from "react";

/**
 * Return `value` once it has stayed unchanged for `delayMs`.
 * @param value - fast-changing value, such as raw filter text.
 * @param delayMs - quiet period before the value is committed to the caller.
 * @returns the last settled value.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
