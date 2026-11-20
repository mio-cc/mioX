"use client";

/**
 * Adapter for the version / self-update surface: the only place under /v2 that
 * touches /health, /auth/status and /update/*. Components receive plain data
 * and callbacks, never `fetch` or `EventSource`.
 *
 * Read-only by default: the health/auth probes and the update-progress stream
 * run on mount, while `apply` and `rollback` only run from an explicit button
 * press (they download a release, restart the process, or swap the binary).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api, sseUrl } from "@/lib/api";
import type { UpdateCheck, UpdateProgress } from "@/lib/types";

export type UpdatePhase = "loading" | "ready" | "offline";

/** `GET /health` — identifies the running backend binary. */
export interface HostInfo {
  ok: boolean;
  service: string;
  version: string;
}

/** `GET /auth/status` — whether password login is enforced / configured. */
export interface AuthInfo {
  initialized: boolean;
  authDisabled: boolean;
}

export interface UpdateState {
  phase: UpdatePhase;
  host: HostInfo | null;
  auth: AuthInfo | null;
  /** Latest `GET /update/check` answer; null until the first probe lands. */
  check: UpdateCheck | null;
  checking: boolean;
  /** Backend-reported failure of the version probe (GitHub unreachable etc.). */
  error: string | null;
  /** Last row received from `GET /update/stream` (SSE, read-only). */
  progress: UpdateProgress | null;
  /** Re-read `/health` and `/auth/status`. */
  reload: () => void;
  /**
   * Ask the backend to compare against GitHub.
   * @param force - bypass the backend's 30-minute release cache.
   * @returns the fresh answer, or null when the request itself failed.
   */
  refresh: (force: boolean) => Promise<UpdateCheck | null>;
  /**
   * Download and stage the new release. The backend then restarts the process,
   * so a successful call ends this page's session.
   * @returns an error message, or null when the download was accepted.
   */
  apply: () => Promise<string | null>;
  /**
   * Swap the binary back to `artex.old` and let the backend restart.
   * @returns an error message, or null when the rollback was accepted.
   */
  rollback: () => Promise<string | null>;
}

/**
 * Read the running version, the auth gate and the latest release, and follow
 * the update-progress stream.
 * @returns current phase, backend values and the check/apply/rollback callbacks.
 */
export function useUpdate(): UpdateState {
  const [phase, setPhase] = useState<UpdatePhase>("loading");
  const [host, setHost] = useState<HostInfo | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [tick, setTick] = useState(0);
  // Concurrent probes must not interleave: the cache-bypassing one is the
  // slower of the two and would otherwise overwrite the fresher answer.
  const inFlight = useRef(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    Promise.all([api.health(), api.authStatus()])
      .then(([nextHost, nextAuth]) => {
        if (!alive) return;
        setHost({ ok: nextHost.ok, service: nextHost.service, version: nextHost.version });
        setAuth({ initialized: Boolean(nextAuth.initialized), authDisabled: Boolean(nextAuth.auth_disabled) });
        setPhase("ready");
      })
      .catch(() => {
        if (!alive) return;
        // A missing backend is reported as `offline`; the reason belongs to the
        // settings adapter's own probe, not to the GitHub comparison below.
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // The progress stream is a read-only broadcast: it replays the current state
  // on connect, so an update started from another tab stays visible here.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(sseUrl("/api/update/stream"));
    source.onmessage = (event: MessageEvent<string>) => {
      let payload: UpdateProgress | null = null;
      try {
        payload = JSON.parse(event.data) as UpdateProgress;
      } catch {
        payload = null;
      }
      if (payload !== null && typeof payload.phase === "string") setProgress(payload);
    };
    // A dropped stream only means no live progress; the row keeps its last value.
    source.onerror = () => source.close();
    return () => source.close();
  }, []);

  const refresh = useCallback(async (force: boolean): Promise<UpdateCheck | null> => {
    const seq = ++inFlight.current;
    setChecking(true);
    try {
      const next = await api.checkUpdate(force);
      if (seq !== inFlight.current) return next;
      setCheck(next);
      setError(next.error ?? null);
      return next;
    } catch (reason: unknown) {
      if (seq !== inFlight.current) return null;
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      if (seq === inFlight.current) setChecking(false);
    }
  }, []);

  const apply = useCallback(async (): Promise<string | null> => {
    try {
      await api.applyUpdate();
      return null;
    } catch (reason: unknown) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  }, []);

  const rollback = useCallback(async (): Promise<string | null> => {
    try {
      await api.rollbackUpdate();
      return null;
    } catch (reason: unknown) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  }, []);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  return { phase, host, auth, check, checking, error, progress, reload, refresh, apply, rollback };
}
