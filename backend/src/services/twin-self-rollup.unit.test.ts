import assert from "node:assert/strict";
import { test } from "node:test";

import { selfRollup, type SiteInstance } from "./twin.js";
import type { MetricDef } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// What these buy: the map paints a site grey when it has no reading, and grey
// has to keep meaning that. An air quality station has nothing standing in it,
// so the place roll-up returns nothing for it — and the sensor that is at this
// moment reporting an index of 16 would draw as "nobody knows".
//
// The dangerous half is the other direction. Every one of 1 590 installations
// also has nothing standing in it, and none of them measures anything. What
// separates the two is whether a metric reads that type at all, which is not
// the same question as whether a metric returned a number: `count` returns 0
// over an empty match, truthfully, for every site in the province.
// ---------------------------------------------------------------------------

const IQA: MetricDef = {
  key: "iqa",
  label: "Indice de la qualité de l'air",
  objectType: "OrgUnit",
  unit: "number",
  numerator: { ofType: "StationAirQualite", agg: "max", property: "iqa" },
};

const OCCUPANCY: MetricDef = {
  key: "occupancy",
  label: "Occupation des civières",
  objectType: "OrgUnit",
  unit: "percent",
  numerator: { ofType: "ReleveUrgence", agg: "sum", property: "civieres_occupees" },
  denominator: { ofType: "ReleveUrgence", agg: "sum", property: "civieres_fonctionnelles" },
};

const BEDS: MetricDef = {
  key: "beds",
  label: "Lits",
  objectType: "OrgUnit",
  unit: "count",
  numerator: { ofType: "Lit", agg: "count" },
};

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);

function station(props: Record<string, unknown> = {}): SiteInstance {
  return {
    typeName: "StationAirQualite",
    properties: { station: "80", iqa: 16, latitude: 45.54, longitude: -73.57, ...props },
    propertySchema: [
      { key: "station", type: "string" },
      { key: "iqa", type: "number" },
      { key: "latitude", type: "number" },
      { key: "longitude", type: "number" },
    ],
    updatedAt: new Date(NOW - 3_600_000),
  };
}

function installation(): SiteInstance {
  return {
    typeName: "Installation",
    properties: { name: "HÔPITAL MAISONNEUVE-ROSEMONT", instal_cod: "51232130" },
    propertySchema: [
      { key: "name", type: "string" },
      { key: "instal_cod", type: "string" },
    ],
    updatedAt: new Date(NOW - 3_600_000),
  };
}

test("a station reports the index it is holding", () => {
  const m = selfRollup("s1", station(), [IQA, OCCUPANCY], NOW);
  assert.ok(m, "a site a metric reads should measure itself");
  assert.equal(m.values.iqa, 16);
});

test("a metric that reads nothing here stays null, not zero", () => {
  // The station has no stretchers. "No reading" and "0%" are different claims
  // and only one of them is true.
  const m = selfRollup("s1", station(), [IQA, OCCUPANCY], NOW)!;
  assert.equal(m.values.occupancy, null);
  assert.equal(m.occupancyPct, null);
});

test("an installation nothing stands on is left exactly as it was", () => {
  // The whole province is in this case. Returning a metrics object here would
  // report every hospital as holding one instance of itself.
  assert.equal(selfRollup("i1", installation(), [IQA, OCCUPANCY], NOW), null);
});

test("a count metric does not make every site self-measured", () => {
  // `count` answers 0 over an empty match — a true answer, and the reason
  // "did a metric produce a number" is the wrong test. Ask the selector.
  assert.equal(selfRollup("i1", installation(), [BEDS], NOW), null);
});

test("no metrics at all means nothing measures itself", () => {
  assert.equal(selfRollup("s1", station(), [], NOW), null);
});

test("the instance counted is the site itself, once", () => {
  const m = selfRollup("s1", station(), [IQA], NOW)!;
  assert.equal(m.linkedInstanceCount, 1);
  assert.deepEqual(m.instanceCountByType, { StationAirQualite: 1 });
  assert.equal(m.unitId, "s1");
});

test("age is the age of the instance", () => {
  const m = selfRollup("s1", station(), [IQA], NOW)!;
  assert.equal(m.fetchedAgeSeconds, 3600);
});

test("freshness says undeclared when no property carries the time of the reading", () => {
  // The station publishes a date and an hour, but the type does not declare
  // either as the observation stamp. "Unknown" is the honest answer; a
  // fabricated one would make a stale sensor look current.
  const m = selfRollup("s1", station(), [IQA], NOW)!;
  assert.equal(m.freshnessBasis, "undeclared");
  assert.equal(m.freshnessSeconds, null);
});

test("freshness is read from the declared stamp when there is one", () => {
  const inst = station({ releve_a: "2026-09-14T09:00:00Z" });
  inst.propertySchema = [
    ...inst.propertySchema,
    { key: "releve_a", type: "string", observedAt: true },
  ];
  const m = selfRollup("s1", inst, [IQA], NOW)!;
  assert.equal(m.freshnessBasis, "observed");
  assert.equal(m.freshnessSeconds, 3 * 3600);
});

test("a missing index reads as absent, never as a calm zero", () => {
  const inst = station({ iqa: null });
  const m = selfRollup("s1", inst, [IQA], NOW);
  assert.ok(m, "the type is still one the metric reads");
  assert.equal(m.values.iqa, null);
});

test("numeric properties are carried through as their own value", () => {
  const m = selfRollup("s1", station(), [IQA], NOW)!;
  assert.equal(m.numericMeans.iqa, 16);
  assert.equal(m.numericMeans.station, undefined);
});
