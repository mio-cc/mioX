"use client";

/**
 * Agent 对话 route: the standalone `/v2/conversations` keeps its own
 * full-viewport frame, while the page body lives in
 * `components/v2/agent-chat/AgentChatPage` so the shell's main area renders the
 * same page through the registry (`v2/data/pages.ts`). Only the frame differs.
 */
import { AgentChatPage } from "@/components/v2/agent-chat/AgentChatPage";

export default function ConversationsPage() {
  return (
    <main
      data-data-page="conversations"
      style={{
        minHeight: "100vh",
        padding: "32px 40px 60px",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: "var(--dsw-font-family, system-ui)",
      }}
    >
      <AgentChatPage />
    </main>
  );
}
