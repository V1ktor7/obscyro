/**
 * The builder's own arithmetic: exposures against a hand calculation, a saved
 * event coming back as the changes that made it, and files read the way the
 * platform reads them.
 */

import { describe, expect, it } from "vitest";

import type { SimExport } from "@/lib/platform-api";
import { distanceKm } from "./engine";
import { exposureEffects, exposureSeries, newExposure } from "./exposures";
import type { Ctx } from "./format";
import { eventChecks, nextKey, toEffects, toItems, type Item } from "./items";
import { newEffect } from "./model";
import { BUILT_IN, COVID, decodeBytes, guessMapping, parseCsv, perThousand, profileTable, readSeries } from "./profiles";
import { builderTwin } from "./twin";

const ctx: Ctx = { horizon: 60, unit: "day" };

/** Two territories far apart, served by located sites, and care protocols naming two severities. */
function snapshot(): SimExport {
  const res = (activity: string, capacity: number) => ({ [activity]: { id: activity, category: "space" as const, quantity: capacity, capacity, enables: [activity] } });
  return {
    environment: "test", scenario_id: null, generated_at: "2026-11-12T00:00:00Z",
    facilities: [
      { id: "north", name: "Hôpital du Nord", location: [48.45, -68.52], resources: res("lit", 200), census: {} },
      { id: "south", name: "Hôpital du Sud", location: [45.40, -71.89], resources: res("lit", 300), census: {} },
      { id: "nowhere", name: "Clinique sans adresse", location: null, resources: res("lit", 10), census: {} },
    ],
    objects: [
      { id: "p1", type: "Protocole", role: null, properties: { severite: "urgence", ressource: "civiere", sejour: 0.8 }, at: null },
      { id: "p2", type: "Protocole", role: null, properties: { severite: "hospitalisation", ressource: "lit", sejour: 7 }, at: null },
    ],
    object_types: [{ name: "Protocole", role: null, properties: [
      { key: "severite", type: "string", label: null, unit: null, min: null, max: null, behaviour: "state", mechanic: "serves_severity" },
      { key: "ressource", type: "string", label: null, unit: null, min: null, max: null, behaviour: "state", mechanic: "consumes_activity" },
      { key: "sejour", type: "number", label: null, unit: null, min: 0, max: null, behaviour: "level", mechanic: "occupies_for" },
    ] }],
    object_rules: { unavailable_keys: ["status"], unavailable_values: ["occupied"] },
    populations: [
      { id: "rimouski", name: "Rimouski", size: 50000, served_by: ["north"] },
      { id: "sherbrooke", name: "Sherbrooke", size: 170000, served_by: ["south", "nowhere"] },
    ],
    edges: [], gaps: [],
  } as unknown as SimExport;
}

describe("the twin, as the builder reads it", () => {
  const tw = builderTwin(snapshot());
  it("places every territory at the sites serving it, wherever they are", () => {
    expect(tw.popById.get("rimouski")!.loc).toEqual([48.45, -68.52]);
    // The unlocated clinic does not drag Sherbrooke to the middle of nowhere.
    expect(tw.popById.get("sherbrooke")!.loc).toEqual([45.40, -71.89]);
    expect(tw.unlocated).toBe(1);
    expect(tw.bounds).toEqual([[45.40, -71.89], [48.45, -68.52]]);
  });
  it("reads the severities and what each one holds off the care protocols", () => {
    expect(tw.severities.sort()).toEqual(["hospitalisation", "urgence"]);
    expect(tw.protocols.find((p) => p.severity === "hospitalisation")).toMatchObject({ resource: "lit", stay: 7 });
  });
});

describe("an exposure becomes the arrivals a person would compute by hand", () => {
  const tw = builderTwin(snapshot());
  it("usual rate × (RR ^ (rise ÷ increment) − 1), in every territory", () => {
    const x = newExposure(ctx, tw, [], "pm25-asthma-er");
    Object.assign(x, { start: 10, days: 3, rise: { mode: "same", value: 20, series: "", usual: null, episode: null }, base: { value: 0.0137, unit: "day1000", source: "test" } });
    const effs = exposureEffects(x, tw, ctx);
    expect(effs).toHaveLength(1);
    expect(effs[0]!.value).toBe(Number((0.0137 * (1.017 ** 2 - 1)).toPrecision(6)));
    // Lag 1: felt the day after the air changed. No population named: every territory.
    expect(effs[0]!.profile).toMatchObject({ start: 11, end: 13 });
    expect(effs[0]!.select.population).toBeUndefined();
    expect(effs[0]!.select.acuity).toEqual(["urgence"]);
    expect(exposureSeries(x, tw, ctx)[11]).toBeCloseTo(effs[0]!.value as number * 220, 6);
  });
  it("averages the day and the day before when the study did, and fades from a point by distance", () => {
    const x = newExposure(ctx, tw, [], "smoke-asthma-er");
    const at: [number, number] = [48.0, -69.0];
    Object.assign(x, { start: 4, rise: { mode: "series", value: 0, series: "40 90", usual: null, episode: null }, base: { value: 0.0137, unit: "day1000", source: "test" },
      where: { mode: "near", pops: [], each: {}, at, radius: 400 } });
    const f = 1 - distanceKm(at, [48.45, -68.52]) / 400;
    const want = [(40 * f) / 2, (40 * f + 90 * f) / 2, (90 * f) / 2].map((a) => Number((0.0137 * (1.11 ** (a / 10) - 1)).toPrecision(6)));
    const got = exposureEffects(x, tw, ctx).filter((e) => e.select.population?.includes("rimouski")).map((e) => e.value);
    expect(got).toEqual(want);
  });
  it("replays an observed wave per 1,000 residents, scaled", () => {
    const wave = COVID.profiles.find((w) => w.key === "covid-w5")!;
    const x = newExposure(ctx, tw, [], "covid-w5");
    x.scale = 0.5;
    const s = exposureSeries(x, tw, { horizon: 120, unit: "day" });
    expect(s[10]).toBeCloseTo((Number(wave.hosp.central[10]!.toPrecision(6)) * 0.5 * 220000) / 1000, 3);
  });
});

describe("a saved event comes back as the changes that made it", () => {
  const tw = builderTwin(snapshot());
  it("keeps a helper's inputs on its first effect and rebuilds it from them", () => {
    const x = newExposure(ctx, tw, [], "heat-er");
    Object.assign(x, { start: 3, days: 4 });
    const e = newEffect(ctx, tw, [], "capacity", "lit");
    e.value = 0.7;
    const items: Item[] = [{ kind: "exposure", key: nextKey(), x }, { kind: "effect", key: nextKey(), e, mem: {} }];
    const saved = toEffects(items, tw, ctx);
    expect(saved[0]!.builder).toMatchObject({ group: x.id, kind: "exposure" });
    expect(saved[0]!.builder!.inputs).toMatchObject({ coef: "heat-er", start: 3, days: 4 });
    const back = toItems(saved, tw, ctx);
    expect(back).toHaveLength(2);
    expect(back[0]!.kind).toBe("exposure");
    expect(back[0]!.kind === "exposure" && back[0]!.x).toMatchObject({ coef: "heat-er", start: 3, days: 4, id: x.id });
    expect(back[1]!.kind === "effect" && back[1]!.e.value).toBe(0.7);
  });
  it("returns a helper whose coefficient is unknown as plain changes, never dropped", () => {
    const x = newExposure(ctx, tw, [], "heat-er");
    const saved = toEffects([{ kind: "exposure", key: nextKey(), x }], tw, ctx).map((e) => (e.builder?.inputs ? { ...e, builder: { ...e.builder, inputs: { ...e.builder.inputs, coef: "gone" } } } : e));
    const back = toItems(saved, tw, ctx);
    expect(back.every((it) => it.kind === "effect")).toBe(true);
    expect(back).toHaveLength(saved.length);
  });
  it("refuses a change with nothing to compute and an event with no name", () => {
    const x = newExposure(ctx, tw, [], "pm25-asthma-er");
    const { fix } = eventChecks([{ kind: "exposure", key: nextKey(), x }], tw, ctx, "");
    expect(fix.map((f) => f.t)).toEqual(expect.arrayContaining(["Name the event.", expect.stringContaining("no usual rate")]));
  });
});

describe("profiles aim at the open twin, wherever it is", () => {
  const tw = builderTwin(snapshot());
  it("builds every preset on a twin outside Montréal", () => {
    for (const p of BUILT_IN) {
      const items = p.build(ctx, tw, []);
      expect(items.length).toBeGreaterThan(0);
    }
    const water = BUILT_IN.find((p) => p.id === "water")!.build(ctx, tw, [])[0]!;
    expect(water.kind === "exposure" && water.x.where.pops).toEqual(["sherbrooke"]);
  });
});

describe("a series someone brings", () => {
  const archive = [
    "Date,Regroupement,Croisement,Nom,hos_quo_reg_n",
    "Date inconnue,Région,RSS03,03 - Capitale-Nationale,0",
    "2022-01-01,Région,RSS03,03 - Capitale-Nationale,4",
    "2022-01-01,Région,RSS06,06 - Montréal,9",
    "2022-01-02,Région,RSS03,03 - Capitale-Nationale,6",
    "2022-01-02,Région,RSS06,06 - Montréal,11",
  ].join("\n");
  it("guesses the columns, refuses several rows a day, then reads one region", () => {
    const t = profileTable("archive.csv", parseCsv(archive), "text");
    const m = guessMapping(t);
    expect(m).toMatchObject({ dateCol: "Date", countCol: "hos_quo_reg_n", filterCol: "Croisement" });
    expect(readSeries("", t, m).error).toMatch(/Several rows share a day/);
    const r = readSeries("", t, { ...m, filterVal: "RSS03" });
    expect(r.rows).toEqual([["2022-01-01", 4], ["2022-01-02", 6]]);
    expect(r.notes.join(" ")).toMatch(/1 row with no date/);
  });
  it("takes a cumulative total day by day, a fall read as a revision", () => {
    const t = profileTable("cum.csv", parseCsv("date,cas_cum\n2022-01-01,10\n2022-01-02,15\n2022-01-03,14\n2022-01-04,20"), "text");
    const r = readSeries("", t, guessMapping(t));
    expect(r.rows).toEqual([["2022-01-02", 5], ["2022-01-03", 0], ["2022-01-04", 6]]);
  });
  it("refuses dates whose day and month cannot be told apart, and a missing day", () => {
    const amb = profileTable("rt.csv", parseCsv("dates,mean\n07-01-2020,1.2\n08-01-2020,1.1"), "text");
    expect(readSeries("", amb, guessMapping(amb)).error).toMatch(/cannot be told apart/);
    expect(readSeries("2022-01-01,3\n2022-01-03,4", null, guessMapping(amb)).error).toMatch(/2022-01-02 is missing/);
  });
  it("reads Windows-1252 and decimal commas", () => {
    const bytes = new Uint8Array(Buffer.from("date;nb d'arrivées\n2022-01-01;3\n2022-01-02;4,5\n", "latin1")).buffer;
    const { text, encoding } = decodeBytes(bytes);
    expect(encoding).toBe("Windows-1252");
    const t = profileTable("a.csv", parseCsv(text), encoding);
    expect(t.columns).toEqual(["date", "nb d'arrivées"]);
    expect(readSeries("", t, guessMapping(t)).rows).toEqual([["2022-01-01", 3], ["2022-01-02", 4.5]]);
  });
  it("turns counts into a rate per 1,000 residents", () => {
    expect(perThousand([["2022-01-01", 50], ["2022-01-02", 100]], 50000, false)).toEqual([1, 2]);
  });
});
