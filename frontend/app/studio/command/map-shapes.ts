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
 *     the whole point of an ontology you can edit.
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

/** The colour used when the institution declared none. Grey, never a guess. */
export const UNCOLOURED = "#8a94a6";

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
        couleur: colourOf(s.properties) ?? UNCOLOURED,
        tags: tagsOf(s.properties).join(" · "),
        dimmed: isTerritory && hidden.has(`axis:${label}`),
      },
      geometry: s.geometry,
    });
  }
  return { type: "FeatureCollection", features };
}
