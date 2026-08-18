/**
 * The ontology, as something you browse rather than something you type into.
 *
 * The composer used to open with a list of quantities the engine had invented
 * and a free-text box for the property name. Both are gone, so the left rail has
 * to answer the question they were standing in for: *what is there to change?*
 *
 * The answer is the institution's own types and their declared properties, in
 * their own words, with the instance counts that say whether an effect on them
 * would reach anything. Nothing in this file names a property, a unit or a type.
 */

import type {
  Mechanic,
  PropertyBehaviour,
  PropertyType,
  SimExport,
  SimRole,
} from "@/lib/platform-api";

import type { Vocabulary } from "./event-effects";

/**
 * What the twin offers per selector dimension, for the sentences that describe
 * an effect back to its author.
 *
 * Lifted out of the composer so the workspace and the composer cannot drift
 * into naming the same facility two different ways. Severities are the one
 * dimension that is not in the payload: they come from the declared care model,
 * so they are read off the object types that bind `serves_severity` rather than
 * listed here.
 */
export function vocabularyOf(snapshot: SimExport): Vocabulary {
  const categories = new Set<string>();
  const activities = new Set<string>();
  for (const f of snapshot.facilities) {
    for (const r of Object.values(f.resources)) {
      categories.add(r.category);
      for (const a of r.enables) activities.add(a);
    }
  }

  const severityKeys = new Set<string>();
  for (const t of snapshot.object_types ?? []) {
    for (const p of t.properties) {
      if (p.mechanic === "serves_severity") severityKeys.add(p.key);
    }
  }
  const severities = new Set<string>();
  for (const o of snapshot.objects ?? []) {
    for (const key of Array.from(severityKeys)) {
      const v = o.properties?.[key];
      if (typeof v === "string" && v.trim()) severities.add(v.trim());
    }
  }

  const objectCounts = new Map<string, number>();
  for (const o of snapshot.objects ?? []) {
    objectCounts.set(o.type, (objectCounts.get(o.type) ?? 0) + 1);
  }

  const named = (s: Set<string>) =>
    Array.from(s)
      .sort()
      .map((id) => ({ id, name: id }));

  return {
    facility: snapshot.facilities.map((f) => ({ id: f.id, name: f.name })),
    population: snapshot.populations.map((p) => ({ id: p.id, name: p.name })),
    category: named(categories),
    activity: named(activities),
    // Empty until something declares them, which is the honest state: the three
    // hard-coded bands here used to be the last place the composer asserted
    // what kind of institution this is.
    acuity: named(severities),
    route: snapshot.edges.map((e) => ({
      id: `${e.source}>${e.target}`,
      name: `${snapshot.facilities.find((f) => f.id === e.source)?.name ?? e.source.slice(0, 8)} → ${
        snapshot.facilities.find((f) => f.id === e.target)?.name ?? e.target.slice(0, 8)
      }`,
    })),
    object_type: Array.from(objectCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, n]) => ({ id, name: `${id} (${n})` })),
  };
}

export interface RailProperty {
  key: string;
  type: PropertyType;
  unit: string | null;
  behaviour: PropertyBehaviour | null;
  mechanic: Mechanic | null;
  /**
   * Why an effect on this cannot do arithmetic, or null.
   *
   * Shown in the rail rather than discovered after the effect exists: picking a
   * property, filling a form and only then being told it cannot be multiplied
   * is three steps of work thrown away.
   */
  limitation: string | null;
}

export interface RailType {
  name: string;
  role: SimRole | null;
  instances: number;
  properties: RailProperty[];
  /** Why nothing here can be perturbed, or null. */
  blocked: string | null;
}

function limitationOf(behaviour: PropertyBehaviour | null, type: PropertyType): string | null {
  if (behaviour === "state") {
    return type === "number" ? "declared a label — set only" : "text — set only";
  }
  if (behaviour === null) return "no behaviour declared — set only";
  return null;
}

/**
 * Every type in the twin, with what an effect could do to it.
 *
 * Types with no instances are kept rather than hidden. An effect cannot reach
 * them, and that is worth seeing: a type declared months ago and never
 * populated looks identical to a typo until something says the count is zero.
 */
export function ontologyRail(snapshot: SimExport): RailType[] {
  const counts = new Map<string, number>();
  for (const o of snapshot.objects ?? []) {
    counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  }

  const rows: RailType[] = (snapshot.object_types ?? []).map((t) => {
    const instances = counts.get(t.name) ?? 0;
    return {
      name: t.name,
      role: t.role,
      instances,
      properties: t.properties
        .map((p) => ({
          key: p.key,
          type: p.type,
          unit: p.unit,
          behaviour: p.behaviour,
          mechanic: p.mechanic,
          limitation: limitationOf(p.behaviour, p.type),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      blocked:
        instances === 0
          ? "No instance of this type exists, so an effect on it would reach nothing."
          : t.properties.length === 0
            ? "This type declares no properties, so there is nothing on it to change."
            : null,
    };
  });

  // What an effect can actually reach comes first. Sorting alphabetically alone
  // would bury the only usable type under a list of empty ones.
  return rows.sort((a, b) => {
    const usable = (r: RailType) => (r.blocked === null ? 0 : 1);
    return usable(a) - usable(b) || a.name.localeCompare(b.name);
  });
}

/** One line under a property in the rail, or "" when there is nothing to add. */
export function describeRailProperty(p: RailProperty): string {
  const parts: string[] = [];
  if (p.behaviour && p.type === "number") parts.push(p.behaviour);
  if (p.unit?.trim()) parts.push(p.unit.trim());
  if (p.mechanic) parts.push(`feeds ${p.mechanic}`);
  if (parts.length === 0 && p.limitation) return p.limitation;
  return parts.join(" · ");
}

/** How many properties across the whole twin an effect could do arithmetic on. */
export function perturbableCount(rail: RailType[]): number {
  return rail
    .filter((t) => t.blocked === null)
    .reduce((n, t) => n + t.properties.filter((p) => p.limitation === null).length, 0);
}
