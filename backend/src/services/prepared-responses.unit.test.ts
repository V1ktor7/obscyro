import assert from "node:assert/strict";
import { test } from "node:test";

import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import errorHandler from "../plugins/error-handler.js";
import preparedRoutes from "../routes/prepared-responses.js";
import type { Decision, DecisionExpected } from "./decisions.js";
import type { LiveSignal } from "./live-reading.js";
import { OLD_AFTER_DAYS, onCard, scenarioMark, scenarioOf, standingOf, type PreparedResponse } from "./prepared-responses.js";
import { liveTest } from "./response-retest.js";
import { decisionOnCard, engageNow } from "./situation.js";

// ---------------------------------------------------------------------------
// A prepared response is a test that was kept. What is checked here is what it
// says about that test when it is shown, later, to somebody about to engage it:
// the figures as the run gave them, and whether the run still speaks of now.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-20T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const figures = (waitingDays: number, sitesWithQueue: number) => ({
  peakOccupancy: 0.93,
  peakDay: 36,
  sitesWithQueue,
  sitesWithActivity: 34,
  firstQueueDay: 20,
  waitingDays,
  peakWaiting: 12,
  peakWaitingDay: 38,
  strandedWaitingDays: null,
});

const EXPECTED: DecisionExpected = {
  horizon: 60,
  activity: "litsantephysique",
  asItIs: figures(7316, 8),
  withOption: figures(267, 3),
  sites: [],
  arrivals: {},
  basis: [
    { element: "+60 litsantephysique at Lakeshore from day 10, open and staffed", evidence: "assumption", from: "option" },
    { element: "Lakeshore holds 234 litsantephysique today", evidence: "measured", from: "twin" },
    { element: "Hospitals start 85 % full", evidence: "assumption", from: "scenario" },
    { element: "The wave is fitted on published admissions", evidence: "published", from: "scenario" },
  ],
  changes: [{ does: "adds", now: "+60 litsantephysique at Lakeshore from day 10", was: null }],
  retires: [],
  mechanism: "Lakeshore is the only site of its catchment, so beds added there are the only ones its patients can use.",
  notTested: ["Whether 60 beds can be staffed by day 10."],
  notes: [],
};

const response = (over: Partial<PreparedResponse> = {}): PreparedResponse => ({
  id: "r1",
  projectId: "p1",
  signalTypeId: "kind-1",
  signalType: "Occupation élevée",
  label: "Open 60 beds at Lakeshore",
  approver: "Director of nursing",
  exchangeId: "x1",
  optionStep: "s2",
  optionLabel: "Open 60 beds at Lakeshore",
  scenarioId: "sc1",
  scenarioName: "Omicron — calibrated",
  scenarioMark: "aaaa",
  objective: "Nobody waits at Lakeshore.",
  optionStamps: [],
  expected: EXPECTED,
  sourceSteps: [],
  testedAt: daysAgo(3),
  keptBy: "A planner",
  keptAt: daysAgo(3),
  ...over,
});

const edit = (amount: number, at = 240) => ({
  targetType: "param" as const,
  targetId: null,
  targetLocalKey: "stamp:1",
  op: "set_param" as const,
  payload: { key: "stamp:1", value: { kind: "capacity", amount, facility: "f1" } },
  effectiveOffsetHours: at,
  durationHours: 1200,
});

test("a scenario's mark is what it holds, whatever the order and whatever the rows", () => {
  const a = edit(60);
  const b = { ...edit(30), targetLocalKey: "stamp:2", payload: { key: "stamp:2", value: { kind: "capacity", amount: 30, facility: "f2" } } };
  assert.equal(scenarioMark([a, b]), scenarioMark([b, a]));
  // The same choice written with its keys in another order is the same choice.
  const reordered = { ...a, payload: { value: { facility: "f1", amount: 60, kind: "capacity" }, key: "stamp:1" } };
  assert.equal(scenarioMark([a]), scenarioMark([reordered]));
  // A choice changed, moved, added or removed is another scenario.
  assert.notEqual(scenarioMark([a]), scenarioMark([edit(40)]));
  assert.notEqual(scenarioMark([a]), scenarioMark([edit(60, 408)]));
  assert.notEqual(scenarioMark([a]), scenarioMark([a, b]));
  assert.notEqual(scenarioMark([a]), scenarioMark([]));
  assert.match(scenarioMark([a]), /^[0-9a-f]{16}$/);
});

test("a test that still speaks of the present is said to, with its age", () => {
  const s = standingOf(response(), { exists: true, mark: "aaaa" }, NOW);
  assert.deepEqual(s, { testedAt: daysAgo(3), age: "3 d", stale: false, reasons: [] });
});

test("a test on a scenario that changed, or is gone, or an old test, says so before it is engaged", () => {
  const changed = standingOf(response(), { exists: true, mark: "bbbb" }, NOW);
  assert.equal(changed.stale, true);
  assert.match(changed.reasons[0]!, /“Omicron — calibrated”\) has changed since: these figures are those of the scenario as it was/);

  const gone = standingOf(response(), { exists: false, mark: null }, NOW);
  assert.equal(gone.stale, true);
  assert.match(gone.reasons[0]!, /no longer exists/);

  const old = standingOf(response({ testedAt: daysAgo(OLD_AFTER_DAYS + 5) }), { exists: true, mark: "aaaa" }, NOW);
  assert.equal(old.stale, true);
  assert.deepEqual(old.reasons, ["The test is 35 d old. The network it ran on may not be the network now."]);
  // Exactly at the limit is not yet old; both reasons are given when both hold.
  assert.equal(standingOf(response({ testedAt: daysAgo(OLD_AFTER_DAYS) }), { exists: true, mark: "aaaa" }, NOW).stale, false);
  assert.equal(standingOf(response({ testedAt: daysAgo(90) }), { exists: true, mark: "bbbb" }, NOW).reasons.length, 2);

  // A response whose scenario id was lost cannot claim its scenario is unchanged.
  assert.deepEqual(scenarioOf(new Map(), response({ scenarioId: null })), { exists: false, mark: null });
  assert.deepEqual(scenarioOf(new Map([["sc1", { exists: true, mark: "aaaa" }]]), response()), { exists: true, mark: "aaaa" });
});

test("on the card a response shows its test as the run gave it, and what the run rests on", () => {
  const card = onCard(response(), { exists: true, mark: "aaaa" }, NOW, liveTest([], NOW));
  assert.equal(card.label, "Open 60 beds at Lakeshore");
  assert.equal(card.approver, "Director of nursing");
  assert.deepEqual(card.changes, ["Adds +60 litsantephysique at Lakeshore from day 10"]);
  // The run with it, beside the same run without: the figures of the journalled test, untouched.
  assert.equal(card.withIt.waitingDays, 267);
  assert.equal(card.without.waitingDays, 7316);
  assert.equal(card.withIt.sitesWithQueue, 3);
  assert.equal(card.horizon, 60);
  assert.equal(card.activity, "litsantephysique");
  // Counted by level, never merged: what is assumed is not offered as measured.
  assert.deepEqual(card.evidence, { measured: 1, published: 1, assumption: 2 });
  assert.deepEqual(card.notTested, ["Whether 60 beds can be staffed by day 10."]);
  assert.equal(card.standing.stale, false);
  assert.equal(card.scenarioName, "Omicron — calibrated");
});

test("a replacement and a removal are said as such, and an older record falls back on what the option rests on", () => {
  const replaced = onCard(
    response({
      expected: {
        ...EXPECTED,
        changes: [
          { does: "replaces", now: "+30 at Lakeshore from day 10", was: "+60 at Lakeshore from day 10" },
          { does: "removes", now: null, was: "Schools closed, days 8 to 17" },
        ],
      },
    }),
    { exists: true, mark: "aaaa" },
    NOW,
    liveTest([], NOW),
  );
  assert.deepEqual(replaced.changes, ["Replaces +60 at Lakeshore from day 10 with +30 at Lakeshore from day 10", "Removes Schools closed, days 8 to 17"]);
  // Recorded before an option said what it does: its own basis is all there is.
  const { changes: _changes, ...older } = EXPECTED;
  assert.deepEqual(onCard(response({ expected: older }), { exists: true, mark: "aaaa" }, NOW, liveTest([], NOW)).changes, [
    "+60 litsantephysique at Lakeshore from day 10, open and staffed",
  ]);
});

const signal = (over: Partial<LiveSignal> = {}): LiveSignal => ({
  id: "s1",
  title: "Urgence at 132 %",
  severity: "critical",
  detectedAt: daysAgo(0),
  closedAt: null,
  unitId: "u1",
  alertId: "a1",
  typeId: "kind-1",
  type: "Occupation élevée",
  domain: "Flux patient",
  stage: "Détecté",
  stageNo: 1,
  stages: 5,
  needsApproval: false,
  isLast: false,
  ...over,
});

test("a response can be engaged on an open signal that has a stage ahead, and the card says why not otherwise", () => {
  assert.deepEqual(engageNow(signal()), { possible: true, why: null });
  assert.deepEqual(engageNow(signal({ closedAt: daysAgo(0) })), { possible: false, why: "This signal is closed. Reopen it before engaging a response." });
  assert.deepEqual(engageNow(signal({ stageNo: 5 })), { possible: false, why: "This signal is already at the last stage of its workflow." });
  assert.equal(engageNow(null).possible, false);
});

test("a decision taken on a signal of this kind is shown with what was expected of it", () => {
  const d = {
    id: "d1",
    optionLabel: "Open 60 beds at Lakeshore",
    decidedBy: "A planner",
    decidedAt: daysAgo(1),
    signal: { id: "s1", title: "Urgence at 132 %" },
    expected: EXPECTED,
  } as unknown as Decision;
  assert.deepEqual(decisionOnCard(d, "s1"), {
    id: "d1",
    label: "Open 60 beds at Lakeshore",
    decidedBy: "A planner",
    decidedAt: daysAgo(1),
    signalTitle: "Urgence at 132 %",
    onThisSignal: true,
    waitingWith: 267,
    waitingWithout: 7316,
  });
  assert.equal(decisionOnCard(d, "another").onThisSignal, false);
});

// ---------------------------------------------------------------------------
// The routes register and refuse what is malformed, without a database.
// ---------------------------------------------------------------------------

async function server() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("apiKey", null);
  await app.register(errorHandler);
  await app.register(preparedRoutes, { prefix: "/v1" });
  await app.ready();
  return app;
}

const ID = "11111111-1111-4111-8111-111111111111";

test("keeping a response names a test and a kind of signal, and carries no figure", async () => {
  const app = await server();
  const keep = (payload: object) => app.inject({ method: "POST", url: "/v1/ontology/mtl/prepared-responses", payload });
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/prepared-responses" }));
  assert.ok(app.hasRoute({ method: "GET", url: "/v1/ontology/:env/prepared-responses" }));
  assert.ok(app.hasRoute({ method: "DELETE", url: "/v1/ontology/:env/prepared-responses/:id" }));

  assert.equal((await keep({ exchangeId: ID, step: "s2" })).statusCode, 400);
  assert.equal((await keep({ exchangeId: ID, step: "the second one", signalTypeId: ID })).statusCode, 400);
  assert.equal((await keep({ exchangeId: "x", step: "s2", signalTypeId: ID })).statusCode, 400);
  // Well formed: stopped at the door for want of a key, before anything is read.
  assert.equal((await keep({ exchangeId: ID, step: "s2", signalTypeId: ID, label: "Open 60 beds", approver: "Director of nursing" })).statusCode, 401);
  await app.close();
});

test("engaging names a signal and a prepared response, by id", async () => {
  const app = await server();
  const engage = (payload: object, signal = ID) => app.inject({ method: "POST", url: `/v1/ontology/mtl/signals/${signal}/engage`, payload });
  assert.ok(app.hasRoute({ method: "POST", url: "/v1/ontology/:env/signals/:id/engage" }));
  assert.equal((await engage({})).statusCode, 400);
  assert.equal((await engage({ responseId: "the first" })).statusCode, 400);
  assert.equal((await engage({ responseId: ID }, "not-an-id")).statusCode, 400);
  assert.equal((await engage({ responseId: ID, note: "Agreed at the 15:00 huddle" })).statusCode, 401);
  await app.close();
});
