import { describe, expect, it } from "vitest";

import {
  dedupePoints,
  flattenCoordinates,
  formatArea,
  formatMetres,
  pointsStillNeeded,
  polygonFrom,
  ringBounds,
} from "./polygon-draw";

const A: [number, number] = [-73.57, 45.5];
const B: [number, number] = [-73.55, 45.5];
const C: [number, number] = [-73.55, 45.52];

describe("dedupePoints", () => {
  it("drops the repeat a double-click leaves behind", () => {
    expect(dedupePoints([A, B, B, C])).toEqual([A, B, C]);
  });

  it("drops a closing click on the first vertex", () => {
    expect(dedupePoints([A, B, C, A])).toEqual([A, B, C]);
  });

  it("keeps points that are merely close", () => {
    const near: [number, number] = [A[0] + 0.001, A[1]];
    expect(dedupePoints([A, near])).toHaveLength(2);
  });
});

describe("polygonFrom", () => {
  it("refuses fewer than three distinct vertices", () => {
    expect(polygonFrom([])).toBeNull();
    expect(polygonFrom([A])).toBeNull();
    expect(polygonFrom([A, B])).toBeNull();
    // Two clicks and a double-click is still a line.
    expect(polygonFrom([A, B, B])).toBeNull();
  });

  it("closes the ring, because GeoJSON requires it", () => {
    const poly = polygonFrom([A, B, C])!;
    const ring = poly.coordinates[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("does not close it twice when the user already did", () => {
    expect(polygonFrom([A, B, C, A])!.coordinates[0]).toHaveLength(4);
  });
});

describe("pointsStillNeeded", () => {
  it("counts down to a saveable shape", () => {
    expect(pointsStillNeeded([])).toBe(3);
    expect(pointsStillNeeded([A])).toBe(2);
    expect(pointsStillNeeded([A, B])).toBe(1);
    expect(pointsStillNeeded([A, B, C])).toBe(0);
  });

  it("does not count a repeated click as progress", () => {
    expect(pointsStillNeeded([A, A, A])).toBe(2);
  });
});

describe("formatArea", () => {
  it("uses the unit a person would use", () => {
    expect(formatArea(850)).toBe("850 m²");
    expect(formatArea(50_000)).toBe("5.0 ha");
    expect(formatArea(3_048_000)).toBe("3.05 km²");
    expect(formatArea(45_000_000)).toBe("45.0 km²");
  });

  it("has an answer for a point, which has no area", () => {
    expect(formatArea(0)).toBe("—");
    expect(formatArea(Number.NaN)).toBe("—");
  });
});

describe("formatMetres", () => {
  it("switches to kilometres above a thousand", () => {
    expect(formatMetres(420)).toBe("420 m");
    expect(formatMetres(1_500)).toBe("1.50 km");
    expect(formatMetres(42_000)).toBe("42.0 km");
  });
});

describe("ringBounds", () => {
  it("boxes the ring", () => {
    expect(ringBounds([A, B, C])).toEqual({
      west: -73.57,
      south: 45.5,
      east: -73.55,
      north: 45.52,
    });
  });

  it("returns null rather than a box at null island", () => {
    expect(ringBounds([])).toBeNull();
  });
});

describe("flattenCoordinates", () => {
  it("walks a polygon's rings", () => {
    expect(flattenCoordinates([[[1, 2], [3, 4], [1, 2]]])).toEqual([
      [1, 2],
      [3, 4],
      [1, 2],
    ]);
  });

  it("walks a multipolygon just as happily", () => {
    expect(flattenCoordinates([[[[1, 2], [3, 4]]], [[[5, 6]]]])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("handles a bare point", () => {
    expect(flattenCoordinates([1, 2])).toEqual([[1, 2]]);
  });

  it("is not fooled by nonsense", () => {
    expect(flattenCoordinates(null)).toEqual([]);
    expect(flattenCoordinates("nope")).toEqual([]);
  });
});
