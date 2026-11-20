/**
 * Build the three card payloads from a block's recorded text instead of fixtures.
 *
 * Every shape here is derived from what the tools actually return (see
 * `activity-recorded.ts`): `Edit` carries old/new strings, `Read` returns
 * numbered lines, search returns `path:line` pairs.
 */
import type { DiffHunk } from "@/vendor/dsh/primitives/DiffBlock";
import type { ReadBlockLine } from "@/vendor/dsh/primitives/ReadBlock";
import type { SearchFileGroup } from "@/vendor/dsh/primitives/SearchBlock";

/** Split text into lines, dropping a trailing empty line. */
function lines(text: string): string[] {
  const rows = text.split("\n");
  if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/**
 * One hunk from an edit's before/after text.
 * @param path - file path drawn as the hunk header.
 * @param before - prior content, or undefined when the tool created the file.
 * @param after - content after the change.
 * @returns a hunk, or null when both sides are empty.
 */
export function buildHunk(path: string, before: string | undefined, after: string | undefined): DiffHunk[] {
  if ((before ?? "") === "" && (after ?? "") === "") return [];
  return [{ path, oldText: before ?? null, newText: after ?? "" }];
}

/**
 * Parse numbered lines out of a read result.
 *
 * The recorded shape is `"   12→text"` (cat -n style) or plain text; unnumbered
 * lines are numbered from one so the card still renders.
 * @param text - raw tool result text.
 * @returns lines with their 1-based numbers.
 */
export function parseReadLines(text: string): ReadBlockLine[] {
  const rows = lines(text);
  let auto = 0;
  return rows.map((row) => {
    const match = row.match(/^\s*(\d+)[\t→\s]+(.*)$/);
    if (match !== null) {
      auto = Number(match[1]);
      return { number: auto, text: match[2] };
    }
    auto += 1;
    return { number: auto, text: row };
  });
}

/**
 * Parse `path:line` matches into search groups.
 * @param text - raw search result text.
 * @returns one group per file, in first-seen order.
 */
export function parseSearchGroups(text: string): SearchFileGroup[] {
  const groups = new Map<string, SearchFileGroup>();
  for (const row of lines(text)) {
    const match = row.match(/^([^:\n]+):(\d+)[:：]?\s*(.*)$/);
    if (match === null) continue;
    const file = match[1].trim();
    const group = groups.get(file) ?? { path: file, matches: [] };
    group.matches.push({ lineNumber: Number(match[2]), line: match[3] });
    groups.set(file, group);
  }
  return [...groups.values()];
}
