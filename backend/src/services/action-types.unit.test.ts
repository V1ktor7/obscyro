import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ACTION_TYPES,
  EFFECTS,
  OutOfBounds,
  actionFor,
  actionTypeDraft,
  actionTypesOf,
  fitCapacity,
  fitMeasure,
  fitResponse,
  fitTransfer,
  isConfigured,
  keyFrom,
  missingFor,
  readDraft,
  saidOf,
  type ActionType,
  type TwinOffer,
} from "./action-types.js";
import { ToolError } from "./analyst-tools.js";

const row = (over: Record<string, unknown> = {}) => ({
  key: "overflow-beds",
  name: "Open overflow beds",
  description: "",
  effect: "capacity" as const,
  bounds: { activity: "lit", minUnits: 10, maxUnits: 60, sites: ["site:lake"], mode: null },
  lead_days: 2,
  approver: "Director of nursing",
  active: true,
  ...over,
});
const type = (over: Record<string, unknown> = {}): ActionType => actionTypesOf([row(over)]).find((t) => t.key === (over.key ?? "overflow-beds"))!;
const capacity = (over: Record<string, unknown> = {}) => type(over) as ActionType & { effect: "capacity" };

const PLACES = {
  facilities: [
    { id: "site:lake", name: "Lakeshore" },
    { id: "site:north", name: "Nord" },
  ],
  populations: [
    { id: "pop:west", name: "Ouest-de-l'Île" },
    { id: "pop:centre", name: "Centre" },
  ],
};
const refused = (re: RegExp) => (err: unknown) => err instanceof OutOfBounds && err instanceof ToolError && re.test(err.message);

// --- what every project starts with -----------------------------------------------

test("a project that declared nothing has four action types, one per kind of change, unbounded and on", () => {
  const types = actionTypesOf([]);
  assert.deepEqual(types, [...DEFAULT_ACTION_TYPES]);
  assert.deepEqual(types.map((t) => t.effect), [...EFFECTS]);
  assert.ok(types.every((t) => t.active && t.builtIn && !t.declared && t.leadDays === null && t.approver === ""));
  for (const t of types) assert.ok(Object.values(t.bounds).every((v) => v === null), `${t.key} is bounded`);
  // Nothing was declared: the analyst is told nothing new.
  assert.equal(isConfigured(types), false);
});

test("a project's own types come after the built-in ones, by name, and a built-in it changed keeps its place", () => {
  const types = actionTypesOf([
    row({ key: "recall-staff", name: "Zone transfers", effect: "transfer", bounds: { maxPerDay: 5 } }),
    row(),
    row({ key: "capacity", name: "Beds, within reason", bounds: { maxUnits: 40 }, lead_days: null, approver: "" }),
  ]);
  assert.deepEqual(types.map((t) => t.key), ["capacity", "measure", "transfer", "response", "overflow-beds", "recall-staff"]);
  assert.deepEqual(
    types.map((t) => [t.builtIn, t.declared]),
    [[true, true], [true, false], [true, false], [true, false], [false, true], [false, true]],
  );
  const changed = types[0]! as ActionType & { effect: "capacity" };
  assert.equal(changed.name, "Beds, within reason");
  // A bound left out is no bound, not a zero.
  assert.deepEqual(changed.bounds, { activity: null, minUnits: null, maxUnits: 40, sites: null, mode: null });
  assert.equal(isConfigured(types), true);
});

test("a row that cannot be read any more keeps its type on the list, without the bound", () => {
  const t = capacity({ bounds: { minUnits: "ten", sites: "everywhere" } });
  assert.equal(t.name, "Open overflow beds");
  assert.deepEqual(t.bounds, { activity: null, minUnits: null, maxUnits: null, sites: null, mode: null });
});

test("a built-in type keeps what it changes, whatever a row under its key says", () => {
  const types = actionTypesOf([row({ key: "capacity", effect: "transfer", bounds: {} })]);
  assert.deepEqual(types[0], DEFAULT_ACTION_TYPES[0]);
});

// --- what a person may write ------------------------------------------------------

const draft = (over: Record<string, unknown> = {}) => actionTypeDraft.parse({ name: "Open overflow beds", effect: "capacity", bounds: { minUnits: 10, maxUnits: 60 }, ...over });

test("a draft is read with its bounds, and what it leaves out is no bound", () => {
  const read = readDraft(draft({ leadDays: 2, approver: " Director of nursing " }));
  assert.deepEqual(read, {
    name: "Open overflow beds",
    description: "",
    effect: "capacity",
    bounds: { activity: null, minUnits: 10, maxUnits: 60, sites: null, mode: null },
    leadDays: 2,
    approver: "Director of nursing",
    active: true,
  });
});

test("bounds out of order, or beyond what a run can do, are refused with what to correct", () => {
  assert.throws(() => readDraft(draft({ bounds: { minUnits: 60, maxUnits: 10 } })), /The fewest units \(60\) is above the most \(10\)/);
  assert.throws(
    () => readDraft(draft({ effect: "measure", bounds: { layers: [{ layer: "ecole", minFactor: 0.8, maxFactor: 0.2 }] } })),
    /On the layer "ecole", the lowest factor \(0\.8\) is above the highest \(0\.2\)/,
  );
  // A route carries twenty patients a day in a run: a bound above it would promise what no test can give.
  assert.throws(() => readDraft(draft({ effect: "transfer", bounds: { maxPerDay: 500 } })), /The bounds cannot be read: maxPerDay/);
  assert.throws(() => readDraft(draft({ bounds: { sites: "Lakeshore" } })), /The bounds cannot be read: sites/);
  assert.throws(() => actionTypeDraft.parse({ name: "", effect: "capacity" }));
  assert.throws(() => actionTypeDraft.parse({ name: "Recall staff", effect: "staff" }));
});

test("a key is made from the name, and never taken twice", () => {
  assert.equal(keyFrom("Ouvrir des lits de débordement", new Set()), "ouvrir-des-lits-de-debordement");
  assert.equal(keyFrom("Open overflow beds", new Set(["open-overflow-beds", "open-overflow-beds-2"])), "open-overflow-beds-3");
  assert.equal(keyFrom("???", new Set()), "action");
  assert.equal(keyFrom("Capacity", new Set(DEFAULT_ACTION_TYPES.map((t) => t.key))), "capacity-2");
});

// --- the action type a change falls under -------------------------------------------

test("a change that names no action type falls under the one type of its kind", () => {
  assert.equal(actionFor(actionTypesOf([]), "capacity", undefined).key, "capacity");
  assert.equal(actionFor(actionTypesOf([]), "transfer", undefined).key, "transfer");
});

test("with several action types of one kind, a change has to say which", () => {
  const types = actionTypesOf([row()]);
  assert.throws(() => actionFor(types, "capacity", undefined), refused(/several action types for capacity: capacity \(Add or close capacity\); overflow-beds \(Open overflow beds\)\. Say which one/));
  assert.equal(actionFor(types, "capacity", "overflow-beds").name, "Open overflow beds");
  assert.equal(actionFor(types, "capacity", " Overflow-Beds ").key, "overflow-beds");
});

test("a kind of change no active action type covers is not to be proposed, and the refusal says where it goes", () => {
  const types = actionTypesOf([row({ key: "measure", name: "Measures", effect: "measure", bounds: {}, active: false })]);
  assert.throws(() => actionFor(types, "measure", undefined), refused(/No action type of this project lets an option contain a measure\..*say in limits that no action type covers it/));
  assert.throws(() => actionFor(types, "measure", "measure"), refused(/"Measures" is switched off in this project/));
});

test("an action type that is unknown, or changes something else, is refused with the ones that fit", () => {
  const types = actionTypesOf([row()]);
  assert.throws(() => actionFor(types, "capacity", "recall-staff"), refused(/no action type called "recall-staff"\. For capacity, it has: capacity \(Add or close capacity\); overflow-beds/));
  assert.throws(() => actionFor(types, "transfer", "overflow-beds"), refused(/"Open overflow beds" changes capacity, and this change is a transfer of patients\. For a transfer of patients, use: transfer/));
});

// --- one change against its bounds ---------------------------------------------------

const beds = (over: Record<string, unknown> = {}) => ({ facility: "site:lake", activity: "lit", amount: 20, start: 5, mode: undefined as string | undefined, ...over });

test("capacity inside its bounds passes, and outside is refused with the bound", () => {
  const t = capacity();
  assert.equal(fitCapacity(t, beds(), PLACES), undefined);
  assert.throws(() => fitCapacity(t, beds({ amount: 80 }), PLACES), refused(/"Open overflow beds" allows from 10 to 60 units: 80 is outside that\./));
  assert.throws(() => fitCapacity(t, beds({ amount: 6 }), PLACES), refused(/allows from 10 to 60 units: 6 is outside that/));
  assert.throws(() => fitCapacity(t, beds({ activity: "civiere" }), PLACES), refused(/changes lit and nothing else: this change is on civiere/));
  assert.throws(() => fitCapacity(t, beds({ facility: "site:north" }), PLACES), refused(/is not allowed at Nord\. It is allowed at: Lakeshore\./));
  assert.throws(() => fitCapacity(t, beds({ start: 1 }), PLACES), refused(/takes 2 days before it can apply\. The decision is taken on day 0 of the run, so it cannot start on day 1: ask for day 2 or later/));
});

test("a bound on one side only is said as such", () => {
  assert.throws(() => fitCapacity(capacity({ bounds: { maxUnits: 40 } }), beds({ amount: 41 }), PLACES), refused(/allows 40 units or fewer: 41 is outside that/));
  assert.throws(() => fitCapacity(capacity({ bounds: { minUnits: -20, maxUnits: -1 } }), beds({ amount: 5 }), PLACES), refused(/allows from -20 to -1 units: 5 is outside that/));
  assert.throws(() => fitCapacity(capacity({ bounds: { minUnits: 10 } }), beds({ amount: 5 }), PLACES), refused(/allows 10 units or more/));
});

test("an action type that opens units in one mode gives that mode, and refuses another", () => {
  const t = capacity({ bounds: { mode: "rush" } });
  assert.equal(fitCapacity(t, beds(), PLACES), "rush");
  assert.equal(fitCapacity(t, beds({ mode: "Rush" }), PLACES), "rush");
  assert.throws(() => fitCapacity(t, beds({ mode: "standard" }), PLACES), refused(/opens units in mode "rush" only/));
  // Closing units has no mode.
  assert.equal(fitCapacity(t, beds({ amount: -3 }), PLACES), undefined);
  // Without a mode of its own, the change keeps the one it asked for.
  assert.equal(fitCapacity(capacity({ bounds: {} }), beds({ mode: "standard" }), PLACES), "standard");
});

test("a measure stays on its layers, inside its factors, its days and its catchments", () => {
  const t = type({ key: "close-schools", name: "Close schools", effect: "measure", bounds: { layers: [{ layer: "ecole", minFactor: 0, maxFactor: 0.5 }], maxDays: 14, catchments: ["pop:west"] }, lead_days: null }) as ActionType & { effect: "measure" };
  const measure = (over: Record<string, unknown> = {}) => ({ layers: [{ layer: "ecole", factor: 0.2 }], populations: ["pop:west"] as string[] | null, start: 0, days: 10, ...over });
  assert.doesNotThrow(() => fitMeasure(t, measure(), PLACES));
  assert.throws(() => fitMeasure(t, measure({ layers: [{ layer: "menage", factor: 0.2 }] }), PLACES), refused(/does not act on the layer "menage"\. It acts on: ecole\./));
  assert.throws(() => fitMeasure(t, measure({ layers: [{ layer: "ecole", factor: 0.9 }] }), PLACES), refused(/allows a factor from 0 to 0\.5 on "ecole": 0\.9 is outside that/));
  assert.throws(() => fitMeasure(t, measure({ days: 30 }), PLACES), refused(/lasts 14 days at most: 30 is more than that/));
  assert.throws(() => fitMeasure(t, measure({ populations: null }), PLACES), refused(/does not cover every catchment\. Name the catchments, among: Ouest-de-l'Île\./));
  assert.throws(() => fitMeasure(t, measure({ populations: ["pop:west", "pop:centre"] }), PLACES), refused(/is not allowed in Centre\. It is allowed in: Ouest-de-l'Île\./));
});

test("a transfer stays under its patients a day and between its sites", () => {
  const t = type({ key: "divert", name: "Divert to Nord", effect: "transfer", bounds: { maxPerDay: 5, from: ["site:lake"], to: ["site:north"] }, lead_days: 1 }) as ActionType & { effect: "transfer" };
  const sent = (over: Record<string, unknown> = {}) => ({ source: "site:lake", target: "site:north", perDay: 5, start: 1, ...over });
  assert.doesNotThrow(() => fitTransfer(t, sent(), PLACES));
  assert.throws(() => fitTransfer(t, sent({ perDay: 6 }), PLACES), refused(/sends 5 patients a day at most: 6 is more than that/));
  assert.throws(() => fitTransfer(t, sent({ source: "site:north" }), PLACES), refused(/does not send patients from Nord\. It sends them from: Lakeshore\./));
  assert.throws(() => fitTransfer(t, sent({ target: "site:lake" }), PLACES), refused(/does not send patients to Lakeshore\. It sends them to: Nord\./));
  assert.throws(() => fitTransfer(t, sent({ start: 0 }), PLACES), refused(/takes 1 day before it can apply/));
});

test("a recorded response has to be one the action type includes", () => {
  const known = [
    { id: "load-balance", name: "Transfer when full" },
    { id: "r-1", name: "Winter plan" },
  ];
  const t = type({ key: "plans", name: "Approved plans", effect: "response", bounds: { responses: ["r-1"] }, lead_days: null }) as ActionType & { effect: "response" };
  assert.doesNotThrow(() => fitResponse(t, { ref: "r-1", name: "Winter plan", start: 0 }, known));
  assert.throws(() => fitResponse(t, { ref: "load-balance", name: "Transfer when full", start: 0 }, known), refused(/does not include the response “Transfer when full”\. It includes: Winter plan\./));
});

test("an option names its action type only when the project declared it", () => {
  assert.equal(saidOf(DEFAULT_ACTION_TYPES[0]!), null);
  assert.deepEqual(saidOf(type()), { key: "overflow-beds", name: "Open overflow beds", approver: "Director of nursing" });
});

// --- can it be tested on this twin? ---------------------------------------------------

const OFFER: TwinOffer = {
  activities: ["civiere", "lit"],
  layers: ["ecole", "menage"],
  sites: [
    { id: "site:lake", name: "Lakeshore", activities: ["lit"] },
    { id: "site:clinic", name: "Clinique Pointe", activities: ["civiere"] },
  ],
  catchments: [{ id: "pop:west", name: "Ouest-de-l'Île" }],
  routes: [{ source: "site:lake", target: "site:north" }],
  responses: [{ id: "load-balance", name: "Transfer when full" }],
  modes: { lit: [{ mode: "standard", leadDays: 14 }, { mode: "rush", leadDays: 3 }] },
};

test("an action type that points at what the twin declares can be tested", () => {
  for (const t of DEFAULT_ACTION_TYPES) assert.equal(missingFor(t, OFFER), null, t.key);
  assert.equal(missingFor(capacity({ bounds: { activity: "lit", sites: ["site:lake"], mode: "rush" } }), OFFER), null);
});

test("an action type that points at something the twin does not hold says what is missing", () => {
  assert.match(missingFor(capacity({ bounds: { activity: "soins_intensifs" } }), OFFER)!, /No site provides "soins_intensifs"\. The activities of the twin are: civiere, lit\./);
  assert.match(missingFor(capacity({ bounds: { sites: ["site:gone"] } }), OFFER)!, /None of its sites is on the map/);
  assert.match(missingFor(capacity({ bounds: { activity: "lit", sites: ["site:clinic"] } }), OFFER)!, /None of its sites provides "lit"/);
  assert.match(missingFor(capacity({ bounds: { activity: "lit", mode: "overnight" } }), OFFER)!, /price list holds no mode "overnight" for lit/);
  assert.match(missingFor(capacity(), { ...OFFER, activities: [] })!, /No site of the twin provides an activity/);

  const measure = (bounds: Record<string, unknown>) => type({ key: "m", effect: "measure", bounds });
  assert.match(missingFor(measure({}), { ...OFFER, layers: [] })!, /declares no contact layer/);
  assert.match(missingFor(measure({ layers: [{ layer: "travail", minFactor: 0, maxFactor: 1 }] }), OFFER)!, /no contact layer called "travail"\. It declares: ecole, menage\./);
  assert.match(missingFor(measure({ catchments: ["pop:gone"] }), OFFER)!, /None of its catchments is in the twin/);

  const transfer = (bounds: Record<string, unknown>) => type({ key: "t", effect: "transfer", bounds });
  assert.match(missingFor(transfer({}), { ...OFFER, routes: [] })!, /holds no transfer route between two sites/);
  assert.match(missingFor(transfer({ from: ["site:north"] }), OFFER)!, /no transfer route from one of its sites to one of its destinations/);

  assert.match(missingFor(type({ key: "r", effect: "response", bounds: { responses: ["r-gone"] } }), OFFER)!, /None of the recorded responses it names is in the library/);
});
