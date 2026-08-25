import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventFromRows } from "./sim-event-from-rows.js";

const MAP = {
  when: "date",
  count: "admissions_hopital",
  acuity: "hospitalisation",
  population: "pop:mtl",
  origin: "2021-12-01",
};

const ROWS = [
  { date: "2021-12-01", admissions_hopital: "12" },
  { date: "2021-12-02", admissions_hopital: "18" },
  { date: "2021-12-04", admissions_hopital: "27" },
];

describe("reading an observed time series as an event", () => {
  it("places each day on the step it actually was", () => {
    // A file with a gap has a gap. Compacting the rows would slide the wave
    // forward and every date on screen would name the wrong day.
    const out = eventFromRows(ROWS, MAP);
    assert.deepEqual(
      out.effects.map((e) => (e.profile as { start: number }).start),
      [0, 1, 3],
    );
  });

  it("counts arrivals flat rather than per thousand people", () => {
    // `demand.incidence` would need a catchment size, which means picking a
    // population figure the published file does not carry. A count of arrivals
    // needs nothing the file does not already say.
    const [first] = eventFromRows(ROWS, MAP).effects;
    assert.equal(first!.target, "demand.volume");
    assert.equal(first!.value, 12);
  });

  it("runs to the last day it was given, not one short", () => {
    assert.equal(eventFromRows(ROWS, MAP).horizon, 4);
  });

  it("takes step zero from the caller rather than the earliest row", () => {
    // A file that happens to start three days late would silently shift the
    // whole event, and a comparison against another would be three days out
    // with nothing on screen to show for it.
    const late = eventFromRows(ROWS, { ...MAP, origin: "2021-11-28" });
    assert.equal((late.effects[0]!.profile as { start: number }).start, 3);
  });

  it("counts the rows it could not use instead of dropping them quietly", () => {
    // A file half blank and a file half zeros draw the same flat curve and
    // mean different things.
    const out = eventFromRows(
      [...ROWS, { date: "2021-12-05", admissions_hopital: "" }, { date: "", admissions_hopital: "9" }],
      MAP,
    );
    assert.equal(out.effects.length, 3);
    assert.equal(out.skipped, 2);
  });

  it("refuses to place a day before step zero", () => {
    const out = eventFromRows([{ date: "2021-11-30", admissions_hopital: "5" }], MAP);
    assert.equal(out.effects.length, 0);
    assert.equal(out.skipped, 1);
  });

  it("takes a repeated date once rather than doubling that day", () => {
    // Two rows for one day in one catchment is a duplicated row, and adding
    // both would put a spike in the curve that never happened.
    const out = eventFromRows(
      [{ date: "2021-12-01", admissions_hopital: "12" }, { date: "2021-12-01", admissions_hopital: "12" }],
      MAP,
    );
    assert.equal(out.effects.length, 1);
    assert.equal(out.skipped, 1);
  });

  it("gives every effect an id carrying its own date", () => {
    // Effect ids appear in the trace as the reason something happened, and the
    // date is what makes one readable next to a published curve.
    assert.equal(eventFromRows(ROWS, MAP).effects[0]!.id, "obs-hospitalisation-2021-12-01");
  });

  it("reports what the run covers and how much arrived", () => {
    const out = eventFromRows(ROWS, MAP);
    assert.equal(out.first, "2021-12-01");
    assert.equal(out.last, "2021-12-04");
    assert.equal(out.total, 57);
  });

  it("returns an empty event rather than throwing on an empty file", () => {
    const out = eventFromRows([], MAP);
    assert.deepEqual(out.effects, []);
    assert.equal(out.horizon, 0);
  });
});
