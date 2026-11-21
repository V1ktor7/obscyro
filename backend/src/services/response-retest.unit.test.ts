import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { AppError } from "../lib/errors.js";
import { figuresOf, type OptionStamp } from "./analyst-options.js";
import type { RunDigest } from "./analyst-tools.js";
import type { DecisionExpected } from "./decisions.js";
import type { LiveSignal } from "./live-reading.js";
import { onCard, scenarioMark, type PreparedResponse } from "./prepared-responses.js";
import {
  CURRENT_FOR_MS,
  MIN_GAP_MS,
  ORPHAN_AFTER_MS,
  RetestRefused,
  Retests,
  benchOf,
  expectedOnEngage,
  liveTest,
  requestRetests,
  retestOne,
  retiredNow,
  stateMark,
  type Finished,
  type RetestRow,
  type RetestStatus,
  type RetestStore,
  type WorldNow,
} from "./response-retest.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import { ScenarioRunner, type ScenarioEngine } from "./scenario-run.js";
import { replayEngine, type RecordedCall } from "./scenario-run-recording.js";
import { stampFromOverride, stampsOf } from "./scenario-stamps.js";
import { engageNow } from "./situation.js";
import type { SimExport } from "./twin-export.js";

/**
 * A prepared response is tested again when a signal opens, by the engine alone.
 *
 * The twin and the engine's answers are the recording the parity tests use
 * (`scenario-run-parity.fixture.json`): a scenario where one site of three
 * queues, an option that ends the queue (six beds at Lakeshore from day 5) and
 * one that replaces a choice of the scenario (three beds at North instead of
 * five). No language model is anywhere in this file: a retest has none.
 *
 * What is under test: that a retest gives the figures a person's own Run would
 * give; that it runs on what the scenario holds now; that the queue runs one
 * at a time, skips a state it already tested and gives up on a silent engine;
 * and that nothing unfinished is ever shown as a result.
 */

interface Recording {
  overrides: ScenarioOverride[];
  calls: RecordedCall[];
  digest: RunDigest;
}
const fixture = JSON.parse(readFileSync(new URL("./scenario-run-parity.fixture.json", import.meta.url), "utf8")) as {
  twin: SimExport;
  scenario: { id: string; name: string };
  horizon: number;
  activity: string;
  asItIs: Recording;
  withOption: Recording & { added: ScenarioOverride[] };
  withReplacement: Recording & { retired: string[]; added: ScenarioOverride[] };
};

const NOW = new Date("2026-11-20T15:00:00Z");
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;

/** A stamp as a response keeps it: what it is, without the row that held it. */
function kept(o: ScenarioOverride): OptionStamp {
  const { id: _id, start, days, ...body } = stampFromOverride(o)!;
  return { body: body as OptionStamp["body"], start, days };
}

const AS_IT_IS = figuresOf(fixture.asItIs.digest.full);
const WITH_BEDS = figuresOf(fixture.withOption.digest.full);
const WITH_REPLACEMENT = figuresOf(fixture.withReplacement.digest.full);

const expected = (over: Partial<DecisionExpected> = {}): DecisionExpected => ({
  horizon: fixture.horizon,
  activity: fixture.activity,
  asItIs: AS_IT_IS,
  withOption: WITH_BEDS,
  sites: [],
  arrivals: {},
  basis: [],
  changes: [],
  retires: [],
  mechanism: "Lakeshore is the only site of its catchment.",
  notTested: [],
  notes: [],
  ...over,
});

const response = (over: Partial<PreparedResponse> = {}): PreparedResponse => ({
  id: "beds",
  projectId: "p1",
  signalTypeId: "kind-1",
  signalType: "Occupation élevée",
  label: "Open 6 beds at Lakeshore from day 5",
  approver: null,
  exchangeId: "x1",
  optionStep: "s2",
  optionLabel: "Open 6 beds at Lakeshore from day 5",
  scenarioId: fixture.scenario.id,
  scenarioName: fixture.scenario.name,
  scenarioMark: scenarioMark(fixture.asItIs.overrides),
  objective: "Nobody waits at Lakeshore.",
  optionStamps: [kept(fixture.withOption.added[0]!)],
  expected: expected(),
  sourceSteps: [],
  testedAt: before(40 * 24 * H),
  keptBy: "A planner",
  keptAt: before(40 * 24 * H),
  ...over,
});

/** The scenario's choice the replacement takes out, remembered under an id the scenario no longer uses. */
const RETIRED = fixture.asItIs.overrides.find((o) => o.id === fixture.withReplacement.retired[0])!;
const replacement = (over: Partial<PreparedResponse> = {}): PreparedResponse =>
  response({
    id: "fewer",
    label: "3 beds at North instead of 5",
    optionStamps: [kept(fixture.withReplacement.added[0]!)],
    expected: expected({
      withOption: WITH_REPLACEMENT,
      retires: [{ id: "a-row-deleted-since", stamp: kept(RETIRED), text: "+5 lit at North from day 8", replacedBy: 0 }],
    }),
    ...over,
  });

/**
 * The recorded engine. The stamps of a response being retested have no row,
 * so their effects carry a temporary id; the engine only writes that id in
 * its trace, and it is renamed here so the recording's request matches.
 */
function recorded(): ScenarioEngine & { compares: number } {
  const replay = replayEngine([...fixture.asItIs.calls, ...fixture.withOption.calls, ...fixture.withReplacement.calls]);
  const named: Record<string, string> = {
    "capacity-retest-beds-1": `capacity-${fixture.withOption.added[0]!.id}`,
    "capacity-retest-fewer-1": `capacity-${fixture.withReplacement.added[0]!.id}`,
  };
  const engine = {
    compares: 0,
    spread: (p: Parameters<ScenarioEngine["spread"]>[0]) => replay.spread(p),
    compare: (p: Parameters<ScenarioEngine["compare"]>[0]) => {
      engine.compares += 1;
      return replay.compare({ ...p, event: { ...p.event, effects: p.event.effects.map((e) => (named[e.id] ? { ...e, id: named[e.id]! } : e)) } });
    },
  };
  return engine;
}

const world = (over: Partial<WorldNow> = {}): WorldNow => ({
  reality: fixture.twin,
  system: fixture.twin,
  scenario: fixture.scenario,
  overrides: fixture.asItIs.overrides,
  ...over,
});

const runnerFor = (engine: ScenarioEngine, w = world()) =>
  new ScenarioRunner(engine, { reality: w.reality, system: w.system, scenario: w.scenario, horizon: fixture.horizon, activity: fixture.activity });

// --- one retest --------------------------------------------------------------

test("a retest gives the figures a person's own Run gives, in two passes of the engine", async () => {
  const engine = recorded();
  const stamps = stampsOf(fixture.asItIs.overrides);
  const runner = runnerFor(engine);
  const out = await retestOne(runner, benchOf(runner, stamps), stamps, response());

  assert.deepEqual(out.asItIs, AS_IT_IS);
  assert.deepEqual(out.withOption, WITH_BEDS);
  assert.equal(out.asItIs.sitesWithQueue, 1);
  assert.equal(out.withOption.sitesWithQueue, 0);
  assert.equal(engine.compares, 2);
});

test("a response that replaces a choice finds it by what it is, not by the row that held it", async () => {
  const engine = recorded();
  const stamps = stampsOf(fixture.asItIs.overrides);
  const runner = runnerFor(engine);
  // The response remembers the choice under an id the scenario no longer has.
  assert.ok(!stamps.some((s) => s.id === "a-row-deleted-since"));
  assert.deepEqual([...retiredNow(stamps, replacement().expected.retires!)], [RETIRED.id]);

  const out = await retestOne(runner, benchOf(runner, stamps), stamps, replacement());
  assert.deepEqual(out.withOption, WITH_REPLACEMENT);
});

test("a choice the scenario no longer holds cannot be replaced: refused before the engine is asked", async () => {
  const engine = recorded();
  const without = fixture.asItIs.overrides.filter((o) => o.id !== RETIRED.id);
  const stamps = stampsOf(without);
  const runner = runnerFor(engine, world({ overrides: without }));

  await assert.rejects(retestOne(runner, benchOf(runner, stamps), stamps, replacement()), (err: unknown) => {
    assert.ok(err instanceof RetestRefused);
    assert.match(err.message, /no longer holds “\+5 lit at North from day 8”, which this response replaces/);
    return true;
  });
  assert.equal(engine.compares, 0);
});

// --- the state a retest runs on ----------------------------------------------

test("the same twin read later has the same mark; what the engine would see differently has another", () => {
  const { overrides } = fixture.asItIs;
  const mark = stateMark(fixture.twin, overrides, 30, "lit");

  const later: SimExport = { ...fixture.twin, generated_at: "2027-01-01T00:00:00Z", facilities: [...fixture.twin.facilities].reverse() };
  assert.equal(stateMark(later, [...overrides].reverse(), 30, "lit"), mark);

  const fuller: SimExport = { ...fixture.twin, facilities: fixture.twin.facilities.map((f, i) => (i === 0 ? { ...f, census: { patient: 12 } } : f)) };
  assert.notEqual(stateMark(fuller, overrides, 30, "lit"), mark);
  assert.notEqual(stateMark(fixture.twin, overrides.slice(1), 30, "lit"), mark);
  assert.notEqual(stateMark(fixture.twin, overrides, 60, "lit"), mark);
  assert.notEqual(stateMark(fixture.twin, overrides, 30, "urgence"), mark);
});

// --- the queue ---------------------------------------------------------------

type StoredRow = RetestRow & { signalId: string; timing: Finished["timing"] };

/** Retests kept in a list, with a clock the test moves. Rows are newest first, as the card reads them. */
function memory(responses: PreparedResponse[], now: () => WorldNow | null = world) {
  const clock = { at: NOW.getTime() };
  const rows: StoredRow[] = [];
  const asked = { responses: 0, world: 0 };
  const row = (id: string) => rows.find((r) => r.id === id)!;
  const store: RetestStore = {
    async responses(projectId, kind) {
      asked.responses += 1;
      return responses.filter((r) => r.projectId === projectId && r.signalTypeId === kind);
    },
    async settled(id) {
      return rows.some(
        (r) =>
          r.preparedResponseId === id &&
          (r.status === "queued" || r.status === "running" || ((r.status === "done" || r.status === "unchanged") && clock.at - Date.parse(r.finishedAt!) < MIN_GAP_MS)),
      );
    },
    async queue({ responseId, signalId }) {
      const id = `t${rows.length + 1}`;
      rows.unshift({
        id,
        preparedResponseId: responseId,
        signalId,
        status: "queued",
        stateMark: null,
        sameAs: null,
        figures: null,
        reason: null,
        totalMs: null,
        timing: null,
        requestedAt: new Date(clock.at).toISOString(),
        startedAt: null,
        finishedAt: null,
      });
      return id;
    },
    async lastDone(id) {
      const r = rows.find((x) => x.preparedResponseId === id && x.status === "done");
      return r ? { id: r.id, stateMark: r.stateMark } : null;
    },
    async start(id, mark) {
      Object.assign(row(id), { status: "running", stateMark: mark, startedAt: new Date(clock.at).toISOString() });
    },
    async finish(id, status: RetestStatus, f: Finished = {}) {
      Object.assign(row(id), {
        status,
        stateMark: f.mark ?? row(id).stateMark,
        sameAs: f.sameAs ?? null,
        figures: f.figures ?? null,
        reason: f.reason ?? null,
        timing: f.timing ?? null,
        totalMs: f.timing?.totalMs ?? null,
        finishedAt: new Date(clock.at).toISOString(),
      });
    },
    async world() {
      asked.world += 1;
      return now();
    },
  };
  return { store, rows, asked, clock, of: (responseId: string) => rows.filter((r) => r.preparedResponseId === responseId) };
}

const quiet = { info: () => undefined, warn: () => undefined };
const SIGNAL = { id: "sig-1", projectId: "p1", signalTypeId: "kind-1" };

/** An engine that answers anything with an empty run. */
const blank: ScenarioEngine = {
  spread: async () => ({ event: { effects: [] } }),
  compare: async () => ({ datasets: [] }),
};

test("a signal that opens has every response of its kind tested: the scenario as it is once, then one pass each", async () => {
  const engine = recorded();
  const m = memory([response(), replacement(), response({ id: "other-kind", signalTypeId: "kind-2" })]);
  await new Retests(m.store, engine, quiet).request(SIGNAL);

  assert.deepEqual(m.rows.map((r) => [r.preparedResponseId, r.status]).sort(), [
    ["beds", "done"],
    ["fewer", "done"],
  ]);
  assert.deepEqual(m.of("beds")[0]!.figures, { asItIs: AS_IT_IS, withOption: WITH_BEDS });
  assert.deepEqual(m.of("fewer")[0]!.figures, { asItIs: AS_IT_IS, withOption: WITH_REPLACEMENT });
  // Three passes, not four: both responses are set beside the same run of the scenario as it is.
  assert.equal(engine.compares, 3);
  // One reading of the twin for the two of them, and each says which signal asked.
  assert.equal(m.asked.world, 1);
  assert.ok(m.rows.every((r) => r.signalId === "sig-1"));
  // What its time was made of is kept: a measure, beside the result. The first
  // response pays for the epidemic's propagation and the scenario as it is; the
  // second adds beds, so it reuses both and costs one pass.
  assert.deepEqual(m.of("beds")[0]!.timing!.engine.map((c) => c.call), ["spread", "pass", "pass"]);
  assert.deepEqual(m.of("fewer")[0]!.timing!.engine.map((c) => c.call), ["pass"]);
});

test("no new run while the state has not changed; a new one as soon as it has", async () => {
  const engine = recorded();
  let twin = fixture.twin;
  const m = memory([response()], () => world({ reality: twin, system: twin }));
  const retests = new Retests(m.store, engine, quiet);

  await retests.request(SIGNAL);
  assert.equal(engine.compares, 2);

  // Another signal of the same kind a few seconds later: the response was tested a moment ago, nothing is even queued.
  m.clock.at += 10 * S;
  await retests.request({ ...SIGNAL, id: "sig-2" });
  assert.equal(m.rows.length, 1);

  // An hour later, on the same twin and the same scenario: the state is read, found the same, and the engine is left alone.
  m.clock.at += H;
  await retests.request({ ...SIGNAL, id: "sig-3" });
  assert.equal(engine.compares, 2);
  assert.deepEqual(
    m.rows.map((r) => [r.status, r.sameAs]),
    [
      ["unchanged", "t1"],
      ["done", null],
    ],
  );
  assert.equal(m.rows[0]!.stateMark, m.rows[1]!.stateMark);

  // The same twin read again says it was read later, and nothing else: still no run.
  twin = { ...fixture.twin, generated_at: "2027-01-01T00:00:00Z" };
  m.clock.at += H;
  await retests.request({ ...SIGNAL, id: "sig-4" });
  assert.equal(m.rows[0]!.status, "unchanged");
  assert.equal(engine.compares, 2);

  // The twin moves (a site now holds patients): the next signal gets a real run, on that state.
  twin = { ...fixture.twin, facilities: fixture.twin.facilities.map((f, i) => (i === 0 ? { ...f, census: { patient: 9 } } : f)) };
  m.clock.at += H;
  await retests.request({ ...SIGNAL, id: "sig-5" });
  assert.equal(m.rows[0]!.status, "done");
  assert.notEqual(m.rows[0]!.stateMark, m.rows[1]!.stateMark);
  assert.equal(engine.compares, 4);
});

test("one run at a time per project, and signals of one kind that open together ask for one batch", async () => {
  let active = 0;
  let most = 0;
  const slow: ScenarioEngine = {
    ...blank,
    compare: async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { datasets: [] };
    },
  };
  const m = memory([response(), response({ id: "other-kind", signalTypeId: "kind-2" })]);
  const retests = new Retests(m.store, slow, quiet);

  // A wave: four signals of one kind and one of another, in the same instant.
  await Promise.all([
    retests.request(SIGNAL),
    retests.request({ ...SIGNAL, id: "sig-2" }),
    retests.request({ ...SIGNAL, id: "sig-3" }),
    retests.request({ ...SIGNAL, id: "sig-4" }),
    retests.request({ id: "sig-5", projectId: "p1", signalTypeId: "kind-2" }),
  ]);

  assert.equal(most, 1);
  // Two batches read their responses, not five; one test per response.
  assert.equal(m.asked.responses, 2);
  assert.deepEqual(m.rows.map((r) => [r.preparedResponseId, r.status]).sort(), [
    ["beds", "done"],
    ["other-kind", "done"],
  ]);
});

test("an engine that does not answer: the retest is abandoned at the limit and says so, and the next is not left waiting for the same silence", async () => {
  const silent: ScenarioEngine = { ...blank, compare: () => new Promise(() => undefined) };
  const m = memory([response(), replacement()]);
  await new Retests(m.store, silent, quiet, 30).request(SIGNAL);

  const beds = m.of("beds")[0]!;
  assert.equal(beds.status, "abandoned");
  assert.match(beds.reason!, /The engine had not answered after .*, so the test was abandoned\./);
  assert.equal(beds.figures, null);
  const fewer = m.of("fewer")[0]!;
  assert.equal(fewer.status, "failed");
  assert.match(fewer.reason!, /was not tried/);
});

test("an engine that cannot be reached blocks neither the card nor Engage", async () => {
  const down: ScenarioEngine = {
    ...blank,
    compare: async () => {
      throw new AppError("SIM_UNAVAILABLE", "Simulation service is unreachable.", 503);
    },
  };
  const m = memory([response()]);
  // The request settles; it does not reject, and nothing waits on it anyway.
  await new Retests(m.store, down, quiet).request(SIGNAL);
  assert.equal(m.rows[0]!.status, "failed");
  assert.equal(m.rows[0]!.reason, "The simulation engine could not be reached.");

  // The card of the signal is whole: the kept test's figures, what the retest came to, and a response that can be engaged.
  m.clock.at += 20 * S;
  const at = new Date(m.clock.at);
  const card = onCard(response(), { exists: true, mark: response().scenarioMark }, at, liveTest(m.rows, at));
  assert.deepEqual(card.withIt, WITH_BEDS);
  assert.deepEqual(card.without, AS_IT_IS);
  assert.equal(card.live.state, "none");
  assert.equal(card.live.figures, null);
  assert.equal(card.live.says, "The test on the current state could not be made 20 s ago: The simulation engine could not be reached. What is shown is the test kept in calm time.");
  const signal = { closedAt: null, stageNo: 1, stages: 5 } as LiveSignal;
  assert.deepEqual(engageNow(signal), { possible: true, why: null });
  // And what is engaged then is the kept test alone: a failed retest adds nothing to the decision.
  assert.equal(expectedOnEngage(response().expected, card.live).retested, undefined);
});

test("a server that tests nothing: asking for retests is a no-op, not an error", () => {
  // No queue was started in this process, as in every test that raises a signal.
  assert.equal(requestRetests(SIGNAL), undefined);
});

test("a scenario that is gone, and a choice that is gone: each abandons with its reason, and the rest is still tested", async () => {
  const gone = memory([response()], () => null);
  const engine = recorded();
  await new Retests(gone.store, engine, quiet).request(SIGNAL);
  assert.equal(gone.rows[0]!.status, "abandoned");
  assert.match(gone.rows[0]!.reason!, /The scenario it was tested on \(“.*”\) no longer exists, so it cannot be tested again\./);
  assert.equal(engine.compares, 0);

  // The choice the second response replaces was taken out of the scenario since.
  const without = fixture.asItIs.overrides.filter((o) => o.id !== RETIRED.id);
  const m = memory([replacement(), response({ id: "plain", optionStamps: [] })], () => world({ overrides: without }));
  await new Retests(m.store, blank, quiet).request(SIGNAL);
  assert.equal(m.of("fewer")[0]!.status, "abandoned");
  assert.match(m.of("fewer")[0]!.reason!, /no longer holds/);
  assert.equal(m.of("plain")[0]!.status, "done");
});

// --- what the card says ------------------------------------------------------

const row = (over: Partial<RetestRow>): RetestRow => ({
  id: "t1",
  preparedResponseId: "beds",
  status: "done",
  stateMark: "m1",
  sameAs: null,
  figures: null,
  reason: null,
  totalMs: null,
  requestedAt: before(2 * MIN),
  startedAt: null,
  finishedAt: null,
  ...over,
});
const RESULT = { asItIs: AS_IT_IS, withOption: WITH_BEDS };

test("the card first shows the last test known, then the retest takes its place and says when it ran", () => {
  // Nothing yet: the kept test.
  const none = liveTest([], NOW);
  assert.deepEqual([none.state, none.figures, none.current], ["none", null, false]);
  assert.equal(none.says, "Not tested on the current state. What is shown is the test kept in calm time.");

  // Queued, then running: still the kept test, and the card says a test is on its way.
  const queued = liveTest([row({ status: "queued", requestedAt: before(5 * S) })], NOW);
  assert.deepEqual([queued.state, queued.figures], ["testing", null]);
  assert.equal(queued.says, "Waiting its turn to be tested on the current state. What is shown is the test kept in calm time.");
  const running = liveTest([row({ status: "running", requestedAt: before(20 * S), startedAt: before(12 * S) })], NOW);
  assert.equal(running.says, "Being tested on the current state, started 12 s ago. What is shown is the test kept in calm time.");
  assert.equal(running.figures, null);

  // Done: its figures are the ones shown, with their age and how long the run took.
  const done = liveTest([row({ figures: RESULT, finishedAt: before(40 * S), totalMs: 61_400 })], NOW);
  assert.deepEqual([done.state, done.current, done.seconds, done.testedAt], ["tested", true, 61, before(40 * S)]);
  assert.deepEqual(done.figures, RESULT);
  assert.equal(done.says, "Tested on the current state 40 s ago.");
});

test("a retest that is running, abandoned or failed is never shown as a result", () => {
  const earlier = row({ id: "t1", figures: RESULT, requestedAt: before(3 * H + MIN), finishedAt: before(3 * H) });

  // A new one is running: what is shown is the earlier result, said to be of the network as it was.
  const running = liveTest([row({ id: "t2", status: "running", requestedAt: before(15 * S), startedAt: before(10 * S) }), earlier], NOW);
  assert.deepEqual([running.state, running.current], ["testing", false]);
  assert.deepEqual(running.figures, RESULT);
  assert.equal(running.says, "Being tested on the current state, started 10 s ago. What is shown is its last test, on the network as it was 3 h ago.");

  // The new one was abandoned: its reason is said, the earlier result stays, and is no longer called current.
  const abandoned = liveTest(
    [row({ id: "t2", status: "abandoned", reason: "The engine had not answered after 3 min, so the test was abandoned.", requestedAt: before(5 * MIN), finishedAt: before(2 * MIN) }), earlier],
    NOW,
  );
  assert.deepEqual([abandoned.state, abandoned.current], ["tested", false]);
  assert.deepEqual(abandoned.figures, RESULT);
  assert.equal(
    abandoned.says,
    "The test on the current state was abandoned 2 min ago: The engine had not answered after 3 min, so the test was abandoned. What is shown is its last test, on the network as it was 3 h ago.",
  );

  // With no earlier result there are no retest figures at all.
  const alone = liveTest([row({ status: "abandoned", reason: "The scenario is gone.", finishedAt: before(MIN) })], NOW);
  assert.deepEqual([alone.state, alone.figures], ["none", null]);

  // A test left running by a server that stopped is not "being tested" for ever.
  const orphan = liveTest([row({ status: "running", requestedAt: before(ORPHAN_AFTER_MS + MIN), startedAt: before(ORPHAN_AFTER_MS + MIN) })], NOW);
  assert.equal(orphan.state, "none");
  assert.match(orphan.says, /never finished: the server stopped before it did\./);
});

test("a result is called current while it is young, or while the state was found unchanged a moment ago", () => {
  const old = row({ id: "t1", figures: RESULT, requestedAt: before(3 * H + MIN), finishedAt: before(3 * H) });

  const stale = liveTest([old], NOW);
  assert.deepEqual([stale.state, stale.current], ["tested", false]);
  assert.equal(stale.says, "Tested on the network as it was 3 h ago; it has not been tested since.");

  const rechecked = liveTest([row({ id: "t2", status: "unchanged", sameAs: "t1", requestedAt: before(45 * S), finishedAt: before(40 * S) }), old], NOW);
  assert.equal(rechecked.current, true);
  assert.deepEqual(rechecked.figures, RESULT);
  assert.equal(rechecked.says, "Tested on the current state: the run is 3 h old, and the state had not changed 40 s ago.");

  const justPast = liveTest([row({ figures: RESULT, finishedAt: before(CURRENT_FOR_MS + MIN) })], NOW);
  assert.equal(justPast.current, false);
});

test("engaging records the retest the card showed beside the kept test, with its date", () => {
  const live = liveTest([row({ figures: { asItIs: AS_IT_IS, withOption: WITH_REPLACEMENT }, finishedAt: before(40 * S) })], NOW);
  const recorded = expectedOnEngage(response().expected, live);
  // The kept test is untouched: its sites and its arrivals go with these figures.
  assert.deepEqual(recorded.withOption, WITH_BEDS);
  assert.deepEqual(recorded.retested, { testedAt: before(40 * S), current: true, asItIs: AS_IT_IS, withOption: WITH_REPLACEMENT });
});
