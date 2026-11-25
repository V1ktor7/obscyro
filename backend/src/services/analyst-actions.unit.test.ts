import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DEFAULT_ACTION_TYPES, OutOfBounds, actionTypesOf, type ActionType } from "./action-types.js";
import { describeAction, listActions, twinOffer } from "./analyst-actions.js";
import { ACTIONS_PROMPT, OPTIONS_PROMPT, OPTION_TOOLS, benchFor, optionsClosing, testOption, type TestedOption } from "./analyst-options.js";
import type { StoredResponse } from "./analyst-responses.js";
import { Recorded, type AnalystContext } from "./analyst-tools.js";
import { Ledger } from "./analyst-verify.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import type { ScenarioEngine } from "./scenario-run.js";
import type { SimExport } from "./twin-export.js";

/**
 * What the analyst may propose is what the project declared.
 *
 * The twin is the one the option tests use: four sites (Lakeshore, Nord, Est,
 * Clinique Pointe), two activities, two contact layers, four transfer routes.
 * The engine answers nothing: what is under test happens before a run, where a
 * change is set against its action type, and after it, where the option says
 * which type it fell under.
 */
const fixture = JSON.parse(readFileSync(new URL("./scenario-run-parity.fixture.json", import.meta.url), "utf8")) as {
  twin: SimExport;
  scenario: { id: string; name: string };
  horizon: number;
  activity: string;
  asItIs: { overrides: ScenarioOverride[] };
  /** The same scenario with a choice in it: six beds at Lakeshore from day 5. */
  withOption: { added: ScenarioOverride[] };
};

const blank: ScenarioEngine = {
  spread: async () => ({ event: { effects: [] } }),
  compare: async () => ({ datasets: [] }),
};

const WINTER: StoredResponse = { id: "11111111-1111-4111-8111-111111111111", name: "Winter plan", description: "", rules: [{ id: "r1", when: {}, action: { kind: "transfer", source: "site:lake", target: "site:north", amount: 2 } }] as never };

function context(types: ActionType[] | null, stored: StoredResponse[] = [], overrides: ScenarioOverride[] = fixture.asItIs.overrides): AnalystContext {
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
    responses: async () => stored,
    ...(types ? { actions: async () => types } : {}),
  };
  ctx.bench = benchFor({ engine: blank, scenario, horizon: fixture.horizon, activity: fixture.activity, world: ctx.world });
  return ctx;
}

const declared = (...rows: Record<string, unknown>[]) =>
  actionTypesOf(rows.map((r) => ({ key: "k", name: "n", description: "", effect: "capacity" as const, bounds: {}, lead_days: null, approver: "", active: true, ...r })));

const OVERFLOW = {
  key: "overflow-beds",
  name: "Open overflow beds",
  effect: "capacity",
  bounds: { activity: "lit", minUnits: 3, maxUnits: 10, sites: ["site:lake"] },
  lead_days: 2,
  approver: "Director of nursing",
};
const CAPACITY_OFF = { key: "capacity", name: "Add or close capacity", effect: "capacity", active: false };

const test_ = (ctx: AnalystContext, input: unknown) => testOption.run(ctx, testOption.parse.parse(input));
const beds = (over: Record<string, unknown> = {}) => ({ label: "Open beds at Lakeshore", changes: [{ kind: "capacity", site: "Lakeshore", units: 6, from_day: 5, ...over }] });
const refused = (re: RegExp) => (err: unknown) => err instanceof OutOfBounds && re.test(err.message);

// --- what the twin offers ------------------------------------------------------------

test("what an action type can point at is read from the twin", () => {
  const offer = twinOffer(fixture.twin, [WINTER]);
  assert.deepEqual(offer.activities, ["civiere", "lit"]);
  assert.deepEqual(offer.layers, ["ecole", "menage"]);
  assert.deepEqual(offer.sites.map((s) => [s.name, s.activities]), [["Clinique Pointe", ["civiere"]], ["Est", ["lit", "civiere"]], ["Lakeshore", ["lit"]], ["Nord", ["lit"]]]);
  assert.equal(offer.routes.length, 4);
  // A library response is kept by its own id, the engine's by the engine's name: what a stamp keeps.
  assert.deepEqual(offer.responses.map((r) => [r.id, r.name]), [[WINTER.id, "Winter plan"], ["load-balance", "Transfer when full"], ["surge-and-balance", "Surge what is short, then transfer"]]);
  assert.deepEqual(offer.modes, {});
});

// --- list_actions ---------------------------------------------------------------------

test("list_actions gives each active action type with its bounds, its delay and who approves", async () => {
  const out = (await listActions.run(context(declared(OVERFLOW, { key: "measure", name: "Measures", effect: "measure", active: false })), {})) as Record<string, any>;
  assert.deepEqual(out.action_types.map((a: any) => a.ref), ["capacity", "transfer", "response", "overflow-beds"]);
  assert.deepEqual(out.switched_off_in_this_project, ["Measures"]);
  assert.deepEqual(out.action_types[3], {
    ref: "overflow-beds",
    name: "Open overflow beds",
    changes: "capacity: units of an activity added or closed at a site, from a day until the end of the run",
    bounds: { activity: "lit", units_at_least: 3, units_at_most: 10, sites: [{ site: "Lakeshore", site_id: "site:lake" }] },
    days_before_it_can_apply: 2,
    approved_by: "Director of nursing",
    can_be_tested: true,
  });
  // An unbounded type says so in words rather than with a number nobody declared.
  assert.deepEqual(out.action_types[0].bounds, { activity: "any activity the site provides", sites: "any site that provides the activity" });
  assert.match(out.how_to_read, /An idea none of them covers is not an option/);
  assert.match(out.how_to_read, /applied only by a person/);
});

test("list_actions says when an action type cannot be tested, and what is missing", async () => {
  const types = declared({ key: "icu", name: "Open intensive care beds", effect: "capacity", bounds: { activity: "soins_intensifs" } });
  const out = (await listActions.run(context(types), {})) as Record<string, any>;
  const icu = out.action_types.find((a: any) => a.ref === "icu");
  assert.equal(icu.can_be_tested, false);
  assert.match(icu.missing, /No site provides "soins_intensifs"/);
});

test("an action type is described with the names the twin gives, not with ids alone", () => {
  const [t] = declared({ key: "divert", name: "Divert", effect: "transfer", bounds: { maxPerDay: 5, from: ["site:lake"], to: ["site:north"] } }).filter((x) => x.key === "divert");
  assert.deepEqual(describeAction(t!, twinOffer(fixture.twin, [])).bounds, {
    patients_per_day_at_most: 5,
    from: [{ site: "Lakeshore", site_id: "site:lake" }],
    to: [{ site: "Nord", site_id: "site:north" }],
  });
});

// --- test_option, in a project that declared nothing --------------------------------------

test("a project that declared no action type tests exactly what it tested before, and says nothing new", async () => {
  // No list at all, and the built-in list: the same thing.
  for (const types of [null, [...DEFAULT_ACTION_TYPES]]) {
    const out = (await test_(context(types), beds())) as Recorded;
    const record = out.record as TestedOption;
    assert.deepEqual(record.changes, [{ does: "adds", now: record.changes[0]!.now, was: null }]);
    assert.deepEqual((out.result as any).changes, [{ does: "adds", what: "capacity", site: "Lakeshore", site_id: "site:lake", activity: "lit", units_added: 6, from_day: 5 }]);
  }
  // Nothing bounds it: what was accepted before still is.
  await assert.doesNotReject(test_(context(null), beds({ units: 400, from_day: 0 })));
});

test("a project that declared no action type is told nothing new and offered no new tool", () => {
  const ctx = context(null);
  assert.equal(optionsClosing(ctx, { objective: "Nobody waits at Lakeshore" }).system, OPTIONS_PROMPT);
  assert.ok(!OPTION_TOOLS.some((t) => t.name === "list_actions"));
  const told = optionsClosing(ctx, { objective: "Nobody waits at Lakeshore" }, { actionTypes: true }).system;
  assert.equal(told, OPTIONS_PROMPT + ACTIONS_PROMPT);
  assert.match(told, /Propose only what an action type covers, inside its bounds/);
  assert.match(told, /say that no action type of this project covers it/);
});

// --- test_option, against a declared action type ---------------------------------------------

test("a change inside its action type is tested, and the option says which type it fell under and who approves", async () => {
  const ctx = context(declared(OVERFLOW, CAPACITY_OFF));
  const out = (await test_(ctx, beds())) as Recorded;
  const record = out.record as TestedOption;
  assert.deepEqual(record.changes[0]!.action, { key: "overflow-beds", name: "Open overflow beds", approver: "Director of nursing" });
  const said = (out.result as any).changes[0];
  assert.equal(said.action_type, "Open overflow beds");
  assert.equal(said.approved_by, "Director of nursing");
  // The stamp is the same stamp: an action type bounds a change, it does not rewrite it.
  assert.deepEqual(record.stamps.map((s) => [s.body.kind, s.start]), [["capacity", 5]]);
});

test("a change outside a bound is refused with the bound, before anything runs, and does not count as a test", async () => {
  let compares = 0;
  const ctx = context(declared(OVERFLOW, CAPACITY_OFF));
  ctx.bench = benchFor({
    engine: { ...blank, compare: async () => ((compares += 1), { datasets: [] }) },
    scenario: ctx.scenario as never,
    horizon: fixture.horizon,
    activity: fixture.activity,
    world: ctx.world,
  });
  await assert.rejects(test_(ctx, beds({ units: 40 })), refused(/"Open overflow beds" allows from 3 to 10 units: 40 is outside that\./));
  await assert.rejects(test_(ctx, beds({ site: "Nord" })), refused(/is not allowed at Nord\. It is allowed at: Lakeshore\./));
  await assert.rejects(test_(ctx, beds({ from_day: 1 })), refused(/takes 2 days before it can apply/));
  assert.equal(compares, 0);
  assert.equal(ctx.bench!.tested.length, 0);
});

test("with two action types for capacity, a change has to name one, and is held to the one it names", async () => {
  const ctx = context(declared(OVERFLOW));
  await assert.rejects(test_(ctx, beds()), refused(/several action types for capacity: capacity \(Add or close capacity\); overflow-beds \(Open overflow beds\)/));
  // Under the built-in type nothing bounds it; under the project's own, its bounds do.
  await assert.doesNotReject(test_(ctx, beds({ action: "capacity", units: 40 })));
  await assert.rejects(test_(ctx, beds({ action: "overflow-beds", units: 40 })), refused(/allows from 3 to 10 units/));
});

test("a kind of change the project switched off is not tested, and the refusal says to put it in limits", async () => {
  const ctx = context(declared(CAPACITY_OFF));
  await assert.rejects(test_(ctx, beds()), refused(/No action type of this project lets an option contain capacity\. It is not something to propose here: say in limits/));
  // The other kinds are untouched.
  await assert.doesNotReject(
    test_(ctx, { label: "Close schools in the west", changes: [{ kind: "measure", name: "Schools closed", layers: [{ layer: "ecole", factor: 0.2 }], catchments: ["Ouest-de-l'Île"], from_day: 3, days: 10 }] }),
  );
});

test("a measure is held to the layers, the factor and the days its action type allows", async () => {
  const ctx = context(declared({ key: "measure", name: "School measures", effect: "measure", bounds: { layers: [{ layer: "ecole", minFactor: 0, maxFactor: 0.5 }], maxDays: 14 } }));
  const measure = (over: Record<string, unknown>) => ({ label: "A measure", changes: [{ kind: "measure", name: "Schools closed", layers: [{ layer: "ecole", factor: 0.2 }], from_day: 3, days: 10, ...over }] });
  await assert.rejects(test_(ctx, measure({ layers: [{ layer: "menage", factor: 0.2 }] })), refused(/does not act on the layer "menage"/));
  await assert.rejects(test_(ctx, measure({ days: 20 })), refused(/lasts 14 days at most: 20 is more than that/));
  const out = (await test_(ctx, measure({}))) as Recorded;
  // A built-in the project changed is a declared type: the option names it.
  assert.equal((out.record as TestedOption).changes[0]!.action!.name, "School measures");
});

test("a transfer is held to the patients a day and the sites its action type allows", async () => {
  const ctx = context(declared({ key: "transfer", name: "Divert to Nord", effect: "transfer", bounds: { maxPerDay: 5, to: ["site:north"] }, approver: "Bed coordinator" }));
  const sent = (over: Record<string, unknown>) => ({ label: "Send patients away", changes: [{ kind: "transfer", from: "Lakeshore", to: "Nord", patients_per_day: 5, from_day: 2, ...over }] });
  await assert.rejects(test_(ctx, sent({ patients_per_day: 9 })), refused(/sends 5 patients a day at most: 9 is more than that/));
  await assert.rejects(test_(ctx, sent({ from: "Nord", to: "Est" })), refused(/does not send patients to Est\. It sends them to: Nord\./));
  const out = (await test_(ctx, sent({}))) as Recorded;
  assert.deepEqual((out.record as TestedOption).changes[0]!.action, { key: "transfer", name: "Divert to Nord", approver: "Bed coordinator" });
});

test("a recorded response is held to the ones its action type includes", async () => {
  const ctx = context(declared({ key: "response", name: "Approved plans", effect: "response", bounds: { responses: [WINTER.id] } }), [WINTER]);
  await assert.rejects(
    test_(ctx, { label: "Let the engine balance", changes: [{ kind: "response", response: "transfer-when-full" }] }),
    refused(/does not include the response “Transfer when full”\. It includes: Winter plan\./),
  );
  const out = (await test_(ctx, { label: "The winter plan", changes: [{ kind: "response", response: "Winter plan", from_day: 2 }] })) as Recorded;
  assert.equal((out.record as TestedOption).changes[0]!.action!.name, "Approved plans");
});

test("taking a choice out of the scenario needs no action type", async () => {
  // Every kind of change switched off: nothing can be placed, and a choice can still be removed.
  const off = declared(
    CAPACITY_OFF,
    { key: "measure", name: "m", effect: "measure", active: false },
    { key: "transfer", name: "t", effect: "transfer", active: false },
    { key: "response", name: "r", effect: "response", active: false },
  );
  const ctx = context(off, [], [...fixture.asItIs.overrides, ...fixture.withOption.added]);
  const open = await ctx.bench!.open();
  const ref = [...open.choices.keys()][0];
  assert.ok(ref, "the scenario holds a choice to take out");
  await assert.rejects(test_(ctx, beds()), refused(/No action type of this project lets an option contain capacity/));
  const out = (await test_(ctx, { label: "Without that choice", changes: [{ kind: "remove", ref }] })) as Recorded;
  assert.equal((out.record as TestedOption).changes[0]!.does, "removes");
  assert.equal((out.record as TestedOption).changes[0]!.action, undefined);
});
