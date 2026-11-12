/**
 * The previews against the engine they preview.
 *
 * `__fixtures__/engine-cases.json` was produced by running random effects
 * through simulation-service/app/events itself (TemporalProfile.magnitude_at,
 * Effect.value_for with distance, Engine._resolve, Engine._arrivals,
 * objects.matching). If a number here disagrees, the builder is showing
 * something the engine will not do.
 */

import { describe, expect, it } from "vitest";

import type { SimEffect, TemporalProfile } from "@/lib/platform-api";
import cases from "./__fixtures__/engine-cases.json";
import { arrivalsAt, magnitudeAt, matching, resolve, valueFor, type LatLon, type PlainObject } from "./engine";

type Num = number | null;
const close = (a: Num, b: Num) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)));
const C = cases as unknown as {
  cases: {
    magnitude: { p: TemporalProfile; want: number[] }[];
    value: { e: SimEffect; locs: (LatLon | null)[]; want: Num[][] }[];
    resolve: { effects: SimEffect[]; want: { dims: Record<string, string>; loc: LatLon | null; base: number; v: number[] }[] }[];
    arrivals: { effects: SimEffect[]; want: Record<string, number>[] }[];
    matching: { objs: PlainObject[]; e: SimEffect; want: string[] }[];
  };
  pops: Record<string, number>;
  sevs: string[];
};

describe("the previews compute what the engine computes", () => {
  it("over time (magnitude_at)", () => {
    let n = 0;
    for (const c of C.cases.magnitude) c.want.forEach((w, k) => { expect(close(magnitudeAt(c.p, k * 2), w)).toBe(true); n++; });
    expect(n).toBeGreaterThan(1000);
  });

  it("over distance (value_for with an epicentre, a radius, a fade and a front)", () => {
    for (const c of C.cases.value) {
      c.locs.forEach((loc, i) => c.want[i]!.forEach((w, k) => expect(close(valueFor(c.e, k * 7, loc), w)).toBe(true)));
    }
  });

  it("where several changes meet (_resolve: set, then multiply, then add)", () => {
    for (const c of C.cases.resolve) {
      for (const w of c.want) w.v.forEach((v, k) => expect(close(resolve("resource.capacity", w.base, w.dims, w.loc, k * 8, c.effects, 0), v)).toBe(true));
    }
  });

  it("for arrivals (_arrivals: split across severities, net never below zero)", () => {
    const pops = Object.entries(C.pops).map(([id, size]) => ({ id, size }));
    for (const c of C.cases.arrivals) {
      c.want.forEach((w, k) => {
        const got = Object.fromEntries(arrivalsAt(k * 8, c.effects, pops, C.sevs));
        expect(Object.keys(got).sort()).toEqual(Object.keys(w).sort());
        for (const key of Object.keys(w)) expect(close(got[key]!, w[key]!)).toBe(true);
      });
    }
  });

  it("for objects (matching: by id, reach as a share or a count)", () => {
    for (const c of C.cases.matching) {
      const objs = c.objs.map((o) => ({ ...o, properties: {} }));
      expect(matching(c.e, objs).hits.map((o) => o.id)).toEqual(c.want);
    }
  });
});
