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
    /**
     * A run is being played over this map, so the fill means a quantity.
     *
     * Carried per feature rather than set on the layer, because the two states
     * have to coexist: a catchment the run never reached keeps its categorical
     * tint while its neighbours carry the wave, and painting the whole layer
     * one way or the other would have to choose.
     */
    wave: boolean;
    /** Where this shape sits between nothing and the run's peak, 0 to 1. */
    intensity: number;
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

/**
 * The ramp a played run is drawn with: one hue family, pale to deep.
 *
 * Categorical tints are wrong here for the reason `AUTO_TINTS` exists at all —
 * they are meant to be distinguishable, not ordered, and a reader cannot tell
 * which of violet and orange is more. A quantity needs a ramp somebody can rank
 * at a glance, so this one only ever gets darker and warmer.
 */
export const WAVE_RAMP = ["#fbf0d9", "#e8a33d", "#a8261f"] as const;

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
    const taken = new Map<string, number>();
    for (const n of Array.from(neighbours.get(s.instanceId) ?? [])) {
      const c = out.get(n);
      if (c) taken.set(c, (taken.get(c) ?? 0) + 1);
    }
    if (taken.size === 0) {
      // Touching nothing, so no constraint to satisfy — but "first free tint"
      // would then hand every island the same blue. Cycling keeps a set of
      // detached shapes distinguishable, which is what the colour is for.
      out.set(s.instanceId, AUTO_TINTS[i % AUTO_TINTS.length]!);
      return;
    }
    // Six tints colour any planar map, so a free one is the normal case. It
    // runs out only under the extent fallback above, which calls shapes
    // neighbours that merely sit in the same rectangle — and there the least
    // crowded tint beats grey, because the collision it risks is with a shape
    // that probably shares no border in the first place.
    const ranked = AUTO_TINTS.slice().sort(
      (a, b) => (taken.get(a) ?? 0) - (taken.get(b) ?? 0) || AUTO_TINTS.indexOf(a) - AUTO_TINTS.indexOf(b),
    );
    out.set(s.instanceId, ranked[0] ?? UNCOLOURED);
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
    /**
     * Instance id → 0..1, when a spreading run is being played.
     *
     * Scaled against the peak of the whole run by the caller, not per step —
     * per-step scaling makes every frame equally deep and the wave stops
     * rising.
     */
    intensity?: Map<string, number>;
  },
): ShapeFeatureCollection {
  const hidden = opts.hidden ?? new Set<string>();
  const intensity = opts.intensity;
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
        // A shape the run did not report is not at zero, it is unmeasured, and
        // colouring it as the pale end of the ramp would state something the
        // run never said. It keeps its own tint instead.
        wave: intensity?.has(s.instanceId) ?? false,
        intensity: intensity?.get(s.instanceId) ?? 0,
      },
      geometry: s.geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Colouring a boundary by a number it carries

/**
 * The properties that could colour a choropleth, and how many shapes carry each.
 *
 * Offered rather than assumed, for the reason `chartable` exists: a picker that
 * lists every key lets somebody colour a map by a postal code. Only keys whose
 * values are numbers on more than one shape are candidates — one shape with a
 * number has no scale to sit on.
 */
export function numericProperties(
  shapes: readonly InstanceShape[],
): { name: string; covered: number }[] {
  const counts = new Map<string, number>();
  for (const s of shapes) {
    for (const [key, value] of Object.entries(s.properties ?? {})) {
      const n = typeof value === "number" ? value : Number(value);
      if (value === null || value === "" || !Number.isFinite(n)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([name, covered]) => ({ name, covered }))
    .filter((c) => c.covered > 1)
    .sort((a, b) => b.covered - a.covered || a.name.localeCompare(b.name));
}

/**
 * Where each shape sits between the lowest and highest value, 0 to 1.
 *
 * A shape that does not carry the property is absent from the map rather than
 * present at zero. The renderer already draws an absent shape in its own tint,
 * and that is the difference between "this region reports no deprivation index"
 * and "this region has the lowest deprivation in the province".
 *
 * The scale is over the shapes that *do* carry it. Extending it to zero would
 * push every real value into the top of the ramp whenever the numbers are large
 * and close together — a life expectancy map where 78 and 84 are both dark red.
 */
export function choroplethIntensity(
  shapes: readonly InstanceShape[],
  property: string,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const s of shapes) {
    const raw = (s.properties ?? {})[property];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) values.set(s.instanceId, n);
  }
  if (values.size === 0) return new Map();

  const nums = Array.from(values.values());
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const out = new Map<string, number>();
  for (const [id, n] of Array.from(values)) {
    // Every shape reading the same is a uniform province, not a province in
    // crisis. It sits in the middle of the ramp rather than at the top.
    out.set(id, hi === lo ? 0.5 : (n - lo) / (hi - lo));
  }
  return out;
}

/** The ends of the scale, for a legend that says what the colours mean. */
export function choroplethRange(
  shapes: readonly InstanceShape[],
  property: string,
): { low: number; high: number; covered: number; missing: number } | null {
  const nums: number[] = [];
  let missing = 0;
  for (const s of shapes) {
    const raw = (s.properties ?? {})[property];
    const n = raw === null || raw === undefined || raw === "" ? Number.NaN : Number(raw);
    if (Number.isFinite(n)) nums.push(n);
    else missing += 1;
  }
  if (nums.length === 0) return null;
  return { low: Math.min(...nums), high: Math.max(...nums), covered: nums.length, missing };
}

/**
 * Opacity of a territory's fill, as a Mapbox paint expression.
 *
 * The zoom interpolation has to be the OUTER expression. Mapbox refuses a
 * `["zoom"]` input anywhere except as the direct input of a top-level `step` or
 * `interpolate`, and this was written the other way round: a `case` whose last
 * branch faded with zoom. `addLayer` threw on every attempt.
 *
 * The layer therefore never got added, and the throw surfaced only as an
 * uncaught error in the console: nothing on screen said the map was missing a
 * layer. It was found while chasing a worse symptom — the map showing zero
 * markers while its own header read "1590 sites" — and the two were observed
 * together, on and off, over several loads. `ensureShapeLayers` is called both
 * from the `style.load` handler and from React effects declared ahead of the
 * one that builds the markers, which is the likely path from one to the other,
 * but the marker count is what to watch: it is what a reader of this map
 * actually loses.
 *
 * Same three rules as before, evaluated at each zoom stop instead of around
 * them: dimmed stays faint, a played run holds its fill at every zoom because
 * reading the wave means reading the fill, and only a plain territory fades as
 * the installation becomes the subject.
 */
export const SHAPE_FILL_OPACITY = (() => {
  const wave = ["interpolate", ["linear"], ["get", "intensity"], 0, 0.18, 1, 0.72];
  const at = (plain: number) => [
    "case",
    ["get", "dimmed"],
    0.02,
    ["get", "wave"],
    wave,
    plain,
  ];
  return ["interpolate", ["linear"], ["zoom"], 8, at(0.2), 11, at(0.12), 14, at(0.04)];
})() as unknown[];
