"use client";

/**
 * Resident conversation skeleton entry.
 *
 * Port of `ui-conversation/src/client/skeleton/ConversationRoot.tsx:11-13`:
 * the root is a thin resident wrapper so header + content stay mounted across
 * Session transitions; `ConversationMainPanel` owns the phase.
 */
import type { ReactNode } from "react";

import { ConversationMainPanel } from "./ConversationMainPanel";
import type { ConversationSkeletonProps } from "./contract";

/**
 * Render the conversation column.
 * @param props - task data, View tabs, and composer wired by the shell.
 * @returns the resident skeleton.
 */
export function ConversationRoot(props: ConversationSkeletonProps): ReactNode {
  return <ConversationMainPanel {...props} />;
}
