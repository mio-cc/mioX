"use client";

/**
 * 认证适配器：认证模式探测、登录、首次初始化密码、修改密码。
 * 旧页面依据：ARTEX/web/src/app/(main)/layout.tsx:44-65（先问一次 authStatus 再决定放行/跳登录、失败时清 token）、
 *   (auth)/login/page.tsx:44-85（已登录直接放行、auth_disabled 直接放行、未初始化跳 /setup、登录成功存 token）、
 *   (auth)/setup/page.tsx:24-63（查不到初始化状态时关闭表单入口，避免覆盖已有密码）。
 * DSH 依据：DSH 无鉴权概念（前端只连本机 dsh web），按「跨页面系统配置」放在 /v2 的适配器层扩展；
 *   形状照 v2/data/update.ts:82-101 的 Promise.all 探测 + loading/ready/offline 三态写法。
 * 对照表行：P3:C1 P3:C2 P3:C3 P3:C4
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { auth, setAuthDisabled } from "@/lib/auth";

/** 认证模式（字段与 lib/api.ts:271 的返回类型一一对应）。 */
export interface AuthMode {
  /** 实例是否已经设置过密码。 */
  initialized: boolean;
  /** 后端 config 里认证开关是否关闭（本机默认关闭 = 免登录）。 */
  authDisabled: boolean;
}

export type AuthModePhase = "loading" | "ready" | "offline";

export interface AuthModeState {
  phase: AuthModePhase;
  mode: AuthMode | null;
  error: string | null;
}

/** 一次 authStatus 探测的结果，供 AuthGate 与登录/初始化页共用。 */
export interface AuthModeProbe {
  /** 探测成功时为后端返回的两个布尔值。 */
  status: { initialized: boolean; auth_disabled?: boolean } | null;
  /** 探测失败时的后端错误文本；成功时为 null。 */
  error: string | null;
}

/**
 * 读取实例的认证模式（每次调用都是一个真实请求）。
 * @returns 后端返回的 initialized / auth_disabled，或错误文本。
 */
export function probeAuthMode(): Promise<AuthModeProbe> {
  // 顶层守卫先问一次，AuthGate 再问一次（两处都在 /v2 下）。
  // 与旧页 (main)/layout.tsx:44-65 一致：结果同时写入 lib/auth 的模块开关，
  // 供只读的 isAuthDisabled()（nav-user.tsx:82 等处的「修改密码 / 退出登录」显隐）读取。
  return api
    .authStatus()
    .then((value) => {
      setAuthDisabled(Boolean(value.auth_disabled));
      return { status: value, error: null };
    })
    .catch((reason: unknown) => ({
      status: null,
      error: reason instanceof Error ? reason.message : String(reason),
    }));
}

/**
 * 读一次认证模式并留成状态；reload 触发重读。
 * watch 为 true 时监听 bfcache 的 pageshow 重读（从后端直接返回后界面仍须正确）。
 * @param watch - 是否监听 bfcache 恢复事件。
 * @returns 阶段、模式、错误与重读回调。请求失败按 offline 处理（不冒充免登录）。
 */
export function useAuthMode(watch: boolean): AuthModeState & { reload: () => void } {
  const [phase, setPhase] = useState<AuthModePhase>("loading");
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    probeAuthMode()
      .then((probe) => {
        if (!alive) return;
        if (probe.status === null) {
          setMode(null);
          setError(probe.error);
          setPhase("offline");
          return;
        }
        setMode({
          initialized: Boolean(probe.status.initialized),
          authDisabled: Boolean(probe.status.auth_disabled),
        });
        setError(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setMode(null);
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase("offline");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!watch || typeof window === "undefined") return;
    const onShow = (event: PageTransitionEvent): void => {
      if (event.persisted) reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [watch, reload]);

  return { phase, mode, error, reload };
}

/**
 * 本地是否已存 token（同步读取，不产生请求）。
 * @returns 有 token 为 true。
 */
export function hasToken(): boolean {
  return auth.getToken() !== null;
}

/**
 * 存下登录/初始化返回的 token（同时写 cookie，见 lib/auth.ts:35-39）。
 * @param token - 后端签发的 token。
 */
export function saveToken(token: string): void {
  auth.setToken(token);
}

/**
 * 清掉本地 token（cookie 一并清）。
 */
export function clearToken(): void {
  auth.clearToken();
}

/**
 * 用固定用户名 + 密码登录。
 * @param username - 后端固定的协议用户名（config/app-config.ts 的 LOGIN_USERNAME）。
 * @param password - 用户输入的密码。
 * @returns 后端签发的 token；失败时抛出带后端信息的 Error。
 */
export function login(username: string, password: string): Promise<{ token: string }> {
  return api.login(username, password);
}

/**
 * 首次使用：设置登录密码并拿到 token。
 * @param password - 新密码（至少 8 位由调用方先校验，旧页 setup/page.tsx:48-51）。
 * @returns 后端签发的 token；失败时抛出带后端信息的 Error。
 */
export function initializePassword(password: string): Promise<{ token: string }> {
  return api.initPassword(password);
}

/**
 * 修改密码。
 * @param oldPassword - 当前密码。
 * @param newPassword - 新密码。
 * @returns `{ ok }`；失败时抛出带后端信息的 Error。
 */
export function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return api.changePassword(oldPassword, newPassword);
}
