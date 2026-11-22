import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { HISTORY_LIMIT, RECORD_EVERY_MS, SAME_READING_SECONDS, readUnitHistory, readingsNow, recordAllProjects, recordProject, recordReadings, type Reading } from "./twin-history.js";
import type { UnitMetrics } from "./twin.js";

// ---------------------------------------------------------------------------
// The twin keeps what it measured.
//
// What matters is what is NOT written: a history that takes a line every five
// minutes for a value that did not move says nothing a person can read, and
// one that fills a gap with a zero says something false.
// ---------------------------------------------------------------------------

/** Records every statement and returns queued results in order. */
function scriptDb(results: unknown[][] = []): { db: DbClient; sql: string[]; params: unknown[][] } {
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

const NOW = new Date("2026-11-22T12:00:00.000Z");

const unit = (over: Partial<UnitMetrics>): UnitMetrics =>
  ({
    unitId: "u1",
    instanceCountByType: {},
    values: {},
    qualifiers: {},
    occupancyPct: null,
    numericMeans: {},
    freshnessSeconds: null,
    freshnessBasis: "empty",
    valueAges: {},
    fetchedAgeSeconds: null,
    linkedInstanceCount: 0,
    ...over,
  }) as UnitMetrics;

// --- what the twin reads now --------------------------------------------------

test("a reading is a unit, a measure, a value, and the time that value was true", () => {
  const readings = readingsNow(
    new Map([
      [
        "u1",
        unit({
          values: { occupancy: 132.5, wastewater: 12 },
          // The whole unit is as old as its oldest source; each value has its own age.
          freshnessSeconds: 7200,
          freshnessBasis: "observed",
          valueAges: { occupancy: { seconds: 840, basis: "observed" }, wastewater: { seconds: null, basis: "undeclared" } },
        }),
      ],
    ]),
    NOW,
  );
  assert.deepEqual(readings, [
    // Fourteen minutes old: the age of what this measure reads, not the unit's two hours.
    { unitId: "u1", metric: "occupancy", value: 132.5, observedAt: new Date("2026-11-22T11:46:00.000Z"), observedBasis: "observed" },
    // The source declares no time: the value is kept, and its time is not made up.
    { unitId: "u1", metric: "wastewater", value: 12, observedAt: null, observedBasis: "undeclared" },
  ]);
});

test("a floor is kept as a floor, and a measure without a value is listed as having none", () => {
  const readings = readingsNow(
    new Map([
      ["u1", unit({ values: { occupancy: 101 }, valueAges: { occupancy: { seconds: 3600, basis: "partial" } } })],
      // No bed is no occupancy, not 0 %: the measure is there, without a value and without an age.
      ["u2", unit({ unitId: "u2", values: { occupancy: null }, valueAges: {} })],
      // Not a number is not a value either.
      ["u3", unit({ unitId: "u3", values: { occupancy: Number.NaN }, valueAges: { occupancy: { seconds: 10, basis: "observed" } } })],
    ]),
    NOW,
  );
  assert.deepEqual(readings.map((r) => [r.unitId, r.value, r.observedAt?.toISOString() ?? null, r.observedBasis]), [
    ["u1", 101, "2026-11-22T11:00:00.000Z", "partial"],
    ["u2", null, null, null],
    ["u3", null, null, null],
  ]);
});

test("a unit with no defined measure has nothing to keep", () => {
  assert.deepEqual(readingsNow(new Map([["u1", unit({ values: {} })]]), NOW), []);
  assert.deepEqual(readingsNow(new Map(), NOW), []);
});

// --- what is written down ---------------------------------------------------------

const READING: Reading = { unitId: "u1", metric: "occupancy", value: 132.5, observedAt: new Date("2026-11-22T11:46:00.000Z"), observedBasis: "observed" };

test("nothing to keep asks the database nothing", async () => {
  const { db, sql } = scriptDb();
  assert.equal(await recordReadings(db, "p1", []), 0);
  assert.equal(sql.length, 0);
});

test("what changed is sorted out in one statement, against the last reading kept for each unit and measure", async () => {
  const { db, sql, params } = scriptDb([[{ n: 2 }]]);
  const written = await recordReadings(db, "p1", [READING, { unitId: "u2", metric: "wastewater", value: null, observedAt: null, observedBasis: null }]);
  assert.equal(written, 2, "the count is the count of lines written");
  assert.equal(sql.length, 1);
  const q = sql[0]!;
  assert.match(q, /INSERT INTO app\.twin_reading \(project_id, unit_instance_id, metric, value, observed_at, observed_basis\)/);
  // The last reading kept, per unit and measure, in this project.
  assert.match(q, /LEFT JOIN LATERAL \( SELECT true AS kept, r\.value, r\.observed_at FROM app\.twin_reading r WHERE r\.unit_instance_id = x\.unit_id AND r\.metric = x\.metric AND r\.project_id = \$1 ORDER BY r\.recorded_at DESC LIMIT 1\) last ON true/);
  // A first reading needs a value: a measure that never had one starts no history.
  assert.match(q, /WHERE \(last\.kept IS NULL AND x\.value IS NOT NULL\)/);
  // A value that differs, having none included: the absence of a value is written down.
  assert.match(q, /OR \(last\.kept AND last\.value IS DISTINCT FROM x\.value\)/);
  // The same value read at another time, or gaining or losing its time.
  assert.match(q, /OR \(last\.kept AND x\.value IS NOT NULL AND \(\(last\.observed_at IS NULL\) <> \(x\.observed_at IS NULL\) OR abs\(extract\(epoch FROM \(x\.observed_at - last\.observed_at\)\)\) > \$7\)\)/);
  assert.deepEqual(params[0], ["p1", ["u1", "u2"], ["occupancy", "wastewater"], [132.5, null], ["2026-11-22T11:46:00.000Z", null], ["observed", null], SAME_READING_SECONDS]);
});

test("two times a minute and a half apart are one reading; the twin is read every five minutes", () => {
  // The roll-up counts ages in whole seconds, so one source timestamp comes back a second or two apart.
  assert.equal(SAME_READING_SECONDS, 90);
  assert.equal(RECORD_EVERY_MS, 300_000);
});

// --- one project, then all of them --------------------------------------------------

test("a project with no unit is not rolled up, and writes nothing", async () => {
  const { db, sql } = scriptDb();
  assert.equal(await recordProject(db, "p1", NOW), null);
  assert.equal(sql.some((q) => q.includes("app.twin_reading")), false);
});

test("one project that cannot be read does not cost the others their reading", async () => {
  const seen: string[] = [];
  const failed: string[] = [];
  let first = true;
  const db = {
    query: async (q: string, p?: unknown[]) => {
      if (first) {
        first = false;
        return { rows: [{ id: "p-broken" }, { id: "p-empty" }], rowCount: 2 };
      }
      const projectId = String(p?.[0]);
      seen.push(projectId);
      if (projectId === "p-broken") throw new Error("this project's objects cannot be read");
      void q;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbClient;
  const result = await recordAllProjects(db, (id) => failed.push(id));
  assert.deepEqual(failed, ["p-broken"]);
  assert.ok(seen.includes("p-empty"), "the project after the broken one was still read");
  // The broken one is counted as failed; the one with no unit is neither read nor failed.
  assert.deepEqual(result, { projects: 0, written: 0, failed: 1 });
});

// --- reading it back ------------------------------------------------------------------

const row = (hoursAgo: number, value: number | null) => {
  const at = new Date(NOW.getTime() - hoursAgo * 3_600_000);
  return { value, observed_at: value === null ? null : at, observed_basis: value === null ? null : "observed", recorded_at: at };
};

test("the history of a measure reads oldest first, opened by the reading in force when the window starts", async () => {
  // The database answers newest first; the reading before the window; and the first ever kept.
  const { db, sql, params } = scriptDb([[row(1, 133), row(10, 120), row(20, null)], [row(60, 101)], [{ since: new Date(NOW.getTime() - 100 * 3_600_000) }]]);
  const h = await readUnitHistory(db, "p1", "u1", "occupancy", 48, NOW);
  assert.deepEqual(h.readings.map((r) => r.value), [101, null, 120, 133]);
  // A reading with no value says the measure had none from then on: a gap, not a zero.
  assert.deepEqual(h.readings[1], { value: null, observedAt: null, observedBasis: null, recordedAt: new Date(NOW.getTime() - 20 * 3_600_000).toISOString() });
  assert.equal(h.since, new Date(NOW.getTime() - 100 * 3_600_000).toISOString(), "where the whole history starts, not the window");
  assert.deepEqual([h.at, h.unitId, h.metric, h.hours, h.cut, h.everySeconds], [NOW.toISOString(), "u1", "occupancy", 48, false, 300]);
  // In this project only, and no further back than asked.
  assert.match(sql[0]!, /WHERE project_id = \$1 AND unit_instance_id = \$2 AND metric = \$3 AND recorded_at >= \$4 ORDER BY recorded_at DESC LIMIT \$5$/);
  assert.deepEqual(params[0], ["p1", "u1", "occupancy", new Date(NOW.getTime() - 48 * 3_600_000), HISTORY_LIMIT + 1]);
  assert.match(sql[1]!, /recorded_at < \$4 ORDER BY recorded_at DESC LIMIT 1$/);
});

test("a window that holds more than the list says it was cut, and keeps the newest", async () => {
  const { db } = scriptDb([[row(1, 133), row(2, 130), row(3, 128)], [row(60, 101)], [{ since: row(100, 95).recorded_at }]]);
  const h = await readUnitHistory(db, "p1", "u1", "occupancy", 48, NOW, 2);
  assert.equal(h.cut, true);
  // The oldest of the window is what is left out, and nothing from before it is put at the front.
  assert.deepEqual(h.readings.map((r) => r.value), [130, 133]);
});

test("nothing kept is said as nothing kept, not as nothing changed", async () => {
  const { db } = scriptDb([[], [], [{ since: null }]]);
  const h = await readUnitHistory(db, "p1", "u1", "occupancy", 48, NOW);
  assert.deepEqual([h.readings, h.since, h.cut], [[], null, false]);
});
