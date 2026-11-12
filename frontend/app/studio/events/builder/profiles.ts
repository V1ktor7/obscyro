/**
 * Profiles: a catalogue of events, ready to drop into one.
 *
 * A profile is a reusable, sourced bundle of changes with a shape over time:
 *
 *   observed   what an episode did, per 1,000 residents (the COVID waves,
 *              computed by profiles/covid-waves.py from the INSPQ archive of
 *              every region, and tested by leaving each region out)
 *   exposure   what the air, the heat or the water did, times a published effect
 *   network    what closes or slows down, and for how long
 *   combined   several of those together
 *
 * Presets aim at the open twin's own places (its largest site, its most
 * populous territory), never at a named hospital: a profile is used on a
 * network anywhere in Québec. Using one adds plain changes to the event, where
 * every part stays editable.
 */

import covid from "./profiles/covid-waves.json";
import { EXAMPLE_BASE, newExposure, registerCurve, SRC, type Coef, type Exposure } from "./exposures";
import { addDays, type Ctx } from "./format";
import { defaultPoint, newEffect, setAmount, type FormMemory } from "./model";
import { nextKey, type Item } from "./items";
import type { BuilderTwin } from "./twin";
import type { LatLon } from "./engine";

export type ProfileType = "observed" | "exposure" | "network" | "combined" | "mine";
export type Tier = "Observed" | "Published" | "Published × assumption" | "Assumption" | "Yours";

export interface Profile {
  id: string;
  type: ProfileType;
  tier: Tier;
  name: string;
  summary: string;
  source: string;
  reliabilityShort: string;
  desc: string;
  open: string[];
  curveKey?: string;
  build: (c: Ctx, tw: BuilderTwin, taken: string[]) => Item[];
}

export const PROFILE_TYPES: [ProfileType | "all", string][] = [["all", "All"], ["observed", "Observed"], ["exposure", "Exposure × effect"], ["network", "Network"], ["combined", "Combined"], ["mine", "Yours"]];

interface CovidFile {
  regions: string[];
  profiles: { key: string; label: string; from: string; to: string; days: number; hosp: { low: number[]; central: number[]; high: number[] }; icu: number[];
    totals: { low: number; central: number; high: number }; icuTotal: number; tests: NonNullable<Coef["tests"]> }[];
  example: { region: string; wave: string; population: number; csv: string };
}
export const COVID = covid as unknown as CovidFile;

for (const w of COVID.profiles) {
  registerCurve({
    key: w.key, kind: "curve", group: "Observed episodes", short: w.label, agent: "COVID-19", outcome: "hospital admissions", unit: "", per: 1,
    rr: null, lo: null, hi: null, want: "admission", lag: 0, avg: 1, src: "inspq", setting: `the ${COVID.regions.length} largest regions of Québec`,
    curves: w.hosp, icu: w.icu, days: w.days, tests: w.tests, totals: w.totals, from: w.from, to: w.to, regionsN: COVID.regions.length,
  });
}

/* ---------- presets, aimed at the open twin's own places ---------- */

const largestPop = (tw: BuilderTwin) => tw.pops.reduce<(typeof tw.pops)[number] | null>((a, p) => (!a || p.size > a.size ? p : a), null);
function siteFarFrom(tw: BuilderTwin, at: LatLon): LatLon {
  // A second place for a flood: the located site farthest from the largest, so the
  // front has somewhere to travel.
  let best = at, bd = -1;
  for (const s of tw.sites) { const d = Math.hypot(s.lat - at[0], s.lon - at[1]); if (d > bd) { bd = d; best = s.loc; } }
  return best;
}
const largestSiteId = (tw: BuilderTwin) => tw.sites.reduce<(typeof tw.sites)[number] | null>((a, s) => {
  const cap = (x: (typeof tw.sites)[number]) => Object.values(x.capacity).reduce((n, v) => n + v, 0);
  return !a || cap(s) > cap(a) ? s : a;
}, null)?.id;

const step = (start: number, end: number) => ({ start, end, shape: "step" as const, peak: 1 });

function capacityItem(c: Ctx, tw: BuilderTwin, taken: string[], drop: number, days: number, start: number, place: { site?: string; near?: { at: LatLon; km: number; speed?: number } } | null): Item {
  const e = newEffect(c, tw, taken, "capacity", "");
  const mem: FormMemory = {};
  setAmount(e, mem, "lower", drop);
  e.profile = step(start, start + days - 1);
  if (place?.site) { e.select.facility = [place.site]; mem.scope = "sites"; }
  if (place?.near) { e.spatial = { epicentre: place.near.at, radius_km: place.near.km, falloff: "none", speed_km_per_step: place.near.speed ?? null }; mem.scope = "near"; }
  return { kind: "effect", key: nextKey(), e, mem };
}
function arrivalsItem(c: Ctx, tw: BuilderTwin, taken: string[], kind: "incidence" | "volume", value: number, start: number, days: number, pops: string[] | null, want: "er" | "admission"): Item {
  const e = newEffect(c, tw, taken, kind);
  const mem: FormMemory = { sevs: true };
  const sev = (tw.severities.find((s) => (want === "er" ? /urg|emerg|\ber\b|civi/i : /hosp|admi|lit|bed/i).test(s)) ?? tw.severities[0]) || "";
  e.select = { acuity: sev ? [sev] : [] };
  if (pops && pops.length) { e.select.population = pops; mem.pops = true; }
  setAmount(e, mem, "add", value);
  e.profile = days === 1 ? { start, end: start, shape: "pulse", peak: 1 } : step(start, start + days - 1);
  return { kind: "effect", key: nextKey(), e, mem };
}
function exposureItem(c: Ctx, tw: BuilderTwin, taken: string[], key: string, set: Partial<Exposure>): Item {
  const x = newExposure(c, tw, taken, key);
  Object.assign(x, set);
  return { kind: "exposure", key: nextKey(), x };
}
const series = (s: string) => ({ mode: "series" as const, value: 0, series: s, usual: null, episode: null });
const same = (v: number) => ({ mode: "same" as const, value: v, series: "", usual: null, episode: null });
const example = () => ({ value: 0.0137, unit: "day1000" as const, source: EXAMPLE_BASE });

export const BUILT_IN: Profile[] = [
  ...COVID.profiles.map((w): Profile => {
    const inside = w.tests.filter((t) => t.inside).length;
    return {
      id: w.key, type: "observed", tier: "Observed", curveKey: w.key, name: `COVID-19 · ${w.label}`,
      summary: `${w.totals.central.toPrecision(3)} admissions per 1,000 over ${w.days} days (low ${w.totals.low.toPrecision(3)}, high ${w.totals.high.toPrecision(3)})`,
      source: SRC.inspq!.short, reliabilityShort: `transfer tested: ${inside} of ${w.tests.length} regions inside`,
      desc: `Hospital admissions a day per 1,000 residents, as the ${COVID.regions.length} largest regions of Québec lived wave ${w.key.slice(-1)} (${w.from} to ${w.to}). Central is the median region each day; low and high, the 10th and 90th percentiles.`,
      open: ["the territories", "the day it starts", "low, central or high, and a scale"],
      build: (c, tw, taken) => [exposureItem(c, tw, taken, w.key, {})],
    };
  }),
  { id: "smoke", type: "exposure", tier: "Published × assumption", name: "Wildfire smoke episode",
    summary: "PM2.5 up 40 · 90 · 130 · 70 µg/m³, asthma ER visits ×1.11 per 10 µg/m³", source: SRC.howard!.short, reliabilityShort: "effect published (95 % CI 1.07–1.14); rise illustrative",
    desc: "Smoke over every territory. The effect on asthma ER visits is published (Yellowknife, 2012–2015). The day-by-day rise is illustrative until your air-quality readings replace it, and the usual rate of asthma ER visits is an example value.",
    open: ["the rise, day by day (your stations' readings)", "the usual rate of asthma ER visits", "the territories, or fading from a place", "the day it starts"],
    build: (c, tw, t) => [exposureItem(c, tw, t, "smoke-asthma-er", { start: 5, rise: series("40 90 130 70"), base: example() })] },
  { id: "smog", type: "exposure", tier: "Published × assumption", name: "Fine-particle smog",
    summary: "PM2.5 up 20 µg/m³ for 3 days, asthma ER visits ×1.017 per 10 µg/m³", source: SRC.zheng!.short, reliabilityShort: "effect published (95 % CI 1.006–1.029); rise illustrative",
    desc: "A winter or summer smog episode at ordinary pollution levels. The effect is a meta-analysis of 87 studies; the rise and the usual rate are values to replace with yours.",
    open: ["the rise (your air-quality readings)", "the usual rate of asthma ER visits", "the territories", "the day it starts"],
    build: (c, tw, t) => [exposureItem(c, tw, t, "pm25-asthma-er", { start: 5, days: 3, rise: same(20), base: example() })] },
  { id: "ozone", type: "exposure", tier: "Published × assumption", name: "Ozone episode",
    summary: "O₃ up 60 µg/m³ for 3 days, asthma ER visits ×1.007 per 10 µg/m³", source: SRC.zheng!.short, reliabilityShort: "effect published (95 % CI 1.004–1.010); rise illustrative",
    desc: "A hot, sunny ozone episode. The effect is published; the rise and the usual rate are illustrative.",
    open: ["the rise (your air-quality readings)", "the usual rate of asthma ER visits", "the territories", "the day it starts"],
    build: (c, tw, t) => [exposureItem(c, tw, t, "o3-asthma-er", { start: 5, days: 3, rise: same(60), base: example() })] },
  { id: "heat", type: "exposure", tier: "Published × assumption", name: "Heat wave",
    summary: "+0.08 ER arrivals per 1,000 a day for 4 days", source: SRC.heat!.short, reliabilityShort: "published figure; the stretcher share is an assumption",
    desc: "The hottest days of a Québec summer. The same figure as the Scenarios heat stamp: the INRS–INSPQ hottest-days ER total, half of it needing a stretcher (that half is an assumption).",
    open: ["how many days", "the territories", "the day it starts"],
    build: (c, tw, t) => [exposureItem(c, tw, t, "heat-er", { start: 5, days: 4 })] },
  { id: "water", type: "exposure", tier: "Assumption", name: "Contaminated water supply",
    summary: "2 % fall ill, 10 % of them come to the ER, after 3 days", source: "your assumption", reliabilityShort: "no published figure: both shares are yours",
    desc: "A contamination of the water that supplies one sector. No published figure turns it into arrivals: the share who fall ill and the share who come to the ER are assumptions to set from the investigation. Walkerton (Ontario, 2000) is the reference episode to read before choosing them.",
    open: ["the territories the plant supplies", "the two shares", "the incubation, by pathogen", "the day it starts"],
    build: (c, tw, t) => {
      const p = largestPop(tw);
      return [exposureItem(c, tw, t, "water", { start: 5, lag: 3, where: { mode: "some", pops: p ? [p.id] : [], each: {}, at: defaultPoint(tw), radius: 20 }, attack: { ill: 2, er: 10, spread: 7 } })];
    } },
  { id: "outage", type: "network", tier: "Assumption", name: "Power outage around a hospital",
    summary: "Capacity −50 % within 3 km of the largest site, 2 days", source: "example values", reliabilityShort: "how much runs on generators is yours to set",
    desc: "A grid failure in one district. Hospitals keep part of their capacity on generators: the 50 % is an example to replace with your own continuity plans.",
    open: ["the place and the radius", "how much capacity is kept", "how long"],
    build: (c, tw, t) => [capacityItem(c, tw, t, 50, 2, 5, { near: { at: defaultPoint(tw), km: 3 } })] },
  { id: "flood", type: "network", tier: "Assumption", name: "Flood spreading from a point",
    summary: "Capacity lost within 2 km, the water advancing 0.5 km a day, 10 days", source: "example values", reliabilityShort: "the place, reach and speed are yours to set",
    desc: "Water rising and reaching sites one after another. The engine delays each site by its distance from the start; move the point to the riverbank that matters.",
    open: ["the starting point", "how far and how fast", "how long"],
    build: (c, tw, t) => [capacityItem(c, tw, t, 100, 10, 5, { near: { at: siteFarFrom(tw, defaultPoint(tw)), km: 2, speed: 0.5 } })] },
  { id: "cyber", type: "network", tier: "Assumption", name: "Cyberattack on a hospital",
    summary: "Capacity −40 % at the largest site for 14 days", source: "example values", reliabilityShort: "the loss and the length are yours to set",
    desc: "Systems down at one site: admissions slow and part of the capacity becomes unusable.",
    open: ["the site", "how much capacity is lost", "how long"],
    build: (c, tw, t) => { const s = largestSiteId(tw); return [capacityItem(c, tw, t, 40, 14, 5, s ? { site: s } : null)]; } },
  { id: "staff", type: "network", tier: "Assumption", name: "Staff shortage",
    summary: "Capacity −15 % everywhere for 21 days", source: "example values", reliabilityShort: "the share is yours to set",
    desc: "Sickness or a strike. Unless the twin holds staff objects, the shortage is expressed as capacity a site cannot staff.",
    open: ["the sites", "the share", "how long"],
    build: (c, tw, t) => [capacityItem(c, tw, t, 15, 21, 5, null)] },
  { id: "mci", type: "network", tier: "Assumption", name: "Mass-casualty incident",
    summary: "40 arrivals in one day, in the most populous territory", source: "a number you choose", reliabilityShort: "a decision, not a rate",
    desc: "A coach crash, a fire, a collapse: a fixed number of people arriving on one day, whatever the size of the territory.",
    open: ["the territory", "how many", "the day"],
    build: (c, tw, t) => { const p = largestPop(tw); return [arrivalsItem(c, tw, t, "volume", 40, 5, 1, p ? [p.id] : null, "er")]; } },
  { id: "icestorm", type: "combined", tier: "Assumption", name: "Ice storm (like January 1998)",
    summary: "Power out over a wide area for 7 days, staff −15 % for 14, injuries for 5", source: "example values", reliabilityShort: "every value is yours to set; 1998 is the reference",
    desc: "Three changes that come together: the grid fails over a wide area, staff cannot reach work, and falls and carbon-monoxide poisonings bring people in.",
    open: ["the area and the length of the outage", "the staff share", "the injury rate"],
    build: (c, tw, t) => {
      // Ids are made unique when the profile is added to an event.
      return [
        capacityItem(c, tw, t, 50, 7, 3, { near: { at: defaultPoint(tw), km: 15 } }),
        capacityItem(c, tw, t, 15, 14, 3, null),
        arrivalsItem(c, tw, t, "incidence", 0.01, 3, 5, null, "er"),
      ];
    } },
];

/* ---------- reading a series someone brings, the way the platform reads files ---------- */

/** add-data.ts: strict UTF-8 first; Québec's open data is often Windows-1252. */
export function decodeBytes(buf: ArrayBuffer): { text: string; encoding: string } {
  const view = new Uint8Array(buf);
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), encoding: "UTF-8" }; }
  catch { return { text: new TextDecoder("windows-1252").decode(view), encoding: "Windows-1252" }; }
}
/** csv-parse.ts: quoted fields, and , ; or tab, whichever the header uses most. */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "").trim();
  if (!src) return [];
  const nl = src.indexOf("\n"), firstLine = src.slice(0, nl === -1 ? src.length : nl);
  const delimiter = [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best));
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) { if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += ch; }
    else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}
/** add-data.ts: "1 234,5" and "12,5 %" read as numbers; a blank is null, never zero. */
export function toNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  let t = String(raw).trim().replace(/[\s  ]/g, "").replace(/[%$€£]/g, "");
  if (!t) return null;
  if (t.includes(",") && !t.includes(".")) t = /,\d{1,2}$/.test(t) && t.split(",").length === 2 ? t.replace(",", ".") : t.replace(/,/g, "");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface ColumnProfile { numeric: boolean; iso: number; distinct: number; top: [string, number][] }
export interface Table { name: string; rows: Record<string, string>[]; columns: string[]; prof: Record<string, ColumnProfile>; meta: string }

export function profileTable(name: string, rows: Record<string, string>[], meta: string): Table {
  const columns = Object.keys(rows[0] ?? {}), prof: Record<string, ColumnProfile> = {};
  for (const c of columns) {
    let filled = 0, num = 0, iso = 0;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = String(r[c] ?? "").trim();
      if (!v) continue;
      filled++;
      if (toNumber(v) !== null) num++;
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) iso++;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    prof[c] = { numeric: filled > 0 && num / filled >= 0.8 && iso / filled < 0.5, iso: filled ? iso / filled : 0, distinct: counts.size,
      top: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 400) };
  }
  return { name, rows, columns, prof, meta };
}

export interface SeriesMapping {
  dateCol: string; countCol: string; filterCol: string; filterVal: string; from: string; to: string; cumulative: boolean; sumSameDay: boolean;
}

/** First guesses, all of them shown and changeable: a date column, a count column, and what tells rows of one day apart. */
export function guessMapping(t: Table): SeriesMapping {
  const { columns, prof } = t;
  const dateCol = columns.find((c) => prof[c]!.iso >= 0.6 && /date|jour|day/i.test(c)) || columns.find((c) => prof[c]!.iso >= 0.6) || columns[0] || "";
  const nums = columns.filter((c) => prof[c]!.numeric && c !== dateCol);
  const countCol = nums.find((c) => /adm|hosp|hos_|cas|case|count|visit|nb|deces|death/i.test(c)) || nums[0] || "";
  const perDay = new Map<string, number>();
  for (const r of t.rows) { const k = String(r[dateCol] ?? "").slice(0, 10); perDay.set(k, (perDay.get(k) || 0) + 1); }
  const several = Array.from(perDay.values()).some((n) => n > 1);
  const filterCol = several ? columns.filter((c) => !prof[c]!.numeric && c !== dateCol && prof[c]!.distinct > 1 && prof[c]!.distinct <= 400).sort((a, b) => prof[b]!.distinct - prof[a]!.distinct)[0] || "" : "";
  return { dateCol, countCol, filterCol, filterVal: "", from: "", to: "", cumulative: /cum/i.test(countCol), sumSameDay: false };
}

const fmtN = (n: number) => n.toLocaleString("en-CA");

/** The daily series, from pasted text or a mapped table, or the reason it cannot be one. */
export function readSeries(paste: string, t: Table | null, m: SeriesMapping): { rows?: [string, number][]; error?: string; notes: string[] } {
  const notes: string[] = [];
  const byDate = new Map<string, number | null>();
  if (!t) {
    const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), bad: string[] = [];
    for (const l of lines) {
      const [a, b] = l.split(/[,;\t]/).map((x) => x.trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a || "")) { if (byDate.size || bad.length) bad.push(l); continue; }
      const v = toNumber(b);
      if (v === null || v < 0) bad.push(l);
      else if (byDate.has(a!)) return { error: `${a} appears twice. One row per day.`, notes };
      else byDate.set(a!, v);
    }
    if (!byDate.size) return { error: "No row reads as a date and a count.", notes };
    if (bad.length) return { error: `${bad.length} row${bad.length === 1 ? "" : "s"} do not read as a date and a count, for example “${bad[0]}”.`, notes };
  } else {
    if (!m.countCol || !t.prof[m.countCol]) return { error: "Pick the column that holds the counts.", notes };
    let rows = t.rows;
    if (m.filterCol) {
      if (m.filterVal === "") return { error: `Several rows share a day. Pick which ${m.filterCol} to keep, or choose “every row” and add up the rows of the same day.`, notes };
      rows = rows.filter((r) => String(r[m.filterCol] ?? "").trim() === m.filterVal);
      notes.push(`Kept the ${fmtN(rows.length)} rows where ${m.filterCol} is “${m.filterVal}”.`);
    }
    let noDate = 0, ambiguous: string | null = null, dup = false;
    const seen = new Map<string, number>();
    for (const r of rows) {
      const raw = String(r[m.dateCol] ?? "").trim(), mt = raw.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!mt) { if (!ambiguous && /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(raw)) ambiguous = raw; noDate++; continue; }
      const v = toNumber(r[m.countCol]), k = mt[1]!;
      seen.set(k, (seen.get(k) || 0) + 1);
      if (byDate.has(k)) {
        if (!m.sumSameDay) { dup = true; continue; }
        const was = byDate.get(k)!;
        byDate.set(k, was === null || v === null ? null : was + v);
      } else byDate.set(k, v);
    }
    if (!byDate.size) {
      return { error: ambiguous ? `Dates are written like “${ambiguous}”: the day and the month cannot be told apart. Convert them to YYYY-MM-DD first.` : `No row of “${m.dateCol}” reads as a date (YYYY-MM-DD).`, notes };
    }
    if (dup) {
      const k = Array.from(seen.entries()).find(([, n]) => n > 1)!;
      return { error: `${fmtN(Array.from(seen.values()).filter((n) => n > 1).length)} days have several rows (${k[0]} has ${k[1]}). Keep one entity with “Only rows where”, or add up the rows of the same day.`, notes };
    }
    if (noDate) notes.push(`${fmtN(noDate)} row${noDate === 1 ? "" : "s"} with no date${ambiguous ? ` or a date like “${ambiguous}”` : " (for example “Date inconnue”)"} left out.`);
  }
  let days = Array.from(byDate.keys()).sort();
  if (m.from) days = days.filter((k) => k >= m.from);
  if (m.to) days = days.filter((k) => k <= m.to);
  if (!days.length) return { error: "No day falls inside the period chosen.", notes };
  // Every calendar day from the first to the last: a day the file skips is a hole, not a zero.
  const cal: [string, number | null][] = [];
  for (let k = days[0]!; k <= days[days.length - 1]!; k = addDays(k, 1)) cal.push([k, byDate.has(k) ? byDate.get(k)! : null]);
  let vals = cal.map((x) => x[1]);
  if (t && m.cumulative) {
    // observed-series.ts asDaily: the difference of a running total, a fall read as a revision,
    // and the chain broken at a hole rather than bridged across it.
    let last: number | null = null, down = 0;
    vals = vals.map((v) => { if (v === null) { last = null; return null; } const out = last === null ? null : Math.max(0, v - last); if (last !== null && v < last) down++; last = v; return out; });
    notes.push(`Daily counts taken as the difference of a cumulative total${down ? `; ${down} day${down === 1 ? "" : "s"} where it went down read as revisions (0)` : ""}.`);
  }
  let a = 0, b = vals.length - 1;
  while (a <= b && vals[a] === null) a++;
  while (b >= a && vals[b] === null) b--;
  if (a > b) return { error: "Every day in the period is empty.", notes };
  for (let k = a; k <= b; k++) {
    if (vals[k] === null) {
      let e = k;
      while (e <= b && vals[e] === null) e++;
      return { error: `${e - 1 === k ? `${cal[k]![0]} is missing or empty` : `Days are missing or empty from ${cal[k]![0]} to ${cal[e - 1]![0]}`}. Fill ${e - 1 === k ? "it" : "them"} or cut the period: a missing day is not a zero.`, notes };
    }
    if (vals[k]! < 0) return { error: `${cal[k]![0]} has a negative count. Counts of arrivals cannot be negative.`, notes };
  }
  return { rows: cal.slice(a, b + 1).map((x, k) => [x[0], vals[a + k]!] as [string, number]), notes };
}

/** A series per 1,000 residents, optionally smoothed over seven centred days. */
export function perThousand(rows: [string, number][], pop: number, smooth: boolean): number[] {
  let curve = rows.map((r) => (r[1] / pop) * 1000);
  if (smooth) curve = curve.map((_, k) => { const w = curve.slice(Math.max(0, k - 3), k + 4); return w.reduce((s, v) => s + v, 0) / w.length; });
  return curve;
}

/* ---------- profiles people save ---------- */

/** What a saved profile stores: enough to rebuild its changes, nothing of the twin it was made in. */
export type SavedProfileBody =
  | { kind: "series"; sev: string; curve: number[]; from: string; to: string; population: number; source: string }
  | { kind: "exposure"; coef: string; series: string; usual: number | null }
  | { kind: "changes"; items: { item: Item }[] };

export interface SavedProfile { id: string; name: string; description: string; body: SavedProfileBody; createdAt?: string }

export function profileFromSaved(s: SavedProfile): Profile {
  const b = s.body;
  if (b.kind === "series") {
    const key = `mine:${s.id}`, total = b.curve.reduce((a, v) => a + v, 0);
    registerCurve({ key, kind: "curve", group: "Yours", short: s.name, agent: s.name, outcome: "arrivals", unit: "", per: 1, rr: null, lo: null, hi: null, want: "admission",
      lag: 0, avg: 1, src: "mine", setting: "your series", curves: { low: b.curve, central: b.curve, high: b.curve }, icu: null, days: b.curve.length, tests: [],
      totals: { low: total, central: total, high: total }, from: b.from, to: b.to, regionsN: 1, sev: b.sev });
    return { id: s.id, type: "mine", tier: "Observed", curveKey: key, name: s.name, summary: `${total.toPrecision(3)} per 1,000 over ${b.curve.length} days, as ${b.sev}`,
      source: `${b.source}, ${fmtN(b.population)} residents`, reliabilityShort: "not tested on another territory", desc: s.description || `Imported: ${b.curve.length} days from ${b.from} to ${b.to}.`,
      open: ["the territories", "the day it starts", "a scale"], build: (c, tw, t) => [exposureItem(c, tw, t, key, { sev: tw.severities.includes(b.sev) ? b.sev : tw.severities[0] ?? b.sev })] };
  }
  if (b.kind === "exposure") {
    return { id: s.id, type: "mine", tier: "Published × assumption", name: s.name, summary: `${b.coef}: rise ${b.series}`, source: "your exposure",
      reliabilityShort: "effect published; rise yours", desc: s.description || "Your exposure, with a published effect.", open: ["the territories", "the day it starts", ...(b.usual == null ? ["the usual rate"] : [])],
      build: (c, tw, t) => [exposureItem(c, tw, t, b.coef, { start: 5, rise: series(b.series), base: { value: b.usual, unit: "day1000", source: b.usual == null ? "" : "set when the profile was saved" } })] };
  }
  return { id: s.id, type: "mine", tier: "Yours", name: s.name, summary: `${b.items.length} change${b.items.length === 1 ? "" : "s"}`, source: "saved from an event",
    reliabilityShort: "as reliable as the changes it holds", desc: s.description || "Saved from an event.", open: ["every part stays editable in the event"],
    build: () => b.items.map(({ item }) => ({ ...JSON.parse(JSON.stringify(item)), key: nextKey() })) };
}
