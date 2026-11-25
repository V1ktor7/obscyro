import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { CalcError, evaluate } from "./analyst-calc.js";
import { ToolError, obj, pick, type AnalystTool } from "./analyst-tools.js";
import { aggregate, type MetricInstance } from "./twin-metrics.js";
import type { ReadingsBetween } from "./twin-history.js";

// ---------------------------------------------------------------------------
// Function types: a reading tool of the analyst, declared from the Studio.
//
// The analyst's tools are code. An institution that wants it to read something
// of its own (ventilators available by site, beds closed for want of staff)
// had to wait for a developer. A function type is a reading tool the project
// declares itself.
//
// It is not code. It is one of five blocks the program already knows how to
// run, set by a person:
//
//   objects    the objects of a type, filtered, with the properties to return;
//   aggregate  a count, sum, mean, minimum or maximum over them, by group:
//              a property, the unit each object is attached to, or its site;
//   formula    a calculation of the calculator over named aggregates;
//   history    the readings the twin kept of a measure at a unit;
//   dataset    columns of a dataset of the project, filtered.
//
// An input of the tool can feed a filter, a group or a period of its block.
//
// A declared tool is a tool like the others: the model is given its schema,
// what it returns is a step, and every figure in an answer is checked against
// the steps it cites. A figure it did not return is taken out, as for any tool.
//
// It only reads. No block writes, none calls another service, and none runs
// what a person typed as code: an expression is evaluated by the calculator,
// which knows arithmetic and nothing else.
// ---------------------------------------------------------------------------

export const BLOCKS = ["objects", "aggregate", "formula", "history", "dataset"] as const;
export type Block = (typeof BLOCKS)[number];

/** Rows a tool returns at most: the model reads them, it does not page through a table. */
export const ROWS_MAX = 50;
/** Groups an aggregate returns at most, the largest first. */
export const GROUPS_MAX = 50;
/** Named values a formula may be built on. */
export const VALUES_MAX = 6;
/** Readings of a history returned at most, the latest ones. */
export const POINTS_MAX = 60;
/** The longest history read, in hours: what the twin's own history route allows. */
export const HOURS_MAX = 24 * 90;
export const INPUTS_MAX = 6;
/** The longest result a tool returns, in characters of JSON. Beyond it the call is refused, with what to narrow. */
export const RESULT_MAX_CHARS = 24_000;

const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const name = z.string().regex(NAME, "lower-case letters, digits and underscores, starting with a letter");

/** A value written in the declaration, or taken from one of the tool's inputs. */
const slot = z.union([z.object({ value: z.string().trim().min(1).max(300) }).strict(), z.object({ input: name }).strict()]);
export type Slot = z.infer<typeof slot>;

const input = z.object({
  name,
  kind: z.enum(["text", "number", "date", "choice"]),
  required: z.boolean().default(true),
  /** What it is for: read by the model, and by a person. */
  says: z.string().trim().min(1).max(300),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  choices: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
});
export type FunctionInput = z.infer<typeof input>;

/** Where an object stands in the twin: the unit it is attached to, or the site of that unit. */
const standingGroup = z.object({ of: z.enum(["unit", "site"]) }).strict();

const filter = z.object({ property: z.string().trim().min(1).max(120), equals: slot });
const agg = z.enum(["count", "sum", "mean", "min", "max"]);
const selection = { type: z.string().trim().min(1).max(200), where: z.array(filter).max(6).default([]) };

const configOf = {
  objects: z.object({
    ...selection,
    /** The properties returned, each under a field name that says what it is and in what unit. */
    fields: z.array(z.object({ property: z.string().trim().min(1).max(120), as: name })).min(1).max(12),
    limit: z.number().int().min(1).max(ROWS_MAX).default(20),
  }),
  aggregate: z.object({
    ...selection,
    agg,
    property: z.string().trim().min(1).max(120).nullable().default(null),
    /** What to group by: a property, written or taken from a choice input; the unit or the site each object stands at; null: one value. */
    groupBy: z.union([slot, standingGroup]).nullable().default(null),
    as: name,
  }),
  formula: z.object({
    values: z.array(z.object({ name, ...selection, agg, property: z.string().trim().min(1).max(120).nullable().default(null) })).min(1).max(VALUES_MAX),
    expression: z.string().trim().min(1).max(600),
    as: name,
  }),
  history: z.object({
    metric: z.string().trim().min(1).max(200),
    unit: slot,
    /** The window, in hours, written or taken from a number input. */
    hours: z.union([z.number().int().min(1).max(HOURS_MAX), z.object({ input: name }).strict()]),
  }),
  dataset: z.object({
    dataset: z.string().trim().min(1).max(200),
    columns: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    where: z.array(z.object({ column: z.string().trim().min(1).max(120), equals: slot })).max(6).default([]),
    limit: z.number().int().min(1).max(ROWS_MAX).default(20),
  }),
} as const;

export type ObjectsConfig = z.infer<(typeof configOf)["objects"]>;
export type AggregateConfig = z.infer<(typeof configOf)["aggregate"]>;
export type FormulaConfig = z.infer<(typeof configOf)["formula"]>;
export type HistoryConfig = z.infer<(typeof configOf)["history"]>;
export type DatasetConfig = z.infer<(typeof configOf)["dataset"]>;

interface Common {
  /** The tool's name, as the model calls it. */
  key: string;
  /** What the trace shows, in the institution's words. */
  label: string;
  /** What it reads and when to use it: read by the model. */
  description: string;
  inputs: FunctionInput[];
  active: boolean;
}
export type FunctionType =
  | (Common & { block: "objects"; config: ObjectsConfig })
  | (Common & { block: "aggregate"; config: AggregateConfig })
  | (Common & { block: "formula"; config: FormulaConfig })
  | (Common & { block: "history"; config: HistoryConfig })
  | (Common & { block: "dataset"; config: DatasetConfig });

/** What the Studio sends to write a function type. The key is in the address, never in the body. */
export const functionTypeDraft = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(10).max(600),
  inputs: z.array(input).max(INPUTS_MAX).default([]),
  block: z.enum(BLOCKS),
  config: z.record(z.unknown()),
  active: z.boolean().default(true),
});
export type FunctionTypeDraft = z.infer<typeof functionTypeDraft>;

const invalid = (message: string) => BadRequest("FUNCTION_TYPE_INVALID", message);

/** Every slot of a block's configuration that is fed by an input, with what it needs that input to be. */
function fedBy(t: FunctionType): { input: string; needs: FunctionInput["kind"][]; for: string }[] {
  const out: { input: string; needs: FunctionInput["kind"][]; for: string }[] = [];
  const from = (s: Slot | null | undefined, needs: FunctionInput["kind"][], what: string) => {
    if (s && "input" in s) out.push({ input: s.input, needs, for: what });
  };
  const anyKind: FunctionInput["kind"][] = ["text", "number", "date", "choice"];
  if (t.block === "objects" || t.block === "aggregate") {
    for (const f of t.config.where) from(f.equals, anyKind, `the filter on ${f.property}`);
    if (t.block === "aggregate" && t.config.groupBy && !("of" in t.config.groupBy)) from(t.config.groupBy, ["choice"], "the group");
  } else if (t.block === "formula") {
    for (const v of t.config.values) for (const f of v.where) from(f.equals, anyKind, `the filter on ${f.property}`);
  } else if (t.block === "history") {
    from(t.config.unit, ["text", "choice"], "the unit");
    if (typeof t.config.hours === "object") out.push({ input: t.config.hours.input, needs: ["number"], for: "the window in hours" });
  } else {
    for (const f of t.config.where) from(f.equals, anyKind, `the filter on ${f.column}`);
  }
  return out;
}

/**
 * A draft read as a function type, or a refusal that says what to correct.
 *
 * What is checked here needs no twin: the shape of the block, that every input
 * a slot names exists and is of a kind that slot can take, and that a formula
 * can be evaluated over the names it has. Whether the object type, the measure
 * or the dataset exists is said on screen, against the twin (`missingFor`).
 */
export function readFunctionDraft(key: string, draft: FunctionTypeDraft, reserved: ReadonlySet<string>): FunctionType {
  if (!NAME.test(key) || key.length < 3) throw invalid(`"${key}" cannot be a tool's name: lower-case letters, digits and underscores, three characters at least, starting with a letter.`);
  if (reserved.has(key)) throw invalid(`"${key}" is already the name of one of the analyst's own tools. Give this one another label.`);
  const parsed = configOf[draft.block].safeParse(draft.config);
  if (!parsed.success) throw invalid(`The block cannot be read: ${parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ")}.`);
  const t = { key, label: draft.label, description: draft.description, inputs: draft.inputs, block: draft.block, config: parsed.data, active: draft.active } as FunctionType;

  const seen = new Set<string>();
  for (const i of t.inputs) {
    if (seen.has(i.name)) throw invalid(`Two inputs are called "${i.name}". Give each its own name.`);
    seen.add(i.name);
    if (i.kind === "choice" && i.choices.length === 0) throw invalid(`The input "${i.name}" is a choice among a list, and the list is empty.`);
    if (i.kind === "number" && i.min !== null && i.max !== null && i.min > i.max) throw invalid(`On the input "${i.name}", the least (${i.min}) is above the most (${i.max}).`);
  }
  for (const use of fedBy(t)) {
    const fed = t.inputs.find((i) => i.name === use.input);
    if (!fed) throw invalid(`${use.for[0]!.toUpperCase()}${use.for.slice(1)} takes the input "${use.input}", which this function does not declare.`);
    if (!use.needs.includes(fed.kind)) throw invalid(`${use.for[0]!.toUpperCase()}${use.for.slice(1)} needs an input of kind ${use.needs.join(" or ")}: "${fed.name}" is a ${fed.kind}.`);
  }
  if (t.block === "objects") {
    const fields = t.config.fields.map((f) => f.as);
    if (new Set(fields).size !== fields.length) throw invalid("Two returned fields have the same name. Give each its own.");
  }
  if (t.block === "aggregate" && t.config.groupBy) {
    // A group is returned under its own name beside the value: the two cannot share one.
    const g = t.config.groupBy;
    const names = "of" in g ? [g.of, "under"] : "value" in g ? [g.value] : (t.inputs.find((i) => i.name === g.input)?.choices ?? []);
    if (names.includes(t.config.as)) throw invalid(`The value is returned as "${t.config.as}", which is also the name its group is returned under. Give the value another name.`);
  }
  if ((t.block === "aggregate" && t.config.agg !== "count" && !t.config.property) || (t.block === "formula" && t.config.values.some((v) => v.agg !== "count" && !v.property))) {
    throw invalid("A sum, a mean, a minimum or a maximum needs the property it is taken over. Only a count needs none.");
  }
  if (t.block === "formula") {
    const names = t.config.values.map((v) => v.name);
    if (new Set(names).size !== names.length) throw invalid("Two values of the formula have the same name. Give each its own.");
    const numeric = t.inputs.filter((i) => i.kind === "number").map((i) => i.name);
    try {
      // Evaluated once on stand-in values: a name the formula does not have, or arithmetic that cannot be read, is said now.
      evaluate(t.config.expression, Object.fromEntries([...names, ...numeric].map((n) => [n, 1])));
    } catch (err) {
      if (err instanceof CalcError) throw invalid(`The formula cannot be evaluated: ${err.message} It may name: ${[...names, ...numeric].join(", ")}.`);
      throw err;
    }
  }
  return t;
}

/** A tool's name from a label: `ventilators_available_by_site`. */
export function functionKeyFrom(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[_0-9]+|_+$/g, "")
      .slice(0, 40) || "function";
  const start = base.length < 3 ? `${base}_fn` : base;
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) if (!taken.has(`${start}_${n}`)) return `${start}_${n}`;
}

// --- what a block reads --------------------------------------------------------

export interface ObjectRead extends MetricInstance {
  id: string;
}

/** Where an object stands. `under` is the unit above a unit, when there is one. */
export interface Stand {
  id: string;
  name: string;
  under?: string | null;
}

/** Where the twin's objects stand, by the rules the unit pages and the map follow. */
export interface Standing {
  /** The unit an object is attached to; a unit stands at itself. Null: attached to none. */
  unitOf(objectId: string): Stand | null;
  /** The site where the object's unit stands, or the object itself when it is a site. Null: at none. */
  siteOf(objectId: string): Stand | null;
  /** A read behind this reached its ceiling: an object may be listed nowhere for that reason alone. */
  partial: boolean;
}

/** What the blocks read. Passed in, so a test can hand it rows and the route the database. */
export interface FunctionReads {
  /** The objects of a type, and whether the read reached its ceiling. */
  objects(type: string): Promise<{ rows: ObjectRead[]; capped: boolean }>;
  units(): Promise<{ id: string; name: string }[]>;
  /** Where each object stands: its unit and its site. Read once for an exchange. */
  standing(): Promise<Standing>;
  /** The measures the twin keeps over time: those the organisation defined. */
  metrics(): Promise<{ key: string; label: string }[]>;
  history(unitId: string, metric: string, from: Date, to: Date): Promise<ReadingsBetween>;
  datasets(): Promise<{ id: string; name: string; slug: string; columns: string[] }[]>;
  rows(datasetId: string): Promise<{ rows: Record<string, unknown>[]; capped: boolean }>;
}

type Given = Record<string, string | number | undefined>;

/** A slot's value for this call: what was written, or what the input was given. Null when an optional input was left out. */
function valueOf(s: Slot, given: Given): string | null {
  if ("value" in s) return s.value;
  const v = given[s.input];
  return v === undefined || v === "" ? null : String(v);
}

const same = (a: unknown, b: string): boolean => a !== null && a !== undefined && String(a).trim().toLowerCase() === b.trim().toLowerCase();

/** The filters that apply to this call: one fed by an input that was left out does not filter. */
function filtersOf(where: readonly { property: string; equals: Slot }[], given: Given): { property: string; equals: string }[] {
  return where.flatMap((f) => {
    const v = valueOf(f.equals, given);
    return v === null ? [] : [{ property: f.property, equals: v }];
  });
}

const CAPPED = "The twin holds more objects of this type than one read takes: this rests on the first of them, not on all.";

async function runObjects(c: ObjectsConfig, given: Given, reads: FunctionReads): Promise<Record<string, unknown>> {
  const { rows, capped } = await reads.objects(c.type);
  const where = filtersOf(c.where, given);
  const kept = rows.filter((r) => where.every((f) => same(r.properties[f.property], f.equals)));
  return {
    objects: kept.slice(0, c.limit).map((r) => Object.fromEntries(c.fields.map((f) => [f.as, r.properties[f.property] ?? null]))),
    objects_returned: Math.min(kept.length, c.limit),
    objects_matching: kept.length,
    ...(kept.length > c.limit ? { note: `Only the first ${c.limit} are listed. Narrow the filter to read the others.` } : {}),
    ...(capped ? { limit: CAPPED } : {}),
    read_from: `the twin's objects of type ${c.type}`,
  };
}

const NOWHERE = { unit: "(attached to no unit)", site: "(at no site)" } as const;
const GROUPED = {
  unit: "Each object is counted at the unit it is attached to, not at the units above it.",
  site: "Each object is counted at the site where its unit stands, or at itself when it is a site.",
} as const;

async function runAggregate(c: AggregateConfig, given: Given, reads: FunctionReads): Promise<Record<string, unknown>> {
  const { rows, capped } = await reads.objects(c.type);
  const sel = { ofType: c.type, where: filtersOf(c.where, given), agg: c.agg, property: c.property };
  const tail = { ...(capped ? { limit: CAPPED } : {}), read_from: `the twin's objects of type ${c.type}` };

  // What a row is grouped under: a key that keeps two groups apart, and what is shown of the group.
  let by: string | null;
  let groupOf: (r: ObjectRead) => { key: string; shown: Record<string, string> };
  let how: Record<string, string> = {};
  if (c.groupBy && "of" in c.groupBy) {
    const where = c.groupBy.of;
    const standing = await reads.standing();
    by = where;
    // Two units can carry one name: they are kept apart by what they are, and told apart by the unit above.
    groupOf = (r) => {
      const at = where === "unit" ? standing.unitOf(r.id) : standing.siteOf(r.id);
      return at ? { key: at.id, shown: { [where]: at.name, ...(at.under ? { under: at.under } : {}) } } : { key: "", shown: { [where]: NOWHERE[where] } };
    };
    how = {
      grouped_how: GROUPED[where],
      ...(standing.partial ? { grouping_limit: "The twin holds more than one read takes: an object may be listed at none for that reason alone." } : {}),
    };
  } else {
    const property = c.groupBy ? valueOf(c.groupBy, given) : null;
    by = property;
    groupOf = (r) => {
      const g = r.properties[property ?? ""];
      const label = g === null || g === undefined || String(g).trim() === "" ? "(not said)" : String(g).trim();
      return { key: label, shown: { [property ?? ""]: label } };
    };
  }
  if (by === null) return { [c.as]: aggregate(rows, sel), objects_read: rows.length, ...tail };

  const groups = new Map<string, { shown: Record<string, string>; members: ObjectRead[] }>();
  for (const r of rows) {
    const g = groupOf(r);
    const held = groups.get(g.key);
    if (held) held.members.push(r);
    else groups.set(g.key, { shown: g.shown, members: [r] });
  }
  const name = by;
  const valued = [...groups.values()]
    .map((g): Record<string, string | number | null> => ({ ...g.shown, [c.as]: aggregate(g.members, sel) }))
    .filter((g) => g[c.as] !== null)
    .sort((a, b) => Number(b[c.as]) - Number(a[c.as]) || String(a[name]).localeCompare(String(b[name])));
  return {
    by,
    groups: valued.slice(0, GROUPS_MAX),
    groups_returned: Math.min(valued.length, GROUPS_MAX),
    groups_in_all: valued.length,
    objects_read: rows.length,
    ...how,
    ...tail,
  };
}

async function runFormula(c: FormulaConfig, given: Given, reads: FunctionReads, inputs: readonly FunctionInput[]): Promise<Record<string, unknown>> {
  const values: Record<string, number> = {};
  let capped = false;
  for (const v of c.values) {
    const read = await reads.objects(v.type);
    capped ||= read.capped;
    const got = aggregate(read.rows, { ofType: v.type, where: filtersOf(v.where, given), agg: v.agg, property: v.property });
    if (got === null) throw new ToolError(`"${v.name}" has no value here: no object of type ${v.type} that matches carries ${v.property ?? "anything to count"}. The formula was not evaluated, and nothing stands in for the missing value.`);
    values[v.name] = got;
  }
  for (const i of inputs) if (i.kind === "number" && typeof given[i.name] === "number") values[i.name] = given[i.name] as number;
  try {
    const out = evaluate(c.expression, values);
    return { [c.as]: out.value, computed_from: out.used, formula: c.expression, ...(capped ? { limit: CAPPED } : {}), read_from: "a formula over the twin's objects" };
  } catch (err) {
    if (err instanceof CalcError) throw new ToolError(`The formula could not be evaluated: ${err.message}`);
    throw err;
  }
}

async function runHistory(c: HistoryConfig, given: Given, reads: FunctionReads, now: Date): Promise<Record<string, unknown>> {
  const asked = valueOf(c.unit, given);
  if (asked === null) throw new ToolError("Name the unit whose history to read.");
  const unit = pick(await reads.units(), asked, "unit");
  const kept = await reads.metrics();
  const metric = kept.find((m) => m.key === c.metric);
  if (!metric) {
    throw new ToolError(`The twin keeps no history of "${c.metric}": only the measures the organisation defined are kept. They are: ${kept.map((m) => m.key).join(", ") || "none"}.`);
  }
  const hours = typeof c.hours === "number" ? c.hours : Number(given[c.hours.input] ?? Number.NaN);
  if (!Number.isFinite(hours) || hours < 1 || hours > HOURS_MAX) throw new ToolError(`The window is counted in hours, from 1 to ${HOURS_MAX}.`);
  const from = new Date(now.getTime() - hours * 3_600_000);
  const read = await reads.history(unit.id, c.metric, from, now);
  const points = [...(read.opening ? [{ at: from.toISOString(), value: read.opening.value }] : []), ...read.readings.map((r) => ({ at: r.observedAt ?? r.recordedAt, value: r.value }))];
  const valued = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  return {
    unit: unit.name,
    measure: metric.label,
    over_the_last_hours: hours,
    readings_kept: read.readings.length,
    lowest: valued.length ? Math.min(...valued) : null,
    highest: valued.length ? Math.max(...valued) : null,
    latest: valued.length ? valued[valued.length - 1] : null,
    history_starts_at: read.since,
    readings: points.slice(-POINTS_MAX),
    ...(points.length > POINTS_MAX ? { note: `Only the last ${POINTS_MAX} readings are listed.` } : {}),
    ...(read.cut ? { limit: "The window holds more readings than one read takes: the oldest are left out." } : {}),
    how_to_read: "Each value holds until the next reading. A reading with no value is a gap, not a zero. Nothing is known before the history starts.",
    read_from: "the readings the twin kept",
  };
}

async function runDataset(c: DatasetConfig, given: Given, reads: FunctionReads): Promise<Record<string, unknown>> {
  const all = await reads.datasets();
  const ds = all.find((d) => d.id === c.dataset || d.slug === c.dataset) ?? all.find((d) => same(d.name, c.dataset));
  if (!ds) throw new ToolError(`The project holds no dataset called "${c.dataset}". Its datasets are: ${all.map((d) => d.name).join(", ") || "none"}.`);
  const unknown = [...c.columns, ...c.where.map((f) => f.column)].filter((col) => !ds.columns.includes(col));
  if (unknown.length) throw new ToolError(`The dataset ${ds.name} has no column called ${[...new Set(unknown)].map((x) => `"${x}"`).join(", ")}. Its columns are: ${ds.columns.join(", ")}.`);
  const { rows, capped } = await reads.rows(ds.id);
  const where = c.where.flatMap((f) => {
    const v = valueOf(f.equals, given);
    return v === null ? [] : [{ column: f.column, equals: v }];
  });
  const kept = rows.filter((r) => where.every((f) => same(r[f.column], f.equals)));
  return {
    dataset: ds.name,
    rows: kept.slice(0, c.limit).map((r) => Object.fromEntries(c.columns.map((col) => [col, r[col] ?? null]))),
    rows_returned: Math.min(kept.length, c.limit),
    rows_matching: kept.length,
    ...(kept.length > c.limit ? { note: `Only the first ${c.limit} are listed. Narrow the filter to read the others.` } : {}),
    ...(capped ? { limit: "The dataset holds more rows than one read takes: this rests on the first of them, not on all." } : {}),
    read_from: `the dataset ${ds.name}`,
  };
}

/**
 * Run a function type on what it was given. Reads only; a refusal says what to do instead.
 *
 * What it returns is read by a model: a result too long to be read at once is
 * refused rather than cut, because a table cut without a word passes for whole.
 */
export async function runFunction(t: FunctionType, given: Given, reads: FunctionReads, now: Date = new Date()): Promise<Record<string, unknown>> {
  const out = await runBlock(t, given, reads, now);
  const size = JSON.stringify(out).length;
  if (size > RESULT_MAX_CHARS) {
    throw new ToolError(`What this tool returns is too long to be read at once: ${size} characters, where the most is ${RESULT_MAX_CHARS}. Narrow it with a filter, or have it declared with fewer fields or a lower limit.`);
  }
  return out;
}

function runBlock(t: FunctionType, given: Given, reads: FunctionReads, now: Date): Promise<Record<string, unknown>> {
  switch (t.block) {
    case "objects":
      return runObjects(t.config, given, reads);
    case "aggregate":
      return runAggregate(t.config, given, reads);
    case "formula":
      return runFormula(t.config, given, reads, t.inputs);
    case "history":
      return runHistory(t.config, given, reads, now);
    case "dataset":
      return runDataset(t.config, given, reads);
  }
}

// --- the bridge to the analyst ---------------------------------------------------

/** What a call may pass, read from the declaration: a value outside a bound is refused with the bound. */
export function inputParser(inputs: readonly FunctionInput[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const i of inputs) {
    let field: z.ZodTypeAny;
    if (i.kind === "number") {
      field = z.number().superRefine((v, ctx) => {
        if (i.min !== null && v < i.min) ctx.addIssue({ code: "custom", message: `${v} is below the least allowed, ${i.min}` });
        if (i.max !== null && v > i.max) ctx.addIssue({ code: "custom", message: `${v} is above the most allowed, ${i.max}` });
      });
    } else if (i.kind === "choice") {
      field = z.string().superRefine((v, ctx) => {
        if (!i.choices.some((c) => c.toLowerCase() === v.trim().toLowerCase())) ctx.addIssue({ code: "custom", message: `"${v}" is not one of: ${i.choices.join(", ")}` });
      });
    } else if (i.kind === "date") {
      field = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date is written YYYY-MM-DD");
    } else {
      field = z.string().trim().min(1).max(300);
    }
    shape[i.name] = i.required ? field : field.optional();
  }
  return z.object(shape).strict();
}

const JSON_KIND: Record<FunctionInput["kind"], string> = { text: "string", number: "number", date: "string", choice: "string" };

/** The declared function as a tool of the analyst: its schema from its inputs, its run from its block. */
export function toolOf(t: FunctionType, reads: FunctionReads, now: () => Date = () => new Date()): AnalystTool {
  return {
    name: t.key,
    label: t.label,
    description: `${t.description} (A reading tool declared in this project: “${t.label}”. It only reads.)`,
    input_schema: obj(
      Object.fromEntries(
        t.inputs.map((i) => [
          i.name,
          {
            type: JSON_KIND[i.kind],
            description: `${i.says}${i.kind === "date" ? " Written YYYY-MM-DD." : ""}${i.kind === "number" && (i.min !== null || i.max !== null) ? ` Between ${i.min ?? "any"} and ${i.max ?? "any"}.` : ""}`,
            ...(i.kind === "choice" ? { enum: i.choices } : {}),
          },
        ]),
      ),
      t.inputs.filter((i) => i.required).map((i) => i.name),
    ),
    parse: inputParser(t.inputs),
    run: (_ctx, given: Given) => runFunction(t, given, reads, now()),
  };
}

// --- what the twin offers a function type -----------------------------------------

export interface FunctionOffer {
  objectTypes: { name: string; properties: string[] }[];
  metrics: { key: string; label: string }[];
  datasets: { id: string; name: string; slug: string; columns: string[] }[];
}

/** Why a function type cannot run on this project, or null when it can. */
export function missingForFunction(t: FunctionType, offer: FunctionOffer): string | null {
  const typeNamed = (n: string) => offer.objectTypes.find((x) => x.name === n);
  const selection = (type: string, properties: (string | null)[]): string | null => {
    const held = typeNamed(type);
    if (!held) return `The ontology has no object type called "${type}".`;
    const unknown = properties.filter((p): p is string => p !== null && !held.properties.includes(p));
    return unknown.length ? `The type ${type} declares no property called ${[...new Set(unknown)].map((p) => `"${p}"`).join(", ")}.` : null;
  };
  if (t.block === "objects") return selection(t.config.type, [...t.config.where.map((f) => f.property), ...t.config.fields.map((f) => f.property)]);
  if (t.block === "aggregate") {
    const by = t.config.groupBy && "value" in t.config.groupBy ? t.config.groupBy.value : null;
    return selection(t.config.type, [...t.config.where.map((f) => f.property), t.config.property, by]);
  }
  if (t.block === "formula") {
    for (const v of t.config.values) {
      const why = selection(v.type, [...v.where.map((f) => f.property), v.property]);
      if (why) return why;
    }
    return null;
  }
  if (t.block === "history") {
    return offer.metrics.some((m) => m.key === t.config.metric) ? null : `The twin keeps no history of "${t.config.metric}": only the measures the organisation defined are kept.`;
  }
  const ds = offer.datasets.find((d) => d.id === t.config.dataset || d.slug === t.config.dataset || d.name.toLowerCase() === t.config.dataset.toLowerCase());
  if (!ds) return `The project holds no dataset called "${t.config.dataset}".`;
  const unknown = [...t.config.columns, ...t.config.where.map((f) => f.column)].filter((c) => !ds.columns.includes(c));
  return unknown.length ? `The dataset ${ds.name} has no column called ${[...new Set(unknown)].map((c) => `"${c}"`).join(", ")}.` : null;
}

// --- the project's list ----------------------------------------------------------

interface Row {
  key: string;
  label: string;
  description: string;
  inputs: unknown;
  block: Block;
  config: unknown;
  active: boolean;
}

/** A stored row as a function type. One that cannot be read any more is left out of what the analyst is offered, and listed as unreadable. */
function readRow(r: Row): FunctionType | null {
  const config = configOf[r.block]?.safeParse(r.config);
  const inputs = z.array(input).safeParse(r.inputs ?? []);
  if (!config?.success || !inputs.success) return null;
  return { key: r.key, label: r.label, description: r.description, inputs: inputs.data, block: r.block, config: config.data, active: r.active } as FunctionType;
}

export async function listFunctionTypes(db: DbClient, projectId: string): Promise<{ types: FunctionType[]; unreadable: string[] }> {
  const { rows } = await db.query<Row>(
    `SELECT key, label, description, inputs, block, config, active
       FROM app.function_type
      WHERE project_id = $1
      ORDER BY label, key`,
    [projectId],
  );
  const types: FunctionType[] = [];
  const unreadable: string[] = [];
  for (const r of rows) {
    const t = readRow(r);
    if (t) types.push(t);
    else unreadable.push(r.label || r.key);
  }
  return { types, unreadable };
}

export async function saveFunctionType(db: DbClient, projectId: string, userId: string, key: string, draft: FunctionTypeDraft, reserved: ReadonlySet<string>): Promise<FunctionType> {
  const t = readFunctionDraft(key, draft, reserved);
  await db.query(
    `INSERT INTO app.function_type (project_id, key, label, description, inputs, block, config, active, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
     ON CONFLICT (project_id, key) DO UPDATE
        SET label = EXCLUDED.label, description = EXCLUDED.description, inputs = EXCLUDED.inputs, block = EXCLUDED.block,
            config = EXCLUDED.config, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [projectId, key, t.label, t.description, JSON.stringify(t.inputs), t.block, JSON.stringify(t.config), t.active, userId],
  );
  return t;
}

export async function removeFunctionType(db: DbClient, projectId: string, key: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.function_type WHERE project_id = $1 AND key = $2`, [projectId, key]);
  if (!rowCount) throw NotFound("FUNCTION_TYPE_NOT_FOUND", "That function type is not in this project.");
}
