"use client";

/**
 * Adapter for the workspace file listing behind the composer's `@` references.
 * Only the root level is read here; drilling into a directory is the picker's job.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { WorkspaceListing } from "@/lib/types";

export type WorkspacePhase = "loading" | "ready" | "offline";

export interface WorkspaceState {
  phase: WorkspacePhase;
  entries: WorkspaceListing["entries"];
  error: string | null;
  reload: () => void;
}

/**
 * Read the workspace root once.
 * @returns phase, entries and a reload callback.
 */
export function useWorkspaceFiles(): WorkspaceState {
  const [phase, setPhase] = useState<WorkspacePhase>("loading");
  const [entries, setEntries] = useState<WorkspaceListing["entries"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .workspaceList("")
      .then((value) => {
        if (!alive) return;
        setEntries(value.entries ?? []);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, entries, error, reload };
}
