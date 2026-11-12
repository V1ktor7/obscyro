/**
 * A change, said in words: the sentence, what would be refused, what is worth
 * knowing, and what it amounts to in the twin's own numbers.
 *
 * One plain change is one SimEffect. The form remembers a little more than the
 * engine needs (`mem`): which way a percentage was meant, that the person chose
 * "some sites" before ticking any. None of it is sent.
 */

import type { SimEffect, SimPropertyDef } from "@/lib/platform-api";
import {
  attenuation, delaySteps, distanceKm, landsAt, magnitudeAt, magnitudeFor, matching, reaches, resolve, valueFor, wants1,
  type LatLon, type PlainObject,
} from "./engine";
import { clamp, fmt, names, sig, tidy, u1, uN, type Ctx } from "./format";
import { readsUnavailable, type BActivity, type BSite, type BType, type BuilderTwin } from "./twin";

export type Fam = "arrivals" | "capacity" | "route" | "object";
export type ChipKey = "what" | "where" | "change" | "who" | "when" | "rise" | "base";
export type Mode = "lower" | "raise" | "add" | "remove" | "set";

export interface FormMemory {
  dir?: Mode;
  scope?: "all" | "sites" | "near";
  pops?: boolean;
  sevs?: boolean;
  reach?: "all" | "share" | "count";
}

/** A sentence, in parts: plain text, or a chip the person can click to edit. */
export type Part = string | { chip: ChipKey; text: string; warn?: boolean };
export interface Said { t: string; w?: boolean }
export type Finding = [ChipKey | "eng", string];

export const TARGET_MIN: Record<string, number | null> = {
  "object.property": null, "resource.capacity": 0, "edge.weight": 0, "demand.incidence": null, "demand.volume": null,
};

export const fam = (e: SimEffect): Fam =>
  e.target.startsWith("demand.") ? "arrivals" : e.target === "resource.capacity" ? "capacity" : e.target === "edge.weight" ? "route" : "object";
export const typeOf = (tw: BuilderTwin, e: SimEffect): BType | undefined => tw.typeByName.get((e.select.object_type || [])[0] ?? "");
export const propOf = (tw: BuilderTwin, e: SimEffect): SimPropertyDef | undefined => typeOf(tw, e)?.props.find((p) => p.key === e.property_key);
export const opsFor = (behaviour: string | null | undefined): SimEffect["op"][] => (behaviour === "state" || behaviour == null ? ["set"] : ["multiply", "add", "set"]);
export const isText = (tw: BuilderTwin, e: SimEffect) => fam(e) === "object" && !!propOf(tw, e) && propOf(tw, e)!.type !== "number";

/** Exactly what is sent: the SimEffect, with nothing the form invented. */
export function wire(e: SimEffect): SimEffect {
  const select: SimEffect["select"] = {};
  for (const [k, v] of Object.entries(e.select)) if (v && v.length) (select as Record<string, string[]>)[k] = v;
  const profile: SimEffect["profile"] = { start: e.profile.start, end: e.profile.end, shape: e.profile.shape, peak: e.profile.peak };
  if (e.profile.peak_tick != null) profile.peak_tick = e.profile.peak_tick;
  const out: SimEffect = { id: e.id, target: e.target, select, op: e.op, value: e.value, profile };
  if (e.target === "object.property") { out.property_key = e.property_key; out.reach = e.reach ?? null; }
  if (e.spatial) out.spatial = e.spatial;
  if (e.builder) out.builder = e.builder;
  return out;
}

/* ---------- amounts, the way people say them ---------- */

export function modeOf(e: SimEffect, mem: FormMemory): Mode {
  if (e.op === "set") return "set";
  const v = Number(e.value);
  if (e.op === "multiply") return v < 1 ? "lower" : v > 1 ? "raise" : mem.dir === "raise" ? "raise" : "lower";
  return v < 0 ? "remove" : v > 0 ? "add" : mem.dir === "remove" ? "remove" : "add";
}
export function amountOf(e: SimEffect): number | string {
  if (e.op === "multiply") return tidy(Math.abs(1 - Number(e.value)) * 100);
  if (e.op === "add") return Math.abs(Number(e.value));
  return e.value;
}
/** A percentage becomes a multiplier; "remove" becomes a negative addition. */
export function setAmount(e: SimEffect, mem: FormMemory, mode: Mode, amount: number) {
  const a = Number.isFinite(amount) ? Math.abs(amount) : 0;
  mem.dir = mode;
  if (mode === "lower") { e.op = "multiply"; e.value = tidy(1 - Math.min(100, a) / 100); }
  else if (mode === "raise") { e.op = "multiply"; e.value = tidy(1 + a / 100); }
  else if (mode === "add") { e.op = "add"; e.value = a; }
  else if (mode === "remove") { e.op = "add"; e.value = a === 0 ? 0 : -a; }
  else { e.op = "set"; e.value = Number.isFinite(amount) ? amount : 0; }
}
export function unitOf(c: Ctx, tw: BuilderTwin, e: SimEffect): string {
  if (e.target === "demand.incidence") return `per 1,000 residents a ${u1(c)}`;
  if (e.target === "demand.volume") return `patients a ${u1(c)}, in each territory`;
  if (fam(e) === "capacity") return "units";
  if (fam(e) === "object") return propOf(tw, e)?.unit || "";
  return "";
}

/* ---------- where ---------- */

export function placeLabel(tw: BuilderTwin, at: LatLon): string {
  let best: BSite | null = null, bd = Infinity;
  for (const s of tw.sites) { const d = distanceKm(at, s.loc); if (d < bd) { bd = d; best = s; } }
  return !best ? `(${at[0].toFixed(3)}, ${at[1].toFixed(3)})` : bd < 0.15 ? best.name : `a point near ${best.name}`;
}
function nearText(c: Ctx, tw: BuilderTwin, e: SimEffect): string {
  const sp = e.spatial!;
  const head = sp.radius_km != null ? `within ${sig(sp.radius_km)} km of ${placeLabel(tw, sp.epicentre)}` : `around ${placeLabel(tw, sp.epicentre)}`;
  return head + (sp.speed_km_per_step && sp.speed_km_per_step > 0 ? `, spreading ${sig(sp.speed_km_per_step)} km a ${u1(c)}` : "");
}
export const scopeOf = (e: SimEffect, mem: FormMemory) => (e.spatial ? "near" : (e.select.facility || []).length ? "sites" : mem.scope === "sites" ? "sites" : "all");

/** Objects the effect could reach before `reach` is applied. */
const poolOf = (tw: BuilderTwin, e: SimEffect) => matching({ ...e, reach: null }, tw.objects).pool;

export function whereText(c: Ctx, tw: BuilderTwin, e: SimEffect, mem: FormMemory): Said {
  const f = fam(e);
  if (f === "arrivals") {
    const ps = e.select.population || [];
    if (!ps.length) return mem.pops ? { t: "which territories?", w: true } : { t: "every territory" };
    return { t: names(ps.map((id) => tw.popById.get(id)?.name ?? id), "territories") };
  }
  const fs = (e.select.facility || []).map((id) => tw.siteById.get(id)?.name ?? id);
  if (f === "capacity") {
    if (e.spatial) return { t: `sites ${nearText(c, tw, e)}` };
    if (!fs.length) return scopeOf(e, mem) === "sites" ? { t: "which sites?", w: true } : { t: "every site" };
    return { t: names(fs, "sites") };
  }
  const T = typeOf(tw, e);
  if (!T) return { t: "objects of a type this twin no longer has", w: true };
  const pool = poolOf(tw, e);
  const many = e.reach == null ? (pool === T.n && !fs.length ? (T.n === 2 ? "both" : `all ${fmt(T.n)}`) : `the ${fmt(pool)}`)
    : e.reach < 1 ? `${sig(e.reach * 100)} % of the ${fmt(pool)}` : `${fmt(Math.trunc(e.reach))} of the ${fmt(pool)}`;
  let t = `${many} \`${T.name}\``;
  if (scopeOf(e, mem) === "sites") { if (!fs.length) return { t: `${t} at which sites?`, w: true }; t += ` at ${names(fs, "sites")}`; }
  if (e.spatial) t += e.reach == null ? ` ${nearText(c, tw, e)}` : `, then only ${nearText(c, tw, e)}`;
  return { t };
}

export function changeText(c: Ctx, tw: BuilderTwin, e: SimEffect, mem: FormMemory): Said {
  const f = fam(e), mode = modeOf(e, mem), a = amountOf(e);
  if (typeof e.value === "string") return e.value.trim() === "" ? { t: "becomes… what?", w: true } : { t: `becomes “${e.value}”` };
  const unit = unitOf(c, tw, e);
  if (f === "arrivals") {
    if (a === 0) return { t: "by how much?", w: true };
    return { t: `${mode === "remove" ? "fall" : "rise"} by ${sig(Number(a))} ${unit}` };
  }
  if (e.op === "multiply") {
    if (e.value === 1) return { t: "by how much?", w: true };
    if (e.value === 0) return { t: "is wiped out (−100 %)" };
    return { t: `${mode === "lower" ? "drops" : "rises"} by ${sig(Number(a))} %` };
  }
  if (e.op === "add") {
    if (a === 0) return { t: "by how much?", w: true };
    return { t: `${mode === "remove" ? "falls" : "rises"} by ${sig(Number(a))}${unit ? " " + unit : ""}` };
  }
  return { t: `is set to ${sig(Number(e.value))}${unit ? " " + unit : ""}` };
}

export function whoText(tw: BuilderTwin, e: SimEffect, mem: FormMemory): Said {
  const c = e.select.acuity || [];
  if (!c.length) {
    if (mem.sevs) return { t: "as which severity?", w: true };
    return { t: tw.severities.length === 1 ? `as ${tw.severities[0]}` : `split evenly between ${names(tw.severities, "severities")}` };
  }
  return { t: c.length === 1 ? `all as ${c[0]}` : `split evenly between ${names(c, "severities")}` };
}

export function whenText(c: Ctx, e: SimEffect): Said {
  const p = e.profile, a = p.start, b = p.end, obj = fam(e) === "object";
  let t: string;
  if (p.shape === "pulse") t = `on ${u1(c)} ${a} only`;
  else if (b == null) t = `from ${u1(c)} ${p.shape === "ramp" ? a + 1 : a} on`;
  else if (obj) t = `${uN(c)} ${p.shape === "ramp" ? a + 1 : a} → ${b}`;
  else if (p.shape === "step") t = `${uN(c)} ${a} → ${b}`;
  else if (p.shape === "ramp") t = `building up over ${uN(c)} ${a} → ${b}`;
  else t = `${uN(c)} ${a} → ${b}, peaking ${u1(c)} ${sig(p.peak_tick != null ? p.peak_tick : (a + b) / 2)}`;
  if (!obj && p.peak < 1 && p.peak > 0) t += ` at ${Math.round(p.peak * 100)} % strength`;
  return { t, w: a >= c.horizon || (b != null && b < a) || !(p.peak > 0) };
}

const chip = (k: ChipKey, s: Said): Part => ({ chip: k, text: s.t, warn: s.w });

export function sentenceOfEffect(c: Ctx, tw: BuilderTwin, e: SimEffect, mem: FormMemory): Part[] {
  const f = fam(e), wh = chip("where", whereText(c, tw, e, mem)), ch = chip("change", changeText(c, tw, e, mem)), wn = chip("when", whenText(c, e));
  if (f === "arrivals") {
    return [chip("what", { t: e.target === "demand.incidence" ? "Arrivals" : "Arrivals, as a flat number," }), " in ", wh, " ", ch, ", ", chip("who", whoText(tw, e, mem)), ", ", wn, "."];
  }
  if (f === "capacity") {
    const acts = e.select.activity || [];
    return [chip("what", { t: acts.length ? `Capacity of \`${acts.join(", ")}\`` : "Capacity of everything" }), " at ", wh, " ", ch, ", ", wn, "."];
  }
  if (f === "route") return [chip("what", { t: "Throughput of a route" }), " ", ch, ", ", wn, "."];
  return [chip("what", { t: `\`${e.property_key}\`` }), " of ", wh, " ", ch, ", ", wn, "."];
}

/* ---------- what would be refused, and what is worth knowing ---------- */

/** Would be refused, or would run and change nothing. Mirrors api.py and event-effects.ts. */
export function problemsOfEffect(c: Ctx, tw: BuilderTwin, e: SimEffect, mem: FormMemory): Finding[] {
  const P: Finding[] = [], p = e.profile, H = c.horizon, f = fam(e);
  if (e.op === "multiply" && e.value === 1) P.push(["change", "changes nothing yet: say by how much"]);
  if (e.op === "add" && e.value === 0) P.push(["change", "adds zero: say how much"]);
  if (typeof e.value === "string" && e.value.trim() === "") P.push(["change", "has no value to switch to"]);
  if (f === "object") {
    const def = propOf(tw, e);
    if (!typeOf(tw, e)) P.push(["what", "names a type this twin no longer has"]);
    else if (!def) P.push(["what", `names a property, ${e.property_key}, that is no longer declared`]);
    if (def && e.op !== "set" && def.behaviour === "state") P.push(["change", `does arithmetic on ${e.property_key}, which is declared a state: it can only be set`]);
    if (def && e.op !== "set" && def.behaviour == null) P.push(["change", `does arithmetic on ${e.property_key}, which has no declared behaviour: declare it, or set the value`]);
    if (e.reach != null && e.reach <= 0) P.push(["where", "reaches no objects"]);
  }
  if ((f === "object" || f === "capacity") && scopeOf(e, mem) === "sites" && !(e.select.facility || []).length) {
    P.push(["where", "is limited to some sites but none is picked; to the engine an empty list means every site"]);
  }
  if (f === "arrivals") {
    if (mem.pops && !(e.select.population || []).length) P.push(["where", "is limited to some territories but none is picked; to the engine an empty list means every territory"]);
    if (mem.sevs && !(e.select.acuity || []).length) P.push(["who", "names no severity; to the engine an empty list means all of them"]);
  }
  if (p.start >= H) P.push(["when", `starts on ${u1(c)} ${p.start}, after the run ends at ${H}`]);
  if (p.end != null && p.end < p.start) P.push(["when", `ends on ${u1(c)} ${p.end}, before it starts on ${u1(c)} ${p.start}`]);
  if (!(p.peak > 0)) P.push(["when", "has a strength of zero, so it never bites"]);
  return P;
}

export interface Reached { s: BSite; units: number; d: number | null; delay: number; att: number; out: boolean; late: boolean; first: number | null }

/** Sites this change can ever touch, with when and how strongly. */
export function siteReach(c: Ctx, tw: BuilderTwin, e: SimEffect): Reached[] {
  const f = fam(e), out: Reached[] = [];
  const acts = f === "capacity" ? ((e.select.activity || []).length ? e.select.activity!.map((a) => tw.activityById.get(a)).filter((a): a is BActivity => !!a) : tw.activities) : [];
  const perSite = new Map<string, number>();
  if (f === "object") for (const o of matching(e, tw.objects).hits) if (o.at) perSite.set(o.at, (perSite.get(o.at) || 0) + 1);
  for (const s of tw.sites) {
    if (!wants1(e, "facility", s.id)) continue;
    const units = f === "capacity" ? acts.reduce((n, a) => n + (s.capacity[a.id] || 0), 0) : perSite.get(s.id) || 0;
    if (!units) continue;
    const r: Reached = { s, units, d: null, delay: 0, att: 1, out: false, late: false, first: null };
    if (e.spatial) {
      r.d = distanceKm(e.spatial.epicentre, s.loc);
      r.out = !reaches(e.spatial, r.d);
      r.delay = delaySteps(e.spatial, r.d);
      r.att = attenuation(e.spatial, r.d);
    }
    // Asked of the engine's own test: the window does not travel with the front.
    for (let t = 0; t < c.horizon && r.first === null; t++) if (landsAt(e, t, s.loc)) r.first = t;
    r.late = !r.out && r.first === null;
    out.push(r);
  }
  return out;
}

export function notesOfEffect(c: Ctx, tw: BuilderTwin, e: SimEffect): Finding[] {
  const N: Finding[] = [], f = fam(e), p = e.profile;
  if (f === "arrivals") {
    const ps = (e.select.population || []).length || tw.pops.length, hit = (e.select.acuity || []).length || tw.severities.length;
    const v = Number(e.value);
    if (e.target === "demand.volume" && ps > 1 && v) N.push(["where", `A flat number applies in each territory: ${sig(Math.abs(v))} × ${ps} = ${sig(Math.abs(v) * ps)} a ${u1(c)} at full strength.`]);
    if (hit > 1 && v) N.push(["who", `The engine splits this evenly across the ${hit} severities. For another mix, write one change per severity.`]);
    if (v < 0) N.push(["change", "Written as prevention. The engine never lets the net arrivals of a territory fall below zero."]);
    const unsized = (e.select.population?.length ? e.select.population.map((id) => tw.popById.get(id)) : tw.pops).filter((q) => q && !(q.size > 0));
    if (e.target === "demand.incidence" && unsized.length) N.push(["where", `${unsized.length} territor${unsized.length === 1 ? "y has" : "ies have"} no head count, so a rate per 1,000 brings nobody there.`]);
  }
  if ((f === "capacity" || f === "object") && e.spatial) {
    const late = siteReach(c, tw, e).filter((r) => r.late);
    if (late.length) N.push(["where", `${late.length} site${late.length === 1 ? " is" : "s are"} reached after the change has ended, so nothing happens there: ${late.slice(0, 3).map((r) => r.s.name).join(", ")}${late.length > 3 ? "…" : ""}. The end does not move with the front.`]);
    if (e.spatial.falloff !== "none" && e.spatial.radius_km == null) N.push(["where", "A fade with no radius is measured against one kilometre: nothing is left beyond 1 km."]);
    if (e.reach != null) N.push(["where", "The share is taken first, across every matching object, then distance keeps those in range. It is not a share of the ones in range."]);
    if (tw.unlocated) N.push(["where", `${tw.unlocated} facilit${tw.unlocated === 1 ? "y has" : "ies have"} no coordinates: distance never reaches ${tw.unlocated === 1 ? "it" : "them"}.`]);
  }
  if (f === "capacity") {
    if (e.op === "set" && p.shape !== "step" && p.shape !== "pulse") N.push(["when", "With “set to”, the value itself follows the curve: at half strength it is set to half."]);
    if (e.op === "add" && Number(e.value) < 0) N.push(["change", "Capacity never goes below zero."]);
  }
  if (f === "object") {
    const def = propOf(tw, e), T = typeOf(tw, e);
    if (e.reach != null) N.push(["where", "The engine takes the first ones by id: the same objects on every run, not a random draw."]);
    if (T && typeof e.value === "string" && e.value.trim() !== "" && T.role) {
      if (!tw.rules.unavailable_keys.includes(e.property_key ?? "")) N.push(["what", `The twin does not read availability from “${e.property_key}” (it reads ${tw.rules.unavailable_keys.join(", ")}), so capacity will not move.`]);
      else if (!readsUnavailable(tw, e.property_key ?? "", e.value)) N.push(["change", `“${e.value}” is not a value the twin reads as out of service, so these still count as free. It reads: ${tw.rules.unavailable_values.join(", ")}.`]);
    }
    if (def?.mechanic === "occupies_for" && typeof e.value === "number") N.push(["change", "The engine reads a stay in whole steps, at least 1: a result of 9.1 is read as 9."]);
    if (p.shape === "ramp" || p.shape === "gaussian") N.push(["when", "An object is switched or it is not: the curve only decides when."]);
  }
  if (f !== "object" && p.shape === "ramp" && p.end != null) N.push(["when", `A build-up reaches full strength on ${u1(c)} ${p.end} and stops at once. Add a steady change after it to hold the level.`]);
  return N;
}

/* ---------- what it amounts to ---------- */

export const capacityAt = (s: BSite, act: BActivity, t: number, effects: SimEffect[]) =>
  resolve("resource.capacity", s.capacity[act.id] || 0, { facility: s.id, category: act.category, activity: act.id }, s.loc, t, effects, 0);

/** dynamics.py: Engine._apply_objects. Which matched objects are written at step t. */
export function objectsAt(tw: BuilderTwin, e: SimEffect, hits: PlainObject[], t: number): PlainObject[] {
  if (magnitudeAt(e.profile, t) <= 0) return [];
  if (!e.spatial) return hits;
  return hits.filter((o) => o.at && tw.siteById.has(o.at) && magnitudeFor(e, t, tw.siteById.get(o.at)!.loc) > 0);
}

/** objects.py: apply_property and PropertyDef.clamp, for one value. */
export function writtenValue(e: SimEffect, def: SimPropertyDef | undefined, baseline: unknown): unknown {
  let out: unknown = e.op === "set" ? e.value : e.op === "multiply" ? Number(baseline) * Number(e.value) : Number(baseline) + Number(e.value);
  if (typeof out === "number" && def) {
    if (def.min != null) out = Math.max(def.min, out as number);
    if (def.max != null) out = Math.min(def.max, out as number);
  }
  return out;
}

export interface Truth { ok: boolean; text: string }

export function truthOfEffect(c: Ctx, tw: BuilderTwin, e: SimEffect, mem: FormMemory, problems: Finding[]): Truth {
  if (problems.length) return { ok: false, text: `This change ${problems.map((x) => x[1]).join("; ")}.` };
  const f = fam(e), H = c.horizon;
  if (f === "arrivals") {
    const pops = (e.select.population || []).length ? e.select.population!.map((id) => tw.popById.get(id)!).filter(Boolean) : tw.pops;
    let peak = 0, at = 0, total = 0;
    for (let t = 0; t < H; t++) {
      const v0 = valueFor({ ...e, spatial: null }, t, null);
      if (v0 === null) continue;
      const v = e.target === "demand.incidence" ? pops.reduce((n, q) => n + (v0 * q.size) / 1000, 0) : v0 * pops.length;
      total += v;
      if (Math.abs(v) > Math.abs(peak)) { peak = v; at = t; }
    }
    if (peak < 0) return { ok: true, text: `Removes up to ${sig(-peak)} arrivals a ${u1(c)} from whatever the other changes bring.` };
    return { ok: true, text: `${sig(peak)} arrivals a ${u1(c)} at the peak (${u1(c)} ${at}) · ${fmt(total)} over the ${H} ${uN(c)}.` };
  }
  const R = siteReach(c, tw, e).filter((r) => !r.out && !r.late);
  if (f === "capacity") {
    const acts = (e.select.activity || []).length ? e.select.activity!.map((a) => tw.activityById.get(a)).filter((a): a is BActivity => !!a) : tw.activities;
    const parts = acts.map((a) => {
      const sites = R.filter((r) => (r.s.capacity[a.id] || 0) > 0);
      if (!sites.length) return null;
      const base = sites.reduce((n, r) => n + (r.s.capacity[a.id] || 0), 0);
      let ext = base, at = 0;
      for (let t = 0; t < H; t++) { const v = sites.reduce((n, r) => n + capacityAt(r.s, a, t, [e]), 0); if (Math.abs(v - base) > Math.abs(ext - base)) { ext = v; at = t; } }
      return `${fmt(base)} → ${fmt(ext, 1)} \`${a.id}\` at ${sites.length} site${sites.length === 1 ? "" : "s"} (${u1(c)} ${at})`;
    }).filter(Boolean);
    return parts.length ? { ok: true, text: `${parts.join(" · ")}.` } : { ok: false, text: "No site in range holds this resource, so nothing changes." };
  }
  if (f === "route") return { ok: true, text: "Changes the throughput of the routes it names." };
  const T = typeOf(tw, e)!, def = propOf(tw, e), m = matching(e, tw.objects);
  if (!T.placed) {
    const rows = m.hits.map((o) => {
      const before = o.properties[e.property_key ?? ""], after = typeof before === "number" || e.op === "set" ? writtenValue(e, def, before) : before;
      return `${o.id.slice(0, 8)}: ${say(before)} → ${say(after)}`;
    });
    return { ok: true, text: `${rows.slice(0, 4).join(" · ")}${rows.length > 4 ? ` · and ${rows.length - 4} more` : ""}.` };
  }
  let most = 0, touched: PlainObject[] = [];
  for (let t = 0; t < H; t++) { const o = objectsAt(tw, e, m.hits, t); if (o.length > most) { most = o.length; touched = o; } }
  const sites = new Set(R.map((r) => r.s.id)).size;
  let verdict = "";
  if (typeof e.value === "string" && tw.rules.unavailable_keys.includes(e.property_key ?? "")) {
    const wasFree = touched.filter((o) => !readsUnavailable(tw, e.property_key!, o.properties[e.property_key!])).length;
    verdict = readsUnavailable(tw, e.property_key!, e.value)
      ? ` · ${fmt(wasFree)} were free, ${fmt(touched.length - wasFree)} were already in use: ${fmt(wasFree)} fewer free`
      : ` · ${fmt(touched.length - wasFree)} were in use and count as free again`;
  }
  return { ok: true, text: `Writes ${fmt(most)} of ${fmt(T.n)} \`${T.name}\` at ${sites} site${sites === 1 ? "" : "s"}${verdict}.` };
}
export const say = (v: unknown) => (typeof v === "number" ? sig(v) : `“${String(v)}”`);

/* ---------- making one ---------- */

export function freshId(taken: Iterable<string>, stem: string): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

export const defaultProfile = (c: Ctx): SimEffect["profile"] => ({ start: Math.round(c.horizon / 6), end: Math.round(c.horizon / 2), shape: "step", peak: 1 });

/** A new change is valid and inert: it does nothing until it is given a number. */
export function newEffect(c: Ctx, tw: BuilderTwin, taken: Iterable<string>, kind: "incidence" | "volume" | "capacity" | "object", arg?: string | [string, string]): SimEffect {
  if (kind === "incidence" || kind === "volume") {
    return { id: freshId(taken, "arrivals"), target: kind === "incidence" ? "demand.incidence" : "demand.volume", select: {}, op: "add", value: 0, profile: { ...defaultProfile(c), shape: "gaussian" } };
  }
  if (kind === "capacity") {
    const a = typeof arg === "string" && arg ? arg : "";
    return { id: freshId(taken, a ? `capacity-${a}` : "capacity"), target: "resource.capacity", select: a ? { activity: [a] } : {}, op: "multiply", value: 1, profile: defaultProfile(c) };
  }
  const [typeName, key] = arg as [string, string];
  const def = tw.typeByName.get(typeName)?.props.find((p) => p.key === key);
  const arithmetic = opsFor(def?.behaviour).includes("multiply");
  return {
    id: freshId(taken, `${key}-${typeName.toLowerCase()}`), target: "object.property", select: { object_type: [typeName] }, property_key: key,
    op: arithmetic ? "multiply" : "set", value: arithmetic ? 1 : def?.type === "number" ? 0 : "", reach: null, profile: defaultProfile(c),
  };
}

/** The largest site, a sensible default point for anything placed on the map. */
export function defaultPoint(tw: BuilderTwin): LatLon {
  const s = tw.sites.reduce<BSite | null>((a, b) => {
    const cap = (x: BSite) => Object.values(x.capacity).reduce((n, v) => n + v, 0);
    return !a || cap(b) > cap(a) ? b : a;
  }, null);
  return s ? s.loc : [46.8, -71.2];
}

/** Clamp a day to the run. */
export const inRun = (c: Ctx, t: number) => clamp(t, 0, c.horizon - 1);
