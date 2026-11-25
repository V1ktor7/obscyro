import type { DbClient } from "../lib/db.js";
import { BadRequest } from "../lib/errors.js";
import { listActions } from "./analyst-actions.js";
import { OPTION_TOOLS } from "./analyst-options.js";
import { READ_TOOLS, type AnalystTool } from "./analyst-tools.js";
import { WEB_SEARCH } from "./analyst-web.js";

// ---------------------------------------------------------------------------
// What the analyst can use, and what a project switched off.
//
// The analyst's tools are code: each one is tested, and what it returns is
// checked figure by figure. A project cannot write one from the Studio. What it
// can do is take one away: an institution that does not want anything searched
// on the web switches the web search off, and the analyst simply does not have
// it.
//
// Switched off means absent from the exchange, not refused in it: the model is
// not offered the tool at all. A project that switched nothing off is offered
// everything, as before.
// ---------------------------------------------------------------------------

/** Where a tool is offered. */
export type Exchange = "ask" | "options" | "events" | "investigate";

/** What a tool does, in one word a screen can show beside its name. */
export type ToolDoes = "reads" | "computes" | "runs" | "searches";

/** One thing a tool is given when it is called. */
export interface ToolInput {
  name: string;
  /** "text", "number", "list"…: the JSON type its schema declares. */
  kind: string;
  required: boolean;
  /** What it is for, in the words the model is given. */
  says: string;
}

export interface ToolLine {
  name: string;
  /** What it reads, in a sentence a person can read. */
  reads: string;
  /** The heading it is listed under. */
  group: string;
  does: ToolDoes;
  /** Written in the code, or declared in the project from the Studio. */
  origin: "code" | "project";
  inputs: ToolInput[];
  where: Exchange[];
  /** False for a tool an exchange cannot do without. */
  switchable: boolean;
  /** Why it cannot be switched off, when it cannot. */
  why: string | null;
  on: boolean;
}

/** One line per tool, for people. The description a tool carries is written for the model. */
const READS: Record<string, string> = {
  describe_twin: "An overview of the twin: its sites, activities and catchments, the model it declares, and what it is missing.",
  find_sites: "The sites, filtered by name, activity or catchment.",
  get_site: "One site: its units by activity, the catchments it serves, what the scenario changes there.",
  compare_catchments: "For an activity, each catchment with its residents, its sites and its units per 1,000 residents.",
  scenario_recipe: "What the open scenario contains: starting conditions, events and choices.",
  list_prices: "The price list the twin declares: what a unit costs to open and to keep open, in each mode, and the days each mode takes.",
  read_run: "The run on screen: both passes, where somebody waits, a site day by day.",
  list_datasets: "The project's datasets and their columns.",
  preview_dataset: "The first rows of a dataset.",
  read_series: "A column of a dataset, read as a daily series.",
  list_events: "The calendar: the events a person accepted from official sources.",
  list_alerts: "What is open right now: the alerts, each with its unit, its value and the age of that value.",
  unit_now: "The live figures of a unit, each with the age of its own value.",
  calculate: "A calculation, on numbers already read or given in the question.",
  list_responses: "The recorded responses an option can contain, and the transfer routes of the twin.",
  test_option: "Runs an option through the simulation engine and returns it beside the scenario as it stands.",
  list_actions: "The action types this project declared: what an option may contain here, and within what bounds.",
  [WEB_SEARCH]: "A search of the web, restricted to the sources the project allows. It runs at the model's provider, not on this server.",
};

/** The heading each tool is listed under, in the order the headings are shown. */
export const TOOL_GROUPS = ["The twin", "The scenario and its run", "The network now", "Datasets", "The calendar", "Calculation", "Options", "The web"] as const;
const GROUP: Record<string, (typeof TOOL_GROUPS)[number]> = {
  describe_twin: "The twin",
  find_sites: "The twin",
  get_site: "The twin",
  compare_catchments: "The twin",
  list_prices: "The twin",
  scenario_recipe: "The scenario and its run",
  read_run: "The scenario and its run",
  list_alerts: "The network now",
  unit_now: "The network now",
  list_datasets: "Datasets",
  preview_dataset: "Datasets",
  read_series: "Datasets",
  list_events: "The calendar",
  calculate: "Calculation",
  list_responses: "Options",
  list_actions: "Options",
  test_option: "Options",
  [WEB_SEARCH]: "The web",
};
const DOES: Record<string, ToolDoes> = { calculate: "computes", test_option: "runs", [WEB_SEARCH]: "searches" };

const KIND: Record<string, string> = { string: "text", integer: "whole number", number: "number", boolean: "yes or no", array: "list", object: "group" };

/** What a tool is given, read from the schema the model is shown. */
function inputsOf(tool: AnalystTool): ToolInput[] {
  const required = new Set(tool.input_schema.required);
  return Object.entries(tool.input_schema.properties).map(([name, raw]) => {
    const p = (raw ?? {}) as { type?: string; description?: string; enum?: unknown[] };
    return {
      name,
      kind: Array.isArray(p.enum) ? `one of ${p.enum.join(", ")}` : (KIND[p.type ?? ""] ?? p.type ?? "value"),
      required: required.has(name),
      says: p.description ?? "",
    };
  });
}

/** Tools an exchange cannot do without, and why. */
const KEPT: Record<string, string> = {
  calculate: "A figure the analyst derives has to be computed by a tool, or it is taken out of the answer.",
  test_option: "The Options tab is this tool: an option that was not tested is not an option. To stop a kind of change from being proposed, switch its action type off.",
  list_actions: "It is how the analyst reads what the project lets it propose.",
};

const names = (tools: readonly AnalystTool[]) => tools.map((t) => t.name);

/** Every tool the analyst has, in the order its exchanges offer them. */
export function toolCatalogue(off: ReadonlySet<string> = new Set()): ToolLine[] {
  const ask = new Set(names(READ_TOOLS));
  const options = new Set([...names(OPTION_TOOLS), listActions.name]);
  const all = [...new Set([...names(READ_TOOLS), ...names(OPTION_TOOLS), listActions.name, WEB_SEARCH])];
  const byName = new Map([...READ_TOOLS, ...OPTION_TOOLS, listActions].map((t) => [t.name, t]));
  return all.map((name) => {
    const where: Exchange[] = [];
    if (ask.has(name)) where.push("ask");
    if (options.has(name)) where.push("options");
    if (name === WEB_SEARCH) where.push("events", "investigate");
    const why = KEPT[name] ?? null;
    const tool = byName.get(name);
    return {
      name,
      reads: READS[name] ?? name,
      group: GROUP[name] ?? "The twin",
      does: DOES[name] ?? "reads",
      origin: "code" as const,
      // The web search is the provider's own tool: it is given a query, and nothing of the twin.
      inputs: tool ? inputsOf(tool) : [{ name: "query", kind: "text", required: true, says: "What to search for. It is written from the sentence the person sent, and nothing else." }],
      where,
      switchable: why === null,
      why,
      on: why !== null || !off.has(name),
    };
  });
}

export async function toolsOff(db: DbClient, projectId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ tool: string }>(`SELECT tool FROM app.project_analyst_tool_off WHERE project_id = $1`, [projectId]);
  // A tool that cannot be switched off is never read as off, whatever a row says.
  return new Set(rows.map((r) => r.tool).filter((t) => !(t in KEPT)));
}

/** Switch one tool on or off for a project. */
export async function switchTool(db: DbClient, projectId: string, userId: string, name: string, on: boolean): Promise<void> {
  const line = toolCatalogue().find((t) => t.name === name);
  if (!line) throw BadRequest("TOOL_UNKNOWN", `The analyst has no tool called "${name}".`);
  if (!line.switchable) throw BadRequest("TOOL_KEPT", `"${name}" cannot be switched off. ${line.why}`);
  if (on) {
    await db.query(`DELETE FROM app.project_analyst_tool_off WHERE project_id = $1 AND tool = $2`, [projectId, name]);
  } else {
    await db.query(
      `INSERT INTO app.project_analyst_tool_off (project_id, tool, switched_off_by) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, tool) DO NOTHING`,
      [projectId, name, userId],
    );
  }
}

/** The tools of an exchange, without the ones the project switched off. */
export const offered = (tools: readonly AnalystTool[], off: ReadonlySet<string>): AnalystTool[] => tools.filter((t) => !off.has(t.name));
