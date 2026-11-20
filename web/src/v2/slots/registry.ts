/**
 * Mini slot registry for the /v2 shell.
 *
 * Port of the ordered-list half of DSH's `@deepseek-ai/dsh-client-ui-slots`:
 *
 * - a slot is a named extension point. The owner of the surface declares it and
 *   renders it; contributors add entries and never reach into the owner's tree.
 * - a list slot renders its entries sorted by explicit `order` ascending
 *   (default 0); equal `order` keeps registration order. DSH sorts by
 *   `priority` first and then by explicit `order` with registration order as the
 *   tie-break (`ui-slots/src/index.ts:1350-1360`); this mini registry exposes the
 *   explicit-`order` tier only, so one sort key decides every seat.
 * - `when(ctx) === false` skips rendering while the entry stays registered. That
 *   is the observable behavior DSH gets from a component returning `null`
 *   (`ui-jobs/src/client/JobListAction.tsx:500`), plus the predicate lets the
 *   owner data hide an entry without unmounting it.
 * - `register()` returns its disposer. Unmounting disposes, listeners are
 *   notified, and the disposer is idempotent: a second call (or a stale call
 *   after the slot changed) cannot detach another registration.
 *
 * Duplicate ids inside one slot are a programming error: `register()` throws
 * instead of shadowing or silently overwriting. Every registration here is
 * component-owned, so a silent second owner would hide a lifecycle bug.
 *
 * Slot names are declaration-merged by the feature that owns the surface:
 *
 * ```ts
 * declare module "@/v2/slots/registry" {
 *   interface SlotContextMap {
 *     "conversation.header.actions": ConversationHeaderSlotContext;
 *   }
 * }
 * ```
 */

import type { ReactNode } from "react";

/** Slot name → owner data; owning features extend it by declaration merging. */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging anchor; slot names arrive from feature modules.
export interface SlotContextMap {}

/** Names declared through {@link SlotContextMap}. Rendering an undeclared name fails to compile. */
export type SlotName = keyof SlotContextMap;

/** Owner data one slot entry renders against. */
export type SlotContext<Name extends SlotName> = SlotContextMap[Name];

/** One contribution to a list slot. */
export interface SlotEntry<Ctx> {
  /** Unique inside the slot; a second registration with the same id throws. */
  readonly id: string;
  /** Ascending display position inside the slot; default 0. Ties keep registration order. */
  readonly order?: number;
  /**
   * Conditional visibility, evaluated while rendering with the owner's context.
   * Returning false skips this entry's render but keeps it registered.
   */
  when?(ctx: Ctx): boolean;
  /** Render the contribution for this context. */
  render(ctx: Ctx): ReactNode;
}

/** A registered entry plus the registration sequence that breaks `order` ties. */
export interface RegisteredSlotEntry<Ctx> extends SlotEntry<Ctx> {
  readonly sequence: number;
}

interface Registration<Ctx> {
  readonly entry: SlotEntry<Ctx>;
  readonly sequence: number;
}

/** Ordered-list slot registry with subscribe/snapshot for `useSyncExternalStore`. */
export class SlotRegistry {
  /** One ordered registration list per slot; entries stay in registration order until sorted on read. */
  private readonly registrations = new Map<SlotName, Registration<never>[]>();
  /** Cached frozen sorted snapshots; one array per slot, invalidated by any registration change. */
  private readonly snapshots = new Map<SlotName, readonly RegisteredSlotEntry<never>[]>();
  private readonly listeners = new Set<() => void>();
  private nextSequence = 0;

  /**
   * Add one entry to a slot.
   * @param name - declared slot name; the compiler rejects undeclared names.
   * @param entry - the contribution. `entry.id` must be unique inside the slot.
   * @returns Idempotent disposer removing exactly this registration.
   * @throws Error when the slot already holds an entry with the same id.
   */
  register<Name extends SlotName>(name: Name, entry: SlotEntry<SlotContext<Name>>): () => void {
    const list = this.registrations.get(name) ?? [];
    const occupant = list.find((row) => row.entry.id === entry.id);
    if (occupant !== undefined) {
      throw new Error(
        `[slots] duplicate entry id "${entry.id}" in slot "${name}" (order ${occupant.entry.order ?? 0}); ` +
          "dispose the previous registration before registering another entry with the same id",
      );
    }
    const registration: Registration<SlotContext<Name>> = { entry, sequence: this.nextSequence };
    this.nextSequence += 1;
    list.push(registration);
    this.registrations.set(name, list);
    this.snapshots.delete(name);
    this.emit();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const current = this.registrations.get(name);
      const index = current?.indexOf(registration) ?? -1;
      if (current === undefined || index === -1) return;
      current.splice(index, 1);
      this.snapshots.delete(name);
      this.emit();
    };
  }

  /**
   * Read a slot's sorted entries.
   * @param name - declared slot name.
   * @returns Frozen snapshot sorted by `order` then registration sequence. The
   * reference only changes when this slot's registrations change, so React can
   * compare snapshots by identity.
   */
  getSnapshot<Name extends SlotName>(name: Name): readonly RegisteredSlotEntry<SlotContext<Name>>[] {
    const cached = this.snapshots.get(name);
    if (cached !== undefined) return cached;
    const rows = (this.registrations.get(name) ?? []).map(
      (row): RegisteredSlotEntry<SlotContext<Name>> => ({ ...row.entry, sequence: row.sequence }),
    );
    rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.sequence - b.sequence);
    Object.freeze(rows);
    this.snapshots.set(name, rows);
    return rows;
  }

  /**
   * Subscribe to registration changes.
   * @param listener - called after every successful register or dispose.
   * @returns Unsubscribe; calling it twice is harmless.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Notify every current subscriber about one registration change. */
  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
