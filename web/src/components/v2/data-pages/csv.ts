"use client";

/**
 * Local CSV export for the read-only data pages.
 *
 * The export never calls the backend: it serialises the rows already on screen
 * and hands the file to the browser through a blob URL. Data pages only ever
 * expose read or reversible actions, so the header action must not mutate state.
 */

/** Quote a cell that carries a separator, a quote or a line break (RFC 4180). */
function escapeCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Serialise rows into a CSV document with a UTF-8 BOM (Excel reads Chinese
 * headers correctly only when the BOM is present).
 * @param headers - column titles, in display order.
 * @param rows - cell values, one array per data row.
 * @returns the CSV document text.
 */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(escapeCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * Build a timestamped download name for a data page export.
 * @param slug - page slug, such as `assets`.
 * @returns `<slug>-YYYY-MM-DD-HH-mm-ss.csv` in UTC.
 */
export function csvFileName(slug: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
  return `${slug}-${stamp}.csv`;
}

/**
 * Download CSV text generated in the browser.
 * @param fileName - name the browser saves the file as.
 * @param text - CSV document from {@link buildCsv}.
 */
export function downloadCsv(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can abort the download that the click just started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
