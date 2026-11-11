import { describe, expect, it } from "vitest";

import {
  applyFilters,
  decodeBytes,
  describeFilters,
  keyColumns,
  latLonColumns,
  layerRows,
  parseTable,
  profile,
  toNumber,
  valueColumns,
} from "./add-data";
import { buildHexGrid } from "./hex-grid";
import { cellOf, cellValues, looksLikeOccupancy, nearestValues, quantileRamp, readingsOf } from "./layers";

describe("reading the file", () => {
  it("reads Windows-1252 as written, so accented names still match", () => {
    // "Hôpital" in Windows-1252: ô is 0xF4, which is not valid UTF-8 on its own.
    const bytes = new Uint8Array([0x48, 0xf4, 0x70, 0x69, 0x74, 0x61, 0x6c]);
    expect(decodeBytes(bytes)).toEqual({ text: "Hôpital", encoding: "windows-1252" });
    expect(decodeBytes(new TextEncoder().encode("Hôpital")).encoding).toBe("utf-8");
  });

  it("reads CSV with semicolons and JSON arrays alike", () => {
    expect(parseTable("code;lits\n0611;120\n0612;80").rows).toEqual([
      { code: "0611", lits: "120" },
      { code: "0612", lits: "80" },
    ]);
    const j = parseTable('[{"code":"0611","lits":120,"geo":{"a":1}}]');
    expect(j.format).toBe("json");
    expect(j.rows[0]).toEqual({ code: "0611", lits: "120", geo: '{"a":1}' });
  });

  it("takes points out of GeoJSON", () => {
    const g = parseTable('{"type":"FeatureCollection","features":[{"properties":{"n":2},"geometry":{"type":"Point","coordinates":[-73.6,45.5]}}]}');
    expect(g.rows[0]).toEqual({ n: "2", longitude: "-73.6", latitude: "45.5" });
  });
});

describe("numbers as people write them", () => {
  it("handles decimal commas, thousands and symbols", () => {
    expect(toNumber("1 234,5")).toBe(1234.5);
    expect(toNumber("12,5 %")).toBe(12.5);
    expect(toNumber("1,234")).toBe(1234);
    expect(toNumber("1,234.75")).toBe(1234.75);
    expect(toNumber("$300")).toBe(300);
  });

  it("never turns a blank into zero", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("n/a")).toBeNull();
    expect(toNumber("0")).toBe(0);
  });
});

const ROWS = [
  { code_installation: "53324349", nom: "Manoir", service: "CHSLD", unite: "Lits permanents", lits: "88", lat: "45.45", lon: "-73.85" },
  { code_installation: "51230118", nom: "Château", service: "CHSLD", unite: "Lits permanents", lits: "50", lat: "45.43", lon: "-73.88" },
  { code_installation: "51230118", nom: "Château", service: "CH", unite: "Lits dressés", lits: "12", lat: "45.43", lon: "-73.88" },
  { code_installation: "", nom: "Sans code", service: "CHSLD", unite: "Lits permanents", lits: "40", lat: "", lon: "" },
];

describe("what the columns are", () => {
  const p = profile(ROWS, Object.keys(ROWS[0]!));

  it("finds the value columns and the key columns, and keeps coordinates out of keys", () => {
    expect(valueColumns(p)).toEqual(["code_installation", "lits", "lat", "lon"]);
    // Order is only a shortlist for the server, which counts matches itself.
    const keys = keyColumns(p);
    expect(keys).toEqual(expect.arrayContaining(["code_installation", "nom"]));
    expect(keys).not.toContain("lat");
    expect(keys).not.toContain("lits");
  });

  it("finds latitude and longitude by name and range", () => {
    expect(latLonColumns(p)).toEqual({ lat: "lat", lon: "lon" });
    expect(latLonColumns(profile([{ lat: "500", lon: "1" }], ["lat", "lon"]))).toBeNull();
  });
});

describe("the rows the server receives", () => {
  it("keeps only what the filters keep, and says what they were", () => {
    const filters = [{ column: "service", values: ["CHSLD"] }, { column: "unite", values: ["Lits permanents"] }];
    expect(applyFilters(ROWS, filters)).toHaveLength(3);
    expect(describeFilters(filters)).toBe("service = CHSLD; unite = Lits permanents");
  });

  it("drops rows with no key or no number, and counts them", () => {
    const { out, dropped } = layerRows(ROWS, { mode: "match", column: "code_installation" }, "lits");
    expect(out).toEqual([
      { match: "53324349", value: 88 },
      { match: "51230118", value: 50 },
      { match: "51230118", value: 12 },
    ]);
    expect(dropped).toBe(1);
  });

  it("counts rows when there is no value column", () => {
    expect(layerRows(ROWS.slice(0, 1), { mode: "match", column: "code_installation" }, null).out[0]!.value).toBe(1);
  });

  it("places rows by coordinates", () => {
    const { out, dropped } = layerRows(ROWS, { mode: "points", lat: "lat", lon: "lon", name: "nom" }, "lits");
    expect(out[0]).toEqual({ lat: 45.45, lon: -73.85, value: 88, name: "Manoir" });
    expect(dropped).toBe(1);
  });
});

describe("a layer on the hexes", () => {
  const grid = buildHexGrid(
    [
      { id: "w", name: "W", lat: 45.5, lon: -73.7 },
      { id: "e", name: "E", lat: 45.5, lon: -73.572 },
    ],
    [
      { id: "pop:w", name: "W", size: 1, servedBy: ["w"] },
      { id: "pop:e", name: "E", size: 1, servedBy: ["e"] },
    ],
    { targetCells: 200 },
  );

  it("puts a point in its cell, and nothing far off the grid", () => {
    expect(cellOf(grid, 45.5, -73.7)).toBeGreaterThanOrEqual(0);
    expect(cellOf(grid, 47, -71)).toBe(-1);
  });

  it("adds sites that share a cell when the layer sums, and averages when it averages", () => {
    const pts: [number, number, number][] = [
      [45.5, -73.7, 120],
      [45.5, -73.7, 80],
      [47, -71, 5],
    ];
    const sum = cellValues(grid, { points: pts, catchments: [], aggregate: "sum" });
    expect(Math.max(...sum.values.map((v) => v ?? 0))).toBe(200);
    expect(sum.outside).toBe(1);
    const mean = cellValues(grid, { points: pts, catchments: [], aggregate: "mean" });
    expect(Math.max(...mean.values.map((v) => v ?? 0))).toBe(100);
  });

  it("spreads a catchment's total over its cells, and repeats its average", () => {
    const n = grid.hexes.filter((h) => h.population === "pop:w").length;
    const sum = cellValues(grid, { points: [], catchments: [["pop:w", 1000]], aggregate: "sum" });
    expect(sum.values.reduce<number>((a, v) => a + (v ?? 0), 0)).toBeCloseTo(1000, 6);
    const mean = cellValues(grid, { points: [], catchments: [["pop:w", 0.4]], aggregate: "mean" });
    expect(mean.values.filter((v) => v === 0.4)).toHaveLength(n);
  });

  it("colours by quantiles, and names every bin by a value it reaches", () => {
    const r = quantileRamp([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null], "beds");
    expect(r.legend).toHaveLength(5);
    expect(r.legend[0]!.label).toBe("under 3 beds");
    expect(r.legend[4]!.label).toBe("9 beds and over");
    expect(r.colourOf(null)).toBe("#f6f7f9");
    expect(r.colourOf(10)).toBe(r.legend[4]!.colour);
    expect(quantileRamp([5, 5, 5]).legend).toHaveLength(1);
  });

  it("reads live measures per site, keeping only those some site reports", () => {
    const r = readingsOf(
      [
        { key: "occupancy", label: "Occupancy", unit: "percent", active: true },
        { key: "wait", label: "Wait", unit: "number", active: true },
        { key: "old", label: "Old", unit: "count", active: false },
      ],
      [
        { id: "w", metrics: { values: { occupancy: 140, wait: null, old: 3 } } },
        { id: "e", metrics: { values: { occupancy: null, wait: null } } },
      ],
    );
    expect(r).toEqual([{ key: "occupancy", label: "Occupancy", unit: "percent", values: { w: 140 } }]);
    expect(looksLikeOccupancy(r[0]!)).toBe(true);
    expect(looksLikeOccupancy({ key: "vax", label: "Vaccinated", unit: "percent" })).toBe(false);
  });

  it("gives each cell the reading of its nearest reporting site", () => {
    const v = nearestValues(grid, [{ lat: 45.5, lon: -73.7, value: 140 }]);
    expect(v.every((x) => x === 140)).toBe(true);
    const two = nearestValues(grid, [
      { lat: 45.5, lon: -73.7, value: 1 },
      { lat: 45.5, lon: -73.572, value: 2 },
    ]);
    expect(two[cellOf(grid, 45.5, -73.7)]).toBe(1);
    expect(two[cellOf(grid, 45.5, -73.572)]).toBe(2);
    expect(nearestValues(grid, []).every((x) => x === null)).toBe(true);
  });
});
