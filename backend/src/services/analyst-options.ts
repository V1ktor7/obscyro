import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { formatCents, ledgerOf, type CostLedger } from "./cost-ledger.js";
import { DEFAULT_ACTION_TYPES, actionFor, fitCapacity, fitMeasure, fitResponse, fitTransfer, saidOf, type ActionType, type ChangeAction } from "./action-types.js";
import { catalogueOf, modesFor, priceFor, type PriceCatalogue } from "./price-catalogue.js";
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
import { declaresCost, describeResponse, listResponses, listedResponses, responseNamed, transferRoutes, transferRule } from "./analyst-responses.js";
import { Ledger, strike, unsourced } from "./analyst-verify.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import { ROUTE_CAPACITY, ScenarioRunner, type EngineTiming, type PassDigest, type ScenarioEngine } from "./scenario-run.js";
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
 * measure on a contact layer, a recorded response, a transfer of patients
 * between two sites — and the only way it can say what that would change is to
 * run it: `test_option` applies the option to the open scenario (stamps added,
 * and a choice the scenario already holds replaced or removed), runs the
 * scenario on the server the way the page runs it, and returns the figures
 * beside those of the scenario as it stands.
 *
 * A recorded response is a stamp like the others (`response`), so the same
 * run tests it: there is one way of asking "what if", not two
 * (`analyst-responses.ts`).
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
  /** The twin as the engine is sent it: what a recorded response is read against. */
  system: SimExport;
  /** The twin's transfer routes: where a transfer of patients can be tested. */
  routes: { source: string; target: string }[];
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
          system,
          routes: transferRoutes(system, runner.ctx),
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
  /**
   * The action type it falls under, when the project declared it: its name and
   * who can approve it. Absent for a removal, and in a project that declared
   * no action type.
   */
  action?: ChangeAction;
}

/**
 * What a run cost, as far as anything says.
 *
 * The engine counts one thing: the cost a rule of a recorded response declares
 * for its action, each time the action fires. Capacity and measures carry no
 * price in the twin, and a response whose rules declare none is unpriced, not
 * free. So a cost is `complete` only for an option made of a priced response
 * and nothing else, and only complete costs can be set against one another.
 */
export interface OptionCost {
  /**
   * What the run cost, in dollars, as far as anything says: what the engine
   * counted for a recorded response, plus what the twin's price list gives for
   * the capacity the option opens. Null when nothing is priced.
   */
  counted: number | null;
  /** True when that figure is the whole cost of what the option changes. */
  complete: boolean;
  /** The same, as a sentence written by the program. */
  says: string;
  /**
   * True when an amount behind the count has no source: a price row that names
   * none, or the amount a rule of a recorded response declares, which is written
   * in the engine or typed with the response and comes from no price list.
   * Absent when nothing is counted, and from records kept before it was said.
   */
  demo?: boolean;
  /**
   * What the twin's price list gives for the capacity the option opens, line
   * by line, in whole cents. Absent when the twin declares no price list: a run
   * is then costed exactly as it was before there could be one.
   */
  priced?: CostLedger;
}

const money = (n: number) => `${Math.round(n).toLocaleString("en-CA")} $`;

/** The recorded response a set of stamps makes a run follow: the first by day, as the run picks it. */
const followedIn = (stamps: readonly Stamp[]) => stamps.find((s): s is Stamp & { kind: "response" } => s.kind === "response") ?? null;

/**
 * The cost of one run.
 *
 * `unpriced` counts what the option changes that carries no price: capacity
 * or a measure it adds, replaces or removes.
 */
export function costOf(stamps: readonly Stamp[], unpriced: number, counted: number): OptionCost {
  const followed = followedIn(stamps);
  if (!followed) return { counted: null, complete: false, says: "No cost is counted for this run: capacity and measures carry no price in the twin." };
  if (followed.source !== "built-in" && !declaresCost(followed.rules)) {
    return { counted: null, complete: false, says: `No cost is counted for this run: the rules of “${followed.name}” declare none. That is unpriced, not free.` };
  }
  const base = `The engine counted ${money(counted)} for “${followed.name}”: each of its actions at the cost its rule declares, each time it fired.`;
  // What a rule declares has no source, whoever wrote the rule: a demo price, like a price row that names none.
  return unpriced > 0
    ? { counted, complete: false, says: `${base} The capacity or measures this option also changes carry no price, so this is not the whole cost of the option.`, demo: true }
    : { counted, complete: true, says: base, demo: true };
}

/**
 * A run's cost, with what the price list gives for its capacity.
 *
 * `engine` is the cost as the engine counted it (`costOf`), already told how
 * many of the option's changes nothing prices. The two amounts are added only
 * when both exist; neither stands in for the other, and a part nothing prices
 * keeps the whole from being called complete.
 */
export function withPriceList(engine: OptionCost, ledger: CostLedger, unpriced: number, followed: boolean): OptionCost {
  // The list exists and prices nothing of this option: the count is what it was, and the ledger says why.
  if (ledger.lines.length === 0) {
    // Without a recorded response the engine's sentence says the twin holds no price, which this twin does.
    return followed
      ? { ...engine, priced: ledger }
      : { counted: null, complete: false, says: "No cost is counted for this run: the twin’s price list prices nothing this option changes. That is unpriced, not free.", priced: ledger };
  }
  const total = ledger.totalCents / 100;
  const range = ledger.ranged ? `, between ${formatCents(ledger.lowCents)} and ${formatCents(ledger.highCents)}` : "";
  const list =
    `The price list gives ${formatCents(ledger.totalCents)}${range} for the capacity this option opens: opening it, then keeping it open for the days of the run.` +
    (ledger.demo ? " At least one of these prices has no source: it is a demo price." : "");
  if (!followed) {
    return unpriced > 0
      ? { counted: total, complete: false, says: `${list} The rest of what this option changes carries no price, so this is not the whole cost of the option.`, demo: ledger.demo, priced: ledger }
      : { counted: total, complete: true, says: list, demo: ledger.demo, priced: ledger };
  }
  // A recorded response is in the run too: what the engine counted for it, when its rules declare a cost.
  if (engine.counted === null) return { counted: total, complete: false, says: `${list} ${engine.says}`, demo: ledger.demo, priced: ledger };
  // The amounts its rules declare have no source: the sum is a demo price whatever the price list says of its rows.
  return { counted: engine.counted + total, complete: engine.complete, says: `${engine.says} ${list}`, demo: true, priced: ledger };
}

/** The prices a ledger used, as what the option rests on: published when the row names its source, assumed when it does not. */
function priceBasis(ledger: CostLedger): Basis[] {
  const seen = new Set<string>();
  const out: Basis[] = [];
  for (const l of ledger.lines) {
    if (seen.has(l.price.id)) continue;
    seen.add(l.price.id);
    const rows = ledger.lines.filter((x) => x.price.id === l.price.id);
    const amounts = rows
      .map((x) => (x.price.unit ? `${formatCents(x.price.unit.cents)} ${x.category === "opening" ? "to open a unit" : "a unit a day"}` : `by the formula ${x.price.formula}`))
      .join(", ");
    out.push({
      element: `Price of ${l.activity}, mode “${l.price.mode}”${l.price.ofSite ? `, at ${l.site}` : ""}: ${amounts}. ${l.price.source ? `Source: ${l.price.source}` : "A demo price: the price list gives it no source"}`,
      evidence: l.price.source ? "published" : "assumption",
      from: "twin",
    });
  }
  return out;
}

/**
 * The mode a capacity change uses, checked against the price list. Null when
 * the list does not price the change, which then carries no mode.
 *
 * A mode is a price and a delay. The decision is taken on day 0 of the run, so
 * a change cannot be open before the days its mode takes: one that asks for it
 * is refused, with the day it can be open and the modes that are fast enough.
 */
function settleMode(asked: string | undefined, s: ChoiceStamp & { kind: "capacity" }, catalogue: PriceCatalogue, ctx: TwinContext): string | null {
  const site = ctx.facilities.find((f) => f.id === s.facility)?.name ?? s.facility;
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (s.amount <= 0) {
    if (asked) throw new ToolError(`A mode is a way of opening units, with its price and its delay. This change closes units at ${site}: leave mode out.`);
    return null;
  }
  const choice = priceFor(catalogue, s.activity, asked ?? null, s.facility);
  if (choice.priced === false) {
    if (asked) throw new ToolError(`The price list holds no price for ${s.activity} at ${site}, so there is no mode to choose: leave mode out. list_prices says what is priced.`);
    return null;
  }
  if (choice.priced === null) throw new ToolError(choice.why);
  const e = choice.entry;
  if (s.start < e.leadDays) {
    const faster = modesFor(catalogue, s.activity, s.facility).filter((m) => m.id !== e.id && m.leadDays <= s.start);
    throw new ToolError(
      `In mode “${e.mode}”, ${s.activity} at ${site} takes ${days(e.leadDays)} to be available. The decision is taken on day 0 of the run, so these units cannot be open on day ${s.start}: ask for day ${e.leadDays} or later` +
        (faster.length ? `, or use ${faster.map((m) => `mode “${m.mode}” (${days(m.leadDays)})`).join(" or ")}.` : "."),
    );
  }
  return e.mode;
}

/** What the price list gives for an option, as the model reads it. Nothing when the twin declares no price list. */
function priceLines(l: CostLedger | null): Record<string, unknown> {
  if (l === null) return {};
  return {
    cost_from_the_price_list:
      l.lines.length === 0
        ? "The price list prices nothing this option changes."
        : {
            total_dollars: l.totalCents / 100,
            ...(l.ranged ? { low_dollars: l.lowCents / 100, high_dollars: l.highCents / 100 } : {}),
            contains_a_demo_price: l.demo,
            lines: l.lines.map((x) => ({
              what: x.category,
              site: x.site,
              activity: x.activity,
              mode: x.price.mode,
              amount_dollars: x.cents / 100,
              arithmetic: x.says,
              ...(x.price.source ? { source: x.price.source } : { demo_price: true }),
            })),
          },
    ...(l.unpriced.length ? { not_priced: l.unpriced.map((u) => u.why) } : {}),
    ...(l.availability.length
      ? { available: l.availability.map((a) => ({ site: a.site, activity: a.activity, mode: a.mode, takes_days: a.leadDays, open_from_day: a.fromDay })) }
      : {}),
  };
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
  /** What each of the two runs cost, as far as anything says. */
  asItIsCost: OptionCost;
  cost: OptionCost;
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

/** One pass of the engine as a column of the comparison. A retest of a prepared response reads its two runs through this too. */
export function figuresOf(v: RunDigest["events"]): OptionFigures {
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
    if (s.kind === "response") {
      const name = (id: unknown) => ctx.facilities.find((x) => x.id === id)?.name ?? String(id);
      const transfers = s.rules.map((r) => (r.action ?? {}) as { kind?: string; source?: string; target?: string }).filter((a) => a.kind === "transfer");
      // The first few: a response written from the network can hold a rule for every route.
      for (const a of transfers.slice(0, 6)) {
        const key = `route\u0000${a.source}\u0000${a.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ element: `The twin holds a transfer route from ${name(a.source)} to ${name(a.target)}`, evidence: "measured", from: "twin" });
      }
      if (transfers.length || s.source === "built-in") {
        out.push({
          element: `A route carries at most ${ROUTE_CAPACITY} patients a day: the twin holds no flow for its routes, so the run gives each the same`,
          evidence: "assumption",
          from: "engine",
        });
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
      element: "A catchment's patients go only to the sites that list it, in proportion to their units; nobody is transferred between sites unless a recorded response does it",
      evidence: "assumption",
      from: "engine",
    },
  ];
}

// ---------------------------------------------------------------------------
// The tool.
// ---------------------------------------------------------------------------

const choiceRef = z.string().trim().min(1).max(60);
/** The action type a change falls under, by the ref list_actions gives. Left out, it is the one type of its kind. */
const actionRef = z.string().trim().min(1).max(80).optional();
// With `replaces`, a change says only what differs from the choice it takes
// the place of, so every field of the stamp is optional here and required,
// for a plain addition, where the stamp is written.
const change = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("capacity"),
    action: actionRef,
    replaces: choiceRef.optional(),
    site: z.string().min(1).max(300).optional(),
    activity: z.string().min(1).max(120).optional(),
    units: z.number().int().optional(),
    from_day: z.number().int().min(0).optional(),
    // A way of opening the units the price list prices: its price, and the days it takes.
    mode: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    kind: z.literal("measure"),
    action: actionRef,
    replaces: choiceRef.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    layers: z.array(z.object({ layer: z.string().min(1).max(120), factor: z.number().min(0).max(5) })).min(1).max(8).optional(),
    catchments: z.array(z.string().min(1).max(300)).max(60).optional(),
    from_day: z.number().int().min(0).optional(),
    days: z.number().int().min(1).optional(),
  }),
  z.object({ kind: z.literal("remove"), ref: choiceRef }),
  // A recorded response, by the ref list_responses gives it.
  z.object({ kind: z.literal("response"), action: actionRef, response: z.string().trim().min(1).max(200), from_day: z.number().int().min(0).optional() }),
  // Waiting patients sent from one site to another, along a route the twin holds.
  z.object({
    kind: z.literal("transfer"),
    action: actionRef,
    from: z.string().min(1).max(300),
    to: z.string().min(1).max(300),
    patients_per_day: z.number().int().min(1),
    from_day: z.number().int().min(0),
  }),
]);
type Change = z.infer<typeof change>;
/** A change written as a stamp of its own: capacity, or a measure. */
type Placed = Extract<Change, { kind: "capacity" | "measure" }>;
type ResponseStamp = Stamp & { kind: "response" };

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
    const is = hit.kind === "capacity" ? "capacity" : hit.kind === "measure" ? "a measure" : "a recorded response";
    throw new ToolError(
      `${named} is ${is} (${choiceLine(hit, ctx)}): ${hit.kind === "response" ? "it is not replaced by capacity or a measure" : "it is replaced by a change of the same kind"}. To put ${kind === "capacity" ? "capacity" : "a measure"} in its place, remove it and add the new change, in the same option.`,
    );
  }
  return hit;
}

/** The stamp a `response` change places: a recorded response, as the library or the engine holds it. */
async function responseStamp(c: Extract<Change, { kind: "response" }>, ctx: AnalystContext, open: OpenBench, bench: OptionBench, id: string): Promise<ResponseStamp> {
  const { horizon } = bench;
  const r = responseNamed(listedResponses((await ctx.responses?.()) ?? [], open.system), c.response);
  if (r.source === "built-in") {
    if (c.from_day) {
      throw new ToolError(`“${r.name}” is written by the engine from the network and applies for the whole run: it cannot start on day ${c.from_day}. Leave from_day out.`);
    }
    return { id, kind: "response", name: r.name, source: "built-in", ref: r.stampRef, rules: [], start: 0, days: horizon };
  }
  if (r.rules.length === 0) throw new ToolError(`“${r.name}” holds no rule, so testing it would test nothing.`);
  const from = c.from_day ?? 0;
  if (from >= horizon) {
    throw new ToolError(`from_day ${from} is after the last day of the run: options are tested over ${horizon} days, numbered 0 to ${horizon - 1}.`);
  }
  return { id, kind: "response", name: r.name, source: "stored", ref: r.stampRef, rules: r.rules, start: from, days: Math.max(1, horizon - from) };
}

/**
 * The stamp the `transfer` changes of one option place: one response, a rule
 * per transfer. Every refusal says what can be asked instead.
 */
function transfersStamp(asked: Extract<Change, { kind: "transfer" }>[], open: OpenBench, bench: OptionBench, id: string): ResponseStamp {
  const ctx = open.runner.ctx;
  const { horizon, activity } = bench;
  // The severity that occupies what the run reads: those are the patients its queue counts.
  const acuity = ctx.care.find((x) => x.activity === activity)?.acuity ?? null;
  const seen = new Set<string>();
  const lines: string[] = [];
  const rules = asked.map((c, k) => {
    const source = pick(ctx.facilities, c.from, "site");
    const target = pick(ctx.facilities, c.to, "site");
    if (source.id === target.id) throw new ToolError(`A transfer goes from one site to another: both ends are ${source.name}.`);
    if (!open.routes.some((r) => r.source === source.id && r.target === target.id)) {
      const out = open.routes.filter((r) => r.source === source.id).map((r) => ctx.facilities.find((f) => f.id === r.target)?.name ?? r.target);
      throw new ToolError(
        `The twin holds no transfer route from ${source.name} to ${target.name}, so a run cannot send anyone that way. ` +
          (out.length
            ? `From ${source.name}, waiting patients can be sent to: ${out.slice(0, 12).join("; ")}${out.length > 12 ? "; …" : ""}.`
            : `It holds no route out of ${source.name} at all.`) +
          " list_responses with routes_from lists them with their units.",
      );
    }
    if ((target.capacity[activity] ?? 0) <= 0) {
      throw new ToolError(`${target.name} does not provide ${activity}, so nobody waiting for it can be served there. Send them to a site that does.`);
    }
    if (c.patients_per_day > ROUTE_CAPACITY) {
      throw new ToolError(
        `A route carries at most ${ROUTE_CAPACITY} patients a day in a run: the twin holds no flow for its routes, so the run gives each the same. Ask for ${ROUTE_CAPACITY} or fewer.`,
      );
    }
    if (c.from_day >= horizon) {
      throw new ToolError(`from_day ${c.from_day} is after the last day of the run: options are tested over ${horizon} days, numbered 0 to ${horizon - 1}.`);
    }
    const key = `${source.id}\u0000${target.id}`;
    if (seen.has(key)) throw new ToolError(`The route from ${source.name} to ${target.name} is named twice in this option. Give it once.`);
    seen.add(key);
    lines.push(`${source.name} to ${target.name}`);
    return transferRule({ id: `transfer-${k + 1}`, source: source.id, target: target.id, activity, acuity, perDay: c.patients_per_day, fromDay: c.from_day });
  });
  const start = Math.min(...asked.map((c) => c.from_day));
  const name = `Transfer from ${lines.join(", and from ")}`;
  return { id, kind: "response", name: name.length > 160 ? `${name.slice(0, 157)}…` : name, source: "written", ref: "", rules, start, days: Math.max(1, horizon - start) };
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
  if (s.kind === "response") return describeResponse(s, ctx);
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
    "Run one option through the simulation engine and read what it changes. An option is a label and one to four changes to the open scenario. A change adds something: capacity (units of an activity added at a site from a day; negative closes units), a measure (contact layers scaled in some catchments for some days), " +
    "a transfer (waiting patients sent from one site to another, each day, along a route the twin holds: list_responses with routes_from says which), or a recorded response (rules the engine follows at every step, named by the ref list_responses gives). A run follows one recorded response: an option holds either one 'response' change or 'transfer' changes, which together make one. " +
    "Or it acts on a choice the scenario already contains, named by the ref scenario_recipe gives it: 'replaces' puts this change in its place (say only what differs: other units, another day, another duration), and kind 'remove' takes it out. To test fewer units or another date than a choice of the scenario, replace that choice; do not stack a second change on top of it. " +
    "Returns the scenario as it is and the scenario with this option, side by side: peak occupancy, sites where somebody waits, patient-days waiting, first day somebody waits, and each site with a queue. " +
    "When the twin declares a price list (list_prices), it also returns what the capacity this option opens costs, line by line, and the day each change is open. " +
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
            kind: {
              type: "string",
              enum: ["capacity", "measure", "transfer", "response", "remove"],
              description: "capacity, measure, transfer or response: something placed. remove: a choice of the scenario taken out, named by ref.",
            },
            action: {
              type: "string",
              description:
                "capacity, measure, transfer or response: the ref of the action type this change falls under, as list_actions gives it. Needed when the project has several action types of that kind; it may be left out when it has one.",
            },
            response: { type: "string", description: "response: the ref of a recorded response, as list_responses gives it." },
            from: { type: "string", description: "transfer: the id or name of the site whose waiting patients are sent away." },
            to: { type: "string", description: "transfer: the id or name of the site they are sent to. A transfer route must go from the first to this one, and it must provide the activity." },
            patients_per_day: { type: "integer", description: "transfer: how many waiting patients at most are sent each day. They are sent only when somebody waits at the source and the destination has a free unit." },
            replaces: {
              type: "string",
              description:
                "capacity or measure: the ref of a choice of the scenario of the same kind (scenario_recipe: choices[].ref) that this change takes the place of. Fields left out keep that choice's own value.",
            },
            ref: { type: "string", description: "remove: the ref of the choice of the scenario to take out." },
            site: { type: "string", description: "capacity: the site's id or name. It must already provide the activity." },
            activity: { type: "string", description: "capacity: the activity whose units change. Default: the activity the run reads." },
            units: { type: "integer", description: "capacity: units added from from_day until the end of the run. Negative closes units." },
            mode: {
              type: "string",
              description:
                "capacity: the mode the units are opened in, as list_prices names it, when the price list prices this activity in more than one. A mode has its price and takes its days: from_day cannot be earlier than the days the mode takes. Leave it out when the price list holds no price for the activity.",
            },
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
            from_day: { type: "integer", description: "First day it applies, counted from day 0 of the run. A response the engine writes itself applies for the whole run: leave it out." },
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
    // The price list the twin declares, read through the scenario. Empty in a twin that declares none.
    const catalogue = catalogueOf(open.system);
    const listed = catalogue.entries.length > 0 || catalogue.problems.length > 0;
    // What the project lets an option contain. Undeclared, the four built-in types: everything, unbounded.
    const types: readonly ActionType[] = (await ctx.actions?.()) ?? DEFAULT_ACTION_TYPES;
    // The mode each capacity stamp of the option uses, by the stamp's id.
    const modes = new Map<string, string | null>();
    // What the option writes, and what it takes out of the scenario.
    const option: ChoiceStamp[] = [];
    const retired: { old: ChoiceStamp; replacedBy: number | null }[] = [];
    const moves: { does: OptionChange["does"]; now: ChoiceStamp | null; was: ChoiceStamp | null; action?: ChangeAction | null }[] = [];
    const transfers: Extract<Change, { kind: "transfer" }>[] = [];
    const recorded: Extract<Change, { kind: "response" }>[] = [];
    input.changes.forEach((c, i) => {
      // A recorded response is one stamp for the option, written once the other changes are read.
      if (c.kind === "transfer") return void transfers.push(c);
      if (c.kind === "response") return void recorded.push(c);
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
      // Refused here, before anything runs: a change outside what its action type allows,
      // a mode the list does not have, or a day its delay does not allow.
      const type = actionFor(types, c.kind, c.action);
      if (stamp.kind === "capacity" && type.effect === "capacity") {
        const mode = fitCapacity(type, { facility: stamp.facility, activity: stamp.activity, amount: stamp.amount, start: stamp.start, mode: c.kind === "capacity" ? c.mode : undefined }, runner.ctx);
        modes.set(stamp.id, settleMode(mode, stamp, catalogue, runner.ctx));
      } else if (stamp.kind === "measure" && type.effect === "measure") {
        fitMeasure(type, { layers: stamp.layers, populations: stamp.populations, start: stamp.start, days: stamp.days }, runner.ctx);
      }
      if (old) retired.push({ old, replacedBy: option.length });
      moves.push({ does: old ? "replaces" : "adds", now: stamp, was: old, action: saidOf(type) });
      option.push(stamp);
    });
    if (recorded.length + (transfers.length ? 1 : 0) > 1) {
      throw new ToolError(
        "A run follows one recorded response, so an option holds one: either a single 'response' change, or 'transfer' changes, which together make one response. Test the other as another option.",
      );
    }
    if (recorded.length || transfers.length) {
      const id = `option-${bench.tested.length + 1}-response`;
      // Each transfer against its action type, before the stamp is written: a refusal names the bound.
      const sending = transfers.map((c) => {
        const type = actionFor(types, "transfer", c.action);
        if (type.effect === "transfer") {
          fitTransfer(
            type,
            { source: pick(runner.ctx.facilities, c.from, "site").id, target: pick(runner.ctx.facilities, c.to, "site").id, perDay: c.patients_per_day, start: c.from_day },
            runner.ctx,
          );
        }
        return type;
      });
      const placed = recorded.length ? await responseStamp(recorded[0]!, ctx, open, bench, id) : transfersStamp(transfers, open, bench, id);
      let under = sending[0] ?? null;
      if (recorded.length) {
        const type = actionFor(types, "response", recorded[0]!.action);
        if (type.effect === "response") {
          const known = listedResponses((await ctx.responses?.()) ?? [], open.system).map((r) => ({ id: r.stampRef, name: r.name }));
          fitResponse(type, { ref: placed.ref, name: placed.name, start: placed.start }, known);
        }
        under = type;
      }
      const held = open.stamps.find((s): s is ResponseStamp => s.kind === "response" && !retired.some((r) => r.old.id === s.id));
      if (held) {
        const ref = [...open.choices].find(([, s]) => s.id === held.id)?.[0] ?? held.id;
        throw new ToolError(
          `The scenario already follows a recorded response (${ref}: ${choiceLine(held, runner.ctx)}), and a run follows one at a time. Take it out in the same option, with a change of kind "remove" and its ref, to test this one in its place.`,
        );
      }
      moves.push({ does: "adds", now: placed, was: null, action: under ? saidOf(under) : null });
      option.push(placed);
    }
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
    // What the price list gives for the capacity the option opens. Null in a twin that declares no price list.
    const siteName = (id: string) => runner.ctx.facilities.find((f) => f.id === id)?.name ?? id;
    const ledger = listed
      ? ledgerOf(
          option.flatMap((s, i) =>
            s.kind === "capacity"
              ? [{ stamp: i, siteId: s.facility, siteName: siteName(s.facility), activity: s.activity, units: s.amount, start: s.start, days: s.days, mode: modes.get(s.id) ?? null }]
              : [],
          ),
          catalogue,
        )
      : null;
    const pricedStamps = new Set((ledger?.lines ?? []).map((l) => l.stamp));
    // What each run cost, as far as anything says. What the option changes that nothing prices: a measure,
    // capacity the price list does not hold, a choice of the scenario it takes out.
    const unpriced = option.filter((s, i) => s.kind !== "response" && !pricedStamps.has(i)).length + retired.filter((r) => r.old.kind !== "response").length;
    const asItIsCost = costOf(open.stamps, 0, asItIs.cost);
    const engineCost = costOf(applied, unpriced, tested.cost);
    const cost = ledger ? withPriceList(engineCost, ledger, unpriced, followedIn(applied) !== null) : engineCost;
    // A price is something the option rests on: published when its row names a source, assumed when it does not.
    if (ledger) basis.push(...priceBasis(ledger));
    // Said only when a recorded response is in one of the two runs: without one, nothing is counted and nothing is new to read.
    const costLine = (c: OptionCost, stamps: readonly Stamp[]) =>
      followedIn(stamps)
        ? c.counted === null
          ? { cost: c.says }
          : { cost_counted_by_the_engine: c.counted, cost_how_to_read: `${c.says} The amounts a rule declares have no source: this is a demo price.` }
        : {};

    const record: TestedOption = {
      label: input.label,
      stamps: option.map(bodyOf),
      retires: retired.map((r) => ({ id: r.old.id, stamp: bodyOf(r.old), text: choiceLine(r.old, runner.ctx), replacedBy: r.replacedBy })),
      changes: moves.map((m) => ({
        does: m.does,
        now: m.now ? choiceLine(m.now, runner.ctx) : null,
        was: m.was ? choiceLine(m.was, runner.ctx) : null,
        ...(m.action ? { action: m.action } : {}),
      })),
      horizon: bench.horizon,
      activity: bench.activity,
      ranAt: tested.ranAt,
      asItIs: figuresOf(asItIs.figures),
      withOption: figuresOf(tested.figures),
      asItIsCost,
      cost,
      sites: waits.map((s) => ({ id: s.id, name: s.name, capacity: s.capacity, asItIs: was(s.id), withOption: s.break })),
      basis,
      arrivals: tested.figures.arrivals,
      notes,
      timing: { twinMs, engine: runner.timings.slice(callsBefore), totalMs: Date.now() - startedAt },
    };
    return new Recorded(
      {
        option: input.label,
        changes: moves.map((m) => {
          // Said only for a type the project declared: who approves is theirs to have written.
          const under = m.action ? { action_type: m.action.name, ...(m.action.approver ? { approved_by: m.action.approver } : {}) } : {};
          return m.does === "adds"
            ? { does: "adds", ...describeChange(m.now!, runner.ctx), ...under }
            : m.does === "replaces"
              ? { does: "replaces", ...describeChange(m.now!, runner.ctx), ...under, instead_of: describeChange(m.was!, runner.ctx) }
              : { does: "removes", ...describeChange(m.was!, runner.ctx) };
        }),
        tested_over: { days: bench.horizon, activity: bench.activity },
        scenario_as_it_is: { ...summariseVariant(asItIs.figures), ...costLine(asItIsCost, open.stamps) },
        with_this_option: {
          ...summariseVariant(tested.figures),
          ...costLine(engineCost, applied),
          ...priceLines(ledger),
          // The two together, when the price list prices something: what a comparison of costs reads.
          ...(ledger && ledger.lines.length ? { cost_of_this_option: { dollars: cost.counted, is_the_whole_cost: cost.complete, how_to_read: cost.says } } : {}),
        },
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
          "The run knows nothing of staff or stocks, and nobody is transferred between sites unless a recorded response in the run does it." +
          (ledger
            ? " 'cost_from_the_price_list' is what the twin's price list gives for the capacity this option opens: opening it, then keeping it open for the days of the run. It is not what the network costs to run. A demo price has no source: call it one whenever you give it, or a total that contains it."
            : ""),
      },
      record,
    );
  },
};

/** What the analyst can call when options can be tested. */
export const OPTION_TOOLS: AnalystTool[] = [...READ_TOOLS, listResponses, testOption];

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
2. Choose options that act on the mechanism you read. Capacity where the queue is, or at another site the same catchment's patients can go to; earlier or later; more or fewer units. A measure on a contact layer only if the scenario contains an outbreak and the twin declares that layer. A transfer of waiting patients from the site where the queue is to a site with free units, when the twin holds a route between them: read list_responses (with routes_from, the site) before testing one. A response recorded in the organisation's library or written by the engine, when list_responses shows one that acts on the mechanism. Make the options genuinely different from each other unless the objective is about size or timing. Respect any limit the person stated (a number of beds, a date).
   When the option is a choice the scenario already contains, done differently (fewer or more units, another day, another duration), replace that choice: read its ref in scenario_recipe and give it as "replaces", with only what differs. When the option is the scenario without one of its choices, remove it by its ref. Never shrink or move a choice by stacking a second change on top of it: the scenario would hold two stamps where the person means one. Starting conditions and events have no ref and cannot be replaced or removed.
3. Test each option with test_option. At most three tests. If a test is refused, read why: a refused test does not count and tells you what to change.
4. An option you did not test is not an option. An idea the engine cannot test (staff, stocks: the twin holds neither) belongs in limits, not in options.
   A cost appears in a test from two places only. The twin's price list (list_prices) prices the capacity an option opens: opening it, then keeping it open, in a mode that has its own price and takes its own number of days. And a recorded response's rules may declare a cost, which the engine counts. Measures carry no price. Never give a cost the test did not return, never estimate a price the list does not hold, and never say an option is free: say there is no price for it.
   When the price list prices an activity in several modes, they are the way to offer options that differ by speed and by cost: the same units sooner at a higher price, or later at a lower one. Read list_prices before testing, name the mode of each capacity change, and respect its delay: the decision is taken on day 0, so units opened in a mode that takes 14 days cannot be open before day 14. Whenever you give a demo price, or a total that contains one, say it is a demo price.
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

- You do not recommend, rank by preference, or call an option "the best". You may say which tested options meet the stated objective according to the runs, because that is reading a result. Choosing between them is the person's. The screen itself marks an option that costs no less and leaves no less waiting than another; you do not need to.
- You do not present a run as a prediction. It is what the model gives under the scenario's stated conditions.
- You do not claim anything was changed. test_option writes nothing, whether it adds, replaces or removes: the scenario is as the person left it.
- You follow the system, not people. The twin holds counts and capacities, never a person's record.

Write in the language the person wrote in, in plain words. Name sites and catchments as the twin names them.`;

/**
 * What is added to the instructions in a project that declared action types.
 *
 * A project that declared none is told nothing new and is offered no new tool:
 * its four built-in types cover everything the analyst could already propose,
 * so it works exactly as it did.
 */
export const ACTIONS_PROMPT = `

# What this project lets you propose

This project declared its action types: the kinds of change an option may contain here, each with its bounds, the days it takes before it can apply, and who can approve it. Read them with list_actions before you think of options.

- Propose only what an action type covers, inside its bounds. Give each change of test_option its action type ("action": the ref list_actions gives).
- A test outside a bound is refused, with the bound. Read it and stay inside: do not ask for the same thing again.
- An idea no action type covers is not an option, however good. Put it in limits, and say that no action type of this project covers it.
- An action type that is switched off, or that list_actions says cannot be tested, is not to be proposed. Say so in limits, with what it is missing.
- An action type says what may be proposed and who can approve it. It decides nothing: the person still chooses, and still applies the option themselves.`;

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
  /** What its run cost, as far as anything says: what "dominated" is read from, with the figures. */
  cost: OptionCost;
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
  /** What the scenario as it stands cost in its run. Null when nothing was tested. */
  asItIsCost: OptionCost | null;
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
export function optionsClosing(ctx: AnalystContext, input: OptionsAsk, declared: { actionTypes: boolean } = { actionTypes: false }): Closing<OptionsInput, OptionsProposal, OptionsFinding> {
  return {
    system: declared.actionTypes ? OPTIONS_PROMPT + ACTIONS_PROMPT : OPTIONS_PROMPT,
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
      // Shown in the order they were tested, whatever order the model lists them
      // in: an order the model chose would be a ranking, and nothing here ranks.
      const order = read.steps.filter(isTest).map((s) => s.id);
      const options = data.options
        .map((o) => {
          const own = new Ledger();
          own.absorb(read.question);
          own.absorb(read.ledgers.get(o.step)!);
          return {
            step: o.step,
            mechanism: checked(o.mechanism, own, { where: "mechanism", option: o.step, index: 0 }, true),
            notTested: o.not_tested.map((t, index) => checked(t, everything, { where: "not_tested", option: o.step, index })),
          };
        })
        .sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step));
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
          asItIsCost: first ? first.asItIsCost : null,
          options: options.map((o) => {
            const r = records.get(o.step)!;
            return {
              step: o.step,
              label: r.label,
              stamps: r.stamps,
              retires: r.retires,
              changes: r.changes,
              figures: r.withOption,
              cost: r.cost,
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
