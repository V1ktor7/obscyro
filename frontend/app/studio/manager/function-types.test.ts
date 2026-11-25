import { describe, expect, it } from "vitest";

import type { AggregateConfig, FunctionInput, FunctionType, HistoryConfig } from "../analyst-api";
import { blankFunctionForm, blockLabel, draftOfFunction, formOfFunction, inputText, saysOf, trialInput, type FunctionForm } from "./function-types";

const common = { key: "k", label: "L", description: "A sentence that says what it reads.", inputs: [] as FunctionInput[], active: true, missing: null };
const input = (over: Partial<FunctionInput> = {}): FunctionInput => ({ name: "site", kind: "text", required: true, says: "The site's name.", min: null, max: null, choices: [], ...over });

const COUNTED: AggregateConfig = {
  type: "Ventilator",
  where: [{ property: "status", equals: { value: "available" } }, { property: "site", equals: { input: "site" } }],
  agg: "count",
  property: null,
  groupBy: { value: "site" },
  as: "ventilators_available",
};
const BY_SITE: FunctionType = {
  ...common,
  key: "ventilators_available_by_site",
  label: "Ventilators available by site",
  inputs: [input({ required: false })],
  block: "aggregate",
  config: COUNTED,
};
const aggregate = (over: Partial<AggregateConfig>): FunctionType => ({ ...common, block: "aggregate", config: { ...COUNTED, ...over } });
const history = (config: HistoryConfig): FunctionType => ({ ...common, block: "history", config });
const LISTED: FunctionType = {
  ...common,
  block: "objects",
  config: { type: "Ventilator", where: [], fields: [{ property: "Serial", as: "serial" }, { property: "Flow", as: "flow_litres_per_minute" }], limit: 20 },
};
const CLOSED: FunctionType = {
  ...common,
  block: "formula",
  config: {
    values: [
      { name: "closed", type: "Bed", where: [{ property: "state", equals: { value: "closed" } }], agg: "count", property: null },
      { name: "staffed", type: "Bed", where: [], agg: "sum", property: "staffed" },
    ],
    expression: "round(closed / (closed + staffed) * 100, 1)",
    as: "beds_closed_pct",
  },
};
const KEPT: FunctionType = {
  ...common,
  inputs: [input({ name: "unit" }), input({ name: "hours", kind: "number", min: 1, max: 72 })],
  block: "history",
  config: { metric: "occupancy", unit: { input: "unit" }, hours: { input: "hours" } },
};
const ROWS: FunctionType = {
  ...common,
  block: "dataset",
  config: { dataset: "surgeries", columns: ["period", "waiting"], where: [{ column: "region", equals: { value: "06" } }], limit: 12 },
};

describe("a function type in a sentence", () => {
  it("says what each block reads, with its filters and where a value is taken from", () => {
    expect(saysOf(BY_SITE)).toBe("Counts the Ventilator where status is “available” and site is the input site, by site.");
    expect(saysOf(aggregate({ agg: "sum", property: "Flow", where: [], groupBy: null }))).toBe("Adds up Flow over the Ventilator.");
    expect(saysOf(aggregate({ where: [], groupBy: { input: "by" } }))).toBe("Counts the Ventilator, by the input by.");
    expect(saysOf(aggregate({ where: [], groupBy: { of: "unit" } }))).toBe("Counts the Ventilator, by the unit each is attached to.");
    expect(saysOf(aggregate({ agg: "max", property: "Flow", where: [], groupBy: { of: "site" } }))).toBe("Takes the highest Flow over the Ventilator, by the site each stands at.");
    expect(saysOf(LISTED)).toBe("Lists up to 20 Ventilator, with Serial, Flow.");
    expect(saysOf(CLOSED)).toBe("Computes round(closed / (closed + staffed) * 100, 1), from closed, staffed.");
    expect(saysOf(KEPT)).toBe("Reads what the twin kept of occupancy at the input unit, over the hours given as hours.");
    expect(saysOf(history({ metric: "occupancy", unit: { value: "CHUM" }, hours: 72 }))).toBe("Reads what the twin kept of occupancy at “CHUM”, over the last 3 days.");
    expect(saysOf(history({ metric: "occupancy", unit: { value: "CHUM" }, hours: 1 }))).toBe("Reads what the twin kept of occupancy at “CHUM”, over the last 1 hour.");
    expect(saysOf(ROWS)).toBe("Lists up to 12 rows of surgeries where region is “06”, with period, waiting.");
  });

  it("names a block and says an input in a few words", () => {
    expect(blockLabel("aggregate")).toBe("Count or total");
    expect(blockLabel("history")).toBe("History of a measure");
    expect(inputText(input())).toBe("text");
    expect(inputText(input({ required: false }))).toBe("text, optional");
    expect(inputText(input({ kind: "number", min: 1, max: 72 }))).toBe("number from 1 to 72");
    expect(inputText(input({ kind: "number", min: 1 }))).toBe("number from 1 to any");
    expect(inputText(input({ kind: "choice", choices: ["site", "status"], required: false }))).toBe("one of a list: site, status, optional");
  });
});

describe("the form of a function type", () => {
  it("gives back what was declared, for every block", () => {
    for (const t of [BY_SITE, aggregate({ groupBy: { of: "unit" } }), aggregate({ groupBy: { of: "site" } }), aggregate({ groupBy: null }), LISTED, CLOSED, KEPT, ROWS]) {
      const { draft, problems } = draftOfFunction(formOfFunction(t));
      expect(problems).toEqual([]);
      expect(draft).toEqual({ label: t.label, description: t.description, inputs: t.inputs, block: t.block, config: t.config, active: t.active });
    }
  });

  it("keeps a filter's value as it is written or the input it takes", () => {
    const form = formOfFunction(BY_SITE);
    expect(form.where).toEqual([
      { on: "status", from: "", value: "available" },
      { on: "site", from: "site", value: "" },
    ]);
    expect(form.groupBy).toBe("=site");
    // Where each object stands is neither a property nor an input: it has its own mark.
    expect(formOfFunction(aggregate({ groupBy: { of: "site" } })).groupBy).toBe("@site");
    expect(formOfFunction(KEPT).hours).toBe("@hours");
    expect(formOfFunction(KEPT).unit).toEqual({ on: "unit", from: "unit", value: "" });
  });

  it("says what to correct before anything is sent", () => {
    const blank = draftOfFunction(blankFunctionForm());
    expect(blank.problems).toEqual([
      "Give the tool a name, in your own words.",
      "Say what it reads and when to use it: the analyst decides to call it from that sentence.",
      "Pick the object type it counts.",
      "The value “” has to be in lower-case letters, digits and underscores, starting with a letter: it is what the analyst reads.",
    ]);

    const of = (over: Partial<FunctionForm>) => draftOfFunction({ ...formOfFunction(BY_SITE), ...over }).problems;
    expect(of({ agg: "sum", property: "" })).toEqual(["A sum, a mean, a minimum or a maximum needs the property it is taken over."]);
    expect(of({ where: [{ on: "", from: "", value: "" }] })).toEqual(["A filter needs the property it is on.", "The filter on a property needs a value, or an input to take it from."]);
    expect(of({ inputs: [{ name: "Site Name", kind: "text", required: true, says: "", min: "", max: "", choices: "" }] })).toEqual([
      "The input “Site Name” has to be in lower-case letters, digits and underscores, starting with a letter: it is what the analyst reads.",
      "Say what the input “Site Name” is for.",
    ]);
    expect(of({ inputs: [{ name: "hours", kind: "number", required: true, says: "The window.", min: "72", max: "1", choices: "" }] })).toEqual(["On the input “hours”, the least (72) is above the most (1)."]);
    expect(of({ inputs: [{ name: "hours", kind: "number", required: true, says: "The window.", min: "a lot", max: "", choices: "" }] })).toEqual(["The least of the input “hours” has to be a number, or left empty."]);
    expect(of({ inputs: [{ name: "by", kind: "choice", required: true, says: "The group.", min: "", max: "", choices: " , " }] })).toEqual(["The input “by” is a choice among a list: write the list."]);
  });

  it("holds every block to its own rules", () => {
    const from = (t: FunctionType, over: Partial<FunctionForm>) => draftOfFunction({ ...formOfFunction(t), ...over }).problems;
    expect(from(LISTED, { fields: [], limit: "200" })).toEqual(["Pick at least one property to return.", "The number of objects listed is a whole number from 1 to 50."]);
    expect(from(LISTED, { fields: [{ property: "Flow", as: "Flow L/min" }] })).toEqual([
      "The field “Flow L/min” has to be in lower-case letters, digits and underscores, starting with a letter: it is what the analyst reads.",
    ]);
    expect(from(CLOSED, { values: [], expression: " " })).toEqual(["A formula needs at least one named value to compute from.", "Write the formula, with the names of its values."]);
    expect(from(CLOSED, { values: [{ name: "staffed", type: "", agg: "sum", property: "", where: [] }] })).toEqual([
      "Pick the object type the value “staffed” is taken over.",
      "The value “staffed” needs the property it is taken over.",
    ]);
    expect(from(KEPT, { metric: "", unit: { on: "unit", from: "", value: " " }, hours: "0" })).toEqual([
      "Pick the measure whose history it reads.",
      "Name the unit, or take it from an input.",
      "The window in hours is a whole number from 1 to 2160.",
    ]);
    expect(from(ROWS, { source: "", fields: [] })).toEqual(["Pick the dataset it reads.", "Pick at least one column to return."]);
  });

  it("reads a choice's list by line or by comma, and a count needs no property", () => {
    const { draft } = draftOfFunction({
      ...formOfFunction(BY_SITE),
      property: "Flow",
      groupBy: "by",
      inputs: [{ name: "by", kind: "choice", required: false, says: "The group.", min: "5", max: "", choices: "site\nstatus, ward" }],
    });
    expect(draft.inputs).toEqual([{ name: "by", kind: "choice", required: false, says: "The group.", min: null, max: null, choices: ["site", "status", "ward"] }]);
    expect(draft.config.property).toBeNull();
    expect(draft.config.groupBy).toEqual({ input: "by" });
  });
});

describe("the inputs of a trial", () => {
  it("sends a number as a number, a text as it is, and an empty box as nothing", () => {
    const inputs = [input(), input({ name: "hours", kind: "number" }), input({ name: "since", kind: "date", required: false })];
    expect(trialInput(inputs, { site: " CHUM ", hours: "1,5", since: "" })).toEqual({ site: "CHUM", hours: 1.5 });
    expect(trialInput(inputs, {})).toEqual({});
    // What a person typed in a box of another tool is not sent.
    expect(trialInput([input()], { site: "CHUM", other: "x" })).toEqual({ site: "CHUM" });
  });
});
