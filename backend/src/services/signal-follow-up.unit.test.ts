import assert from "node:assert/strict";
import { test } from "node:test";

import type { DbClient } from "../lib/db.js";
import type { Decision } from "./decisions.js";
import { listDecisionsForSignal } from "./decisions.js";
import { signalFacts, signalFollowUp, type SignalFacts } from "./signal-follow-up.js";
import { ruleOutcomes } from "./signals.js";
import { readReadingsBetween, type KeptReading, type ReadingsBetween } from "./twin-history.js";

// ---------------------------------------------------------------------------
// A signal, followed.
//
// What is held here is what the follow-up refuses to do: set a run's figure
// against the twin's as if they were one quantity, read a gap in the readings
// as "no change", or call a change after a decision its effect.
// ---------------------------------------------------------------------------

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

const RAISED = "2026-11-22T10:00:00.000Z";
const DECIDED = "2026-11-22T12:14:00.000Z";
const NOW = new Date("2026-11-22T16:00:00.000Z");
const STRETCHERS = { key: "occupancy", label: "Stretcher occupancy", unit: "percent" as const };

const reading = (iso: string, value: number | null): KeptReading => ({ value, observedAt: value === null ? null : iso, observedBasis: value === null ? null : "observed", recordedAt: iso });
const at = (hhmm: string) => `2026-11-22T${hhmm}:00.000Z`;
const kept = (over: Partial<ReadingsBetween> = {}): ReadingsBetween => ({
  opening: reading("2026-11-22T09:50:00.000Z", 135),
  readings: [reading(at("10:50"), 143), reading(at("11:50"), 150), reading(at("12:50"), 131), reading(at("14:50"), 96)],
  cut: false,
  since: "2026-11-01T00:00:00.000Z",
  ...over,
});

const figures = (waitingDays: number) => ({ peakOccupancy: 1, peakDay: 4, sitesWithQueue: 3, sitesWithActivity: 34, firstQueueDay: 2, waitingDays, peakWaiting: 40, peakWaitingDay: 6, strandedWaitingDays: null });
const siteBreak = (peakOccupancy: number, waitingDays: number) => ({ firstDay: 2, days: 9, peakWaiting: 30, peakDay: 6, waitingDays, peakOccupancy });
const decision = (over: Partial<Decision> = {}, expected: Partial<Decision["expected"]> = {}): Decision =>
  ({
    id: "d1",
    optionLabel: "60 more stretchers at Suroît",
    decidedBy: "A. Tremblay",
    decidedAt: DECIDED,
    expected: {
      horizon: 30,
      activity: "Stretchers",
      asItIs: figures(267.4),
      withOption: figures(119.6),
      sites: [{ id: "u1", name: "HÔPITAL DU SUROÎT", capacity: 32, asItIs: siteBreak(1, 88.2), withOption: siteBreak(0.93, 12) }],
      arrivals: {},
      basis: [],
      mechanism: "",
      notTested: [],
      notes: [],
      ...expected,
    },
    ...over,
  }) as unknown as Decision;

const FACTS: SignalFacts = { metric: "occupancy", raisedValue: 137.5, closedReason: null, alert: { status: "open", resolvedAt: null } };
const follow = (over: Partial<Parameters<typeof signalFollowUp>[0]> = {}) =>
  signalFollowUp({ now: NOW, signal: { detectedAt: RAISED, closedAt: null, unitId: "u1" }, facts: FACTS, measure: STRETCHERS, decisions: [decision()], kept: kept(), ...over });

// --- what is measured, and from when ------------------------------------------------

test("the measure is read from the decision on: what it was then, the lowest, the highest and the last reading since", () => {
  const f = follow();
  assert.ok(f.followed);
  assert.deepEqual(f.measure, { key: "occupancy", label: "Stretcher occupancy", countedIn: "percent" });
  // The signal's own record: when it was raised, and the value its alert had, rounded as the screen rounds.
  assert.deepEqual(f.raised, { at: RAISED, value: 138 });
  assert.deepEqual(f.measured, {
    from: "decision",
    fromAt: DECIDED,
    untilAt: NOW.toISOString(),
    closed: false,
    readings: 2,
    // The twin showed 150 % at 12:14: the reading written down at 11:50, not the one that raised the signal.
    atStart: 150,
    latest: 96,
    lowest: 96,
    highest: 131,
    change: -54,
    says: [
      "Stretcher occupancy was 150% when the decision was taken.",
      "Since then, until now: 2 readings, lowest 96%, highest 131%; the last one is 96%.",
      "Measured change over that stretch: −54 points.",
    ],
  });
});

test("the delay between the signal and the decision is counted from the two recorded times", () => {
  const f = follow({ decisions: [decision(), decision({ id: "d2", decidedAt: at("15:00") })] });
  assert.ok(f.followed);
  assert.deepEqual(f.decision, { id: "d1", label: "60 more stretchers at Suroît", by: "A. Tremblay", at: DECIDED, delaySeconds: 8040, delay: "2 h", others: 1 });
});

test("without a decision the measure is followed from the moment the signal was raised, and nothing is said to be expected", () => {
  const f = follow({ decisions: [] });
  assert.ok(f.followed);
  assert.equal(f.decision, null);
  assert.equal(f.expected, null);
  assert.equal(f.gap, null);
  assert.equal(f.measured.from, "raised");
  // What the twin showed when the signal was raised is the reading in force then.
  assert.equal(f.measured.atStart, 135);
  assert.equal(f.measured.readings, 4);
  assert.equal(f.measured.says[0], "Stretcher occupancy was 135% when the signal was raised.");
});

test("no new reading is not no change", () => {
  const f = follow({ kept: kept({ readings: [reading(at("10:50"), 143), reading(at("11:50"), 150)] }) });
  assert.ok(f.followed);
  assert.equal(f.measured.readings, 0);
  assert.equal(f.measured.change, null, "no difference is given where nothing new was read");
  assert.equal(f.measured.latest, 150);
  assert.deepEqual([f.measured.lowest, f.measured.highest], [null, null]);
  assert.match(f.measured.says[1]!, /No new reading was written down between then and now\. That is not the same as no change/);
});

test("a measure that lost its value says so instead of giving a change", () => {
  const f = follow({ kept: kept({ readings: [reading(at("11:50"), 150), reading(at("13:50"), null)] }) });
  assert.ok(f.followed);
  assert.equal(f.measured.latest, null);
  assert.equal(f.measured.change, null);
  assert.match(f.measured.says[1]!, /the last one says the measure has no value/);
});

test("a history that starts after the decision gives no value for that moment, and says where it starts", () => {
  const f = follow({ kept: kept({ opening: null, readings: [reading(at("14:50"), 96)], since: at("14:50") }) });
  assert.ok(f.followed);
  assert.equal(f.measured.atStart, null);
  assert.equal(f.measured.change, null);
  assert.equal(f.measured.says[0], "No reading of Stretcher occupancy had been written down when the decision was taken: the twin's history of this value starts later.");
  assert.ok(f.limits.some((l) => l === "The twin started writing this measure down on 2026-11-22, after this signal was raised: nothing earlier is known."));
});

test("a closed signal is followed until it closed, and keeps how it was closed", () => {
  const f = follow({ signal: { detectedAt: RAISED, closedAt: at("15:30"), unitId: "u1" }, facts: { ...FACTS, closedReason: "Resolved", alert: { status: "resolved", resolvedAt: at("15:14") } } });
  assert.ok(f.followed);
  assert.deepEqual([f.measured.untilAt, f.measured.closed, f.closedAs], [at("15:30"), true, "Resolved"]);
  assert.match(f.measured.says[1]!, /^Since then, until the signal closed:/);
  assert.deepEqual(f.alert, { state: "cleared", clearedAt: at("15:14"), says: "The alert cleared 3 h after the decision: the condition stopped firing." });
});

test("what became of the alert is said for what it is", () => {
  const says = (alert: SignalFacts["alert"], decisions = [decision()]) => {
    const f = follow({ facts: { ...FACTS, alert }, decisions });
    assert.ok(f.followed);
    return [f.alert.state, f.alert.says];
  };
  assert.deepEqual(says({ status: "open", resolvedAt: null }), ["holds", "The alert still holds: the condition still fires."]);
  assert.deepEqual(says({ status: "ack", resolvedAt: null }), ["acknowledged", "The alert was acknowledged, and the condition still fires."]);
  // Cleared before anyone decided: the decision did not clear it.
  assert.deepEqual(says({ status: "resolved", resolvedAt: at("11:00") }), ["cleared", "The alert had already cleared when the decision was taken."]);
  assert.deepEqual(says({ status: "resolved", resolvedAt: at("11:00") }, []), ["cleared", "The alert cleared 1 h after the signal was raised: the condition stopped firing."]);
  assert.deepEqual(says(null), ["unknown", "The alert this signal came from is no longer on file."]);
});

// --- what was expected, and why it is not subtracted ---------------------------------

test("what the tested run gave is shown in the engine's own terms, with the signal's unit when the run reports on it", () => {
  const f = follow();
  assert.ok(f.followed && f.expected);
  assert.deepEqual(f.expected.waiting, { without: 267, with: 120, change: -147 });
  assert.deepEqual(f.expected.site, { name: "HÔPITAL DU SUROÎT", peakOccupancyPct: { without: 100, with: 93 }, waiting: { without: 88, with: 12 } });
  assert.deepEqual([f.expected.run, f.expected.testedAt, f.expected.horizon, f.expected.activity], ["kept_test", null, 30, "Stretchers"]);
  assert.match(f.expected.says[0]!, /the test the response was kept from, made in calm time/);
  assert.equal(f.expected.says[1], "Over 30 days, for Stretchers, across the whole network: 267 patient-days waiting without the response, 120 with it.");
  assert.match(f.expected.says[2]!, /occupancy peaks at 100% without it and 93% with it.*The engine's occupancy stops at 100%: what exceeds capacity is counted as waiting\./);
});

test("the run made again when the signal opened is the one given, and it is named", () => {
  const f = follow({ decisions: [decision({}, { retested: { testedAt: "2026-11-22T10:01:30.000Z", current: true, asItIs: figures(301), withOption: figures(140) } })] });
  assert.ok(f.followed && f.expected);
  assert.deepEqual([f.expected.run, f.expected.testedAt], ["retest", "2026-11-22T10:01:30.000Z"]);
  assert.deepEqual(f.expected.waiting, { without: 301, with: 140, change: -161 });
  assert.match(f.expected.says[0]!, /the run made again on the network as it was when the signal opened, on 2026-11-22\.$/);
  // The site's figures are still those of the kept test, and are said to be.
  assert.match(f.expected.says[2]!, /^At HÔPITAL DU SUROÎT, in the test the response was kept from:/);
});

test("a unit the run does not report on gets no figure from it", () => {
  const f = follow({ signal: { detectedAt: RAISED, closedAt: null, unitId: "elsewhere" } });
  assert.ok(f.followed && f.expected);
  assert.equal(f.expected.site, null);
  assert.ok(f.expected.says.includes("This unit is not one of the sites that run reports on, so the run gives no figure for it."));
});

test("no figure sets the run against the twin, and the follow-up does not conclude", () => {
  const f = follow();
  assert.ok(f.followed);
  assert.equal(
    f.gap,
    "No figure sets one against the other. The run counts people waiting and an occupancy that stops at 100% of capacity; the twin measures Stretcher occupancy at this unit. They are two different quantities, shown side by side. Whether the decision held is yours to judge.",
  );
  // Each side gives its own change, in its own unit; nothing is subtracted across.
  assert.equal(f.measured.change, -54);
  assert.equal(f.expected!.waiting.change, -147);
  assert.ok(f.limits.includes("A change measured after a decision is not an effect of the decision: other things changed too, and this does not tell them apart."));
  assert.equal(JSON.stringify(f).includes("worked"), false);
});

// --- what cannot be followed ------------------------------------------------------------

test("a signal no alert raised, or raised on a measure the twin does not keep, says why nothing is followed", () => {
  assert.deepEqual(follow({ facts: { ...FACTS, metric: null } }), { followed: false, why: "This signal was not raised by an alert on a unit, so there is no measure to follow after it." });
  assert.deepEqual(follow({ signal: { detectedAt: RAISED, closedAt: null, unitId: null } }), { followed: false, why: "This signal was not raised by an alert on a unit, so there is no measure to follow after it." });
  const builtIn = follow({ facts: { ...FACTS, metric: "freshnessSeconds" }, measure: null, kept: null });
  assert.deepEqual(builtIn, {
    followed: false,
    why: "This signal was raised on “freshnessSeconds”, which is not one of the measures the twin writes down over time: only the measures the organisation defined are kept.",
  });
});

// --- reading it from the database ----------------------------------------------------------

test("a signal's facts come from its own row and its alert's, in its project only", async () => {
  const { db, sql, params } = scriptDb([[{ metric: "occupancy", value: "137.5", closed_reason: null, alert_status: "ack", resolved_at: null }]]);
  assert.deepEqual(await signalFacts(db, "p1", "s1"), { metric: "occupancy", raisedValue: 137.5, closedReason: null, alert: { status: "ack", resolvedAt: null } });
  assert.match(sql[0]!, /LEFT JOIN app\.twin_alert a ON s\.origin_kind = 'twin_alert' AND a\.id = s\.origin_id WHERE s\.id = \$1 AND s\.project_id = \$2$/);
  assert.deepEqual(params[0], ["s1", "p1"]);
  // Not found is not found, and a value that is not a number is no value.
  assert.equal(await signalFacts(scriptDb([[]]).db, "p1", "s1"), null);
  const odd = await signalFacts(scriptDb([[{ metric: " ", value: "n/a", closed_reason: "Resolved", alert_status: null, resolved_at: null }]]).db, "p1", "s1");
  assert.deepEqual(odd, { metric: null, raisedValue: null, closedReason: "Resolved", alert: null });
});

test("the decisions of a signal are read oldest first: the first is the one the follow-up counts from", async () => {
  const { db, sql, params } = scriptDb([[]]);
  await listDecisionsForSignal(db, "p1", "s1");
  assert.match(sql[0]!, /WHERE d\.project_id = \$1 AND d\.signal_id = \$2 ORDER BY d\.decided_at ASC$/);
  assert.deepEqual(params[0], ["p1", "s1"]);
});

test("the readings of a stretch are counted on when they were written down, with the one in force when it began", async () => {
  const row = (iso: string, value: number | null) => ({ value, observed_at: new Date(iso), observed_basis: "observed", recorded_at: new Date(iso) });
  const { db, sql, params } = scriptDb([[row(at("12:50"), 131), row(at("10:50"), 143)], [row("2026-11-22T09:50:00.000Z", 135)], [{ since: new Date("2026-11-01T00:00:00.000Z") }]]);
  const from = new Date(RAISED);
  const got = await readReadingsBetween(db, "p1", "u1", "occupancy", from, NOW);
  assert.deepEqual(got.readings.map((r) => r.value), [143, 131], "oldest first");
  assert.equal(got.opening?.value, 135);
  assert.deepEqual([got.cut, got.since], [false, "2026-11-01T00:00:00.000Z"]);
  assert.match(sql[0]!, /recorded_at >= \$4 AND recorded_at <= \$5 ORDER BY recorded_at DESC LIMIT \$6$/);
  assert.deepEqual(params[0]!.slice(0, 5), ["p1", "u1", "occupancy", from, NOW]);
  assert.match(sql[1]!, /recorded_at < \$4 ORDER BY recorded_at DESC LIMIT 1$/);
});

// --- false positives, by rule -----------------------------------------------------------------

test("each rule counts the signals it raised, and tells a dismissal from a batch close from a resolution", async () => {
  const { db, sql, params } = scriptDb([[{ rule_id: "r1", raised: 10, open: 3, closed: 7, false_positives: 2, cleared_on_own: 4 }]]);
  assert.deepEqual(await ruleOutcomes(db, "p1"), [{ ruleId: "r1", raised: 10, open: 3, closed: 7, falsePositives: 2, clearedOnOwn: 4 }]);
  const q = sql[0]!;
  assert.match(q, /FROM app\.signal s JOIN app\.twin_alert a ON a\.id = s\.origin_id WHERE s\.project_id = \$1 AND s\.origin_kind = 'twin_alert' AND a\.rule_id IS NOT NULL GROUP BY a\.rule_id$/);
  assert.match(q, /FILTER \(WHERE s\.closed_at IS NOT NULL AND s\.closed_reason LIKE \$2\)\)::int AS false_positives/);
  assert.match(q, /FILTER \(WHERE s\.closed_at IS NOT NULL AND s\.closed_reason LIKE \$3\)\)::int AS cleared_on_own/);
  // The three ways to close stay three: the prefixes are the ones the closes write.
  assert.deepEqual(params[0], ["p1", "false positive: %", "alert cleared: %"]);
});

test("readings caught up afterwards from kept copies are counted, and said for what they are", () => {
  const caught = (iso: string, value: number): KeptReading => ({ ...reading(iso, value), replayed: true });
  const f = follow({ kept: kept({ readings: [reading(at("11:50"), 150), caught(at("13:00"), 131), reading(at("15:00"), 96)] }) });
  assert.ok(f.followed);
  assert.equal(f.measured.readings, 2);
  assert.equal(f.measured.says[f.measured.says.length - 1], "1 of these 2 readings was caught up afterwards from kept copies of the source: the twin did not show it at the time.");
  // Nothing is said when none was: the sentence is about what happened, not a standing warning.
  const plain = follow();
  assert.ok(plain.followed && !plain.measured.says.some((s) => /caught up/.test(s)));
});
