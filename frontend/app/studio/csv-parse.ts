/**
 * Small CSV parser shared by the Data Studio dataset node and the Model Lab
 * CSV trainer. Handles quoted fields and auto-detects , ; or tab delimiters.
 */

export function parseCsvRows(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "").trim();
  if (!src) return [];
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (r[i] ?? "").trim();
    });
    return rec;
  });
}

/**
 * Extract numeric columns from parsed CSV rows: a column qualifies when at
 * least 80% of its non-empty values parse as finite numbers. Gaps are filled
 * with the previous value (leading gaps with the first known value).
 */
export function numericColumns(rows: Record<string, string>[]): Record<string, number[]> {
  if (rows.length === 0) return {};
  const headers = Object.keys(rows[0]);
  const out: Record<string, number[]> = {};
  for (const h of headers) {
    let numeric = 0;
    let nonEmpty = 0;
    for (const r of rows) {
      const v = r[h];
      if (v !== "") {
        nonEmpty++;
        if (Number.isFinite(Number(v))) numeric++;
      }
    }
    if (nonEmpty === 0 || numeric / nonEmpty < 0.8) continue;
    const values: number[] = [];
    let last: number | null = null;
    for (const r of rows) {
      const n = Number(r[h]);
      if (r[h] !== "" && Number.isFinite(n)) {
        last = n;
        values.push(n);
      } else {
        values.push(last ?? NaN);
      }
    }
    const first = values.find((v) => !Number.isNaN(v)) ?? 0;
    out[h] = values.map((v) => (Number.isNaN(v) ? first : v));
  }
  return out;
}
