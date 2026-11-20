/**
 * Trigger detection for the composer, ported from ui-input-trigger/src/core/detect.ts:
 * a trigger char opens only at start-of-draft, after whitespace, or after
 * punctuation; `/` is dead inside URLs (after `//` and after a scheme `:`),
 * and the scan stops at the first whitespace before the caret.
 */
export interface TriggerHit {
  trigger: "/" | "@";
  query: string;
  /** Span of the token including the trigger char. */
  start: number;
  end: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/u;

function boundaryOk(draft: string, index: number, char: string): boolean {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  if (char === "/") {
    if (prev === "/") return false;
    if (prev === ":" && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false;
  }
  return true;
}

/**
 * Detect a live trigger token at the caret.
 * @param draft - full draft text.
 * @param caret - caret offset into draft.
 * @returns the hit, or null when nothing is live.
 */
export function detectTrigger(draft: string, caret: number): TriggerHit | null {
  // '@' first: its token may not contain whitespace either, so the same scan works.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i);
    if (WHITESPACE.test(ch)) return null;
    if (ch !== "/" && ch !== "@") continue;
    if (!boundaryOk(draft, i, ch)) continue;
    return { trigger: ch, query: draft.slice(i + 1, caret), start: i, end: caret };
  }
  return null;
}
