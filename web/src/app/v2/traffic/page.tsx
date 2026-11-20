"use client";

/**
 * Traffic route: the standalone `/v2/traffic` keeps its own full-viewport frame,
 * while the exchange body lives in
 * `components/v2/data-pages/TrafficDataPage` so the shell's main area renders the
 * same page through the registry (`v2/data/pages.ts`). Only the frame differs.
 */
import { TrafficDataPage } from "@/components/v2/data-pages/TrafficDataPage";

export default function TrafficPage() {
  return (
    <main
      data-data-page="traffic"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <TrafficDataPage />
    </main>
  );
}
