"use client";

/**
 * Minimal toast host: a module-level emitter plus one fixed host. Feature code
 * calls `toast("…")` without threading a provider through the tree.
 */
import * as React from "react";
import { Toast } from "@/vendor/dsh/primitives/Toast";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

/** Show one short confirmation. */
export function toast(text: string): void {
  for (const listener of listeners) listener(text);
}

export function ToastHost(): React.ReactNode {
  const [items, setItems] = React.useState<{ id: number; text: string }[]>([]);
  const nextId = React.useRef(0);

  React.useEffect(() => {
    const listener: Listener = (text) => {
      const id = ++nextId.current;
      setItems((prev) => [...prev, { id, text }]);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <>
      {items.map((item) => (
        <Toast
          key={item.id}
          text={item.text}
          holdMs={2200}
          onDone={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
        />
      ))}
    </>
  );
}
