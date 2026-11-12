/**
 * What the builder holds: a list of changes. A change is either one plain
 * effect, or a helper (an exposure, a profile) that produces several. Both
 * read the same way on screen; only the second needs its inputs kept, which
 * travel on its first effect (`builder.inputs`) and are ignored by the engine.
 */

import type { SimEffect } from "@/lib/platform-api";
import {
  coefOf, CURVES, EXP, exposureEffects, exposureWhat, newExposure, notesOfExposure, problemsOfExposure, riseSeries, sentenceOfExposure, truthOfExposure,
  type Exposure,
} from "./exposures";
import { type Ctx, u1 } from "./format";
import {
  fam, notesOfEffect, problemsOfEffect, sentenceOfEffect, truthOfEffect, typeOf, wire,
  type ChipKey, type Finding, type FormMemory, type Part, type Truth,
} from "./model";
import type { BuilderTwin } from "./twin";

export type Item =
  | { kind: "effect"; key: string; e: SimEffect; mem: FormMemory }
  | { kind: "exposure"; key: string; x: Exposure };

let keySeq = 0;
export const nextKey = () => `k${++keySeq}`;

export const itemId = (it: Item) => (it.kind === "effect" ? it.e.id : it.x.id);

/** Every id the event uses, helpers' generated ones included: two changes must never share one. */
export function takenIds(items: Item[], tw: BuilderTwin, ctx: Ctx): string[] {
  return items.flatMap((it) => (it.kind === "effect" ? [it.e.id] : [it.x.id, ...exposureEffects(it.x, tw, ctx).map((e) => e.id)]));
}

export const effectsOf = (it: Item, tw: BuilderTwin, ctx: Ctx): SimEffect[] => (it.kind === "effect" ? [wire(it.e)] : exposureEffects(it.x, tw, ctx));
export const allEffects = (items: Item[], tw: BuilderTwin, ctx: Ctx) => items.flatMap((it) => effectsOf(it, tw, ctx));

export const sentenceOf = (it: Item, tw: BuilderTwin, ctx: Ctx): Part[] =>
  it.kind === "effect" ? sentenceOfEffect(ctx, tw, it.e, it.mem) : sentenceOfExposure(it.x, tw, ctx);
export const problemsOf = (it: Item, tw: BuilderTwin, ctx: Ctx): Finding[] =>
  it.kind === "effect" ? problemsOfEffect(ctx, tw, it.e, it.mem) : problemsOfExposure(it.x, tw, ctx);
export const notesOf = (it: Item, tw: BuilderTwin, ctx: Ctx): Finding[] =>
  it.kind === "effect" ? notesOfEffect(ctx, tw, it.e) : notesOfExposure(it.x, tw, ctx);
export const truthOf = (it: Item, tw: BuilderTwin, ctx: Ctx): Truth => {
  const P = problemsOf(it, tw, ctx);
  return it.kind === "effect" ? truthOfEffect(ctx, tw, it.e, it.mem, P) : truthOfExposure(it.x, tw, ctx, P);
};

/** The days a change covers, for the timeline. */
export function itemWindow(it: Item): [number, number] {
  if (it.kind === "exposure") {
    const x = it.x, c = coefOf(x);
    if (c.kind === "attack") return [x.start, x.start + x.lag + x.attack.spread - 1];
    const D = (riseSeries(x) || []).length || 1;
    return [x.start, x.start + x.lag + D - 1 + ((c.avg || 1) - 1)];
  }
  const p = it.e.profile;
  return [p.start, p.shape === "pulse" ? p.start : p.end == null ? p.start + 30 : p.end];
}

export function itemLabel(it: Item, tw: BuilderTwin): string {
  if (it.kind === "exposure") return exposureWhat(coefOf(it.x));
  const e = it.e, f = fam(e);
  if (f === "arrivals") return "Arrivals";
  if (f === "capacity") return `Capacity${(e.select.activity || []).length ? " · " + e.select.activity![0] : ""}`;
  if (f === "route") return "Route throughput";
  return `${e.property_key} · ${typeOf(tw, e)?.name ?? (e.select.object_type || [])[0] ?? "?"}`;
}

export interface Check { i: number | null; k?: ChipKey | "eng"; t: string }

/** Everything that would stop a run, then everything worth knowing about how the engine will read it. */
export function eventChecks(items: Item[], tw: BuilderTwin, ctx: Ctx, name: string): { fix: Check[]; note: Check[] } {
  const fix: Check[] = [], note: Check[] = [];
  if (!name.trim()) fix.push({ i: null, t: "Name the event." });
  if (!items.length) fix.push({ i: null, t: `This event has no changes, so it is indistinguishable from a normal ${u1(ctx)}.` });
  const seen = new Map<string, number>();
  items.forEach((it, i) => {
    const ids = it.kind === "effect" ? [it.e.id] : [it.x.id, ...exposureEffects(it.x, tw, ctx).map((e) => e.id)];
    for (const id of ids) {
      if (seen.has(id)) fix.push({ i, k: "eng", t: `Two changes are both called “${id}”. The name appears in the trace as the reason something happened, so it has to be distinct.` });
      seen.set(id, i);
    }
    for (const [k, t] of problemsOf(it, tw, ctx)) fix.push({ i, k: k as ChipKey, t: `This change ${t}.` });
    for (const [k, t] of notesOf(it, tw, ctx)) note.push({ i, k: k as ChipKey, t });
  });
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i]!, B = items[j]!;
    if (A.kind !== "effect" || B.kind !== "effect") continue;
    const a = A.e, b = B.e;
    if (a.target !== b.target || (a.property_key || "") !== (b.property_key || "")) continue;
    if (!windowsOverlap(a, b) || !selectionsIntersect(a, b)) continue;
    const later = a.id < b.id ? b : a, earlier = later === a ? b : a;
    if (a.op === "set" && b.op === "set" && a.value !== b.value) {
      fix.push({ i: j, k: "change", t: `“${a.id}” and “${b.id}” both set the same thing at the same time, to ${a.value} and ${b.value}. The engine keeps “${later.id}” (the last by name) and discards the other.` });
    } else if (a.target === "object.property") {
      note.push({ i: j, k: "change", t: `“${earlier.id}” and “${later.id}” touch the same property of the same objects at the same time. On an object the engine applies each from the original value, so only “${later.id}” counts while they overlap.` });
    }
  }
  if (items.length && !allEffects(items, tw, ctx).some((e) => fam(e) === "arrivals" && Number(e.value) > 0)) {
    note.push({ i: null, t: "No change brings patients. The engine has no background arrivals: a run would only contain the people already in a bed, and every response would score the same." });
  }
  return { fix, note };
}
function windowsOverlap(a: SimEffect, b: SimEffect) {
  const end = (e: SimEffect) => (e.profile.end == null ? Infinity : e.profile.shape === "pulse" ? e.profile.start : e.profile.end);
  return a.profile.start <= end(b) && b.profile.start <= end(a);
}
const SELECTOR: Record<string, string[]> = {
  "object.property": ["object_type", "facility"], "resource.capacity": ["facility", "category", "activity"], "edge.weight": ["route"],
  "demand.incidence": ["population", "acuity"], "demand.volume": ["population", "acuity"],
};
function selectionsIntersect(a: SimEffect, b: SimEffect) {
  for (const d of SELECTOR[a.target] ?? []) {
    const l = (a.select as Record<string, string[] | undefined>)[d] || [], r = (b.select as Record<string, string[] | undefined>)[d] || [];
    if (l.length && r.length && !l.some((v) => r.includes(v))) return false;
  }
  return true;
}

/* ---------- saved events, both ways ---------- */

export const toEffects = (items: Item[], tw: BuilderTwin, ctx: Ctx) => allEffects(items, tw, ctx);

/**
 * A saved event back into changes. A helper's effects are grouped again by
 * their `builder.group` and rebuilt from the inputs on the first one; when
 * those inputs are missing, or name a coefficient this build does not have,
 * the effects come back as plain changes rather than being dropped.
 */
export function toItems(effects: SimEffect[], tw: BuilderTwin, ctx: Ctx): Item[] {
  const out: Item[] = [];
  const groups = new Map<string, SimEffect[]>();
  for (const e of effects) {
    const g = e.builder?.group;
    if (g) { if (!groups.has(g)) { groups.set(g, []); out.push({ kind: "exposure", key: g, x: null as unknown as Exposure }); } groups.get(g)!.push(e); }
    else out.push(plainItem(e));
  }
  return out.flatMap((it) => {
    if (it.kind !== "exposure" || it.x) return [it];
    const es = groups.get(it.key)!, inputs = es.find((e) => e.builder?.inputs)?.builder?.inputs;
    const coef = inputs && typeof inputs.coef === "string" ? inputs.coef : null;
    if (!coef || (!EXP.has(coef) && !CURVES.has(coef))) return es.map(plainItem);
    const x = newExposure(ctx, tw, [], coef);
    Object.assign(x, inputs, { id: it.key });
    return [{ kind: "exposure" as const, key: nextKey(), x }];
  });
}
function plainItem(e: SimEffect): Item {
  const copy: SimEffect = JSON.parse(JSON.stringify(e));
  delete copy.builder;
  const mem: FormMemory = {};
  if (copy.spatial) mem.scope = "near";
  else if ((copy.select.facility || []).length) mem.scope = "sites";
  if ((copy.select.population || []).length) mem.pops = true;
  if ((copy.select.acuity || []).length) mem.sevs = true;
  if (copy.reach != null) mem.reach = copy.reach < 1 ? "share" : "count";
  return { kind: "effect", key: nextKey(), e: copy, mem };
}
