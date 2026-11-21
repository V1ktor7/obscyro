import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { AppError } from "../lib/errors.js";
import { ANALYST_MODEL, converse, type AnalystModel, type LoopEvent } from "./analyst.js";
import {
  MAX_OPTIONS,
  OPTION_TOOLS,
  benchFor,
  costOf,
  figuresOf,
  optionsClosing,
  testOption,
  type OptionsFinding,
  type OptionsProposal,
  type TestedOption,
} from "./analyst-options.js";
import { Recorded, ToolError, summariseVariant, type AnalystContext, type RunDigest } from "./analyst-tools.js";
import { declaresCost, listedResponses, transferRule, type StoredResponse } from "./analyst-responses.js";
import { Ledger, STRUCK } from "./analyst-verify.js";
import { decisionFromExchange } from "./decisions.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import type { ScenarioEngine } from "./scenario-run.js";
import { stampsOf } from "./scenario-stamps.js";
import { replayEngine, type RecordedCall } from "./scenario-run-recording.js";
import type { SimExport } from "./twin-export.js";

/**
 * An option is tested by the engine, or it is not an option.
 *
 * The twin and the engine's answers are the recording the parity tests use
 * (`scenario-run-parity.fixture.json`): a scenario where one site of three
 * queues, and an option — six beds at Lakeshore from day 5 — that ends the
 * queue. The model is scripted. What is under test is everything around it:
 * what the tool accepts and refuses, what it hands the model and what it keeps
 * for the screen, and that nothing with a figure in it reaches a person
 * without having come from a test.
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
  /** A response of the organisation's library, placed on day 12: a transfer, at a declared cost. */
  withResponse: Recording & { added: ScenarioOverride[]; cost: number };
  /** A response the engine writes itself. */
  withBuiltIn: Recording & { added: ScenarioOverride[]; cost: number };
  /** The transfer the analyst's own test writes. */
  withTransfer: Recording & { added: ScenarioOverride[]; cost: number };
};

/** The id the recording gave the option's effect, once its stamp was an override. */
const RECORDED_EFFECT = `capacity-${fixture.withOption.added[0]!.id}`;
const REPLACED_EFFECT = `capacity-${fixture.withReplacement.added[0]!.id}`;

/**
 * The recorded engine. A tested option's stamp has no override id yet, so its
 * effect carries a temporary one; the engine only writes that id in its trace,
 * and it is renamed here so the recording's request matches.
 */
function recorded(effect = RECORDED_EFFECT): ScenarioEngine & { compares: number } {
  const replay = replayEngine([...fixture.asItIs.calls, ...fixture.withOption.calls, ...fixture.withReplacement.calls]);
  const engine = {
    compares: 0,
    spread: (p: Parameters<ScenarioEngine["spread"]>[0]) => replay.spread(p),
    compare: (p: Parameters<ScenarioEngine["compare"]>[0]) => {
      engine.compares += 1;
      return replay.compare({
        ...p,
        event: { ...p.event, effects: p.event.effects.map((e) => (e.id === "capacity-option-1-1" ? { ...e, id: effect } : e)) },
      });
    },
  };
  return engine;
}

/** An engine that answers anything with nothing: for what the tool decides before a run. */
const blank: ScenarioEngine = {
  spread: async () => ({ event: { effects: [] } }),
  compare: async () => ({ datasets: [] }),
};

function context(engine: ScenarioEngine | null = recorded(), overrides = fixture.asItIs.overrides): AnalystContext {
  const scenario = { id: fixture.scenario.id, name: fixture.scenario.name, description: null, overrides };
  const ctx: AnalystContext = {
    environment: "parity",
    scenario,
    run: null,
    known: new Ledger(),
    world: async () => fixture.twin,
    datasets: async () => [],
    rows: async () => [],
    events: async () => [],
    live: () => Promise.reject(new Error("an objective does not read the live twin in these tests")),
  };
  ctx.bench = engine ? benchFor({ engine, scenario, horizon: fixture.horizon, activity: fixture.activity, world: ctx.world }) : null;
  return ctx;
}

const BEDS = { label: "Open 6 beds at Lakeshore from day 5", changes: [{ kind: "capacity", site: "Lakeshore", units: 6, from_day: 5 }] };
const run = (ctx: AnalystContext, input: unknown) => testOption.run(ctx, testOption.parse.parse(input));

// --- the tool ----------------------------------------------------------------

test("a tested option comes back beside the scenario as it is, with the engine's own counts", async () => {
  const engine = recorded();
  const out = (await run(context(engine), BEDS)) as Recorded;
  assert.ok(out instanceof Recorded);

  const result = out.result as Record<string, any>;
  // The same words and the same rounding as the run on screen would be read in.
  assert.deepEqual(result.scenario_as_it_is, summariseVariant(fixture.asItIs.digest.full));
  assert.deepEqual(result.with_this_option, summariseVariant(fixture.withOption.digest.full));
  assert.equal(result.scenario_as_it_is.sites_where_somebody_waits, 1);
  assert.equal(result.with_this_option.sites_where_somebody_waits, 0);
  assert.deepEqual(result.changes, [{ does: "adds", what: "capacity", site: "Lakeshore", site_id: "site:lake", activity: "lit", units_added: 6, from_day: 5 }]);
  assert.deepEqual(result.tested_over, { days: 30, activity: "lit" });
  assert.deepEqual(
    result.sites_where_somebody_waits_in_either.map((s: any) => [s.name, s.as_it_is.somebody_waits, s.with_this_option.somebody_waits]),
    [["Lakeshore", true, false]],
  );
  assert.match(result.how_to_read, /not forecasts/);

  // Two passes of the network: the scenario as it is, and the option. The
  // events-only pass a person's Run also makes shows nothing this table reads.
  assert.equal(engine.compares, 2);
});

test("three options cost four passes: the scenario as it is once, then one each", async () => {
  let compares = 0;
  const counting: ScenarioEngine = {
    ...blank,
    compare: async () => {
      compares += 1;
      return { datasets: [] };
    },
  };
  const ctx = context(counting);
  await run(ctx, BEDS);
  assert.equal(compares, 2);
  await run(ctx, { label: "Open 3 beds at Lakeshore from day 5", changes: [{ kind: "capacity", site: "Lakeshore", units: 3, from_day: 5 }] });
  assert.equal(compares, 3);
  await run(ctx, { label: "Open 3 beds at Lakeshore from day 9", changes: [{ kind: "capacity", site: "Lakeshore", units: 3, from_day: 9 }] });
  assert.equal(compares, 4);
});

test("an engine that fails on the scenario as it is is asked again by the next test, not remembered", async () => {
  let compares = 0;
  const flaky: ScenarioEngine = {
    ...blank,
    compare: async () => {
      compares += 1;
      if (compares === 1) throw new Error("unreachable");
      return { datasets: [] };
    },
  };
  const ctx = context(flaky);
  await assert.rejects(run(ctx, BEDS), /unreachable/);
  // Nothing was tested, so the option does not count against the limit and can be asked again.
  assert.deepEqual(ctx.bench!.tested, []);
  await run(ctx, BEDS);
  assert.equal(compares, 3);
});

test("what the tool keeps for the screen is the run whole, and the stamps a person would add", async () => {
  const out = (await run(context(), BEDS)) as Recorded;
  const record = out.record as TestedOption;

  // Exactly what the page writes for "+6 lit at Lakeshore from day 5".
  assert.deepEqual(record.stamps, [{ body: { kind: "capacity", facility: "site:lake", activity: "lit", amount: 6 }, start: 5, days: 25 }]);
  // It only adds: nothing of the scenario is taken out, and the screen is told so in the program's words.
  assert.deepEqual(record.retires, []);
  assert.deepEqual(record.changes, [{ does: "adds", now: "+6 lit at Lakeshore from day 5", was: null }]);
  assert.equal(record.asItIs.sitesWithQueue, 1);
  assert.equal(record.asItIs.firstQueueDay, 16);
  assert.equal(record.asItIs.waitingDays, fixture.asItIs.digest.full.waitingDays);
  assert.equal(record.withOption.sitesWithQueue, 0);
  assert.equal(record.withOption.firstQueueDay, null);
  assert.equal(record.withOption.peakOccupancy, Math.max(...fixture.withOption.digest.full.island.map((x) => x ?? 0)));
  assert.deepEqual(record.arrivals, fixture.withOption.digest.full.arrivals);
  assert.equal(record.arrivals.hospitalisation!.length, 30);

  // What the test's time was made of, for the journal: one propagation, the
  // scenario as it is, the option. The option adds beds and no contact, so it
  // does not integrate the epidemic a second time.
  assert.deepEqual(record.timing.engine.map((c) => c.call), ["spread", "pass", "pass"]);
  assert.ok(record.timing.totalMs >= 0 && record.timing.twinMs >= 0);
  assert.equal(JSON.stringify(out.result).includes("timing"), false);

  // The model is handed totals, never the day-by-day series it could quote from.
  assert.equal(JSON.stringify(out.result).includes(JSON.stringify(record.arrivals.hospitalisation)), false);
});

test("each thing an option rests on has a level of evidence the program assigned", async () => {
  const record = ((await run(context(), BEDS)) as Recorded).record as TestedOption;
  assert.deepEqual(record.basis, [
    { element: "+6 lit at Lakeshore from day 5, open and staffed", evidence: "assumption", from: "option" },
    { element: "Lakeshore holds 20 lit today", evidence: "measured", from: "twin" },
    { element: "Lakeshore is where the patients of Ouest-de-l'Île can go (30,000 residents)", evidence: "measured", from: "twin" },
  ]);
});

test("a measure is written as the stamp the page would write, on layers the twin declares", async () => {
  const ctx = context(blank);
  const out = (await run(ctx, {
    label: "Close schools in the west for two weeks",
    changes: [{ kind: "measure", name: "Schools closed", layers: [{ layer: "ecole", factor: 0 }], catchments: ["Ouest"], from_day: 4, days: 14 }],
  })) as Recorded;
  assert.deepEqual((out.record as TestedOption).stamps, [
    {
      body: { kind: "measure", label: "Schools closed", layers: [{ layer: "ecole", factor: 0 }], at: null, radiusKm: null, populations: ["pop:west"] },
      start: 4,
      days: 14,
    },
  ]);
  // Every catchment when none is named; never longer than the run.
  const everywhere = (await run(ctx, {
    label: "Halve household contact everywhere to the end",
    changes: [{ kind: "measure", name: "Stay home", layers: [{ layer: "menage", factor: 0.5 }], from_day: 20, days: 60 }],
  })) as Recorded;
  const stamp = (everywhere.record as TestedOption).stamps[0]!;
  assert.equal((stamp.body as { populations: string[] | null }).populations, null);
  assert.equal(stamp.days, 10);

  await assert.rejects(
    run(ctx, { label: "Curfew at night", changes: [{ kind: "measure", name: "Curfew", layers: [{ layer: "loisir", factor: 0.5 }], from_day: 0, days: 7 }] }),
    (e: Error) => e instanceof ToolError && /no contact layer called "loisir"[\s\S]*ecole, menage/.test(e.message),
  );
});

test("what cannot be tested is refused with what to do instead, and costs no test", async () => {
  const ctx = context(blank);
  const refused = async (input: unknown, why: RegExp) => {
    await assert.rejects(run(ctx, input), (e: Error) => e instanceof ToolError && why.test(e.message), `expected ${why}`);
  };
  const beds = (over: Record<string, unknown>) => ({ label: "Some beds somewhere", changes: [{ kind: "capacity", site: "Lakeshore", units: 6, from_day: 5, ...over }] });

  await refused(beds({ site: "Clinique Pointe" }), /does not provide lit today[\s\S]*Lakeshore \(site:lake\)/);
  await refused(beds({ site: "Hôpital inconnu" }), /No site matches/);
  await refused(beds({ activity: "bloc" }), /No site provides "bloc"/);
  await refused(beds({ from_day: 30 }), /numbered 0 to 29/);
  await refused(beds({ units: 0 }), /changes nothing/);
  await refused(beds({ units: -25 }), /holds 20 lit: 25 cannot be closed/);
  assert.deepEqual(ctx.bench!.tested, []);

  // Closing some of what a site holds is a change like another.
  const fewer = (await run(ctx, beds({ units: -5 }))) as Recorded;
  assert.match((fewer.record as TestedOption).basis[0]!.element, /^-5 lit at Lakeshore from day 5, closed$/);
  assert.equal(ctx.bench!.tested.length, 1);
});

test("the same option is not tested twice, and three is the limit", async () => {
  const ctx = context(blank);
  const beds = (units: number) => ({ label: `Open ${units} beds at Lakeshore`, changes: [{ kind: "capacity", site: "site:lake", units, from_day: 5 }] });
  await run(ctx, beds(6));
  await assert.rejects(run(ctx, { ...beds(6), label: "Same thing, other words" }), /already tested/);
  await run(ctx, beds(8));
  await run(ctx, beds(10));
  assert.equal(ctx.bench!.tested.length, MAX_OPTIONS);
  await assert.rejects(run(ctx, beds(12)), (e: Error) => e instanceof ToolError && /3 options have already been tested/.test(e.message));
});

test("without a bench the tool says so: the Ask tab reads, it does not run", async () => {
  await assert.rejects(run(context(null), BEDS), (e: Error) => e instanceof ToolError && /Options tab/.test(e.message));
});

test("the engine's refusal is read by the model; an engine that is down is our fault", async () => {
  const refusing: ScenarioEngine = {
    ...blank,
    compare: async () => {
      throw new AppError("SIM_REFUSED", "Event 'x' carries no effects, so the run would perturb nothing.", 422);
    },
  };
  const ctx = context(refusing);
  await assert.rejects(run(ctx, BEDS), (e: Error) => e instanceof ToolError && /engine refused this run: Event 'x' carries no effects/.test(e.message));
  assert.deepEqual(ctx.bench!.tested, []);

  const down: ScenarioEngine = {
    ...blank,
    compare: async () => {
      throw new AppError("SIM_UNAVAILABLE", "Simulation service is unreachable.", 503);
    },
  };
  await assert.rejects(run(context(down), BEDS), (e: Error) => e instanceof AppError && e.code === "SIM_UNAVAILABLE");
});

test("an activity no site provides is said before anything is run", async () => {
  const ctx = context(blank);
  ctx.bench = benchFor({ engine: blank, scenario: ctx.scenario!, horizon: 30, activity: "bloc", world: ctx.world });
  await assert.rejects(run(ctx, BEDS), (e: Error) => e instanceof ToolError && /No site on the map provides "bloc"/.test(e.message));
});

// --- replacing or removing a choice the scenario holds -----------------------

// The fixture's scenario holds two choices, in the recipe's order: schools
// closed in Centre (choice-a) and five beds at Nord from day 8 (choice-b).
const NORD = fixture.withReplacement.retired[0]!;
const FEWER = { label: "Open 3 beds at Nord from day 6 instead of 5 from day 8", changes: [{ kind: "capacity", replaces: "choice-b", units: 3, from_day: 6 }] };

test("an option that replaces a choice is run as one stamp in its place, and says what it took out", async () => {
  const engine = recorded(REPLACED_EFFECT);
  const out = (await run(context(engine), FEWER)) as Recorded;
  const result = out.result as Record<string, any>;
  const record = out.record as TestedOption;

  // The figures are those of the scenario with three beds from day 6 and without the five from day 8:
  // what Run gives once a person has added the option (the parity recording).
  assert.deepEqual(result.scenario_as_it_is, summariseVariant(fixture.asItIs.digest.full));
  assert.deepEqual(result.with_this_option, summariseVariant(fixture.withReplacement.digest.full));
  assert.notDeepEqual(result.with_this_option.peak_occupancy_across_all_sites, result.scenario_as_it_is.peak_occupancy_across_all_sites);
  assert.equal(engine.compares, 2);

  // One stamp, not a correction stacked on the old one.
  assert.deepEqual(record.stamps, [{ body: { kind: "capacity", facility: "site:north", activity: "lit", amount: 3 }, start: 6, days: 24 }]);
  assert.deepEqual(record.retires, [
    { id: NORD, stamp: { body: { kind: "capacity", facility: "site:north", activity: "lit", amount: 5 }, start: 8, days: 22 }, text: "+5 lit at Nord from day 8", replacedBy: 0 },
  ]);
  assert.deepEqual(record.changes, [{ does: "replaces", now: "+3 lit at Nord from day 6", was: "+5 lit at Nord from day 8" }]);
  // The model reads both, so "3 instead of 5" is a figure it can cite.
  assert.deepEqual(result.changes, [
    {
      does: "replaces",
      what: "capacity",
      site: "Nord",
      site_id: "site:north",
      activity: "lit",
      units_added: 3,
      from_day: 6,
      instead_of: { what: "capacity", site: "Nord", site_id: "site:north", activity: "lit", units_added: 5, from_day: 8 },
    },
  ]);
  assert.match(result.how_to_read, /replaces or removes/);
  // Levels of evidence are still the program's: the new stamp is assumed, and so is taking the old one out.
  assert.deepEqual(record.basis.slice(0, 2), [
    { element: "+3 lit at Nord from day 6, open and staffed", evidence: "assumption", from: "option" },
    { element: "Takes out of the scenario: +5 lit at Nord from day 8", evidence: "assumption", from: "option" },
  ]);
  assert.ok(record.basis.some((b) => b.element === "Nord holds 40 lit today" && b.evidence === "measured"));
});

test("a replacement says only what differs, and keeps the rest of the choice", async () => {
  const ctx = context(blank);
  // Fewer beds, same day: the day is the choice's own.
  const fewer = (await run(ctx, { label: "Three beds at Nord, same day", changes: [{ kind: "capacity", replaces: "choice-b", units: 3 }] })) as Recorded;
  assert.deepEqual((fewer.record as TestedOption).stamps, [{ body: { kind: "capacity", facility: "site:north", activity: "lit", amount: 3 }, start: 8, days: 22 }]);
  // Later, same beds.
  const later = (await run(ctx, { label: "Five beds at Nord from day 12", changes: [{ kind: "capacity", replaces: "choice-b", from_day: 12 }] })) as Recorded;
  assert.deepEqual((later.record as TestedOption).changes, [{ does: "replaces", now: "+5 lit at Nord from day 12", was: "+5 lit at Nord from day 8" }]);

  // A measure, shorter: its name, its layers and its catchment are kept.
  const shorter = (await run(ctx, { label: "Schools closed five days only", changes: [{ kind: "measure", replaces: "choice-a", days: 5 }] })) as Recorded;
  const s = (shorter.record as TestedOption).stamps[0]!;
  assert.deepEqual(s, {
    body: {
      kind: "measure",
      label: "Schools closed",
      layers: [
        { layer: "ecole", factor: 0 },
        { layer: "menage", factor: 1.27 },
      ],
      at: null,
      radiusKm: null,
      populations: ["pop:centre"],
    },
    start: 8,
    days: 5,
  });
  assert.deepEqual((shorter.record as TestedOption).retires.map((r) => [r.text, r.replacedBy]), [
    ["Schools closed in Centre, days 8 to 17: contact scaled (ecole ×0, menage ×1.27)", 0],
  ]);
});

test("an option may remove a choice: the run is the scenario without it", async () => {
  const sent: string[][] = [];
  const watching: ScenarioEngine = {
    ...blank,
    compare: async (p) => {
      sent.push(p.event.effects.map((e) => e.id));
      return { datasets: [] };
    },
  };
  const out = (await run(context(watching), { label: "Without the beds at Nord", changes: [{ kind: "remove", ref: "choice-b" }] })) as Recorded;
  const record = out.record as TestedOption;
  // The scenario as it is carries the beds; the option's run does not.
  assert.equal(sent[0]!.includes(`capacity-${NORD}`), true);
  assert.equal(sent[1]!.includes(`capacity-${NORD}`), false);
  assert.equal(sent[1]!.some((id) => id.startsWith("capacity-")), false);

  assert.deepEqual(record.stamps, []);
  assert.deepEqual(record.retires.map((r) => [r.id, r.replacedBy]), [[NORD, null]]);
  assert.deepEqual(record.changes, [{ does: "removes", now: null, was: "+5 lit at Nord from day 8" }]);
  assert.deepEqual((out.result as Record<string, any>).changes, [
    { does: "removes", what: "capacity", site: "Nord", site_id: "site:north", activity: "lit", units_added: 5, from_day: 8 },
  ]);
  assert.deepEqual(record.basis[0], { element: "Takes out of the scenario: +5 lit at Nord from day 8", evidence: "assumption", from: "option" });

  // Removing one choice, replacing another and adding a third is one option.
  const mixed = (await run(context(blank), {
    label: "Beds at Lakeshore instead of Nord, schools closed a week longer",
    changes: [
      { kind: "remove", ref: "choice-b" },
      { kind: "capacity", site: "Lakeshore", units: 5, from_day: 8 },
      { kind: "measure", replaces: "choice-a", days: 17 },
    ],
  })) as Recorded;
  const m = mixed.record as TestedOption;
  assert.deepEqual(m.changes.map((c) => c.does), ["removes", "adds", "replaces"]);
  assert.equal(m.stamps.length, 2);
  // The measure is the second stamp written: that is what takes the old one's place.
  assert.deepEqual(m.retires.map((r) => r.replacedBy), [null, 1]);
});

test("only a choice can be replaced or removed, and a refusal says what can be named", async () => {
  const ctx = context(blank);
  const refused = async (changes: unknown[], why: RegExp) => {
    await assert.rejects(run(ctx, { label: "Something else", changes }), (e: Error) => e instanceof ToolError && why.test(e.message), `expected ${why}`);
  };
  const seed = fixture.asItIs.overrides.find((o) => (o.payload.value as { kind: string }).kind === "seed")!.id;
  const occupancy = fixture.asItIs.overrides.find((o) => (o.payload.value as { kind: string }).kind === "occupancy")!.id;

  // A name nothing has: the choices are listed, each with its ref.
  await refused([{ kind: "remove", ref: "choice-z" }], /holds no choice called "choice-z"[\s\S]*choice-a: Schools closed in Centre[\s\S]*choice-b: \+5 lit at Nord from day 8/);
  // What happens to the city, and where the run starts, are not an option's to undo.
  await refused([{ kind: "remove", ref: seed }], /is an event of the scenario, not a choice[\s\S]*does not undo them/);
  await refused([{ kind: "capacity", replaces: occupancy, units: 3 }], /is a starting condition of the scenario, not a choice/);
  // Like for like.
  await refused([{ kind: "capacity", replaces: "choice-a", site: "Nord", units: 3, from_day: 8 }], /choice-a is a measure[\s\S]*same kind[\s\S]*remove it and add/);
  await refused([{ kind: "measure", replaces: "choice-b", days: 5 }], /choice-b is capacity/);
  // Once, and for something.
  await refused(
    [
      { kind: "capacity", replaces: "choice-b", units: 3 },
      { kind: "remove", ref: "choice-b" },
    ],
    /choice-b is named twice/,
  );
  await refused([{ kind: "capacity", replaces: "choice-b" }], /replaces choice-b with itself \(\+5 lit at Nord from day 8\)/);
  await refused([{ kind: "capacity", replaces: "choice-b", units: 0 }], /kind "remove"/);
  // A plain addition still has to say everything.
  await refused([{ kind: "capacity", units: 3, from_day: 8 }], /needs "site"/);
  await refused([{ kind: "capacity", site: "Nord", from_day: 8 }], /needs "units"/);
  await refused([{ kind: "capacity", site: "Nord", units: 3 }], /needs "from_day"/);
  await refused([{ kind: "measure", layers: [{ layer: "ecole", factor: 0 }], from_day: 2, days: 3 }], /needs "name"/);
  // None of it was run, and none counts against the three tests.
  assert.deepEqual(ctx.bench!.tested, []);

  // The stamp's own id names it as well as its ref does.
  const byId = (await run(ctx, { label: "Three beds at Nord", changes: [{ kind: "capacity", replaces: NORD, units: 3 }] })) as Recorded;
  assert.deepEqual((byId.record as TestedOption).retires.map((r) => r.id), [NORD]);

  // A scenario with no choice has nothing to take out, and says to add instead.
  const bare = context(blank, fixture.asItIs.overrides.filter((o) => !["measure", "capacity"].includes((o.payload.value as { kind: string }).kind)));
  await assert.rejects(run(bare, { label: "Without it", changes: [{ kind: "remove", ref: "choice-a" }] }), /contains no choice[\s\S]*add capacity or a measure instead/);
});

// --- the exchange ------------------------------------------------------------

type Message = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlock;

let ids = 0;
const use = (name: string, input: unknown): Block => ({ type: "tool_use", id: `tu_${++ids}`, name, input }) as Block;
const reply = (content: Block[]): Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: ANALYST_MODEL,
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Message;

function scripted(turns: Message[]): AnalystModel & { seen: Params[] } {
  const seen: Params[] = [];
  return {
    seen,
    async create(params) {
      seen.push(JSON.parse(JSON.stringify(params)) as Params);
      const next = turns.shift();
      if (!next) throw new Error("The script ran out: the loop asked for a turn the test did not expect.");
      return next;
    },
  };
}
const sentBack = (m: { seen: Params[] }, request: number) =>
  (m.seen[request]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[]).map((b) => ({ text: String(b.content), error: b.is_error === true }));

const OBJECTIVE = { objective: "Nobody should wait at Lakeshore, with at most 10 beds added." };
const give = (over: Record<string, unknown> = {}) =>
  use("give_options", {
    options: [{ step: "s1", mechanism: "The west's patients can only go to Lakeshore, so beds there are the only ones they reach.", not_tested: ["Whether 6 beds can be staffed."] }],
    reading: [{ text: "With 6 beds added from day 5 nobody waits at Lakeshore: the sites with a queue go from 1 to 0.", sources: ["s1"] }],
    human_choices: ["Opening beds earlier costs more days of staffing for the same result."],
    limits: ["The twin holds no staff."],
    focus_sites: ["site:lake"],
    ...over,
  });

async function propose(turns: Message[], ctx = context()) {
  const model = scripted(turns);
  const events: LoopEvent<OptionsProposal, OptionsFinding>[] = [];
  const out = await converse(model, ctx, optionsClosing(ctx, OBJECTIVE), (e) => events.push(e), OPTION_TOOLS);
  return { model, events, out };
}

test("an objective ends with the options that were tested, their figures taken from the tests", async () => {
  const { model, events, out } = await propose([reply([use("test_option", BEDS)]), reply([give()])]);

  assert.equal(out.status, "answered");
  assert.equal(out.verified, true);
  const p = out.answer!;
  assert.equal(p.objective, OBJECTIVE.objective);
  assert.deepEqual([p.horizon, p.activity], [30, "lit"]);
  // The comparison: read from the test's record, not from a sentence.
  assert.equal(p.asItIs!.sitesWithQueue, 1);
  assert.equal(p.asItIs!.waitingDays, fixture.asItIs.digest.full.waitingDays);
  assert.equal(p.options.length, 1);
  const o = p.options[0]!;
  assert.equal(o.step, "s1");
  assert.equal(o.label, BEDS.label);
  assert.equal(o.figures.sitesWithQueue, 0);
  assert.deepEqual(o.stamps, [{ body: { kind: "capacity", facility: "site:lake", activity: "lit", amount: 6 }, start: 5, days: 25 }]);
  assert.deepEqual(o.retires, []);
  assert.deepEqual(o.changes, [{ does: "adds", now: "+6 lit at Lakeshore from day 5", was: null }]);
  assert.match(o.mechanism, /only go to Lakeshore/);
  assert.deepEqual(o.notTested, ["Whether 6 beds can be staffed."]);
  assert.deepEqual(p.focusSites, ["site:lake"]);

  // What every column shares, each with its level: the network is measured,
  // the scenario's conditions are assumed, the heat rate is published.
  const levels = (re: RegExp) => p.basis.filter((b) => re.test(b.element)).map((b) => [b.evidence, b.from]);
  assert.deepEqual(levels(/^3 sites provide lit, 90 units in all$/), [["measured", "twin"]]);
  assert.deepEqual(levels(/^3 catchments, 98,000 residents$/), [["measured", "twin"]]);
  assert.deepEqual(levels(/^Usual occupancy: 60 %/), [["assumption", "scenario"]]);
  assert.deepEqual(levels(/^Heat wave/), [["published", "scenario"]]);
  assert.deepEqual(levels(/nobody is transferred/), [["assumption", "engine"]]);

  // The model was told what it is for, given the test tool, and nothing of the record.
  const first = model.seen[0]!;
  assert.match(String(first.system), /You do not decide/);
  assert.deepEqual((first.tools ?? []).map((t) => (t as { name: string }).name).slice(-2), ["test_option", "give_options"]);
  assert.match(String(first.messages[0]!.content), /tested over 30 days, reading the activity "lit"[\s\S]*<objective>\nNobody should wait at Lakeshore/);
  const handed = sentBack(model, 1)[0]!.text;
  assert.match(handed, /^\{"step":"s1","result":\{"option":"Open 6 beds at Lakeshore from day 5"/);
  assert.equal(handed.includes("stamps"), false);
  assert.equal(handed.includes('"record"'), false);

  // The person sees the engine at work, and the step carries the record for the screen.
  assert.deepEqual(events.map((e) => (e.type === "status" ? e.message : e.type)), [
    "Reading the question",
    "Testing an option in the engine",
    "step",
    "Deciding what to read next",
    "Checking every figure against what was read",
    "done",
  ]);
  assert.equal((out.steps[0]!.record as TestedOption).label, BEDS.label);
});

test("a figure in the objective is the person's own; one from nowhere is sent back, then struck", async () => {
  const invented = () => give({ options: [{ step: "s1", mechanism: "It frees 45 beds a day for the west.", not_tested: [] }] });
  const { model, out } = await propose([reply([use("test_option", BEDS)]), reply([invented()]), reply([invented()]), reply([invented()])]);

  const back = sentBack(model, 2)[0]!;
  assert.equal(back.error, true);
  assert.match(back.text, /Option s1, mechanism: "45" is not in the result of s1 nor in the objective/);
  assert.equal(out.status, "answered");
  assert.equal(out.verified, false);
  assert.equal(out.answer!.options[0]!.mechanism, `It frees ${STRUCK} beds a day for the west.`);
  assert.deepEqual(out.struck, [{ where: "mechanism", option: "s1", index: 0, figures: ["45"] }]);
  // "at most 10 beds" is in the objective, so it may be said back.
  const own = await propose([reply([use("test_option", BEDS)]), reply([give({ limits: ["The limit of 10 beds was respected."] })])]);
  assert.equal(own.out.verified, true);
});

test("an option that was not tested cannot be listed, and one that was cannot be left out", async () => {
  const { model, out } = await propose([
    reply([use("test_option", BEDS)]),
    // s2 is a read, not a test.
    reply([use("scenario_recipe", {})]),
    reply([give({ options: [{ step: "s2", mechanism: "Transfer patients to Nord.", not_tested: [] }] })]),
    reply([give({ options: [] })]),
    reply([give()]),
  ]);
  assert.match(sentBack(model, 3)[0]!.text, /s2 is not a step where test_option ran an option\. Tested so far: s1/);
  assert.match(sentBack(model, 4)[0]!.text, /s1 was tested but is not listed/);
  // Neither refusal is a draft with untraced figures: the answer that follows is whole.
  assert.equal(out.verified, true);
  assert.deepEqual(out.answer!.options.map((o) => o.step), ["s1"]);
});

test("when nothing could be tested there is no table, only what was read and why", async () => {
  const { out } = await propose(
    [
      reply([use("test_option", { ...BEDS, changes: [{ kind: "capacity", site: "Clinique Pointe", units: 6, from_day: 5 }] })]),
      reply([give({ options: [], reading: [{ text: "No option could be tested: the site named provides no beds.", sources: ["s1"] }], human_choices: [] })]),
    ],
    context(blank),
  );
  assert.equal(out.status, "answered");
  assert.equal(out.answer!.asItIs, null);
  assert.deepEqual(out.answer!.options, []);
  assert.deepEqual(out.answer!.basis, []);
  assert.equal(out.steps[0]!.ok, false);
});

// --- from a tested option to a decision --------------------------------------

test("a decision is copied from the journalled test: the caller names a step and sends no figure", async () => {
  const { out } = await propose([reply([use("scenario_recipe", {})]), reply([use("test_option", BEDS)]), reply([give({ options: [{ step: "s2", mechanism: "Beds where the west's patients go.", not_tested: [] }], reading: [{ text: "With the beds nobody waits at Lakeshore.", sources: ["s2"] }] })])]);
  // As the journal holds it: through JSON, the way a jsonb column returns it.
  const journalled = JSON.parse(JSON.stringify({ kind: "options", status: out.status, question: OBJECTIVE.objective, answer: out.answer, steps: out.steps }));

  const draft = decisionFromExchange(journalled, "s2");
  assert.equal(draft.objective, OBJECTIVE.objective);
  assert.equal(draft.optionLabel, BEDS.label);
  assert.equal(draft.optionStep, "s2");
  assert.deepEqual(draft.optionStamps, [{ body: { kind: "capacity", facility: "site:lake", activity: "lit", amount: 6 }, start: 5, days: 25 }]);
  // What is expected is the tested run, with and without the option.
  assert.equal(draft.expected.asItIs.sitesWithQueue, 1);
  assert.equal(draft.expected.asItIs.waitingDays, fixture.asItIs.digest.full.waitingDays);
  assert.equal(draft.expected.withOption.sitesWithQueue, 0);
  assert.deepEqual(draft.expected.arrivals, fixture.withOption.digest.full.arrivals);
  assert.deepEqual([draft.expected.horizon, draft.expected.activity], [30, "lit"]);
  // The option's own basis first, then the scenario's: every level of evidence travels.
  assert.equal(draft.expected.basis[0]!.from, "option");
  assert.ok(draft.expected.basis.some((b) => b.evidence === "published"));
  // The steps the figures come from, with what was asked and what came back; not the read beside them.
  assert.deepEqual(draft.sourceSteps.map((s) => [s.id, s.tool]), [["s2", "test_option"]]);
  assert.equal((draft.sourceSteps[0]!.output as { option: string }).option, BEDS.label);

  // It only added, and the record says so.
  assert.deepEqual(draft.expected.retires, []);
  assert.deepEqual(draft.expected.changes, [{ does: "adds", now: "+6 lit at Lakeshore from day 5", was: null }]);
  // An exchange journalled before an option could replace a choice has neither field: it is read as one that only added.
  const older = JSON.parse(JSON.stringify(journalled)) as typeof journalled;
  for (const o of older.answer.options) {
    delete o.retires;
    delete o.changes;
  }
  assert.deepEqual(decisionFromExchange(older, "s2").expected.retires, []);

  // A read is not a test, an unknown step is not a test, and a question is not options.
  assert.throws(() => decisionFromExchange(journalled, "s1"), /not an option the engine tested/);
  assert.throws(() => decisionFromExchange(journalled, "s9"), /not an option the engine tested/);
  assert.throws(() => decisionFromExchange({ ...journalled, kind: "ask" }, "s2"), /where options were tested and delivered/);
  assert.throws(() => decisionFromExchange({ ...journalled, status: "incomplete", answer: null }, "s2"), /where options were tested/);
  assert.throws(() => decisionFromExchange({ ...journalled, answer: { options: "tampered" } }, "s2"), /cannot be read as tested options/);
});

test("a figure written beside the wrong site is sent back, in a reading as in an answer", async () => {
  const tested = [{ step: "s2", mechanism: "Beds where the west's patients go.", not_tested: [] }];
  // Twenty beds are Lakeshore's. The clinic at Pointe holds stretchers only.
  const swapped = give({ options: tested, reading: [{ text: "Clinique Pointe holds 20 beds.", sources: ["s1"] }] });
  const right = give({ options: tested, reading: [{ text: "Lakeshore holds 20 beds.", sources: ["s1"] }] });

  const { model, out } = await propose([reply([use("find_sites", { world: "scenario" })]), reply([use("test_option", BEDS)]), reply([swapped]), reply([right])]);
  const back = sentBack(model, 3)[0]!;
  assert.equal(back.error, true);
  assert.match(back.text, /Reading, paragraph 1: "20" is written about Clinique Pointe, but in the steps cited that figure is in the row of Lakeshore/);
  assert.equal(out.verified, true);
  assert.equal(out.answer!.reading[0]!.text, "Lakeshore holds 20 beds.");

  // Left uncorrected, the figure is taken out and the fault is named.
  const stubborn = await propose([reply([use("find_sites", { world: "scenario" })]), reply([use("test_option", BEDS)]), reply([swapped]), reply([swapped]), reply([swapped])]);
  assert.equal(stubborn.out.verified, false);
  assert.equal(stubborn.out.answer!.reading[0]!.text, `Clinique Pointe holds ${STRUCK} beds.`);
  assert.deepEqual(stubborn.out.struck, [
    { where: "reading", option: null, index: 0, figures: ["20"], misattributed: [{ figure: "20", saidOf: "Clinique Pointe", belongsTo: ["Lakeshore"] }] },
  ]);
});

test("a replacement travels whole: from the test to the options, and from there to a decision", async () => {
  const { model, out } = await propose(
    [
      reply([use("scenario_recipe", {})]),
      reply([use("test_option", FEWER)]),
      reply([
        give({
          options: [{ step: "s2", mechanism: "Nord serves Centre, and 3 beds from day 6 in place of 5 from day 8 change when its patients find a bed.", not_tested: [] }],
          reading: [{ text: "With 3 beds at Nord from day 6 instead of 5 from day 8, Lakeshore still has a queue.", sources: ["s2"] }],
        }),
      ]),
    ],
    context(recorded(REPLACED_EFFECT)),
  );
  // The recipe handed the model the name it then used.
  assert.match(sentBack(model, 1)[0]!.text, /"ref":"choice-b","what":"capacity","site":"Nord"/);
  // "3", "6", "5" and "8" are all in the test's result, so the sentences that compare them stand.
  assert.equal(out.verified, true);
  const o = out.answer!.options[0]!;
  assert.deepEqual(o.changes, [{ does: "replaces", now: "+3 lit at Nord from day 6", was: "+5 lit at Nord from day 8" }]);
  assert.deepEqual(o.retires.map((r) => [r.id, r.replacedBy]), [[NORD, 0]]);

  const journalled = JSON.parse(JSON.stringify({ kind: "options", status: out.status, question: OBJECTIVE.objective, answer: out.answer, steps: out.steps }));
  const draft = decisionFromExchange(journalled, "s2");
  // The decision keeps what was written and what was taken out, so "3 beds" is not read as three more.
  assert.deepEqual(draft.optionStamps, [{ body: { kind: "capacity", facility: "site:north", activity: "lit", amount: 3 }, start: 6, days: 24 }]);
  assert.deepEqual(draft.expected.changes, o.changes);
  assert.deepEqual(draft.expected.retires!.map((r) => [r.id, r.text, r.replacedBy]), [[NORD, "+5 lit at Nord from day 8", 0]]);
  assert.ok(draft.expected.basis.some((b) => b.element === "Takes out of the scenario: +5 lit at Nord from day 8"));
});

// --- recorded responses: the other way of asking "what if" -------------------

/** Every run of the recording, so a test can take any of its options. */
function everything(): ScenarioEngine & { compares: number } {
  const replay = replayEngine([
    ...fixture.asItIs.calls,
    ...fixture.withOption.calls,
    ...fixture.withResponse.calls,
    ...fixture.withBuiltIn.calls,
    ...fixture.withTransfer.calls,
  ]);
  const engine = {
    compares: 0,
    spread: (p: Parameters<ScenarioEngine["spread"]>[0]) => replay.spread(p),
    compare: (p: Parameters<ScenarioEngine["compare"]>[0]) => {
      engine.compares += 1;
      return replay.compare(p);
    },
  };
  return engine;
}

/** A stamp as an option records it: what it is, without the row that holds it. */
function kept(o: ScenarioOverride) {
  const { key: _key, value } = o.payload as { key: string; value: Record<string, unknown> };
  return { body: value, start: o.effectiveOffsetHours / 24, days: o.durationHours! / 24 };
}

const STORED = (fixture.withResponse.added[0]!.payload as { value: { name: string; ref: string; rules: Record<string, unknown>[] } }).value;
/** The organisation's library, as the Events page wrote it. */
const LIBRARY: StoredResponse[] = [{ id: STORED.ref, name: STORED.name, description: "Send the patients waiting at Lakeshore to Nord when Nord has a bed.", rules: STORED.rules }];

function withLibrary(overrides = fixture.asItIs.overrides, engine: ScenarioEngine = everything()): AnalystContext {
  const ctx = context(engine, overrides);
  ctx.responses = async () => LIBRARY;
  return ctx;
}

const TRANSFER = { label: "Send Lakeshore's waiting patients to Nord", changes: [{ kind: "transfer", from: "Lakeshore", to: "Nord", patients_per_day: 4, from_day: 12 }] };

test("the analyst tests a transfer of patients between two sites, and the table has the engine's figures", async () => {
  const engine = everything();
  const out = (await run(withLibrary(undefined, engine), TRANSFER)) as Recorded;
  const result = out.result as Record<string, any>;

  // The two columns of the table, read from the run as any other option's.
  assert.deepEqual(result.scenario_as_it_is, summariseVariant(fixture.asItIs.digest.full));
  assert.deepEqual(result.with_this_option, {
    ...summariseVariant(fixture.withTransfer.digest.full),
    // Nobody priced a transfer, and the result says so in place of a figure.
    cost: "No cost is counted for this run: the rules of “Transfer from Lakeshore to Nord” declare none. That is unpriced, not free.",
  });
  assert.equal(result.scenario_as_it_is.patient_days_waiting, 76);
  assert.equal(result.with_this_option.patient_days_waiting, 11);
  assert.deepEqual(result.changes, [
    {
      does: "adds",
      what: "recorded response",
      name: "Transfer from Lakeshore to Nord",
      from: "written for this option",
      from_day: 12,
      its_rules: [{ does: "sends waiting patients from one site to another, along a transfer route", rules: 1, routes: ["Lakeshore to Nord"], patients_per_step_at_most: [4] }],
    },
  ]);
  // The transfer is in the run now, and the note that said nobody is transferred says when somebody is.
  assert.match(result.how_to_read, /nobody is transferred between sites unless a recorded response in the run does it/);

  // What it rests on: the route is the twin's, what it carries is the run's own assumption.
  const rests = result.rests_on as { element: string; evidence: string }[];
  assert.deepEqual(
    rests.filter((b) => /route/.test(b.element)).map((b) => [b.element, b.evidence]),
    [
      ["The twin holds a transfer route from Lakeshore to Nord", "measured"],
      ["A route carries at most 20 patients a day: the twin holds no flow for its routes, so the run gives each the same", "assumption"],
    ],
  );

  // What "Add to scenario" will write is the stamp the recording ran: the page's Run then gives these figures.
  const record = out.record as TestedOption;
  assert.deepEqual(JSON.parse(JSON.stringify(record.stamps)), [kept(fixture.withTransfer.added[0]!)]);
  assert.deepEqual(record.changes, [{ does: "adds", now: "recorded response Transfer from Lakeshore to Nord, from day 12", was: null }]);
  assert.deepEqual(record.withOption, figuresOf(fixture.withTransfer.digest.full));
  assert.deepEqual([record.cost.counted, record.cost.complete], [null, false]);
  // The same run as a stamp's: the scenario as it is, and one pass with the option.
  assert.equal(engine.compares, 2);
});

test("a response of the organisation's library is tested by the same run, from the day asked, and its cost is the engine's count", async () => {
  const out = (await run(withLibrary(), { label: "Send Lakeshore's queue to Nord from day 12", changes: [{ kind: "response", response: "response-a", from_day: 12 }] })) as Recorded;
  const result = out.result as Record<string, any>;
  const says = "The engine counted 7,500 $ for “Send Lakeshore's queue to Nord”: each of its actions at the cost its rule declares, each time it fired.";

  assert.deepEqual(result.with_this_option, { ...summariseVariant(fixture.withResponse.digest.full), cost_counted_by_the_engine: 7500, cost_how_to_read: says });
  assert.equal(result.changes[0].from, "the organisation's library");
  const record = out.record as TestedOption;
  assert.deepEqual(JSON.parse(JSON.stringify(record.stamps)), [kept(fixture.withResponse.added[0]!)]);
  // Made of a priced response and nothing else: its cost is whole, and can be set against another's.
  assert.deepEqual(record.cost, { counted: 7500, complete: true, says });
  assert.deepEqual([record.asItIsCost.counted, record.asItIsCost.complete], [null, false]);

  // By its name too, and with beds beside it the count is no longer the option's whole cost.
  const both = (await run(withLibrary(undefined, { ...blank, compare: async () => ({ datasets: [] }) }), {
    label: "The transfer, and 6 beds at Lakeshore",
    changes: [
      { kind: "response", response: "Send Lakeshore's queue to Nord", from_day: 12 },
      { kind: "capacity", site: "Lakeshore", units: 6, from_day: 5 },
    ],
  })) as Recorded;
  const cost = (both.record as TestedOption).cost;
  assert.deepEqual([cost.counted, cost.complete], [0, false]);
  assert.match(cost.says, /carry no price, so this is not the whole cost of the option\.$/);
});

test("a response the engine writes itself is tested by its name, for the whole run", async () => {
  const out = (await run(withLibrary(), { label: "Transfer when full", changes: [{ kind: "response", response: "transfer-when-full" }] })) as Recorded;
  const result = out.result as Record<string, any>;
  assert.deepEqual(result.changes, [{ does: "adds", what: "recorded response", name: "Transfer when full", from: "the engine", applies: "whole run" }]);
  // Its rules never fired on this network: the scenario's own figures, and a count of nothing spent.
  assert.equal(result.with_this_option.patient_days_waiting, result.scenario_as_it_is.patient_days_waiting);
  assert.equal(result.with_this_option.cost_counted_by_the_engine, 0);
  assert.deepEqual(JSON.parse(JSON.stringify((out.record as TestedOption).stamps)), [kept(fixture.withBuiltIn.added[0]!)]);

  await assert.rejects(run(withLibrary(), { label: "Later", changes: [{ kind: "response", response: "transfer-when-full", from_day: 9 }] }), (err: unknown) => {
    assert.ok(err instanceof ToolError);
    assert.match(err.message, /written by the engine from the network and applies for the whole run: it cannot start on day 9/);
    return true;
  });
});

test("a transfer or a response that cannot be run is refused before the engine, and the refusal says what can be asked", async () => {
  const engine = everything();
  const refused = async (changes: unknown[], says: RegExp) => {
    await assert.rejects(run(withLibrary(undefined, engine), { label: "An option", changes }), (err: unknown) => {
      assert.ok(err instanceof ToolError, String(err));
      assert.match(err.message, says);
      return true;
    });
  };
  // No road: the twin holds none from Lakeshore to Est, and says where Lakeshore's patients can go.
  await refused(
    [{ kind: "transfer", from: "Lakeshore", to: "Est", patients_per_day: 4, from_day: 12 }],
    /The twin holds no transfer route from Lakeshore to Est, so a run cannot send anyone that way\. From Lakeshore, waiting patients can be sent to: Nord\./,
  );
  await refused([{ kind: "transfer", from: "Clinique Pointe", to: "Est", patients_per_day: 2, from_day: 3 }], /It holds no route out of Clinique Pointe at all\./);
  await refused([{ kind: "transfer", from: "Nord", to: "Nord", patients_per_day: 2, from_day: 3 }], /both ends are Nord/);
  // More than a road carries in this run.
  await refused([{ kind: "transfer", from: "Lakeshore", to: "Nord", patients_per_day: 40, from_day: 12 }], /A route carries at most 20 patients a day in a run/);
  await refused([{ kind: "transfer", from: "Lakeshore", to: "Nord", patients_per_day: 4, from_day: 30 }], /after the last day of the run/);
  // One response to a run.
  await refused(
    [
      { kind: "response", response: "response-a" },
      { kind: "transfer", from: "Lakeshore", to: "Nord", patients_per_day: 4, from_day: 12 },
    ],
    /A run follows one recorded response, so an option holds one/,
  );
  await refused([{ kind: "response", response: "evacuate-everything" }], /No recorded response is called "evacuate-everything"\. The ones that can be tested are: response-a \(Send Lakeshore's queue to Nord\); transfer-when-full \(Transfer when full\); surge-then-transfer/);
  assert.equal(engine.compares, 0);
});

test("a scenario that already follows a response: an option takes it out to test another in its place", async () => {
  // The scenario of the person who added the library's transfer: it is a choice, and has a name to be called by.
  const overrides = fixture.withResponse.overrides;
  await assert.rejects(run(withLibrary(overrides), { label: "Transfer when full", changes: [{ kind: "response", response: "transfer-when-full" }] }), (err: unknown) => {
    assert.ok(err instanceof ToolError);
    assert.match(err.message, /The scenario already follows a recorded response \(choice-c: recorded response Send Lakeshore's queue to Nord, from day 12\), and a run follows one at a time\./);
    return true;
  });

  const out = (await run(withLibrary(overrides), {
    label: "The engine's transfer instead of ours",
    changes: [
      { kind: "remove", ref: "choice-c" },
      { kind: "response", response: "transfer-when-full" },
    ],
  })) as Recorded;
  const result = out.result as Record<string, any>;
  // The scenario as it is follows the library's transfer, and its column says what that cost.
  assert.equal(result.scenario_as_it_is.patient_days_waiting, 11);
  assert.equal(result.scenario_as_it_is.cost_counted_by_the_engine, 7500);
  assert.deepEqual(result.with_this_option, {
    ...summariseVariant(fixture.withBuiltIn.digest.full),
    cost_counted_by_the_engine: 0,
    cost_how_to_read: "The engine counted 0 $ for “Transfer when full”: each of its actions at the cost its rule declares, each time it fired.",
  });
  assert.deepEqual(result.changes.map((c: any) => [c.does, c.name]), [
    ["removes", "Send Lakeshore's queue to Nord"],
    ["adds", "Transfer when full"],
  ]);
  const record = out.record as TestedOption;
  assert.deepEqual(record.retires.map((r) => [r.text, r.replacedBy]), [["recorded response Send Lakeshore's queue to Nord, from day 12", null]]);
  assert.deepEqual(record.cost.complete, true);
});

test("the analyst reads what can be tested: the library, the engine's own responses, and where a site's patients can be sent", async () => {
  const tool = OPTION_TOOLS.find((t) => t.name === "list_responses")!;
  const out = (await tool.run(withLibrary(), tool.parse.parse({ routes_from: "Lakeshore" }))) as Record<string, any>;

  assert.deepEqual(
    out.recorded_responses.map((r: any) => [r.ref, r.name, r.from, r.declares_a_cost, r.can_start_on_a_day]),
    [
      ["response-a", "Send Lakeshore's queue to Nord", "the organisation's library", true, true],
      ["transfer-when-full", "Transfer when full", "the engine", true, false],
      ["surge-then-transfer", "Surge what is short, then transfer", "the engine", true, false],
    ],
  );
  assert.deepEqual(out.recorded_responses[0].what_its_rules_do, [
    { does: "sends waiting patients from one site to another, along a transfer route", rules: 1, routes: ["Lakeshore to Nord"], patients_per_step_at_most: [4] },
  ]);
  // The engine's own transfer watches the first space activity by name, here stretchers, not the beds the run reads: it is said.
  assert.match(out.recorded_responses[1].what_it_does, /nearly full on civiere .* a free unit of civiere/);
  assert.equal(out.transfer_routes_in_the_twin, 4);
  assert.deepEqual(out.routes_from, { site: "Lakeshore", site_id: "site:lake", units_of_lit: 20, can_send_to: [{ site: "Nord", site_id: "site:north", units_of_lit: 40 }] });
  assert.match(out.how_to_read, /A response that declares no cost is not free/);

  // No ref is a row's id: a model copies letters, and the checker of figures finds no digits to look for.
  const refs = listedResponses(LIBRARY, fixture.twin).map((r) => r.ref);
  assert.ok(refs.every((r) => /^[a-z-]+$/.test(r)));
  // A transfer written for an option prices nothing.
  assert.equal(declaresCost([transferRule({ id: "t", source: "a", target: "b", activity: "lit", acuity: null, perDay: 2, fromDay: 0 })]), false);
  assert.equal(declaresCost(LIBRARY[0]!.rules), true);
});

test("a cost is whole only for an option made of a priced response and nothing else", () => {
  const stamps = (os: ScenarioOverride[]) => stampsOf(os);
  // Stamps alone: nothing is counted, and that is said rather than shown as zero.
  assert.deepEqual(costOf(stamps(fixture.withOption.overrides), 1, 0), { counted: null, complete: false, says: "No cost is counted for this run: capacity and measures carry no price in the twin." });
  // An unpriced response: not free.
  const unpriced = costOf(stamps(fixture.withTransfer.overrides), 0, 0);
  assert.deepEqual([unpriced.counted, unpriced.complete], [null, false]);
  assert.match(unpriced.says, /unpriced, not free/);
  // A priced one, alone and then with a bed beside it.
  assert.deepEqual([costOf(stamps(fixture.withResponse.overrides), 0, 7500).complete, costOf(stamps(fixture.withResponse.overrides), 1, 7500).complete], [true, false]);
  // A response the engine writes declares its costs: nothing spent is a count, not an absence.
  assert.deepEqual([costOf(stamps(fixture.withBuiltIn.overrides), 0, 0).counted, costOf(stamps(fixture.withBuiltIn.overrides), 0, 0).complete], [0, true]);
});

test("a recorded response travels whole: the recipe names it, the options carry its cost, and a decision keeps both", async () => {
  const { model, out } = await propose(
    [
      reply([use("scenario_recipe", {})]),
      reply([use("list_responses", { routes_from: "Lakeshore" })]),
      reply([use("test_option", { label: "Send Lakeshore's queue to Nord from day 12", changes: [{ kind: "response", response: "response-a", from_day: 12 }] })]),
      reply([
        give({
          options: [{ step: "s3", mechanism: "Lakeshore's waiting patients are sent to Nord, which has free beds, so fewer of them wait.", not_tested: ["Whether Nord can staff the beds the transferred patients take."] }],
          reading: [{ text: "With the transfer from day 12, patient-days waiting go from 76 to 11, and the engine counted 7,500 for it.", sources: ["s3"] }],
          human_choices: [],
          limits: ["The twin holds no staff."],
        }),
      ]),
    ],
    withLibrary(),
  );
  assert.equal(out.status, "answered");
  // The figures of the sentence are the test's own, the cost included.
  assert.equal(out.verified, true);
  // The model was handed the library before it tested anything.
  assert.match(sentBack(model, 2)[0]!.text, /"ref":"response-a","name":"Send Lakeshore's queue to Nord"/);

  const p = out.answer!;
  assert.deepEqual(p.asItIsCost, { counted: null, complete: false, says: "No cost is counted for this run: capacity and measures carry no price in the twin." });
  const o = p.options[0]!;
  assert.deepEqual([o.cost.counted, o.cost.complete], [7500, true]);
  assert.deepEqual(o.changes, [{ does: "adds", now: "recorded response Send Lakeshore's queue to Nord, from day 12", was: null }]);

  // A decision can bear on a recorded response: its rules, its figures and what it cost are copied from the journal.
  const journalled = JSON.parse(JSON.stringify({ kind: "options", status: out.status, question: OBJECTIVE.objective, answer: out.answer, steps: out.steps }));
  const draft = decisionFromExchange(journalled, "s3");
  assert.deepEqual(draft.optionStamps, [kept(fixture.withResponse.added[0]!)]);
  assert.deepEqual(draft.expected.cost, o.cost);
  assert.equal(draft.expected.withOption.waitingDays, 11.2);
  assert.ok(draft.expected.basis.some((b) => /^The recorded response Send Lakeshore's queue to Nord, from day 12: its rules fire/.test(b.element) && b.evidence === "assumption"));

  // And the recipe of a scenario that holds one calls it by a name an option can remove it by.
  const recipe = OPTION_TOOLS.find((t) => t.name === "scenario_recipe")!;
  const read = (await recipe.run(withLibrary(fixture.withResponse.overrides), {})) as { choices: Record<string, unknown>[] };
  assert.deepEqual(read.choices.at(-1), {
    ref: "choice-c",
    what: "recorded response",
    name: "Send Lakeshore's queue to Nord",
    from: "the organisation's library",
    from_day: 12,
    rules: 1,
    kinds_of_action: ["transfer"],
  });
});

test("the options are shown in the order they were tested, whatever order the model lists them in", async () => {
  const LATER = { label: "Open 3 beds at Lakeshore from day 9", changes: [{ kind: "capacity", site: "Lakeshore", units: 3, from_day: 9 }] };
  const { out } = await propose(
    [
      reply([use("test_option", BEDS)]),
      reply([use("test_option", LATER)]),
      reply([
        give({
          // Listed backwards. An order the model chose would be a ranking, and the screen ranks nothing.
          options: [
            { step: "s2", mechanism: "Fewer beds, later, for the same patients.", not_tested: [] },
            { step: "s1", mechanism: "Beds at Lakeshore are the only ones the west's patients reach.", not_tested: [] },
          ],
          reading: [{ text: "Both options were run through the engine.", sources: ["s1", "s2"] }],
          human_choices: [],
          limits: [],
        }),
      ]),
    ],
    context(blank),
  );
  assert.equal(out.status, "answered");
  assert.deepEqual(
    out.answer!.options.map((o) => [o.step, o.label]),
    [
      ["s1", BEDS.label],
      ["s2", LATER.label],
    ],
  );
  // Each keeps its own sentence: only the order was the program's to set.
  assert.match(out.answer!.options[0]!.mechanism, /the only ones the west's patients reach/);
});
