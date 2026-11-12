/**
 * What "Where it lands" draws for one change on one day, computed apart from
 * the map so it can be tested and so the map only paints.
 *
 * Sites and territories are the twin's own, wherever they are: the map fits
 * their extent, so a network spread over all of Québec is shown whole.
 */

import { arrivalsAt, magnitudeFor, matching, type LatLon } from "./engine";
import { exposureByTerritory, riseSeries, territoryFactor, coefOf } from "./exposures";
import { fmt, sig, u1, type Ctx } from "./format";
import type { Item } from "./items";
import { capacityAt, fam, objectsAt, scopeOf, siteReach, typeOf } from "./model";
import type { BActivity, BuilderTwin } from "./twin";

export interface Dot { id: string; lat: number; lon: number; r: number; fill: string; opacity: number; stroke: string; strokeWidth: number; dashed: boolean; info: string }
export interface MapPicture {
  sites: Dot[];
  pops: Dot[];
  ring: { at: LatLon; km: number } | null;
  front: { at: LatLon; km: number } | null;
  centre: LatLon | null;
  legend: [string, string, ("ring" | "dot" | "line")][];
  /** What a click on the map does while the "where" editor is open. */
  pick: "sites" | "pops" | "point" | null;
  hint: string | null;
}

const GREY = "#8f99a8", GHOST = "#c5cbd3";
const siteR = (cap: number) => 3 + Math.sqrt(cap) / 6;
const capOf = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0);

function quietSites(tw: BuilderTwin): Dot[] {
  return tw.sites.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, r: siteR(capOf(s.capacity)), fill: "#ffffff", opacity: 1, stroke: GREY, strokeWidth: 1, dashed: false, info: baseInfo(s.name, s.capacity) }));
}
function baseInfo(name: string, cap: Record<string, number>): string {
  const parts = Object.entries(cap).filter(([, v]) => v > 0).map(([k, v]) => `${fmt(v)} ${k}`);
  return `**${name}**\n${parts.join(" · ") || "no capacity declared"}`;
}

export function mapPicture(it: Item | null, tw: BuilderTwin, ctx: Ctx, day: number, editingWhere: boolean, fg: string): MapPicture {
  const pic: MapPicture = { sites: quietSites(tw), pops: [], ring: null, front: null, centre: null, legend: [[GREY, "a site of the twin", "dot"]], pick: null, hint: null };
  if (!it) return pic;

  if (it.kind === "exposure") {
    const x = it.x, c = coefOf(x), series = riseSeries(x) || [];
    let top = 0;
    for (let t = 0; t < ctx.horizon; t++) for (const v of Object.values(exposureByTerritory(x, tw, ctx, t))) top = Math.max(top, Math.abs(v));
    const now = exposureByTerritory(x, tw, ctx, day);
    pic.pops = tw.pops.filter((p) => p.loc).map((p) => {
      const v = now[p.id] || 0, on = territoryFactor(x, p) > 0;
      const rise = c.kind !== "rr" ? null : x.where.mode === "each" ? Number(x.where.each[p.id]) || 0 : Math.max(0, ...series.map((r) => r * territoryFactor(x, p)));
      const chain = rise ? `${c.agent} up to ${rise >= 0 ? "+" : "−"}${sig(Math.abs(rise))} ${c.unit}${c.rr && c.per ? `: ×${sig(Math.pow(c.rr, rise / c.per))} the usual rate` : ""}\n` : "";
      return { id: p.id, lat: p.loc![0], lon: p.loc![1], r: 6 + Math.sqrt(p.size) / 40, fill: fg, opacity: on ? 0.08 + 0.62 * (top ? Math.abs(v) / top : 0) : 0,
        stroke: on ? fg : GHOST, strokeWidth: 1.2, dashed: !on,
        info: `**${p.name}**\n${fmt(p.size)} residents\n${on ? `${chain}${v ? `${v < 0 ? "−" : "+"}${sig(Math.abs(v))}` : "no"} extra arrivals on ${u1(ctx)} ${day}` : "not exposed"}` };
    });
    if (x.where.mode === "near") { pic.ring = { at: x.where.at, km: x.where.radius }; pic.centre = x.where.at; }
    pic.legend = [[fg, `a territory, darker with more extra arrivals on ${u1(ctx)} ${day}`, "dot"], ...(x.where.mode === "near" ? [[fg, "where the rise fades to nothing", "ring"] as [string, string, "ring"]] : [])];
    if (editingWhere) { pic.pick = x.where.mode === "some" ? "pops" : x.where.mode === "near" ? "point" : null; pic.hint = pic.pick === "pops" ? "Click a territory to add or remove it." : pic.pick === "point" ? "Click the map to move the source." : null; }
    return pic;
  }

  const e = it.e, f = fam(e);
  if (f === "arrivals") {
    const now = new Map<string, number>();
    for (const [k, v] of Array.from(arrivalsAt(day, [e], tw.pops, tw.severities))) { const p = k.split("|")[0]!; now.set(p, (now.get(p) || 0) + v); }
    let top = 0;
    for (let t = 0; t < ctx.horizon; t++) {
      const sums = new Map<string, number>();
      for (const [k, v] of Array.from(arrivalsAt(t, [e], tw.pops, tw.severities))) { const p = k.split("|")[0]!; sums.set(p, (sums.get(p) || 0) + v); }
      for (const v of Array.from(sums.values())) top = Math.max(top, v);
    }
    pic.pops = tw.pops.filter((p) => p.loc).map((p) => {
      const on = !(e.select.population || []).length || e.select.population!.includes(p.id), v = now.get(p.id) || 0;
      return { id: p.id, lat: p.loc![0], lon: p.loc![1], r: 6 + Math.sqrt(p.size) / 40, fill: fg, opacity: on ? 0.1 + 0.6 * (top ? v / top : 0) : 0,
        stroke: on ? fg : GHOST, strokeWidth: 1.2, dashed: !on, info: `**${p.name}**\n${fmt(p.size)} residents\n${on ? `${sig(v)} arrivals on ${u1(ctx)} ${day} from this change` : "not in this change"}` };
    });
    pic.legend = [[fg, `a territory, darker with more arrivals on ${u1(ctx)} ${day}`, "dot"], [GREY, "a site", "dot"]];
    if (editingWhere) { pic.pick = "pops"; pic.hint = "Click a territory to add or remove it."; }
    return pic;
  }

  const R = new Map(siteReach(ctx, tw, e).map((r) => [r.s.id, r]));
  const m = f === "object" ? matching(e, tw.objects) : null;
  const hitNow = new Map<string, number>();
  if (m) for (const o of objectsAt(tw, e, m.hits, day)) if (o.at) hitNow.set(o.at, (hitNow.get(o.at) || 0) + 1);
  const acts: BActivity[] = f === "capacity" ? ((e.select.activity || []).length ? e.select.activity!.map((a) => tw.activityById.get(a)).filter((a): a is BActivity => !!a) : tw.activities) : [];
  const T = f === "object" ? typeOf(tw, e) : undefined;
  pic.sites = tw.sites.map((s) => {
    const r = R.get(s.id);
    let frac = 0, line = "not in this change";
    if (r) {
      if (r.out) line = `outside the radius (${sig(r.d!)} km away)`;
      else if (r.late) line = e.spatial ? `never reached: the front arrives on ${u1(ctx)} ${e.profile.start + r.delay}, after the change has ended` : "never touched within the run";
      else {
        if (f === "capacity") {
          const b0 = acts.reduce((n, a) => n + (s.capacity[a.id] || 0), 0), b1 = acts.reduce((n, a) => n + capacityAt(s, a, day, [e]), 0);
          frac = b0 ? Math.min(1, Math.abs(b1 - b0) / b0) : 0;
          line = `${fmt(b0)} → ${fmt(b1, 1)} on ${u1(ctx)} ${day}`;
        } else if (T) {
          const n = hitNow.get(s.id) || 0, tot = (tw.objectsByType.get(T.name) ?? []).filter((o) => o.at === s.id).length;
          frac = tot ? n / tot : 0;
          line = `${n} of ${tot} written on ${u1(ctx)} ${day}`;
        }
        if (e.spatial) line += `\n${sig(r.d!)} km away${r.delay ? `, reached on ${u1(ctx)} ${r.first}` : ""}${e.spatial.falloff !== "none" && f === "capacity" ? ` · ${Math.round(r.att * 100)} % of the strength` : ""}`;
      }
    }
    const inScope = !!r && !r.out && !r.late;
    return { id: s.id, lat: s.lat, lon: s.lon, r: siteR(capOf(s.capacity)), fill: inScope ? fg : "#ffffff", opacity: inScope ? 0.15 + 0.85 * frac : 1,
      stroke: inScope ? fg : r ? GREY : GHOST, strokeWidth: inScope ? 1.6 : 1, dashed: !!r && !inScope, info: `${baseInfo(s.name, s.capacity)}\n${line}` };
  });
  if (e.spatial) {
    pic.centre = e.spatial.epicentre;
    if (e.spatial.radius_km != null) pic.ring = { at: e.spatial.epicentre, km: e.spatial.radius_km };
    const sp = e.spatial;
    if (sp.speed_km_per_step && sp.speed_km_per_step > 0 && day >= e.profile.start && magnitudeFor({ ...e, spatial: null }, day, null) > 0) {
      const front = sp.speed_km_per_step * (day - e.profile.start + 1);
      pic.front = { at: sp.epicentre, km: sp.radius_km != null ? Math.min(front, sp.radius_km) : front };
    }
  }
  pic.legend = [[fg, `a site, darker the more of it is affected on ${u1(ctx)} ${day}`, "dot"],
    ...(e.spatial ? [[fg, `how far it reaches${e.spatial.speed_km_per_step ? "; the solid ring is the front" : ""}`, "ring"] as [string, string, "ring"]] : [])];
  if (editingWhere) {
    const sc = scopeOf(e, it.mem);
    pic.pick = sc === "sites" ? "sites" : sc === "near" ? "point" : null;
    pic.hint = pic.pick === "sites" ? "Click a site to add or remove it." : pic.pick === "point" ? "Click the map to move the starting point." : null;
  }
  return pic;
}

/** A circle on the ground as a polygon, for the radius and the front. */
export function ringPolygon(at: LatLon, km: number, n = 72): [number, number][] {
  const out: [number, number][] = [];
  const lat1 = (at[0] * Math.PI) / 180, lon1 = (at[1] * Math.PI) / 180, d = km / 6371.0088;
  for (let i = 0; i <= n; i++) {
    const brg = (2 * Math.PI * i) / n;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    out.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return out;
}
