import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_PAGES = ["/login", "/setup"];

/**
 * Ask the backend whether the password gate is currently disabled.
 *
 * This is a public endpoint (no JWT) and the matcher below already excludes
 * `/api/`, so the middleware may call it freely. Failure returns `null` and the
 * caller must then err on the side of letting the request through: a flaky or
 * briefly unavailable backend must never be able to lock the whole UI behind a
 * redirect, and the client-side guard re-checks the same status anyway.
 *
 * Caching: middleware module state is not reliably shared between dev requests
 * (measured `proxy.ts` 1.2–9.4 s/request), so the answer is also mirrored into a
 * short-lived cookie. The first request pays the probe; the rest read the cookie.
 */
const AUTH_OFF_COOKIE = "artex_auth_off";
const AUTH_OFF_MAX_AGE = 60;
const AUTH_MODE_TTL_MS = 15_000;
let authModeCache: { value: boolean | null; at: number } | null = null;
let authModeInFlight: Promise<boolean | null> | null = null;

async function probeAuthMode(): Promise<boolean | null> {
  const now = Date.now();
  if (authModeCache && now - authModeCache.at < AUTH_MODE_TTL_MS) {
    return authModeCache.value;
  }
  if (authModeInFlight) return authModeInFlight;

  const backend = process.env.AUTOPENTEST_API ?? "http://localhost:8787";
  const target = new URL("/api/auth/status", backend);
  authModeInFlight = (async () => {
    let value: boolean | null = null;
    try {
      const response = await fetch(target, {
        // Never let a slow backend stall page loads; the client guard re-checks.
        signal: AbortSignal.timeout(1500),
        cache: "no-store",
      });
      if (response.ok) {
        const body = (await response.json()) as { auth_disabled?: unknown };
        value = body.auth_disabled === true;
      }
    } catch {
      value = null;
    }
    // Cache successes only; a failed probe must be retried rather than pinning
    // "unknown" for the whole TTL.
    if (value !== null) authModeCache = { value, at: Date.now() };
    authModeInFlight = null;
    return value;
  })();
  return authModeInFlight;
}

export async function proxy(request: NextRequest) {
  // Mock demo：无真实登录，放行所有页面（客户端 auth 守卫也会放行）。
  if (process.env.NEXT_PUBLIC_MOCK === "1") return NextResponse.next();

  const { pathname } = request.nextUrl;
  const token = request.cookies.get("artex_token")?.value;
  const isAuthPage = AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Static export has no middleware at all, so this guard only runs on the dev
  // server. Keep it a pure cookie check when a token exists.
  if (token && isAuthPage) {
    // 已登录时访问登录/初始化页 → 跳转主界面
    return NextResponse.redirect(new URL("/function/tasks", request.url));
  }

  if (token) return NextResponse.next();

  // No token: before bouncing anyone to /login, confirm the gate is actually on.
  // With `auth.disabled=true` (the default for local use) the backend never
  // issues a token, so a cookie-only check here would redirect forever:
  //   /function/tasks -> /login -> (client sees auth_disabled) -> /function/tasks -> ...
  // A recent probe result is remembered in a short-lived cookie so steady-state
  // navigation costs no extra round-trip.
  if (request.cookies.get(AUTH_OFF_COOKIE)?.value === "1") return NextResponse.next();

  const disabled = await probeAuthMode();
  if (disabled === true) {
    const response = NextResponse.next();
    response.cookies.set(AUTH_OFF_COOKIE, "1", {
      path: "/",
      maxAge: AUTH_OFF_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
    });
    return response;
  }
  // Unknown (backend unreachable) → let the request through; the client guard
  // re-checks and will route to /login if a password is actually required.
  if (disabled === null) return NextResponse.next();

  if (!isAuthPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // 跳过 Next.js 内部路由、API 路由、favicon 及 public/ 下的静态文件（含图片、字体等）
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$).*)"],
};
