"use client";

/**
 * Host page for the ported settings dialog on /v2.
 * The dialog is wired to the real backend: GET /settings, /llm/profiles,
 * /llm/pool, /llm/retry-policy, /agents, /intercept/rules — reads on mount,
 * writes only from explicit user actions.
 */
import { useEffect, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { SettingsDialog } from "@/components/v2/settings/SettingsDialog";

export default function SettingsPage() {
  const [open, setOpen] = useState(true);
  // The dialog's menus read `document` while rendering, so it cannot run on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 48px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>设置</h1>
      <p style={{ margin: "6px 0 20px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
        从 ui-lab 搬入的设置弹窗，已接真实后端：读 /settings、/llm/profiles、/llm/pool、/llm/retry-policy、/agents、/intercept/rules，写回只发生在点保存/创建时。
      </p>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        打开设置
      </Button>

      <SettingsDialog open={mounted && open} onClose={() => setOpen(false)} />
    </main>
  );
}
