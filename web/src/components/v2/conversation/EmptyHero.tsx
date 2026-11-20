"use client";

/**
 * Blank-phase hero above the centered composer.
 *
 * Simplified port of `ui-conversation/src/client/skeleton/EmptyHero.tsx`:
 * the brand mark, the headline, and the preview pill. Upstream also renders
 * the agent-preset and workspace controls; ARTEX's hero keeps only the
 * identity block because the workspace is fixed.
 */
import type { ReactNode } from "react";

import { MioxMark } from "@/components/v2/sidebar/MioxMark";

import css from "./ConversationRoot.module.css";

/**
 * Render the blank conversation hero.
 * @returns the centered brand block above the composer card.
 */
export function EmptyHero(): ReactNode {
  return (
    <div className={css.hero}>
      <MioxMark size={30} />
      <h1 className={css.heroTitle}>探索未至之境</h1>
      <span className={css.heroBadge}>预览版</span>
      <p className={css.heroLead}>从左侧选择一个任务，或新建会话开始。</p>
    </div>
  );
}
