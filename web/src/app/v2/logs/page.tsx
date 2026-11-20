"use client";

/**
 * Logs route: the standalone `/v2/logs` keeps its own full-viewport frame, while
 * the log surface lives in `components/v2/logs/LogsPage` so the shell's main area
 * renders the same page through the registry (`v2/data/pages.ts`). Only the frame
 * differs.
 */
import { LogsPage } from "@/components/v2/logs/LogsPage";

export default function LogsRoute() {
  return (
    <main
      data-data-page="logs"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <LogsPage />
    </main>
  );
}
