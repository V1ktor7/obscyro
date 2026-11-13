import { describe, expect, it } from "vitest";

import type { ScenarioOverride } from "../../scenarios-api";
import type { SimDataset, SimExport } from "@/lib/platform-api";

import { arrivalsBySeverity, capacityGrid, islandSeries, occupancyGrid } from "./engine";
import { dateOfDay, realityFromOverrides, realityToOverride, type RealityConfig } from "./reality";
import { breakRows, people, seriesOf, siteBreaks, summarise } from "./results";
import { describe as describeStamp, engineInput, isChoice, isCondition, laneOf, twinContext, type Stamp } from "./stamps";

const stamp = (s: Partial<Stamp> & Pick<Stamp, "kind">): Stamp => ({ id: "s", start: 0, days: 60, ...s }) as Stamp;

// A model with a quiet recovery, two care protocols and two contact layers.
const EXPORT = {
  environment: "x",
  scenario_id: null,
  generated_at: "",
  facilities: [
    { id: "f:a", name: "Alpha", location: [45.5, -73.6], census: {}, resources: { lit: { id: "lit", category: "space", quantity: 100, capacity: 100, enables: ["lit"] } } },
    { id: "f:b", name: "Beta", location: [45.6, -73.5], census: {}, resources: { lit: { id: "lit", category: "space", quantity: 40, capacity: 40, enables: ["lit"] } } },
    { id: "f:c", name: "Clinic", location: [45.55, -73.55], census: {}, resources: { place: { id: "place", category: "space", quantity: 9, capacity: 9, enables: ["place"] } } },
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
    { name: "Protocole", role: null, properties: [{ key: "severite", mechanic: "serves_severity" }, { key: "ressource", mechanic: "consumes_activity" }] },
  ],
  objects: [
    { id: "t1", type: "Transition", role: null, at: null, properties: { de: "sain", vers: "malade", pousse: "malade", voie: "ecole" } },
    { id: "t2", type: "Transition", role: null, at: null, properties: { de: "sain", vers: "malade", pousse: "malade", voie: "travail" } },
    { id: "t3", type: "Transition", role: null, at: null, properties: { de: "malade", vers: "retabli_hospitalise", devient: "hospitalisation" } },
    { id: "t4", type: "Transition", role: null, at: null, properties: { de: "malade", vers: "retabli" } },
    { id: "p1", type: "Protocole", role: null, at: null, properties: { severite: "hospitalisation", ressource: "lit" } },
  ],
  object_rules: { unavailable_keys: [], unavailable_values: [] },
  populations: [
    { id: "pop:w", name: "West", size: 1000, served_by: ["f:a"] },
    { id: "pop:e", name: "East", size: 3000, served_by: ["f:b"] },
  ],
  edges: [],
  gaps: [],
} as unknown as SimExport;

describe("what the twin declares, for the conditions", () => {
  const ctx = twinContext(EXPORT);

  it("finds where the immune sit: the quiet exit from the infectious state that nothing leaves", () => {
    expect(ctx.infectious).toBe("malade");
    expect(ctx.immune).toBe("retabli");
  });

  it("has no such state when every exit asks for care", () => {
    const only = { ...EXPORT, objects: (EXPORT.objects as unknown as { id: string }[]).filter((o) => o.id !== "t4") } as unknown as SimExport;
    expect(twinContext(only).immune).toBeNull();
  });

  it("reads what each severity occupies off the care protocols", () => {
    expect(ctx.care).toEqual([{ acuity: "hospitalisation", activity: "lit" }]);
  });
});

describe("conditions, as the engine receives them", () => {
  const ctx = twinContext(EXPORT);
  const seed = stamp({ id: "a", kind: "seed", at: { lat: 0, lon: 0 }, population: "pop:w", count: 50, days: 1 });
  const immune = stamp({ id: "b", kind: "immunity", share: 0.8 });
  const variant = stamp({ id: "c", kind: "variant", factor: 3.5 });
  const usual = stamp({ id: "d", kind: "occupancy", activity: "lit", share: 0.85 });
  const close = stamp({ id: "e", kind: "measure", label: "Schools closed", layers: [{ layer: "ecole", factor: 0 }], at: null, radiusKm: null, populations: null, start: 10, days: 14 });
  const all = [seed, immune, variant, usual, close];

  it("are neither events on a day nor choices", () => {
    for (const s of [immune, variant, usual]) {
      expect(isCondition(s)).toBe(true);
      expect(isChoice(s)).toBe(false);
      expect(laneOf(s)).toBe("Conditions");
    }
    expect(isChoice(close)).toBe(true);
    expect(isCondition(seed)).toBe(false);
  });

  it("places the immune beside the sick, and everyone else as able to catch it", () => {
    const { spread } = engineInput(all, ctx, "events", 60);
    expect(spread!.seeds).toEqual({
      "pop:w": { sain: 150, malade: 50, retabli: 800 },
      "pop:e": { sain: 600, retabli: 2400 },
    });
  });

  it("never lets the immune share take the people who are sick", () => {
    const most = engineInput([stamp({ ...seed, count: 400 } as Stamp), stamp({ id: "x", kind: "immunity", share: 0.99 })], ctx, "events", 60);
    expect(most.spread!.seeds["pop:w"]).toEqual({ sain: 0, malade: 400, retabli: 600 });
  });

  it("scales every contact layer for the whole run, in both runs", () => {
    const whole = [
      { layer: "ecole", factor: 3.5, fromStep: 0, toStep: null },
      { layer: "travail", factor: 3.5, fromStep: 0, toStep: null },
    ];
    expect(engineInput(all, ctx, "events", 60).spread!.changes).toEqual(whole);
    expect(engineInput(all, ctx, "full", 60).spread!.changes).toEqual([...whole, { layer: "ecole", factor: 0, fromStep: 10, toStep: 23 }]);
  });

  it("starts both runs from the usual occupancy", () => {
    expect(engineInput(all, ctx, "events", 60).occupancy).toEqual({ lit: 0.85 });
    expect(engineInput(all, ctx, "full", 60).occupancy).toEqual({ lit: 0.85 });
    expect(engineInput([seed], ctx, "full", 60).occupancy).toEqual({});
  });

  it("says so when a condition has nothing to act on", () => {
    expect(engineInput([immune, variant], ctx, "events", 60).notes.join(" ")).toMatch(/no outbreak stamped/i);
    const noQuiet = { ...ctx, immune: null };
    expect(engineInput([seed, immune], noQuiet, "events", 60).notes.join(" ")).toMatch(/nowhere to be placed/);
    expect(engineInput([seed, immune], noQuiet, "events", 60).spread!.seeds["pop:w"]).toEqual({ sain: 950, malade: 50 });
  });

  it("reads as sentences", () => {
    expect(describeStamp(usual, ctx).title).toBe("Usual occupancy: 85 % of lit already in use");
    expect(describeStamp(immune, ctx).title).toBe("80 % already immune, everywhere");
    expect(describeStamp(variant, ctx).title).toBe("Variant: contact passes it on ×3.5");
    expect(describeStamp(usual, ctx).tier).toBe("Assumption");
  });
});

describe("reading a run back: the queue, the arrivals, the capacity", () => {
  const facilities: SimDataset = {
    name: "facilities", label: "", description: "",
    columns: ["policy", "step", "facility_id", "facility", "activity", "occupancy", "waiting"],
    rows: [
      ["null", 0, "f:a", "Alpha", "lit", 0.9, 0],
      ["null", 0, "f:b", "Beta", "lit", 1, 3],
      ["null", 1, "f:a", "Alpha", "lit", 1, 0.2],
      ["null", 1, "f:b", "Beta", "lit", 1, 12.5],
      ["null", 2, "f:a", "Alpha", "lit", 0.95, 0],
      ["null", 2, "f:b", "Beta", "lit", 1, 4],
    ],
  };
  const ids = ["f:a", "f:b", "f:c"];
  const ctx = twinContext(EXPORT);

  it("reads the queue from the same table as the occupancy", () => {
    const w = occupancyGrid(facilities, ids, "lit", 3, "waiting");
    expect(w[1]!.slice(0, 2)).toEqual([0.2, 12.5]);
    expect(Number.isNaN(w[0]![2]!)).toBe(true);
  });

  it("reads arrivals per day and severity from the steps table", () => {
    const steps: SimDataset = {
      name: "steps", label: "", description: "",
      columns: ["policy", "step", "deaths", "cost", "arrived_hospitalisation", "served_hospitalisation", "unmet_hospitalisation", "arrived_urgence", "served_urgence", "unmet_urgence"],
      rows: [["null", 0, 0, 0, 25, 25, 0, 60, 60, 0], ["null", 1, 0, 0, 31.5, 30, 1.5, 70, 70, 0]],
    };
    expect(arrivalsBySeverity(steps, 3)).toEqual({ hospitalisation: [25, 31.5, 0], urgence: [60, 70, 0] });
    expect(arrivalsBySeverity(undefined, 3)).toEqual({});
  });

  it("counts added beds from the day they open, in the planner's run only", () => {
    const beds = stamp({ id: "k", kind: "capacity", facility: "f:b", activity: "lit", amount: 20, start: 1 });
    expect(capacityGrid(ctx.facilities, [beds], "events", "lit", 3)).toEqual([[100, 40, 0], [100, 40, 0], [100, 40, 0]]);
    expect(capacityGrid(ctx.facilities, [beds], "full", "lit", 3)).toEqual([[100, 40, 0], [100, 60, 0], [100, 60, 0]]);
  });

  it("weights the island figure by the capacity of each day", () => {
    // Day 0: 90 of 100 and 40 of 40. Day 1: 100 of 100 and 60 of 60 once the beds are in.
    const grid = [[0.9, 1, Number.NaN], [1, 1, Number.NaN]];
    const s = islandSeries(grid, [[100, 40, 0], [100, 60, 0]]);
    expect(s[0]).toBeCloseTo(130 / 140);
    expect(s[1]).toBeCloseTo(1);
    expect(islandSeries([[0.5, 1.5]], [10, 30])[0]).toBeCloseTo((5 + 45) / 40);
  });

  it("says where somebody waits, from which day and how many", () => {
    const v = { occupancy: occupancyGrid(facilities, ids, "lit", 3), waiting: occupancyGrid(facilities, ids, "lit", 3, "waiting") };
    const breaks = siteBreaks(v, ctx.facilities, "lit");
    // The clinic holds no bed, so it is not a site that could break.
    expect(breaks.map((b) => b.name)).toEqual(["Alpha", "Beta"]);
    // 0.2 of a patient is arithmetic, not somebody waiting.
    expect(breaks[0]).toMatchObject({ firstDay: null, days: 0, waitingDays: 0, peakOccupancy: 1 });
    expect(breaks[1]).toMatchObject({ firstDay: 0, days: 3, peakWaiting: 12.5, peakDay: 1, waitingDays: 19.5 });
    expect(summarise(breaks, v)).toEqual({ sites: 1, of: 2, firstDay: 0, waitingDays: 19.5, peakWaiting: 12.5, peakDay: 1 });
  });

  it("lists both runs side by side, the planner's worst first, relieved sites last", () => {
    const b = (index: number, name: string, firstDay: number | null, waitingDays: number) =>
      ({ index, id: `f${index}`, name, capacity: 10, firstDay, days: firstDay === null ? 0 : 5, peakWaiting: waitingDays / 2, peakDay: 9, waitingDays, peakOccupancy: 1 });
    const rows = breakRows(
      [b(0, "Held", null, 0), b(1, "Relieved", 4, 30), b(2, "Late", 6, 80), b(3, "Early", 6, 90)],
      [b(0, "Held", null, 0), b(1, "Relieved", null, 0), b(2, "Late", 12, 20), b(3, "Early", 8, 40)],
    );
    expect(rows.map((r) => r.name)).toEqual(["Early", "Late", "Relieved"]);
  });

  it("pulls one site's series out of a grid, and writes people as people", () => {
    expect(seriesOf([[1, 2], [3, 4]], 1)).toEqual([2, 4]);
    expect(people(0.4)).toBe("under 1");
    expect(people(1234.6)).toBe("1,235");
  });
});

describe("a scenario's reality check", () => {
  const config: RealityConfig = { datasetId: "d1", datasetName: "INSPQ", when: "date", value: "admissions_hopital", origin: "2021-12-13", acuity: "hospitalisation" };
  const override = (over: Partial<ScenarioOverride>): ScenarioOverride => ({
    id: "o1", scenarioId: "s", seq: 1, targetType: "param", targetId: null, targetLocalKey: "reality", op: "set_param",
    payload: {}, effectiveOffsetHours: 0, durationHours: null, note: null, ...over,
  });

  it("round-trips through a parameter override", () => {
    const body = realityToOverride(config);
    const back = realityFromOverrides([override({ id: "o9", payload: body.payload })]);
    expect(back).toEqual({ id: "o9", config });
  });

  it("is not mistaken for a stamp, nor a stamp for it", () => {
    expect(realityFromOverrides([override({ payload: { key: "stamp:abc", value: { kind: "heat" } } })])).toBeNull();
    expect(realityFromOverrides([override({ payload: { key: "reality", value: { datasetId: "d1" } } })])).toBeNull();
  });

  it("keeps the last one written", () => {
    const a = override({ id: "a", payload: realityToOverride(config).payload });
    const b = override({ id: "b", payload: realityToOverride({ ...config, origin: "2021-12-20" }).payload });
    expect(realityFromOverrides([a, b])!.config.origin).toBe("2021-12-20");
  });

  it("puts a day of the run on the calendar", () => {
    expect(dateOfDay("2021-12-13", 0)).toBe("2021-12-13");
    expect(dateOfDay("2021-12-13", 24)).toBe("2022-01-06");
  });
});
