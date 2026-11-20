"use client";

/**
 * Phase 2 probe page: mounts the ported right panel standalone so its tabs,
 * findings and approval cards can be verified before the shell exists.
 */
import { useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { RightPanel } from "@/components/v2/right-panel/RightPanel";

export default function RightPanelPage() {
  const [open, setOpen] = useState(true);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <div style={{ flex: "1 1 auto", padding: "40px 48px" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>右栏</h1>
        <p style={{ margin: "6px 0 20px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
          从 ui-lab 搬入的右栏（文件 / 会话 / 审批 / 发现），结构验证阶段。
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "关闭右栏" : "打开右栏"}
        </Button>
      </div>
      {open ? (
        <div style={{ width: 380, flex: "0 0 auto" }}>
          <RightPanel onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </main>
  );
}
