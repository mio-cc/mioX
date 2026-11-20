"use client";

/**
 * Tool-card probe, now driven by the same block pipeline as the shell: it exists
 * to inspect card rendering in isolation without the surrounding layout.
 */
import { ThreadView } from "@/components/v2/thread/ThreadView";
import { toBlocks } from "@/v2/data/activity-blocks";
import { RECORDED_SHAPES } from "@/v2/data/activity-recorded";

export default function ThreadPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ThreadView blocks={toBlocks(RECORDED_SHAPES)} />
    </main>
  );
}
