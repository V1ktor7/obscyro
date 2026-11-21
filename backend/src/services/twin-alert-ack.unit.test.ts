import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { alertsOnFile, resolveAlerts } from "./twin-alert-scheduler.js";
import { ackAlert, evaluateAlerts, type TwinAlertRuleRow, type UnitMetrics } from "./twin.js";

// ---------------------------------------------------------------------------
// An acknowledgement holds for as long as the condition does.
//
// It used to hold for five seconds: acknowledging moved the alert out of
// 'open', the unique index only covers 'open', and the next evaluation opened
// a new alert for the same unit and the same rule. A new signal, and a banner
// announcing as news what somebody had just said they had seen.
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

const RULE: TwinAlertRuleRow = {
  id: "r1",
  environmentId: "p1",
  unitKind: null,
  metric: "occupancy",
  op: ">",
  threshold: 100,
  severity: "warn",
  messageTemplate: "{unit} — {value} %",
  recommendationTemplate: "",
};

const METRICS = {
  unitId: "u1",
  instanceCountByType: {},
  values: { occupancy: 132 },
  qualifiers: {},
  occupancyPct: 132,
  numericMeans: {},
  freshnessSeconds: 600,
  freshnessBasis: "observed",
  fetchedAgeSeconds: 4,
  linkedInstanceCount: 12,
} as unknown as UnitMetrics;

const evaluate = (db: DbClient, rule: TwinAlertRuleRow = RULE) =>
  evaluateAlerts(db, "p1", new Map([["u1", METRICS]]), new Map([["u1", "org"]]), new Map([["u1", "Urgence A"]]), [rule]);

const OPENED = new Date("2026-11-19T15:00:04.000Z");
const ACKED = new Date("2026-11-19T15:02:00.000Z");
const acked = { id: "a1", status: "ack", created_at: OPENED, written_at: null, acked_at: ACKED };

test("an acknowledged alert whose condition still holds is refreshed, and nothing new is opened", async () => {
  const { db, sql, params } = scriptDb([[acked]]);
  const out = await evaluate(db);

  assert.equal(sql.length, 1, "one statement: the alert on file is refreshed");
  assert.match(sql[0]!, /^UPDATE app\.twin_alert SET/);
  assert.equal(sql.some((q) => q.includes("INSERT INTO app.twin_alert")), false, "no new alert, so no new signal and nothing to announce");
  // The value keeps following the reading while the alert is acknowledged.
  assert.match(sql[0]!, /value = \$6/);
  assert.equal(params[0]![5], 132);

  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "a1");
  assert.equal(out[0]!.status, "ack");
  assert.equal(out[0]!.ackedAt, ACKED);
  assert.equal(out[0]!.isNew, false);
});

test("it holds evaluation after evaluation, for as long as the condition does", async () => {
  const { db, sql } = scriptDb([[acked], [acked], [acked]]);
  for (let i = 0; i < 3; i++) {
    const out = await evaluate(db);
    assert.equal(out[0]!.id, "a1");
    assert.equal(out[0]!.isNew, false);
  }
  assert.equal(sql.length, 3);
  assert.equal(sql.every((q) => q.startsWith("UPDATE app.twin_alert SET")), true);
});

test("the alert that holds a unit and a rule is the open one, or an acknowledged one of at least that severity", async () => {
  const { db, sql, params } = scriptDb([[acked]]);
  await evaluate(db);
  assert.match(sql[0]!, /WHERE project_id = \$1 AND unit_instance_id = \$2 AND rule_id = \$3/);
  assert.match(
    sql[0]!,
    /AND \(status = 'open' OR \(status = 'ack' AND \(CASE severity WHEN 'critical' THEN 2 WHEN 'warn' THEN 1 ELSE 0 END\) >= \$11\)\)/,
  );
  assert.deepEqual(params[0]!.slice(0, 3), ["p1", "u1", "r1"]);
  // A resolved alert never holds anything: a condition that comes back is a new episode.
  assert.doesNotMatch(sql[0]!, /resolved/);
});

test("an acknowledgement covers the severity that was acknowledged, not a worse one", async () => {
  // What the statement compares the acknowledged alert's severity with.
  for (const [severity, rank] of [["info", 0], ["warn", 1], ["critical", 2]] as const) {
    const { db, params } = scriptDb([[acked]]);
    await evaluate(db, { ...RULE, severity });
    assert.equal(params[0]![10], rank);
  }

  // The rule now fires as critical and the alert was acknowledged as a warning:
  // nothing holds the pair, so a new alert opens.
  const { db, sql, params } = scriptDb([[], [{ id: "a2", created_at: new Date(), written_at: null, inserted: true }]]);
  const out = await evaluate(db, { ...RULE, severity: "critical" });
  assert.equal(sql.length, 2);
  assert.match(sql[1]!, /^INSERT INTO app\.twin_alert/);
  assert.equal(params[1]![3], "critical");
  assert.equal(out[0]!.id, "a2");
  assert.equal(out[0]!.status, "open");
  assert.equal(out[0]!.isNew, true, "one notch worse is news");
});

test("an open alert speaks for the pair when an older acknowledged one sits beside it", async () => {
  // Alerts acknowledged before acknowledgements held can have a newer open alert next to them.
  const open = { id: "a9", status: "open", created_at: new Date(), written_at: null, acked_at: null };
  const { db, sql } = scriptDb([[acked, open]]);
  const out = await evaluate(db);
  assert.equal(sql.length, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "a9");
  assert.equal(out[0]!.status, "open");
});

// --- acknowledging -------------------------------------------------------------

test("only an open alert is acknowledged", async () => {
  const { db, sql, params } = scriptDb([[{ id: "a1" }]]);
  await ackAlert(db, "p1", "a1");
  assert.equal(sql.length, 1);
  assert.match(sql[0]!, /SET status = 'ack', acked_at = NOW\(\) WHERE id = \$1 AND project_id = \$2 AND status = 'open'$/);
  assert.deepEqual(params[0], ["a1", "p1"]);
});

test("acknowledging an alert that has already cleared changes nothing, and is not an error", async () => {
  // Turning a resolved alert back into an acknowledged one would claim its condition still holds.
  const { db, sql } = scriptDb([[], [{ "?column?": 1 }]]);
  await ackAlert(db, "p1", "a1");
  assert.equal(sql.length, 2);
  assert.match(sql[1]!, /^SELECT 1 FROM app\.twin_alert WHERE id = \$1 AND project_id = \$2$/);
});

test("acknowledging an alert that is not in this project is refused", async () => {
  const { db } = scriptDb([[], []]);
  await assert.rejects(() => ackAlert(db, "p1", "elsewhere"), /not found/i);
});

// --- when the condition stops ----------------------------------------------------

test("the evaluator watches acknowledged alerts too, and resolves them when the condition stops", async () => {
  // "Seen" is not "over": an acknowledged alert still stands for a condition
  // that holds, and something has to say when it no longer does.
  const read = scriptDb([[{ id: "a1", unit_instance_id: "u1", rule_id: "r1" }]]);
  assert.deepEqual(await alertsOnFile(read.db, "p1"), [{ id: "a1", unitInstanceId: "u1", ruleId: "r1" }]);
  assert.match(read.sql[0]!, /WHERE project_id = \$1 AND status IN \('open', 'ack'\)$/);

  const write = scriptDb();
  await resolveAlerts(write.db, ["a1"]);
  assert.match(write.sql[0]!, /SET status = 'resolved', resolved_at = NOW\(\) WHERE id = ANY\(\$1::uuid\[\]\) AND status IN \('open', 'ack'\)$/);
  assert.deepEqual(write.params[0], [["a1"]]);

  // Nothing to resolve, nothing written.
  const idle = scriptDb();
  await resolveAlerts(idle.db, []);
  assert.equal(idle.sql.length, 0);
});
