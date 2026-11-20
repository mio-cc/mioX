"use client";

/**
 * Findings route: the standalone `/v2/findings` keeps its own full-viewport
 * frame, while the list body lives in
 * `components/v2/findings/FindingsDataPage` so the shell's main area renders the
 * same page through the registry (`v2/data/pages.ts`). Only the frame differs.
 */
import { FindingsDataPage } from "@/components/v2/findings/FindingsDataPage";

export default function FindingsPage() {
  return (
    <main
      data-data-page="findings"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <FindingsDataPage />
    </main>
  );
}
