import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { getDataset } from "./datasets.js";
import { readAllRows } from "./lab-models.js";
import { proxyToSimService } from "./ml-simulation.js";

/**
 * The daily forecasting loop: forecast, freeze, score, watch for drift, retrain.
 *
 * The simulation service computes a block of mornings from the series it is
 * sent and forgets it; this file is what remembers. Each forecast is inserted
 * once and never touched again, which is the whole point of freezing it — "what
 * we expected a week ago" is only worth reading if nobody could have revised it.
 *
 * The loop catches up on its own. A new loop starts at its first morning and
 * replays every morning since, a block at a time, until it reaches the morning
 * after the last value; then it waits for the dataset to grow. A historical
 * series is therefore a replay and a synced one is live, through the same code.
 */

export interface LoopSpec {
  key: string;
  label: string;
  estimator: string;
  /** Whether this model also reads the driver. */
  exog: boolean;
  params: Record<string, unknown>;
}

export interface ForecastLoop {
  id: string;
  projectId: string;
  name: string;
  datasetId: string;
  datasetName: string;
  timeColumn: string;
  target: string;
  driver: { datasetId: string; datasetName: string; timeColumn: string; column: string; delay: number } | null;
  horizons: number[];
  lags: number;
  specs: LoopSpec[];
  startDate: string;
  frozenThrough: string | null;
  status: "replaying" | "live" | "failed";
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mornings computed per call: about twenty seconds of fitting on the service. */
export const BLOCK_DAYS = 28;

export const DEFAULT_HORIZONS = [1, 3, 7, 14, 21];

export function defaultSpecs(target: string, driver: string | null): LoopSpec[] {
  return [
    { key: "A", label: `Ridge · 14 days of ${target} + calendar`, estimator: "ridge", exog: false, params: {} },
    {
      key: "B",
      label: driver ? `Gradient boosting · ${target} + ${driver}` : `Gradient boosting · ${target} + calendar`,
      estimator: "gradient_boosting",
      exog: !!driver,
      params: { n_estimators: 50, learning_rate: 0.15 },
    },
  ];
}

// --- dates -------------------------------------------------------------------

export function dayOf(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A published "." or an empty cell is missing, not zero. */
export function numberOf(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  if (s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// --- the series --------------------------------------------------------------

/** Target and driver on one row a day, keyed by the target's dates. */
export function mergeSeries(
  target: Record<string, unknown>[],
  timeColumn: string,
  column: string,
  driver?: { rows: Record<string, unknown>[]; timeColumn: string; column: string },
): { rows: Array<{ date: string; y: number | null; x?: number | null }>; actual: Record<string, number>; lastDay: string | null } {
  const x = new Map<string, number | null>();
  if (driver) for (const r of driver.rows) { const d = dayOf(r[driver.timeColumn]); if (d) x.set(d, numberOf(r[driver.column])); }
  const seen = new Set<string>();
  const rows: Array<{ date: string; y: number | null; x?: number | null }> = [];
  const actual: Record<string, number> = {};
  let lastDay: string | null = null;
  for (const r of target) {
    const d = dayOf(r[timeColumn]);
    if (!d) continue;
    if (seen.has(d)) {
      throw BadRequest(
        "SERIES_NOT_DAILY",
        `Two rows carry ${d} in "${timeColumn}". The loop forecasts one value a day: filter the table to one region, or aggregate it first.`,
      );
    }
    seen.add(d);
    const y = numberOf(r[column]);
    rows.push(driver ? { date: d, y, x: x.get(d) ?? null } : { date: d, y });
    if (y != null) {
      actual[d] = y;
      if (!lastDay || d > lastDay) lastDay = d;
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { rows, actual, lastDay };
}

/** Days of history a refit needs before the first morning, with room for the lags. */
export const MIN_HISTORY_DAYS = 90;

/**
 * Refuse a table that is not a daily series before a loop is stored on it.
 *
 * Without this, a table of parameters or of contacts made a loop that was
 * accepted, found no date to forecast from, and sat at "nothing frozen yet"
 * for ever. Saying which column is wrong, at the moment it was chosen, is the
 * only point where the person can still fix it.
 */
export function assertSeries(rows: Record<string, unknown>[], timeColumn: string, column: string, start: string): void {
  const dated = rows.filter((r) => dayOf(r[timeColumn]) != null).length;
  if (!dated) {
    throw BadRequest(
      "NOT_A_SERIES",
      `"${timeColumn}" holds no dates in this table. A loop forecasts a daily series: pick a table with one date per row and the column with the number to forecast.`,
    );
  }
  const { actual } = mergeSeries(rows, timeColumn, column);
  const before = Object.keys(actual).filter((d) => d < start).length;
  if (!Object.keys(actual).length) {
    throw BadRequest("NOT_A_SERIES", `"${column}" holds no numbers in this table. Pick the column with the value to forecast.`);
  }
  if (before < MIN_HISTORY_DAYS) {
    throw BadRequest(
      "TOO_LITTLE_HISTORY",
      `Only ${before} days of "${column}" come before the first morning (${start}); the models need at least ${MIN_HISTORY_DAYS} to learn from. Pick a later first morning.`,
    );
  }
}

/** The next mornings to freeze, or null once the loop has reached the morning after the data. */
export function nextBlock(start: string, frozenThrough: string | null, lastDay: string | null): { first: string; last: string } | null {
  if (!lastDay) return null;
  const first = frozenThrough ? addDays(frozenThrough, 1) : start;
  const limit = addDays(lastDay, 1);
  if (first > limit) return null;
  const last = addDays(first, BLOCK_DAYS - 1);
  return { first, last: last < limit ? last : limit };
}

// --- storage -----------------------------------------------------------------

interface Raw {
  id: string;
  project_id: string;
  name: string;
  dataset_id: string;
  dataset_name: string;
  time_column: string;
  target: string;
  driver_dataset_id: string | null;
  driver_dataset_name: string | null;
  driver_time_column: string | null;
  driver_column: string | null;
  driver_delay: number;
  horizons: number[];
  lags: number;
  specs: LoopSpec[];
  start_date: string;
  frozen_through: string | null;
  status: ForecastLoop["status"];
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `
  SELECT l.id, l.project_id, l.name, l.dataset_id, d.name AS dataset_name, l.time_column, l.target,
         l.driver_dataset_id, dd.name AS driver_dataset_name, l.driver_time_column, l.driver_column, l.driver_delay,
         l.horizons, l.lags, l.specs, l.start_date::text AS start_date, l.frozen_through::text AS frozen_through,
         l.status, l.last_error, l.created_at, l.updated_at
    FROM app.forecast_loop l
    JOIN app.dataset d ON d.id = l.dataset_id
    LEFT JOIN app.dataset dd ON dd.id = l.driver_dataset_id`;

function out(r: Raw): ForecastLoop {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    timeColumn: r.time_column,
    target: r.target,
    driver:
      r.driver_dataset_id && r.driver_time_column && r.driver_column
        ? { datasetId: r.driver_dataset_id, datasetName: r.driver_dataset_name ?? "", timeColumn: r.driver_time_column, column: r.driver_column, delay: r.driver_delay }
        : null,
    horizons: r.horizons,
    lags: r.lags,
    specs: r.specs,
    startDate: r.start_date,
    frozenThrough: r.frozen_through,
    status: r.status,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listLoops(db: DbClient, projectId: string): Promise<ForecastLoop[]> {
  const { rows } = await db.query<Raw>(`${SELECT} WHERE l.project_id = $1 ORDER BY l.created_at ASC`, [projectId]);
  return rows.map(out);
}

export async function getLoop(db: DbClient, id: string, projectId?: string): Promise<ForecastLoop> {
  const { rows } = await db.query<Raw>(`${SELECT} WHERE l.id = $1`, [id]);
  const r = rows[0];
  if (!r || (projectId && r.project_id !== projectId)) throw NotFound("LOOP_NOT_FOUND", "Forecast loop not found.");
  return out(r);
}

export interface NewLoop {
  name: string;
  datasetId: string;
  timeColumn: string;
  target: string;
  driver?: { datasetId: string; timeColumn: string; column: string; delay?: number } | null;
  horizons?: number[];
  lags?: number;
  startDate: string;
}

export async function createLoop(db: DbClient, projectId: string, userId: string, body: NewLoop): Promise<ForecastLoop> {
  const ds = await getDataset(db, body.datasetId);
  if (ds.projectId !== projectId) throw BadRequest("DATASET_NOT_IN_PROJECT", "The series must come from a dataset in this project.");
  if (body.driver) {
    const dd = await getDataset(db, body.driver.datasetId);
    if (dd.projectId !== projectId) throw BadRequest("DATASET_NOT_IN_PROJECT", "The driver must come from a dataset in this project.");
  }
  const start = dayOf(body.startDate);
  if (!start) throw BadRequest("INVALID_DATE", "The first morning must be a date, YYYY-MM-DD.");
  assertSeries(await readAllRows(db, body.datasetId), body.timeColumn, body.target, start);
  const horizons = [...new Set(body.horizons?.length ? body.horizons : DEFAULT_HORIZONS)].sort((a, b) => a - b);
  const specs = defaultSpecs(body.target, body.driver?.column ?? null);
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO app.forecast_loop
         (project_id, name, dataset_id, time_column, target,
          driver_dataset_id, driver_time_column, driver_column, driver_delay,
          horizons, lags, specs, start_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
       RETURNING id`,
      [
        projectId, body.name.trim(), body.datasetId, body.timeColumn, body.target,
        body.driver?.datasetId ?? null, body.driver?.timeColumn ?? null, body.driver?.column ?? null, body.driver?.delay ?? 1,
        horizons, body.lags ?? 14, JSON.stringify(specs), start, userId,
      ],
    );
    return getLoop(db, rows[0]!.id);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw Conflict("LOOP_EXISTS", `A loop called "${body.name}" already exists.`);
    throw err;
  }
}

export async function deleteLoop(db: DbClient, id: string): Promise<void> {
  await db.query(`DELETE FROM app.forecast_loop WHERE id = $1`, [id]);
}

async function seriesOf(db: DbClient, loop: ForecastLoop) {
  const target = await readAllRows(db, loop.datasetId);
  const driver = loop.driver
    ? { rows: await readAllRows(db, loop.driver.datasetId), timeColumn: loop.driver.timeColumn, column: loop.driver.column }
    : undefined;
  return mergeSeries(target, loop.timeColumn, loop.target, driver);
}

interface BlockOut {
  forecasts: Array<{ made: string; h: number; spec: string; value: number }>;
  retrains: Array<{ on: string; h: number; spec: string; mae: number | null; points: number }>;
}

const running = new Set<string>();

/**
 * Freeze the next block of mornings. Safe to call twice at once: the second
 * call returns without work, and inserts that do race are no-ops.
 */
export async function catchUpOnce(db: DbClient, id: string): Promise<ForecastLoop> {
  if (running.has(id)) return getLoop(db, id);
  running.add(id);
  try {
    const loop = await getLoop(db, id);
    const { rows, lastDay } = await seriesOf(db, loop);
    const block = nextBlock(loop.startDate, loop.frozenThrough, lastDay);
    if (!block) {
      await db.query(`UPDATE app.forecast_loop SET status = 'live', last_error = NULL, updated_at = NOW() WHERE id = $1`, [id]);
      return getLoop(db, id);
    }
    try {
      const res = await proxyToSimService<BlockOut>("/lab/forecast/loop", {
        rows,
        time_column: "date",
        target: "y",
        horizons: loop.horizons,
        lags: loop.lags,
        specs: loop.specs.map((s) => ({ key: s.key, estimator: s.estimator, exog: s.exog && loop.driver ? ["x"] : [], params: s.params })),
        start: loop.startDate,
        first: block.first,
        last: block.last,
        exog_delay: loop.driver?.delay ?? 1,
      });
      const f = res.forecasts;
      if (f.length) {
        await db.query(
          `INSERT INTO app.forecast_frozen (loop_id, made_on, horizon, spec, value)
           SELECT $1, m::date, h, s, v FROM unnest($2::text[], $3::int[], $4::text[], $5::float8[]) AS t(m, h, s, v)
           ON CONFLICT DO NOTHING`,
          [id, f.map((x) => x.made), f.map((x) => x.h), f.map((x) => x.spec), f.map((x) => x.value)],
        );
      }
      const r = res.retrains;
      if (r.length) {
        await db.query(
          `INSERT INTO app.forecast_retrain (loop_id, on_date, horizon, spec, mae, points)
           SELECT $1, o::date, h, s, m, p FROM unnest($2::text[], $3::int[], $4::text[], $5::float8[], $6::int[]) AS t(o, h, s, m, p)
           ON CONFLICT DO NOTHING`,
          [id, r.map((x) => x.on), r.map((x) => x.h), r.map((x) => x.spec), r.map((x) => x.mae), r.map((x) => x.points)],
        );
      }
      const caughtUp = block.last >= addDays(lastDay!, 1);
      await db.query(
        `UPDATE app.forecast_loop
            SET frozen_through = $2::date, status = $3, last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [id, block.last, caughtUp ? "live" : "replaying"],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.query(
        `UPDATE app.forecast_loop SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`,
        [id, message.slice(0, 1000)],
      );
      throw err;
    }
    return getLoop(db, id);
  } finally {
    running.delete(id);
  }
}

export interface LoopView {
  loop: ForecastLoop;
  actual: Record<string, number>;
  lastDay: string | null;
  forecasts: Array<{ made: string; h: number; spec: string; value: number }>;
  retrains: Array<{ on: string; h: number; spec: string; mae: number | null; points: number }>;
}

export async function loopView(db: DbClient, loop: ForecastLoop): Promise<LoopView> {
  const { actual, lastDay } = await seriesOf(db, loop);
  const [{ rows: f }, { rows: r }] = await Promise.all([
    db.query<{ made: string; h: number; spec: string; value: number }>(
      `SELECT made_on::text AS made, horizon AS h, spec, value FROM app.forecast_frozen WHERE loop_id = $1 ORDER BY made_on`,
      [loop.id],
    ),
    db.query<{ on: string; h: number; spec: string; mae: number | null; points: number }>(
      `SELECT on_date::text AS on, horizon AS h, spec, mae, points FROM app.forecast_retrain WHERE loop_id = $1 ORDER BY on_date`,
      [loop.id],
    ),
  ]);
  return { loop, actual, lastDay, forecasts: f, retrains: r };
}

// --- the scheduler -----------------------------------------------------------

const TICK_MS = 15_000;
let started = false;

/**
 * One block per tick for the loop that has waited longest. A replay of a year
 * is fifteen blocks, so it finishes in minutes without ever holding a request
 * open; a live loop wakes up when its dataset is written again.
 */
export function startForecastLoopScheduler(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (started || process.env.FORECAST_LOOP_SCHEDULER_DISABLED === "1") return;
  started = true;
  log.info({ tickMs: TICK_MS }, "forecast loop scheduler started");
  setInterval(() => {
    void (async () => {
      const db = pool as DbClient;
      try {
        // New data on a loop that had caught up: it has mornings to freeze again.
        await db.query(
          `UPDATE app.forecast_loop l SET status = 'replaying', updated_at = NOW()
             FROM app.dataset d
            WHERE d.id = l.dataset_id AND l.status = 'live' AND d.last_written_at > l.updated_at`,
        );
        const { rows } = await db.query<{ id: string }>(
          `SELECT id FROM app.forecast_loop WHERE status = 'replaying' ORDER BY updated_at ASC LIMIT 1`,
        );
        for (const r of rows) {
          try {
            await catchUpOnce(db, r.id);
          } catch (err) {
            log.warn({ err, loopId: r.id }, "forecast loop block failed");
          }
        }
      } catch (err) {
        log.warn({ err }, "forecast loop scheduler tick failed");
      }
    })();
  }, TICK_MS).unref?.();
}
