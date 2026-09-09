import { describe, expect, it } from "vitest";

import { SHAPE_FILL_OPACITY } from "./map-shapes";

/**
 * Where a `["zoom"]` expression is allowed to sit.
 *
 * Mapbox accepts it only as the direct input of a top-level `step` or
 * `interpolate`. Nested anywhere else — inside a `case`, for instance —
 * `addLayer` throws at runtime, which no type checker catches and no test
 * caught either, because the expression was written inline in a component that
 * only runs in a browser.
 *
 * The cost was not the missing tint. `ensureShapeLayers` runs inside a React
 * effect declared before the effect that builds the map's markers, and an
 * exception in an effect skips every effect remaining in that commit. The map
 * dropped all 1 590 markers while its header still said "1590 sites", and it
 * did so intermittently — only when both effects re-ran in the same commit —
 * which is exactly the kind of failure that gets dismissed as a slow load.
 */

/** Every sub-expression that reads the zoom level, with the path to it. */
function zoomReads(expr: unknown, path: string[] = []): string[][] {
  if (!Array.isArray(expr)) return [];
  if (expr[0] === "zoom") return [path];
  return expr.flatMap((child, i) => zoomReads(child, [...path, String(expr[0] ?? i)]));
}

describe("the territory fill's opacity expression", () => {
  it("reads the zoom exactly once", () => {
    expect(zoomReads(SHAPE_FILL_OPACITY)).toHaveLength(1);
  });

  it("puts the zoom directly under a top-level interpolate", () => {
    // The whole rule, in one assertion: the path from the root to `["zoom"]`
    // must be the interpolate itself and nothing else.
    expect(zoomReads(SHAPE_FILL_OPACITY)[0]).toEqual(["interpolate"]);
  });

  it("is an interpolate on zoom at the root", () => {
    expect(SHAPE_FILL_OPACITY[0]).toBe("interpolate");
    expect(SHAPE_FILL_OPACITY[2]).toEqual(["zoom"]);
  });

  it("never buries the zoom inside a case", () => {
    // The precise mistake, named so a future edit that reintroduces it fails
    // here rather than in a browser three deploys later.
    for (const p of zoomReads(SHAPE_FILL_OPACITY)) {
      expect(p).not.toContain("case");
    }
  });
});

describe("the three rules the fade has to keep", () => {
  const stops = () => {
    const out: { zoom: number; value: unknown }[] = [];
    for (let i = 3; i < SHAPE_FILL_OPACITY.length; i += 2) {
      out.push({ zoom: SHAPE_FILL_OPACITY[i] as number, value: SHAPE_FILL_OPACITY[i + 1] });
    }
    return out;
  };

  it("fades a plain territory as the buildings become the subject", () => {
    // Far out the territory is the subject; close in it is context that must
    // not tint the building being read.
    const plain = stops().map((s) => (s.value as unknown[])[5] as number);
    expect(plain).toEqual([0.2, 0.12, 0.04]);
    expect([...plain].sort((a, b) => b - a)).toEqual(plain);
  });

  it("holds a played run's fill at every zoom", () => {
    // Reading the wave means reading the fill, so it must not fade.
    const wave = stops().map((s) => JSON.stringify((s.value as unknown[])[4]));
    expect(new Set(wave).size).toBe(1);
  });

  it("keeps a dimmed shape faint at every zoom", () => {
    for (const s of stops()) expect((s.value as unknown[])[2]).toBe(0.02);
  });
});
