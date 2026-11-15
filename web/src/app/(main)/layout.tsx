"use client";

import type { ReactNode } from "react";
import * as React from "react";

import { AppSidebar } from "@/app/(main)/_components/sidebar/app-sidebar";
import { AppFrame } from "@/components/layout/app-frame";
import { NewSidebar } from "@/components/layout/new-sidebar";
import { RightPanel } from "@/components/layout/right-panel";
import { ShellContent } from "@/components/layout/shell-content";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { auth, setAuthDisabled } from "@/lib/auth";
import { getClientCookie } from "@/lib/cookie.client";
import {
  SIDEBAR_COLLAPSIBLE_VALUES,
  SIDEBAR_VARIANT_VALUES,
  type SidebarCollapsible,
  type SidebarVariant,
} from "@/lib/preferences/layout";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { cn } from "@/lib/utils";

import { MainContent } from "./_components/main-content";

// Reads a layout-critical preference from the browser cookie (falls back to the
// default during static-export prerender where document is unavailable). Kept
// fully client-side so the app can be statically exported — no Server Actions /
// next/headers.
function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof document === "undefined") return fallback;
  const value = getClientCookie(key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  // Client-side auth gate — replaces the Next proxy/middleware that static export
  // disables. No token → ask the backend once: when the password gate is switched
  // off (auth_disabled, the default for local use) the UI opens directly instead
  // of bouncing to /login. Otherwise no token → /login, and render nothing until
  // confirmed so no protected UI (or its API calls) flashes for a logged-out
  // visitor.
  const [authed, setAuthed] = React.useState(false);
  React.useEffect(() => {
    // 总是先问一次认证模式：它决定「有 token 也不代表什么」以及侧边栏是否
    // 显示修改密码/退出登录，所以不能只靠本地 token 猜测。
    api
      .authStatus()
      .then(({ auth_disabled }) => {
        setAuthDisabled(Boolean(auth_disabled));
        if (auth_disabled || auth.getToken()) {
          setAuthed(true);
          return;
        }
        // 客户端守卫认为未登录时，必须同时清掉 cookie：否则 proxy.ts 仅凭
        // “cookie 存在”就把我们从 /login 又重定向回主界面，与本守卫来回弹跳
        // 形成无限重定向 → 白屏（cookie 与 localStorage 不一致时触发）。
        auth.clearToken();
        window.location.href = "/login";
      })
      .catch(() => {
        auth.clearToken();
        window.location.href = "/login";
      });
  }, []);

  const defaultOpen = typeof document === "undefined" ? true : getClientCookie("sidebar_state") !== "false";
  const variant = readPref<SidebarVariant>(
    "sidebar_variant",
    SIDEBAR_VARIANT_VALUES,
    PREFERENCE_DEFAULTS.sidebar_variant,
  );
  const collapsible = readPref<SidebarCollapsible>(
    "sidebar_collapsible",
    SIDEBAR_COLLAPSIBLE_VALUES,
    PREFERENCE_DEFAULTS.sidebar_collapsible,
  );

  // Render a neutral shell skeleton instead of a blank page while the auth mode
  // resolves: `return null` made every navigation look like a white flash and
  // hid the fact that the app was loading at all.
  if (!authed) {
    return (
      <div className="flex h-dvh w-full" aria-busy="true" aria-label="正在检查登录状态">
        <div className="hidden w-[280px] shrink-0 animate-pulse bg-muted/40 sm:block" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-40 animate-pulse rounded bg-muted/60" />
        </div>
      </div>
    );
  }

  // The three-column harness shell is the product default. The legacy console is
  // opt-in via NEXT_PUBLIC_LEGACY_SHELL=1.
  //
  // Deliberately inverted: `NEXT_PUBLIC_*` inlining is not reliable in this build
  // setup (the literal survived into the exported chunk, so the runtime value was
  // undefined and the old shell won). Defaulting to the new shell means a missing
  // or un-inlined variable can no longer silently ship the legacy UI.
  if (process.env.NEXT_PUBLIC_LEGACY_SHELL !== "1") {
    return (
      <AppFrame
        sidebar={
          <React.Suspense fallback={null}>
            <NewSidebar />
          </React.Suspense>
        }
        rightPanel={
          // RightPanel reads ?id= via useSearchParams, which needs a Suspense
          // boundary under static export.
          <React.Suspense fallback={null}>
            <RightPanel />
          </React.Suspense>
        }
      >
        {/* Compatibility provider: legacy pages (task detail / finding detail / main content)
            still render SidebarTrigger, which requires the shadcn sidebar context even
            though the new AppFrame owns the visible sidebar. */}
        <SidebarProvider className="h-full min-h-0 w-full" style={{ height: "100%", minHeight: 0 }}>
          <ShellContent>{children}</ShellContent>
        </SidebarProvider>
      </AppFrame>
    );
  }

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 68)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant={variant} collapsible={collapsible} />
      <SidebarInset
        className={cn(
          "[html[data-content-layout=centered]_&>*]:mx-auto",
          "[html[data-content-layout=centered]_&>*]:w-full",
          "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
          "peer-data-[variant=inset]:border",
          "[--dashboard-header-height:--spacing(12)]",
          "min-w-0 overflow-x-hidden",
        )}
      >
        <MainContent>{children}</MainContent>
      </SidebarInset>
    </SidebarProvider>
  );
}
