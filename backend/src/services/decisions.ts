import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import type { OptionChange, OptionCost, OptionFigures, OptionStamp, ProposedOption, RetiredChoice } from "./analyst-options.js";
import { alignSeries, compareSeries, type Fit } from "./observed-series.js";
import type { ScenarioOverride } from "./scenario-overrides.js";
import type { Basis } from "./scenario-stamps.js";

/**
 * Decisions: what a person retained, and what they expected of it.
 *
 * The analyst proposes and the engine tests; a person decides. A decision is
 * kept with the figures of the run that tested the option, so that later it
 * can be set beside what happened. Two rules hold the record honest:
 *
 * - the expected figures are copied here, by the server, from the journalled
 *   exchange (`app.analyst_exchange`). The browser names an exchange and a
 *   step; it never sends a figure. An option the engine did not test cannot be
 *   recorded;
 * - the follow-up reports the gap and stops. Whether the decision was right is
 *   not something a difference between two series can say, and it is not the
 *   tool's to say.
 */

// ---------------------------------------------------------------------------
// From a journalled exchange to a decision.
// ---------------------------------------------------------------------------

export interface DecisionExpected {
  horizon: number;
  activity: string;
  /** The scenario as it stood when the option was tested. */
  asItIs: OptionFigures;
  /** The same scenario with the option: what the person expects. */
  withOption: OptionFigures;
  sites: ProposedOption["sites"];
  /** Arrivals a day by severity with the option. */
  arrivals: Record<string, number[]>;
  /** What the run rests on: the option's own basis, then the scenario's. */
  basis: Basis[];
  /**
   * What the option does to the scenario, as the screen said it, and the
   * choices it takes out. Absent from decisions recorded before an option
   * could replace or remove a choice: those only added.
   */
  changes?: OptionChange[];
  retires?: RetiredChoice[];
  mechanism: string;
  notTested: string[];
  notes: string[];
  /**
   * What the engine counted as the cost of the tested run, and whether that is
   * the whole cost of the option. Absent from decisions recorded before an
   * option could contain a recorded response: nothing was counted then.
   */
  cost?: OptionCost;
  /**
   * The same two runs made again on the network as it was when the signal
   * opened: what the card showed when a prepared response was engaged.
   * `current` says whether the card still called it a test of the current
   * state at that moment. Absent when no such test had given figures.
   * `asItIs` and `withOption` above stay those of the test the response was
   * kept from: the sites and the arrivals go with them.
   */
  retested?: { testedAt: string; current: boolean; asItIs: OptionFigures; withOption: OptionFigures };
}

export interface SourceStep {
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
}

export interface DecisionDraft {
  objective: string;
  optionStep: string;
  optionLabel: string;
  optionStamps: OptionStamp[];
  expected: DecisionExpected;
  sourceSteps: SourceStep[];
}

/** A journalled exchange, as much of it as a decision reads. */
export interface JournalledExchange {
  kind: string;
  status: string;
  question: string;
  answer: unknown;
  steps: unknown;
}

const figures = z.object({
  peakOccupancy: z.number().nullable(),
  peakDay: z.number().nullable(),
  sitesWithQueue: z.number(),
  sitesWithActivity: z.number(),
  firstQueueDay: z.number().nullable(),
  waitingDays: z.number(),
  peakWaiting: z.number(),
  peakWaitingDay: z.number(),
  strandedWaitingDays: z.number().nullable(),
});
const basis = z.object({ element: z.string(), evidence: z.enum(["measured", "published", "assumption"]), from: z.enum(["twin", "scenario", "option", "engine"]) });
const journalledStamp = z.object({ body: z.record(z.unknown()), start: z.number().int(), days: z.number().int() });
const journalledProposal = z.object({
  objective: z.string(),
  horizon: z.number().int(),
  activity: z.string(),
  asItIs: figures.nullable(),
  basis: z.array(basis),
  reading: z.array(z.object({ text: z.string(), sources: z.array(z.string()) })),
  options: z.array(
    z.object({
      step: z.string(),
      label: z.string(),
      stamps: z.array(journalledStamp),
      // Absent from exchanges journalled before an option could replace or remove a choice.
      retires: z.array(z.object({ id: z.string(), stamp: journalledStamp, text: z.string(), replacedBy: z.number().int().nullable() })).default([]),
      changes: z.array(z.object({ does: z.enum(["adds", "replaces", "removes"]), now: z.string().nullable(), was: z.string().nullable() })).default([]),
      figures,
      sites: z.array(z.record(z.unknown())),
      basis: z.array(basis),
      arrivals: z.record(z.array(z.number())),
      notes: z.array(z.string()),
      mechanism: z.string(),
      notTested: z.array(z.string()),
      // Absent from exchanges journalled before an option could contain a recorded response.
      cost: z.object({ counted: z.number().nullable(), complete: z.boolean(), says: z.string() }).optional(),
    }),
  ),
});
const journalledSteps = z.array(z.object({ id: z.string(), tool: z.string(), ok: z.boolean(), input: z.unknown(), output: z.unknown() }).passthrough());

/**
 * The decision an exchange supports for one of its tested options.
 *
 * Everything with a figure in it is read from the journal. A step that is not
 * a successful test, or an exchange that did not end with options, is refused.
 */
export function decisionFromExchange(exchange: JournalledExchange, step: string): DecisionDraft {
  if (exchange.kind !== "options" || exchange.status !== "answered") {
    throw BadRequest("NOT_AN_OPTIONS_EXCHANGE", "A decision is recorded from an exchange where options were tested and delivered. This one is not.");
  }
  const proposal = journalledProposal.safeParse(exchange.answer);
  const steps = journalledSteps.safeParse(exchange.steps);
  if (!proposal.success || !steps.success) {
    throw BadRequest("EXCHANGE_UNREADABLE", "The journalled exchange cannot be read as tested options, so nothing can be recorded from it.");
  }
  const option = proposal.data.options.find((o) => o.step === step);
  const tested = steps.data.find((s) => s.id === step);
  if (!option || !tested || tested.tool !== "test_option" || !tested.ok || !proposal.data.asItIs) {
    throw NotFound("OPTION_NOT_TESTED", `Step ${step} is not an option the engine tested in this exchange. Only a tested option can be recorded as a decision.`);
  }
  // The test itself, and whatever the reading of the options was written from.
  const cited = new Set<string>([step, ...proposal.data.reading.flatMap((p) => p.sources)]);
  return {
    objective: proposal.data.objective,
    optionStep: step,
    optionLabel: option.label,
    optionStamps: option.stamps as OptionStamp[],
    expected: {
      horizon: proposal.data.horizon,
      activity: proposal.data.activity,
      asItIs: proposal.data.asItIs,
      withOption: option.figures,
      sites: option.sites as ProposedOption["sites"],
      arrivals: option.arrivals,
      basis: [...option.basis, ...proposal.data.basis],
      changes: option.changes,
      retires: option.retires as RetiredChoice[],
      mechanism: option.mechanism,
      notTested: option.notTested,
      notes: option.notes,
      ...(option.cost ? { cost: option.cost } : {}),
    },
    sourceSteps: steps.data.filter((s) => cited.has(s.id)).map((s) => ({ id: s.id, tool: s.tool, input: s.input, output: s.output })),
  };
}

// ---------------------------------------------------------------------------
// Stored decisions.
// ---------------------------------------------------------------------------

export interface Decision extends DecisionDraft {
  id: string;
  projectId: string;
  scenarioId: string | null;
  scenarioName: string;
  exchangeId: string | null;
  note: string | null;
  /** Who recorded it, by name; null when the account is gone. */
  decidedBy: string | null;
  decidedAt: string;
  /** The signal it was taken on, when a prepared response was engaged; null for a decision recorded from the Options tab. */
  signal: { id: string; title: string } | null;
  preparedResponseId: string | null;
}

interface DecisionDbRow {
  id: string;
  project_id: string;
  scenario_id: string | null;
  scenario_name: string;
  exchange_id: string | null;
  option_step: string;
  objective: string;
  option_label: string;
  option_stamps: OptionStamp[];
  expected: DecisionExpected;
  source_steps: SourceStep[];
  note: string | null;
  decided_by_name: string | null;
  decided_at: Date;
  signal_id: string | null;
  signal_title: string | null;
  prepared_response_id: string | null;
}

const SELECT = `
  SELECT d.id, d.project_id, d.scenario_id, d.scenario_name, d.exchange_id, d.option_step, d.objective,
         d.option_label, d.option_stamps, d.expected, d.source_steps, d.note, u.name AS decided_by_name, d.decided_at,
         d.signal_id, sg.title AS signal_title, d.prepared_response_id
    FROM app.decision d
    LEFT JOIN app.users u ON u.id = d.decided_by
    LEFT JOIN app.signal sg ON sg.id = d.signal_id`;

function outDecision(r: DecisionDbRow): Decision {
  return {
    id: r.id,
    projectId: r.project_id,
    scenarioId: r.scenario_id,
    scenarioName: r.scenario_name,
    exchangeId: r.exchange_id,
    optionStep: r.option_step,
    objective: r.objective,
    optionLabel: r.option_label,
    optionStamps: r.option_stamps,
    expected: r.expected,
    sourceSteps: r.source_steps,
    note: r.note,
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at.toISOString(),
    signal: r.signal_id ? { id: r.signal_id, title: r.signal_title ?? "a signal since deleted" } : null,
    preparedResponseId: r.prepared_response_id,
  };
}

/** The exchange a decision is being recorded from, when it belongs to the project. */
export async function exchangeForDecision(
  db: DbClient,
  projectId: string,
  exchangeId: string,
): Promise<JournalledExchange & { scenarioId: string | null; askedAt: Date }> {
  const { rows } = await db.query<{ kind: string; status: string; question: string; answer: unknown; steps: unknown; scenario_id: string | null; created_at: Date }>(
    `SELECT kind, status, question, answer, steps, scenario_id, created_at FROM app.analyst_exchange WHERE id = $1 AND project_id = $2`,
    [exchangeId, projectId],
  );
  const r = rows[0];
  if (!r) {
    throw NotFound("EXCHANGE_NOT_FOUND", "That test is not in this project's journal. Test the options again, then record the decision.");
  }
  // When it was journalled is when the engine ran its tests: a prepared response dates its test from it.
  return { kind: r.kind, status: r.status, question: r.question, answer: r.answer, steps: r.steps, scenarioId: r.scenario_id, askedAt: r.created_at };
}

export async function insertDecision(
  db: DbClient,
  row: {
    projectId: string;
    scenarioId: string | null;
    scenarioName: string;
    /** Null when the journalled exchange is gone: the figures were copied when the response was kept. */
    exchangeId: string | null;
    userId: string;
    note: string | null;
    draft: DecisionDraft;
    /** Set when a prepared response is engaged on a signal. */
    signalId?: string | null;
    preparedResponseId?: string | null;
  },
): Promise<Decision> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.decision
            (project_id, scenario_id, scenario_name, exchange_id, option_step, objective, option_label,
             option_stamps, expected, source_steps, note, decided_by, signal_id, prepared_response_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
     RETURNING id`,
    [
      row.projectId,
      row.scenarioId,
      row.scenarioName,
      row.exchangeId,
      row.draft.optionStep,
      row.draft.objective,
      row.draft.optionLabel,
      JSON.stringify(row.draft.optionStamps),
      JSON.stringify(row.draft.expected),
      JSON.stringify(row.draft.sourceSteps),
      row.note,
      row.userId,
      row.signalId ?? null,
      row.preparedResponseId ?? null,
    ],
  );
  return getDecision(db, row.projectId, rows[0]!.id);
}

/** The decisions taken on signals of one kind, most recent first: what was engaged the last times this happened. */
export async function listDecisionsForSignalType(db: DbClient, projectId: string, signalTypeId: string, limit = 20): Promise<Decision[]> {
  const { rows } = await db.query<DecisionDbRow>(
    `${SELECT} WHERE d.project_id = $1 AND sg.signal_type_id = $2 ORDER BY d.decided_at DESC LIMIT $3`,
    [projectId, signalTypeId, limit],
  );
  return rows.map(outDecision);
}

export async function listDecisions(db: DbClient, projectId: string, scenarioId: string | null, limit = 100): Promise<Decision[]> {
  const { rows } = await db.query<DecisionDbRow>(
    `${SELECT} WHERE d.project_id = $1 AND ($2::uuid IS NULL OR d.scenario_id = $2::uuid) ORDER BY d.decided_at DESC LIMIT $3`,
    [projectId, scenarioId, limit],
  );
  return rows.map(outDecision);
}

export async function getDecision(db: DbClient, projectId: string, id: string): Promise<Decision> {
  const { rows } = await db.query<DecisionDbRow>(`${SELECT} WHERE d.project_id = $1 AND d.id = $2`, [projectId, id]);
  if (!rows[0]) throw NotFound("DECISION_NOT_FOUND", "Decision not found.");
  return outDecision(rows[0]);
}

// ---------------------------------------------------------------------------
// Follow-up: expected against observed.
// ---------------------------------------------------------------------------

/** The observed series a scenario is compared with: its "reality" setting. */
export interface RealityConfig {
  datasetId: string;
  datasetName: string;
  when: string;
  value: string;
  origin: string;
  acuity: string;
}

const REALITY_KEY = "reality";
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The scenario's reality setting, as the page reads it: the last one written that is whole. */
export function realityOf(overrides: ScenarioOverride[]): RealityConfig | null {
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i]!;
    if (o.targetType !== "param" || o.op !== "set_param" || o.payload.key !== REALITY_KEY) continue;
    const v = o.payload.value as Partial<RealityConfig> | undefined;
    if (!v || !isText(v.datasetId) || !isText(v.when) || !isText(v.value) || !isDay(v.origin) || !isText(v.acuity)) continue;
    return { datasetId: v.datasetId, datasetName: isText(v.datasetName) ? v.datasetName : "", when: v.when, value: v.value, origin: v.origin, acuity: v.acuity };
  }
  return null;
}

export type FollowUp =
  | { linked: false; reason: string }
  | {
      linked: true;
      dataset: { id: string; name: string };
      /** The severity whose arrivals the series counts. */
      acuity: string;
      /** The date day 0 is. */
      origin: string;
      horizon: number;
      /** Days of the run the observed series reports. */
      reported: number;
      /** Arrivals a day the tested run expected; null when it produced none of this severity. */
      expected: number[] | null;
      /** What was counted each day; null where the series says nothing. */
      observed: (number | null)[];
      fit: Fit | null;
      /** Sums over the days both report, and the difference observed minus expected. */
      totals: { days: number; expected: number; observed: number; gap: number } | null;
    };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A decision's expected arrivals beside the observed series.
 *
 * Arrivals only: they are the one thing the tested run produced that the
 * network also reports day by day. The twin keeps the readings of its own
 * measures over time (`twin-history.ts`), but those are not the engine's queue
 * or occupancy, and nothing sets them beside a run yet. So the expected queue
 * cannot be set beside an observed one — the screen says so rather than
 * leaving the comparison to look complete.
 */
export function followUp(expected: Pick<DecisionExpected, "horizon" | "arrivals">, reality: RealityConfig, rows: ReadonlyArray<Record<string, unknown>>): FollowUp {
  const observed = alignSeries(rows, { when: reality.when, value: reality.value, origin: reality.origin, horizon: expected.horizon });
  const series = expected.arrivals[reality.acuity] ?? null;
  const base = {
    linked: true as const,
    dataset: { id: reality.datasetId, name: reality.datasetName },
    acuity: reality.acuity,
    origin: reality.origin,
    horizon: expected.horizon,
    reported: observed.filter((v) => v !== null).length,
    observed,
  };
  if (!series) return { ...base, expected: null, fit: null, totals: null };
  const fit = compareSeries(series, observed);
  let days = 0;
  let sumExpected = 0;
  let sumObserved = 0;
  observed.forEach((o, t) => {
    const e = series[t];
    if (o === null || e === undefined) return;
    days += 1;
    sumExpected += e;
    sumObserved += o;
  });
  return {
    ...base,
    expected: series,
    fit,
    totals: days ? { days, expected: round2(sumExpected), observed: round2(sumObserved), gap: round2(sumObserved - sumExpected) } : null,
  };
}
