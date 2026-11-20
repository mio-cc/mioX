"use client";

/**
 * Tools route: the standalone `/v2/tools` keeps its own full-viewport frame,
 * while the catalog body lives in `components/v2/tools/ToolsPage` so the shell's
 * main area renders the same page through the registry (`v2/data/pages.ts`).
 * Only the frame differs.
 */
import { ToolsPage } from "@/components/v2/tools/ToolsPage";

export default function ToolsRoutePage() {
  return (
    <main
      data-data-page="tools"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base)",
        color: "var(--dsw-alias-label-primary)",
        fontFamily: "var(--dsw-font-family)",
      }}
    >
      <ToolsPage />
    </main>
  );
}
