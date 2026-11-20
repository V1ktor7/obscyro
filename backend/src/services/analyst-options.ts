import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { AppError } from "../lib/errors.js";
import type { Closing, Step } from "./analyst.js";
import {
  READ_TOOLS,
  Recorded,
  ToolError,
  fold,
  obj,
  pick,
  summariseBreak,
  summariseVariant,
  type AnalystContext,
  type AnalystTool,
  type OptionBench,
  type RunDigest,
} from "./analyst-tools.js";
import { Ledger, strike, unsourced } from "./analyst-verify.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import { ScenarioRunner, type EngineTiming, type PassDigest, type ScenarioEngine } from "./scenario-run.js";
import {
  basisOfStamp,
  choiceLine,
  choiceRefs,
  isChoice,
  stampsOf,
  type Basis,
  type ChoiceStamp,
  type Stamp,
  type StampBody,
  type TwinContext,
} from "./scenario-stamps.js";
import type { SimExport } from "./twin-export.js";

/**
 * Options, tested.
 *
 * A recommendation that rests on no run of the engine is an opinion. Here the
 * analyst may propose something to try — beds at a site from a given day, a
 * measure on a contact layer — and the only way it can say what that would
 * change is to run it: `test_option` applies the option to the open scenario
 * (stamps added, and a choice the scenario already holds replaced or removed),
 * runs the scenario on the server the way the page runs it, and returns the
 * figures beside those of the scenario as it stands.
 *
 * Three things are kept out of the model's hands on purpose:
 *
 * - the figures of the comparison, which the screen reads from the run's own
 *   record, not from a sentence;
 * - the level of evidence of each thing an option rests on, which is assigned
 *   from where that thing comes from (the twin, the scenario, the option);
 * - writing anything. An option becomes part of a scenario when a person
 *   clicks "Add to scenario", and a decision exists when a person records it.
 */

/** Options tested for one objective. More is a different question. */
export const MAX_OPTIONS = 3;
/** Changes in one option. An option nobody can say in a sentence is several options. */
const MAX_CHANGES = 4;

// ---------------------------------------------------------------------------
// The bench: the scenario, read once, and the engine.
// ---------------------------------------------------------------------------

export interface OpenBench {
  runner: ScenarioRunner;
  /** The scenario's own stamps, in the page's order. */
  stamps: Stamp[];
  /** The scenario's choices, by the name `scenario_recipe` gave each: what an option may replace or remove. */
  choices: Map<string, ChoiceStamp>;
  /** What every run of this scenario rests on, each with its level of evidence. */
  basis: Basis[];
  /** The scenario as it stands, choices included: one pass, run once and kept for every option. */
  asItIs(): Promise<PassDigest>;
}

export function benchFor(args: {
  engine: ScenarioEngine;
  scenario: { id: string; name: string; overrides: ScenarioOverride[] };
  horizon: number;
  activity: string;
  world(name: "reality" | "scenario"): Promise<SimExport>;
}): OptionBench {
  let opened: Promise<OpenBench> | null = null;
  const bench: OptionBench = {
    horizon: args.horizon,
    activity: args.activity,
    tested: [],
    opened: null,
    open() {
      opened ??= (async () => {
        // The page builds its map from the twin as it stands and sends the
        // engine the twin read through the scenario. Same here, or the two
        // would count different sites.
        const [reality, system] = await Promise.all([args.world("reality"), args.world("scenario")]);
        const runner = new ScenarioRunner(args.engine, {
          reality,
          system,
          scenario: { id: args.scenario.id, name: args.scenario.name },
          horizon: args.horizon,
          activity: args.activity,
        });
        if (!runner.ctx.activities.includes(args.activity)) {
          throw new ToolError(
            `No site on the map provides "${args.activity}", so there is nothing to read a run on. The activities are: ${runner.ctx.activities.join(", ") || "none"}.`,
          );
        }
        const stamps = stampsOf(args.scenario.overrides);
        const refs = choiceRefs(args.scenario.overrides);
        const choices = new Map<string, ChoiceStamp>();
        for (const s of stamps) {
          const ref = refs.get(s.id);
          if (ref && isChoice(s)) choices.set(ref, s as ChoiceStamp);
        }
        let asItIs: Promise<PassDigest> | null = null;
        const open: OpenBench = {
          runner,
          stamps,
          choices,
          basis: scenarioBasis(stamps, runner.ctx, args.activity),
          asItIs: () => {
            if (!asItIs) {
              // One pass, not the page's two: the column an option is set
              // beside is the scenario with its choices, and the events-only
              // pass shows nothing this comparison reads.
              const attempt = runner.full(stamps);
              asItIs = attempt;
              // A run that failed is asked again by the next option, not remembered.
              attempt.catch(() => {
                if (asItIs === attempt) asItIs = null;
              });
            }
            return asItIs;
          },
        };
        bench.opened = open;
        return open;
      })();
      const attempt = opened;
      attempt.catch(() => {
        if (opened === attempt) opened = null;
      });
      return opened;
    },
  };
  return bench;
}

/** The engine's own refusal is something to read; an engine that is down is not. */
async function engineRun<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof AppError && err.code === "SIM_REFUSED") {
      throw new ToolError(`The engine refused this run: ${err.message} Nothing was tested.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// What a tested option is, kept whole.
// ---------------------------------------------------------------------------

/** One column of the comparison: a run's figures, as the engine counted them. */
export interface OptionFigures {
  /** Highest capacity-weighted occupancy across every site, as a share; null when the run reports none. */
  peakOccupancy: number | null;
  peakDay: number | null;
  sitesWithQueue: number;
  sitesWithActivity: number;
  firstQueueDay: number | null;
  /** People waiting at the end of each day, summed over the run. */
  waitingDays: number;
  peakWaiting: number;
  peakWaitingDay: number;
  /** Patient-days waiting in catchments no site serves; null when there are none. */
  strandedWaitingDays: number | null;
}

type SiteBreakDigest = RunDigest["sites"][number]["events"];

/** A stamp as the page writes it: what "Add to scenario" creates. */
export interface OptionStamp {
  body: StampBody;
  start: number;
  days: number;
}

/** A choice of the scenario an option takes out: replaced by one of its stamps, or removed. */
export interface RetiredChoice {
  /** The stamp's id in the scenario when the option was tested: what "Add to scenario" takes out. */
  id: string;
  /** The choice as it stood, as the page wrote it. */
  stamp: OptionStamp;
  /** The same, as a line. */
  text: string;
  /** Position, in the option's stamps, of what takes its place; null when it is removed. */
  replacedBy: number | null;
}

/** One thing an option does to the scenario, as the screen says it. Written by the program. */
export interface OptionChange {
  does: "adds" | "replaces" | "removes";
  /** What is in the scenario once it is applied; null for a removal. */
  now: string | null;
  /** The scenario's choice it takes out; null for an addition. */
  was: string | null;
}

export interface TestedOption {
  label: string;
  /** The stamps the option writes: what it adds, and what it puts in place of a choice. */
  stamps: OptionStamp[];
  /** The scenario's choices it takes out. Empty for an option that only adds. */
  retires: RetiredChoice[];
  /** What it adds, replaces and removes, in the order asked. */
  changes: OptionChange[];
  horizon: number;
  activity: string;
  ranAt: string;
  asItIs: OptionFigures;
  withOption: OptionFigures;
  /** Sites where somebody waits in either run. */
  sites: { id: string; name: string; capacity: number; asItIs: SiteBreakDigest; withOption: SiteBreakDigest }[];
  /** What this option rests on, each with its level of evidence. */
  basis: Basis[];
  /** Arrivals a day by severity with the option: what a follow-up sets beside what was observed. */
  arrivals: Record<string, number[]>;
  notes: string[];
  /**
   * What the test's time was made of: reading the twin (the first test only),
   * then each call to the engine. Kept in the journal so that how long a test
   * takes is something measured; it is not a result and no sentence rests on it.
   */
  timing: { twinMs: number; engine: EngineTiming[]; totalMs: number };
}

function figuresOf(v: RunDigest["events"]): OptionFigures {
  let peakOccupancy: number | null = null;
  let peakDay: number | null = null;
  v.island.forEach((x, t) => {
    if (x !== null && (peakOccupancy === null || x > peakOccupancy)) {
      peakOccupancy = x;
      peakDay = t;
    }
  });
  return {
    peakOccupancy,
    peakDay,
    sitesWithQueue: v.sitesWithQueue,
    sitesWithActivity: v.sitesWithActivity,
    firstQueueDay: v.firstQueueDay,
    waitingDays: v.waitingDays,
    peakWaiting: v.peakWaiting,
    peakWaitingDay: v.peakWaitingDay,
    strandedWaitingDays: v.strandedWaitingDays,
  };
}

const people = (n: number) => Math.round(n).toLocaleString("en-CA");

/** What the twin itself says about the places an option touches. */
function measuredFor(stamps: Stamp[], ctx: TwinContext): Basis[] {
  const out: Basis[] = [];
  const seen = new Set<string>();
  for (const s of stamps) {
    if (s.kind === "capacity") {
      const key = `${s.facility}\u0000${s.activity}`;
      const f = ctx.facilities.find((x) => x.id === s.facility);
      if (!f || seen.has(key)) continue;
      seen.add(key);
      out.push({ element: `${f.name} holds ${people(f.capacity[s.activity] ?? 0)} ${s.activity} today`, evidence: "measured", from: "twin" });
      const listing = ctx.populations.filter((p) => p.servedBy.includes(f.id));
      if (listing.length) {
        out.push({
          element: `${f.name} is where the patients of ${listing.map((p) => p.name).join(", ")} can go (${people(listing.reduce((n, p) => n + p.size, 0))} residents)`,
          evidence: "measured",
          from: "twin",
        });
      }
    }
    if (s.kind === "measure" && s.populations) {
      for (const id of s.populations) {
        const p = ctx.populations.find((x) => x.id === id);
        if (!p || seen.has(id)) continue;
        seen.add(id);
        out.push({ element: `${p.name} has ${people(p.size)} residents`, evidence: "measured", from: "twin" });
      }
    }
  }
  return out;
}

/** What every column of the comparison shares: the scenario and the network it runs on. */
export function scenarioBasis(stamps: Stamp[], ctx: TwinContext, activity: string): Basis[] {
  const providing = ctx.facilities.filter((f) => (f.capacity[activity] ?? 0) > 0);
  const units = providing.reduce((n, f) => n + (f.capacity[activity] ?? 0), 0);
  const sized = ctx.populations.filter((p) => p.size > 0);
  return [
    { element: `${providing.length} sites provide ${activity}, ${people(units)} units in all`, evidence: "measured", from: "twin" },
    { element: `${sized.length} catchments, ${people(sized.reduce((n, p) => n + p.size, 0))} residents`, evidence: "measured", from: "twin" },
    ...stamps.flatMap((s) => basisOfStamp(s, ctx, "scenario")),
    {
      element: "A catchment's patients go only to the sites that list it, in proportion to their units; nobody is transferred between sites",
      evidence: "assumption",
      from: "engine",
    },
  ];
}

// ---------------------------------------------------------------------------
// The tool.
// ---------------------------------------------------------------------------

const choiceRef = z.string().trim().min(1).max(60);
// With `replaces`, a change says only what differs from the choice it takes
// the place of, so every field of the stamp is optional here and required,
// for a plain addition, where the stamp is written.
const change = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("capacity"),
    replaces: choiceRef.optional(),
    site: z.string().min(1).max(300).optional(),
    activity: z.string().min(1).max(120).optional(),
    units: z.number().int().optional(),
    from_day: z.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal("measure"),
    replaces: choiceRef.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    layers: z.array(z.object({ layer: z.string().min(1).max(120), factor: z.number().min(0).max(5) })).min(1).max(8).optional(),
    catchments: z.array(z.string().min(1).max(300)).max(60).optional(),
    from_day: z.number().int().min(0).optional(),
    days: z.number().int().min(1).optional(),
  }),
  z.object({ kind: z.literal("remove"), ref: choiceRef }),
]);
type Change = z.infer<typeof change>;
type Placed = Exclude<Change, { kind: "remove" }>;

/** A field a plain addition must give, and a replacement may leave to the choice it replaces. */
function missing(field: string, kind: string): never {
  throw new ToolError(
    `A ${kind} change needs "${field}". Only a change that replaces a choice of the scenario (replaces: its ref) may leave a field out, to keep the choice's own.`,
  );
}

/**
 * The choice of the scenario a change names, or a refusal that says what can
 * be named.
 *
 * Only a choice can be: a measure or capacity the planner placed. A starting
 * condition is where the run starts and an event is what happens to the city;
 * an option that took one out would be testing another scenario and calling
 * it a response.
 */
function choiceNamed(open: OpenBench, named: string, kind: Change["kind"]): ChoiceStamp {
  const ctx = open.runner.ctx;
  const hit = open.choices.get(named.toLowerCase());
  if (!hit) {
    const stamp = open.stamps.find((s) => s.id === named);
    if (stamp && isChoice(stamp)) return stamp as ChoiceStamp;
    const listed = [...open.choices].map(([ref, s]) => `${ref}: ${choiceLine(s, ctx)}`);
    const what = stamp
      ? `"${named}" is ${["seed", "heat"].includes(stamp.kind) ? "an event" : "a starting condition"} of the scenario, not a choice`
      : `The scenario holds no choice called "${named}"`;
    throw new ToolError(
      `${what}. An option replaces or removes only what the planner chose (a measure, capacity): starting conditions and events are what happens, and an option does not undo them. ` +
        (listed.length ? `The scenario's choices are: ${listed.join("; ")}.` : "This scenario contains no choice, so there is nothing to replace or remove: add capacity or a measure instead."),
    );
  }
  if (kind !== "remove" && hit.kind !== kind) {
    throw new ToolError(
      `${named} is ${hit.kind === "capacity" ? "capacity" : "a measure"} (${choiceLine(hit, ctx)}): it is replaced by a change of the same kind. To put ${kind === "capacity" ? "capacity" : "a measure"} in its place, remove it and add the new change, in the same option.`,
    );
  }
  return hit;
}

function requireActivityOf(ctx: TwinContext, asked: string): string {
  const hit = ctx.activities.find((a) => a === asked) ?? ctx.activities.find((a) => fold(a) === fold(asked));
  if (!hit) throw new ToolError(`No site provides "${asked}". The activities in this twin are: ${ctx.activities.join(", ") || "none"}. Use one of these names exactly.`);
  return hit;
}

/**
 * One change, checked against the twin and written as the stamp the page would
 * write. `old` is the choice it replaces, when it replaces one: what the change
 * does not say is kept from it.
 */
function stampOf(c: Placed, ctx: TwinContext, bench: OptionBench, id: string, old: ChoiceStamp | null): ChoiceStamp {
  const { horizon } = bench;
  const from = c.from_day ?? old?.start ?? missing("from_day", c.kind);
  if (from >= horizon) {
    throw new ToolError(`from_day ${from} is after the last day of the run: options are tested over ${horizon} days, numbered 0 to ${horizon - 1}.`);
  }
  if (c.kind === "capacity") {
    const was = old?.kind === "capacity" ? old : null;
    const activity = requireActivityOf(ctx, c.activity ?? was?.activity ?? bench.activity);
    const site = c.site !== undefined ? pick(ctx.facilities, c.site, "site") : was ? ctx.facilities.find((f) => f.id === was.facility) : undefined;
    if (!site) {
      if (was) throw new ToolError(`The choice being replaced is at a site the twin no longer places on the map (${was.facility}). Name the site the units go to.`);
      missing("site", c.kind);
    }
    const units = c.units ?? was?.amount ?? missing("units", c.kind);
    const held = site.capacity[activity] ?? 0;
    if (held <= 0) {
      const able = ctx.facilities.filter((f) => (f.capacity[activity] ?? 0) > 0);
      throw new ToolError(
        `${site.name} does not provide ${activity} today, so a run cannot say what units added there would do. ` +
          `Sites that provide it: ${able
            .slice(0, 12)
            .map((f) => `${f.name} (${f.id})`)
            .join("; ")}${able.length > 12 ? "; …" : ""}.`,
      );
    }
    if (units === 0) {
      throw new ToolError(
        was
          ? "A choice replaced by no unit is a choice removed: use a change of kind \"remove\" with its ref."
          : "An option that changes no unit changes nothing. Give the number of units to add (or, negative, to close).",
      );
    }
    if (-units > held) throw new ToolError(`${site.name} holds ${held} ${activity}: ${-units} cannot be closed there.`);
    return { id, kind: "capacity", facility: site.id, activity, amount: units, start: from, days: Math.max(1, horizon - from) };
  }
  const was = old?.kind === "measure" ? old : null;
  const layers = c.layers ?? was?.layers ?? missing("layers", c.kind);
  const unknown = layers.filter((l) => !ctx.couplings.includes(l.layer));
  if (unknown.length) {
    throw new ToolError(
      ctx.couplings.length
        ? `The twin declares no contact layer called ${unknown.map((l) => `"${l.layer}"`).join(", ")}. A measure can scale: ${ctx.couplings.join(", ")}.`
        : "The twin declares no contact layer, so no measure can be tested on it. Capacity can.",
    );
  }
  // Catchments left unsaid: a replacement covers what the choice covered, an
  // addition covers every catchment.
  const moved = c.catchments !== undefined || !was;
  const asked = c.catchments ?? [];
  const populations = moved ? (asked.length ? [...new Set(asked.map((q) => pick(ctx.populations, q, "catchment").id))] : null) : was!.populations;
  return {
    id,
    kind: "measure",
    label: c.name ?? was?.label ?? missing("name", c.kind),
    layers,
    // Where the planner dropped it on the map: kept while it covers the same catchments.
    at: moved ? null : was!.at,
    radiusKm: moved ? null : was!.radiusKm,
    populations,
    start: from,
    days: Math.max(1, Math.min(c.days ?? was?.days ?? missing("days", c.kind), horizon - from)),
  };
}

/** The same stamp in other words: a replacement that changes nothing. */
const sameChoice = (a: Stamp, b: Stamp) => JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b));

/** A stamp, as a line the model and a person can both read. */
function describeChange(s: Stamp, ctx: TwinContext): Record<string, unknown> {
  if (s.kind === "capacity") {
    return {
      what: "capacity",
      site: ctx.facilities.find((f) => f.id === s.facility)?.name ?? s.facility,
      site_id: s.facility,
      activity: s.activity,
      units_added: s.amount,
      from_day: s.start,
    };
  }
  if (s.kind === "measure") {
    return {
      what: "measure",
      name: s.label,
      contact_layers: s.layers,
      where: s.populations === null ? "every catchment" : s.populations.map((id) => ctx.populations.find((p) => p.id === id)?.name ?? id),
      from_day: s.start,
      days: s.days,
    };
  }
  return { what: s.kind };
}

const bodyOf = (s: Stamp): OptionStamp => {
  const { id: _id, start, days, ...body } = s;
  return { body: body as StampBody, start, days };
};

export const testOption: AnalystTool = {
  name: "test_option",
  description:
    "Run one option through the simulation engine and read what it changes. An option is a label and one to four changes to the open scenario. A change adds something: capacity (units of an activity added at a site from a day; negative closes units) or a measure (contact layers scaled in some catchments for some days). " +
    "Or it acts on a choice the scenario already contains, named by the ref scenario_recipe gives it: 'replaces' puts this change in its place (say only what differs: other units, another day, another duration), and kind 'remove' takes it out. To test fewer units or another date than a choice of the scenario, replace that choice; do not stack a second change on top of it. " +
    "Returns the scenario as it is and the scenario with this option, side by side: peak occupancy, sites where somebody waits, patient-days waiting, first day somebody waits, and each site with a queue. " +
    `At most ${MAX_OPTIONS} options can be tested for one objective, and each takes the engine some seconds, so read first and test what the reading points to. Nothing is written: the scenario is unchanged until the person adds the option themselves.`,
  busy: "Testing an option in the engine",
  input_schema: obj(
    {
      label: { type: "string", description: "The option in a few words, as the person would say it: 'Open 40 beds at Lakeshore from day 10'." },
      changes: {
        type: "array",
        description: `One to ${MAX_CHANGES} changes that together make the option.`,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["capacity", "measure", "remove"], description: "capacity or measure: something placed. remove: a choice of the scenario taken out, named by ref." },
            replaces: {
              type: "string",
              description:
                "capacity or measure: the ref of a choice of the scenario of the same kind (scenario_recipe: choices[].ref) that this change takes the place of. Fields left out keep that choice's own value.",
            },
            ref: { type: "string", description: "remove: the ref of the choice of the scenario to take out." },
            site: { type: "string", description: "capacity: the site's id or name. It must already provide the activity." },
            activity: { type: "string", description: "capacity: the activity whose units change. Default: the activity the run reads." },
            units: { type: "integer", description: "capacity: units added from from_day until the end of the run. Negative closes units." },
            name: { type: "string", description: "measure: what it is called, e.g. 'Schools closed'." },
            layers: {
              type: "array",
              description: "measure: the contact layers it scales, as describe_twin names them (couples_along). factor 0 removes the contact, 0.5 halves it, above 1 increases it.",
              items: {
                type: "object",
                properties: { layer: { type: "string" }, factor: { type: "number" } },
                required: ["layer", "factor"],
                additionalProperties: false,
              },
            },
            catchments: { type: "array", items: { type: "string" }, description: "measure: ids or names of the catchments it covers. Empty or absent: every catchment." },
            from_day: { type: "integer", description: "First day it applies, counted from day 0 of the run." },
            days: { type: "integer", description: "measure: how many days it lasts." },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      },
    },
    ["label", "changes"],
  ),
  parse: z.object({ label: z.string().trim().min(3).max(160), changes: z.array(change).min(1).max(MAX_CHANGES) }),
  async run(ctx: AnalystContext, input: { label: string; changes: Change[] }) {
    const bench = ctx.bench;
    if (!bench) {
      throw new ToolError(
        "Options are tested from the Options tab, with a scenario open. Here you can only read: say what would have to be placed on the map and run.",
      );
    }
    if (bench.tested.length >= MAX_OPTIONS) {
      throw new ToolError(
        `${MAX_OPTIONS} options have already been tested for this objective, which is the limit. Compare those; the person can state the objective again to test others.`,
      );
    }
    const startedAt = Date.now();
    const open = await bench.open();
    const twinMs = Date.now() - startedAt;
    const { runner } = open;
    const callsBefore = runner.timings.length;
    // What the option writes, and what it takes out of the scenario.
    const option: ChoiceStamp[] = [];
    const retired: { old: ChoiceStamp; replacedBy: number | null }[] = [];
    const moves: { does: OptionChange["does"]; now: ChoiceStamp | null; was: ChoiceStamp | null }[] = [];
    input.changes.forEach((c, i) => {
      const named = c.kind === "remove" ? c.ref : c.replaces;
      const old = named === undefined ? null : choiceNamed(open, named, c.kind);
      if (old && retired.some((r) => r.old.id === old.id)) {
        throw new ToolError(`${named} is named twice in this option. A choice is replaced or removed once.`);
      }
      if (c.kind === "remove") {
        retired.push({ old: old!, replacedBy: null });
        moves.push({ does: "removes", now: null, was: old });
        return;
      }
      const stamp = stampOf(c, runner.ctx, bench, `option-${bench.tested.length + 1}-${i + 1}`, old);
      if (old && sameChoice(old, stamp)) {
        throw new ToolError(`This replaces ${named} with itself (${choiceLine(old, runner.ctx)}), which changes nothing. Say what differs: the units, the day, the duration.`);
      }
      if (old) retired.push({ old, replacedBy: option.length });
      moves.push({ does: old ? "replaces" : "adds", now: stamp, was: old });
      option.push(stamp);
    });
    const key = JSON.stringify({ writes: option.map(bodyOf), retires: retired.map((r) => [r.old.id, r.replacedBy]) });
    if (bench.tested.includes(key)) throw new ToolError("This option was already tested for this objective: its result is in an earlier step. Test something different, or deliver.");

    const asItIs = await engineRun(() => open.asItIs());
    const applied = ScenarioRunner.withOption(open.stamps, option, new Set(retired.map((r) => r.old.id)));
    const tested = await engineRun(() => runner.full(applied));
    bench.tested.push(key);

    const before = new Map(asItIs.sites.map((s) => [s.id, s.break]));
    // Both passes list the sites the twin gives the activity to, so a site
    // missing from one is a fault of ours, not something to paper over.
    const was = (id: string) => {
      const b = before.get(id);
      if (!b) throw new Error(`test_option: site ${id} is in the tested run and not in the scenario's own.`);
      return b;
    };
    const waits = tested.sites.filter((s) => s.break.firstDay !== null || was(s.id).firstDay !== null);
    const basis: Basis[] = [
      ...option.flatMap((s) => basisOfStamp(s, runner.ctx, "option")),
      // Taking a choice out is as much a supposition as placing one.
      ...retired.map((r) => ({ element: `Takes out of the scenario: ${choiceLine(r.old, runner.ctx)}`, evidence: "assumption" as const, from: "option" as const })),
      ...measuredFor([...option, ...retired.map((r) => r.old)], runner.ctx),
    ];
    const notes = [...new Set(tested.figures.notes)];

    const record: TestedOption = {
      label: input.label,
      stamps: option.map(bodyOf),
      retires: retired.map((r) => ({ id: r.old.id, stamp: bodyOf(r.old), text: choiceLine(r.old, runner.ctx), replacedBy: r.replacedBy })),
      changes: moves.map((m) => ({
        does: m.does,
        now: m.now ? choiceLine(m.now, runner.ctx) : null,
        was: m.was ? choiceLine(m.was, runner.ctx) : null,
      })),
      horizon: bench.horizon,
      activity: bench.activity,
      ranAt: tested.ranAt,
      asItIs: figuresOf(asItIs.figures),
      withOption: figuresOf(tested.figures),
      sites: waits.map((s) => ({ id: s.id, name: s.name, capacity: s.capacity, asItIs: was(s.id), withOption: s.break })),
      basis,
      arrivals: tested.figures.arrivals,
      notes,
      timing: { twinMs, engine: runner.timings.slice(callsBefore), totalMs: Date.now() - startedAt },
    };
    return new Recorded(
      {
        option: input.label,
        changes: moves.map((m) =>
          m.does === "adds"
            ? { does: "adds", ...describeChange(m.now!, runner.ctx) }
            : m.does === "replaces"
              ? { does: "replaces", ...describeChange(m.now!, runner.ctx), instead_of: describeChange(m.was!, runner.ctx) }
              : { does: "removes", ...describeChange(m.was!, runner.ctx) },
        ),
        tested_over: { days: bench.horizon, activity: bench.activity },
        scenario_as_it_is: summariseVariant(asItIs.figures),
        with_this_option: summariseVariant(tested.figures),
        sites_where_somebody_waits_in_either: waits.map((s) => ({
          id: s.id,
          name: s.name,
          usual_units: s.capacity,
          as_it_is: summariseBreak(was(s.id)),
          with_this_option: summariseBreak(s.break),
        })),
        rests_on: basis.map((b) => ({ element: b.element, evidence: b.evidence })),
        how_to_read:
          "Both columns are runs of the engine under the scenario's stated conditions, not forecasts. 'scenario_as_it_is' holds the choices the scenario already contains; " +
          "'with_this_option' applies this option's changes to them: what it adds, and what it replaces or removes among those choices. " +
          "Occupancy stops at 100 %; the queue is what says somebody was turned away. " +
          "The run knows nothing of staff, stocks or transfers between sites.",
      },
      record,
    );
  },
};

/** What the analyst can call when options can be tested. */
export const OPTION_TOOLS: AnalystTool[] = [...READ_TOOLS, testOption];

// ---------------------------------------------------------------------------
// What the model is told.
// ---------------------------------------------------------------------------

export const OPTIONS_PROMPT = `You are the analyst inside Obscyro, a decision-support tool built on the digital twin of a health network. A planner or a manager has stated an objective for the scenario open on their map. Your job is to propose up to three options that could meet it, test each one through the simulation engine, and set out what the tests show so that the person can decide. You do not decide.

# What you know

Nothing, until you read it. You have no knowledge of this network: not its hospitals, not its bed counts, not its population. Everything you say about it must come from a tool result in this conversation. General knowledge about health systems may shape which options you think of, but it is never the source of a figure and never a fact about this network.

Each tool result comes back as {"step": "s3", "result": ...}. The step id is how you cite it.

# Figures

This rule is enforced by a program, not left to you:

- Every figure you write must appear in the result of a step the same text cites, or in the person's own objective. A mechanism is checked against the result of its own option's test.
- A figure you derive (a difference, a ratio, a percentage) must be computed with the calculate tool, and the paragraph must cite that step. Do not do arithmetic yourself.
- You may round a figure the way a person would. You may not change it.
- A figure the checker cannot find is sent back to you, and if it still cannot be found it is removed and replaced by a gap the person will see. If you cannot source a figure, write the sentence without it.

The comparison table the person sees is built from the test results themselves, not from your text. You do not need to repeat every figure: say what the figures mean for the objective.

# How to work

1. Understand the situation before proposing anything. If a run is on screen, read it (read_run: summary, then sites). Look at where the queue is and why: the site, the catchments whose patients go there, what the scenario already contains (scenario_recipe, get_site, compare_catchments). If you do not know the names this twin uses, call describe_twin first.
2. Choose options that act on the mechanism you read. Capacity where the queue is, or at another site the same catchment's patients can go to; earlier or later; more or fewer units. A measure on a contact layer only if the scenario contains an outbreak and the twin declares that layer. Make the options genuinely different from each other unless the objective is about size or timing. Respect any limit the person stated (a number of beds, a date).
   When the option is a choice the scenario already contains, done differently (fewer or more units, another day, another duration), replace that choice: read its ref in scenario_recipe and give it as "replaces", with only what differs. When the option is the scenario without one of its choices, remove it by its ref. Never shrink or move a choice by stacking a second change on top of it: the scenario would hold two stamps where the person means one. Starting conditions and events have no ref and cannot be replaced or removed.
3. Test each option with test_option. At most three tests. If a test is refused, read why: a refused test does not count and tells you what to change.
4. An option you did not test is not an option. An idea the engine cannot test (staff, stocks, transferring patients between sites: the twin holds none of them) belongs in limits, not in options.
5. When the tests are done, call give_options once, on its own, with nothing else in that turn.

Most objectives take two to five reads and two or three tests. Do not call a tool twice with the same input.

# What you deliver

- options: one entry for every option you tested, in the order tested. For each:
  - mechanism: one sentence that says why this option changes what it changes, or why it does not: which patients reach which beds. Not a list of figures.
  - not_tested: what this test does not say and the person should know before acting on it. One short sentence each.
- reading: one to three short paragraphs, in plain words, on what the tests show against the stated objective: which tested options meet it according to the runs, which do not, and by how much. If none meets it, say so plainly. Each paragraph cites the steps it rests on.
- human_choices: the trade-offs between these options that only a person can weigh: who waits and where, how much capacity for how much waiting, an earlier date against a larger number. State each trade-off; do not settle it.
- limits: what the twin or the engine cannot say that matters for this objective. One short sentence each.
- focus_sites: ids of up to five sites the options are about.

# What you do not do

- You do not recommend, rank by preference, or call an option "the best". You may say which tested options meet the stated objective according to the runs, because that is reading a result. Choosing between them is the person's.
- You do not present a run as a prediction. It is what the model gives under the scenario's stated conditions.
- You do not claim anything was changed. test_option writes nothing, whether it adds, replaces or removes: the scenario is as the person left it.
- You follow the system, not people. The twin holds counts and capacities, never a person's record.

Write in the language the person wrote in, in plain words. Name sites and catchments as the twin names them.`;

const GIVE_OPTIONS: Anthropic.Beta.BetaTool = {
  name: "give_options",
  description:
    "Deliver the tested options to the person. Call it once, on its own, after your tests. List every option you tested. Every figure must be in the result of a step the same text cites (a mechanism: its own option's test), or in the objective.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      options: {
        type: "array",
        description: "One entry per option tested, in the order tested.",
        items: {
          type: "object",
          properties: {
            step: { type: "string", description: "The id of the test_option step that tested it, for example \"s4\"." },
            mechanism: { type: "string", description: "One sentence: why this option changes what it changes, or why it does not." },
            not_tested: { type: "array", items: { type: "string" }, description: "What this test does not say. One short sentence each. May be empty." },
          },
          required: ["step", "mechanism", "not_tested"],
          additionalProperties: false,
        },
      },
      reading: {
        type: "array",
        description: "One to three short paragraphs on what the tests show against the stated objective.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Plain sentences. No markdown, no lists, no headings." },
            sources: { type: "array", items: { type: "string" }, description: "Ids of the steps this paragraph's figures and claims come from." },
          },
          required: ["text", "sources"],
          additionalProperties: false,
        },
      },
      human_choices: { type: "array", items: { type: "string" }, description: "Trade-offs between the options that only a person can weigh. May be empty." },
      limits: { type: "array", items: { type: "string" }, description: "What the twin or the engine cannot say that matters here. May be empty." },
      focus_sites: { type: "array", items: { type: "string" }, description: "Ids of up to five sites the options are about." },
    },
    required: ["options", "reading", "human_choices", "limits", "focus_sites"],
    additionalProperties: false,
  },
};

const line = z.string().trim().min(1).max(600);
const optionsInput = z.object({
  options: z.array(z.object({ step: z.string().max(12), mechanism: z.string().trim().min(1).max(700), not_tested: z.array(line).max(8) })).max(MAX_OPTIONS),
  reading: z
    .array(z.object({ text: z.string().trim().min(1).max(2400), sources: z.array(z.string().max(12)).max(40) }))
    .min(1)
    .max(4),
  human_choices: z.array(line).max(8),
  limits: z.array(line).max(10),
  focus_sites: z.array(z.string().max(80)).max(10),
});
type OptionsInput = z.infer<typeof optionsInput>;

// ---------------------------------------------------------------------------
// What the person receives.
// ---------------------------------------------------------------------------

export interface ProposedOption {
  /** The step that tested it: what a decision is recorded against. */
  step: string;
  label: string;
  stamps: OptionStamp[];
  /** The scenario's choices it takes out: what "Add to scenario" deletes once the stamps are written. */
  retires: RetiredChoice[];
  /** What it adds, replaces and removes, as the screen says it. */
  changes: OptionChange[];
  figures: OptionFigures;
  sites: TestedOption["sites"];
  basis: Basis[];
  arrivals: Record<string, number[]>;
  notes: string[];
  mechanism: string;
  notTested: string[];
}

export interface OptionsProposal {
  objective: string;
  horizon: number;
  activity: string;
  /** The scenario as it stands: the column every option is read against. Null when nothing was tested. */
  asItIs: OptionFigures | null;
  options: ProposedOption[];
  /** What every column shares: the scenario's conditions, events and choices, and the network. */
  basis: Basis[];
  reading: { text: string; sources: string[] }[];
  humanChoices: string[];
  limits: string[];
  focusSites: string[];
}

export interface OptionsFinding {
  where: "reading" | "mechanism" | "not_tested" | "human_choice" | "limit";
  /** The option's step, for a mechanism or a not_tested line. */
  option: string | null;
  /** Position in its list, from zero. */
  index: number;
  figures: string[];
  /**
   * Set when the figures exist but were written beside the wrong name: what
   * each was said of, and whose row holds it.
   */
  misattributed?: { figure: string; saidOf: string; belongsTo: string[] }[];
}

export interface OptionsAsk {
  objective: string;
}

const isTest = (s: Step) => s.tool === testOption.name && s.ok && s.record !== undefined;

function openingFor(ctx: AnalystContext, input: OptionsAsk): string {
  const bench = ctx.bench!;
  const lines = [
    `Environment: ${ctx.environment}`,
    `Open scenario: "${ctx.scenario?.name ?? ""}". Read the 'scenario' world unless you need to compare with reality.`,
    `Options are tested over ${bench.horizon} days, reading the activity "${bench.activity}".`,
    ctx.run
      ? `A run is on screen: ${ctx.run.horizon} days, activity "${ctx.run.activity}", ran at ${ctx.run.ranAt}` +
        (ctx.run.stale ? ". The scenario was edited after it, so it is out of date: rely on the tests, which run the scenario as it is now." : ", up to date with the scenario.")
      : "No run is on screen. The first option you test also returns the scenario as it is.",
  ];
  return `<context>\n${lines.join("\n")}\n</context>\n\n<objective>\n${input.objective}\n</objective>`;
}

function describeFindings(findings: OptionsFinding[]): string {
  const say = (f: OptionsFinding) => {
    const figures = f.figures.map((x) => `"${x}"`).join(", ");
    const verb = f.figures.length === 1 ? "is" : "are";
    if (f.misattributed) {
      const place = f.where === "mechanism" ? `Option ${f.option}, mechanism` : `Reading, paragraph ${f.index + 1}`;
      return f.misattributed
        .map(
          (m) =>
            `- ${place}: "${m.figure}" is written about ${m.saidOf}, but in the steps cited that figure is in the row of ${m.belongsTo.join(" or ")}, not in ${m.saidOf}'s. Re-read the rows and correct the sentence.`,
        )
        .join("\n");
    }
    switch (f.where) {
      case "reading":
        return `- Reading, paragraph ${f.index + 1}: ${figures} ${verb} not in the results of the steps it cites nor in the objective.`;
      case "mechanism":
        return `- Option ${f.option}, mechanism: ${figures} ${verb} not in the result of ${f.option} nor in the objective.`;
      case "not_tested":
        return `- Option ${f.option}, not_tested ${f.index + 1}: ${figures} ${verb} not in any result read.`;
      case "human_choice":
        return `- Human choice ${f.index + 1}: ${figures} ${verb} not in any result read.`;
      default:
        return `- Limit ${f.index + 1}: ${figures} ${verb} not in any result read.`;
    }
  };
  return (
    "The options were not delivered. These figures could not be traced, or are written beside the wrong name:\n" +
    findings.map(say).join("\n") +
    "\nFor a figure that could not be traced: cite the step that holds it, or compute it with calculate and cite that step, or rewrite the sentence without the figure. " +
    "For a figure beside the wrong name: go back to the row of that name in the step and copy its own figure. Then call give_options again with everything."
  );
}

/**
 * How an exchange about options ends.
 *
 * The model's part is words: a mechanism per option, what the tests show, what
 * is left to the person. Everything with a number in it that reaches the
 * comparison — the figures, the stamps, the levels of evidence — is taken here
 * from the records of the tests, and the words are checked against the steps.
 */
export function optionsClosing(ctx: AnalystContext, input: OptionsAsk): Closing<OptionsInput, OptionsProposal, OptionsFinding> {
  return {
    system: OPTIONS_PROMPT,
    tool: GIVE_OPTIONS,
    opening: openingFor(ctx, input),
    asked: input.objective,
    nudge: "Deliver the options by calling give_options, with each paragraph citing the steps it rests on. Do not answer in plain text.",
    words: {
      declined: "The model declined to work on this objective. Nothing was made up in its place. Try stating what should change on the map: a queue at a site, patient-days waiting, a date.",
      tooMuch: "The objective needed more reading than one exchange allows. State it for one site, one catchment or one part of the run.",
      noForm: "The analyst did not deliver its options in a form that could be checked, so none is shown.",
      tooLong: "The analyst read for too long without delivering options. State a narrower objective.",
    },
    parse(raw, read) {
      const parsed = optionsInput.safeParse(raw);
      if (!parsed.success) {
        return { invalid: `The options were not delivered: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.` };
      }
      const tested = read.steps.filter(isTest).map((s) => s.id);
      const listed = parsed.data.options.map((o) => o.step);
      const strangers = listed.filter((id) => !tested.includes(id));
      if (strangers.length) {
        return {
          invalid: `The options were not delivered: ${strangers.join(", ")} ${strangers.length === 1 ? "is" : "are"} not a step where test_option ran an option. Tested so far: ${tested.join(", ") || "none"}. An option that was not tested cannot be listed.`,
        };
      }
      if (new Set(listed).size !== listed.length) return { invalid: "The options were not delivered: a step is listed twice." };
      const hidden = tested.filter((id) => !listed.includes(id));
      if (hidden.length) {
        return {
          invalid: `The options were not delivered: ${hidden.join(", ")} ${hidden.length === 1 ? "was" : "were"} tested but ${hidden.length === 1 ? "is" : "are"} not listed. The person sees every option that was tested, including one that did not help.`,
        };
      }
      return { data: parsed.data };
    },
    check(data, read, final) {
      const everything = new Ledger();
      everything.absorb(read.question);
      for (const l of read.ledgers.values()) everything.absorb(l);
      const known = new Set(read.steps.map((s) => s.id));
      const findings: OptionsFinding[] = [];
      // The same two controls as an answer's paragraphs: a figure nobody
      // returned, and (where a text rests on named rows) a figure that exists
      // but is written beside the wrong site or catchment.
      const checked = (text: string, ledger: Ledger, at: Omit<OptionsFinding, "figures" | "misattributed">, rows = false): string => {
        const bad = unsourced(text, ledger);
        if (bad.length) findings.push({ ...at, figures: bad.map((t) => t.raw) });
        const taken = new Set(bad.map((t) => t.start));
        const swapped = rows ? ledger.misattributed(text).filter((m) => !taken.has(m.token.start)) : [];
        if (swapped.length) {
          findings.push({
            ...at,
            figures: swapped.map((m) => m.token.raw),
            misattributed: swapped.map((m) => ({ figure: m.token.raw, saidOf: m.saidOf, belongsTo: m.belongsTo })),
          });
        }
        return strike(text, [...bad, ...swapped.map((m) => m.token)]);
      };

      const reading = data.reading.map((p, index) => {
        // A source that names no step is dropped rather than trusted.
        const sources = [...new Set(p.sources)].filter((id) => known.has(id));
        const own = new Ledger();
        own.absorb(read.question);
        for (const id of sources) own.absorb(read.ledgers.get(id)!);
        return { text: checked(p.text, own, { where: "reading", option: null, index }, true), sources };
      });
      const options = data.options.map((o) => {
        const own = new Ledger();
        own.absorb(read.question);
        own.absorb(read.ledgers.get(o.step)!);
        return {
          step: o.step,
          mechanism: checked(o.mechanism, own, { where: "mechanism", option: o.step, index: 0 }, true),
          notTested: o.not_tested.map((t, index) => checked(t, everything, { where: "not_tested", option: o.step, index })),
        };
      });
      const humanChoices = data.human_choices.map((t, index) => checked(t, everything, { where: "human_choice", option: null, index }));
      const limits = data.limits.map((t, index) => checked(t, everything, { where: "limit", option: null, index }));

      if (findings.length && !final) return { sendBack: describeFindings(findings) };

      const records = new Map(read.steps.filter(isTest).map((s) => [s.id, s.record as TestedOption]));
      const first = options.length ? records.get(options[0]!.step)! : null;
      const bench = ctx.bench!;
      return {
        answer: {
          objective: input.objective,
          horizon: bench.horizon,
          activity: bench.activity,
          asItIs: first ? first.asItIs : null,
          options: options.map((o) => {
            const r = records.get(o.step)!;
            return {
              step: o.step,
              label: r.label,
              stamps: r.stamps,
              retires: r.retires,
              changes: r.changes,
              figures: r.withOption,
              sites: r.sites,
              basis: r.basis,
              arrivals: r.arrivals,
              notes: r.notes,
              mechanism: o.mechanism,
              notTested: o.notTested,
            };
          }),
          // What the columns rest on. With no column there is nothing to rest.
          basis: options.length ? (bench.opened?.basis ?? []) : [],
          reading,
          humanChoices,
          limits,
          focusSites: data.focus_sites.slice(0, 5),
        },
        struck: findings,
      };
    },
  };
}
