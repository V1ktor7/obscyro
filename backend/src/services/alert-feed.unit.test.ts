import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import { FEED_LIMIT, feedFrom, readAlertFeed, type FeedAlertRow } from "./alert-feed.js";
import { evaluateAlerts, readsReality, type TwinAlertRuleRow, type UnitMetrics } from "./twin.js";

/** Records every statement and returns queued results in order. */
function scriptDb(results: unknown[][] = []): { db: DbClient; sql: string[]; params: unknown[][] } {
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

const NOW = new Date("2026-11-19T15:00:10.000Z");
const PULSE = { lastAt: "2026-11-19T15:00:08.000Z", lastMs: 180, everyMs: 5180 };

const row = (over: Partial<FeedAlertRow> = {}): FeedAlertRow => ({
  id: "a1",
  unit_instance_id: "u1",
  unit_name: "Urgence — Hôpital A",
  severity: "critical",
  metric: "occupancy",
  value: "132.5",
  message: "Urgence — Hôpital A — 132.5 %",
  created_at: new Date("2026-11-19T15:00:04.000Z"),
  observed_at: new Date("2026-11-19T14:00:00.000Z"),
  observed_basis: "observed",
  written_at: new Date("2026-11-19T15:00:01.000Z"),
  signal_id: "s1",
  ...over,
});

// --- the feed ----------------------------------------------------------------

test("an alert in the feed carries what a person needs to act: where, how bad, since when, how old, and its signal", () => {
  const feed = feedFrom([row()], [{ severity: "critical", n: 1 }], { open: 3, changed_at: new Date("2026-11-19T15:00:05.000Z") }, PULSE, NOW);
  assert.deepEqual(feed, {
    // The server's clock: a browser set five minutes off must not make an alert look five minutes old.
    at: "2026-11-19T15:00:10.000Z",
    alerts: [
      {
        id: "a1",
        unitId: "u1",
        unitName: "Urgence — Hôpital A",
        severity: "critical",
        metric: "occupancy",
        value: 132.5,
        message: "Urgence — Hôpital A — 132.5 %",
        openedAt: "2026-11-19T15:00:04.000Z",
        // The value is an hour old; we noticed it three seconds after it was written. Two different facts.
        observedAt: "2026-11-19T14:00:00.000Z",
        // And that hour is the source's own timestamp, not a floor.
        observedBasis: "observed",
        writtenAt: "2026-11-19T15:00:01.000Z",
        signalId: "s1",
      },
    ],
    counts: { critical: 1, warn: 0, info: 0 },
    omitted: 0,
    signals: { open: 3, changedAt: "2026-11-19T15:00:05.000Z" },
    evaluation: PULSE,
  });
});

test("an age the source does not publish stays unknown, and an alert without a signal says so", () => {
  const feed = feedFrom([row({ observed_at: null, observed_basis: "undeclared", written_at: null, signal_id: null })], [], { open: 0, changed_at: null }, PULSE, NOW);
  assert.equal(feed.alerts[0]!.observedAt, null);
  // Unknown, with the reason: nothing on this type is declared as carrying the time of the reading.
  assert.equal(feed.alerts[0]!.observedBasis, "undeclared");
  assert.equal(feed.alerts[0]!.writtenAt, null);
  assert.equal(feed.alerts[0]!.signalId, null);
  assert.equal(feed.signals.changedAt, null);
});

test("every open alert is counted, and what the list leaves out is said", () => {
  const feed = feedFrom(
    [row(), row({ id: "a2" })],
    [
      { severity: "critical", n: 240 },
      { severity: "warn", n: 12 },
    ],
    { open: 0, changed_at: null },
    PULSE,
    NOW,
  );
  assert.deepEqual(feed.counts, { critical: 240, warn: 12, info: 0 });
  assert.equal(feed.omitted, 250);
});

test("the feed reads open alerts only, worst first then newest, with the unit named as the twin names it", async () => {
  const { db, sql, params } = scriptDb([[row()], [{ severity: "critical", n: 1 }], [{ open: 1, changed_at: null }]]);
  const feed = await readAlertFeed(db, "p1");
  assert.equal(feed.alerts.length, 1);
  assert.match(sql[0]!, /a\.status = 'open'/);
  assert.match(sql[0]!, /ORDER BY CASE a\.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a\.created_at DESC/);
  // Name, else code, else the start of the id: the rule of the twin's own tree.
  assert.match(sql[0]!, /NULLIF\(oi\.properties ->> 'name', ''\), NULLIF\(oi\.properties ->> 'code', ''\)/);
  assert.match(sql[0]!, /s\.origin_kind = 'twin_alert' AND s\.origin_id = a\.id/);
  assert.deepEqual(params[0], ["p1", FEED_LIMIT]);
  // It reads and nothing else.
  assert.equal(sql.some((q) => /INSERT INTO|UPDATE app\.|DELETE FROM/i.test(q)), false);
});

// --- the two times an alert keeps ----------------------------------------------

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

const metrics = (over: Partial<UnitMetrics> = {}): UnitMetrics =>
  ({
    unitId: "u1",
    instanceCountByType: {},
    values: { occupancy: 132 },
    qualifiers: {},
    occupancyPct: 132,
    numericMeans: {},
    // The unit as a whole: its oldest source, an air quality station read two hours ago.
    freshnessSeconds: 7200,
    freshnessBasis: "observed",
    // The occupancy itself: the stretcher census, fifty minutes old.
    valueAges: { occupancy: { seconds: 3000, basis: "observed" } },
    fetchedAgeSeconds: 4,
    linkedInstanceCount: 12,
    ...over,
  }) as UnitMetrics;

/**
 * One evaluation of one unit against one rule. `onFile` is the alert that
 * already holds the pair, when there is one: it is refreshed and nothing is
 * opened. Without it, the second statement opens the alert.
 */
async function evaluate(m: UnitMetrics, onFile?: Record<string, unknown>) {
  const opened = new Date();
  const scripted = scriptDb(
    onFile
      ? [[{ id: "a1", status: "open", created_at: opened, written_at: null, acked_at: null, ...onFile }]]
      : [[], [{ id: "a1", created_at: opened, written_at: null, inserted: true }]],
  );
  const before = Date.now();
  const out = await evaluateAlerts(scripted.db, "p1", new Map([["u1", m]]), new Map([["u1", "org"]]), new Map([["u1", "Urgence A"]]), [RULE]);
  return { ...scripted, out, before, after: Date.now() };
}

test("an alert is opened with the time its value was true and the time its data was written here", async () => {
  const { sql, params, out, before, after } = await evaluate(metrics());
  // Nothing held this unit and this rule: the second statement opens the alert.
  assert.equal(sql.length, 2);
  assert.match(sql[1]!, /observed_at, written_at, observed_basis\)/);
  const [observedAt, writtenAt] = [params[1]![8] as Date, params[1]![9] as Date];
  assert.equal(params[1]![10], "observed");
  // The alert carries the age of its own value: the census its measure reads is
  // fifty minutes old. The unit's two hours belong to another source, and are
  // not the alert's. The row was written four seconds ago.
  assert.ok(observedAt.getTime() >= before - 3_000_000 && observedAt.getTime() <= after - 3_000_000);
  assert.ok(writtenAt.getTime() >= before - 4_000 && writtenAt.getTime() <= after - 4_000);
  assert.equal(out[0]!.observedAt, observedAt);
});

test("an alert that stays open follows its value's age, and keeps the write that opened it", async () => {
  const firstWrite = new Date("2026-11-19T14:00:03.000Z");
  const { sql, params, out } = await evaluate(metrics(), { written_at: firstWrite });
  assert.equal(sql.length, 1, "the alert on file is refreshed, and nothing is opened");
  const update = sql[0]!.slice(sql[0]!.indexOf("SET"), sql[0]!.indexOf("WHERE"));
  assert.match(update, /observed_at = \$9/);
  // What the age rests on follows the age: a source that goes quiet turns an answer into a floor.
  assert.match(update, /observed_basis = \$10/);
  assert.equal(params[0]![9], "observed");
  // Ten syncs later the alert was still opened by one write: that time is not overwritten.
  assert.doesNotMatch(update, /written_at/);
  assert.equal(out[0]!.writtenAt, firstWrite);
  assert.equal(out[0]!.isNew, false);
});

test("an age the twin cannot know is kept empty, not replaced by the hour of our download", async () => {
  const { params } = await evaluate(metrics({ valueAges: { occupancy: { seconds: null, basis: "undeclared" } }, fetchedAgeSeconds: null }));
  // Neither when the alert on file is refreshed, nor when a new one is opened.
  assert.equal(params[0]![8], null);
  assert.equal(params[1]![8], null);
  assert.equal(params[1]![9], null);
  // Nor replaced by the age of another source of the same unit, which is known
  // (two hours): a value does not borrow an age from a neighbour.
  assert.equal(params[0]![9], "undeclared");
  assert.equal(params[1]![10], "undeclared");
});

test("a measure the roll-up did not date takes the age of everything under its unit", async () => {
  // No entry for the rule's measure: the unit's own age stands in, the reading
  // made before a measure had an age of its own.
  const { params, before, after } = await evaluate(metrics({ valueAges: {} }));
  const observedAt = params[1]![8] as Date;
  assert.ok(observedAt.getTime() >= before - 7_200_000 && observedAt.getTime() <= after - 7_200_000);
  assert.equal(params[1]![10], "observed");
});

test("a rule on the older name of occupancy is dated as occupancy is", async () => {
  const older = scriptDb([[], [{ id: "a1", created_at: new Date(), written_at: null, inserted: true }]]);
  const before = Date.now();
  await evaluateAlerts(older.db, "p1", new Map([["u1", metrics()]]), new Map([["u1", "org"]]), new Map([["u1", "Urgence A"]]), [
    { ...RULE, metric: "occupancyPct" },
  ]);
  const observedAt = older.params[1]![8] as Date;
  assert.ok(observedAt.getTime() >= before - 3_000_000 && observedAt.getTime() <= Date.now() - 3_000_000);
});

test("only a read of reality raises alerts: a scenario or another instant never does", () => {
  assert.equal(readsReality(undefined), true);
  assert.equal(readsReality({}), true);
  // A ward that overflows in a what-if must not reach every screen as if it were happening.
  assert.equal(readsReality({ scenarioId: "sc1", atOffsetHours: 0 }), false);
  assert.equal(readsReality({ asOf: "2026-01-01T00:00:00Z" }), false);
});

test("an age that is only a floor is kept as a floor", async () => {
  // The measure reads two sources and one published no time: the age is the
  // oldest of the ones that did, which a screen must not print as the answer.
  const { params } = await evaluate(metrics({ valueAges: { occupancy: { seconds: 7200, basis: "partial" } } }));
  // On the alert that opens, and on the one already on file when it is refreshed.
  assert.equal(params[1]![10], "partial");
  assert.equal(params[0]![9], "partial");
  const feed = feedFrom([row({ observed_basis: "partial" })], [], { open: 0, changed_at: null }, PULSE, NOW);
  assert.equal(feed.alerts[0]!.observedBasis, "partial");
});

test("an alert last evaluated before the basis was kept has none, rather than a guessed one", () => {
  const feed = feedFrom([row({ observed_basis: null })], [], { open: 0, changed_at: null }, PULSE, NOW);
  assert.equal(feed.alerts[0]!.observedBasis, null);
});
