import type { FunctionAgg, FunctionBlock, FunctionFilter, FunctionInput, FunctionSlot, FunctionType, FunctionTypeDraft } from "../analyst-api";

// ---------------------------------------------------------------------------
// Function types, as the ontology manager words and edits them. No screen here.
//
// A function type is a reading tool of the analyst that the project declares:
// one of five blocks, set by a person. This file says a type in a sentence a
// person can check against what they meant, and turns what they fill in into
// what the server reads. The server holds the rules and checks everything
// again.
// ---------------------------------------------------------------------------

export const BLOCKS: { key: FunctionBlock; label: string; says: string }[] = [
  { key: "aggregate", label: "Count or total", says: "A count, a sum, a mean, a minimum or a maximum over the objects of a type, in one value or by group: a property, the unit each is attached to, or its site." },
  { key: "objects", label: "List of objects", says: "The objects of a type, filtered, with the properties to return." },
  { key: "formula", label: "Formula", says: "A calculation over named counts and totals. It is evaluated by the calculator, never run as code." },
  { key: "history", label: "History of a measure", says: "The readings the twin kept of a measure at a unit, over a window." },
  { key: "dataset", label: "Rows of a dataset", says: "Columns of a dataset of the project, filtered." },
];
export const blockLabel = (block: FunctionBlock): string => BLOCKS.find((b) => b.key === block)!.label;

export const AGGS: { key: FunctionAgg; label: string; verb: string }[] = [
  { key: "count", label: "Count", verb: "Counts" },
  { key: "sum", label: "Sum", verb: "Adds up" },
  { key: "mean", label: "Mean", verb: "Averages" },
  { key: "min", label: "Minimum", verb: "Takes the lowest" },
  { key: "max", label: "Maximum", verb: "Takes the highest" },
];

const slotText = (s: FunctionSlot): string => ("value" in s ? `“${s.value}”` : `the input ${s.input}`);
const whereText = (where: readonly { property?: string; column?: string; equals: FunctionSlot }[]): string =>
  where.length ? ` where ${where.map((f) => `${f.property ?? f.column} is ${slotText(f.equals)}`).join(" and ")}` : "";
const hoursText = (h: number): string => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} hour${h === 1 ? "" : "s"}`);
/** The two places an object stands at, as a group is worded. */
export const STANDINGS: { key: "unit" | "site"; label: string }[] = [
  { key: "unit", label: "the unit each is attached to" },
  { key: "site", label: "the site each stands at" },
];

/** What a function type reads, in one sentence a person can check. */
export function saysOf(t: Pick<FunctionType, "block" | "config">): string {
  if (t.block === "objects") {
    const c = t.config as Extract<FunctionType, { block: "objects" }>["config"];
    return `Lists up to ${c.limit} ${c.type}${whereText(c.where)}, with ${c.fields.map((f) => f.property).join(", ")}.`;
  }
  if (t.block === "aggregate") {
    const c = t.config as Extract<FunctionType, { block: "aggregate" }>["config"];
    const verb = AGGS.find((a) => a.key === c.agg)!.verb;
    const what = c.agg === "count" ? `the ${c.type}` : `${c.property} over the ${c.type}`;
    const g = c.groupBy;
    const by = g === null ? "" : `, by ${"of" in g ? STANDINGS.find((s) => s.key === g.of)!.label : "value" in g ? g.value : `the input ${g.input}`}`;
    return `${verb} ${what}${whereText(c.where)}${by}.`;
  }
  if (t.block === "formula") {
    const c = t.config as Extract<FunctionType, { block: "formula" }>["config"];
    return `Computes ${c.expression}, from ${c.values.map((v) => v.name).join(", ")}.`;
  }
  if (t.block === "history") {
    const c = t.config as Extract<FunctionType, { block: "history" }>["config"];
    return `Reads what the twin kept of ${c.metric} at ${slotText(c.unit)}, over ${typeof c.hours === "number" ? `the last ${hoursText(c.hours)}` : `the hours given as ${c.hours.input}`}.`;
  }
  const c = t.config as Extract<FunctionType, { block: "dataset" }>["config"];
  return `Lists up to ${c.limit} rows of ${c.dataset}${whereText(c.where)}, with ${c.columns.join(", ")}.`;
}

/** What an input is, in a few words: "text, optional", "number from 1 to 72". */
export function inputText(i: FunctionInput): string {
  const bounds = i.kind === "number" && (i.min !== null || i.max !== null) ? ` from ${i.min ?? "any"} to ${i.max ?? "any"}` : "";
  const list = i.kind === "choice" ? `: ${i.choices.join(", ")}` : "";
  return `${i.kind === "choice" ? "one of a list" : i.kind}${bounds}${list}${i.required ? "" : ", optional"}`;
}

// --- the form -----------------------------------------------------------------

/** A filter as it is filled in: on a property (or a column), equal to a written value or to an input. */
export interface FilterForm {
  on: string;
  /** "" for a written value, or the name of the input it takes. */
  from: string;
  value: string;
}
export interface InputForm {
  name: string;
  kind: FunctionInput["kind"];
  required: boolean;
  says: string;
  min: string;
  max: string;
  /** A choice's list, one per line or separated by commas. */
  choices: string;
}

/** What a person fills in. Numbers are kept as typed, so an empty box is "no bound". */
export interface FunctionForm {
  label: string;
  description: string;
  active: boolean;
  inputs: InputForm[];
  block: FunctionBlock;
  /** objects, aggregate: the object type. dataset: the dataset. */
  source: string;
  where: FilterForm[];
  // objects, dataset
  fields: { property: string; as: string }[];
  limit: string;
  // aggregate
  agg: FunctionAgg;
  property: string;
  /** "" for one value, "=<property>" for a written group, "@unit" or "@site" for where each object stands, "<input>" for a choice input. */
  groupBy: string;
  as: string;
  // formula
  values: { name: string; type: string; agg: FunctionAgg; property: string; where: FunctionFilter[] }[];
  expression: string;
  // history
  metric: string;
  unit: FilterForm;
  /** A number of hours, or "@<input>". */
  hours: string;
}

export function blankFunctionForm(block: FunctionBlock = "aggregate"): FunctionForm {
  return {
    label: "",
    description: "",
    active: true,
    inputs: [],
    block,
    source: "",
    where: [],
    fields: [],
    limit: "20",
    agg: "count",
    property: "",
    groupBy: "",
    as: "",
    values: [],
    expression: "",
    metric: "",
    unit: { on: "unit", from: "", value: "" },
    hours: "24",
  };
}

const filterForm = (on: string, s: FunctionSlot): FilterForm => ("value" in s ? { on, from: "", value: s.value } : { on, from: s.input, value: "" });
const slotOf = (f: FilterForm): FunctionSlot => (f.from ? { input: f.from } : { value: f.value.trim() });
const text = (n: number | null): string => (n === null ? "" : String(n));

export function formOfFunction(t: FunctionType): FunctionForm {
  const f: FunctionForm = {
    ...blankFunctionForm(t.block),
    label: t.label,
    description: t.description,
    active: t.active,
    inputs: t.inputs.map((i) => ({ name: i.name, kind: i.kind, required: i.required, says: i.says, min: text(i.min), max: text(i.max), choices: i.choices.join(", ") })),
  };
  if (t.block === "objects") {
    return { ...f, source: t.config.type, where: t.config.where.map((w) => filterForm(w.property, w.equals)), fields: t.config.fields, limit: String(t.config.limit) };
  }
  if (t.block === "aggregate") {
    const g = t.config.groupBy;
    return {
      ...f,
      source: t.config.type,
      where: t.config.where.map((w) => filterForm(w.property, w.equals)),
      agg: t.config.agg,
      property: t.config.property ?? "",
      groupBy: g === null ? "" : "of" in g ? `@${g.of}` : "value" in g ? `=${g.value}` : g.input,
      as: t.config.as,
    };
  }
  if (t.block === "formula") {
    return { ...f, values: t.config.values.map((v) => ({ name: v.name, type: v.type, agg: v.agg, property: v.property ?? "", where: v.where })), expression: t.config.expression, as: t.config.as };
  }
  if (t.block === "history") {
    return { ...f, metric: t.config.metric, unit: filterForm("unit", t.config.unit), hours: typeof t.config.hours === "number" ? String(t.config.hours) : `@${t.config.hours.input}` };
  }
  return { ...f, source: t.config.dataset, where: t.config.where.map((w) => filterForm(w.column, w.equals)), fields: t.config.columns.map((c) => ({ property: c, as: c })), limit: String(t.config.limit) };
}

const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const named = (what: string, value: string, problems: string[]) => {
  if (!NAME.test(value)) problems.push(`${what} “${value}” has to be in lower-case letters, digits and underscores, starting with a letter: it is what the analyst reads.`);
};

function whole(box: string, what: string, problems: string[], min: number, max: number): number {
  const n = Number(box.trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${what} is a whole number from ${min} to ${max}.`);
    return min;
  }
  return n;
}

/**
 * What the server is sent for a form, or what to correct first.
 *
 * These are the mistakes a person can be told about before a round trip. The
 * server checks the rest: that every input a slot takes exists and is of a
 * kind that slot can take, and that a formula can be evaluated.
 */
export function draftOfFunction(f: FunctionForm): { draft: FunctionTypeDraft; problems: string[] } {
  const problems: string[] = [];
  if (!f.label.trim()) problems.push("Give the tool a name, in your own words.");
  if (f.description.trim().length < 10) problems.push("Say what it reads and when to use it: the analyst decides to call it from that sentence.");

  const inputs: FunctionInput[] = f.inputs.map((i) => {
    named("The input", i.name, problems);
    if (!i.says.trim()) problems.push(`Say what the input “${i.name}” is for.`);
    const bound = (box: string, side: string): number | null => {
      if (i.kind !== "number" || box.trim() === "") return null;
      const n = Number(box.trim().replace(",", "."));
      if (!Number.isFinite(n)) problems.push(`The ${side} of the input “${i.name}” has to be a number, or left empty.`);
      return Number.isFinite(n) ? n : null;
    };
    const min = bound(i.min, "least");
    const max = bound(i.max, "most");
    if (min !== null && max !== null && min > max) problems.push(`On the input “${i.name}”, the least (${min}) is above the most (${max}).`);
    const choices = i.kind === "choice" ? i.choices.split(/[\n,]/).map((c) => c.trim()).filter(Boolean) : [];
    if (i.kind === "choice" && choices.length === 0) problems.push(`The input “${i.name}” is a choice among a list: write the list.`);
    return { name: i.name, kind: i.kind, required: i.required, says: i.says.trim(), min, max, choices };
  });

  const filters = (what: "property" | "column") =>
    f.where.map((w) => {
      if (!w.on) problems.push(`A filter needs the ${what} it is on.`);
      if (!w.from && !w.value.trim()) problems.push(`The filter on ${w.on || `a ${what}`} needs a value, or an input to take it from.`);
      return { on: w.on, equals: slotOf(w) };
    });

  let config: Record<string, unknown> = {};
  if (f.block === "objects") {
    if (!f.source) problems.push("Pick the object type it lists.");
    if (f.fields.length === 0) problems.push("Pick at least one property to return.");
    for (const field of f.fields) named("The field", field.as, problems);
    config = { type: f.source, where: filters("property").map((w) => ({ property: w.on, equals: w.equals })), fields: f.fields, limit: whole(f.limit, "The number of objects listed", problems, 1, 50) };
  } else if (f.block === "aggregate") {
    if (!f.source) problems.push("Pick the object type it counts.");
    if (f.agg !== "count" && !f.property) problems.push("A sum, a mean, a minimum or a maximum needs the property it is taken over.");
    named("The value", f.as, problems);
    config = {
      type: f.source,
      where: filters("property").map((w) => ({ property: w.on, equals: w.equals })),
      agg: f.agg,
      property: f.agg === "count" ? null : f.property || null,
      groupBy: f.groupBy === "" ? null : f.groupBy.startsWith("@") ? { of: f.groupBy.slice(1) } : f.groupBy.startsWith("=") ? { value: f.groupBy.slice(1) } : { input: f.groupBy },
      as: f.as,
    };
  } else if (f.block === "formula") {
    if (f.values.length === 0) problems.push("A formula needs at least one named value to compute from.");
    for (const v of f.values) {
      named("The value", v.name, problems);
      if (!v.type) problems.push(`Pick the object type the value “${v.name}” is taken over.`);
      if (v.agg !== "count" && !v.property) problems.push(`The value “${v.name}” needs the property it is taken over.`);
    }
    if (!f.expression.trim()) problems.push("Write the formula, with the names of its values.");
    named("The result", f.as, problems);
    config = { values: f.values.map((v) => ({ name: v.name, type: v.type, where: v.where, agg: v.agg, property: v.agg === "count" ? null : v.property || null })), expression: f.expression.trim(), as: f.as };
  } else if (f.block === "history") {
    if (!f.metric) problems.push("Pick the measure whose history it reads.");
    if (!f.unit.from && !f.unit.value.trim()) problems.push("Name the unit, or take it from an input.");
    const hours = f.hours.startsWith("@") ? { input: f.hours.slice(1) } : whole(f.hours, "The window in hours", problems, 1, 24 * 90);
    config = { metric: f.metric, unit: slotOf(f.unit), hours };
  } else {
    if (!f.source) problems.push("Pick the dataset it reads.");
    if (f.fields.length === 0) problems.push("Pick at least one column to return.");
    config = { dataset: f.source, columns: f.fields.map((c) => c.property), where: filters("column").map((w) => ({ column: w.on, equals: w.equals })), limit: whole(f.limit, "The number of rows listed", problems, 1, 50) };
  }
  return { draft: { label: f.label.trim(), description: f.description.trim(), inputs, block: f.block, config, active: f.active }, problems: Array.from(new Set(problems)) };
}

/** What a trial sends for the inputs a person filled in: a number as a number, an empty box as nothing. */
export function trialInput(inputs: readonly FunctionInput[], filled: Readonly<Record<string, string>>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const i of inputs) {
    const v = (filled[i.name] ?? "").trim();
    if (v === "") continue;
    out[i.name] = i.kind === "number" ? Number(v.replace(",", ".")) : v;
  }
  return out;
}
