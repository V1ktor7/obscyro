import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_OCCUPANCY,
  aggregate,
  evaluateMetric,
  validateMetric,
  type MetricDef,
  type MetricInstance,
} from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// What these buy: a metric is a definition over a subtree, so a parent's number
// is right by construction rather than averaged from its children afterwards.
// The old roll-up computed the correct value and then overwrote it with a mean
// of means; the last test here is the case that exposed it.
// ---------------------------------------------------------------------------

function bed(status: string): MetricInstance {
  return { typeName: "Bed", properties: { status } };
}

test("occupancy is occupied beds over total beds", () => {
  const ward = [bed("occupied"), bed("occupied"), bed("free"), bed("free")];
  assert.equal(evaluateMetric(DEFAULT_OCCUPANCY, ward), 50);
});

test("status matching ignores case and surrounding space", () => {
  const ward = [bed(" Occupied "), bed("free")];
  assert.equal(evaluateMetric(DEFAULT_OCCUPANCY, ward), 50);
});

test("a unit with no beds has no occupancy, not zero", () => {
  assert.equal(evaluateMetric(DEFAULT_OCCUPANCY, []), null);
  assert.equal(evaluateMetric(DEFAULT_OCCUPANCY, [{ typeName: "Patient", properties: {} }]), null);
});

test("the engine does not know what a bed is", () => {
  // The same shape in French, which the hard-coded version returned null for.
  const french: MetricDef = {
    key: "occupation",
    label: "Occupation",
    objectType: "OrgUnit",
    unit: "percent",
    numerator: {
      ofType: "Lit",
      where: [{ property: "statut", equals: "occupé" }],
      agg: "count",
    },
    denominator: { ofType: "Lit", agg: "count" },
  };
  const unit: MetricInstance[] = [
    { typeName: "Lit", properties: { statut: "occupé" } },
    { typeName: "Lit", properties: { statut: "occupé" } },
    { typeName: "Lit", properties: { statut: "libre" } },
    { typeName: "Lit", properties: { statut: "libre" } },
  ];
  assert.equal(evaluateMetric(french, unit), 50);
});

test("admitted patients over beds is the same machinery", () => {
  const def: MetricDef = {
    key: "pressure",
    label: "Pressure",
    objectType: "OrgUnit",
    unit: "percent",
    numerator: {
      ofType: "Patient",
      where: [{ property: "status", equals: "admitted" }],
      agg: "count",
    },
    denominator: { ofType: "Bed", agg: "count" },
  };
  const unit: MetricInstance[] = [
    { typeName: "Patient", properties: { status: "admitted" } },
    { typeName: "Patient", properties: { status: "admitted" } },
    { typeName: "Patient", properties: { status: "waiting" } },
    bed("occupied"),
    bed("free"),
  ];
  // Two admitted over two beds — a unit can be over 100%, and should read so.
  assert.equal(evaluateMetric(def, unit), 100);
});

test("a plain count needs no denominator", () => {
  const def: MetricDef = {
    key: "staff_available",
    label: "Staff available",
    objectType: "OrgUnit",
    unit: "count",
    numerator: {
      ofType: "Staff",
      where: [{ property: "available", equals: "true" }],
      agg: "count",
    },
  };
  const unit: MetricInstance[] = [
    { typeName: "Staff", properties: { available: true } },
    { typeName: "Staff", properties: { available: true } },
    { typeName: "Staff", properties: { available: false } },
  ];
  assert.equal(evaluateMetric(def, unit), 2);
});

test("numeric aggregates read the property, and the mean of nothing is null", () => {
  const waits: MetricInstance[] = [
    { typeName: "Patient", properties: { waitMinutes: 10 } },
    { typeName: "Patient", properties: { waitMinutes: 50 } },
    { typeName: "Patient", properties: {} },
  ];
  assert.equal(aggregate(waits, { ofType: "Patient", agg: "mean", property: "waitMinutes" }), 30);
  assert.equal(aggregate(waits, { ofType: "Patient", agg: "max", property: "waitMinutes" }), 50);
  assert.equal(aggregate(waits, { ofType: "Patient", agg: "sum", property: "waitMinutes" }), 60);
  assert.equal(aggregate([], { ofType: "Patient", agg: "mean", property: "waitMinutes" }), null);
  assert.equal(aggregate([], { ofType: "Patient", agg: "count" }), 0);
});

test("a definition that cannot produce a number is rejected", () => {
  const noProp = validateMetric({
    key: "k",
    label: "l",
    objectType: "OrgUnit",
    unit: "number",
    numerator: { ofType: "Patient", agg: "mean" },
  });
  assert.equal(noProp.length, 1);
  assert.equal(noProp[0]!.field, "numerator");

  const percentWithoutBasis = validateMetric({
    key: "k",
    label: "l",
    objectType: "OrgUnit",
    unit: "percent",
    numerator: { ofType: "Bed", agg: "count" },
  });
  assert.equal(percentWithoutBasis.length, 1);
  assert.equal(percentWithoutBasis[0]!.field, "denominator");

  assert.deepEqual(validateMetric(DEFAULT_OCCUPANCY), []);
});

test("a parent is its whole subtree, not the average of its children", () => {
  // The case the old roll-up got wrong: one tiny full ward, one large half-full
  // ward. Averaging the two percentages gives 75%. The truth is 102/202.
  const tiny = [bed("occupied"), bed("occupied")];
  const large = [
    ...Array.from({ length: 100 }, () => bed("occupied")),
    ...Array.from({ length: 100 }, () => bed("free")),
  ];

  assert.equal(evaluateMetric(DEFAULT_OCCUPANCY, tiny), 100);
  assert.equal(evaluateMetric(DEFAULT_OCCUPANCY, large), 50);

  const hospital = evaluateMetric(DEFAULT_OCCUPANCY, [...tiny, ...large])!;
  assert.ok(Math.abs(hospital - 50.495) < 0.01, `expected ~50.5%, got ${hospital}`);

  // And it does not depend on the order the wards arrive in.
  const reversed = evaluateMetric(DEFAULT_OCCUPANCY, [...large, ...tiny])!;
  assert.equal(hospital, reversed);
});
