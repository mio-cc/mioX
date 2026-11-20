"use client";

/**
 * Adapter for the settings surface: the only place under /v2 allowed to touch
 * the API. Components receive plain data and callbacks, never `fetch`.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Settings } from "@/lib/types";

export type SettingsPhase = "loading" | "ready" | "offline";

export interface SettingsState {
  phase: SettingsPhase;
  data: Settings | null;
  error: string | null;
  /** Re-read from the backend. */
  reload: () => void;
  /** Persist a patch; resolves to an error message when the write fails. */
  save: (patch: Partial<Settings>) => Promise<string | null>;
}

/**
 * Read the runtime settings once and expose the phase plus a writer.
 * A missing backend is reported as `offline` rather than thrown: the UI must
 * still render while the Go service is down.
 * @returns current phase, server value, and the reload/save callbacks.
 */
export function useSettings(): SettingsState {
  const [phase, setPhase] = useState<SettingsPhase>("loading");
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setError(null);
    api
      .settings()
      .then((value) => {
        if (!alive) return;
        setData(value);
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

  const save = useCallback(async (patch: Partial<Settings>): Promise<string | null> => {
    try {
      const next = await api.setSettings(patch);
      setData(next);
      setPhase("ready");
      setError(null);
      return null;
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setPhase("offline");
      return message;
    }
  }, []);

  return { phase, data, error, reload, save };
}

/** Fields the web-search probe accepts; empty keys fall back to the stored ones. */
export interface WebSearchTestPatch {
  web_search_backend?: string;
  web_search_proxy?: string;
  brave_search_api_key?: string;
  tavily_search_api_key?: string;
}

/** Outcome of a real probe search; always resolves, `ok=false` carries the reason. */
export interface WebSearchTestResult {
  ok: boolean;
  error?: string;
  count?: number;
  backend?: string;
}

/**
 * Run one real search against the given (or saved) config — mirrors the mioX
 * 「测试搜索」button. This egresses to the search backend; it changes no setting.
 * @param patch form values to test; omitted fields use the stored config.
 * @returns whether the probe returned results, plus backend/count or the error.
 */
export function testWebSearch(patch: WebSearchTestPatch): Promise<WebSearchTestResult> {
  return api.testWebSearch(patch);
}

/**
 * Re-run interpreter detection and store it (POST /settings/python/detect).
 * Local only: the Go side runs exec.LookPath, writes the setting, and returns it.
 * @returns the absolute path the backend stored.
 */
export function detectPython(): Promise<{ python_interpreter: string }> {
  return api.detectPython();
}

/** Outcome of one `GET /settings` read: the server value or the failure reason. */
export interface SettingsReadResult {
  data: Settings | null;
  error: string | null;
}

/**
 * Read the settings once without owning any render state — for the callers that
 * only need the stored value (e.g. 读回某个刚写过的字段) and must not turn their
 * own phase into `offline` on a single failed write.
 * @returns the server value, or null plus the failure reason.
 */
export async function readSettings(): Promise<SettingsReadResult> {
  try {
    return { data: await api.settings(), error: null };
  } catch (reason: unknown) {
    return { data: null, error: reason instanceof Error ? reason.message : String(reason) };
  }
}

/**
 * 写一个设置补丁并读回结果（C22 的开关用）：一对一转发 PUT /settings（api.ts:919），
 * 不做乐观更新、不重试、不吞错误。
 * @param patch - 要写入的字段。
 * @returns 后端返回的整份 Settings，界面据此回读。
 */
export function saveSettingsPatch(patch: Partial<Settings>): Promise<Settings> {
  return api.setSettings(patch);
}

// ---------------------------------------------------------------------------
// C22 · 设置零散项
// ---------------------------------------------------------------------------

/**
 * 「操作约束注入」两个字段（`types.ts:1011-1013`）。
 * 旧页面依据：app/(main)/system/settings/page.tsx:131-137 / :155-161（乐观切换）、
 *   :71-72（回读口径 `!== false`，即缺省为开）、:428-454（两个 Switch）。
 * 对照表行：P3:S11 P3:S12
 */
export const CONSTRAINT_INJECT_KEYS = {
  planner: "constraints_inject_planner",
  worker: "constraints_inject_worker",
} as const;

/** 注入范围的两个主角。 */
export type ConstraintInjectTarget = keyof typeof CONSTRAINT_INJECT_KEYS;

/**
 * 读出一个字段的开关值。缺省即开：旧页 :71-72 用 `!== false` 判定，
 * 这里保持同一口径，避免把「后端没写这个键」误显示成关闭。
 * @param data - `GET /settings` 的返回值；null 时按「读不到」处理。
 * @param target - planner 或 worker。
 * @returns 开关值；data 为 null 时返回 null。
 */
export function constraintInjectValue(data: Settings | null, target: ConstraintInjectTarget): boolean | null {
  if (data === null) return null;
  const key = CONSTRAINT_INJECT_KEYS[target];
  return data[key] !== false;
}

/**
 * 保存一个注入开关。一对一转发 PUT /settings（api.ts:919），不做乐观更新、
 * 不吞错误；成功后由调用方用返回的整份 Settings 回读。
 * @param target - planner 或 worker。
 * @param next - 目标开关值。
 * @returns 后端写入后的整份 Settings。
 */
export function saveConstraintInject(target: ConstraintInjectTarget, next: boolean): Promise<Settings> {
  const patch: Partial<Settings> =
    CONSTRAINT_INJECT_KEYS[target] === "constraints_inject_planner"
      ? { constraints_inject_planner: next }
      : { constraints_inject_worker: next };
  return saveSettingsPatch(patch);
}

// ---------------------------------------------------------------------------
// C22 · P3:S4 更新完成后等待重启并刷新页面
// ---------------------------------------------------------------------------

/** 一次「等新进程起来」的探测参数（旧页固定 30 秒 / 2 秒一探，这里逐项写明）。 */
export interface WaitForRestartOptions {
  /** 当前进程报告的版本（`GET /health` 的 version）；新进程起来前可能仍是它。 */
  before: string;
  /** 总等待时长，默认 60 000 ms（旧页 :81-106 是 30 s，超时后再由用户手动刷新）。 */
  timeoutMs?: number;
  /** 每次探测的间隔，默认 2 000 ms。 */
  intervalMs?: number;
}

/** 一次「等新进程起来」的结果。 */
export interface WaitForRestartResult {
  /** `restarted` = 重新连上；`timeout` = 到点仍不可达；`aborted` = 调用方取消（组件卸载）。 */
  outcome: "restarted" | "timeout" | "aborted";
  /** 最后一次读到的版本；null = 一直没读通。 */
  version: string | null;
  /** 探测次数。 */
  probes: number;
}

const RESTART_POLL_DEFAULT_TIMEOUT_MS = 60_000;
const RESTART_POLL_DEFAULT_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 自更新 apply 之后轮询 `GET /health`（api.ts:268），直到后端重新响应再让调用方刷新页面。
 *
 * 旧页面依据：app/(main)/system/settings/_components/update-card.tsx:81-106 —— SSE 收到
 *   `staged` 后按固定间隔轮询 `/api/health`，读通即 `location.reload()`。
 * 这里把「什么时候重启页面」交给调用方：本函数只负责事实（是否重新连上、读到的版本），
 * 不做任何导航。`setTimeout` 只用于探测间隔的真实等待，不伪造任何加载态。
 * @param options - 旧版本号、总超时、探测间隔。
 * @param isCancelled - 每次探测前询问：调用方已卸载就停止。
 * @returns 结局、最后读到的版本与探测次数。
 */
export async function waitForBackendRestart(
  options: WaitForRestartOptions,
  isCancelled: () => boolean = () => false,
): Promise<WaitForRestartResult> {
  const timeoutMs = options.timeoutMs ?? RESTART_POLL_DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? RESTART_POLL_DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let version: string | null = null;
  let probes = 0;
  while (Date.now() <= deadline) {
    if (isCancelled()) return { outcome: "aborted", version, probes };
    probes += 1;
    try {
      const health = await api.health();
      version = health.version;
      // 读通即认为新进程已接管（版本的比对只用于展示，不作为唯一判据：
      // 后端重启失败回滚到旧版本时同样要刷新页面）。
      return { outcome: "restarted", version, probes };
    } catch {
      // 进程正在替换：连接被拒是预期现象，继续等。
    }
    if (isCancelled()) return { outcome: "aborted", version, probes };
    if (Date.now() + intervalMs > deadline) break;
    await sleep(intervalMs);
  }
  return { outcome: "timeout", version, probes };
}

// ---------------------------------------------------------------------------
// C22 · P3:B6 「关于 / 初始化状态」复检
// ---------------------------------------------------------------------------

/** `GET /auth/status` + `GET /health` 的一次复检结果（旧页 AboutSection 的两路并行探测）。 */
export interface AboutProbe {
  /** 已配置密码登录（`initialized`）；null = 未读通。 */
  initialized: boolean | null;
  /** 已关闭密码登录（`auth_disabled`）；null = 未读通。 */
  authDisabled: boolean | null;
  /** 运行中的后端版本；null = 未读通。 */
  version: string | null;
  /** 服务标识（`/health` 的 service）；null = 未读通。 */
  service: string | null;
  /** 读失败时的原因；成功为 null。 */
  error: string | null;
}

/**
 * 重新读一次「登录方式 + 后端版本」。
 * 旧页面依据：components/settings/settings-dialog.tsx:715-737（`Promise.all([api.authStatus(), …])`
 *   + 失败时进入 error 态并带上检查时间）。
 * @returns 两个布尔、版本与服务名，或失败原因。
 */
export async function probeAboutStatus(): Promise<AboutProbe> {
  try {
    const [auth, health] = await Promise.all([api.authStatus(), api.health()]);
    return {
      initialized: Boolean(auth.initialized),
      authDisabled: Boolean(auth.auth_disabled),
      version: health.version,
      service: health.service,
      error: null,
    };
  } catch (reason: unknown) {
    return {
      initialized: null,
      authDisabled: null,
      version: null,
      service: null,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}
