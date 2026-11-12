/**
 * The twin, as the builder reads it.
 *
 * Built once from the export the engine receives (`SimExport`), so the builder
 * shows the network the run will use and nothing else: every site with
 * coordinates wherever it is in Québec, every territory with its head count,
 * the types and properties the institution declared, the severities its care
 * protocols name. Nothing in this file knows a hospital, a bed or a city.
 */

import type { SimExport, SimObjectInstance, SimPropertyDef, SimRole } from "@/lib/platform-api";
import { vocabularyOf } from "../rail";
import type { LatLon, PlainObject } from "./engine";

export interface BSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  loc: LatLon;
  /** Capacity per activity, summed over the resources that enable it. */
  capacity: Record<string, number>;
}

export interface BPop {
  id: string;
  name: string;
  size: number;
  servedBy: string[];
  /** Mean position of the sites serving it; null when none of them is located. */
  loc: LatLon | null;
}

export interface BType {
  name: string;
  role: SimRole | null;
  props: SimPropertyDef[];
  /** Instances in the twin. */
  n: number;
  /** Whether its instances hang off sites (and so can be reached by place). */
  placed: boolean;
}

export interface BActivity {
  id: string;
  category: string;
  total: number;
  sites: number;
}

export interface BProtocol {
  severity: string;
  /** The activity it draws on. */
  resource: string | null;
  /** Steps one unit of demand holds it, as declared (the engine reads whole steps). */
  stay: number | null;
}

export interface BuilderTwin {
  sites: BSite[];
  siteById: Map<string, BSite>;
  /** Facilities the export carries with no coordinates: reachable by name, never by distance. */
  unlocated: number;
  pops: BPop[];
  popById: Map<string, BPop>;
  popTotal: number;
  types: BType[];
  typeByName: Map<string, BType>;
  objects: PlainObject[];
  objectsByType: Map<string, PlainObject[]>;
  activities: BActivity[];
  activityById: Map<string, BActivity>;
  severities: string[];
  protocols: BProtocol[];
  rules: { unavailable_keys: string[]; unavailable_values: string[] };
  /** Bounds of everything located, for the map. */
  bounds: [LatLon, LatLon] | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function builderTwin(ex: SimExport): BuilderTwin {
  const sites: BSite[] = [];
  let unlocated = 0;
  const acts = new Map<string, BActivity>();
  for (const f of ex.facilities) {
    const capacity: Record<string, number> = {};
    for (const r of Object.values(f.resources)) {
      for (const a of r.enables) {
        capacity[a] = (capacity[a] ?? 0) + (Number(r.capacity) || 0);
        const act = acts.get(a) ?? { id: a, category: r.category, total: 0, sites: 0 };
        act.total += Number(r.capacity) || 0;
        acts.set(a, act);
      }
    }
    for (const a of Object.keys(capacity)) if (capacity[a]! > 0) acts.get(a)!.sites++;
    if (!f.location) { unlocated++; continue; }
    sites.push({ id: f.id, name: f.name, lat: f.location[0], lon: f.location[1], loc: [f.location[0], f.location[1]], capacity });
  }
  const siteById = new Map(sites.map((s) => [s.id, s]));

  const pops: BPop[] = ex.populations.map((p) => {
    const located = p.served_by.map((id) => siteById.get(id)).filter((s): s is BSite => !!s);
    const loc: LatLon | null = located.length
      ? [located.reduce((a, s) => a + s.lat, 0) / located.length, located.reduce((a, s) => a + s.lon, 0) / located.length]
      : null;
    return { id: p.id, name: p.name || p.id, size: p.size || 0, servedBy: p.served_by, loc };
  });

  const objects: PlainObject[] = (ex.objects ?? []).map((o: SimObjectInstance) => ({ id: o.id, type: o.type, at: o.at, properties: o.properties ?? {} }));
  const objectsByType = new Map<string, PlainObject[]>();
  for (const o of objects) objectsByType.set(o.type, [...(objectsByType.get(o.type) ?? []), o]);

  const types: BType[] = (ex.object_types ?? []).map((t) => {
    const mine = objectsByType.get(t.name) ?? [];
    return { name: t.name, role: t.role, props: t.properties, n: mine.length, placed: mine.some((o) => o.at != null) };
  });

  // Care protocols: whatever binds serves_severity, read through its own mechanics.
  const protocols: BProtocol[] = [];
  for (const t of ex.object_types ?? []) {
    const key = (m: string) => t.properties.find((p) => p.mechanic === m)?.key;
    const sev = key("serves_severity");
    if (!sev) continue;
    const res = key("consumes_activity"), stay = key("occupies_for");
    for (const o of objectsByType.get(t.name) ?? []) {
      const s = o.properties[sev];
      if (typeof s !== "string" || !s.trim()) continue;
      protocols.push({
        severity: s.trim(),
        resource: res && typeof o.properties[res] === "string" ? String(o.properties[res]) : null,
        stay: stay ? num(o.properties[stay]) : null,
      });
    }
  }

  const located: LatLon[] = [...sites.map((s) => s.loc), ...pops.map((p) => p.loc).filter((l): l is LatLon => !!l)];
  const bounds: [LatLon, LatLon] | null = located.length
    ? [
        [Math.min(...located.map((l) => l[0])), Math.min(...located.map((l) => l[1]))],
        [Math.max(...located.map((l) => l[0])), Math.max(...located.map((l) => l[1]))],
      ]
    : null;

  const activities = Array.from(acts.values()).filter((a) => a.total > 0).sort((a, b) => a.id.localeCompare(b.id));
  return {
    sites, siteById, unlocated,
    pops, popById: new Map(pops.map((p) => [p.id, p])), popTotal: pops.reduce((a, p) => a + p.size, 0),
    types, typeByName: new Map(types.map((t) => [t.name, t])),
    objects, objectsByType,
    activities, activityById: new Map(activities.map((a) => [a.id, a])),
    severities: (vocabularyOf(ex).acuity ?? []).map((a) => a.id),
    protocols,
    rules: ex.object_rules ?? { unavailable_keys: [], unavailable_values: [] },
    bounds,
  };
}

/** objects.py: ObjectRules.unavailable, for one key and one value. */
export const readsUnavailable = (tw: BuilderTwin, key: string, value: unknown) =>
  tw.rules.unavailable_keys.includes(key) && typeof value === "string" && tw.rules.unavailable_values.includes(value.trim().toLowerCase());
