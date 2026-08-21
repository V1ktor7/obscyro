/**
 * Turning saved shapes into what the map draws.
 *
 * Two decisions live here, and both are the reason this is a module rather
 * than an inline `.map()` in the view:
 *
 *  1. **Where the colour comes from.** Not from a palette in the client. A
 *     territory is coloured by a property the institution declared on it, and
 *     the client finds that property by looking at the *values* — anything
 *     that is a CSS hex colour is a colour — rather than by knowing a blessed
 *     key called `couleur`. A deployment that names it `color`, `teinte` or
 *     `display_colour` gets the same behaviour without a code change, which is
 *     the whole point of an ontology you can edit. Nothing declared means a
 *     tint no *neighbour* is using — a distinction, not a meaning.
 *
 *  2. **When a boundary is allowed on screen.** Only the territory axis has
 *     real boundaries. An establishment's envelope was measured wrong for 135
 *     of 190 installations and a mission has no geography at all, so drawing
 *     either would put a fiction on the map in the same ink as a fact. Shapes
 *     of other kinds — a coverage area somebody traced by hand — are the
 *     user's own assertion and stay visible on every axis.
 */

import type { InstanceShape } from "@/lib/platform-api";

import type { GroupingAxis } from "./units-axes";
import { axisHasBoundaries } from "./units-axes";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The colour an institution declared for this shape, or null.
 *
 * Found by value, not by key name: a string that is a hex colour is one. Keys
 * are sorted so two properties that both hold a colour resolve the same way on
 * every render rather than following JSON key order.
 */
export function colourOf(properties: Record<string, unknown> | undefined): string | null {
  if (!properties) return null;
  for (const key of Object.keys(properties).sort()) {
    const v = properties[key];
    if (typeof v === "string" && HEX.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * The tags declared on the shape — any property holding a list of strings.
 *
 * Same rule as the colour: recognised by shape, not by a key this file has
 * decided to bless.
 */
export function tagsOf(properties: Record<string, unknown> | undefined): string[] {
  if (!properties) return [];
  for (const key of Object.keys(properties).sort()) {
    const v = properties[key];
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
      return v as string[];
    }
  }
  return [];
}

export interface ShapeFeature {
  type: "Feature";
  properties: {
    instanceId: string;
    kind: string;
    label: string;
    /** Always present so the paint expression never falls back mid-layer. */
    couleur: string;
    tags: string;
    /** A territory the tree has hidden is drawn faintly, not removed. */
    dimmed: boolean;
  };
  geometry: InstanceShape["geometry"];
}

export interface ShapeFeatureCollection {
  type: "FeatureCollection";
  features: ShapeFeature[];
}

/**
 * Tints for territories nobody has coloured yet.
 *
 * The same choice `TYPE_TINTS` makes for object types, for the same reason:
 * these are categorical, not semantic. The fifth is violet because it is the
 * fifth, and none of them means "worse". Naming them `danger` or `warn` would
 * have a reader infer a severity from an outline that is only a border.
 *
 * Six is deliberate headroom — four suffice to colour any planar map, so a
 * palette of six is never the reason two neighbours end up alike.
 */
export const AUTO_TINTS = [
  "#2d72d2",
  "#1d9e75",
  "#d9822b",
  "#8f5cc4",
  "#c23030",
  "#0f6f7a",
] as const;

/** Used only when a shape has no neighbours and no declaration to go on. */
export const UNCOLOURED = "#8a94a6";

/** Vertices are matched at ~10 cm, which is finer than the source's precision. */
function vertexKeys(geometry: InstanceShape["geometry"]): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!Array.isArray(v)) return;
    if (typeof v[0] === "number" && typeof v[1] === "number") {
      out.push(`${(v[0] as number).toFixed(6)},${(v[1] as number).toFixed(6)}`);
      return;
    }
    for (const child of v) walk(child);
  };
  walk(geometry.coordinates);
  return out;
}

/**
 * Which shapes touch which.
 *
 * Two territories are neighbours when they share a vertex. Official boundaries
 * are cut from one source geometry, so a shared border is a shared vertex list
 * rather than two lines that merely look coincident — which makes an exact test
 * both correct here and far cheaper than intersecting every edge pair.
 */
export function adjacency(shapes: InstanceShape[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of shapes) out.set(s.instanceId, new Set());

  const byVertex = new Map<string, string[]>();
  for (const s of shapes) {
    for (const key of Array.from(new Set(vertexKeys(s.geometry)))) {
      const list = byVertex.get(key);
      if (list) list.push(s.instanceId);
      else byVertex.set(key, [s.instanceId]);
    }
  }
  let found = 0;
  for (const ids of Array.from(byVertex.values())) {
    if (ids.length < 2) continue;
    for (const a of ids) {
      for (const b of ids) {
        if (a !== b && !out.get(a)?.has(b)) {
          out.get(a)?.add(b);
          found++;
        }
      }
    }
  }
  if (found > 0) return out;

  // Nothing shared a vertex. Either these shapes genuinely do not touch, or
  // they were simplified ring by ring and a border that is one line on the
  // ground is now two that miss each other by metres. Overlapping extents are
  // the coarse read that survives that: it over-reports, which only ever costs
  // an extra colour, whereas under-reporting paints two neighbours alike.
  const box = new Map<string, [number, number, number, number]>();
  for (const s of shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const key of vertexKeys(s.geometry)) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if (x0 !== Infinity) box.set(s.instanceId, [x0, y0, x1, y1]);
  }
  for (const a of shapes) {
    for (const b of shapes) {
      if (a.instanceId === b.instanceId) continue;
      const p = box.get(a.instanceId);
      const q = box.get(b.instanceId);
      if (!p || !q) continue;
      if (p[0] <= q[2] && q[0] <= p[2] && p[1] <= q[3] && q[1] <= p[3]) {
        out.get(a.instanceId)?.add(b.instanceId);
      }
    }
  }
  return out;
}

/**
 * A colour for every shape: the declared one where there is one, otherwise a
 * tint no neighbour is already using.
 *
 * Greedy colouring in Welsh–Powell order — most-connected territory first,
 * because the shape hemmed in by five others is the one with the fewest tints
 * left if you leave it until last. A hash of the name would have been one line,
 * and on twelve RLS packed onto one island it would have put two of them side
 * by side in the same blue often enough to matter; the entire job of the colour
 * is to say *this outline is not that one*.
 *
 * Declared colours are assigned first and constrain their neighbours, so an
 * institution that colours one territory pushes the rest out of its way rather
 * than colliding with them.
 */
export function assignColours(shapes: InstanceShape[]): Map<string, string> {
  const out = new Map<string, string>();
  const neighbours = adjacency(shapes);

  const declared: InstanceShape[] = [];
  const derived: InstanceShape[] = [];
  for (const s of shapes) {
    const c = colourOf(s.properties);
    if (c) {
      out.set(s.instanceId, c);
      declared.push(s);
    } else derived.push(s);
  }

  // Ties broken by id so the same data always paints the same map; a territory
  // that changes colour on reload is a legend nobody can trust.
  derived.sort(
    (a, b) =>
      (neighbours.get(b.instanceId)?.size ?? 0) - (neighbours.get(a.instanceId)?.size ?? 0) ||
      a.instanceId.localeCompare(b.instanceId),
  );

  derived.forEach((s, i) => {
    const taken = new Set<string>();
    for (const n of Array.from(neighbours.get(s.instanceId) ?? [])) {
      const c = out.get(n);
      if (c) taken.add(c);
    }
    if (taken.size === 0) {
      // Touching nothing, so no constraint to satisfy — but "first free tint"
      // would then hand every island the same blue. Cycling keeps a set of
      // detached shapes distinguishable, which is what the colour is for.
      out.set(s.instanceId, AUTO_TINTS[i % AUTO_TINTS.length]!);
      return;
    }
    const free = AUTO_TINTS.find((t) => !taken.has(t));
    // Only reachable with more than six mutually touching shapes, which no
    // planar map has. Grey then, rather than silently repeating a neighbour.
    out.set(s.instanceId, free ?? UNCOLOURED);
  });
  return out;
}

export function shapeFeatures(
  shapes: InstanceShape[],
  opts: {
    axis: GroupingAxis;
    /**
     * Ids the tree has hidden. Territory nodes are keyed by label in the tree,
     * which is why the name is what gets tested here.
     */
    hidden?: Set<string>;
  },
): ShapeFeatureCollection {
  const hidden = opts.hidden ?? new Set<string>();
  const boundaries = axisHasBoundaries(opts.axis);
  const colours = assignColours(shapes);

  const features: ShapeFeature[] = [];
  for (const s of shapes) {
    const isTerritory = s.kind === "territoire";
    // A boundary that does not belong to the question being asked is not drawn
    // faintly — it is not drawn. Grouping by mission and still seeing RLS lines
    // would suggest the missions follow them.
    if (isTerritory && !boundaries) continue;

    const label = s.instanceName || "";
    features.push({
      type: "Feature",
      properties: {
        instanceId: s.instanceId,
        kind: s.kind,
        label,
        couleur: colours.get(s.instanceId) ?? UNCOLOURED,
        tags: tagsOf(s.properties).join(" · "),
        dimmed: isTerritory && hidden.has(`axis:${label}`),
      },
      geometry: s.geometry,
    });
  }
  return { type: "FeatureCollection", features };
}
