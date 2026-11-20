"use client";

/**
 * LLM 录制 route: the standalone `/v2/llm-records` keeps its own full-viewport
 * frame, while the list body lives in
 * `components/v2/llm/LlmRecordsPage` so the shell's main area renders the same
 * page through the registry (`v2/data/pages.ts`). Only the frame differs.
 */
import { LlmRecordsPage } from "@/components/v2/llm/LlmRecordsPage";

export default function LlmRecordsRoutePage() {
  return (
    <main
      data-data-page="llm-records"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <LlmRecordsPage />
    </main>
  );
}
