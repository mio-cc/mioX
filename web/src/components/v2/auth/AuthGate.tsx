"use client";

/**
 * /v2 的客户端鉴权守卫（替代静态导出关掉的 Next middleware）。
 * 旧页面依据：ARTEX/web/src/app/(main)/layout.tsx:36-91（token 有无 × authStatus 的四种放行/跳转，
 *   失败即 clearToken 并跳 /login）、(auth)/login/page.tsx:44-66（免登录直接放行、未初始化跳 /setup）。
 * DSH 依据：DSH 无鉴权层（前端只连本机 dsh web），按 /v2 顶层布局扩展；
 *   「已知放行不再问后端」的依据是旧布局的注释 (main)/layout.tsx:45-46——token 已经证明身份。
 * 对照表行：P3:C1 P3:C2
 *
 * 免登录（auth_disabled，本机默认）时的行为：仍然先问一次 authStatus（旧布局
 * layout.tsx:44-65 也是每次进主界面都问），但只在这一种情况下首帧显示一行检查状态；
 * 拿到结论后立即渲染 children，不发第二次请求、不跳转，界面与未加守卫时一致。
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { usePathname } from "next/navigation";

import { Button } from "@/vendor/dsh/primitives/Button";

import { clearToken, hasToken, probeAuthMode } from "@/v2/data/auth";

import css from "./auth.module.css";

/** 本守卫自己覆盖的两条路由：它们本身就是登录/初始化页，不再互相跳。 */
const AUTH_ROUTES = ["/v2/login", "/v2/setup"];

/**
 * 判断路径是否属于登录/初始化页（容忍尾斜杠）。
 * @param pathname - usePathname() 的返回值或浏览器地址。
 * @returns 是登录页或初始化页时为 true。
 */
export function isAuthRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return AUTH_ROUTES.includes(path);
}

type Verdict = "checking" | "allow" | "away";

interface GateState {
  /** 认证模式是否已经问过后端。 */
  known: boolean;
  /** 实例是否已设置过密码（后端 initialized）。 */
  initialized: boolean;
  /** 后端确认过免登录。 */
  disabled: boolean;
  /** 后端不可达：不能默认放行。 */
  unreachable: boolean;
  error: string | null;
}

const INITIAL: GateState = { known: false, initialized: false, disabled: false, unreachable: false, error: null };

/**
 * 包住 /v2 所有页面：未初始化 → /v2/setup；免登录 → 放行；无 token → /v2/login；
 * 有 token → 放行；当前本身就是登录/初始化页时不跳。
 * @param props.children - 受保护页面。
 * @returns children，或等待结论/跳转中的极简状态行与「无法确认」提示。
 */
export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  // pathname 为 null 时退回浏览器地址，避免把受保护页当成登录页放行。
  const path = pathname ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  const onAuthRoute = isAuthRoute(path);
  const [gate, setGate] = useState<GateState>(INITIAL);
  const [verdict, setVerdict] = useState<Verdict>("checking");
  const [attempt, setAttempt] = useState(0);
  // 免登录确认后，同一会话里再次挂载不必再等一次请求（已读到的结论足够）。
  const knownRef = useRef<GateState | null>(null);
  const aliveRef = useRef(true);

  const check = useCallback((): void => {
    const cached = knownRef.current;
    if (cached !== null) {
      setGate(cached);
      return;
    }
    setGate(INITIAL);
    setVerdict("checking");
    probeAuthMode().then((probe) => {
      if (!aliveRef.current) return;
      if (probe.status === null) {
        setGate({ known: false, initialized: false, disabled: false, unreachable: true, error: probe.error });
        return;
      }
      const next: GateState = {
        known: true,
        initialized: Boolean(probe.status.initialized),
        disabled: Boolean(probe.status.auth_disabled),
        unreachable: false,
        error: null,
      };
      knownRef.current = next;
      setGate(next);
    });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 登录/初始化页自带放行逻辑，守卫不发请求也不参与判定。
  useEffect(() => {
    if (onAuthRoute) return;
    check();
  }, [onAuthRoute, check, attempt]);

  // 从后端直接返回（bfcache 恢复）后重新判定，免登录开关可能已经变了。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onShow = (event: PageTransitionEvent): void => {
      if (!event.persisted) return;
      knownRef.current = null;
      check();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [check]);

  const away = (target: string): void => {
    setVerdict("away");
    // /login、/setup 是独立路由：整页跳转，避免受保护界面在路由切换期间闪一下。
    window.location.replace(target);
  };

  useEffect(() => {
    if (onAuthRoute) return;
    if (!gate.known) return;
    // 免登录：放行，不发第二次请求、不跳转。
    if (gate.disabled) {
      setVerdict("allow");
      return;
    }
    if (hasToken()) {
      setVerdict("allow");
      return;
    }
    if (!gate.initialized) {
      away("/v2/setup");
      return;
    }    // 免登录关闭、已初始化、本地无 token：先清掉可能与 cookie 不一致的残留再跳登录
    // （照旧布局 (main)/layout.tsx:56-59 的无限重定向注释）。
    clearToken();
    away("/v2/login");
  }, [onAuthRoute, gate]);

  if (onAuthRoute) return children;
  if (verdict === "allow") return children;
  if (verdict === "away") return null;

  if (gate.unreachable) {
    // 后端不可达时既不能默认放行（未登录访客会进入受保护界面），也不能跳登录
    // （后端不通时登录必然失败）。照旧页 setup/page.tsx:20-22 的口径：明确告知 + 重试。
    return (
      <div className={css.checkWrap}>
        <div className={css.checkBox} role="alert">
          <p className={css.checkTitle}>无法确认登录状态</p>
          <p className={css.checkText}>
            后端服务暂时不可用，页面内容已暂时关闭。{gate.error !== null ? `（${gate.error}）` : ""}
          </p>
          <div className={css.checkActions}>
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)} data-authgate-retry="">
              重试
            </Button>
            <Button variant="ghost" size="sm" onClick={() => away("/v2/login")} data-authgate-login="">
              前往登录
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={css.checkWrap} aria-busy="true">
      <p className={css.checkLine} role="status">
        正在检查登录状态…
      </p>
    </div>
  );
}
