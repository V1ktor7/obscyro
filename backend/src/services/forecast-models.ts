import { z } from "zod";

import { config } from "../lib/config.js";
import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import {
  CONTRACT_VERSION,
  FORECAST_STEPS,
  HISTORY_MAX,
  HORIZON_MAX,
  SERIES_MAX,
  STEP_MS,
  beatsReference,
  boundsOf,
  checkForecast,
  checkRequest,
  emptyTally,
  lastValueOf,
  referenceForecast,
  scoreOf,
  tallyInto,
  type Cell,
  type ForecastRequest,
  type ForecastStep,
  type Score,
  type Tally,
} from "./forecast-contract.js";
import { readStamp } from "./observed-at.js";
import { assertFetchableUrl } from "./rest-connector.js";
import { ENTITIES_MAX, TWIN_PREFIX, readGrid, seriesKeyFrom, type GridAnswer } from "./series.js";
import { listTwinMetrics } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// Imported forecasting models.
//
// A model already trained somewhere else is plugged into a project: it is
// shown the history the platform keeps (the kept series, D12) and gives back
// a forecast, in the one format of `forecast-contract.ts`. Three kinds:
//
//   reference   the built-in rule, "the same hour a week before". No model is
//               called. It always runs, and it is the bar every model is held to.
//   service     an open model served by the model service, a small service of
//               its own that never touches the database.
//   endpoint    an address that speaks the contract.
//
// Before a model is trusted with anything, it goes through the same steps, in
// this order: its contract is checked on a sample; it is replayed on the last
// days, each time shown only what was known at that instant; then it is put on
// trial, each forecast frozen and scored. This file holds the first two.
//
// What leaves this server is counts and rates under opaque labels: never a
// unit's name or identifier, never anything about a person.
//
// A key is never kept, sent to a screen or typed into one. An address that
// asks for a key names an environment variable an administrator set on the
// API, and that name has to start with MODEL_KEY_: no other variable of the
// server can be made to travel.
// ---------------------------------------------------------------------------

export const MODEL_SOURCES = ["reference", "service", "endpoint"] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export const MODEL_STATES = ["imported", "verified", "tried", "on_trial"] as const;
export type ModelState = (typeof MODEL_STATES)[number];

/** What the calendar can say ahead of time: the hour of the day, the day of the week. */
export const CALENDAR = ["calendar:hour", "calendar:weekday"] as const;
type CalendarKind = (typeof CALENDAR)[number];
const isCalendar = (s: string): s is CalendarKind => (CALENDAR as readonly string[]).includes(s);

/** The only environment variables an address can read its key from. */
export const KEY_ENV = /^MODEL_KEY_[A-Z0-9_]{1,48}$/;

/** How many units a contract is checked on. */
export const SAMPLE_UNITS = 3;
/** How many days a model is replayed over by default, and at most. */
export const BACKTEST_DAYS = 14;
export const BACKTEST_DAYS_MAX = 60;
/** A replay stops asking the model past this long, and says how far it got. */
export const BACKTEST_BUDGET_MS = 120_000;

const companionSchema = z.object({
  /** The name the model receives the companion under. */
  name: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, "A companion is named in lower case, with letters, digits and underscores."),
  /** `past`: known up to the origin. `known`: known ahead, given over the horizon too. */
  kind: z.enum(["past", "known"]),
  /** `twin:<measure>`, the key of a declared series, or `calendar:hour` / `calendar:weekday`. */
  series: z.string().trim().min(1).max(120),
  /** Which entity of a declared series. Null for a measure of the twin (the same unit) and for the calendar. */
  entity: z.string().max(400).nullable().default(null),
});
export type Companion = z.infer<typeof companionSchema>;

export const modelDraft = z.object({
  label: z.string().trim().min(1).max(120),
  source: z.enum(MODEL_SOURCES),
  /** For `service`: the open model the model service serves. */
  serviceModel: z.string().trim().min(1).max(80).nullable().default(null),
  /** For `endpoint`: the address that speaks the contract. */
  endpointUrl: z.string().trim().url().max(500).nullable().default(null),
  /** For `endpoint`: the NAME of the environment variable that holds its key. Never the key. */
  endpointKeyEnv: z.string().trim().max(64).nullable().default(null),
  /** The measure of the twin it forecasts. */
  metric: z.string().trim().min(1).max(200),
  /** The units it forecasts for; null for every unit that carries the measure. */
  units: z.array(z.string().uuid()).min(1).max(SERIES_MAX).nullable().default(null),
  step: z.enum(FORECAST_STEPS),
  historySteps: z.number().int().min(1).max(HISTORY_MAX),
  horizonSteps: z.number().int().min(1).max(HORIZON_MAX),
  /** How long a value holds in the history when its source goes quiet, in hours; null for until the next point. */
  holdHours: z
    .number()
    .positive()
    .max(24 * 400)
    .nullable()
    .default(null),
  /** A unit with less history than this is left out, with the reason. */
  minHistoryDays: z.number().int().min(1).max(365).default(14),
  companions: z.array(companionSchema).max(8).default([]),
  /** An IANA zone, for the calendar companions: the hour of the day is an hour somewhere. */
  timeZone: z.string().trim().min(1).max(64).nullable().default(null),
});
export type ModelDraft = z.infer<typeof modelDraft>;

export interface ForecastModel extends ModelDraft {
  id: string;
  projectId: string;
  key: string;
  state: ModelState;
  verifiedAt: string | null;
  triedAt: string | null;
  backtest: Backtest | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  organizationId: string;
}

const invalid = (message: string) => BadRequest("MODEL_INVALID", message);

/** What a draft is held against: the measures the organisation defined, and the series the project declared. */
export interface DraftContext {
  metrics: readonly { key: string; label: string }[];
  seriesKeys: ReadonlySet<string>;
}

/**
 * A draft held against the project, or a refusal that says what to correct.
 *
 * Nothing is recognised by its name: the measure and every companion have to
 * be things the project keeps.
 */
export function checkModelDraft(draft: ModelDraft, ctx: DraftContext, env: Record<string, string | undefined> = process.env): void {
  if (draft.source === "reference") {
    if (draft.serviceModel || draft.endpointUrl || draft.endpointKeyEnv) throw invalid("The reference is built in: it has no model to name and no address to call.");
  } else if (draft.source === "service") {
    if (!draft.serviceModel) throw invalid("Name the open model the model service serves.");
    if (draft.endpointUrl || draft.endpointKeyEnv) throw invalid("A model served by the model service has no address of its own.");
  } else {
    if (!draft.endpointUrl) throw invalid("Give the address that speaks the contract.");
    if (draft.serviceModel) throw invalid("An address is not a model of the model service: leave the model's name out.");
    const secure = draft.endpointUrl.startsWith("https://");
    if (!secure && env.ALLOW_PRIVATE_SYNC_TARGETS !== "1") throw invalid("The address has to start with https://: the series leave this server on that connection.");
    if (draft.endpointKeyEnv && !KEY_ENV.test(draft.endpointKeyEnv)) {
      throw invalid("The key is read from a variable an administrator set on the API, and its name starts with MODEL_KEY_ (MODEL_KEY_ACME, for instance). Give that name, never the key.");
    }
  }
  if (!ctx.metrics.some((m) => m.key === draft.metric)) {
    throw invalid(`The organisation defines no measure called “${draft.metric}”. Its measures are: ${ctx.metrics.map((m) => m.key).join(", ") || "none"}.`);
  }
  const floor = draft.step === "hour" ? 24 : 7;
  if (draft.historySteps < floor) throw invalid(`A model is shown at least ${draft.step === "hour" ? "a day" : "a week"} of history: ${floor} steps.`);
  const names = new Set<string>();
  for (const c of draft.companions) {
    if (names.has(c.name)) throw invalid(`Two companion series are called “${c.name}”.`);
    names.add(c.name);
    if (c.kind === "known") {
      if (!isCalendar(c.series)) throw invalid(`“${c.series}” is not known ahead of time. What the platform knows ahead is the calendar: ${CALENDAR.join(", ")}.`);
      if (c.entity) throw invalid("The calendar has no entity.");
      continue;
    }
    if (isCalendar(c.series)) throw invalid("The calendar is known ahead: declare it as a companion known ahead.");
    if (c.series.startsWith(TWIN_PREFIX)) {
      const m = c.series.slice(TWIN_PREFIX.length);
      if (!ctx.metrics.some((x) => x.key === m)) throw invalid(`The organisation defines no measure called “${m}”.`);
      if (m === draft.metric) throw invalid("A model is already shown the history of what it forecasts: it is not a companion of itself.");
      if (c.entity) throw invalid("A measure of the twin is read at the same unit as the target: it takes no entity.");
    } else {
      if (!ctx.seriesKeys.has(c.series)) throw invalid(`The project keeps no series called “${c.series}”. Declare it under Data › Kept series first.`);
      if (!c.entity) throw invalid(`Say which entity of “${c.series}” to show the model: a province, a site, a virus.`);
    }
  }
  if (draft.companions.some((c) => c.kind === "known")) {
    if (!draft.timeZone) throw invalid("The hour of the day is an hour somewhere: give the time zone the calendar is read in, such as America/Toronto.");
    if (!readStamp("2026-01-01T00:00", draft.timeZone).at) throw invalid(`“${draft.timeZone}” is not a time zone this server knows.`);
  }
}

// --- the row ----------------------------------------------------------------------------

interface ModelRow {
  id: string;
  project_id: string;
  key: string;
  label: string;
  source: ModelSource;
  service_model: string | null;
  endpoint_url: string | null;
  endpoint_key_env: string | null;
  metric: string;
  units: string[] | null;
  step: ForecastStep;
  history_steps: number;
  horizon_steps: number;
  hold_hours: number | null;
  min_history_days: number;
  companions: Companion[] | null;
  time_zone: string | null;
  state: ModelState;
  verified_at: Date | null;
  tried_at: Date | null;
  backtest: Backtest | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, project_id, key, label, source, service_model, endpoint_url, endpoint_key_env, metric, units, step,
  history_steps, horizon_steps, hold_hours, min_history_days, companions, time_zone, state, verified_at, tried_at,
  backtest, last_error, created_at, updated_at`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function modelOf(r: ModelRow): ForecastModel {
  return {
    id: r.id,
    projectId: r.project_id,
    key: r.key,
    label: r.label,
    source: r.source,
    serviceModel: r.service_model,
    endpointUrl: r.endpoint_url,
    endpointKeyEnv: r.endpoint_key_env,
    metric: r.metric,
    units: r.units,
    step: r.step,
    historySteps: r.history_steps,
    horizonSteps: r.horizon_steps,
    holdHours: r.hold_hours === null ? null : Number(r.hold_hours),
    minHistoryDays: r.min_history_days,
    companions: r.companions ?? [],
    timeZone: r.time_zone,
    state: r.state,
    verifiedAt: iso(r.verified_at),
    triedAt: iso(r.tried_at),
    backtest: r.backtest,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listModels(db: DbClient, projectId: string): Promise<ForecastModel[]> {
  const { rows } = await db.query<ModelRow>(`SELECT ${COLUMNS} FROM app.forecast_model WHERE project_id = $1 ORDER BY created_at ASC`, [projectId]);
  return rows.map(modelOf);
}

export async function getModel(db: DbClient, projectId: string, key: string): Promise<ForecastModel> {
  const { rows } = await db.query<ModelRow>(`SELECT ${COLUMNS} FROM app.forecast_model WHERE project_id = $1 AND key = $2`, [projectId, key]);
  if (!rows[0]) throw NotFound("MODEL_NOT_FOUND", "That model is not imported in this project.");
  return modelOf(rows[0]);
}

async function draftContext(db: DbClient, project: Project): Promise<DraftContext> {
  const [metrics, declared] = await Promise.all([
    listTwinMetrics(db, project.organizationId),
    db.query<{ key: string }>(`SELECT key FROM app.kept_series WHERE project_id = $1`, [project.id]),
  ]);
  return { metrics: metrics.map((m) => ({ key: m.key, label: m.label })), seriesKeys: new Set(declared.rows.map((r) => r.key)) };
}

/** Import a model into the project. It starts as "imported": nothing was sent anywhere yet. */
export async function importModel(db: DbClient, project: Project, userId: string, draft: ModelDraft): Promise<ForecastModel> {
  checkModelDraft(draft, await draftContext(db, project));
  if (draft.source === "endpoint") {
    // The address is resolved once here, so that a private one is refused before anything is kept.
    await assertFetchableUrl(draft.endpointUrl!).catch((e: Error) => {
      throw invalid(e.message);
    });
  }
  const taken = new Set((await listModels(db, project.id)).map((m) => m.key));
  const key = seriesKeyFrom(draft.label, taken);
  const { rows } = await db.query<ModelRow>(
    `INSERT INTO app.forecast_model (project_id, key, label, source, service_model, endpoint_url, endpoint_key_env, metric, units, step,
                                     history_steps, horizon_steps, hold_hours, min_history_days, companions, time_zone, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb, $16, $17)
     RETURNING ${COLUMNS}`,
    [
      project.id,
      key,
      draft.label,
      draft.source,
      draft.serviceModel,
      draft.endpointUrl,
      draft.endpointKeyEnv,
      draft.metric,
      draft.units ? JSON.stringify(draft.units) : null,
      draft.step,
      draft.historySteps,
      draft.horizonSteps,
      draft.holdHours,
      draft.minHistoryDays,
      JSON.stringify(draft.companions),
      draft.timeZone,
      userId,
    ],
  );
  return modelOf(rows[0]!);
}

export async function removeModel(db: DbClient, projectId: string, key: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.forecast_model WHERE project_id = $1 AND key = $2`, [projectId, key]);
  if (!rowCount) throw NotFound("MODEL_NOT_FOUND", "That model is not imported in this project.");
}

// --- what a model is shown ----------------------------------------------------------------

/** The start of the step an instant falls in. */
export function floorTo(at: Date, step: ForecastStep): Date {
  return new Date(Math.floor(at.getTime() / STEP_MS[step]) * STEP_MS[step]);
}

/** The hour of the day (0 to 23) or the day of the week (1, Monday, to 7) of an instant, on a named clock. */
export function calendarValue(kind: CalendarKind, at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at);
  if (kind === "calendar:hour") return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(day) + 1;
}

export interface LeftOut {
  unitId: string;
  name: string;
  why: string;
}

export interface Built {
  request: ForecastRequest;
  /** Which unit each label of the request stands for. Kept on this side: it never leaves. */
  units: { label: string; unitId: string; name: string }[];
  /** Units that are not sent, each with its reason. */
  leftOut: LeftOut[];
}

const DAY_MS = 86_400_000;
const days = (ms: number): string => {
  const d = Math.floor(ms / DAY_MS);
  return d < 1 ? "less than a day" : d === 1 ? "1 day" : `${d} days`;
};

async function unitsOf(db: DbClient, project: Project, model: Pick<ForecastModel, "metric" | "units">): Promise<string[]> {
  if (model.units) return model.units;
  const { rows } = await db.query<{ unit: string }>(
    `SELECT DISTINCT unit_instance_id AS unit FROM app.twin_reading WHERE project_id = $1 AND metric = $2 ORDER BY 1`,
    [project.id, model.metric],
  );
  return rows.map((r) => r.unit);
}

/** A grid read for many entities, a bounded number at a time. */
async function gridFor(db: DbClient, project: Project, key: string, entities: string[], from: Date, to: Date, step: ForecastStep, asOf: Date | null, holdHours: number | null): Promise<GridAnswer["series"]> {
  const out: GridAnswer["series"] = [];
  for (let i = 0; i < entities.length; i += ENTITIES_MAX) {
    const answer = await readGrid(db, project, {
      key,
      entities: entities.slice(i, i + ENTITIES_MAX),
      from: from.toISOString(),
      to: to.toISOString(),
      step,
      agg: "mean",
      asOf: asOf ? asOf.toISOString() : null,
      holdHours,
    });
    out.push(...answer.series);
  }
  return out;
}

type Shape = Pick<ForecastModel, "metric" | "units" | "step" | "historySteps" | "horizonSteps" | "holdHours" | "minHistoryDays" | "companions" | "timeZone">;

/**
 * What a model is sent for one origin, as it was known at `asOf`.
 *
 * The history is the kept series of the measure (D12), read on a regular grid
 * that ends at the origin: gaps stay gaps, and with `asOf` nothing written
 * down after that instant is used. That is what lets a forecast of last week
 * be replayed honestly.
 *
 * A unit whose history is shorter than the model asks for is left out, with
 * the reason, rather than sent with a history padded out. So is a unit that
 * has no value at all over the stretch shown.
 */
export async function buildRequest(db: DbClient, project: Project, model: Shape, origin: Date, asOf: Date | null, only?: number): Promise<Built> {
  const stepMs = STEP_MS[model.step];
  const from = new Date(origin.getTime() - model.historySteps * stepMs);
  let unitIds = await unitsOf(db, project, model);
  if (unitIds.length > SERIES_MAX) unitIds = unitIds.slice(0, SERIES_MAX);
  const targets = unitIds.length ? await gridFor(db, project, `${TWIN_PREFIX}${model.metric}`, unitIds, from, origin, model.step, asOf, model.holdHours) : [];

  const kept: typeof targets = [];
  const leftOut: LeftOut[] = [];
  const need = model.minHistoryDays * DAY_MS;
  for (const s of targets) {
    const first = s.firstAt ? Date.parse(s.firstAt) : null;
    if (first === null || first >= origin.getTime()) {
      leftOut.push({ unitId: s.entity, name: s.label, why: "No reading of this measure was kept for this unit by then." });
    } else if (origin.getTime() - first < need) {
      leftOut.push({ unitId: s.entity, name: s.label, why: `Its history starts ${days(origin.getTime() - first)} before: the model asks for ${model.minHistoryDays}.` });
    } else if (s.values.every((v) => v === null)) {
      leftOut.push({ unitId: s.entity, name: s.label, why: "It has no value over the stretch the model is shown." });
    } else kept.push(s);
  }
  const sent = only ? kept.slice(0, only) : kept;
  const sentIds = sent.map((s) => s.entity);

  // Companions of the past: a measure of the twin at the same unit, or one entity of a declared series for every unit.
  const past = new Map<string, (unitId: string) => Cell[]>();
  for (const c of model.companions.filter((x) => x.kind === "past")) {
    if (sentIds.length === 0) break;
    if (c.series.startsWith(TWIN_PREFIX)) {
      const read = await gridFor(db, project, c.series, sentIds, from, origin, model.step, asOf, model.holdHours);
      const by = new Map(read.map((r) => [r.entity, r.values]));
      past.set(c.name, (unitId) => by.get(unitId) ?? Array.from({ length: model.historySteps }, () => null));
    } else {
      const read = await gridFor(db, project, c.series, [c.entity ?? ""], from, origin, model.step, asOf, null);
      const values = read[0]?.values ?? Array.from({ length: model.historySteps }, () => null);
      past.set(c.name, () => values);
    }
  }
  // Companions known ahead: the calendar, over the history and the horizon.
  const known: Record<string, Cell[]> = {};
  for (const c of model.companions.filter((x) => x.kind === "known")) {
    if (!isCalendar(c.series) || !model.timeZone) continue;
    const kind = c.series;
    known[c.name] = Array.from({ length: model.historySteps + model.horizonSteps }, (_, i) => calendarValue(kind, new Date(from.getTime() + i * stepMs), model.timeZone!));
  }

  const units = sent.map((s, i) => ({ label: `s${i + 1}`, unitId: s.entity, name: s.label }));
  const request: ForecastRequest = {
    contract: CONTRACT_VERSION,
    step: model.step,
    historyStart: from.toISOString(),
    origin: origin.toISOString(),
    history: model.historySteps,
    horizon: model.horizonSteps,
    series: sent.map((s, i) => ({
      id: units[i]!.label,
      target: s.values,
      ...(past.size ? { past: Object.fromEntries([...past].map(([name, of]) => [name, of(s.entity)])) } : {}),
      ...(Object.keys(known).length ? { known } : {}),
    })),
  };
  return { request, units, leftOut };
}

// --- asking a model ---------------------------------------------------------------------------

export interface Forecast {
  id: string;
  low: Cell[];
  likely: Cell[];
  high: Cell[];
}

export type Asked = { ok: true; series: Forecast[]; said: { name?: string; version?: string } | null; ms: number } | { ok: false; why: string };

export interface CallDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  serviceUrl?: string;
  timeoutMs?: number;
  /** Resolves and refuses a private address; replaced in tests. */
  allow?: (url: string) => Promise<unknown>;
}

/** Where a model's request goes, in words a screen can show. Never a key, never a path that could hold one. */
export function sentTo(model: Pick<ForecastModel, "source" | "endpointUrl" | "serviceModel">, serviceUrl: string = config.modelServiceUrl): string {
  if (model.source === "reference") return "Nowhere: the reference is computed on this server.";
  const host = (raw: string): string => {
    try {
      return new URL(raw).host;
    } catch {
      return "an address that cannot be read";
    }
  };
  if (model.source === "service") return serviceUrl ? `The model service (${host(serviceUrl)}), model “${model.serviceModel}”.` : "The model service, which is not configured on this server.";
  return `${host(model.endpointUrl ?? "")}, an address outside this platform.`;
}

/**
 * One forecast asked of a model, held against the contract.
 *
 * The reference answers here, with no call. A served model and an address are
 * sent the request and nothing else; what comes back is checked before it is
 * used, and refused with its reason when it does not keep the contract.
 */
export async function askModel(
  model: Pick<ForecastModel, "source" | "serviceModel" | "endpointUrl" | "endpointKeyEnv">,
  request: ForecastRequest,
  unit: string | null,
  deps: CallDeps = {},
): Promise<Asked> {
  const wrong = checkRequest(request);
  if (wrong) return { ok: false, why: wrong };
  if (model.source === "reference") {
    const started = Date.now();
    const series = referenceForecast(request).map(({ id, low, likely, high }) => ({ id, low, likely, high }));
    return { ok: true, series, said: { name: "reference", version: String(CONTRACT_VERSION) }, ms: Date.now() - started };
  }
  const env = deps.env ?? process.env;
  const serviceUrl = deps.serviceUrl ?? config.modelServiceUrl;
  let url: string;
  let body: unknown;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (model.source === "service") {
    if (!serviceUrl) return { ok: false, why: "The model service is not configured on this server (MODEL_SERVICE_URL): only the reference can run. An administrator sets it." };
    url = `${serviceUrl}/v1/forecast`;
    body = { model: model.serviceModel, request };
  } else {
    url = model.endpointUrl ?? "";
    body = request;
    try {
      await (deps.allow ?? assertFetchableUrl)(url);
    } catch (e) {
      return { ok: false, why: (e as Error).message };
    }
    if (model.endpointKeyEnv) {
      if (!KEY_ENV.test(model.endpointKeyEnv)) return { ok: false, why: "The variable named for the key does not start with MODEL_KEY_." };
      const key = env[model.endpointKeyEnv];
      if (!key) return { ok: false, why: `The variable ${model.endpointKeyEnv} is not set on the API: an administrator sets it. No key is typed here.` };
      headers.Authorization = `Bearer ${key}`;
    }
  }
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? config.modelTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await (deps.fetch ?? fetch)(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal, redirect: "error" });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const detail = typeof data === "object" && data !== null ? ((data as { detail?: unknown; error?: { message?: unknown } }).detail ?? (data as { error?: { message?: unknown } }).error?.message) : null;
      return { ok: false, why: `The model answered ${res.status}${typeof detail === "string" ? `: ${detail.slice(0, 300)}` : "."}` };
    }
    const checked = checkForecast(request, data, boundsOf(unit));
    if (!checked.ok) return { ok: false, why: checked.why };
    return { ok: true, series: checked.response.series, said: checked.response.model ?? null, ms: Date.now() - started };
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, why: `The model did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    return { ok: false, why: `The model could not be reached: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

// --- checking the contract on a sample ---------------------------------------------------------

export interface Verification {
  ok: boolean;
  /** Why it failed; null when the contract was kept. */
  why: string | null;
  /** What left this server, and to where. Counts and rates under opaque labels. */
  sent: { to: string; series: number; history: number; horizon: number; step: ForecastStep; companions: string[]; bytes: number };
  leftOut: LeftOut[];
  /** The first hours of the first series, with the unit it stands for: enough to see the answer is a forecast. */
  sample: { unit: string; origin: string; low: Cell[]; likely: Cell[]; high: Cell[] } | null;
  said: { name?: string; version?: string } | null;
  ms: number | null;
}

async function unitOf(db: DbClient, project: Project, metric: string): Promise<string | null> {
  return (await listTwinMetrics(db, project.organizationId)).find((m) => m.key === metric)?.unit ?? null;
}

/**
 * The contract checked on a sample: a few units, as they stand now.
 *
 * It is the first time anything leaves for the model. A model that keeps the
 * contract becomes "verified"; one that does not stays where it was, and the
 * reason is kept on it.
 */
export async function verifyModel(db: DbClient, project: Project, model: ForecastModel, deps: CallDeps & { now?: () => Date } = {}): Promise<{ model: ForecastModel; verification: Verification }> {
  const origin = floorTo((deps.now ?? (() => new Date()))(), model.step);
  const built = await buildRequest(db, project, model, origin, null, SAMPLE_UNITS);
  const sent: Verification["sent"] = {
    to: sentTo(model, deps.serviceUrl),
    series: built.request.series.length,
    history: built.request.history,
    horizon: built.request.horizon,
    step: built.request.step,
    companions: model.companions.map((c) => c.name),
    bytes: JSON.stringify(built.request).length,
  };
  let verification: Verification;
  if (built.request.series.length === 0) {
    const first = built.leftOut[0];
    verification = {
      ok: false,
      why: first ? `No unit has enough history to show the model. ${first.name}: ${first.why}` : "No unit carries this measure yet: there is no history to show the model.",
      sent: { ...sent, bytes: 0 },
      leftOut: built.leftOut,
      sample: null,
      said: null,
      ms: null,
    };
  } else {
    const asked = await askModel(model, built.request, await unitOf(db, project, model.metric), deps);
    const firstSeries = asked.ok ? asked.series[0] : undefined;
    verification = {
      ok: asked.ok,
      why: asked.ok ? null : asked.why,
      sent,
      leftOut: built.leftOut,
      sample: firstSeries ? { unit: built.units[0]!.name, origin: origin.toISOString(), low: firstSeries.low.slice(0, 6), likely: firstSeries.likely.slice(0, 6), high: firstSeries.high.slice(0, 6) } : null,
      said: asked.ok ? asked.said : null,
      ms: asked.ok ? asked.ms : null,
    };
  }
  const { rows } = await db.query<ModelRow>(
    `UPDATE app.forecast_model
        SET state = CASE WHEN $3 AND state = 'imported' THEN 'verified' ELSE state END,
            verified_at = CASE WHEN $3 THEN NOW() ELSE verified_at END,
            last_error = $4,
            updated_at = NOW()
      WHERE project_id = $1 AND key = $2
      RETURNING ${COLUMNS}`,
    [project.id, model.key, verification.ok, verification.why],
  );
  return { model: rows[0] ? modelOf(rows[0]) : model, verification };
}

// --- the replay on the past ------------------------------------------------------------------

export interface Backtest {
  ranAt: string;
  /** How many days back it was asked to go, and how many origins it could ask the model for. */
  days: number;
  step: ForecastStep;
  horizon: number;
  /** One line per origin: when, how many series, and the two errors over that forecast. */
  origins: { origin: string; series: number; leftOut: number; score: Score }[];
  overall: Score;
  /** One score per step of the horizon: how the error grows as the forecast looks further. */
  byHorizon: Score[];
  verdict: { beats: boolean | null; why: string };
  /** True when the replay stopped before its last origin; `stopped` says why. */
  partial: boolean;
  stopped: string | null;
  said: { name?: string; version?: string } | null;
  /** The measure's unit: what the errors are counted in. */
  unit: string | null;
}

/**
 * The origins of a replay: one a day, at the hour of the last whole step, going
 * back `days` days, oldest first. The most recent is a day old, so that part of
 * its horizon has been measured.
 */
export function originsOf(now: Date, step: ForecastStep, daysBack: number): Date[] {
  const last = floorTo(now, step).getTime();
  return Array.from({ length: daysBack }, (_, i) => new Date(last - (daysBack - i) * DAY_MS));
}

/** What was measured over a forecast's horizon, from one grid that covers every origin; null past the last whole step. */
export function measuredOver(values: readonly Cell[], gridStart: number, stepMs: number, origin: Date, horizon: number): Cell[] {
  const first = Math.round((origin.getTime() - gridStart) / stepMs);
  return Array.from({ length: horizon }, (_, h) => values[first + h] ?? null);
}

/**
 * A model replayed on the last days.
 *
 * At each origin the model is sent what was known at that instant and nothing
 * after it (the "as known at" read of D12). Its forecast is then held against
 * what was measured since, beside two rules over the very same steps: the same
 * hour a week before, and the last value held.
 * Nothing is trained, and nothing here is kept as a forecast: this is a trial
 * run on the past, and its result says so.
 *
 * A model that breaks the contract at any origin stops the replay there: a
 * score over the forecasts it happened to get right would flatter it.
 */
export async function backtestModel(
  db: DbClient,
  project: Project,
  model: ForecastModel,
  opts: { days?: number } = {},
  deps: CallDeps & { now?: () => Date; clock?: () => number } = {},
): Promise<{ model: ForecastModel; backtest: Backtest }> {
  const now = (deps.now ?? (() => new Date()))();
  const clock = deps.clock ?? Date.now;
  const daysBack = Math.min(BACKTEST_DAYS_MAX, Math.max(1, Math.round(opts.days ?? BACKTEST_DAYS)));
  const stepMs = STEP_MS[model.step];
  const origins = originsOf(now, model.step, daysBack);
  const lastStep = floorTo(now, model.step);
  const unit = await unitOf(db, project, model.metric);

  // What was measured, read once with everything known today, over every origin's horizon.
  const unitIds = (await unitsOf(db, project, model)).slice(0, SERIES_MAX);
  const gridStart = origins[0]!.getTime();
  const measured = unitIds.length && lastStep.getTime() > gridStart ? await gridFor(db, project, `${TWIN_PREFIX}${model.metric}`, unitIds, origins[0]!, lastStep, model.step, null, model.holdHours) : [];
  const measuredBy = new Map(measured.map((m) => [m.entity, m.values]));

  const byHorizon: Tally[] = Array.from({ length: model.horizonSteps }, emptyTally);
  const lines: Backtest["origins"] = [];
  let said: Backtest["said"] = null;
  let stopped: string | null = null;
  /** True when the model itself failed: it could not be reached, or it broke the contract. */
  let broke = false;
  const started = clock();
  for (const origin of origins) {
    if (clock() - started > BACKTEST_BUDGET_MS) {
      stopped = `The replay took more than ${BACKTEST_BUDGET_MS / 1000} seconds and stopped after ${lines.length} of ${origins.length} origins.`;
      break;
    }
    // As known at the origin: nothing written down after it is shown.
    const built = await buildRequest(db, project, model, origin, origin);
    if (built.request.series.length === 0) {
      lines.push({ origin: origin.toISOString(), series: 0, leftOut: built.leftOut.length, score: scoreOf([]) });
      continue;
    }
    const asked = await askModel(model, built.request, unit, deps);
    if (!asked.ok) {
      stopped = `At the origin of ${origin.toISOString().slice(0, 16).replace("T", " ")} UTC: ${asked.why}`;
      broke = true;
      break;
    }
    said = asked.said ?? said;
    const reference = new Map(referenceForecast(built.request).map((r) => [r.id, r]));
    const forecasts = new Map(asked.series.map((f) => [f.id, f]));
    const here: Tally[] = Array.from({ length: model.horizonSteps }, emptyTally);
    const sentBy = new Map(built.request.series.map((s) => [s.id, s]));
    for (const u of built.units) {
      const f = forecasts.get(u.label);
      const r = reference.get(u.label);
      const m = measuredBy.get(u.unitId);
      const sent = sentBy.get(u.label);
      if (!f || !r || !m || !sent) continue;
      const over = measuredOver(m, gridStart, stepMs, origin, model.horizonSteps);
      // The last value known at the origin, held: the second rule a model has to beat.
      const held = lastValueOf(sent.target, model.horizonSteps);
      tallyInto(here, f, r, held, over);
      tallyInto(byHorizon, f, r, held, over);
    }
    lines.push({ origin: origin.toISOString(), series: built.units.length, leftOut: built.leftOut.length, score: scoreOf(here) });
  }

  const overall = scoreOf(byHorizon);
  const backtest: Backtest = {
    ranAt: now.toISOString(),
    days: daysBack,
    step: model.step,
    horizon: model.horizonSteps,
    origins: lines,
    overall,
    byHorizon: byHorizon.map((t) => scoreOf([t])),
    verdict:
      model.source === "reference"
        ? { beats: null, why: "This is the reference itself: the rule every model is held to. It is not compared with itself." }
        : beatsReference(overall),
    partial: stopped !== null,
    stopped,
    said,
    unit,
  };
  // A replay the model failed in does not count as tried: it has no score to stand on.
  const tried = !broke;
  const { rows } = await db.query<ModelRow>(
    `UPDATE app.forecast_model
        SET state = CASE WHEN $4 AND state IN ('imported', 'verified') THEN 'tried' ELSE state END,
            tried_at = CASE WHEN $4 THEN NOW() ELSE tried_at END,
            backtest = $3::jsonb,
            last_error = $5,
            updated_at = NOW()
      WHERE project_id = $1 AND key = $2
      RETURNING ${COLUMNS}`,
    [project.id, model.key, JSON.stringify(backtest), tried, stopped],
  );
  return { model: rows[0] ? modelOf(rows[0]) : model, backtest };
}

// --- what can be imported ----------------------------------------------------------------------

export interface ModelOffer {
  /** The measures of the twin that have readings: what a model can forecast. */
  measures: { key: string; label: string; unit: string | null; units: number; since: string | null }[];
  /** The series declared on datasets, with their entities: what a model can be shown beside the target. */
  series: { key: string; label: string; entities: string[] }[];
  calendar: readonly string[];
  /** Whether an open model can be called at all. Without the service, only the reference runs. */
  service: { configured: boolean; says: string };
  /** The prefix a key's variable has to carry. */
  keyPrefix: string;
  contract: number;
  limits: { horizonMax: number; historyMax: number; seriesMax: number; sampleUnits: number; backtestDays: number };
}

export async function modelOffer(db: DbClient, project: Project, serviceUrl: string = config.modelServiceUrl): Promise<ModelOffer> {
  const [metrics, kept, declared, entities] = await Promise.all([
    listTwinMetrics(db, project.organizationId),
    db.query<{ metric: string; units: number; since: Date | null }>(
      `SELECT metric, count(DISTINCT unit_instance_id)::int AS units, min(COALESCE(observed_at, recorded_at)) AS since
         FROM app.twin_reading WHERE project_id = $1 GROUP BY metric`,
      [project.id],
    ),
    db.query<{ id: string; key: string; label: string }>(`SELECT id, key, label FROM app.kept_series WHERE project_id = $1 ORDER BY label`, [project.id]),
    db.query<{ series_id: string; entity: string }>(
      `SELECT DISTINCT p.series_id, p.entity FROM app.series_point p JOIN app.kept_series s ON s.id = p.series_id WHERE s.project_id = $1 ORDER BY 2`,
      [project.id],
    ),
  ]);
  const keptBy = new Map(kept.rows.map((r) => [r.metric, r]));
  return {
    measures: metrics
      .filter((m) => keptBy.has(m.key))
      .map((m) => ({ key: m.key, label: m.label, unit: m.unit ?? null, units: keptBy.get(m.key)!.units, since: iso(keptBy.get(m.key)!.since) })),
    series: declared.rows.map((s) => ({ key: s.key, label: s.label, entities: entities.rows.filter((e) => e.series_id === s.id).map((e) => e.entity) })),
    calendar: CALENDAR,
    service: serviceUrl
      ? { configured: true, says: "An open model can be called through the model service." }
      : { configured: false, says: "The model service is not configured on this server (MODEL_SERVICE_URL). Everything works with the built-in reference; an open model cannot be called until an administrator sets it." },
    keyPrefix: "MODEL_KEY_",
    contract: CONTRACT_VERSION,
    limits: { horizonMax: HORIZON_MAX, historyMax: HISTORY_MAX, seriesMax: SERIES_MAX, sampleUnits: SAMPLE_UNITS, backtestDays: BACKTEST_DAYS },
  };
}
