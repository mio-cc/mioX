"use client";

/**
 * Commands route: the standalone `/v2/commands` keeps its own full-viewport
 * frame, while the body lives in `components/v2/commands/CommandsPage` so the
 * shell's main area renders the same page through the registry
 * (`v2/data/pages.ts`). Only the frame differs. Copied from
 * `ARTEX/web/src/app/v2/findings/page.tsx` with the page id (`commands`) and
 * component name changed (总表 §4.1 第 3 步).
 */
import { CommandsPage } from "@/components/v2/commands/CommandsPage";

export default function CommandsRoutePage() {
  return (
    <main
      data-data-page="commands"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <CommandsPage />
    </main>
  );
}
