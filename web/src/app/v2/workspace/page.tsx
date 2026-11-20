"use client";

/**
 * Workspace route: the standalone `/v2/workspace` keeps its own full-viewport
 * frame, while the list body lives in
 * `components/v2/workspace/WorkspacePage` so the shell's main area renders the
 * same page through the registry (`v2/data/pages.ts`). Only the frame differs.
 */
import { WorkspacePage } from "@/components/v2/workspace/WorkspacePage";

export default function WorkspaceRoutePage() {
  return (
    <main
      data-data-page="workspace"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <WorkspacePage />
    </main>
  );
}
