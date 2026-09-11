/**
 * Client-side CSV export for the Ledger tab.
 *
 * It serialises the rows already in memory — the ones the current filters
 * fetched — so exporting issues no request and needs no endpoint.
 */

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string;
};

/** RFC 4180 quoting: a field is quoted when it holds a comma, a quote or a newline. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => escapeField(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeField(column.value(row))).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Hands the browser a file built from the string above. A BOM is prepended so
 * a spreadsheet opens the accented names in UTF-8 rather than guessing.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
