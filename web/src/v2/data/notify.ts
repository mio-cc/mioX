"use client";

/**
 * Adapter for notification channels, their kind metadata, and delivery history.
 * The only place under /v2 allowed to touch the notify API: components receive
 * plain data and write callbacks, never `fetch`.
 *
 * Masked credentials: the backend replaces secret config values with a
 * `__masked__…` value when reading. Passing the same string back in `config`
 * means "keep the stored value" (api.ts:943), so writers forward it untouched
 * and only replace a field when the user typed a new value.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { NotificationChannel, NotificationDelivery, NotificationFilter, NotificationMeta } from "@/lib/types";

export type NotifyPhase = "loading" | "ready" | "offline";

export interface NotifyMetaState {
  phase: NotifyPhase;
  meta: NotificationMeta | null;
  error: string | null;
  reload: () => void;
}

/** Read GET /notify/meta once: kind catalog, defaults, and delivery stats. */
export function useNotifyMeta(): NotifyMetaState {
  const [phase, setPhase] = useState<NotifyPhase>("loading");
  const [meta, setMeta] = useState<NotificationMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .notifyMeta()
      .then((value) => {
        if (!alive) return;
        setMeta(value);
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
  return { phase, meta, error, reload };
}

export interface NotifyChannelsState {
  phase: NotifyPhase;
  channels: NotificationChannel[];
  error: string | null;
  reload: () => void;
}

/** Read GET /notify/channels once. */
export function useNotifyChannels(): NotifyChannelsState {
  const [phase, setPhase] = useState<NotifyPhase>("loading");
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .notifyChannels()
      .then((value) => {
        if (!alive) return;
        setChannels(value);
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
  return { phase, channels, error, reload };
}

/** Fields accepted by POST /notify/channels (api.ts:934-942). */
export interface NotifyChannelInput {
  name: string;
  kind: string;
  enabled?: boolean;
  mode?: string;
  config: Record<string, unknown>;
  filter?: NotificationFilter;
  rate_per_min?: number;
}

/** PATCH payload: only the fields the user changed (api.ts:943-955). */
export type NotifyChannelPatch = Partial<NotifyChannelInput>;

export function createNotifyChannel(input: NotifyChannelInput): Promise<{ id: number }> {
  return api.notifyCreateChannel(input);
}

export function updateNotifyChannel(id: number, patch: NotifyChannelPatch): Promise<{ id: number }> {
  return api.notifyUpdateChannel(id, patch);
}

export function deleteNotifyChannel(id: number): Promise<void> {
  return api.notifyDeleteChannel(id).then(() => undefined);
}

export function testNotifyChannel(id: number): Promise<{ ok: boolean; latency_ms: number }> {
  return api.notifyTestChannel(id);
}

export interface DeliveriesState {
  phase: NotifyPhase;
  rows: NotificationDelivery[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
  reload: () => void;
}

/**
 * Read one page of GET /notify/deliveries. Filters are scalar arguments so the
 * fetch effect only reruns when the query actually changes.
 */
export function useNotifyDeliveries(
  channelId: number | undefined,
  state: string | undefined,
  page: number,
  pageSize: number,
): DeliveriesState {
  const [phase, setPhase] = useState<NotifyPhase>("loading");
  const [rows, setRows] = useState<NotificationDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    api
      .notifyDeliveries({ channelId, state, page, pageSize })
      .then((value) => {
        if (!alive) return;
        setRows(value.deliveries);
        setTotal(value.total);
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
  }, [channelId, state, page, pageSize, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { phase, rows, total, page, pageSize, error, reload };
}

/** Queue one failed/skipped delivery for another attempt (api.ts:969). */
export function retryNotifyDelivery(id: number): Promise<{ ok: boolean }> {
  return api.notifyRetryDelivery(id);
}
