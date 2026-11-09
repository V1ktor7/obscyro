import { describe, expect, it } from "vitest";

import type { ScenarioOverride } from "../../scenarios-api";
import type { SimDataset, SimExport } from "@/lib/platform-api";

import { buildHexGrid, cellsWithin, populationsOf } from "./hex-grid";
import { islandSeries, occupancyGrid, sickSeries } from "./engine";
import {
  describe as describeStamp,
  engineInput,
  measurePresets,
  shiftEffects,
  stampFromOverride,
  stampToOverride,
  twinContext,
  weakestTier,
  type Stamp,
} from "./stamps";

// Two hospitals 10 km apart, each serving its own catchment.
const SITES = [
  { id: "f:west", name: "West", lat: 45.5, lon: -73.7 },
  { id: "f:east", name: "East", lat: 45.5, lon: -73.572 },
];
const POPS = [
  { id: "pop:w", name: "West side", size: 1000, servedBy: ["f:west"] },
  { id: "pop:e", name: "East side", size: 3000, servedBy: ["f:east"] },
];

describe("the hex grid", () => {
  const grid = buildHexGrid(SITES, POPS, { targetCells: 200 });

  it("covers the sites and places every cell in a catchment", () => {
    expect(grid.hexes.length).toBeGreaterThan(10);
    expect(grid.placement).toBe("nearest-site");
    expect(grid.hexes.every((h) => h.population === "pop:w" || h.population === "pop:e")).toBe(true);
  });

  it("spreads each catchment's head count over its cells, losing nobody", () => {
    const total = (id: string) =>
      grid.hexes.filter((h) => h.population === id).reduce((a, h) => a + h.residents, 0);
    expect(total("pop:w")).toBeCloseTo(1000, 6);
    expect(total("pop:e")).toBeCloseTo(3000, 6);
  });

  it("finds the catchments inside a radius", () => {
    const westCell = grid.hexes.find((h) => h.nearestSite === "f:west")!;
    expect(populationsOf(grid, cellsWithin(grid, westCell.index, 1))).toEqual(["pop:w"]);
    expect(populationsOf(grid, cellsWithin(grid, westCell.index, 30)).sort()).toEqual(["pop:e", "pop:w"]);
  });

  it("uses catchment polygons when the geo service has them", () => {
    const square = (lon0: number): Array<Array<[number, number]>> => [
      [
        [lon0, 45.45],
        [lon0 + 0.06, 45.45],
        [lon0 + 0.06, 45.55],
        [lon0, 45.55],
        [lon0, 45.45],
      ],
    ];
    const g = buildHexGrid(SITES, POPS, {
      targetCells: 200,
      polygons: [
        { populationId: "pop:w", polygons: [square(-73.73)] },
        { populationId: "pop:e", polygons: [square(-73.6)] },
      ],
    });
    expect(g.placement).toBe("polygons");
    for (const h of g.hexes) expect(h.population === "pop:w" ? h.lon < -73.66 : h.lon > -73.61).toBe(true);
  });

  it("returns an empty grid for a twin with no located site", () => {
    expect(buildHexGrid([], POPS).hexes).toEqual([]);
  });
});

const EXPORT = {
  environment: "x",
  scenario_id: null,
  generated_at: "",
  facilities: [
    {
      id: "f:west",
      name: "West",
      location: [45.5, -73.7],
      census: {},
      resources: {
        a: { id: "a", category: "space", quantity: 10, capacity: 12, enables: ["civiere"] },
        b: { id: "b", category: "space", quantity: 3, capacity: 4, enables: ["civiere", "lit"] },
      },
    },
    { id: "f:none", name: "Nowhere", location: null, census: {}, resources: {} },
  ],
  object_types: [
    {
      name: "Transition",
      role: null,
      properties: [
        { key: "de", mechanic: "leaves_state" },
        { key: "vers", mechanic: "enters_state" },
        { key: "pousse", mechanic: "driven_by_state" },
        { key: "voie", mechanic: "couples_along" },
        { key: "devient", mechanic: "produces_demand" },
      ],
    },
  ],
  objects: [
    { id: "t1", type: "Transition", role: null, at: null, properties: { de: "sain", vers: "malade", pousse: "malade", voie: "ecole" } },
    { id: "t2", type: "Transition", role: null, at: null, properties: { de: "sain", vers: "malade", pousse: "malade", voie: "visiteurs" } },
    { id: "t3", type: "Transition", role: null, at: null, properties: { de: "malade", vers: "gueri", devient: "urgence" } },
  ],
  object_rules: { unavailable_keys: [], unavailable_values: [] },
  populations: [
    { id: "pop:w", name: "West side", size: 1000, served_by: ["f:west"] },
    { id: "pop:e", name: "East side", size: 3000, served_by: [] },
  ],
  edges: [],
  gaps: [],
} as unknown as SimExport;

describe("what the twin declares", () => {
  const ctx = twinContext(EXPORT);

  it("finds who catches it and who passes it on from the mechanics, not the names", () => {
    expect(ctx.infectious).toBe("malade");
    expect(ctx.susceptible).toBe("sain");
    expect(ctx.couplings).toEqual(["ecole", "visiteurs"]);
    expect(ctx.acuities).toEqual(["urgence"]);
  });

  it("keeps only located facilities and adds up capacity per activity", () => {
    expect(ctx.facilities.map((f) => f.id)).toEqual(["f:west"]);
    expect(ctx.facilities[0]!.capacity).toEqual({ civiere: 16, lit: 4 });
  });

  it("offers a preset only when its layer exists", () => {
    const keys = measurePresets(ctx.couplings).map((p) => p.key);
    expect(keys).toContain("schools");
    expect(keys).toContain("curfew");
    expect(measurePresets(["travail"]).map((p) => p.key)).toEqual(["half:travail"]);
  });
});

const stamp = (s: Partial<Stamp> & Pick<Stamp, "kind">): Stamp =>
  ({ id: "s", start: 0, days: 1, ...s }) as Stamp;

describe("stamps as overrides", () => {
  it("round-trips through an overlay override with its timing", () => {
    const s = stamp({ kind: "heat", acuity: "urgence", perThousand: 0.08, start: 24, days: 4 });
    const o = stampToOverride(s, "Heat wave", "abc");
    expect(o).toMatchObject({ targetType: "param", op: "set_param", effectiveOffsetHours: 576, durationHours: 96 });
    const back = stampFromOverride({ ...(o as unknown as ScenarioOverride), id: "ov-1", seq: 1, scenarioId: "x", targetId: null });
    expect(back).toEqual({ ...s, id: "ov-1" });
  });

  it("ignores any override that is not a stamp", () => {
    const other = { targetType: "instance", op: "set_property", payload: {}, effectiveOffsetHours: 0, durationHours: null } as unknown as ScenarioOverride;
    expect(stampFromOverride(other)).toBeNull();
  });
});

describe("what the engine receives", () => {
  const ctx = { ...twinContext(EXPORT) };
  const seed = stamp({ id: "a", kind: "seed", at: { lat: 0, lon: 0 }, population: "pop:w", count: 50, start: 3 });
  const close = stamp({
    id: "b",
    kind: "measure",
    label: "Schools closed",
    layers: [{ layer: "ecole", factor: 0 }],
    at: null,
    radiusKm: 5,
    populations: ["pop:w"],
    start: 10,
    days: 14,
  });
  const heat = stamp({ id: "c", kind: "heat", acuity: "urgence", perThousand: 0.08, start: 20, days: 4 });
  const beds = stamp({ id: "d", kind: "capacity", facility: "f:west", activity: "civiere", amount: 10, start: 5, days: 55 });
  const all = [seed, close, heat, beds];

  it("places the whole head count, with the outbreak where it was stamped", () => {
    const { spread } = engineInput(all, ctx, "full", 60);
    expect(spread!.seeds).toEqual({ "pop:w": { sain: 950, malade: 50 }, "pop:e": { sain: 3000 } });
    expect(spread!.offset).toBe(3);
    expect(spread!.horizon).toBe(57);
  });

  it("moves a measure onto the spread's own clock and keeps its scope", () => {
    const { spread } = engineInput(all, ctx, "full", 60);
    expect(spread!.changes).toEqual([{ layer: "ecole", factor: 0, fromStep: 7, toStep: 20, populations: ["pop:w"] }]);
  });

  it("keeps events in both runs and choices only in the full one", () => {
    const events = engineInput(all, ctx, "events", 60);
    const full = engineInput(all, ctx, "full", 60);
    expect(events.spread!.changes).toEqual([]);
    expect(events.effects.map((e) => e.target)).toEqual(["demand.incidence"]);
    expect(full.effects.map((e) => e.target)).toEqual(["demand.incidence", "resource.capacity"]);
    expect(full.effects[1]).toMatchObject({ select: { facility: ["f:west"], activity: ["civiere"] }, op: "add", value: 10 });
  });

  it("says when it had to simplify, rather than doing it silently", () => {
    const late = { ...seed, id: "e", start: 8, population: "pop:e" } as Stamp;
    expect(engineInput([seed, late], ctx, "full", 60).notes.join(" ")).toMatch(/seeds once/);
    expect(engineInput([close], ctx, "full", 60).notes.join(" ")).toMatch(/no outbreak/i);
  });

  it("shifts a late-starting spread back onto the real calendar", () => {
    const [e] = shiftEffects(
      [{ id: "x", target: "demand.incidence", select: {}, op: "add", value: 1, profile: { start: 2, end: 2, shape: "step", peak: 1 } }],
      3,
    );
    expect(e!.profile).toMatchObject({ start: 5, end: 5 });
  });

  it("reads as sentences, with the weakest evidence named", () => {
    expect(describeStamp(close, ctx).title).toBe("Schools closed, within 5 km (1 catchment)");
    expect(describeStamp(beds, ctx).title).toBe("+10 civiere at West");
    expect(weakestTier(all, ctx)).toBe("Assumption");
    expect(weakestTier([beds], ctx)).toBe("Decision");
  });
});

describe("reading a run back", () => {
  const dataset: SimDataset = {
    name: "facilities",
    label: "",
    description: "",
    columns: ["policy", "step", "facility_id", "facility", "activity", "occupancy", "waiting"],
    rows: [
      ["null", 0, "f:a", "A", "civiere", 0.5, 0],
      ["null", 0, "f:b", "B", "civiere", 1.5, 2],
      ["null", 1, "f:a", "A", "civiere", 0.75, 0],
      ["null", 1, "f:a", "A", "lit", 0.1, 0],
    ],
  };

  it("lays the facilities table out as step by facility, for one activity", () => {
    const g = occupancyGrid(dataset, ["f:a", "f:b"], "civiere", 3);
    expect(g[0]).toEqual([0.5, 1.5]);
    expect(g[1]![0]).toBe(0.75);
    expect(Number.isNaN(g[1]![1]!)).toBe(true);
    expect(g[2]!.every(Number.isNaN)).toBe(true);
  });

  it("weights the island figure by capacity", () => {
    expect(islandSeries([[0.5, 1.5]], [10, 30])[0]).toBeCloseTo((5 + 45) / 40);
  });

  it("puts the spread's sick on the real calendar", () => {
    const s = sickSeries(
      [{ tick: 0, population: "pop:w", states: { malade: 10 }, incidence: {} }],
      { populations: [{ id: "pop:w", name: "", size: 1000, servedBy: [] }], infectious: "malade" },
      3,
      5,
    );
    expect(s["pop:w"]).toEqual([0, 0, 0, 10, 0]);
  });
});
