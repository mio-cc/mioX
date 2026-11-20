"use client";

/**
 * Dashboard route: the standalone `/v2/dashboard` keeps its own full-viewport
 * frame, while the body lives in `components/v2/dashboard/DashboardPage` so the
 * shell's main area renders the same page through the registry
 * (`v2/data/pages.ts`). Only the frame differs. Copied from
 * `ARTEX/web/src/app/v2/findings/page.tsx` with the page id and component name
 * changed.
 */
import { DashboardPage } from "@/components/v2/dashboard/DashboardPage";

export default function DashboardRoutePage() {
  return (
    <main
      data-data-page="dashboard"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <DashboardPage />
    </main>
  );
}
