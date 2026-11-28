import type { DbClient } from "../lib/db.js";
import { BadRequest } from "../lib/errors.js";
import { STEP_MS, beatsReference, emptyTally, lastValueOf, referenceForecast, scoreOf, tallyInto, type Cell, type ForecastStep, type Score, type Tally } from "./forecast-contract.js";
import {
  COLUMNS,
  askModel,
  buildRequest,
  floorTo,
  gridFor,
  measuredOver,
  modelOf,
  unitOf,
  type CallDeps,
  type ForecastModel,
  type ModelRow,
  type ModelSource,
  type ModelState,
} from "./forecast-models.js";
import { TWIN_PREFIX } from "./series.js";

// ---------------------------------------------------------------------------
// A model on trial: forecasts frozen as they are made, scored when their hour
// comes, and a rule fixed in advance that says whether the model is shown.
//
// A replay on the past says what a model would have forecast. It can be run
// again until the result pleases. A trial happens in the present: the model
// runs at fixed hours, and each forecast is written once, with when it was
// made. Nobody can touch it afterwards, the database included: it refuses any
// update of the table.
//
// Three things are deliberate:
//
//   the rules are frozen too   what "the same hour a week before" and "the last
//                              value holds" said at that origin is kept beside
//                              the forecast. Recomputed later, with readings
//                              that arrived or were corrected since, the bar
//                              would move after the fact.
//   no forecast is made late   an origin that was missed (the server was down,
//                              the model did not answer) stays missed. A
//                              forecast made afterwards would have seen what
//                              came next.
//   shown is a rule            a model is shown while its frozen forecasts of
//                              the last 14 days do strictly better than the
//                              better of the two rules. Nobody ticks that box:
//                              it is computed, and it gives the same answer at
//                              every read.
// ---------------------------------------------------------------------------

/** How long after an origin a trial runs: the time the hour's data takes to arrive. */
export const TRIAL_AFTER_MINUTES = 25;
/** Past this long after an origin, its forecast is not made any more: it would have seen what came next. */
export const TRIAL_LATE_MINUTES = 90;
/** The rhythms a trial can run at, in hours. */
export const TRIAL_RHYTHMS = [1, 3, 6, 12, 24] as const;
/** How often the clock looks for a trial that is due. */
export const TRIAL_EVERY_MS = 5 * 60_000;
/** The stretch of frozen forecasts the display rule looks at. */
export const DISPLAY_WINDOW_DAYS = 14;
/** How many measured steps a model needs before the rule says anything of it. */
export const DISPLAY_MIN_STEPS = 200;

const DAY_MS = 86_400_000;

interface Project {
  id: string;
  organizationId: string;
}

const refused = (message: string) => BadRequest("TRIAL_REFUSED", message);

/**
 * The origin a trial owes a forecast for: the latest slot whose data has had
 * time to arrive. Slots are counted from midnight UTC, `everyHours` apart; by
 * the day, there is one a day.
 */
export function dueOrigin(now: Date, step: ForecastStep, everyHours: number, afterMinutes: number = TRIAL_AFTER_MINUTES): Date {
  const slot = step === "day" ? DAY_MS : Math.max(1, everyHours) * 3_600_000;
  return new Date(Math.floor((now.getTime() - afterMinutes * 60_000) / slot) * slot);
}

/** When a model on trial runs next: the next slot, once its data has had time to arrive. */
export function nextRunAt(now: Date, step: ForecastStep, everyHours: number, afterMinutes: number = TRIAL_AFTER_MINUTES): Date {
  const slot = step === "day" ? DAY_MS : Math.max(1, everyHours) * 3_600_000;
  const due = dueOrigin(now, step, everyHours, afterMinutes).getTime();
  return new Date(due + slot + afterMinutes * 60_000);
}

/** Put a model on trial, or take it off. A model is tried on the past before it is trusted with the present. */
export async function setTrial(db: DbClient, project: Project, model: ForecastModel, on: boolean, everyHours?: number): Promise<ForecastModel> {
  if (on) {
    if (model.state === "imported" || model.state === "verified") {
      throw refused("Replay the model on the past first: a model goes on trial once its contract was checked and it was tried on the last days.");
    }
    const rhythm = everyHours ?? model.trialEveryHours;
    if (!(TRIAL_RHYTHMS as readonly number[]).includes(rhythm)) throw refused(`A trial runs every ${TRIAL_RHYTHMS.join(", ")} hours.`);
    const { rows } = await db.query<ModelRow>(
      `UPDATE app.forecast_model
          SET state = 'on_trial', trial_every_hours = $3, trial_started_at = COALESCE(trial_started_at, NOW()), updated_at = NOW()
        WHERE project_id = $1 AND key = $2
        RETURNING ${COLUMNS}`,
      [project.id, model.key, rhythm],
    );
    return rows[0] ? modelOf(rows[0]) : model;
  }
  // Off trial: what it forecast stays frozen, and it stops making more.
  const { rows } = await db.query<ModelRow>(
    `UPDATE app.forecast_model SET state = 'tried', updated_at = NOW() WHERE project_id = $1 AND key = $2 AND state = 'on_trial' RETURNING ${COLUMNS}`,
    [project.id, model.key],
  );
  return rows[0] ? modelOf(rows[0]) : model;
}

export interface TrialRun {
  origin: string;
  /** Forecasts frozen by this run; none when the origin was already frozen, was missed, or the model failed. */
  frozen: number;
  /** Why the model froze nothing, when it was asked and failed. */
  why: string | null;
  /** True when the origin is too old to be forecast honestly: nothing was asked of the model. */
  missed: boolean;
}

/**
 * One run of a model on trial: the forecast it owes for the origin that is due.
 *
 * The model is sent what is known now, and its answer is frozen with what the
 * two rules said at the same instant. An origin already frozen is left alone.
 * A model that does not answer, or breaks the contract, freezes nothing: the
 * reason is kept on it, and the trial goes on at the next origin.
 */
export async function runTrial(db: DbClient, project: Project, model: ForecastModel, deps: CallDeps & { now?: () => Date } = {}): Promise<TrialRun> {
  const now = (deps.now ?? (() => new Date()))();
  const origin = dueOrigin(now, model.step, model.trialEveryHours);
  // No forecast is made late: one made hours after its origin would have seen the start of its own horizon.
  if (now.getTime() - origin.getTime() > TRIAL_LATE_MINUTES * 60_000) return { origin: origin.toISOString(), frozen: 0, why: null, missed: true };
  const already = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.forecast_issued WHERE model_id = $1 AND origin = $2`, [model.id, origin.toISOString()]);
  if ((already.rows[0]?.n ?? 0) > 0) return { origin: origin.toISOString(), frozen: 0, why: null, missed: false };

  const built = await buildRequest(db, project, model, origin, null);
  let why: string | null = null;
  let frozen = 0;
  if (built.request.series.length === 0) {
    why = "No unit has enough history to show the model.";
  } else {
    const asked = await askModel(model, built.request, await unitOf(db, project, model.metric), deps);
    if (!asked.ok) why = asked.why;
    else {
      const reference = new Map(referenceForecast(built.request).map((r) => [r.id, r.likely]));
      const forecasts = new Map(asked.series.map((f) => [f.id, f]));
      const sentBy = new Map(built.request.series.map((s) => [s.id, s]));
      const rows = built.units.flatMap((u) => {
        const f = forecasts.get(u.label);
        const sent = sentBy.get(u.label);
        if (!f || !sent) return [];
        return [{ unit: u.unitId, low: f.low, likely: f.likely, high: f.high, ref_likely: reference.get(u.label) ?? [], held: lastValueOf(sent.target, 1)[0] ?? null }];
      });
      // Written once: a second write for the same model, unit and origin is ignored, and the table refuses any update.
      const { rows: done } = await db.query<{ n: number }>(
        `WITH written AS (
           INSERT INTO app.forecast_issued (model_id, project_id, unit_instance_id, origin, step, low, likely, high, ref_likely, held, said)
           SELECT $1, $2, x.unit, $3, $4, x.low, x.likely, x.high, x.ref_likely, x.held, $6::jsonb
             FROM jsonb_to_recordset($5::jsonb) AS x(unit uuid, low double precision[], likely double precision[], high double precision[], ref_likely double precision[], held double precision)
           ON CONFLICT (model_id, unit_instance_id, origin) DO NOTHING
           RETURNING 1
         )
         SELECT count(*)::int AS n FROM written`,
        [model.id, project.id, origin.toISOString(), model.step, JSON.stringify(rows), asked.said ? JSON.stringify(asked.said) : null],
      );
      frozen = done[0]?.n ?? 0;
    }
  }
  await db.query(`UPDATE app.forecast_model SET last_run_at = NOW(), last_error = $2, updated_at = NOW() WHERE id = $1`, [model.id, why]);
  return { origin: origin.toISOString(), frozen, why, missed: false };
}

// --- the rule that says whether a model is shown ---------------------------------------------

export interface Standing {
  computedAt: string;
  windowDays: number;
  /** Frozen forecasts counted, and how many origins they were made at. */
  forecasts: number;
  origins: number;
  overall: Score;
  byHorizon: Score[];
  shown: boolean;
  why: string;
  /** The measure's unit: what the errors are counted in. */
  unit: string | null;
}

/**
 * Whether a model is shown, from the score of its frozen forecasts.
 *
 * Fixed in advance, and the same for every model: it has to be on trial, to
 * have enough of its forecasts measured, and to do strictly better than the
 * better of the two rules. The reference is never shown: it is the bar, not a
 * model that cleared it.
 */
export function displayRule(source: ModelSource, state: ModelState, score: Score, origins: number): { shown: boolean; why: string } {
  if (state !== "on_trial") return { shown: false, why: "It is not on trial: none of its forecasts is being frozen and scored." };
  if (source === "reference") return { shown: false, why: "This is the reference rule itself. It is the bar a model is held to, not a model that cleared it: it is not shown as a forecast." };
  if (origins === 0) return { shown: false, why: "No forecast has been frozen yet: the trial has just begun." };
  if (score.n < DISPLAY_MIN_STEPS) {
    return { shown: false, why: `Only ${score.n.toLocaleString("en-CA")} steps of its frozen forecasts have been measured so far. It is judged from ${DISPLAY_MIN_STEPS}.` };
  }
  const verdict = beatsReference(score);
  return { shown: verdict.beats === true, why: verdict.why };
}

export interface FrozenRow {
  unit: string;
  origin: Date;
  low: Cell[];
  likely: Cell[];
  high: Cell[];
  ref_likely: Cell[];
  held: number | null;
}

/** The score of frozen forecasts against what was measured since, step by step of the horizon. Pure. */
export function scoreFrozen(rows: readonly FrozenRow[], measuredBy: ReadonlyMap<string, readonly Cell[]>, gridStart: number, stepMs: number, horizon: number): { overall: Score; byHorizon: Score[] } {
  const byHorizon: Tally[] = Array.from({ length: horizon }, emptyTally);
  for (const r of rows) {
    const m = measuredBy.get(r.unit);
    if (!m) continue;
    const over = measuredOver(m, gridStart, stepMs, r.origin, horizon);
    tallyInto(byHorizon, r, { likely: r.ref_likely }, Array.from({ length: horizon }, () => r.held), over);
  }
  return { overall: scoreOf(byHorizon), byHorizon: byHorizon.map((t) => scoreOf([t])) };
}

const numbers = (a: unknown): Cell[] => (Array.isArray(a) ? a.map((v) => (v === null || v === undefined ? null : Number(v))) : []);

/**
 * Where a model on trial stands: its frozen forecasts of the last 14 days held
 * against what the twin measured since, and what the rule says of it. The
 * result is kept on the model so that a screen does not recompute it; it is
 * never set by hand.
 */
export async function computeStanding(db: DbClient, project: Project, model: ForecastModel, now: Date = new Date()): Promise<Standing> {
  const since = new Date(now.getTime() - DISPLAY_WINDOW_DAYS * DAY_MS);
  const { rows } = await db.query<{ unit: string; origin: Date; low: unknown; likely: unknown; high: unknown; ref_likely: unknown; held: number | null }>(
    `SELECT unit_instance_id AS unit, origin, low, likely, high, ref_likely, held
       FROM app.forecast_issued WHERE model_id = $1 AND origin >= $2 ORDER BY origin ASC`,
    [model.id, since.toISOString()],
  );
  const frozen: FrozenRow[] = rows.map((r) => ({ unit: r.unit, origin: r.origin, low: numbers(r.low), likely: numbers(r.likely), high: numbers(r.high), ref_likely: numbers(r.ref_likely), held: r.held === null ? null : Number(r.held) }));
  const unit = await unitOf(db, project, model.metric);
  const lastStep = floorTo(now, model.step);
  let scored: { overall: Score; byHorizon: Score[] } = { overall: scoreOf([]), byHorizon: [] };
  if (frozen.length > 0 && lastStep.getTime() > frozen[0]!.origin.getTime()) {
    const units = [...new Set(frozen.map((f) => f.unit))];
    const measured = await gridFor(db, project, `${TWIN_PREFIX}${model.metric}`, units, frozen[0]!.origin, lastStep, model.step, null, model.holdHours);
    scored = scoreFrozen(frozen, new Map(measured.map((m) => [m.entity, m.values])), frozen[0]!.origin.getTime(), STEP_MS[model.step], model.horizonSteps);
  }
  const origins = new Set(frozen.map((f) => f.origin.getTime())).size;
  const standing: Standing = {
    computedAt: now.toISOString(),
    windowDays: DISPLAY_WINDOW_DAYS,
    forecasts: frozen.length,
    origins,
    ...scored,
    ...displayRule(model.source, model.state, scored.overall, origins),
    unit,
  };
  await db.query(`UPDATE app.forecast_model SET standing = $2::jsonb WHERE id = $1`, [model.id, JSON.stringify(standing)]);
  return standing;
}

// --- what a screen is given ----------------------------------------------------------------------

export interface ShownForecast {
  model: { key: string; label: string; source: ModelSource; said: { name?: string; version?: string } | null };
  metric: string;
  unit: string | null;
  step: ForecastStep;
  /** The start of the first step forecast, and when the forecast was made. */
  origin: string;
  issuedAt: string;
  low: Cell[];
  likely: Cell[];
  high: Cell[];
  /** Its record: the three errors over the last days, and the sentence of the rule. */
  record: { overall: Score; why: string; windowDays: number };
}

/**
 * The forecasts a screen may show for one unit: the latest frozen forecast of
 * each model the rule lets through, and nothing for any other model.
 *
 * The rule is applied again here from the standing that was last computed: a
 * model whose standing says "not shown", or has none, gives nothing.
 */
export async function shownForecasts(db: DbClient, project: Project, unitId: string): Promise<ShownForecast[]> {
  const { rows } = await db.query<
    ModelRow & { f_origin: Date; f_issued_at: Date; f_low: unknown; f_likely: unknown; f_high: unknown; f_said: { name?: string; version?: string } | null }
  >(
    `SELECT ${COLUMNS.split(",").map((c) => `m.${c.trim()}`).join(", ")},
            f.origin AS f_origin, f.issued_at AS f_issued_at, f.low AS f_low, f.likely AS f_likely, f.high AS f_high, f.said AS f_said
       FROM app.forecast_model m
       JOIN LATERAL (
            SELECT origin, issued_at, low, likely, high, said
              FROM app.forecast_issued
             WHERE model_id = m.id AND unit_instance_id = $2
             ORDER BY origin DESC
             LIMIT 1) f ON true
      WHERE m.project_id = $1 AND m.state = 'on_trial'
      ORDER BY m.created_at ASC`,
    [project.id, unitId],
  );
  const out: ShownForecast[] = [];
  for (const r of rows) {
    const model = modelOf(r);
    const standing = model.standing as Partial<Standing> | null;
    // Shown only when the rule said so at its last computation, and never for the reference.
    if (!standing || standing.shown !== true || !standing.overall || model.source === "reference") continue;
    out.push({
      model: { key: model.key, label: model.label, source: model.source, said: r.f_said ?? null },
      metric: model.metric,
      unit: standing.unit ?? null,
      step: model.step,
      origin: r.f_origin.toISOString(),
      issuedAt: r.f_issued_at.toISOString(),
      low: numbers(r.f_low),
      likely: numbers(r.f_likely),
      high: numbers(r.f_high),
      record: { overall: standing.overall, why: standing.why ?? "", windowDays: standing.windowDays ?? DISPLAY_WINDOW_DAYS },
    });
  }
  return out;
}

// --- the clock --------------------------------------------------------------------------------------

export interface TrialPass {
  models: number;
  frozen: number;
  failed: number;
}

/** Every model on trial, one after another: the forecast it owes, then where it stands. One model's failure costs the others nothing. */
export async function runAllTrials(db: DbClient, onError?: (model: string, err: unknown) => void, deps: CallDeps & { now?: () => Date } = {}): Promise<TrialPass> {
  const { rows } = await db.query<ModelRow & { organization_id: string }>(
    `SELECT ${COLUMNS.split(",").map((c) => `m.${c.trim()}`).join(", ")}, p.organization_id
       FROM app.forecast_model m JOIN app.project p ON p.id = m.project_id
      WHERE m.state = 'on_trial'
      ORDER BY m.created_at ASC`,
  );
  const pass: TrialPass = { models: 0, frozen: 0, failed: 0 };
  for (const r of rows) {
    const model = modelOf(r);
    const project = { id: r.project_id, organizationId: r.organization_id };
    pass.models += 1;
    try {
      const now = (deps.now ?? (() => new Date()))();
      const run = await runTrial(db, project, model, deps);
      pass.frozen += run.frozen;
      if (run.why) pass.failed += 1;
      // Where it stands moves as its forecasts are measured: recomputed after a run, and at least every hour.
      const computed = Date.parse(String((model.standing as { computedAt?: string } | null)?.computedAt ?? ""));
      if (run.frozen > 0 || !Number.isFinite(computed) || now.getTime() - computed > 3_600_000) await computeStanding(db, project, model, now);
    } catch (err) {
      pass.failed += 1;
      onError?.(model.key, err);
    }
  }
  return pass;
}

let started = false;

export function startForecastTrials(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (started || process.env.FORECAST_TRIALS_DISABLED === "1") return;
  started = true;
  log.info({ everyMs: TRIAL_EVERY_MS }, "forecast trials clock started");
  const pass = async (): Promise<void> => {
    const startedAt = Date.now();
    try {
      const r = await runAllTrials(pool as DbClient, (model, err) => log.warn({ err, model }, "forecast trial: a model could not run"));
      if (r.frozen > 0 || r.failed > 0) log.info({ ...r, ms: Date.now() - startedAt }, "forecast trials run");
    } catch (err) {
      log.warn({ err }, "forecast trials pass failed");
    }
    // Scheduled once the pass is over, never on a clock: two passes cannot overlap.
    setTimeout(() => void pass(), TRIAL_EVERY_MS).unref?.();
  };
  setTimeout(() => void pass(), 60_000).unref?.();
}
