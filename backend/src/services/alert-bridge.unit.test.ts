import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { noteClearedAlerts, raiseSignalsForOpenAlerts } from "./alert-bridge.js";

/** Records every statement and returns queued results in order. */
function scriptDb(results: unknown[][] = []): {
  db: DbClient;
  sql: string[];
  params: unknown[][];
} {
  const sql: string[] = [];
  const params: unknown[][] = [];
  let i = 0;
  const db = {
    query: async (q: string, p?: unknown[]) => {
      sql.push(q);
      params.push(p ?? []);
      const rows = results[i++] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as DbClient;
  return { db, sql, params };
}

// --- what gets picked up -----------------------------------------------------

test("only open alerts are bridged", async () => {
  const { db, sql } = scriptDb();
  await raiseSignalsForOpenAlerts(db);
  assert.match(sql[0]!, /a\.status = 'open'/);
});

test("an alert only becomes a signal when a type claims its metric", async () => {
  const { db, sql } = scriptDb();
  await raiseSignalsForOpenAlerts(db);
  // No claim, no signal — an organization that wires nothing gets nothing,
  // rather than a signal type invented on its behalf.
  assert.match(sql[0]!, /st\.alert_metric = a\.metric/);
  assert.match(sql[0]!, /st\.active/);
});

test("the claim is scoped to the alert's own organization", async () => {
  const { db, sql } = scriptDb();
  await raiseSignalsForOpenAlerts(db);
  assert.match(sql[0]!, /st\.organization_id = p\.organization_id/);
});

test("an alert that already produced a signal is never bridged twice", async () => {
  const { db, sql } = scriptDb();
  await raiseSignalsForOpenAlerts(db);
  // This NOT EXISTS is the entire dedupe. Without it the bridge raises a fresh
  // signal every fifteen seconds for as long as the alert stays open.
  assert.match(sql[0]!, /NOT EXISTS[\s\S]*origin_kind = 'twin_alert'[\s\S]*origin_id = a\.id/);
});

test("the batch is bounded and oldest-first", async () => {
  const { db, sql, params } = scriptDb();
  await raiseSignalsForOpenAlerts(db, 7);
  assert.match(sql[0]!, /ORDER BY a\.created_at ASC/);
  assert.match(sql[0]!, /LIMIT \$1/);
  assert.deepEqual(params[0], [7]);
});

// --- what the signal carries -------------------------------------------------

test("the alert's severity wins over the signal type's default", async () => {
  const alert = {
    alert_id: "a1",
    project_id: "p1",
    unit_instance_id: "u1",
    signal_type_id: "t1",
    severity: "critical",
    metric: "occupancy_pct",
    value: "97",
    message: "Occupation ≥ 95 %",
    recommendation: "Envisager un transfert",
    unit_name: "HND Emergency",
  };
  const stage = [
    { id: "st1", workflow_id: "w1", seq: 0, key: "detected", name: "Détecté", requires_approval: false, is_terminal: false },
  ];
  const inserted = [
    {
      id: "sig1", project_id: "p1", signal_type_id: "t1", stage_id: "st1",
      subject_kind: "object_instance", subject_id: "u1", title: "x", detail: null,
      severity: "critical", properties: {}, scenario_id: null, origin_kind: "twin_alert",
      dedupe_key: null, closed_at: null, closed_reason: null, detected_at: new Date(0),
    },
  ];
  const { db, sql, params } = scriptDb([[alert], stage, inserted, [{ next: 1 }], []]);

  const raised = await raiseSignalsForOpenAlerts(db);
  assert.equal(raised, 1);

  const insert = sql.findIndex((s) => s.includes("INSERT INTO app.signal\n"));
  assert.ok(insert > -1, "a signal was inserted");
  const p = params[insert]!;
  // The same metric at 80% and at 95% are not the same problem, so the alert's
  // severity is carried rather than the type's default.
  assert.ok(p.includes("critical"));
  assert.ok(p.includes("u1"), "the unit is the subject, so the panel can find it");
  assert.ok(p.includes("twin_alert"), "the origin is recorded, which is what dedupes it");
});

test("the unit name is folded into the title when there is one", async () => {
  const alert = {
    alert_id: "a1", project_id: "p1", unit_instance_id: "u1", signal_type_id: "t1",
    severity: "warn", metric: "occupancy_pct", value: "83",
    message: "Occupation ≥ 80 %", recommendation: "", unit_name: "HSL Ward 2B",
  };
  const stage = [{ id: "st1", workflow_id: "w1", seq: 0, key: "d", name: "D", requires_approval: false, is_terminal: false }];
  const inserted = [{ id: "s", project_id: "p1", signal_type_id: "t1", stage_id: "st1",
    subject_kind: "object_instance", subject_id: "u1", title: "x", detail: null, severity: "warn",
    properties: {}, scenario_id: null, origin_kind: "twin_alert", dedupe_key: null,
    closed_at: null, closed_reason: null, detected_at: new Date(0) }];
  const { db, sql, params } = scriptDb([[alert], stage, inserted, [{ next: 1 }], []]);

  await raiseSignalsForOpenAlerts(db);
  const i = sql.findIndex((s) => s.includes("INSERT INTO app.signal\n"));
  assert.ok(
    params[i]!.some((v) => typeof v === "string" && v.includes("HSL Ward 2B")),
    "a card reading only 'Occupation ≥ 80 %' says nothing about where",
  );
});

test("one failing alert does not stop the batch", async () => {
  const mk = (id: string) => ({
    alert_id: id, project_id: "p1", unit_instance_id: "u1", signal_type_id: "t1",
    severity: "warn", metric: "m", value: "1", message: "m", recommendation: "", unit_name: null,
  });
  // First alert: firstStage returns nothing, so raiseSignal throws.
  // Second: a full happy path.
  const stage = [{ id: "st1", workflow_id: "w1", seq: 0, key: "d", name: "D", requires_approval: false, is_terminal: false }];
  const inserted = [{ id: "s2", project_id: "p1", signal_type_id: "t1", stage_id: "st1",
    subject_kind: "object_instance", subject_id: "u1", title: "x", detail: null, severity: "warn",
    properties: {}, scenario_id: null, origin_kind: "twin_alert", dedupe_key: null,
    closed_at: null, closed_reason: null, detected_at: new Date(0) }];
  const { db } = scriptDb([[mk("a1"), mk("a2")], [], stage, inserted, [{ next: 1 }], []]);

  const raised = await raiseSignalsForOpenAlerts(db);
  assert.equal(raised, 1, "the second one still got through");
});

// --- clearing ----------------------------------------------------------------

test("a cleared alert is noted, never auto-closed", async () => {
  const { db, sql } = scriptDb([[{ signal_id: "s1", next: 4 }], []]);
  const n = await noteClearedAlerts(db);
  assert.equal(n, 1);

  assert.ok(
    !sql.some((s) => /UPDATE app\.signal\b[\s\S]*closed_at/.test(s)),
    "closing it silently would erase the difference between a problem somebody " +
      "fixed and one that went away on its own",
  );
  assert.ok(sql.some((s) => s.includes("INSERT INTO app.signal_event")));
});

test("the cleared note is written once, not every tick", async () => {
  const { db, sql } = scriptDb();
  await noteClearedAlerts(db);
  assert.match(sql[0]!, /e\.payload ->> 'reason' = 'alert_cleared'/);
  assert.match(sql[0]!, /NOT EXISTS/);
});

test("only open signals are considered for the cleared note", async () => {
  const { db, sql } = scriptDb();
  await noteClearedAlerts(db);
  assert.match(sql[0]!, /s\.closed_at IS NULL/);
  assert.match(sql[0]!, /a\.status <> 'open'/);
});
