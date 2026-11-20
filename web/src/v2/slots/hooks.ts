"use client";

/**
 * Registration hook for the mini slot registry.
 *
 * The entry is registered while the calling component is mounted and disposed on
 * unmount. Registration uses a layout effect so contributors are present before
 * the first paint: the owner's seats never flash empty on page load.
 */
import { useLayoutEffect } from "react";

import type { SlotContext, SlotEntry, SlotName } from "./registry";
import { useSlotRegistry } from "./SlotProvider";

/**
 * Register one entry for the lifetime of the calling component.
 * @param name - declared slot name.
 * @param entry - the contribution. Pass a stable reference (module constant or
 * `useMemo`): the effect is keyed on it, so a fresh object literal on every
 * render would dispose and re-register the entry each time.
 */
export function useSlotRegister<Name extends SlotName>(name: Name, entry: SlotEntry<SlotContext<Name>>): void {
  const registry = useSlotRegistry();
  useLayoutEffect(() => registry.register(name, entry), [registry, name, entry]);
}
