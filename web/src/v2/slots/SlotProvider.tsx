"use client";

/**
 * React integration for the mini slot registry.
 *
 * `<SlotProvider>` owns one registry for the mounted page and hands it to the
 * owner's `<Slot>` sites; `<Slot>` subscribes with `useSyncExternalStore`, so
 * registration changes re-render the seat and a stable snapshot reference keeps
 * unrelated re-renders cheap.
 *
 * Every rendered entry is wrapped in a `display: contents` span carrying
 * `data-slot-entry={id}`: the wrapper creates no box, so each contribution stays
 * a direct flex child of its seat (gaps and alignment do not move), while tests
 * and DOM order assertions can name entries.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { type SlotContext, type SlotName, SlotRegistry } from "./registry";

/** Layout-neutral wrapper style: the span participates in no box model of its own. */
const SLOT_ENTRY_STYLE = { display: "contents" } as const;

/** Debug surface read by the CDP acceptance harness; development builds only. */
interface SlotDebugHandle {
  readonly registry: SlotRegistry;
  /** Serializable registration list (render functions are not enumerable). */
  entries(name: SlotName): readonly { readonly id: string; readonly order: number; readonly sequence: number }[];
}

declare global {
  interface Window {
    /** Development-only slot registry handle; absent in production builds. */
    __mioxSlotDebug?: SlotDebugHandle;
  }
}

const SlotRegistryContext = createContext<SlotRegistry | null>(null);

/**
 * Provide one slot registry to the subtree that declares and renders its slots.
 * @param props.children - the shell tree.
 * @returns the provider element; it renders no DOM.
 */
export function SlotProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [registry] = useState(() => new SlotRegistry());

  // Development-only acceptance seam: the CDP harness registers/disposes a probe
  // entry on the live registry to prove registration, ordering and disposal on
  // the real page. The NODE_ENV guard is statically dropped from production.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return undefined;
    const handle: SlotDebugHandle = {
      registry,
      entries: (name) =>
        registry.getSnapshot(name).map((entry) => ({
          id: entry.id,
          order: entry.order ?? 0,
          sequence: entry.sequence,
        })),
    };
    window.__mioxSlotDebug = handle;
    return () => {
      window.__mioxSlotDebug = undefined;
    };
  }, [registry]);

  return <SlotRegistryContext.Provider value={registry}>{children}</SlotRegistryContext.Provider>;
}

/**
 * Read the surrounding registry.
 * @returns the registry created by the nearest {@link SlotProvider}.
 * @throws Error when called outside a provider, which would silently drop entries.
 */
export function useSlotRegistry(): SlotRegistry {
  const registry = useContext(SlotRegistryContext);
  if (registry === null) throw new Error("[slots] the slot hooks must run under <SlotProvider>");
  return registry;
}

/**
 * Render a declared list slot.
 * @param props.name - declared slot name.
 * @param props.ctx - owner data every entry renders against.
 * @returns the visible entries in `order`/registration order.
 */
export function Slot<Name extends SlotName>({
  name,
  ctx,
}: {
  readonly name: Name;
  readonly ctx: SlotContext<Name>;
}): ReactNode {
  const registry = useSlotRegistry();
  const getSnapshot = useCallback(() => registry.getSnapshot(name), [registry, name]);
  const entries = useSyncExternalStore(registry.subscribe, getSnapshot, getSnapshot);
  return entries.map((entry) =>
    entry.when?.(ctx) === false ? null : (
      <span key={entry.id} data-slot-entry={entry.id} style={SLOT_ENTRY_STYLE}>
        {entry.render(ctx)}
      </span>
    ),
  );
}
