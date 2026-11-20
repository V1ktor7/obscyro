import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { RunDigest } from "./analyst-tools.js";
import { runDigestSchema } from "./analyst-tools.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import { ScenarioRunner, capacityGrid, islandSeries, occupancyGrid, type ScenarioWorld } from "./scenario-run.js";
import { replayEngine, type RecordedCall } from "./scenario-run-recording.js";
import { basisOfStamp, engineInput, stampsOf, twinContext, type Stamp } from "./scenario-stamps.js";
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
