/**
 * Turning a run into a file someone else can open.
 *
 * Small, and pure, because CSV is the format that fails silently. A quote in a
 * facility name, a comma in the sentence explaining why a rule fired, a leading
 * `=` in a value — each one produces a file that opens without complaint and is
 * wrong, and the wrongness lands in whatever the reader does next.
 */

export interface Dataset {
  name: string;
  label: string;
  description: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

/**
 * One field, escaped.
 *
 * The formula guard is the part that is not about CSV at all: a cell beginning
 * `=`, `+`, `-` or `@` is executed as a formula by Excel and Sheets when the
 * file is opened. `because` strings start with a metric name today, but they
 * are assembled from user-named facilities, and a unit called `=cmd` is a
 * spreadsheet running something on a colleague's machine. Prefixing a
 * apostrophe is the standard defence and costs a character nobody sees.
 */
export function escapeField(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(dataset: Dataset): string {
  const lines = [dataset.columns.map(escapeField).join(",")];
  for (const row of dataset.rows) lines.push(row.map(escapeField).join(","));
  // CRLF, because that is what RFC 4180 says and what Excel expects on the
  // platform this is most likely to be opened on.
  return lines.join("\r\n");
}

/**
 * A filename that still means something in a downloads folder next month.
 *
 * The event name and the table, not `export (3).csv`. Dates in ISO order so a
 * directory listing sorts chronologically without anyone asking it to.
 */
export function csvFilename(eventName: string, dataset: string, at = new Date()): string {
  const slug = eventName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const day = at.toISOString().slice(0, 10);
  return `${slug || "event"}-${dataset}-${day}.csv`;
}

/** Hand the file to the browser. Separated so `toCsv` stays testable. */
export function downloadCsv(dataset: Dataset, eventName: string): void {
  // The BOM is what makes Excel read the file as UTF-8 rather than the local
  // codepage. Without it "Médecine" arrives as "MÃ©decine", which reads as a
  // data problem and is a file-opening problem.
  const blob = new Blob(["﻿", toCsv(dataset)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFilename(eventName, dataset.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
