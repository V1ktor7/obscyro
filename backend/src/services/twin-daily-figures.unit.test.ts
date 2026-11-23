import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { ageOfValue, hoursText, shown, whyWithheld } from "./live-reading.js";
import type { EnvInstanceRow, EnvLinkRow } from "./ontology.js";
import { propertyProblem, type PropertyDef } from "./property-schema.js";
import { MEAN_DAYS, changeOf, dayOn, meanOfDays, readUnitTrends } from "./twin-history.js";
import { aggregate, validateMetric, withheldOf, type MetricDef } from "./twin-metrics.js";
import { rollupFrom } from "./twin.js";

// ---------------------------------------------------------------------------
// A figure of the day before, published every hour.
//
// The ministry's full hourly emergency file carries, beside the census of the
// last hour, two average lengths of stay that are yesterday's. Four things
// follow, and each can go wrong quietly:
//
//   - the average is dated by its row, and reads "14 minutes old";
//   - two rooms' averages are averaged under the unit that holds them both;
//   - a room that published "pas d'information disponible" reads as a zero;
//   - the change "since the reading before" compares yesterday's figure with
//     itself, republished an hour earlier.
// ---------------------------------------------------------------------------

const MTL = "America/Toronto";
/** 18:00 in Montréal on 22 November: 23:00 UTC. */
const NOW = Date.parse("2026-11-22T23:00:00Z");

const CENSUS_SCHEMA: PropertyDef[] = [
  { key: "patients_presents", type: "number" },
  { key: "dms_ambulatoire_heures", type: "number", unit: "heures", period: "previous_day" },
  { key: "mise_a_jour", type: "string", observedAt: true, observedAtZone: MTL },
];

const inst = (id: string, typeName: string, propertySchema: PropertyDef[], properties: Record<string, unknown>): EnvInstanceRow => ({
  id,
  typeId: `type:${typeName}`,
  typeName,
  properties,
  provenance: {},
  propertySchema,
  simRole: null,
  createdAt: new Date(NOW - 86_400_000),
  updatedAt: new Date(NOW - 4_000),
});

const at = (thing: EnvInstanceRow, unit: string): EnvLinkRow => ({
  id: `${thing.id}@${unit}`,
  linkTypeName: "releve_de",
  aggregates: "metrics",
  aggregateToward: "target",
  transitive: false,
  fromInstanceId: thing.id,
  toInstanceId: unit,
  fromTypeName: thing.typeName,
  toTypeName: "OrgUnit",
});

const PRESENT: MetricDef = {
  key: "patients_presents",
  label: "People in the emergency room",
  objectType: "OrgUnit",
  unit: "count",
  numerator: { ofType: "ReleveUrgence", agg: "sum", property: "patients_presents" },
};
const STAY: MetricDef = {
  key: "dms_ambulatoire",
  label: "Average stay, walk-in patients",
  objectType: "OrgUnit",
  unit: "hours",
  numerator: { ofType: "ReleveUrgence", agg: "only", property: "dms_ambulatoire_heures" },
};
const DEFS = [PRESENT, STAY];

/** A census released at 17:45, fifteen minutes ago. */
const census = (id: string, present: unknown, stay: unknown) =>
  inst(id, "ReleveUrgence", CENSUS_SCHEMA, { patients_presents: present, dms_ambulatoire_heures: stay, mise_a_jour: "2026-11-22T17:45" });

/** A hospital `h` holding two emergency rooms, `a` and `b`, each with its census. */
function hospital(a: EnvInstanceRow, b: EnvInstanceRow) {
  const units = ["h", "a", "b"].map((id) => inst(id, "OrgUnit", [], { name: id }));
  const edges = [
    { fromId: "h", toId: "a" },
    { fromId: "h", toId: "b" },
  ];
  return rollupFrom([{ id: "h" }, { id: "a" }, { id: "b" }], edges, [...units, a, b], [at(a, "a"), at(b, "b")], DEFS, NOW);
}

test("`only` gives the one value there is, and none when there are several", () => {
  const sel = STAY.numerator;
  const one = [{ typeName: "ReleveUrgence", properties: { dms_ambulatoire_heures: 5.99 } }];
  assert.equal(aggregate(one, sel), 5.99);
  const two = [...one, { typeName: "ReleveUrgence", properties: { dms_ambulatoire_heures: 8.3 } }];
  assert.equal(aggregate(two, sel), null);
  // A second room that published nothing does not make two values.
  assert.equal(aggregate([...one, { typeName: "ReleveUrgence", properties: { dms_ambulatoire_heures: null } }], sel), 5.99);
  assert.equal(aggregate([], sel), null);
});

test("a measure says why it has no value: several averages, or nothing published", () => {
  const room = (v: unknown) => ({ typeName: "ReleveUrgence", properties: { dms_ambulatoire_heures: v, patients_presents: v } });
  assert.deepEqual(withheldOf(STAY, [room(5.99), room(8.3)]), { reason: "several", count: 2 });
  // The source wrote words where the figure goes: the pipeline keeps the row and leaves the value out.
  assert.deepEqual(withheldOf(STAY, [room(null)]), { reason: "blank", count: 1 });
  assert.deepEqual(withheldOf(PRESENT, [room(null), room("")]), { reason: "blank", count: 2 });
  // A value, or nothing to read at all: no sentence to write.
  assert.equal(withheldOf(STAY, [room(5.99)]), null);
  assert.equal(withheldOf(STAY, []), null);
  // A sum adds what it finds; it is never withheld for being several.
  assert.equal(withheldOf(PRESENT, [room(12), room(30)]), null);
});

test("a duration is a unit of its own, and needs nothing to divide by", () => {
  assert.deepEqual(validateMetric(STAY), []);
  assert.ok(validateMetric({ ...STAY, numerator: { ofType: "ReleveUrgence", agg: "only" } }).length > 0);
});

test("a period is declared on a number, never on text", () => {
  assert.equal(propertyProblem({ key: "dms", type: "number", period: "previous_day" }), null);
  assert.match(propertyProblem({ key: "note", type: "string", period: "previous_day" }) ?? "", /period/);
});

test("under a hospital, counts add up and averages are not averaged again", () => {
  const m = hospital(census("ca", 136, 5.99), census("cb", 90, 8.3));
  // Each room keeps its own figure, said to be of the day before, on the clock of its stamp.
  assert.equal(m.get("a")!.values.dms_ambulatoire, 5.99);
  assert.deepEqual(m.get("a")!.valueAges.dms_ambulatoire, { seconds: 15 * 60, basis: "observed", period: "previous_day", zone: MTL });
  // The census beside it is of its hour, and says nothing of a period.
  assert.deepEqual(m.get("a")!.valueAges.patients_presents, { seconds: 15 * 60, basis: "observed" });
  // The hospital: 226 people present, and no average stay. Not 7.1 h.
  const h = m.get("h")!;
  assert.equal(h.values.patients_presents, 226);
  assert.equal(h.values.dms_ambulatoire, null);
  assert.deepEqual(h.withheld, { dms_ambulatoire: { reason: "several", count: 2 } });
  assert.equal(h.valueAges.dms_ambulatoire, undefined);
});

test("a room whose source published no figure has no value, and says so", () => {
  const m = hospital(census("ca", 136, 5.99), census("cb", null, null));
  const b = m.get("b")!;
  assert.equal(b.values.patients_presents, null);
  assert.deepEqual(b.withheld, { patients_presents: { reason: "blank", count: 1 }, dms_ambulatoire: { reason: "blank", count: 1 } });
  // The hospital counts the room that reported, and has one average left: that room's.
  const h = m.get("h")!;
  assert.equal(h.values.patients_presents, 136);
  assert.equal(h.values.dms_ambulatoire, 5.99);
  assert.deepEqual(h.withheld, {});
});

// ---------------------------------------------------------------------------
// The change since the reading before.
// ---------------------------------------------------------------------------

const row = (metric: string, value: number | null, observed: string | null, recorded: string) => ({
  metric,
  value,
  observed_at: observed ? new Date(observed) : null,
  recorded_at: new Date(recorded),
});
const now = new Date(NOW);
/** The census of 17:45 Montréal time, as an instant. */
const T1745 = "2026-11-22T22:45:00Z";
const T1645 = "2026-11-22T21:45:00Z";
const T1545 = "2026-11-22T20:45:00Z";

test("the change is counted against the reading before the one on screen", () => {
  const kept = [row("p", 136, T1745, "2026-11-22T22:50:00Z"), row("p", 130, T1645, "2026-11-22T21:50:00Z"), row("p", 141, T1545, "2026-11-22T20:50:00Z")];
  // The newest kept reading is the value on screen, a second apart: stepped over.
  const c = changeOf({ value: 136, observedAt: new Date(Date.parse(T1745) + 1000) }, kept, now);
  assert.deepEqual(c, { previous: { value: 130, at: T1645.replace("Z", ".000Z"), atIs: "observed" }, delta: 6 });
});

test("when the recorder has not caught up, the newest kept reading is the one before", () => {
  // 17:45 is on screen; the last reading written down is still 16:45's.
  const kept = [row("p", 130, T1645, "2026-11-22T21:50:00Z"), row("p", 141, T1545, "2026-11-22T20:50:00Z")];
  const c = changeOf({ value: 136, observedAt: new Date(T1745) }, kept, now);
  assert.equal(c.delta, 6);
  assert.equal(c.previous?.at, T1645.replace("Z", ".000Z"));
});

test("the same value an hour later is no change, not a missing one", () => {
  const kept = [row("p", 53, T1745, "2026-11-22T22:50:00Z"), row("p", 53, T1645, "2026-11-22T21:50:00Z")];
  assert.equal(changeOf({ value: 53, observedAt: new Date(T1745) }, kept, now).delta, 0);
});

test("nothing kept before, or a reading that had no value: no change is counted", () => {
  // The history starts with this value.
  assert.deepEqual(changeOf({ value: 136, observedAt: new Date(T1745) }, [row("p", 136, T1745, "2026-11-22T22:50:00Z")], now), { previous: null, delta: null });
  assert.deepEqual(changeOf({ value: 136, observedAt: new Date(T1745) }, [], now), { previous: null, delta: null });
  // An hour ago the room published nothing. That is not a zero to subtract.
  const c = changeOf({ value: 136, observedAt: new Date(T1745) }, [row("p", 136, T1745, "2026-11-22T22:50:00Z"), row("p", null, T1645, "2026-11-22T21:50:00Z")], now);
  assert.equal(c.delta, null);
  assert.equal(c.previous?.value, null);
});

test("a source that gives no time is matched on its value, and dated by when it was written", () => {
  const kept = [row("w", 1.4, null, "2026-11-22T12:00:00Z"), row("w", 1.1, null, "2026-11-15T12:00:00Z")];
  const c = changeOf({ value: 1.4, observedAt: null }, kept, now);
  assert.equal(Math.round(c.delta! * 10) / 10, 0.3);
  assert.deepEqual([c.previous?.at, c.previous?.atIs], ["2026-11-15T12:00:00.000Z", "recorded"]);
});

test("a figure of the day before is compared with the day before's, not with itself an hour ago", () => {
  // 5.99 since midnight, republished every hour; 6.4 the day before.
  const kept = [
    row("s", 5.99, T1745, "2026-11-22T22:50:00Z"),
    row("s", 5.99, T1645, "2026-11-22T21:50:00Z"),
    row("s", 5.99, "2026-11-22T05:45:00Z", "2026-11-22T05:50:00Z"), // 00:45 in Montréal: today
    row("s", 6.4, "2026-11-22T04:45:00Z", "2026-11-22T04:50:00Z"), // 23:45 in Montréal: yesterday
  ];
  const c = changeOf({ value: 5.99, observedAt: new Date(T1745), period: "previous_day", zone: MTL }, kept, now);
  assert.equal(c.previous?.value, 6.4);
  assert.equal(Math.round(c.delta! * 100) / 100, -0.41);
  // Counted on UTC days, the 23:45 reading would be "today" and the comparison would find nothing.
  assert.equal(dayOn(new Date("2026-11-22T04:45:00Z"), MTL), "2026-11-21");
  assert.equal(dayOn(new Date("2026-11-22T04:45:00Z"), null), "2026-11-22");
});

// ---------------------------------------------------------------------------
// The mean over the days kept.
// ---------------------------------------------------------------------------

test("the mean is of one value a day, and says how many days it is made of", () => {
  const days = [
    { day: "2026-11-22", value: 6 },
    { day: "2026-11-21", value: 7 },
    { day: "2026-11-20", value: 5 },
  ];
  assert.deepEqual(meanOfDays(days), { mean: 6, days: 3, from: "2026-11-20", to: "2026-11-22", window: MEAN_DAYS });
  assert.equal(meanOfDays([]), null);
  // Past the window, the oldest days are left out.
  const many = Array.from({ length: 40 }, (_, i) => ({ day: `d${String(40 - i).padStart(2, "0")}`, value: i < 30 ? 2 : 100 }));
  assert.deepEqual([meanOfDays(many)!.mean, meanOfDays(many)!.days], [2, 30]);
});

/** Records every statement and returns queued results in order. */
function scriptDb(results: unknown[][]): { db: DbClient; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  let i = 0;
  const db = {
    query: async (q: string, p?: unknown[]) => {
      sql.push(q.replace(/\s+/g, " ").trim());
      params.push(p ?? []);
      const rows = results[i++] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return { db, sql, params };
}

test("one read gives the change of every measure; a daily figure also gets its mean", async () => {
  const metrics = {
    values: { patients_presents: 136, dms_ambulatoire: 5.99, occupancy: null },
    valueAges: {
      patients_presents: { seconds: 15 * 60, basis: "observed" as const },
      dms_ambulatoire: { seconds: 15 * 60, basis: "observed" as const, period: "previous_day" as const, zone: MTL },
    },
  };
  const { db, sql, params } = scriptDb([
    [
      row("dms_ambulatoire", 5.99, T1745, "2026-11-22T22:50:00Z"),
      row("dms_ambulatoire", 6.4, "2026-11-22T04:45:00Z", "2026-11-22T04:50:00Z"),
      row("patients_presents", 136, T1745, "2026-11-22T22:50:00Z"),
      row("patients_presents", 130, T1645, "2026-11-22T21:50:00Z"),
    ],
    [
      { day: "2026-11-22", value: 5.99 },
      { day: "2026-11-21", value: 6.4 },
    ],
  ]);
  const t = await readUnitTrends(db, "p1", "u1", metrics, now);
  // Two statements: every measure's readings at once, then the days of the one daily figure.
  assert.equal(sql.length, 2);
  assert.deepEqual(params[0]![2], ["patients_presents", "dms_ambulatoire"]);
  assert.match(sql[1]!, /AT TIME ZONE \$4/);
  assert.equal(params[1]![3], MTL);
  assert.equal(t.changes.patients_presents!.delta, 6);
  assert.equal(t.changes.dms_ambulatoire!.previous?.value, 6.4);
  // A measure without a value has no change to give.
  assert.equal(t.changes.occupancy, undefined);
  assert.deepEqual(Object.keys(t.means), ["dms_ambulatoire"]);
  assert.equal(t.means.dms_ambulatoire!.days, 2);
  assert.equal(Math.round(t.means.dms_ambulatoire!.mean * 1000) / 1000, 6.195);
});

test("a unit with no value reads nothing from the history", async () => {
  const { db, sql } = scriptDb([]);
  const t = await readUnitTrends(db, "p1", "u1", { values: { occupancy: null }, valueAges: {} }, now);
  assert.equal(sql.length, 0);
  assert.deepEqual([t.changes, t.means], [{}, {}]);
});

// ---------------------------------------------------------------------------
// What the analyst is told.
// ---------------------------------------------------------------------------

test("a figure of the day before is never said to have been read minutes ago", () => {
  assert.equal(ageOfValue(15 * 60, "observed", "measure", "previous_day").says, "figure of the day before, published 15 min ago");
  assert.equal(ageOfValue(15 * 60, "partial", "measure", "previous_day").says, "figure of the day before, published at least 15 min ago");
  assert.equal(ageOfValue(null, "unreadable", "measure", "previous_day").known, "unknown");
  // A value of its hour is said as before.
  assert.equal(ageOfValue(15 * 60, "observed", "measure").says, "value read 15 min ago");
});

test("a duration is written in hours and minutes, and a withheld value says why", () => {
  assert.equal(hoursText(5.99), "5 h 59");
  assert.equal(hoursText(14.62), "14 h 37");
  assert.equal(hoursText(0.5), "0 h 30");
  assert.equal(shown(5.9871, "hours"), 5.99);
  assert.match(whyWithheld({ reason: "several", count: 3 }), /3 values .* not averaged again/);
  assert.match(whyWithheld({ reason: "blank", count: 1 }), /published no figure/);
});
