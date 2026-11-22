import assert from "node:assert/strict";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { feedFrom, type FeedAlertRow } from "./alert-feed.js";
import { READ_TOOLS, ToolError, type AnalystContext } from "./analyst-tools.js";
import { Ledger } from "./analyst-verify.js";
import { ageOfValue, alertsNow, duration, shown, unitNow, type LiveReading, type LiveSignal } from "./live-reading.js";
import type { EnvInstanceRow, EnvLinkRow } from "./ontology.js";
import { ANALYST_MODEL, ask, askClosing, type AnalystModel } from "./analyst.js";
import { preparedQuestion, situationOf } from "./situation.js";
import type { SimRole } from "./property-schema.js";
import type { MetricDef } from "./twin-metrics.js";
import { rollupFrom, type TwinTreeEdge } from "./twin.js";

// ---------------------------------------------------------------------------
// What the analyst says about "now" is what the screens show.
//
// The live reading is built from the unit page's own roll-up (`rollupFrom`)
// and the alert banner's own feed (`feedFrom`), and the two tools hand the
// model those figures, rounded the way the page prints them. These tests take
// one small twin, compute the page's figures, and ask the tools: the answers
// have to be the same numbers.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-11-20T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);

const inst = (id: string, typeName: string, simRole: SimRole | null, properties: Record<string, unknown> = {}): EnvInstanceRow => ({
  id,
  typeId: `type:${typeName}`,
  typeName,
  properties,
  provenance: {},
  propertySchema: [],
  simRole,
  createdAt: ago(600),
  updatedAt: ago(50),
});
const placed = (thing: EnvInstanceRow, unit: string): EnvLinkRow => ({
  id: `${thing.id}@${unit}`,
  linkTypeName: "located_in",
  aggregates: "metrics",
  aggregateToward: "target",
  transitive: false,
  fromInstanceId: thing.id,
  toInstanceId: unit,
  fromTypeName: thing.typeName,
  toTypeName: "OrgUnit",
});

// A hospital with two wards: seven units of capacity under it, four in use.
const UNITS = [
  { id: "H", name: "Hôpital du Lac", parentId: null },
  { id: "W1", name: "Médecine", parentId: "H" },
  { id: "W2", name: "Chirurgie", parentId: "H" },
];
const EDGES: TwinTreeEdge[] = [
  { fromId: "H", toId: "W1" },
  { fromId: "H", toId: "W2" },
];
const AT_W1 = [inst("b1", "Lit", "space", { status: "occupied" }), inst("b2", "Lit", "space"), inst("b3", "Lit", "space")];
const AT_W2 = [inst("b4", "Lit", "space", { status: "occupied" }), inst("b5", "Lit", "space", { status: "occupied" })];
const AT_H = [inst("c1", "Civière", "space"), inst("c2", "Civière", "space", { status: "occupied" })];
const INSTANCES = [...UNITS.map((u) => inst(u.id, "OrgUnit", null, { name: u.name })), ...AT_W1, ...AT_W2, ...AT_H];
const LINKS = [...AT_W1.map((i) => placed(i, "W1")), ...AT_W2.map((i) => placed(i, "W2")), ...AT_H.map((i) => placed(i, "H"))];
const OCCUPANCY: MetricDef = {
  key: "occupancy",
  label: "Occupancy",
  objectType: "OrgUnit",
  unit: "percent",
  numerator: { ofRole: "space", inUse: true, agg: "count" },
  denominator: { ofRole: "space", agg: "count" },
};

/** What the unit page computes. */
const PAGE = rollupFrom(UNITS, EDGES, INSTANCES, LINKS, [OCCUPANCY], NOW);

const alert = (over: Partial<FeedAlertRow> & Pick<FeedAlertRow, "id" | "unit_instance_id" | "unit_name">): FeedAlertRow => ({
  severity: "warn",
  metric: "occupancy",
  value: "0",
  message: "",
  created_at: ago(10),
  observed_at: null,
  observed_basis: null,
  written_at: null,
  signal_id: null,
  ...over,
});
const ALERTS: FeedAlertRow[] = [
  alert({
    id: "a1",
    unit_instance_id: "W2",
    unit_name: "Chirurgie",
    severity: "critical",
    value: "100",
    message: "Occupancy at 100 % in Chirurgie",
    created_at: ago(180),
    observed_at: ago(37),
    observed_basis: "observed",
    signal_id: "s1",
  }),
  alert({
    id: "a2",
    unit_instance_id: "H",
    unit_name: "Hôpital du Lac",
    value: String(PAGE.get("H")!.values.occupancy),
    message: "Occupancy above 50 % at Hôpital du Lac",
    created_at: ago(26),
    observed_at: ago(120),
    observed_basis: "partial",
  }),
  alert({ id: "a3", unit_instance_id: "W1", unit_name: "Médecine", severity: "info", value: "33.3333", created_at: ago(4), observed_basis: "undeclared" }),
];
const SIGNAL: LiveSignal = {
  id: "s1",
  title: "Chirurgie at capacity",
  severity: "critical",
  detectedAt: ago(180).toISOString(),
  closedAt: null,
  unitId: "W2",
  alertId: "a1",
  typeId: "kind-1",
  type: "Capacity breach",
  domain: "Capacity",
  stage: "Triage",
  stageNo: 1,
  stages: 4,
  needsApproval: false,
  isLast: false,
};

function live(over: Partial<LiveReading> = {}): LiveReading {
  const feed = feedFrom(
    ALERTS,
    [
      { severity: "critical", n: 1 },
      { severity: "warn", n: 1 },
      { severity: "info", n: 1 },
    ],
    { open: 12, changed_at: ago(4) },
    { lastAt: new Date(NOW - 4_000).toISOString(), lastMs: 500, everyMs: 5_500 },
    new Date(NOW),
  );
  return {
    at: feed.at,
    units: UNITS,
    metrics: PAGE,
    measures: [{ key: "occupancy", label: "Occupancy", unit: "percent" }],
    feed,
    rules: 2,
    signals: [SIGNAL],
    openSignalsByStage: [
      { stage: "Triage", n: 9 },
      { stage: "Response", n: 3 },
    ],
    ...over,
  };
}

const ctxOf = (reading: LiveReading): AnalystContext => {
  const never = async (): Promise<never> => {
    throw new ToolError("not read in this test");
  };
  return { environment: "lac", scenario: null, run: null, known: new Ledger(), world: never, datasets: never, rows: never, events: never, live: async () => reading };
};
const tool = (name: string) => READ_TOOLS.find((t) => t.name === name)!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: string, input: object, reading = live()): Promise<any> => tool(name).run(ctxOf(reading), tool(name).parse.parse(input));

test("the analyst's figure for a unit is the unit page's, rounded as the page prints it", async () => {
  for (const unit of UNITS) {
    const onPage = PAGE.get(unit.id)!;
    const said = await run("unit_now", { unit: unit.name });
    assert.equal(said.unit.id, unit.id);
    // The page prints a percentage with no decimals (`formatMetricValue`).
    assert.equal(said.measures[0].value, Math.round(onPage.values.occupancy!), unit.name);
    assert.equal(said.measures[0].measure, "Occupancy");
    assert.deepEqual(said.under_it_by_type, onPage.instanceCountByType, unit.name);
    assert.equal(said.linked, onPage.linkedInstanceCount);
  }
  // The hospital: everything under it, its two wards included. 4 of 7, not the 1 of 2 that stand in it.
  const hospital = await run("unit_now", { unit: "H" });
  assert.equal(hospital.measures[0].value, 57);
  assert.deepEqual(hospital.under_it_by_type, { Lit: 5, Civière: 2 });
  assert.deepEqual(hospital.unit, { id: "H", name: "Hôpital du Lac", inside: null, sub_units: 2 });
  assert.match(hospital.how_to_read.join(" "), /sub-units included/);
  assert.match(hospital.how_to_read.join(" "), /get_site/);
  assert.equal((await run("unit_now", { unit: "Médecine" })).unit.inside, "Hôpital du Lac");
});

test("a unit's reading says how old it is, or that nobody knows", async () => {
  // Nothing in this twin declares a property carrying the time of a reading.
  const said = await run("unit_now", { unit: "Chirurgie" });
  assert.equal(said.value_age.known, "unknown");
  assert.equal(said.value_age.says, "age of the value unknown");
  assert.match(said.value_age.why, /No property of this type is declared/);
  // The measure says the same of its own value, in its own words.
  assert.equal(said.measures[0].value_age.says, "age of the value unknown");
  assert.match(said.measures[0].value_age.why, /No property of what this measure reads is declared/);
  // When it was written here is known, and is not offered as the age of the value.
  assert.equal(said.last_written_here, "50 min ago");
  assert.equal(said.open_alerts.length, 1);
  assert.equal(said.open_alerts[0].severity, "critical");
});

test("each live figure carries its own age, which is not always the unit's", async () => {
  // The hospital also carries an air quality station, read two hours ago. Its
  // occupancy comes from a census fourteen minutes old.
  const hospital = PAGE.get("H")!;
  const metrics = new Map(PAGE).set("H", {
    ...hospital,
    freshnessSeconds: 119 * 60,
    freshnessBasis: "observed",
    valueAges: { occupancy: { seconds: 14 * 60, basis: "observed" } },
  });
  const said = await run("unit_now", { unit: "H" }, live({ metrics }));
  assert.deepEqual(said.measures[0].value_age, { known: "exact", age: "14 min", says: "value read 14 min ago", why: null });
  // The unit as a whole answers another question, and keeps its own answer.
  assert.equal(said.value_age.says, "value read 2 h ago");
  assert.match(said.how_to_read.join(" "), /A measure's own `value_age` is the age of what that measure reads/);
  assert.match(said.how_to_read.join(" "), /it can be older than a measure's/);
  // A measure with nothing to compute it from has nothing to date either.
  const bare = await run("unit_now", { unit: "X" }, live({ units: [...UNITS, { id: "X", name: "Annexe", parentId: null }] }));
  assert.equal(bare.measures[0].value, null);
  assert.equal("value_age" in bare.measures[0], false);
});

test("an alert's floor is said of what its measure reads", async () => {
  const said = await run("list_alerts", {});
  assert.equal(said.alerts[1].value_age.why, "One of the sources this measure reads published no readable time, so this is a floor.");
  assert.equal(said.alerts[2].value_age.why, "No property of what this measure reads is declared as carrying the time of the reading.");
  assert.match(said.how_to_read.join(" "), /the age of what the alert's measure reads, not of everything under its unit/);
});

test("what is open is listed worst first, each value with its age and its signal's stage", async () => {
  const said = await run("list_alerts", {});
  assert.deepEqual(said.open_alerts, { total: 3, critical: 1, warn: 1, info: 1 });
  assert.deepEqual(
    said.alerts.map((a: { unit: string }) => a.unit),
    ["Chirurgie", "Hôpital du Lac", "Médecine"],
  );
  const [worst, floor, unknown] = said.alerts;

  assert.equal(worst.value, 100);
  assert.equal(worst.measure, "Occupancy");
  assert.equal(worst.open_for, "3 h");
  assert.deepEqual(worst.value_age, { known: "exact", age: "37 min", says: "value read 37 min ago", why: null });
  assert.deepEqual(worst.signal, { id: "s1", title: "Chirurgie at capacity", kind: "Capacity breach", domain: "Capacity", stage: "Triage", step: "1 of 4", needs_approval: false, closed: false });

  // 57.14… on the server, 57 % on the page: the analyst is handed 57.
  assert.equal(floor.value, 57);
  // One source of the unit published no time: a floor, said as a floor.
  assert.equal(floor.value_age.says, "value read at least 2 h ago");
  assert.equal(floor.value_age.known, "at_least");
  assert.match(floor.value_age.why, /floor/);
  assert.equal(floor.signal, null);

  assert.equal(unknown.value, 33);
  assert.equal(unknown.value_age.says, "age of the value unknown");
  assert.equal(unknown.open_for, "4 min");

  assert.equal(said.alert_rules, 2);
  assert.equal(said.checked.says, "thresholds last checked 4 s ago");
  assert.deepEqual(said.open_signals, { total: 12, by_stage: [{ stage: "Triage", n: 9 }, { stage: "Response", n: 3 }] });
  assert.match(said.how_to_read.join(" "), /cannot say what was open earlier/);
});

test("one unit's alerts can be asked for, and a unit that does not exist is said so", async () => {
  const said = await run("list_alerts", { unit: "Chirurgie" });
  assert.equal(said.unit, "Chirurgie");
  assert.deepEqual(said.open_alerts, { total: 1, critical: 1, warn: 0, info: 0 });
  assert.equal(said.alerts.length, 1);
  assert.equal("not_listed" in said, false);

  await assert.rejects(run("list_alerts", { unit: "Pédiatrie" }), (e) => e instanceof ToolError && /No unit matches "Pédiatrie"/.test(e.message));
  await assert.rejects(run("unit_now", { unit: "Pédiatrie" }), ToolError);
});

test("nothing open is not said as nothing wrong", async () => {
  const quiet = feedFrom([], [], { open: 0, changed_at: null }, { lastAt: null, lastMs: null, everyMs: null }, new Date(NOW));
  // No rule at all: nothing could have opened.
  const noRule = alertsNow(live({ feed: quiet, rules: 0, signals: [], openSignalsByStage: [] }));
  assert.deepEqual(noRule.open_alerts, { total: 0, critical: 0, warn: 0, info: 0 });
  assert.match(noRule.how_to_read.join(" "), /No alert rule exists in this project/);
  // The evaluator ran four seconds ago, for other projects: here there is no threshold it could have checked.
  assert.equal(noRule.checked.says, "no alert rule exists in this project, so nothing can open");
  assert.equal(alertsNow(live({ rules: 0 })).checked.says, "no alert rule exists in this project, so nothing can open");
  // Rules exist and none fired: what was seen when last checked, not a guarantee.
  const calm = alertsNow(live({ feed: quiet, rules: 3, signals: [], openSignalsByStage: [] }));
  assert.match(calm.how_to_read.join(" "), /No alert is open\. That is what the rules saw/);
  assert.equal(calm.checked.says, "the thresholds have not been checked since the server started");
  assert.doesNotMatch(calm.how_to_read.join(" "), /No alert rule exists/);
});

test("the list says what it leaves out", () => {
  const cut = feedFrom(ALERTS.slice(0, 1), [{ severity: "critical", n: 41 }], { open: 41, changed_at: null }, { lastAt: null, lastMs: null, everyMs: null }, new Date(NOW));
  const said = alertsNow(live({ feed: cut }));
  assert.equal(said.open_alerts.total, 41);
  assert.equal(said.alerts.length, 1);
  assert.equal(said.not_listed, 40);
});

test("a value and an age are written the way the screens write them", () => {
  assert.equal(shown(152.38, "percent"), 152);
  assert.equal(shown(0.666, "ratio"), 0.67);
  assert.equal(shown(41.6, "count"), 42);
  assert.equal(shown(13.86, "number"), 13.9);
  assert.equal(shown(null, "percent"), null);

  assert.equal(duration(12_000), "12 s");
  assert.equal(duration(4 * 60_000), "4 min");
  assert.equal(duration(3 * 3_600_000), "3 h");
  assert.equal(duration(50 * 3_600_000), "2 d");

  assert.equal(ageOfValue(2, "observed").says, "value read just now");
  assert.equal(ageOfValue(2220, "observed").says, "value read 37 min ago");
  assert.equal(ageOfValue(7200, "partial").says, "value read at least 2 h ago");
  assert.deepEqual(ageOfValue(null, "zone-unknown"), {
    known: "unknown",
    age: null,
    says: "age of the value unknown",
    why: "The timestamp names a wall clock and no zone is declared for it.",
  });
  // A unit with nothing under it has no reading to date.
  const bare = unitNow(live({ units: [...UNITS, { id: "X", name: "Annexe", parentId: null }] }), { id: "X", name: "Annexe", parentId: null });
  assert.equal(bare.measures[0].value, null);
  assert.equal(bare.value_age.why, "Nothing is linked to this unit.");
  assert.deepEqual(bare.under_it_by_type, {});
});

// ---------------------------------------------------------------------------
// The situation card.
// ---------------------------------------------------------------------------

test("a card opened from an alert carries the unit's figures, and they are the analyst's", async () => {
  const card = situationOf(live(), { unitId: null, alertId: "a1", signalId: null });
  // The alert brought its unit.
  assert.equal(card.unit!.unit.name, "Chirurgie");
  // One function, two readers: the card cannot show a figure the analyst would not be handed.
  assert.deepEqual(card.unit, await run("unit_now", { unit: "W2" }));
  assert.equal(card.unit!.measures[0]!.value, 100);
  const from = card.alert;
  assert.ok(from !== null && from.state === "open");
  assert.equal(from.reading.value_age.says, "value read 37 min ago");
  assert.equal(card.question, "What is open at Chirurgie right now, how old are its figures, and what else is open around it?");
  assert.equal(card.checked.says, "thresholds last checked 4 s ago");
  assert.equal(card.alertRules, 2);
});

test("a card opened from a signal shows where the signal stands, and finds its unit and its alert", () => {
  const stages = [
    { name: "Triage", requiresApproval: false },
    { name: "Assessment", requiresApproval: false },
    { name: "Response", requiresApproval: true },
    { name: "Closed", requiresApproval: false },
  ];
  const card = situationOf(live(), { unitId: null, alertId: null, signalId: "s1" }, SIGNAL, stages);
  assert.equal(card.signal!.stage, "Triage");
  assert.deepEqual(
    card.signal!.path.map((s) => [s.name, s.current, s.needsApproval]),
    [
      ["Triage", true, false],
      ["Assessment", false, false],
      ["Response", false, true],
      ["Closed", false, false],
    ],
  );
  assert.equal(card.unit!.unit.id, "W2");
  assert.equal(card.alert!.state, "open");
});

test("an alert that is no longer open is said so, and the unit is still read", () => {
  const card = situationOf(live(), { unitId: "W1", alertId: "gone", signalId: null });
  assert.deepEqual(card.alert, { state: "not_open" });
  assert.equal(card.unit!.unit.name, "Médecine");
  assert.equal(card.question, "What do the live figures of Médecine show right now, and how old are they?");
  // No unit at all: the card still has a question to ask.
  assert.equal(situationOf(live(), { unitId: null, alertId: "gone", signalId: null }).unit, null);
  assert.equal(preparedQuestion(null, false), "What is open right now, and where?");
});

test("the card says what it cannot say", () => {
  const card = situationOf(live(), { unitId: "H", alertId: null, signalId: null });
  assert.equal(card.alert, null);
  assert.equal(card.signal, null);
  assert.deepEqual(card.decisions.items, []);
  // No signal on this card: nothing to tell the kind by, and nothing to engage on.
  assert.match(card.decisions.note, /This card names no signal/);
  assert.equal(card.responses, null);
  assert.deepEqual(card.engage, { possible: false, why: "This card names no signal: a response is engaged on a signal." });
  // The readings are kept, and the card says where they are instead of claiming there are none.
  assert.match(card.limits.join(" "), /What a figure was earlier is on the unit's page, which shows the readings the twin kept/);
  assert.match(card.limits.join(" "), /no staff and no stocks/);
});

test("the analyst is told what the person has in front of them, in names the server looked up", () => {
  const opening = askClosing(ctxOf(live()), {
    question: "What is open here?",
    looking: "reality",
    focus: {
      page: "live",
      unit: { id: "W2", name: "Chirurgie" },
      signal: { id: "s1", title: "Chirurgie at capacity", kind: "Capacity breach", stage: "Triage", step: "1 of 4", unitId: "W2" },
    },
  }).opening;
  assert.match(opening, /The person is on the "live" page of the Studio\./);
  assert.match(opening, /They have a unit selected: "Chirurgie" \(id W2\)\. unit_now and list_alerts take this id\./);
  assert.match(opening, /They have a signal open: "Chirurgie at capacity" \(Capacity breach, at the stage "Triage", step 1 of 4\), about the unit with id W2\./);
  // Asked from the Scenarios map, as before: nothing is added.
  const plain = askClosing(ctxOf(live()), { question: "What is open here?", looking: "reality" }).opening;
  assert.doesNotMatch(plain, /page of the Studio|unit selected|signal open/);
});

// ---------------------------------------------------------------------------
// The whole exchange, with a model that says what the test tells it to.
// ---------------------------------------------------------------------------

type Message = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;

let calls = 0;
const use = (name: string, input: unknown): Block => ({ type: "tool_use", id: `tu_${++calls}`, name, input }) as Block;
const turn = (content: Block[]): Message =>
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
const scripted = (turns: Message[]): AnalystModel => ({
  async create() {
    const next = turns.shift();
    if (!next) throw new Error("The script ran out: the loop asked for a turn the test did not expect.");
    return next;
  },
});
const give = (paragraphs: { text: string; sources: string[] }[], limits: string[] = []) =>
  use("give_answer", { paragraphs, assumptions: [], limits, follow_ups: [], focus_sites: [] });

const OPEN_NOW = { question: "What is open right now, and where?", looking: "reality" as const };

test("asked what is open right now, the analyst answers from the alert list, citing its step, every figure traced", async () => {
  const model = scripted([
    turn([use("list_alerts", {})]),
    turn([
      give(
        [
          { text: "Three alerts are open. The worst is at Chirurgie: occupancy is at 100 %, the alert has been open for 3 h, and the value was read 37 min ago. Its signal is at Triage, step 1 of 4.", sources: ["s1"] },
          { text: "Hôpital du Lac is at 57 %, a value read at least 2 h ago because one of its sources published no time. At Médecine the value is 33 % and its age is unknown.", sources: ["s1"] },
        ],
        ["This is what is open now: I cannot read what was open earlier."],
      ),
    ]),
  ]);
  const out = await ask(model, ctxOf(live()), OPEN_NOW);

  assert.equal(out.status, "answered");
  assert.equal(out.verified, true);
  assert.deepEqual(out.struck, []);
  assert.deepEqual(
    out.steps.map((s) => [s.id, s.tool, s.ok]),
    [["s1", "list_alerts", true]],
  );
  assert.deepEqual(
    out.answer!.paragraphs.map((p) => p.sources),
    [["s1"], ["s1"]],
  );
  assert.match(out.answer!.paragraphs[0]!.text, /100 %.*open for 3 h.*read 37 min ago/);
});

test("a live figure the alert list does not hold is taken out of the answer", async () => {
  const wrong = () => turn([give([{ text: "Chirurgie is at 100 % and Médecine is at 41 %.", sources: ["s1"] }])]);
  // Sent back twice, then delivered with the figure nobody could trace struck from it.
  const out = await ask(scripted([turn([use("list_alerts", {})]), wrong(), wrong(), wrong()]), ctxOf(live()), OPEN_NOW);
  assert.equal(out.status, "answered");
  assert.equal(out.verified, false);
  assert.deepEqual(out.struck.flatMap((f) => f.figures), ["41 %"]);
  assert.doesNotMatch(out.answer!.paragraphs[0]!.text, /41/);
  assert.match(out.answer!.paragraphs[0]!.text, /100 %/);
});
