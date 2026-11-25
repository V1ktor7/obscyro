import assert from "node:assert/strict";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { ANALYST_MODEL, ask, type AnalystModel } from "./analyst.js";
import { READ_TOOLS, ToolError, type AnalystContext } from "./analyst-tools.js";
import { Ledger } from "./analyst-verify.js";
import {
  RESULT_MAX_CHARS,
  functionKeyFrom,
  functionTypeDraft,
  inputParser,
  missingForFunction,
  readFunctionDraft,
  runFunction,
  toolOf,
  type FunctionOffer,
  type FunctionReads,
  type FunctionType,
  type ObjectRead,
  type Stand,
} from "./function-types.js";

/**
 * A reading tool declared from the Studio.
 *
 * The twin here is small: six ventilators at three sites, some in use, and a
 * few beds. What is under test is that a declaration becomes a tool, that each
 * of the five blocks reads what it says it reads, and that what a declared
 * tool returns is held to the same rule as any other: a figure it did not
 * return does not stay in an answer.
 */
const vent = (id: string, site: string, status: string, flow: number | null = 40): ObjectRead => ({ id, typeName: "Ventilator", properties: { site, status, flow_l_min: flow, model: "V60" } });
const VENTILATORS = [
  vent("v1", "Lakeshore", "available"),
  vent("v2", "Lakeshore", "in use", 60),
  vent("v3", "Nord", "available", 50),
  vent("v4", "Nord", "Available", 30),
  vent("v5", "Nord", "in use"),
  vent("v6", "Est", "maintenance", null),
];
const BEDS: ObjectRead[] = [
  { id: "b1", typeName: "Bed", properties: { site: "Lakeshore", staffed: 20, closed: 4 } },
  { id: "b2", typeName: "Bed", properties: { site: "Nord", staffed: 40, closed: 0 } },
];
const NOW = new Date("2026-11-25T18:00:00.000Z");

// Where the ventilators stand: two emergency departments carry one name, under two hospitals,
// both hospitals are housed in one building, and one ventilator is attached to nothing.
const ED_CHUM: Stand = { id: "u-ed-chum", name: "Emergency", under: "CHUM" };
const ED_ND: Stand = { id: "u-ed-nd", name: "Emergency", under: "Notre-Dame" };
const ICU: Stand = { id: "u-icu", name: "Intensive care", under: "CHUM" };
const UNIT_OF: Record<string, Stand> = { v1: ED_CHUM, v2: ED_CHUM, v3: ED_ND, v4: ICU, v5: ICU };
const SITE_OF: Record<string, Stand> = { v1: { id: "p-1", name: "1051 Sanguinet" }, v2: { id: "p-1", name: "1051 Sanguinet" }, v3: { id: "p-2", name: "1560 Sherbrooke" }, v4: { id: "p-1", name: "1051 Sanguinet" }, v5: { id: "p-1", name: "1051 Sanguinet" } };

function reads(over: Partial<FunctionReads> = {}): FunctionReads & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async objects(type) {
      asked.push(type);
      return { rows: type === "Ventilator" ? VENTILATORS : type === "Bed" ? BEDS : [], capped: false };
    },
    units: async () => [
      { id: "u-chum", name: "CHUM" },
      { id: "u-nd", name: "Notre-Dame" },
    ],
    async standing() {
      asked.push("standing");
      return { unitOf: (id) => UNIT_OF[id] ?? null, siteOf: (id) => SITE_OF[id] ?? null, partial: false };
    },
    metrics: async () => [{ key: "occupancy", label: "Stretcher occupancy" }],
    async history(unitId, metric, from) {
      asked.push(`${unitId}|${metric}|${from.toISOString()}`);
      return {
        opening: { value: 110, observedAt: null, observedBasis: null, recordedAt: "2026-11-24T10:00:00.000Z" },
        readings: [
          { value: 124, observedAt: "2026-11-25T10:00:00.000Z", observedBasis: null, recordedAt: "2026-11-25T10:04:00.000Z" },
          { value: null, observedAt: null, observedBasis: null, recordedAt: "2026-11-25T12:00:00.000Z" },
          { value: 137, observedAt: "2026-11-25T16:00:00.000Z", observedBasis: null, recordedAt: "2026-11-25T16:04:00.000Z" },
        ],
        cut: false,
        since: "2026-11-22T21:43:00.000Z",
      };
    },
    datasets: async () => [{ id: "d1", name: "INSPQ admissions", slug: "inspq-admissions", columns: ["date", "region", "admissions"] }],
    rows: async () => ({
      rows: [
        { date: "2022-01-03", region: "Montréal", admissions: 143 },
        { date: "2022-01-03", region: "Laval", admissions: 31 },
        { date: "2022-01-04", region: "Montréal", admissions: 158 },
      ],
      capped: false,
    }),
    ...over,
  };
}

const NONE = new Set<string>();
const draft = (over: Record<string, unknown>) =>
  functionTypeDraft.parse({ label: "Ventilators available by site", description: "The ventilators that are free, at each site. Use it before proposing a transfer of ventilated patients.", inputs: [], ...over });
const declare = (key: string, over: Record<string, unknown>): FunctionType => readFunctionDraft(key, draft(over), NONE);
const refused = (re: RegExp) => (err: unknown) => err instanceof ToolError && re.test(err.message);
const invalid = (re: RegExp) => (err: unknown) => (err as { code?: string }).code === "FUNCTION_TYPE_INVALID" && re.test((err as Error).message);

const BY_SITE = { block: "aggregate", config: { type: "Ventilator", where: [{ property: "status", equals: { value: "available" } }], agg: "count", groupBy: { value: "site" }, as: "ventilators_available" } };

// --- the blocks -----------------------------------------------------------------

test("an aggregate counts what matches, by group, the largest first", async () => {
  const out = await runFunction(declare("ventilators_available_by_site", BY_SITE), {}, reads());
  assert.deepEqual(out, {
    by: "site",
    groups: [
      { site: "Nord", ventilators_available: 2 },
      { site: "Lakeshore", ventilators_available: 1 },
      // A site with none available is a real answer: zero, not left out.
      { site: "Est", ventilators_available: 0 },
    ],
    groups_returned: 3,
    groups_in_all: 3,
    objects_read: 6,
    read_from: "the twin's objects of type Ventilator",
  });
});

test("an aggregate without a group is one value, and a mean of nothing is no value rather than a zero", async () => {
  const one = declare("ventilator_flow", { block: "aggregate", config: { type: "Ventilator", agg: "mean", property: "flow_l_min", as: "mean_flow_l_min" } });
  assert.deepEqual(await runFunction(one, {}, reads()), { mean_flow_l_min: 44, objects_read: 6, read_from: "the twin's objects of type Ventilator" });
  const none = declare("flow_at_est", { block: "aggregate", config: { type: "Ventilator", where: [{ property: "site", equals: { value: "Est" } }], agg: "sum", property: "flow_l_min", as: "flow_l_min" } });
  assert.equal((await runFunction(none, {}, reads())).flow_l_min, null);
});

test("an input feeds a filter, and one left out does not filter", async () => {
  const t = declare("ventilators_at", {
    inputs: [{ name: "site", kind: "text", required: false, says: "The site's name." }],
    block: "aggregate",
    config: { type: "Ventilator", where: [{ property: "site", equals: { input: "site" } }, { property: "status", equals: { value: "available" } }], agg: "count", as: "ventilators_available" },
  });
  assert.equal((await runFunction(t, { site: "nord" }, reads())).ventilators_available, 2);
  assert.equal((await runFunction(t, {}, reads())).ventilators_available, 3);
});

test("an input chooses the group, among the properties the declaration allows", async () => {
  const t = declare("ventilators_by", {
    inputs: [{ name: "by", kind: "choice", says: "What to group by.", choices: ["site", "status"] }],
    block: "aggregate",
    config: { type: "Ventilator", agg: "count", groupBy: { input: "by" }, as: "ventilators" },
  });
  const out = (await runFunction(t, { by: "status" }, reads())) as { groups: Record<string, unknown>[] };
  assert.deepEqual(out.groups, [{ status: "available", ventilators: 2 }, { status: "in use", ventilators: 2 }, { status: "Available", ventilators: 1 }, { status: "maintenance", ventilators: 1 }]);
});

test("an aggregate by unit counts each object where it is attached, and keeps apart two units of one name", async () => {
  const t = declare("ventilators_by_unit", { block: "aggregate", config: { type: "Ventilator", agg: "count", groupBy: { of: "unit" }, as: "ventilators" } });
  const r = reads();
  assert.deepEqual(await runFunction(t, {}, r), {
    by: "unit",
    groups: [
      { unit: "Emergency", under: "CHUM", ventilators: 2 },
      { unit: "Intensive care", under: "CHUM", ventilators: 2 },
      { unit: "(attached to no unit)", ventilators: 1 },
      { unit: "Emergency", under: "Notre-Dame", ventilators: 1 },
    ],
    groups_returned: 4,
    groups_in_all: 4,
    objects_read: 6,
    grouped_how: "Each object is counted at the unit it is attached to, not at the units above it.",
    read_from: "the twin's objects of type Ventilator",
  });
  // Where things stand is read only when a tool groups by it.
  assert.deepEqual(r.asked, ["Ventilator", "standing"]);
  const plain = reads();
  await runFunction(declare("ventilators_available_by_site", BY_SITE), {}, plain);
  assert.deepEqual(plain.asked, ["Ventilator"]);
});

test("an aggregate by site counts each object at the site of its unit, with the filter of the declaration", async () => {
  const t = declare("flow_by_site", { block: "aggregate", config: { type: "Ventilator", where: [{ property: "status", equals: { value: "available" } }], agg: "sum", property: "flow_l_min", groupBy: { of: "site" }, as: "flow_l_min_available" } });
  const out = await runFunction(t, {}, reads());
  assert.deepEqual(out.groups, [
    { site: "1051 Sanguinet", flow_l_min_available: 70 },
    { site: "1560 Sherbrooke", flow_l_min_available: 50 },
    // v6 stands at no site and carries no flow: no value, so no line, rather than a zero.
  ]);
  assert.equal(out.grouped_how, "Each object is counted at the site where its unit stands, or at itself when it is a site.");
  // A read of the sites that reached its ceiling is said: "at no site" may only mean "not read".
  const partial = await runFunction(t, {}, reads({ standing: async () => ({ unitOf: () => null, siteOf: () => null, partial: true }) }));
  assert.match(partial.grouping_limit as string, /an object may be listed at none for that reason alone/);
});

test("a result too long to be read at once is refused with what to narrow, not cut", async () => {
  const long = "x".repeat(900);
  const many: ObjectRead[] = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, typeName: "Note", properties: { text: long } }));
  const t = declare("notes_listed", { block: "objects", config: { type: "Note", fields: [{ property: "text", as: "text" }], limit: 50 } });
  await assert.rejects(runFunction(t, {}, reads({ objects: async () => ({ rows: many, capped: false }) })), refused(new RegExp(`too long to be read at once: \\d+ characters, where the most is ${RESULT_MAX_CHARS}\\. Narrow it with a filter`)));
  // The same tool on fewer rows answers.
  const few = await runFunction(t, {}, reads({ objects: async () => ({ rows: many.slice(0, 5), capped: false }) }));
  assert.equal(few.objects_returned, 5);
});

test("objects are listed with the fields declared, under names that say their unit, and no more than the limit", async () => {
  const t = declare("ventilators_listed", {
    block: "objects",
    config: { type: "Ventilator", where: [{ property: "site", equals: { value: "Nord" } }], fields: [{ property: "status", as: "status" }, { property: "flow_l_min", as: "flow_litres_per_minute" }], limit: 2 },
  });
  assert.deepEqual(await runFunction(t, {}, reads()), {
    objects: [
      { status: "available", flow_litres_per_minute: 50 },
      { status: "Available", flow_litres_per_minute: 30 },
    ],
    objects_returned: 2,
    objects_matching: 3,
    note: "Only the first 2 are listed. Narrow the filter to read the others.",
    read_from: "the twin's objects of type Ventilator",
  });
});

test("a formula is computed by the calculator from named values, and says what it was computed from", async () => {
  const t = declare("share_of_beds_closed", {
    inputs: [{ name: "per", kind: "number", says: "The base of the share, 100 for a percentage.", min: 1, max: 1000 }],
    block: "formula",
    config: {
      values: [
        { name: "closed", type: "Bed", agg: "sum", property: "closed" },
        { name: "staffed", type: "Bed", agg: "sum", property: "staffed" },
      ],
      expression: "round(closed / (closed + staffed) * per, 1)",
      as: "beds_closed_per_base",
    },
  });
  assert.deepEqual(await runFunction(t, { per: 100 }, reads()), {
    beds_closed_per_base: 6.3,
    computed_from: { closed: 4, staffed: 60, per: 100 },
    formula: "round(closed / (closed + staffed) * per, 1)",
    read_from: "a formula over the twin's objects",
  });
});

test("a formula with a value missing is refused, not computed on a zero", async () => {
  const t = declare("flow_per_ventilator", {
    block: "formula",
    config: { values: [{ name: "flow", type: "Ventilator", where: [{ property: "site", equals: { value: "Est" } }], agg: "sum", property: "flow_l_min" }], expression: "flow / 2", as: "half_flow" },
  });
  await assert.rejects(runFunction(t, {}, reads()), refused(/"flow" has no value here.*The formula was not evaluated, and nothing stands in for the missing value/));
});

test("a history is read for a unit named in the call, over the window declared", async () => {
  const t = declare("occupancy_history", {
    inputs: [{ name: "unit", kind: "text", says: "The unit's name." }, { name: "hours", kind: "number", says: "How far back, in hours.", min: 1, max: 72 }],
    block: "history",
    config: { metric: "occupancy", unit: { input: "unit" }, hours: { input: "hours" } },
  });
  const r = reads();
  const out = await runFunction(t, { unit: "chum", hours: 24 }, r, NOW);
  assert.deepEqual(r.asked, ["u-chum|occupancy|2026-11-24T18:00:00.000Z"]);
  assert.deepEqual(
    { ...out, readings: (out.readings as unknown[]).length, how_to_read: undefined },
    {
      unit: "CHUM",
      measure: "Stretcher occupancy",
      over_the_last_hours: 24,
      readings_kept: 3,
      lowest: 110,
      highest: 137,
      latest: 137,
      history_starts_at: "2026-11-22T21:43:00.000Z",
      readings: 4,
      how_to_read: undefined,
      read_from: "the readings the twin kept",
    },
  );
  assert.match(out.how_to_read as string, /A reading with no value is a gap, not a zero/);
});

test("a history says what cannot be read: a unit it does not find, a measure the twin does not keep", async () => {
  const t = declare("occupancy_history", { inputs: [{ name: "unit", kind: "text", says: "The unit's name." }], block: "history", config: { metric: "occupancy", unit: { input: "unit" }, hours: 24 } });
  await assert.rejects(runFunction(t, { unit: "Verdun" }, reads(), NOW), refused(/Verdun/));
  const linked = declare("linked_history", { block: "history", config: { metric: "linkedInstanceCount", unit: { value: "CHUM" }, hours: 24 } });
  await assert.rejects(runFunction(linked, {}, reads(), NOW), refused(/The twin keeps no history of "linkedInstanceCount": only the measures the organisation defined are kept\. They are: occupancy\./));
});

test("a dataset is read by its name or its slug, filtered, with the columns declared", async () => {
  const t = declare("admissions_by_day", {
    inputs: [{ name: "region", kind: "text", required: false, says: "The region." }],
    block: "dataset",
    config: { dataset: "inspq-admissions", columns: ["date", "admissions"], where: [{ column: "region", equals: { input: "region" } }], limit: 10 },
  });
  assert.deepEqual(await runFunction(t, { region: "montréal" }, reads()), {
    dataset: "INSPQ admissions",
    rows: [
      { date: "2022-01-03", admissions: 143 },
      { date: "2022-01-04", admissions: 158 },
    ],
    rows_returned: 2,
    rows_matching: 2,
    read_from: "the dataset INSPQ admissions",
  });
  const wrong = declare("deaths", { block: "dataset", config: { dataset: "INSPQ admissions", columns: ["deaths"] } });
  await assert.rejects(runFunction(wrong, {}, reads()), refused(/has no column called "deaths"\. Its columns are: date, region, admissions\./));
  const gone = declare("gone", { block: "dataset", config: { dataset: "wastewater", columns: ["date"] } });
  await assert.rejects(runFunction(gone, {}, reads()), refused(/holds no dataset called "wastewater"\. Its datasets are: INSPQ admissions\./));
});

test("a read that reached its ceiling says so, and does not pass for the whole", async () => {
  const out = await runFunction(declare("ventilators_available_by_site", BY_SITE), {}, reads({ objects: async () => ({ rows: VENTILATORS, capped: true }) }));
  assert.match(out.limit as string, /more objects of this type than one read takes: this rests on the first of them, not on all/);
});

// --- the declaration ------------------------------------------------------------

test("a declaration is refused with what to correct", () => {
  assert.throws(() => declare("Ventilators", BY_SITE), invalid(/cannot be a tool's name/));
  assert.throws(() => readFunctionDraft("describe_twin", draft(BY_SITE), new Set(READ_TOOLS.map((t) => t.name))), invalid(/"describe_twin" is already the name of one of the analyst's own tools/));
  assert.throws(() => declare("x_fn", { block: "aggregate", config: { type: "Ventilator", agg: "sum", as: "flow" } }), invalid(/needs the property it is taken over\. Only a count needs none/));
  assert.throws(() => declare("x_fn", { block: "aggregate", config: { type: "Ventilator", where: [{ property: "site", equals: { input: "site" } }], agg: "count", as: "n" } }), invalid(/The filter on site takes the input "site", which this function does not declare/));
  assert.throws(
    () => declare("x_fn", { inputs: [{ name: "by", kind: "text", says: "Group." }], block: "aggregate", config: { type: "Ventilator", agg: "count", groupBy: { input: "by" }, as: "n" } }),
    invalid(/The group needs an input of kind choice: "by" is a text/),
  );
  assert.throws(() => declare("x_fn", { inputs: [{ name: "by", kind: "choice", says: "Group." }], block: "aggregate", config: { type: "Ventilator", agg: "count", as: "n" } }), invalid(/"by" is a choice among a list, and the list is empty/));
  assert.throws(() => declare("x_fn", { block: "objects", config: { type: "Ventilator", fields: [{ property: "site", as: "x" }, { property: "status", as: "x" }] } }), invalid(/Two returned fields have the same name/));
  // A group is returned under its own name beside the value: the two cannot share one.
  assert.throws(() => declare("x_fn", { block: "aggregate", config: { type: "Ventilator", agg: "count", groupBy: { value: "site" }, as: "site" } }), invalid(/returned as "site", which is also the name its group is returned under/));
  assert.throws(() => declare("x_fn", { block: "aggregate", config: { type: "Ventilator", agg: "count", groupBy: { of: "unit" }, as: "under" } }), invalid(/returned as "under"/));
  assert.throws(() => declare("x_fn", { block: "aggregate", config: { type: "Ventilator", agg: "count", groupBy: { of: "building" }, as: "n" } }), invalid(/The block cannot be read/));
  assert.throws(() => declare("x_fn", { block: "objects", config: { type: "Ventilator", fields: [{ property: "site", as: "site" }], limit: 500 } }), invalid(/The block cannot be read: limit/));
  assert.throws(() => declare("x_fn", { block: "history", config: { metric: "occupancy", unit: { value: "CHUM" }, hours: 99_999 } }), invalid(/The block cannot be read/));
});

test("a formula is checked when it is declared: a name it does not have, or arithmetic that cannot be read", () => {
  const formula = (expression: string) => ({ block: "formula", config: { values: [{ name: "closed", type: "Bed", agg: "sum", property: "closed" }], expression, as: "share" } });
  assert.throws(() => declare("x_fn", formula("closed / staffed")), invalid(/The formula cannot be evaluated:.*It may name: closed\./));
  assert.throws(() => declare("x_fn", formula("closed +")), invalid(/The formula cannot be evaluated/));
  assert.doesNotThrow(() => declare("x_fn", formula("closed * 2")));
});

test("a tool's name is made from its label, and never taken twice", () => {
  assert.equal(functionKeyFrom("Ventilators available by site", NONE), "ventilators_available_by_site");
  assert.equal(functionKeyFrom("Lits fermés, faute de personnel", NONE), "lits_fermes_faute_de_personnel");
  assert.equal(functionKeyFrom("Describe twin", new Set(["describe_twin"])), "describe_twin_2");
  assert.equal(functionKeyFrom("3 A", NONE), "a_fn");
  assert.equal(functionKeyFrom("???", NONE), "function");
});

// --- the tool the analyst is given --------------------------------------------------

test("a declared function becomes a tool: its schema from its inputs, its label for the trace", () => {
  const t = declare("ventilators_at", {
    inputs: [
      { name: "site", kind: "text", required: false, says: "The site's name." },
      { name: "hours", kind: "number", says: "How far back.", min: 1, max: 72 },
      { name: "by", kind: "choice", says: "What to group by.", choices: ["site", "status"] },
      { name: "since", kind: "date", required: false, says: "The first day." },
    ],
    block: "aggregate",
    config: { type: "Ventilator", where: [{ property: "site", equals: { input: "site" } }], agg: "count", groupBy: { input: "by" }, as: "n" },
  });
  const tool = toolOf(t, reads());
  assert.equal(tool.name, "ventilators_at");
  assert.equal(tool.label, "Ventilators available by site");
  assert.match(tool.description, /Use it before proposing a transfer.*A reading tool declared in this project.*It only reads/);
  assert.deepEqual(tool.input_schema, {
    type: "object",
    properties: {
      site: { type: "string", description: "The site's name." },
      hours: { type: "number", description: "How far back. Between 1 and 72." },
      by: { type: "string", description: "What to group by.", enum: ["site", "status"] },
      since: { type: "string", description: "The first day. Written YYYY-MM-DD." },
    },
    required: ["hours", "by"],
    additionalProperties: false,
  });
});

test("an input outside its bounds is refused with the bound", () => {
  const parse = inputParser([
    { name: "hours", kind: "number", required: true, says: "x", min: 1, max: 72, choices: [] },
    { name: "by", kind: "choice", required: true, says: "x", min: null, max: null, choices: ["site", "status"] },
    { name: "since", kind: "date", required: false, says: "x", min: null, max: null, choices: [] },
  ]);
  const said = (input: unknown) => {
    const r = parse.safeParse(input);
    return r.success ? null : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  };
  assert.equal(said({ hours: 24, by: "site" }), null);
  assert.equal(said({ hours: 200, by: "site" }), "hours: 200 is above the most allowed, 72");
  assert.equal(said({ hours: 0, by: "site" }), "hours: 0 is below the least allowed, 1");
  assert.equal(said({ hours: 24, by: "model" }), 'by: "model" is not one of: site, status');
  assert.equal(said({ hours: 24, by: "site", since: "yesterday" }), "since: a date is written YYYY-MM-DD");
  // Nothing the declaration does not name can be passed.
  assert.match(said({ hours: 24, by: "site", sql: "drop table" })!, /Unrecognized key/);
});

// --- in an exchange -------------------------------------------------------------------

type Message = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;
const reply = (content: Block[], stop: Message["stop_reason"]): Message =>
  ({ id: "msg", type: "message", role: "assistant", model: ANALYST_MODEL, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }) as unknown as Message;
const use = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input }) as Block;
function scripted(turns: Message[]): AnalystModel & { tools: string[][] } {
  const tools: string[][] = [];
  return {
    tools,
    async create(params) {
      tools.push((params.tools ?? []).map((t) => (t as { name: string }).name));
      const next = turns.shift();
      if (!next) throw new Error("The script ran out.");
      return next;
    },
  };
}
const ctx = (): AnalystContext => {
  const never = async (): Promise<never> => {
    throw new ToolError("Not read in this test.");
  };
  return { environment: "mtl", scenario: null, run: null, known: new Ledger(), world: never, datasets: never, rows: never, events: never, live: never };
};
const answer = (text: string, sources: string[]) => reply([use("tu_a", "give_answer", { paragraphs: [{ text, sources }], assumptions: [], limits: [], follow_ups: [], focus_sites: [] })], "tool_use");

test("in an exchange, a declared tool is offered beside the others, its step carries its label, and its figures hold in the answer", async () => {
  const tool = toolOf(declare("ventilators_available_by_site", BY_SITE), reads());
  const model = scripted([reply([use("tu_1", "ventilators_available_by_site", {})], "tool_use"), answer("Nord has 2 ventilators available and Lakeshore has 1.", ["s1"])]);
  const out = await ask(model, ctx(), { question: "Where are ventilators free?", looking: "reality", focus: null }, () => {}, [...READ_TOOLS, tool]);

  assert.ok(model.tools[0]!.includes("ventilators_available_by_site"));
  assert.ok(model.tools[0]!.includes("describe_twin"));
  assert.equal(out.status, "answered");
  assert.deepEqual([out.steps[0]!.tool, out.steps[0]!.label, out.steps[0]!.ok], ["ventilators_available_by_site", "Ventilators available by site", true]);
  // A tool written in the code carries no label of its own: the screen names it.
  assert.equal(out.verified, true);
  assert.match(out.answer!.paragraphs[0]!.text, /Nord has 2 ventilators available/);
});

test("a figure the declared tool did not return is taken out of the answer, as for any tool", async () => {
  const tool = toolOf(declare("ventilators_available_by_site", BY_SITE), reads());
  const wrong = () => answer("Nord has 17 ventilators available.", ["s1"]);
  const model = scripted([reply([use("tu_1", "ventilators_available_by_site", {})], "tool_use"), wrong(), wrong(), wrong()]);
  const out = await ask(model, ctx(), { question: "Where are ventilators free?", looking: "reality", focus: null }, () => {}, [...READ_TOOLS, tool]);
  assert.equal(out.verified, false);
  assert.ok(out.struck.length > 0);
  assert.ok(!out.answer!.paragraphs[0]!.text.includes("17"));
});

test("a refusal of a declared tool is a refused step the model reads, not a fault", async () => {
  const t = declare("occupancy_history", { inputs: [{ name: "unit", kind: "text", says: "The unit's name." }], block: "history", config: { metric: "occupancy", unit: { input: "unit" }, hours: 24 } });
  const model = scripted([reply([use("tu_1", "occupancy_history", { unit: "Verdun" })], "tool_use"), answer("That unit could not be found, so its history was not read.", ["s1"])]);
  const out = await ask(model, ctx(), { question: "How did Verdun do?", looking: "reality", focus: null }, () => {}, [...READ_TOOLS, toolOf(t, reads())]);
  assert.equal(out.steps[0]!.ok, false);
  assert.match((out.steps[0]!.output as { error: string }).error, /Verdun/);
});

// --- can it run on this project? ------------------------------------------------------

const OFFER: FunctionOffer = {
  objectTypes: [{ name: "Ventilator", properties: ["site", "status", "flow_l_min"] }, { name: "Bed", properties: ["site", "staffed", "closed"] }],
  metrics: [{ key: "occupancy", label: "Stretcher occupancy" }],
  datasets: [{ id: "d1", name: "INSPQ admissions", slug: "inspq-admissions", columns: ["date", "region", "admissions"] }],
};

test("a function type that points at what the project holds can run", () => {
  assert.equal(missingForFunction(declare("ventilators_available_by_site", BY_SITE), OFFER), null);
  assert.equal(missingForFunction(declare("h_fn", { block: "history", config: { metric: "occupancy", unit: { value: "CHUM" }, hours: 24 } }), OFFER), null);
  assert.equal(missingForFunction(declare("d_fn", { block: "dataset", config: { dataset: "INSPQ admissions", columns: ["date"] } }), OFFER), null);
});

test("a function type that points at something the project does not hold says what is missing", () => {
  const agg = (config: Record<string, unknown>) => declare("x_fn", { block: "aggregate", config: { agg: "count", as: "n", ...config } });
  assert.match(missingForFunction(agg({ type: "Respirator" }), OFFER)!, /The ontology has no object type called "Respirator"/);
  assert.match(missingForFunction(agg({ type: "Ventilator", where: [{ property: "state", equals: { value: "x" } }] }), OFFER)!, /The type Ventilator declares no property called "state"/);
  assert.match(missingForFunction(agg({ type: "Ventilator", groupBy: { value: "ward" } }), OFFER)!, /declares no property called "ward"/);
  assert.match(missingForFunction(declare("h_fn", { block: "history", config: { metric: "stay", unit: { value: "CHUM" }, hours: 24 } }), OFFER)!, /The twin keeps no history of "stay"/);
  assert.match(missingForFunction(declare("d_fn", { block: "dataset", config: { dataset: "wastewater", columns: ["date"] } }), OFFER)!, /holds no dataset called "wastewater"/);
  assert.match(missingForFunction(declare("d_fn", { block: "dataset", config: { dataset: "inspq-admissions", columns: ["deaths"] } }), OFFER)!, /has no column called "deaths"/);
  const formula = declare("f_fn", { block: "formula", config: { values: [{ name: "a", type: "Stock", agg: "count" }], expression: "a * 2", as: "double" } });
  assert.match(missingForFunction(formula, OFFER)!, /no object type called "Stock"/);
});
