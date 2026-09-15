import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { qualifiersOf, type MetricDef, type MetricInstance } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// What a number is about.
//
// Eight air quality stations, and one of them reads 7 while the others read 14.
// The map showed that as a clean spatial difference. It is one — but the 7 is
// an index driven by fine particles and the 14s by ozone, and those do not ask
// the same thing of a hospital: particles and ozone reach different patients.
// The index is comparable; what to do about it is not.
//
// The qualifier is not a second metric. It is the property of the instance the
// number came from that says what the number is about — the pollutant here, the
// target of an assay in the wastewater feed. Declared on the metric, in the
// institution's own vocabulary, so nothing here knows what a pollutant is.
// ---------------------------------------------------------------------------

const IQA: MetricDef = {
  key: "iqa",
  label: "Indice",
  objectType: "OrgUnit",
  unit: "number",
  numerator: { ofType: "Station", agg: "max", property: "iqa" },
  qualifiedBy: "polluant",
};

const st = (iqa: number | null, polluant: string | null): MetricInstance => ({
  typeName: "Station",
  properties: { iqa, polluant },
});

describe("what a reading is about", () => {
  it("names the pollutant behind a single station's index", () => {
    assert.deepEqual(qualifiersOf(IQA, [st(7, "PM2.5")]), ["PM2.5"]);
  });

  it("names the one that decided a max, not all of them", () => {
    // The number is that station's number. Listing both would label it with a
    // pollutant that had nothing to do with it.
    assert.deepEqual(qualifiersOf(IQA, [st(7, "PM2.5"), st(15, "O3")]), ["O3"]);
  });

  it("names the one that decided a min", () => {
    const def = { ...IQA, numerator: { ...IQA.numerator, agg: "min" as const } };
    assert.deepEqual(qualifiersOf(def, [st(7, "PM2.5"), st(15, "O3")]), ["PM2.5"]);
  });

  it("keeps the first on a tie, as the aggregate does", () => {
    assert.deepEqual(qualifiersOf(IQA, [st(15, "O3"), st(15, "PM2.5")]), ["O3"]);
  });

  it("ignores an instance with nothing to aggregate", () => {
    // An empty cell is absent, not zero — the same rule the aggregate follows,
    // or the qualifier would name a station that did not report.
    assert.deepEqual(qualifiersOf(IQA, [st(null, "NO2"), st(9, "O3")]), ["O3"]);
  });

  it("lists every contributor when the number is made of all of them", () => {
    const def: MetricDef = {
      ...IQA,
      numerator: { ofType: "Station", agg: "sum", property: "iqa" },
    };
    assert.deepEqual(qualifiersOf(def, [st(7, "PM2.5"), st(15, "O3"), st(3, "O3")]), [
      "O3",
      "PM2.5",
    ]);
  });

  it("counts what it selected, qualifiers and all", () => {
    const def: MetricDef = {
      ...IQA,
      numerator: { ofType: "Station", agg: "count" },
    };
    assert.deepEqual(qualifiersOf(def, [st(7, "PM2.5"), st(15, "O3")]), ["O3", "PM2.5"]);
  });

  it("says nothing when the metric declares no qualifier", () => {
    const def = { ...IQA, qualifiedBy: undefined };
    assert.deepEqual(qualifiersOf(def, [st(7, "PM2.5")]), []);
  });

  it("says nothing when the instance carries no qualifier", () => {
    assert.deepEqual(qualifiersOf(IQA, [st(7, null)]), []);
    assert.deepEqual(qualifiersOf(IQA, [st(7, "  ")]), []);
  });

  it("ignores instances the metric does not read", () => {
    const other: MetricInstance = { typeName: "Releve", properties: { polluant: "SO2" } };
    assert.deepEqual(qualifiersOf(IQA, [other, st(7, "PM2.5")]), ["PM2.5"]);
  });

  it("says nothing when nothing was read at all", () => {
    assert.deepEqual(qualifiersOf(IQA, []), []);
  });
});
