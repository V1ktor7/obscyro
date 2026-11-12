/**
 * Exposures: air, smoke, heat and water turned into arrivals; and observed
 * episodes (a COVID wave, your own series) replayed per 1,000 residents.
 *
 * A published relative risk says how much more often an outcome happens per
 * unit of exposure. Applied to the usual rate of that outcome:
 *
 *     extra per 1,000 a day = usual rate × (RR ^ (rise ÷ increment) − 1)
 *
 * sent as `demand.incidence` effects, one per group of territories and per run
 * of days with the same rate. The engine learns nothing new: this is the
 * arithmetic a person would do on paper, kept so it can be reopened.
 */

import type { SimEffect } from "@/lib/platform-api";
import { distanceKm, type LatLon } from "./engine";
import { fmt, names, sig, tidy, u1, uN, type Ctx } from "./format";
import { defaultPoint, freshId, placeLabel, type Finding, type Part, type Said, type Truth } from "./model";
import type { BPop, BuilderTwin } from "./twin";

export interface Source { short: string; cite: string; url: string | null }
export const SRC: Record<string, Source> = {
  zheng: { short: "Zheng 2015", cite: "Zheng et al. 2015, PLoS ONE: meta-analysis of 87 time-series and case-crossover studies of asthma ER visits and admissions", url: "https://europepmc.org/article/PMC/PMC4575194" },
  howard: { short: "Howard 2021, Yellowknife", cite: "Howard et al. 2021, BMJ Open: Yellowknife ER visits and admissions, summers 2012–2015, including the 2014 “Summer of Smoke”", url: "https://europepmc.org/article/PMC/PMC7925857" },
  vancouver: { short: "Vancouver 2023", cite: "Vancouver fire seasons 2009–2019, The Journal of Climate Change and Health, 2023", url: "https://doaj.org/article/92aefd7b61254100b4da028de6358468" },
  heat: { short: "INRS–INSPQ", cite: "INRS–INSPQ hottest-days ER total for Québec, the figure the Scenarios heat stamp already uses", url: null },
  hsieh: { short: "Hsieh 2015", cite: "Hsieh et al. 2015, PLoS ONE: drinking-water turbidity and GI ER visits, New York 2002–2009", url: "https://europepmc.org/article/PMC/PMC4412479" },
  ontario: { short: "Ontario 2006", cite: "The Ontario Asthma Regional Variation Study, Chest 2006", url: "https://pubmed.ncbi.nlm.nih.gov/16608938/" },
  inspq: { short: "INSPQ, 13 regions", cite: "INSPQ archive of daily COVID-19 hospital admissions by region (covid19-hist-archives, January 2023), divided by INSPQ's own population denominators", url: null },
  mine: { short: "your series", cite: "a series you imported", url: null },
};

/** Which severity an outcome arrives as, read off the twin rather than assumed. */
export type Want = "er" | "admission";

export interface Coef {
  key: string;
  kind: "rr" | "abs" | "attack" | "curve";
  group: string;
  short: string;
  agent: string;
  outcome: string;
  unit: string;
  per: number;
  rr: number | null;
  lo: number | null;
  hi: number | null;
  want: Want;
  lag: number;
  avg: number;
  src: string | null;
  setting: string;
  base?: "asthma";
  maxSeen?: number;
  lagUnchecked?: boolean;
  value?: number;
  kw?: string;
  /** Observed curves, per 1,000 residents a day, by version. */
  curves?: { low: number[]; central: number[]; high: number[] };
  icu?: number[] | null;
  days?: number;
  tests?: { region: string; real: number; low: number; central: number; high: number; inside: boolean; ratio: number | null; shape: number | null; peakLag: number }[];
  totals?: { low: number; central: number; high: number };
  from?: string;
  to?: string;
  regionsN?: number;
  /** For an imported series: the severity it was declared as. */
  sev?: string;
}

const ZH = { kind: "rr" as const, unit: "µg/m³", per: 10, avg: 1, src: "zheng", base: "asthma" as const, lo: 0, hi: 0,
  setting: "a meta-analysis of 87 studies from many cities, at ordinary pollution levels", kw: "air quality pollution qualité de l'air asthme smog" };
const HW = { kind: "rr" as const, agent: "PM2.5", unit: "µg/m³", per: 10, avg: 2, lag: 0, src: "howard", maxSeen: 320,
  setting: "Yellowknife during wildfire smoke (daily PM2.5 up to 320 µg/m³)", kw: "wildfire smoke fumée feux de forêt incendie" };

/** Quoted as published. Zheng et al.: Table 2 by type of admission; Howard et al.: Table 2, 2-day average. */
export const EXPOSURES: Coef[] = [
  { ...ZH, key: "pm25-asthma-er", group: "Fine particles (PM2.5)", short: "Asthma ER visits", agent: "PM2.5", rr: 1.017, lo: 1.006, hi: 1.029, outcome: "asthma ER visits", want: "er", lag: 1 },
  { ...ZH, key: "pm25-asthma-ha", group: "Fine particles (PM2.5)", short: "Asthma admissions", agent: "PM2.5", rr: 1.028, lo: 1.017, hi: 1.040, outcome: "asthma admissions", want: "admission", lag: 1 },
  { ...HW, key: "smoke-asthma-er", group: "Wildfire smoke (PM2.5)", short: "Asthma ER visits", rr: 1.11, lo: 1.07, hi: 1.14, outcome: "asthma ER visits", want: "er", base: "asthma" },
  { ...HW, key: "smoke-pneumonia-er", group: "Wildfire smoke (PM2.5)", short: "Pneumonia ER visits", rr: 1.06, lo: 1.02, hi: 1.10, outcome: "pneumonia ER visits", want: "er" },
  { ...HW, key: "smoke-resp-er", group: "Wildfire smoke (PM2.5)", short: "Respiratory ER visits", rr: 1.03, lo: 1.01, hi: 1.05, outcome: "respiratory ER visits", want: "er" },
  { ...HW, key: "smoke-copd-ha", group: "Wildfire smoke (PM2.5)", short: "COPD admissions", rr: 1.11, lo: 1.02, hi: 1.20, outcome: "COPD admissions", want: "admission" },
  { kind: "rr", key: "smoke-resp-vancouver", group: "Wildfire smoke (PM2.5)", short: "Respiratory complaints (Vancouver)", agent: "PM2.5", unit: "µg/m³", per: 10, rr: 1.0461, lo: 1.0307, hi: 1.0617,
    outcome: "respiratory complaints at the ER", want: "er", lag: 0, avg: 1, lagUnchecked: true, src: "vancouver", setting: "Vancouver, fire seasons 2009–2019", kw: HW.kw },
  { ...ZH, key: "o3-asthma-er", group: "Other pollutants", short: "Ozone → asthma ER", agent: "O₃", rr: 1.007, lo: 1.004, hi: 1.010, outcome: "asthma ER visits", want: "er", lag: 0, kw: ZH.kw + " ozone o3" },
  { ...ZH, key: "o3-asthma-ha", group: "Other pollutants", short: "Ozone → asthma admissions", agent: "O₃", rr: 1.010, lo: 1.006, hi: 1.014, outcome: "asthma admissions", want: "admission", lag: 0, kw: ZH.kw + " ozone o3" },
  { ...ZH, key: "no2-asthma-er", group: "Other pollutants", short: "NO₂ → asthma ER", agent: "NO₂", rr: 1.013, lo: 1.008, hi: 1.018, outcome: "asthma ER visits", want: "er", lag: 0, kw: ZH.kw + " no2 nitrogen dioxide traffic trafic" },
  { ...ZH, key: "no2-asthma-ha", group: "Other pollutants", short: "NO₂ → asthma admissions", agent: "NO₂", rr: 1.023, lo: 1.017, hi: 1.029, outcome: "asthma admissions", want: "admission", lag: 0, kw: ZH.kw + " no2 nitrogen dioxide traffic trafic" },
  { ...ZH, key: "so2-asthma-er", group: "Other pollutants", short: "SO₂ → asthma ER", agent: "SO₂", rr: 1.013, lo: 1.007, hi: 1.019, outcome: "asthma ER visits", want: "er", lag: 0, kw: ZH.kw + " so2 sulphur sulfur soufre industrial" },
  { ...ZH, key: "so2-asthma-ha", group: "Other pollutants", short: "SO₂ → asthma admissions", agent: "SO₂", rr: 1.008, lo: 1.002, hi: 1.014, outcome: "asthma admissions", want: "admission", lag: 0, kw: ZH.kw + " so2 sulphur sulfur soufre industrial" },
  { ...ZH, key: "pm10-asthma-er", group: "Other pollutants", short: "PM10 → asthma ER", agent: "PM10", rr: 1.010, lo: 1.006, hi: 1.014, outcome: "asthma ER visits", want: "er", lag: 1, kw: ZH.kw + " pm10 dust poussière" },
  { ...ZH, key: "pm10-asthma-ha", group: "Other pollutants", short: "PM10 → asthma admissions", agent: "PM10", rr: 1.011, lo: 1.008, hi: 1.015, outcome: "asthma admissions", want: "admission", lag: 1, kw: ZH.kw + " pm10 dust poussière" },
  { ...ZH, key: "co-asthma-er", group: "Other pollutants", short: "CO → asthma ER", agent: "CO", unit: "mg/m³", per: 1, rr: 1.030, lo: 1.011, hi: 1.049, outcome: "asthma ER visits", want: "er", lag: 1, kw: ZH.kw + " co carbon monoxide monoxyde" },
  { ...ZH, key: "co-asthma-ha", group: "Other pollutants", short: "CO → asthma admissions", agent: "CO", unit: "mg/m³", per: 1, rr: 1.080, lo: 1.048, hi: 1.112, outcome: "asthma admissions", want: "admission", lag: 1, kw: ZH.kw + " co carbon monoxide monoxyde" },
  { kind: "abs", key: "heat-er", group: "Heat", short: "ER arrivals on the hottest days", agent: "heat", unit: "", per: 1, rr: null, lo: null, hi: null, value: 0.08, outcome: "ER arrivals", want: "er", lag: 0, avg: 1, src: "heat",
    setting: "Québec, hottest 5 % of days", kw: "heat wave chaleur canicule température temperature" },
  { kind: "attack", key: "water", group: "Water", short: "Contaminated supply: your own attack rate", agent: "water", unit: "", per: 1, rr: null, lo: null, hi: null, outcome: "gastro-intestinal ER visits", want: "er", lag: 3, avg: 1, src: "hsieh",
    setting: "your own assumption", kw: "water eau contamination boil advisory avis d'ébullition turbidité turbidity gastro aqueduc" },
  { kind: "rr", key: "custom", group: "Your own study", short: "Your own relative risk", agent: "", unit: "µg/m³", per: 10, rr: null, lo: null, hi: null, outcome: "", want: "er", lag: 0, avg: 1, src: null,
    setting: "your own study", kw: "custom pollen noise bruit other autre" },
];
export const EXP = new Map(EXPOSURES.map((c) => [c.key, c]));
export const EXP_GROUPS = Array.from(new Set(EXPOSURES.map((c) => c.group)));

/** Observed curves (the COVID waves, imported series) are registered here by the profile catalogue. */
export const CURVES = new Map<string, Coef>();
export const registerCurve = (c: Coef) => CURVES.set(c.key, c);

export const EXAMPLE_BASE = "Example only: 5 a year per 1,000, inside the 1.7–10.1 Ontario reported for adults in 2006. Replace it with your own ER data.";

export function pickSev(tw: BuilderTwin, want: Want): string {
  const re = want === "er" ? /urg|emerg|\ber\b|ed\b|civi/i : /hosp|admi|inpatient|lit|bed/i;
  const byName = tw.severities.find((s) => re.test(s));
  const byResource = tw.protocols.find((p) => p.resource && re.test(p.resource))?.severity;
  return byName ?? byResource ?? tw.severities[0] ?? "";
}

export interface Exposure {
  id: string;
  coef: string;
  sev: string;
  lag: number;
  avg: number;
  version: "low" | "central" | "high";
  scale: number;
  rise: { mode: "same" | "series"; value: number; series: string; usual: number | null; episode: number | null };
  where: { mode: "all" | "some" | "each" | "near"; pops: string[]; each: Record<string, number>; at: LatLon; radius: number };
  start: number;
  days: number;
  base: { value: number | null; unit: "day1000" | "all" | "year1000"; source: string };
  abs: number | null;
  attack: { ill: number; er: number; spread: number };
  custom: { agent: string; unit: string; per: number | null; rr: number | null; lo: number | null; hi: number | null; outcome: string; source: string };
}

export function coefOf(x: Exposure): Coef {
  const c = EXP.get(x.coef) ?? CURVES.get(x.coef);
  if (!c) return { ...EXP.get("custom")!, key: x.coef, short: "a profile this catalogue no longer has", rr: null };
  if (x.coef !== "custom") return c;
  const u = x.custom;
  return { ...c, agent: u.agent.trim() || "the exposure", unit: u.unit.trim() || "units", per: u.per ?? 0, rr: u.rr, lo: u.lo, hi: u.hi,
    outcome: u.outcome.trim() || "the outcome", avg: x.avg || 1 };
}

export function newExposure(c: Ctx, tw: BuilderTwin, taken: Iterable<string>, key: string): Exposure {
  const k = EXP.get(key) ?? CURVES.get(key)!;
  const curve = k.kind === "curve";
  return {
    id: freshId(taken, key === "custom" ? "exposure" : curve ? key : key.split("-").slice(0, 2).join("-")),
    coef: key, sev: k.sev ?? pickSev(tw, k.want), lag: curve ? 0 : k.lag, avg: k.avg || 1, version: "central", scale: 1,
    rise: { mode: "same", value: 0, series: "", usual: null, episode: null },
    where: { mode: "all", pops: [], each: {}, at: defaultPoint(tw), radius: 20 },
    start: curve ? 0 : Math.round(c.horizon / 6), days: curve ? k.days ?? 1 : 3,
    base: { value: null, unit: "day1000", source: "" },
    abs: k.kind === "abs" ? k.value ?? null : null,
    attack: { ill: 0, er: 0, spread: 7 },
    custom: { agent: "", unit: "µg/m³", per: 10, rr: null, lo: null, hi: null, outcome: "", source: "" },
  };
}

export function setCoef(x: Exposure, tw: BuilderTwin, key: string) {
  const k = EXP.get(key) ?? CURVES.get(key);
  if (!k) return;
  x.coef = key; x.sev = k.sev ?? pickSev(tw, k.want); x.lag = k.kind === "curve" ? 0 : k.lag;
  if (k.kind === "curve") { x.days = k.days ?? x.days; x.version = "central"; }
  if (k.kind === "abs" && x.abs == null) x.abs = k.value ?? null;
  if (k.kind !== "rr" && (x.where.mode === "each" || x.where.mode === "near")) x.where.mode = "all";
}

export const hasRange = (c: Coef) => (c.kind === "curve" ? !!(c.tests && c.tests.length) : c.kind === "rr" && c.lo != null && c.hi != null && c.lo > 0);
export const rangeLabel = (c: Coef) => (c.kind === "curve" ? "range across regions" : "95 % range");
export const bandNote = (c: Coef) => (c.kind === "curve" ? " The band runs from the 10th to the 90th percentile of the regions, day by day." : " The band is the study's 95 % confidence interval, not this network's.");

/** The rise at the source, one value per day of the episode; null when the list is unreadable. */
export function riseSeries(x: Exposure): number[] | null {
  const c = coefOf(x);
  if (c.kind === "curve") return Array.from({ length: c.days ?? 1 }, () => 1);
  if (c.kind === "rr" && x.rise.mode === "series" && x.where.mode !== "each") {
    const nums = String(x.rise.series || "").replace(/(\d),(\d)/g, "$1.$2").split(/[\s;,]+/).filter(Boolean).map(Number);
    return nums.some((n) => !Number.isFinite(n)) ? null : nums;
  }
  return Array.from({ length: Math.max(1, Math.round(x.days) || 1) }, () => Number(x.rise.value) || 0);
}

/** How much of the rise a territory gets: all, none, or a linear fade read at its centre. */
export function territoryFactor(x: Exposure, p: BPop): number {
  const w = x.where;
  if (w.mode === "some") return w.pops.includes(p.id) ? 1 : 0;
  if (w.mode === "near") return p.loc ? Math.max(0, 1 - distanceKm(w.at, p.loc) / w.radius) : 0;
  if (w.mode === "each") return (Number(w.each[p.id]) || 0) !== 0 ? 1 : 0;
  return 1;
}
function riseAt(x: Exposure, p: BPop, d: number, series: number[]): number {
  if (d < 0 || d >= series.length) return 0;
  if (x.where.mode === "each") return Number(x.where.each[p.id]) || 0;
  return series[d]! * territoryFactor(x, p);
}

/** The usual rate, per 1,000 residents per day, whatever unit it was typed in. */
export function base1000(x: Exposure, tw: BuilderTwin): number | null {
  const v = x.base.value;
  if (v == null || !Number.isFinite(v)) return null;
  if (x.base.unit === "year1000") return v / 365;
  if (x.base.unit === "all") return tw.popTotal > 0 ? v / (tw.popTotal / 1000) : null;
  return v;
}

interface Row { p: string; t: number; v: number }

/** Extra arrivals per 1,000 residents, per territory and day of the run, before rounding. */
export function exposureRows(x: Exposure, tw: BuilderTwin, which: "mid" | "lo" | "hi" = "mid"): Row[] {
  const c = coefOf(x), rows: Row[] = [], t0 = x.start + x.lag;
  if (c.kind === "curve") {
    const cv = c.curves!;
    const curve = which === "lo" ? cv.low : which === "hi" ? cv.high : cv[x.version] ?? cv.central;
    for (const p of tw.pops) if (territoryFactor(x, p) > 0) curve.forEach((v, d) => { if (v) rows.push({ p: p.id, t: x.start + d, v: v * x.scale }); });
    return rows;
  }
  if (c.kind === "attack") {
    const v = (1000 * (x.attack.ill / 100) * (x.attack.er / 100)) / Math.max(1, x.attack.spread);
    for (const p of tw.pops) if (territoryFactor(x, p) > 0) for (let d = 0; d < x.attack.spread; d++) rows.push({ p: p.id, t: t0 + d, v });
    return rows;
  }
  const series = riseSeries(x);
  if (!series) return rows;
  if (c.kind === "abs") {
    for (const p of tw.pops) if (territoryFactor(x, p) > 0) for (let d = 0; d < series.length; d++) rows.push({ p: p.id, t: t0 + d, v: x.abs ?? 0 });
    return rows;
  }
  const b = base1000(x, tw), rr = which === "lo" ? c.lo ?? c.rr : which === "hi" ? c.hi ?? c.rr : c.rr, avg = c.avg || 1;
  if (!(b! > 0) || !(rr! > 0) || !(c.per > 0)) return rows;
  for (const p of tw.pops) {
    for (let d = 0; d < series.length + avg - 1; d++) {
      let a = 0;
      for (let k = 0; k < avg; k++) a += riseAt(x, p, d - k, series);
      a /= avg;
      if (a !== 0) rows.push({ p: p.id, t: t0 + d, v: b! * (Math.pow(rr!, a / c.per) - 1) });
    }
  }
  return rows;
}

/** What is sent: demand.incidence effects, one per group of territories and run of equal days. */
export function exposureEffects(x: Exposure, tw: BuilderTwin, ctx: Ctx, which: "mid" | "lo" | "hi" = "mid"): SimEffect[] {
  const rows = exposureRows(x, tw, which)
    .filter((r) => r.t >= 0 && r.t < ctx.horizon)
    .map((r) => ({ ...r, v: Number(r.v.toPrecision(6)) }))
    .filter((r) => r.v !== 0 && Number.isFinite(r.v));
  const runs: { pops: string[]; t0: number; t1: number; v: number }[] = [];
  for (const p of tw.pops) {
    let cur: (typeof runs)[number] | null = null;
    for (const r of rows.filter((q) => q.p === p.id).sort((a, b) => a.t - b.t)) {
      if (cur && r.t === cur.t1 + 1 && r.v === cur.v) cur.t1 = r.t;
      else runs.push((cur = { pops: [p.id], t0: r.t, t1: r.t, v: r.v }));
    }
  }
  const merged = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    const k = `${r.t0}|${r.t1}|${r.v}`;
    if (merged.has(k)) merged.get(k)!.pops.push(...r.pops);
    else merged.set(k, r);
  }
  const kind = coefOf(x).kind === "curve" ? "profile" : "exposure";
  return Array.from(merged.values())
    .sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || b.v - a.v || a.pops[0]!.localeCompare(b.pops[0]!))
    .map((r, k) => {
      const select: SimEffect["select"] = { acuity: [x.sev] };
      // Every territory is said as none named, so a territory added later is not skipped.
      if (r.pops.length < tw.pops.length) select.population = [...r.pops].sort();
      const e: SimEffect = { id: `${x.id}-${k + 1}`, target: "demand.incidence", select, op: "add", value: r.v, profile: { start: r.t0, end: r.t1, shape: "step", peak: 1 } };
      e.builder = k === 0 ? { group: x.id, kind, inputs: exposureInputs(x) } : { group: x.id, kind };
      return e;
    });
}

/** What the builder keeps to reopen the calculation. Never read by the engine. */
export function exposureInputs(x: Exposure): Record<string, unknown> {
  const c = coefOf(x);
  return {
    coef: x.coef, sev: x.sev, lag: x.lag, avg: x.avg, start: x.start, days: x.days, where: x.where,
    ...(c.kind === "rr" ? { rise: x.rise, base: x.base } : {}),
    ...(x.coef === "custom" ? { custom: x.custom } : {}),
    ...(c.kind === "abs" ? { abs: x.abs } : {}),
    ...(c.kind === "attack" ? { attack: x.attack } : {}),
    ...(c.kind === "curve" ? { version: x.version, scale: x.scale } : {}),
  };
}

export const exposureClipped = (x: Exposure, tw: BuilderTwin, ctx: Ctx) => new Set(exposureRows(x, tw).filter((r) => r.t >= ctx.horizon).map((r) => r.t)).size;

/** Extra arrivals per step, every territory together. Not clamped: prevention shows as negative. */
export function exposureSeries(x: Exposure, tw: BuilderTwin, ctx: Ctx, which: "mid" | "lo" | "hi" = "mid"): number[] {
  const out = Array<number>(ctx.horizon).fill(0);
  for (const e of exposureEffects(x, tw, ctx, which)) {
    const size = (e.select.population || tw.pops.map((p) => p.id)).reduce((n, id) => n + (tw.popById.get(id)?.size || 0), 0) / 1000;
    for (let t = e.profile.start; t <= (e.profile.end ?? e.profile.start) && t < ctx.horizon; t++) out[t]! += Number(e.value) * size;
  }
  return out;
}
export function exposureByTerritory(x: Exposure, tw: BuilderTwin, ctx: Ctx, t: number): Record<string, number> {
  const o: Record<string, number> = {};
  for (const e of exposureEffects(x, tw, ctx)) {
    if (t < e.profile.start || t > (e.profile.end ?? e.profile.start)) continue;
    for (const id of e.select.population || tw.pops.map((p) => p.id)) o[id] = (o[id] || 0) + (Number(e.value) * (tw.popById.get(id)?.size || 0)) / 1000;
  }
  return o;
}

/* ---------- saying it ---------- */

function riseX(x: Exposure, c: Coef, ctx: Ctx, tw: BuilderTwin): Said {
  if (x.where.mode === "each") {
    const vals = tw.pops.map((p) => Number(x.where.each[p.id]) || 0).filter((v) => v !== 0);
    if (!vals.length) return { t: "rises by… where?", w: true };
    const top = vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
    return { t: `${top >= 0 ? "rises" : "falls"} by up to ${sig(Math.abs(top))} ${c.unit}, one reading per territory` };
  }
  const s = riseSeries(x);
  if (s === null) return { t: "rises by… (the list is not all numbers)", w: true };
  if (s.every((v) => v === 0)) return { t: "rises by how much?", w: true };
  const at = x.where.mode === "near" ? " at the source" : "";
  if (x.rise.mode === "series") return { t: `rises by ${s.map((v) => sig(v)).join(" · ")} ${c.unit}${at} on successive ${uN(ctx)}` };
  return { t: `${s[0]! >= 0 ? "rises" : "falls"} by ${sig(Math.abs(s[0]!))} ${c.unit}${at}` };
}
function whereX(x: Exposure, tw: BuilderTwin): Said {
  const w = x.where, n = tw.pops.filter((p) => territoryFactor(x, p) > 0).length, terr = `${n} territor${n === 1 ? "y" : "ies"}`;
  if (w.mode === "some") return w.pops.length ? { t: `in ${names(w.pops.map((id) => tw.popById.get(id)?.name ?? id), "territories")}` } : { t: "in which territories?", w: true };
  if (w.mode === "each") return { t: `in ${terr}`, w: !n };
  if (w.mode === "near") return { t: `fading to nothing ${sig(w.radius)} km from ${placeLabel(tw, w.at)} (${terr})`, w: !n };
  return { t: "in every territory" };
}
function whenX(x: Exposure, c: Coef, ctx: Ctx): Said {
  const span = (a: number, b: number) => (a === b ? `${u1(ctx)} ${a}` : `${uN(ctx)} ${a} → ${b}`);
  if (c.kind === "attack") return { t: `contaminated on ${u1(ctx)} ${x.start}, arriving ${span(x.start + x.lag, x.start + x.lag + x.attack.spread - 1)}` };
  const D = (riseSeries(x) || []).length || 1, a = x.start + x.lag, b = x.start + x.lag + D - 1 + ((c.avg || 1) - 1);
  const ep = span(x.start, x.start + D - 1);
  return { t: a === x.start && b === x.start + D - 1 ? ep : `${ep}, felt ${span(a, b)}` };
}
function baseX(x: Exposure, c: Coef, ctx: Ctx): Said {
  const v = x.base.value;
  if (v == null || !Number.isFinite(v)) return { t: `a usual rate of ${c.outcome}… what is it?`, w: true };
  const unit = x.base.unit === "year1000" ? "a year per 1,000 residents" : x.base.unit === "all" ? `a ${u1(ctx)} across every territory` : `a ${u1(ctx)} per 1,000 residents`;
  return { t: `a usual ${sig(v)} ${c.outcome} ${unit}` };
}
export function exposureWhat(c: Coef): string {
  return c.kind === "rr" ? `${c.agent} → ${c.outcome}` : c.kind === "curve" ? `${c.agent} · ${c.short}` : c.kind === "abs" ? "Heat wave → ER arrivals" : "Contaminated water → gastro ER visits";
}

export function sentenceOfExposure(x: Exposure, tw: BuilderTwin, ctx: Ctx): Part[] {
  const c = coefOf(x), P = problemsOfExposure(x, tw, ctx), bad = (k: string) => P.some((p) => p[0] === k);
  const tag = (k: "what" | "where" | "when" | "who" | "rise" | "base", s: Said): Part => ({ chip: k, text: s.t, warn: s.w || bad(k) });
  const what = tag("what", { t: exposureWhat(c) }), where = tag("where", whereX(x, tw)), when = tag("when", whenX(x, c, ctx)), who = tag("who", { t: `arriving as ${x.sev}` });
  if (c.kind === "curve") {
    const total = exposureSeries(x, tw, ctx).reduce((a, b) => a + b, 0);
    return [what, " ", where, ", ", when, ": ", tag("rise", { t: `${x.version} version${x.scale !== 1 ? `, ×${sig(x.scale)}` : ""}` }), `, about **${fmt(total)}** ${c.outcome} over the run, `, who, "."];
  }
  if (c.kind === "abs") return [what, " ", where, ", ", when, ": ", tag("rise", { t: `+${sig(x.abs ?? 0)} a ${u1(ctx)} per 1,000 residents` }), ", ", who, "."];
  if (c.kind === "attack") return [what, " ", where, ", ", when, ": ", tag("rise", { t: `${sig(x.attack.ill)} % fall ill, ${sig(x.attack.er)} % of them come to the ER` }), ", ", who, "."];
  const effs = exposureEffects(x, tw, ctx), top = effs.length ? effs.reduce((a, e) => (Math.abs(Number(e.value)) > Math.abs(a) ? Number(e.value) : a), 0) : null;
  return [what, `: ${c.agent} `, tag("rise", riseX(x, c, ctx, tw)), x.where.mode === "near" ? ", " : " ", where, ", ", when, ". On ", tag("base", baseX(x, c, ctx)),
    `, that is ${top == null ? "…" : `**${top >= 0 ? "+" : "−"}${sig(Math.abs(top))}** per 1,000 a ${u1(ctx)} at the most`}, `, who, "."];
}

/* ---------- what is wrong, and what is worth knowing ---------- */

export function problemsOfExposure(x: Exposure, tw: BuilderTwin, ctx: Ctx): Finding[] {
  const P: Finding[] = [], c = coefOf(x), H = ctx.horizon;
  if (!EXP.has(x.coef) && !CURVES.has(x.coef)) P.push(["what", "uses a coefficient or profile this catalogue no longer has"]);
  if (ctx.unit === "hour" || ctx.unit === "week") P.push(["when", `uses daily figures, but a step is a${ctx.unit === "hour" ? "n" : ""} ${ctx.unit} here: count the run in days`]);
  if (!tw.severities.includes(x.sev)) P.push(["who", `arrives as “${x.sev}”, a severity no care protocol of this twin names`]);
  if (c.kind === "rr") {
    if (!(c.rr! > 0) || !(c.per > 0)) P.push(["what", "needs a relative risk above 0 and the increment it is given per"]);
    const b = x.base.value;
    if (b == null || !Number.isFinite(b)) P.push(["base", `has no usual rate of ${c.outcome}: the coefficient multiplies it, so nothing can be computed without it`]);
    else if (b <= 0) P.push(["base", "has a usual rate of zero, so the coefficient multiplies nothing"]);
    if (x.where.mode === "each") {
      if (!tw.pops.some((p) => territoryFactor(x, p) > 0)) P.push(["where", "has no reading away from usual in any territory"]);
    } else {
      const s = riseSeries(x);
      if (s === null) P.push(["rise", "has a day-by-day list that is not all numbers"]);
      else if (s.every((v) => v === 0)) P.push(["rise", "has no rise: the air is as usual"]);
    }
  }
  if (c.kind === "abs" && !(Number.isFinite(x.abs) && x.abs !== 0)) P.push(["rise", "adds nothing"]);
  if (c.kind === "curve" && !(x.scale > 0)) P.push(["rise", "has a scale of zero or less"]);
  if (c.kind === "attack") {
    if (!(x.attack.ill > 0)) P.push(["rise", "makes nobody ill"]);
    else if (!(x.attack.er > 0)) P.push(["rise", "sends nobody to the ER"]);
    if (x.attack.ill > 100 || x.attack.er > 100) P.push(["rise", "has a share above 100 %"]);
  }
  if (x.where.mode === "some" && !x.where.pops.length) P.push(["where", "is limited to some territories but none is picked"]);
  if (x.where.mode === "near" && !tw.pops.some((p) => territoryFactor(x, p) > 0)) P.push(["where", `reaches no territory: every territory is more than ${sig(x.where.radius)} km away`]);
  if (!tw.pops.length) P.push(["where", "has no territory to arrive in: this twin declares no population"]);
  if (x.start >= H) P.push(["when", `starts on ${u1(ctx)} ${x.start}, after the run ends at ${H}`]);
  else if (!P.length && !exposureEffects(x, tw, ctx).length) P.push(["when", `is only felt after the run ends at ${H}`]);
  return P;
}

export function notesOfExposure(x: Exposure, tw: BuilderTwin, ctx: Ctx): Finding[] {
  const N: Finding[] = [], c = coefOf(x), effs = exposureEffects(x, tw, ctx);
  if (c.kind === "curve") {
    const t = c.tests || [];
    if (t.length) {
      const inside = t.filter((z) => z.inside).length, rs = t.map((z) => z.ratio).filter((v): v is number => v != null).sort((a, b) => a - b);
      N.push(["rise", `Built from ${c.regionsN} regions: the median region each day, with the 10th and 90th percentiles as low and high. Rebuilt without each region and applied to it, the region's real total fell inside the range for ${inside} of ${t.length}, at ${rs[0]} to ${rs[rs.length - 1]} times the central version.`]);
    } else N.push(["rise", "Not tested on another territory: it comes from one series only."]);
    if (c.icu) N.push(["who", "The intensive-care curve is kept for reference and not sent: severities are the ones this twin's care protocols name."]);
    N.push(["where", "Applying a regional rate to a territory assumes it behaves like the regions the profile comes from. Age, immunity and the timing of arrival differ."]);
  }
  if (c.kind === "rr") {
    if (x.coef === "custom") N.push(["what", x.custom.source.trim() ? `Your own coefficient, from “${x.custom.source.trim()}”.` : "Your own coefficient, with no source written down."]);
    else N.push(["what", `×${c.rr} per ${c.per} ${c.unit} was measured in ${c.setting}. Using it here assumes this network's population responds the same way; the 95 % range is the study's.`]);
    if ((c.avg || 1) === 2) N.push(["when", "The study averaged the exposure over the day and the day before, so arrivals start at half strength and last one day longer than the episode."]);
    if (c.lagUnchecked) N.push(["when", "The lag this study used was not checked: set it from the paper."]);
    const s = x.where.mode === "each" ? tw.pops.map((p) => Number(x.where.each[p.id]) || 0) : riseSeries(x) || [];
    const top = Math.max(0, ...s);
    if (c.maxSeen && top > c.maxSeen) N.push(["rise", `A rise of ${sig(top)} ${c.unit} is beyond the highest daily level the study saw (${c.maxSeen}): the result is extrapolated.`]);
    if (x.base.value != null && !x.base.source.trim()) N.push(["base", "The usual rate has no source written down: the result is only as good as that number."]);
    if (c.base === "asthma") N.push(["base", `The rate it multiplies must be the usual ${c.outcome}, not every ER visit.`]);
  }
  if (x.where.mode === "near") N.push(["where", "The fade with distance is an assumption, not a dispersion model, and each territory is read at the mean position of the sites serving it. A reading per territory, from your stations, is better."]);
  if (c.kind === "abs") N.push(["what", "The same figure as the Scenarios heat stamp: the INRS–INSPQ hottest-days ER total for Québec. That half of it needs a stretcher is an assumption."]);
  if (c.kind === "attack") N.push(["rise", "No published figure turns a contamination into arrivals: both shares are yours. For scale, New York (2002–2009) saw about 5 % more diarrhea ER visits per IQR of turbidity, 6 days later, in spring only."]);
  const proto = tw.protocols.find((p) => p.severity === x.sev);
  if (proto && proto.resource) {
    const n = proto.stay != null ? Math.max(1, Math.trunc(proto.stay)) : null;
    N.push(["who", `Each extra arrival is queued as ${x.sev}: it holds one ${proto.resource}${n != null ? ` for ${n} ${n === 1 ? u1(ctx) : uN(ctx)}` : ""}.`]);
  }
  const unsized = tw.pops.filter((p) => territoryFactor(x, p) > 0 && !(p.size > 0));
  if (unsized.length) N.push(["where", `${unsized.length} territor${unsized.length === 1 ? "y has" : "ies have"} no head count, so a rate per 1,000 brings nobody there.`]);
  if (effs.length > 1) N.push(["what", `Sent as ${effs.length} arrival changes: one per group of territories and per run of ${uN(ctx)} with the same rate.`]);
  const cut = exposureClipped(x, tw, ctx);
  if (cut) N.push(["when", `${cut} ${cut === 1 ? u1(ctx) : uN(ctx)} of arrivals fall after the run ends and are left out.`]);
  return N;
}

export function truthOfExposure(x: Exposure, tw: BuilderTwin, ctx: Ctx, problems: Finding[]): Truth {
  if (problems.length) return { ok: false, text: `This change ${problems.map((p) => p[1]).join("; ")}.` };
  const c = coefOf(x), mid = exposureSeries(x, tw, ctx);
  const at = mid.reduce((b, v, t) => (Math.abs(v) > Math.abs(mid[b]!) ? t : b), 0), total = mid.reduce((a, b) => a + b, 0);
  let ci = "";
  if (hasRange(c)) {
    const lo = exposureSeries(x, tw, ctx, "lo"), hi = exposureSeries(x, tw, ctx, "hi");
    ci = ` (${rangeLabel(c)} ${sig(lo[at]!)}–${sig(hi[at]!)})`;
  }
  const n = exposureEffects(x, tw, ctx).length;
  return { ok: true, text: `${mid[at]! >= 0 ? "+" : "−"}${sig(Math.abs(mid[at]!))} arrivals a ${u1(ctx)} at the most (${u1(ctx)} ${at})${ci}, ${fmt(total, 1)} over the run · sent as ${n} arrival change${n === 1 ? "" : "s"}.` };
}

export function lagNote(x: Exposure, c: Coef): string {
  if (x.coef === "custom") return "";
  if (c.src === "zheng") return `published: ${c.lag} ${c.lag === 1 ? "day" : "days"}, the lag most of the studies used for ${c.agent}`;
  if (c.src === "howard") return "published: none, the exposure already spans the day and the day before";
  if (c.lagUnchecked) return "not checked from the paper: set it yourself";
  if (c.kind === "abs") return "published: the same day";
  return "";
}

export function expHint(c: Coef): string {
  if (c.kind === "abs") return `+${c.value} a day per 1,000 · ${SRC[c.src!]!.short}`;
  if (c.kind === "attack") return "your own shares: no published coefficient";
  if (c.key === "custom") return "your relative risk and its source";
  return `×${c.rr} per ${c.per} ${c.unit} · ${SRC[c.src!]!.short}`;
}

export const tidyRise = (v: number) => String(tidy(v));
