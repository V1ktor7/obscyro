/**
 * Reading a file someone dropped in, before anything is written.
 *
 * Pure, so the parts a person never sees — encodings, decimal commas, which
 * columns could be a key — are tested rather than trusted. The server decides
 * which column names which places (it knows the twin); this decides what the
 * file says.
 */

import { parseCsvRows } from "../../csv-parse";
import type { LayerAggregate, LayerRole, LayerRowOut } from "./layers-api";

export type Row = Record<string, string>;

/**
 * Text from bytes, as the file was written.
 *
 * Québec's open data is often Windows-1252. Read as UTF-8 it turns
 * "Hôpital" into "H�pital", every accented name stops matching, and the
 * map quietly loses the francophone half of the network. Strict UTF-8 first;
 * if that fails, Windows-1252, and the panel says which it used.
 */
export function decodeBytes(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(view), encoding: "windows-1252" };
  }
}

function flat(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** CSV, TSV or semicolon-separated text, or a JSON array of objects. */
export function parseTable(text: string): { rows: Row[]; columns: string[]; format: "csv" | "json" } {
  const t = text.replace(/^﻿/, "").trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { features?: unknown[] }).features)
          ? (parsed as { features: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] }).features.map(
              (f) => {
                const out: Record<string, unknown> = { ...(f.properties ?? {}) };
                if (f.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates)) {
                  out.longitude ??= f.geometry.coordinates[0];
                  out.latitude ??= f.geometry.coordinates[1];
                }
                return out;
              },
            )
          : [parsed];
      const rows = list
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
        .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, flat(v)])));
      const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
      return { rows, columns, format: "json" };
    } catch {
      // Not JSON after all; fall through to CSV.
    }
  }
  const rows = parseCsvRows(t);
  return { rows, columns: rows.length ? Object.keys(rows[0]!) : [], format: "csv" };
}

/**
 * A number as people write it: "1 234,5", "12,5 %", "$300".
 *
 * A comma is a decimal only when there is no dot and it is followed by one or
 * two digits; otherwise it separates thousands. Null for anything else, never
 * zero — a blank cell is not a site with nothing.
 */
export function toNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim().replace(/[\s  ]/g, "").replace(/[%$€£]/g, "");
  if (!s) return null;
  if (s.includes(",") && !s.includes(".")) {
    s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface ColumnProfile {
  name: string;
  filled: number;
  distinct: number;
  /** Share of filled cells that read as a number. */
  numericShare: number;
  min: number | null;
  max: number | null;
  /** Most frequent values first, for filters. */
  top: { value: string; count: number }[];
  /** When every value is digits of one length — how codes are written — that length. */
  digitWidth: number | null;
}

export function profile(rows: Row[], columns: string[]): ColumnProfile[] {
  return columns.map((name) => {
    const counts = new Map<string, number>();
    let filled = 0;
    let numeric = 0;
    let min = Infinity;
    let max = -Infinity;
    let width: number | null | undefined;
    for (const r of rows) {
      const v = (r[name] ?? "").trim();
      if (!v) continue;
      filled++;
      const w = /^\d+$/.test(v) ? v.length : null;
      width = width === undefined ? w : width === w ? width : null;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      const n = toNumber(v);
      if (n !== null) {
        numeric++;
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
    const top = Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    return {
      name,
      filled,
      distinct: counts.size,
      numericShare: filled ? numeric / filled : 0,
      min: numeric ? min : null,
      max: numeric ? max : null,
      top: top.slice(0, 40),
      digitWidth: width ?? null,
    };
  });
}

/** Columns that can carry a value: mostly numbers. */
export function valueColumns(p: ColumnProfile[]): string[] {
  return p.filter((c) => c.filled > 0 && c.numericShare >= 0.8).map((c) => c.name);
}

/**
 * Columns worth asking the server about as a key.
 *
 * Anything with more than one distinct value, minus measurements. A number
 * column stays in only when it is written like a code — digits of one fixed
 * width of four or more, as installation and territory codes are — or its name
 * says it is one. Bed counts are numbers too, and asking the server to match
 * them against site codes wastes one of the few columns it is sent.
 */
export function keyColumns(p: ColumnProfile[], max = 12): string[] {
  const hint = /code|id|no|num|nom|name|install|site|rls|clsc|territ|etabl|établ/i;
  return p
    .filter((c) => c.distinct > 1)
    .filter((c) => c.numericShare < 0.8 || (c.digitWidth !== null && c.digitWidth >= 4) || /code|^id$|_id$|^no_|num/i.test(c.name))
    .filter((c) => !/^(lat|latitude|lon|lng|longitude|x|y)$/i.test(c.name))
    .sort((a, b) => Number(hint.test(b.name)) - Number(hint.test(a.name)) || b.distinct - a.distinct)
    .slice(0, max)
    .map((c) => c.name);
}

/** A latitude and a longitude column, by name and by range. Null if either is missing. */
export function latLonColumns(p: ColumnProfile[]): { lat: string; lon: string } | null {
  const find = (re: RegExp, lim: number) =>
    p.find((c) => re.test(c.name.trim()) && c.numericShare >= 0.8 && c.min !== null && c.max !== null && Math.abs(c.min) <= lim && Math.abs(c.max) <= lim);
  const lat = find(/^(lat|latitude|y|y_lat)$/i, 90);
  const lon = find(/^(lon|lng|long|longitude|x|x_long)$/i, 180);
  return lat && lon ? { lat: lat.name, lon: lon.name } : null;
}

export interface RowFilter {
  column: string;
  values: string[];
}

export function applyFilters(rows: Row[], filters: RowFilter[]): Row[] {
  const active = filters.filter((f) => f.column && f.values.length > 0);
  if (active.length === 0) return rows;
  const sets = active.map((f) => ({ column: f.column, values: new Set(f.values) }));
  return rows.filter((r) => sets.every((f) => f.values.has((r[f.column] ?? "").trim())));
}

export function describeFilters(filters: RowFilter[]): string {
  return filters
    .filter((f) => f.column && f.values.length > 0)
    .map((f) => `${f.column} = ${f.values.join(" or ")}`)
    .join("; ");
}

export type Placement = { mode: "match"; column: string } | { mode: "points"; lat: string; lon: string; name?: string };

/**
 * The rows the server receives: a key or a position, and one number.
 *
 * With no value column every kept row counts as one, which is how "how many
 * long-term care homes" is answered from a list of homes. Rows without a key,
 * a position or a number are dropped and counted, never sent as zero.
 */
export function layerRows(
  rows: Row[],
  placement: Placement,
  valueColumn: string | null,
): { out: LayerRowOut[]; dropped: number } {
  const out: LayerRowOut[] = [];
  let dropped = 0;
  for (const r of rows) {
    const value = valueColumn ? toNumber(r[valueColumn]) : 1;
    if (value === null) {
      dropped++;
      continue;
    }
    if (placement.mode === "match") {
      const m = (r[placement.column] ?? "").trim();
      if (!m) {
        dropped++;
        continue;
      }
      out.push({ match: m, value });
    } else {
      const lat = toNumber(r[placement.lat]);
      const lon = toNumber(r[placement.lon]);
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        dropped++;
        continue;
      }
      out.push({ lat, lon, value, name: placement.name ? r[placement.name] ?? null : null });
    }
  }
  return { out, dropped };
}

export const ROLES: { key: LayerRole; title: string; example: string; aggregate: LayerAggregate; note: string }[] = [
  {
    key: "capacity",
    title: "Something a site has",
    example: "Beds, stretchers, staff, a generator",
    aggregate: "sum",
    note: "Shown as a layer beside occupancy. It does not change the capacity a run uses; that stays with the twin's resources.",
  },
  {
    key: "population",
    title: "Something about people who live here",
    example: "Age, income, language, living alone",
    aggregate: "mean",
    note: "Lands on catchments when the file names territories, or on the nearest cells when it names sites.",
  },
  {
    key: "reading",
    title: "A reading that changes",
    example: "Stretchers occupied every hour",
    aggregate: "mean",
    note: "A file is a snapshot of one moment. For readings that keep updating, connect a feed in Data › Sources.",
  },
  {
    key: "exposure",
    title: "Something in the environment",
    example: "Temperature, air quality, a boil-water notice",
    aggregate: "mean",
    note: "Shown where it was measured. Turning it into demand needs an exposure–response curve, which is a separate step.",
  },
  {
    key: "outcome",
    title: "What actually happened",
    example: "Admissions, deaths, cases",
    aggregate: "sum",
    note: "Kept to check runs against, never used as an input to one.",
  },
];

export const AGGREGATES: { key: LayerAggregate; label: string; note: string }[] = [
  { key: "sum", label: "Sum", note: "Values add up: two homes of 120 and 80 beds make 200. Right for capacities and counts." },
  { key: "mean", label: "Average", note: "The typical value: right for rates, ages, temperatures — anything that does not add up." },
  { key: "max", label: "Largest", note: "The biggest single value. Useful when one large site is the risk." },
  { key: "count", label: "Count of rows", note: "How many rows land there, whatever their value. Access, not capacity." },
];
