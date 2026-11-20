/**
 * Column geometry, computed in JS.
 *
 * Mirrors DSH `ui-layout/client/columns.ts`: the shell solves the three column
 * widths once per frame from the available viewport, clamps them against
 * per-column minimums, and writes the result inline. CSS owns only the tracks —
 * it never re-derives widths from viewport media queries, which is what made a
 * resized window drift in ARTEX (six breakpoint ladders, each flipping at a
 * different width).
 */

/** Center column never shrinks below this; the side columns give way first. */
export const CENTER_MIN = 400;
export const SIDEBAR_MIN = 264;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 280;
export const SIDEBAR_COLLAPSED = 56;
/** Right column drag clamp floor (DSH `RIGHTBAR_MIN`). */
export const RIGHTBAR_MIN = 300;
/** Maximum right column width as a fraction of the viewport (DSH `RIGHTBAR_MAX_RATIO`). */
export const RIGHTBAR_MAX_RATIO = 0.7;
/** First-open right column preference as a fraction of the viewport (DSH `RIGHTBAR_DEFAULT_RATIO`). */
export const RIGHTBAR_DEFAULT_RATIO = 0.45;

/** Below this the sidebar becomes an overlay drawer instead of a column. */
export const DRAWER_BREAKPOINT = 768;
/** Below this the sidebar auto-collapses to its rail; the user's preference is kept. */
export const AUTO_COLLAPSE = 1024;

export interface ColumnInput {
  readonly viewport: number;
  readonly sidebarExpanded: number;
  readonly sidebarCollapsed: boolean;
  readonly rightOpen: boolean;
  readonly rightWidth: number;
}

export interface Columns {
  readonly sidebar: number;
  readonly center: number;
  readonly right: number;
  readonly drawer: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Solve the three widths for one viewport.
 *
 * Order of concessions matches DSH: the right panel narrows first, then the
 * sidebar collapses to its rail, and only then may the center fall below its
 * own minimum (it never does — a viewport that small is served by the drawer).
 */
export function computeColumns(input: ColumnInput): Columns {
  const drawer = input.viewport < DRAWER_BREAKPOINT;
  if (drawer) {
    return { sidebar: 0, center: input.viewport, right: 0, drawer: true };
  }

  const sidebar = input.sidebarCollapsed
    ? SIDEBAR_COLLAPSED
    : clamp(input.sidebarExpanded, SIDEBAR_MIN, SIDEBAR_MAX);

  let right = 0;
  if (input.rightOpen) {
    right = clamp(input.rightWidth, RIGHTBAR_MIN, input.viewport * RIGHTBAR_MAX_RATIO);
    // Narrow the right panel before touching the center.
    const overflow = sidebar + right + CENTER_MIN - input.viewport;
    if (overflow > 0) right = Math.max(0, right - overflow);
  }

  const center = Math.max(0, input.viewport - sidebar - right);
  return { sidebar, center, right, drawer: false };
}

/** Whether the viewport is narrow enough to auto-collapse an expanded sidebar. */
export function shouldAutoCollapse(viewport: number): boolean {
  return viewport < AUTO_COLLAPSE;
}
