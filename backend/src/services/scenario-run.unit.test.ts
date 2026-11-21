import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { RunDigest } from "./analyst-tools.js";
import { runDigestSchema } from "./analyst-tools.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import { capacityGrid, islandSeries, occupancyGrid, ScenarioRunner, type ScenarioWorld, serverRun } from "./scenario-run.js";
import { replayEngine, type RecordedCall } from "./scenario-run-recording.js";
import { basisOfStamp, choiceLine, engineInput, isChoice, PLACED_RESPONSE, rulesFromStep, stampsOf, twinContext, type ChoiceStamp, type Stamp } from "./scenario-stamps.js";
import type { SimExport } from "./twin-export.js";

/**
 * The server runs a scenario the way the page does.
 *
 * The fixture is a recording of the real engine on a small twin: what a run of
 * a scenario asks of it, what it answers, and the figures the run then shows —
 * once for the scenario as it is, once with an option's stamps added to it. The
 * page's test (`frontend/app/studio/simulation/hex/run-parity.test.ts`) replays
 * the same file through the page's own code. Both must send the recorded
 * requests and arrive at the recorded figures, so neither side can change how
 * a stamp is translated or a queue is counted without the other's test failing.
 */

interface Recorded {
  overrides: ScenarioOverride[];
  calls: RecordedCall[];
  digest: RunDigest;
}

const fixture = JSON.parse(readFileSync(new URL("./scenario-run-parity.fixture.json", import.meta.url), "utf8")) as {
  twin: SimExport;
  scenario: { id: string; name: string };
  horizon: number;
  activity: string;
  ranAt: string;
  asItIs: Recorded;
  withOption: Recorded & { label: string; added: ScenarioOverride[] };
  withReplacement: Recorded & { label: string; retired: string[]; added: ScenarioOverride[] };
  /** A recorded response the organisation wrote, placed on a day: a transfer of patients. */
  withResponse: Recorded & { label: string; added: ScenarioOverride[]; cost: number };
  /** A response the engine writes itself from the network. */
  withBuiltIn: Recorded & { label: string; added: ScenarioOverride[]; cost: number };
};

const world: ScenarioWorld = {
  reality: fixture.twin,
  system: fixture.twin,
  scenario: fixture.scenario,
  horizon: fixture.horizon,
  activity: fixture.activity,
};
const now = () => new Date(fixture.ranAt);
const requests = (calls: RecordedCall[]) => calls.map((c) => ({ call: c.call, request: c.request }));

test("the scenario as it is: the server sends the engine what the page sends, and reads the same figures", async () => {
  const engine = replayEngine(fixture.asItIs.calls);
  const digest = await new ScenarioRunner(engine, world, now).digest(stampsOf(fixture.asItIs.overrides));

  // Spread then run, for the events alone and then with the choices: four calls, in the page's order.
  assert.deepEqual(engine.asked, requests(fixture.asItIs.calls));
  assert.deepEqual(digest, fixture.asItIs.digest);
  // And it is the summary the analyst's tools accept from the page.
  assert.deepEqual(runDigestSchema.parse(digest), digest);

  // The recording says something: one site of three queues, and a catchment has nowhere to go.
  assert.equal(digest.full.sitesWithQueue, 1);
  assert.equal(digest.full.sitesWithActivity, 3);
  assert.equal(digest.full.firstQueueDay, 16);
  assert.deepEqual(digest.stranded, { names: ["Pointe"], residents: 8000 });
  assert.ok((digest.full.strandedWaitingDays ?? 0) > 50);
});

test("an option tested on the server gives the figures Run gives once its stamps are in the scenario", async () => {
  const added = stampsOf(fixture.withOption.added);
  const scenario = stampsOf(fixture.asItIs.overrides);
  // What the page holds after "Add to scenario": the scenario's stamps and the option's, by day.
  const onThePage = stampsOf(fixture.withOption.overrides);

  const engine = replayEngine([...fixture.asItIs.calls, ...fixture.withOption.calls]);
  const runner = new ScenarioRunner(engine, world, now);
  await runner.digest(scenario);
  const before = engine.asked.length;
  const digest = await runner.digest(ScenarioRunner.withOption(scenario, added));

  assert.deepEqual(ScenarioRunner.withOption(scenario, added), onThePage);
  assert.deepEqual(digest, fixture.withOption.digest);
  assert.equal(digest.full.sitesWithQueue, 0);
  assert.equal(digest.events.sitesWithQueue, 1);

  // What the option cost: one pass of the network. The events-only pass never
  // sees a choice and the option changes no contact, so neither is run again.
  assert.equal(before, 4);
  assert.deepEqual(engine.asked.slice(before), requests(fixture.withOption.calls).slice(-1));
  assert.equal(runner.calls, 5);
});

test("an option that replaces a choice gives the figures Run gives once the recipe holds the new stamp and not the old", async () => {
  const added = stampsOf(fixture.withReplacement.added);
  const scenario = stampsOf(fixture.asItIs.overrides);
  const retired = new Set(fixture.withReplacement.retired);
  // What the page holds after "Add to scenario": the new stamp written, the old one deleted.
  const onThePage = stampsOf(fixture.withReplacement.overrides);

  // The scenario holds five beds at Nord from day 8; the option makes it three from day 6.
  assert.deepEqual(
    scenario.filter((s) => retired.has(s.id)).map((s) => [s.kind, s.start, s.kind === "capacity" ? s.amount : null]),
    [["capacity", 8, 5]],
  );
  const applied = ScenarioRunner.withOption(scenario, added, retired);
  assert.deepEqual(applied, onThePage);
  // One stamp for that choice, not the old one with a correction stacked on it.
  assert.deepEqual(
    applied.filter((s) => s.kind === "capacity").map((s) => [s.start, s.kind === "capacity" ? s.amount : null]),
    [[6, 3]],
  );

  const engine = replayEngine([...fixture.asItIs.calls, ...fixture.withReplacement.calls]);
  const runner = new ScenarioRunner(engine, world, now);
  await runner.digest(scenario);
  const before = engine.asked.length;
  const digest = await runner.digest(applied);
  assert.deepEqual(digest, fixture.withReplacement.digest);
  // The run says something the scenario's own does not: other beds, another peak.
  assert.notDeepEqual(digest.full.island, fixture.asItIs.digest.full.island);
  // Still one pass: the events-only run holds no choice, replaced or not.
  assert.deepEqual(engine.asked.slice(before), requests(fixture.withReplacement.calls).slice(-1));

  // A fresh server, as the page after the click: the page's four calls, the same figures.
  const fresh = replayEngine(fixture.withReplacement.calls);
  assert.deepEqual(await new ScenarioRunner(fresh, world, now).digest(onThePage), fixture.withReplacement.digest);
  assert.deepEqual(fresh.asked, requests(fixture.withReplacement.calls));
});

test("the pass with every choice, alone, gives the figures the two-pass run gives for it", async () => {
  // What a column of the options table is read from. The page's Run makes two
  // passes; the table only ever shows the second, so only the second is made.
  for (const recorded of [fixture.asItIs, fixture.withOption]) {
    const engine = replayEngine(recorded.calls);
    const pass = await new ScenarioRunner(engine, world, now).full(stampsOf(recorded.overrides));

    assert.deepEqual(pass.figures, recorded.digest.full);
    assert.deepEqual(
      pass.sites,
      recorded.digest.sites.map((s) => ({ id: s.id, name: s.name, capacity: s.capacity, break: s.full })),
    );
    assert.equal(pass.ranAt, fixture.ranAt);
    // One pass of the network (after its spread, when the scenario has one): the events-only pass is not asked for.
    assert.deepEqual(
      engine.asked.filter((c) => c.call !== "spread").map((c) => c.request),
      requests(recorded.calls)
        .filter((c) => c.call !== "spread")
        .slice(-1)
        .map((c) => c.request),
    );
  }
});

test("a run on a fresh server gives the page's four calls for the scenario with the option", async () => {
  const engine = replayEngine(fixture.withOption.calls);
  const digest = await new ScenarioRunner(engine, world, now).digest(stampsOf(fixture.withOption.overrides));
  assert.deepEqual(engine.asked, requests(fixture.withOption.calls));
  assert.deepEqual(digest, fixture.withOption.digest);
});

test("a failed events-only pass is not kept: the next run asks again", async () => {
  let fail = true;
  const inner = replayEngine(fixture.asItIs.calls);
  const runner = new ScenarioRunner(
    {
      spread: (p) => inner.spread(p),
      compare: async (p) => {
        if (fail) {
          fail = false;
          throw new Error("engine unreachable");
        }
        return inner.compare(p);
      },
    },
    world,
    now,
  );
  await assert.rejects(runner.digest(stampsOf(fixture.asItIs.overrides)), /unreachable/);
  assert.deepEqual(await runner.digest(stampsOf(fixture.asItIs.overrides)), fixture.asItIs.digest);
});

// --- the translation, read on its own ---------------------------------------

const ctx = twinContext(fixture.twin);

test("the twin's model is read off its mechanics, as the page reads it", () => {
  assert.equal(ctx.susceptible, "sain");
  assert.equal(ctx.infectious, "malade");
  assert.equal(ctx.immune, "gueri");
  assert.deepEqual(ctx.couplings, ["ecole", "menage"]);
  assert.deepEqual(ctx.acuities, ["hospitalisation"]);
  assert.deepEqual(ctx.activities, ["civiere", "lit"]);
  assert.deepEqual(ctx.care, [
    { acuity: "hospitalisation", activity: "lit" },
    { acuity: "urgence", activity: "civiere" },
  ]);
  assert.deepEqual(ctx.facilities.map((f) => [f.name, f.capacity.lit ?? 0]), [
    ["Lakeshore", 20],
    ["Nord", 40],
    ["Est", 30],
    ["Clinique Pointe", 0],
  ]);
});

test("choices are in the full run only, conditions in both", () => {
  const stamps = stampsOf(fixture.withOption.overrides);
  const events = engineInput(stamps, ctx, "events", fixture.horizon);
  const full = engineInput(stamps, ctx, "full", fixture.horizon);
  assert.deepEqual(events.occupancy, { lit: 0.6 });
  assert.deepEqual(full.occupancy, { lit: 0.6 });
  assert.deepEqual(events.effects.map((e) => e.target), ["demand.incidence"]);
  // In the order the stamps start: beds on days 5 and 8, heat on day 10.
  assert.deepEqual(full.effects.map((e) => e.target), ["resource.capacity", "resource.capacity", "demand.incidence"]);
  // The variant scales both runs; the school closure only the full one.
  assert.equal(events.spread!.changes.length, 2);
  assert.equal(full.spread!.changes.length, 4);
  assert.equal(events.spread!.offset, 2);
  // 30 % immune, placed beside the sick and never taken from them.
  assert.deepEqual(events.spread!.seeds["pop:west"], { sain: 20700, malade: 300, gueri: 9000 });
});

test("added beds count toward a site's capacity from the day they open, in the full run only", () => {
  const stamps = stampsOf(fixture.withOption.overrides);
  const lake = ctx.facilities.findIndex((f) => f.id === "site:lake");
  assert.equal(capacityGrid(ctx.facilities, stamps, "events", "lit", 10)[9]![lake], 20);
  assert.equal(capacityGrid(ctx.facilities, stamps, "full", "lit", 10)[4]![lake], 20);
  assert.equal(capacityGrid(ctx.facilities, stamps, "full", "lit", 10)[5]![lake], 26);
});

test("a table the engine did not send reads as unreported, never as zero", () => {
  const grid = occupancyGrid(undefined, ["a", "b"], "lit", 2);
  assert.ok(grid.flat().every(Number.isNaN));
  assert.ok(Number.isNaN(islandSeries(grid, [[10, 10], [10, 10]])[0]!));
});

test("each stamp carries its level of evidence, assigned from what it is", () => {
  const stamps = stampsOf(fixture.withOption.overrides);
  const basis = stamps.flatMap((s) => basisOfStamp(s, ctx, "scenario"));
  const of = (kind: Stamp["kind"]) => stamps.filter((s) => s.kind === kind).flatMap((s) => basisOfStamp(s, ctx, "scenario"));
  // Only a heat wave's rate is published; the share needing a stretcher is not.
  assert.deepEqual(of("heat").map((b) => b.evidence), ["published", "assumption"]);
  assert.ok(basis.filter((b) => b.evidence === "published").length === 1);
  assert.ok(of("capacity").every((b) => b.evidence === "assumption" && /open and staffed/.test(b.element)));
  assert.match(of("occupancy")[0]!.element, /60 % of lit already in use/);
  assert.match(of("seed")[0]!.element, /300 sick in Ouest-de-l'Île on day 2/);
  // Nothing in a scenario is a measurement: that level is for what the twin holds.
  assert.ok(basis.every((b) => b.evidence !== "measured"));
});

test("the run made by the server for a script is the run the page has on screen", async () => {
  // What `POST /analyst/run` returns: the summary a person's Run would send the analyst.
  const engine = replayEngine(fixture.asItIs.calls);
  const digest = await serverRun(engine, world, fixture.asItIs.overrides, now);
  assert.deepEqual(digest, fixture.asItIs.digest);
  assert.deepEqual(runDigestSchema.parse(digest), digest);
  // The page's four calls, in its order: nothing a person's Run does is skipped.
  assert.deepEqual(engine.asked, requests(fixture.asItIs.calls));
  // Up to date by construction: it was run on the scenario as it is now.
  assert.equal(digest.stale, false);
});

test("an activity no site provides is refused before the engine is asked", async () => {
  const engine = replayEngine(fixture.asItIs.calls);
  await assert.rejects(
    serverRun(engine, { ...world, activity: "bloc" }, fixture.asItIs.overrides, now),
    (e: Error & { code?: string }) => e.code === "ACTIVITY_NOT_PROVIDED" && /No site on the map provides "bloc"[\s\S]*civiere, lit/.test(e.message),
  );
  assert.deepEqual(engine.asked, []);
});

// --- a recorded response, placed in the scenario ----------------------------

test("a recorded response is run by the same run as the stamps, and gives the figures Run gives once it is in the scenario", async () => {
  const scenario = stampsOf(fixture.asItIs.overrides);
  const added = stampsOf(fixture.withResponse.added);
  const onThePage = stampsOf(fixture.withResponse.overrides);
  assert.deepEqual(ScenarioRunner.withOption(scenario, added), onThePage);

  const engine = replayEngine([...fixture.asItIs.calls, ...fixture.withResponse.calls]);
  const runner = new ScenarioRunner(engine, world, now);
  await runner.digest(scenario);
  const before = engine.asked.length;
  const digest = await runner.digest(onThePage);
  assert.deepEqual(digest, fixture.withResponse.digest);
  // One more pass, as for any option: the events-only run never follows a response.
  assert.deepEqual(engine.asked.slice(before), requests(fixture.withResponse.calls).slice(-1));

  // What the engine was sent: the response's own rules, in place of the do-nothing
  // response, made to start on the day it was placed. Nothing else in the request differs.
  const sent = engine.asked.at(-1)!.request as { policies: string[]; customPolicies?: { id: string; name: string; rules: Record<string, any>[] }[] };
  assert.deepEqual(sent.policies, []);
  assert.deepEqual(
    sent.customPolicies!.map((p) => [p.id, p.name, p.rules.map((r) => [r.id, r.trigger, r.action.kind])]),
    [[PLACED_RESPONSE, "Send Lakeshore's queue to Nord", [["lake-to-north", { when: "from_tick", start: 12, end: null }, "transfer"]]]],
  );
  const asItIs = engine.asked[3]!.request as Record<string, unknown>;
  assert.deepEqual({ ...sent, policies: ["null"], customPolicies: undefined }, { ...asItIs, customPolicies: undefined });

  // The recording says something: patients sent from Lakeshore to Nord wait less, and the queue is still Lakeshore's.
  assert.equal(fixture.asItIs.digest.full.waitingDays, 76.48);
  assert.equal(digest.full.waitingDays, 11.2);
  assert.equal(digest.full.sitesWithQueue, 1);
  // The events-only half is the scenario's own: a response is a choice.
  assert.deepEqual(digest.events, fixture.asItIs.digest.events);

  // A fresh server, as the page after the click: the page's four calls, the same figures.
  const fresh = replayEngine(fixture.withResponse.calls);
  assert.deepEqual(await new ScenarioRunner(fresh, world, now).digest(onThePage), fixture.withResponse.digest);
  assert.deepEqual(fresh.asked, requests(fixture.withResponse.calls));
});

test("what a response cost is read from the run: each action's declared cost, each time it fired", async () => {
  const pass = async (recorded: Recorded) => new ScenarioRunner(replayEngine(recorded.calls), world, now).full(stampsOf(recorded.overrides));

  const transfer = await pass(fixture.withResponse);
  assert.deepEqual(transfer.figures, fixture.withResponse.digest.full);
  // Five hundred a transfer, fifteen times.
  assert.equal(transfer.cost, 7500);
  assert.equal(transfer.cost, fixture.withResponse.cost);

  // Nothing is spent where nobody responds, nor where a response's rules never fire.
  assert.equal((await pass(fixture.asItIs)).cost, 0);
  assert.equal((await pass(fixture.withOption)).cost, 0);
  assert.equal((await pass(fixture.withBuiltIn)).cost, 0);
});

test("a response the engine writes itself goes by its name, and the run reads its rows", async () => {
  const engine = replayEngine(fixture.withBuiltIn.calls);
  const digest = await new ScenarioRunner(engine, world, now).digest(stampsOf(fixture.withBuiltIn.overrides));
  assert.deepEqual(engine.asked, requests(fixture.withBuiltIn.calls));
  assert.deepEqual(digest, fixture.withBuiltIn.digest);

  const sent = engine.asked.at(-1)!.request as { policies: string[]; customPolicies?: unknown };
  assert.deepEqual(sent.policies, ["load-balance"]);
  assert.equal(sent.customPolicies, undefined);
  // On this network the engine's transfer watches stretchers, the first space activity by name, and no
  // destination has one free: its rules never fire, and the run says what it found, the scenario's own figures.
  assert.deepEqual(digest.full, fixture.asItIs.digest.full);
});

const RESPONSE = stampsOf(fixture.withResponse.added)[0] as Stamp & { kind: "response" };
const BUILT_IN = stampsOf(fixture.withBuiltIn.added)[0] as Stamp & { kind: "response" };

test("a recorded response is a choice: in the full run only, one at a time, and said when it cannot be followed as placed", () => {
  assert.equal(isChoice(RESPONSE), true);
  assert.equal(engineInput([RESPONSE], ctx, "events", 30).response, null);
  assert.deepEqual(engineInput([], ctx, "full", 30).response, null);

  const stored = engineInput([RESPONSE], ctx, "full", 30);
  assert.equal("builtIn" in stored.response!, false);
  assert.deepEqual(stored.notes, []);
  assert.deepEqual(engineInput([BUILT_IN], ctx, "full", 30).response, { builtIn: "load-balance" });

  // Two in one recipe: the first by day is run, and the note names the other.
  const both = engineInput([BUILT_IN, RESPONSE], ctx, "full", 30);
  assert.deepEqual(both.response, { builtIn: "load-balance" });
  assert.deepEqual(both.notes, ['The engine follows one recorded response in a run: "Transfer when full" is run, "Send Lakeshore\'s queue to Nord" is not.']);

  // The engine writes a built-in's rules itself: it cannot be made to wait for a day.
  const late = engineInput([{ ...BUILT_IN, start: 9 }], ctx, "full", 30);
  assert.deepEqual(late.notes, ['"Transfer when full" is written by the engine from the network, so it cannot wait for day 9: its rules apply from day 0.']);

  // A response that adds units: the page cannot count them day by day, and says so.
  const surge = engineInput([{ ...BUILT_IN, name: "Surge what is short, then transfer", ref: "surge-and-balance" }], ctx, "full", 30);
  assert.match(surge.notes[0]!, /adds or moves units during the run\. The engine does not report the units a site holds each day/);
});

test("a response's rules are made to start on the day it is placed, and a rule that starts later keeps its own day", () => {
  const rules = [
    { id: "a", trigger: { when: "every_tick", start: 0, end: null } },
    { id: "b", trigger: { when: "from_tick", start: 20, end: null } },
    { id: "c", trigger: { when: "between", start: 2, end: 15 } },
    { id: "d", trigger: { when: "between", start: 2, end: 8 } },
    { id: "e" },
  ];
  assert.deepEqual(
    rulesFromStep(rules, 12).map((r) => r.trigger),
    [
      { when: "from_tick", start: 12, end: null },
      { when: "from_tick", start: 20, end: null },
      { when: "between", start: 12, end: 15 },
      // A window that would end before it starts is kept open rather than left never to fire.
      { when: "from_tick", start: 12, end: null },
      { when: "from_tick", start: 12, end: null },
    ],
  );
});

test("a recorded response reads as a line, and what it rests on is an assumption", () => {
  assert.equal(choiceLine(RESPONSE as ChoiceStamp, ctx), "recorded response Send Lakeshore's queue to Nord, from day 12");
  assert.equal(choiceLine(BUILT_IN as ChoiceStamp, ctx), "recorded response Transfer when full, whole run");
  assert.deepEqual(basisOfStamp(RESPONSE, ctx, "option"), [
    {
      element:
        "The recorded response Send Lakeshore's queue to Nord, from day 12: its rules fire when their conditions hold, with the delay, the effectiveness and the cost each declares",
      evidence: "assumption",
      from: "option",
    },
  ]);
});
