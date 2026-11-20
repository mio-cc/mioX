"use client";

/**
 * Route-level error boundary for /v2.
 *
 * Vendored DSH components throw on some failure paths (missing dependency,
 * document access during render), and a raw Next.js error page hides which
 * surface broke. This renders the same shell chrome so the failure stays legible
 * and one click re-tries the segment.
 */
import { useEffect } from "react";

export default function V2Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactNode {
  useEffect(() => {
    // Keep the message in the console for copy-paste into an issue.
    console.error("[v2] render failed", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          padding: 20,
          border: "0.5px solid var(--dsw-alias-border-l1, #e5e7eb)",
          borderRadius: 12,
          background: "var(--dsw-alias-bg-layer-1, #f7f7f8)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>这个界面渲染失败了</h1>
        <p style={{ margin: "6px 0 12px", fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #6b7280)" }}>
          错误信息在浏览器控制台。可以重试，或返回索引换一个界面。
        </p>
        <pre
          style={{
            margin: "0 0 14px",
            padding: 10,
            maxHeight: 160,
            overflow: "auto",
            borderRadius: 8,
            background: "var(--dsw-alias-bg-subtle, #f2f3f5)",
            fontFamily: "var(--ds-font-family-code, monospace)",
            fontSize: 11.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {error.message}
        </pre>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 30,
              padding: "0 12px",
              border: 0,
              borderRadius: 8,
              background: "var(--dsw-alias-label-primary, #0f1115)",
              color: "var(--dsw-alias-bg-base, #fff)",
              font: "inherit",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            重试
          </button>
          <a
            href="/v2"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 30,
              padding: "0 12px",
              border: "0.5px solid var(--dsw-alias-border-l2, #d8dbe0)",
              borderRadius: 8,
              color: "inherit",
              fontSize: 12.5,
              textDecoration: "none",
            }}
          >
            返回索引
          </a>
        </div>
      </div>
    </main>
  );
}
