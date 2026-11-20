"use client";

/**
 * Sync route: the standalone `/v2/sync` keeps its own full-viewport frame, while
 * the page body lives in `components/v2/sync/SyncPage` so the shell's main area
 * renders the same page through the registry (`v2/data/pages.ts`). Only the
 * frame differs.
 */
import { SyncPage } from "@/components/v2/sync/SyncPage";

export default function SyncRoutePage() {
  return (
    <main
      data-data-page="sync"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <SyncPage />
    </main>
  );
}
