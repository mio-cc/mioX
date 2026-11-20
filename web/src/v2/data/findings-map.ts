/**
 * Project backend findings onto the right panel's row view model.
 * Pure so the mapping is checkable without a backend.
 */
import type { Finding } from "@/lib/types";

export type RowSeverity = "high" | "medium" | "low";

export interface FindingRow {
  id: string;
  severity: RowSeverity;
  title: string;
  at: string;
}

const SEVERITY: Record<string, RowSeverity> = {
  critical: "high",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

/** Relative time from an ISO timestamp. */
function relative(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * Map findings to rows.
 * @param findings - backend findings, newest first as returned.
 * @returns rows for the panel list.
 */
export function findingsToRows(findings: readonly Finding[]): FindingRow[] {
  return findings.map((finding) => {
    const raw = String((finding as unknown as { severity?: unknown }).severity ?? "low");
    const name = (finding as unknown as { name?: unknown; title?: unknown }).name
      ?? (finding as unknown as { title?: unknown }).title
      ?? finding.id;
    const ts = (finding as unknown as { ts?: unknown; created_at?: unknown }).ts
      ?? (finding as unknown as { created_at?: unknown }).created_at
      ?? "";
    return {
      id: String(finding.id),
      severity: SEVERITY[raw.toLowerCase()] ?? "low",
      title: String(name),
      at: typeof ts === "string" && ts !== "" ? relative(ts) : "",
    };
  });
}
