/**
 * Mini slot registry: named ordered-list extension points for the /v2 shell.
 *
 * Surface: {@link SlotRegistry} (owner-side store), {@link SlotProvider} and
 * {@link Slot} (React integration), {@link useSlotRegister} (contributor side).
 * Slot names and their owner data are declaration-merged on
 * `@/v2/slots/registry`; see that module for the exact contract.
 */
export { useSlotRegister } from "./hooks";
export type { RegisteredSlotEntry, SlotContext, SlotContextMap, SlotEntry, SlotName } from "./registry";
export { SlotRegistry } from "./registry";
export { Slot, SlotProvider, useSlotRegistry } from "./SlotProvider";
