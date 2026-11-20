"use client";

/**
 * Phase 3 probe page: mounts the ported composer alone so the input surface,
 * model picker, `/` and `@` triggers can be verified before the shell lands.
 *
 * The composer's menus measure the document while rendering, so it only mounts
 * after hydration — same gate the settings and gallery pages use.
 */
import { useEffect, useState } from "react";

import { Composer } from "@/components/v2/composer/Composer";

export default function ComposerPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 48px 64px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>输入区</h1>
      <p style={{ margin: "6px 0 24px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
        从 ui-lab 搬入的 Composer：模型选择、权限档位、`/` 指令、`@` 引用、目标横幅、计划预览、交付文件条。
      </p>
      {mounted ? <Composer /> : null}
    </main>
  );
}
