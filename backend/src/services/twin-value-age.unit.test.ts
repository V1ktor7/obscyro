import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import type { EnvInstanceRow, EnvLinkRow } from "./ontology.js";
import type { PropertyDef, SimRole } from "./property-schema.js";
import { metricLooksAt, metricReads, type MetricDef } from "./twin-metrics.js";
import { evaluateAlerts, measureReads, rollupFrom, selfRollup, valueAgeOf, type TwinAlertRuleRow } from "./twin.js";

// ---------------------------------------------------------------------------
// The age of a value is the age of what its measure reads.
//
// A unit's own age answers "is everything under this unit up to date", and
// takes the oldest of all its sources. An alert is about one value. Nineteen
// emergency departments carry an air quality station besides their stretcher
// census: their occupancy alerts were dated by the station, two hours old for a
// census published fourteen minutes earlier. And where the other source is the
// only one with a stamp, a value would borrow an age it does not have, in the
// direction that reassures.
//
// One small twin, shaped like those departments, and the same questions asked
// of the roll-up and of the evaluator.
// ---------------------------------------------------------------------------

const MTL = "America/Toronto";
/** 11:59 in Montréal, a November morning: 16:59 UTC. */
const NOW = Date.parse("2026-11-19T16:59:00Z");

const CENSUS_SCHEMA: PropertyDef[] = [
  { key: "civieres_occupees", type: "number" },
  { key: "civieres_fonctionnelles", type: "number" },
  { key: "mise_a_jour", type: "string", observedAt: true, observedAtZone: MTL },
];
const AIR_SCHEMA: PropertyDef[] = [
  { key: "iqa", type: "number" },
  { key: "releve_a", type: "string", observedAt: true, observedAtZone: MTL },
];
/** A weekly wastewater reading: nothing on it is declared as the time of the reading. */
const WATER_SCHEMA: PropertyDef[] = [{ key: "indice", type: "number" }];
const BED_SCHEMA: PropertyDef[] = [
  { key: "status", type: "string" },
  { key: "vu_a", type: "string", observedAt: true, observedAtZone: MTL },
];

const inst = (
  id: string,
  typeName: string,
  propertySchema: PropertyDef[],
  properties: Record<string, unknown>,
  simRole: SimRole | null = null,
): EnvInstanceRow => ({
  id,
  typeId: `type:${typeName}`,
  typeName,
  properties,
  provenance: {},
  propertySchema,
  simRole,
  createdAt: new Date(NOW - 86_400_000),
  updatedAt: new Date(NOW - 4_000),
});

const at = (thing: EnvInstanceRow, unit: string): EnvLinkRow => ({
  id: `${thing.id}@${unit}`,
  linkTypeName: "located_in",
  aggregates: "metrics",
  aggregateToward: "target",
  transitive: false,
  fromInstanceId: thing.id,
  toInstanceId: unit,
  fromTypeName: thing.typeName,
  toTypeName: "OrgUnit",
});

const OCCUPANCY: MetricDef = {
  key: "occupancy",
  label: "Occupation des civières",
  objectType: "OrgUnit",
  unit: "percent",
  numerator: { ofType: "ReleveUrgence", agg: "sum", property: "civieres_occupees" },
  denominator: { ofType: "ReleveUrgence", agg: "sum", property: "civieres_fonctionnelles" },
};
const IQA: MetricDef = {
  key: "iqa",
  label: "Indice de la qualité de l'air",
  objectType: "OrgUnit",
  unit: "number",
  numerator: { ofType: "StationAirQualite", agg: "max", property: "iqa" },
};
const WATER: MetricDef = {
  key: "charge_eaux_usees",
  label: "Charge des eaux usées",
  objectType: "OrgUnit",
  unit: "number",
  numerator: { ofType: "ReleveEauxUsees", agg: "max", property: "indice" },
};
const DEFS = [OCCUPANCY, IQA, WATER];

/** The census published at 11:45, fourteen minutes ago. */
const census = (stamp: unknown = "2026-11-19T11:45") =>
  inst("census", "ReleveUrgence", CENSUS_SCHEMA, { civieres_occupees: 42, civieres_fonctionnelles: 32, mise_a_jour: stamp });
/** The station read at 10:00, a hundred and nineteen minutes ago. */
const station = (stamp: unknown = "2026-11-19T10:00") => inst("air", "StationAirQualite", AIR_SCHEMA, { iqa: 61, releve_a: stamp });
const water = () => inst("water", "ReleveEauxUsees", WATER_SCHEMA, { indice: 1.4 });

/** One unit, `u1`, with these things under it. */
function unitWith(things: EnvInstanceRow[], also: string[] = [], defs: MetricDef[] = DEFS) {
  const unit = inst("u1", "OrgUnit", [], { name: "Urgence A" });
  return rollupFrom([{ id: "u1" }], [], [unit, ...things], things.map((t) => at(t, "u1")), defs, NOW, also).get("u1")!;
}

test("the age of a value is the age of what its measure reads, not of the unit", () => {
  const m = unitWith([census(), station()]);
  // The unit, as a whole: as old as its oldest source. Unchanged, and still what the unit's card shows.
  assert.equal(m.freshnessSeconds, 119 * 60);
  assert.equal(m.freshnessBasis, "observed");
  // The occupancy: the census, and only the census.
  assert.deepEqual(m.valueAges.occupancy, { seconds: 14 * 60, basis: "observed" });
  // The air index: the station.
  assert.deepEqual(m.valueAges.iqa, { seconds: 119 * 60, basis: "observed" });
  assert.deepEqual(valueAgeOf(m, "occupancy"), { seconds: 14 * 60, basis: "observed" });
});

test("a value does not borrow the age of another source", () => {
  // The wastewater reading declares no time. The station beside it does.
  const m = unitWith([water(), station()]);
  // The unit's age only counts the stamps that are declared, so it reads as the station's.
  assert.deepEqual([m.freshnessSeconds, m.freshnessBasis], [119 * 60, "observed"]);
  // The wastewater value has no age, and says why: it must not be shown as two hours old.
  assert.deepEqual(m.valueAges.charge_eaux_usees, { seconds: null, basis: "undeclared" });
  assert.deepEqual(m.valueAges.iqa, { seconds: 119 * 60, basis: "observed" });
});

test("a value whose own source published nothing readable has no age, even beside a source that did", () => {
  // The minutes never arrived. The unit keeps a floor from the station; the occupancy has nothing.
  const m = unitWith([census("2026-11-19T9:"), station()]);
  assert.deepEqual([m.freshnessSeconds, m.freshnessBasis], [119 * 60, "partial"]);
  assert.deepEqual(m.valueAges.occupancy, { seconds: null, basis: "unreadable" });
});

test("before ten in the morning the census has an age, and so does its alert", () => {
  // 9:37 in Montréal. The file writes the hour with one digit until ten.
  const morning = Date.parse("2026-11-19T14:37:00Z");
  const things = [census("2026-11-19T8:45"), station("2026-11-19T08:00")];
  const unit = inst("u1", "OrgUnit", [], { name: "Urgence A" });
  const m = rollupFrom([{ id: "u1" }], [], [unit, ...things], things.map((t) => at(t, "u1")), DEFS, morning).get("u1")!;
  assert.deepEqual(m.valueAges.occupancy, { seconds: 52 * 60, basis: "observed" });
  // And the unit as a whole is no longer a floor: both of its sources are read.
  assert.deepEqual([m.freshnessSeconds, m.freshnessBasis], [97 * 60, "observed"]);
});

test("a measure is dated only where it has a value", () => {
  const m = unitWith([census()]);
  assert.deepEqual(Object.keys(m.valueAges), ["occupancy"]);
  // Nothing under a unit: nothing to date.
  assert.deepEqual(unitWith([]).valueAges, {});
});

test("a measure fed by two sources still takes the older, and still says when that is a floor", () => {
  // One census stamped an hour before the other, under two property names.
  const older = inst("census-b", "ReleveUrgence", [
    { key: "civieres_occupees", type: "number" },
    { key: "civieres_fonctionnelles", type: "number" },
    { key: "extrait_a", type: "string", observedAt: true, observedAtZone: MTL },
  ], { civieres_occupees: 10, civieres_fonctionnelles: 10, extrait_a: "2026-11-19T10:45" });
  assert.deepEqual(unitWith([census(), older]).valueAges.occupancy, { seconds: 74 * 60, basis: "observed" });
  const silent = { ...older, properties: { ...older.properties, extrait_a: null } };
  assert.deepEqual(unitWith([census(), silent]).valueAges.occupancy, { seconds: 14 * 60, basis: "partial" });
});

// --- what a measure looks at --------------------------------------------------

const bed = (id: string, status: string, seen: string) => inst(id, "Lit", BED_SCHEMA, { status, vu_a: seen }, "space");

test("a count is as old as everything it looked at, not only what it kept", () => {
  const CLOSED: MetricDef = {
    key: "closed_beds",
    label: "Closed beds",
    objectType: "OrgUnit",
    unit: "count",
    numerator: { ofType: "Lit", agg: "count", where: [{ property: "status", equals: "closed" }] },
  };
  const closed = bed("b1", "closed", "2026-11-19T09:00");
  const free = bed("b2", "free", "2026-11-19T11:30");
  // The filter keeps one bed; the count was made by looking at both.
  assert.equal(metricReads(CLOSED, closed), true);
  assert.equal(metricReads(CLOSED, free), false);
  assert.equal(metricLooksAt(CLOSED, free), true);
  assert.equal(metricLooksAt(CLOSED, station()), false);
  const m = unitWith([closed, free, station()], [], [CLOSED]);
  assert.equal(m.values.closed_beds, 1);
  // The newest reading of the beds, 11:30: the free one is why the answer is one and not two.
  assert.deepEqual(m.valueAges.closed_beds, { seconds: 29 * 60, basis: "observed" });

  // None closed is a real answer, zero, and it has an age too.
  const none = unitWith([free], [], [CLOSED]);
  assert.equal(none.values.closed_beds, 0);
  assert.deepEqual(none.valueAges.closed_beds, { seconds: 29 * 60, basis: "observed" });
});

test("a measure defined by role looks at every type that plays the role", () => {
  const ROLE: MetricDef = {
    key: "occupancy",
    label: "Occupancy",
    objectType: "OrgUnit",
    unit: "percent",
    numerator: { ofRole: "space", inUse: true, agg: "count" },
    denominator: { ofRole: "space", agg: "count" },
  };
  assert.equal(metricLooksAt(ROLE, bed("b1", "free", "2026-11-19T11:30")), true);
  assert.equal(metricLooksAt(ROLE, station()), false);
  // No type and no role named: the measure looks at everything under the unit.
  const ALL: MetricDef = { key: "things", label: "Things", objectType: "OrgUnit", unit: "count", numerator: { agg: "count" } };
  assert.equal(metricLooksAt(ALL, station()), true);
});

test("the built-in measures a rule can name are dated on what their name says they read", () => {
  const beds = [bed("b1", "occupied", "2026-11-19T11:30"), bed("b2", "free", "2026-11-19T11:00")];
  const m = unitWith(
    [...beds, census(), station()],
    ["count:Lit", "mean:iqa", "civieres_occupees", "linkedInstanceCount", "freshnessSeconds", "count:Fauteuil"],
  );
  // `count:Lit` reads the beds.
  assert.deepEqual(m.valueAges["count:Lit"], { seconds: 29 * 60, basis: "observed" });
  // `mean:iqa` reads whatever declares that number: the station.
  assert.deepEqual(m.valueAges["mean:iqa"], { seconds: 119 * 60, basis: "observed" });
  // So does a bare property name: here, the census.
  assert.deepEqual(m.valueAges.civieres_occupees, { seconds: 14 * 60, basis: "observed" });
  // These two are about everything under the unit, and so is their age.
  const whole = { seconds: m.freshnessSeconds, basis: m.freshnessBasis };
  assert.deepEqual(m.valueAges.linkedInstanceCount, whole);
  assert.deepEqual(m.valueAges.freshnessSeconds, whole);
  // A count of a type the unit does not hold is zero, made from nothing.
  assert.deepEqual(m.valueAges["count:Fauteuil"], { seconds: null, basis: "empty" });

  assert.equal(measureReads("count:Lit", DEFS)(beds[0]!), true);
  assert.equal(measureReads("count:Lit", DEFS)(station()), false);
  assert.equal(measureReads("mean:iqa", DEFS)(station()), true);
  assert.equal(measureReads("mean:iqa", DEFS)(census()), false);
  // The older name of occupancy follows its definition.
  assert.equal(measureReads("occupancyPct", DEFS)(census()), true);
  assert.equal(measureReads("occupancyPct", DEFS)(station()), false);
});

test("a site that is itself the reading dates its own value", () => {
  const s = station();
  const m = selfRollup("s1", { typeName: s.typeName, properties: s.properties, propertySchema: s.propertySchema, updatedAt: s.updatedAt }, DEFS, NOW)!;
  assert.deepEqual(m.valueAges, { iqa: { seconds: 119 * 60, basis: "observed" } });
});

// --- the alert ----------------------------------------------------------------

const RULE: TwinAlertRuleRow = {
  id: "r1",
  environmentId: "p1",
  unitKind: null,
  metric: "occupancy",
  op: ">",
  threshold: 100,
  severity: "critical",
  messageTemplate: "{unit} — {value} %",
  recommendationTemplate: "",
};

/** Opens whatever fires: nothing is on file, and every insert is new. */
function openingDb(): { db: DbClient; inserts: unknown[][] } {
  const inserts: unknown[][] = [];
  const db = {
    query: async (q: string, p: unknown[] = []) => {
      if (!/^\s*INSERT INTO app\.twin_alert/.test(q)) return { rows: [], rowCount: 0 };
      inserts.push(p);
      return { rows: [{ id: `a${inserts.length}`, created_at: new Date(), written_at: null, inserted: true }], rowCount: 1 };
    },
  } as unknown as DbClient;
  return { db, inserts };
}

test("an alert is dated by the sources its measure reads", async () => {
  // Read "now", so the instants the evaluator writes can be compared with the clock.
  const now = Date.now();
  const stamp = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const things = [census(stamp(14)), station(stamp(119))];
  const unit = inst("u1", "OrgUnit", [], { name: "Urgence A" });
  const rules = [RULE, { ...RULE, id: "r2", metric: "iqa", threshold: 50, severity: "warn" as const }];
  const byUnit = rollupFrom([{ id: "u1" }], [], [unit, ...things], things.map((t) => at(t, "u1")), DEFS, now, rules.map((r) => r.metric));

  const { db, inserts } = openingDb();
  const out = await evaluateAlerts(db, "p1", byUnit, new Map([["u1", "org"]]), new Map([["u1", "Urgence A"]]), rules);
  const after = Date.now();
  assert.deepEqual(
    out.map((a) => [a.metric, a.observedBasis]),
    [
      ["occupancy", "observed"],
      ["iqa", "observed"],
    ],
  );
  // The same unit, two alerts, two ages: each value has its own.
  const within = (d: Date | null, minutes: number) =>
    d !== null && d.getTime() >= now - minutes * 60_000 - 1_000 && d.getTime() <= after - minutes * 60_000 + 1_000;
  assert.ok(within(out[0]!.observedAt, 14), "the occupancy alert carries the age of the census");
  assert.ok(within(out[1]!.observedAt, 119), "the air alert carries the age of the station");
  // And that is what is written: `observed_at` and `observed_basis` of each row.
  assert.ok(within(inserts[0]![8] as Date, 14));
  assert.equal(inserts[0]![10], "observed");
  assert.ok(within(inserts[1]![8] as Date, 119));
});

test("an alert on a value with no age says so, whatever else the unit holds", async () => {
  const things = [water(), station()];
  const unit = inst("u1", "OrgUnit", [], { name: "Bassin nord" });
  const rule = { ...RULE, metric: "charge_eaux_usees", threshold: 1, severity: "warn" as const };
  const byUnit = rollupFrom([{ id: "u1" }], [], [unit, ...things], things.map((t) => at(t, "u1")), DEFS, NOW, [rule.metric]);
  const { db, inserts } = openingDb();
  const out = await evaluateAlerts(db, "p1", byUnit, new Map([["u1", "org"]]), new Map([["u1", "Bassin nord"]]), [rule]);
  assert.equal(out[0]!.observedAt, null);
  assert.equal(out[0]!.observedBasis, "undeclared");
  assert.equal(inserts[0]![8], null);
  assert.equal(inserts[0]![10], "undeclared");
});
