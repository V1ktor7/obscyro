import type { DbClient } from "../lib/db.js";
import type { FreshnessBasis } from "./observed-at.js";
import { getUnitTree, rollupAllUnits, type UnitMetrics } from "./twin.js";

// ---------------------------------------------------------------------------
// The twin keeps what it measured.
//
// A unit's measures are computed when they are read, from the objects as they
// stand: once a reading replaces another, the earlier value is gone. The twin
// could say "now" and nothing else. Not what an emergency room showed this
// morning, not what is usual for it at this hour, not what changed after a
// decision.
//
// This keeps the readings. Every few minutes the twin is read whole, and what
// changed is written down: a unit, a measure, a value, when that value was
// true according to its source, and when it was written here. Those are two
// different times, and both are kept (see D7 for the first).
//
// Four things are deliberate:
//
//   only changes   a value that is the same, read at the same time, is the
//                  same reading. An hourly file re-read twelve times in the
//                  hour is one reading, not twelve.
//   absence shows  a measure that stops having a value is written down as
//                  having none. A gap in the readings is not a zero.
//   reality only   the twin is read with no lens. A reading made through a
//                  scenario describes a world that is not there.
//   nothing made   the history starts the day this started. What is older
//   up             comes only from a copy of the source that was really kept,
//                  replayed afterwards (`series-catchup.ts`, D12): such a
//                  reading is marked as caught up, and the screen says so.
//                  Nothing else is ever filled in.
//
// Nothing here is about a person: a unit and an aggregate value.
// ---------------------------------------------------------------------------

/** How often the twin is read for its history. A change is written down at most this long after it happened. */
export const RECORD_EVERY_MS = 5 * 60_000;

/** The first reading after the server starts: soon, but after the listeners are up. */
const FIRST_AFTER_MS = 30_000;

/**
 * Two times this close are the same reading.
 *
 * The roll-up gives a value's age in whole seconds, counted from its own
 * clock; the time the value was true is that age taken off ours. The same
 * source timestamp therefore comes back a second or two apart from one pass
 * to the next. Sources publish by the hour or by the day, so a minute and a
 * half cannot hide a new reading.
 */
export const SAME_READING_SECONDS = 90;

export interface Reading {
  unitId: string;
  metric: string;
  /** Null when the measure has no value here now. */
  value: number | null;
  /** When the value was true, from the timestamp its source published; null when the source does not say. */
  observedAt: Date | null;
  /** What that time rests on; null when the measure was not dated. */
  observedBasis: FreshnessBasis | null;
}

/**
 * What the twin reads now, measure by measure: one candidate per unit and per
 * measure the organisation defined, with or without a value.
 *
 * A measure without a value is listed too. Whether it is worth a line is the
 * recorder's call: it is, when the measure had one before.
 */
export function readingsNow(metricsByUnit: ReadonlyMap<string, UnitMetrics>, now: Date): Reading[] {
  const out: Reading[] = [];
  for (const [unitId, m] of metricsByUnit) {
    for (const [metric, raw] of Object.entries(m.values)) {
      const value = raw !== null && Number.isFinite(raw) ? raw : null;
      // The age of what this measure reads, not of everything under the unit.
      const own = value === null ? undefined : m.valueAges[metric];
      const seconds = own?.seconds ?? null;
      out.push({
        unitId,
        metric,
        value,
        observedAt: seconds === null || !Number.isFinite(seconds) ? null : new Date(now.getTime() - seconds * 1000),
        observedBasis: own?.basis ?? null,
      });
    }
  }
  return out;
}

/**
 * Write down what changed since the last reading kept for each unit and
 * measure, in one statement. Returns how many readings were written.
 *
 * A candidate becomes a reading when:
 *   - nothing was kept for it yet, and it has a value;
 *   - or its value differs from the last one kept (having none counts);
 *   - or it has the same value, and its source dates it at another time.
 */
export async function recordReadings(db: DbClient, projectId: string, readings: readonly Reading[]): Promise<number> {
  if (readings.length === 0) return 0;
  const { rows } = await db.query<{ n: number }>(
    `WITH written AS (
       INSERT INTO app.twin_reading (project_id, unit_instance_id, metric, value, observed_at, observed_basis)
       SELECT $1, x.unit_id, x.metric, x.value, x.observed_at, x.observed_basis
         FROM unnest($2::uuid[], $3::text[], $4::double precision[], $5::timestamptz[], $6::text[])
              AS x(unit_id, metric, value, observed_at, observed_basis)
         LEFT JOIN LATERAL (
               SELECT true AS kept, r.value, r.observed_at
                 FROM app.twin_reading r
                WHERE r.unit_instance_id = x.unit_id AND r.metric = x.metric AND r.project_id = $1
                ORDER BY r.recorded_at DESC
                LIMIT 1) last ON true
        WHERE (last.kept IS NULL AND x.value IS NOT NULL)
           OR (last.kept AND last.value IS DISTINCT FROM x.value)
           OR (last.kept AND x.value IS NOT NULL
               AND ((last.observed_at IS NULL) <> (x.observed_at IS NULL)
                    OR abs(extract(epoch FROM (x.observed_at - last.observed_at))) > $7))
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM written`,
    [
      projectId,
      readings.map((r) => r.unitId),
      readings.map((r) => r.metric),
      readings.map((r) => r.value),
      // As text: an array of timestamps is sent the same way by every driver.
      readings.map((r) => (r.observedAt ? r.observedAt.toISOString() : null)),
      readings.map((r) => r.observedBasis),
      SAME_READING_SECONDS,
    ],
  );
  return rows[0]?.n ?? 0;
}

/**
 * One project, read once and written down. Null when the project has no unit:
 * there is nothing to roll up, and rolling up would read every object it has
 * to find that out.
 */
export async function recordProject(db: DbClient, projectId: string, now: Date = new Date()): Promise<{ units: number; written: number } | null> {
  // No lens, on purpose: reality only.
  const { nodes } = await getUnitTree(db, projectId);
  if (nodes.length === 0) return null;
  const metrics = await rollupAllUnits(db, projectId);
  return { units: metrics.size, written: await recordReadings(db, projectId, readingsNow(metrics, now)) };
}

export interface PassResult {
  projects: number;
  written: number;
  failed: number;
}

/** Every project that has units, one after another. One project's failure does not cost the others their reading. */
export async function recordAllProjects(db: DbClient, onError?: (projectId: string, err: unknown) => void): Promise<PassResult> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM app.project ORDER BY id`);
  const result: PassResult = { projects: 0, written: 0, failed: 0 };
  for (const { id } of rows) {
    try {
      const r = await recordProject(db, id);
      if (!r) continue;
      result.projects += 1;
      result.written += r.written;
    } catch (err) {
      result.failed += 1;
      onError?.(id, err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reading the history back.
// ---------------------------------------------------------------------------

/** The readings a single answer lists. Past it the oldest are left out, and the answer says so. */
export const HISTORY_LIMIT = 2000;

export interface KeptReading {
  value: number | null;
  observedAt: string | null;
  observedBasis: FreshnessBasis | null;
  /** When it was written down. For a reading caught up, when the copy it comes from was taken. */
  recordedAt: string;
  /**
   * Present, and true, on a reading caught up afterwards from a kept copy of
   * its source: the twin did not show it at the time.
   */
  replayed?: true;
}

export interface UnitHistory {
  /** The server's clock when this was read. */
  at: string;
  unitId: string;
  metric: string;
  /** The window asked for, in hours back from `at`. */
  hours: number;
  /**
   * When the first reading of this measure at this unit was written down, in
   * the whole history and not only in the window. Null when none ever was:
   * nothing can be said of earlier, and that is not the same as "no change".
   */
  since: string | null;
  /** True when that first reading was caught up from a kept copy rather than taken by the twin. */
  sinceCaughtUp: boolean;
  /** Oldest first. */
  readings: KeptReading[];
  /** True when the window held more than the list: the oldest readings of the window are missing from it. */
  cut: boolean;
  /** How often the twin is read for its history, in seconds: a change is written down at most this long after it happened. */
  everySeconds: number;
}

interface ReadingRow {
  value: number | null;
  observed_at: Date | null;
  observed_basis: FreshnessBasis | null;
  recorded_at: Date;
  replayed?: boolean | null;
}

const kept = (r: ReadingRow): KeptReading => ({
  value: r.value,
  observedAt: r.observed_at ? r.observed_at.toISOString() : null,
  observedBasis: r.observed_basis,
  recordedAt: r.recorded_at.toISOString(),
  ...(r.replayed ? { replayed: true as const } : {}),
});

/**
 * The readings kept for one measure of one unit, over the last `hours`.
 *
 * The reading in force when the window opens is included, when there is one:
 * a value written down yesterday that has not changed since is still the value
 * this morning, and a window that started after it would show nothing.
 */
export async function readUnitHistory(
  db: DbClient,
  projectId: string,
  unitId: string,
  metric: string,
  hours: number,
  now: Date = new Date(),
  limit: number = HISTORY_LIMIT,
): Promise<UnitHistory> {
  const from = new Date(now.getTime() - hours * 3_600_000);
  const [inWindow, before, first] = await Promise.all([
    db.query<ReadingRow>(
      `SELECT value, observed_at, observed_basis, recorded_at, replayed
         FROM app.twin_reading
        WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3 AND recorded_at >= $4
        ORDER BY recorded_at DESC
        LIMIT $5`,
      [projectId, unitId, metric, from, limit + 1],
    ),
    db.query<ReadingRow>(
      `SELECT value, observed_at, observed_basis, recorded_at, replayed
         FROM app.twin_reading
        WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3 AND recorded_at < $4
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [projectId, unitId, metric, from],
    ),
    db.query<{ since: Date | null; replayed: boolean | null }>(
      `SELECT recorded_at AS since, replayed FROM app.twin_reading
        WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3
        ORDER BY recorded_at ASC
        LIMIT 1`,
      [projectId, unitId, metric],
    ),
  ]);
  const cut = inWindow.rows.length > limit;
  const listed = inWindow.rows.slice(0, limit).reverse();
  // Only when the window is whole: a list already cut at its oldest end has no room for what came before it.
  const opening = !cut && before.rows[0] ? [before.rows[0]] : [];
  return {
    at: now.toISOString(),
    unitId,
    metric,
    hours,
    since: first.rows[0]?.since ? first.rows[0].since.toISOString() : null,
    sinceCaughtUp: first.rows[0]?.replayed === true,
    readings: [...opening, ...listed].map(kept),
    cut,
    everySeconds: RECORD_EVERY_MS / 1000,
  };
}

export interface ReadingsBetween {
  /** The reading in force when the stretch begins: the last one written down before it. Null when none was. */
  opening: KeptReading | null;
  /** The readings written down during the stretch, oldest first. */
  readings: KeptReading[];
  /** True when the stretch held more than the list: its oldest readings are missing from it. */
  cut: boolean;
  /** When the first reading of this measure at this unit was written down, in the whole history. */
  since: string | null;
}

/**
 * What was written down for one measure of one unit between two instants.
 *
 * "Between" is counted on when a reading was written down, not on when its
 * source says it was true: what is asked is what the twin showed at the time,
 * to a person who was looking at it. A reading caught up afterwards from a
 * kept copy is listed too, at the time its copy was taken, and says so
 * (`replayed`): the twin did not show that one.
 */
export async function readReadingsBetween(
  db: DbClient,
  projectId: string,
  unitId: string,
  metric: string,
  from: Date,
  to: Date,
  limit: number = HISTORY_LIMIT,
): Promise<ReadingsBetween> {
  const [during, before, first] = await Promise.all([
    db.query<ReadingRow>(
      `SELECT value, observed_at, observed_basis, recorded_at, replayed
         FROM app.twin_reading
        WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3 AND recorded_at >= $4 AND recorded_at <= $5
        ORDER BY recorded_at DESC
        LIMIT $6`,
      [projectId, unitId, metric, from, to, limit + 1],
    ),
    db.query<ReadingRow>(
      `SELECT value, observed_at, observed_basis, recorded_at, replayed
         FROM app.twin_reading
        WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3 AND recorded_at < $4
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [projectId, unitId, metric, from],
    ),
    db.query<{ since: Date | null }>(
      `SELECT min(recorded_at) AS since FROM app.twin_reading WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3`,
      [projectId, unitId, metric],
    ),
  ]);
  const cut = during.rows.length > limit;
  return {
    opening: before.rows[0] ? kept(before.rows[0]) : null,
    readings: during.rows.slice(0, limit).reverse().map(kept),
    cut,
    since: first.rows[0]?.since ? first.rows[0].since.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// What moved, and what is usual.
//
// Two figures a person reads beside a value: how far it is from the reading
// before, and, for a figure published once a day, what it has been on average.
// Both are arithmetic on readings that were kept, done here and not on a
// screen, and both say what they rest on: the hour of the reading compared
// with, the number of days under the average.
// ---------------------------------------------------------------------------

/** How many readings back a change looks for the one before: enough to step over a day of hourly republication. */
export const TREND_READINGS = 40;

/** The days an average covers at most. */
export const MEAN_DAYS = 30;

export interface MeasureChange {
  /**
   * The reading kept before the value now shown. Null when none was kept: the
   * history starts with this value, and nothing can be said of before.
   */
  previous: {
    /** Null when the measure had no value then: there is no change to count against an absence. */
    value: number | null;
    /** When that reading was true by its source; when it was written here, if the source gave no time. */
    at: string;
    atIs: "observed" | "recorded";
  } | null;
  /** The value now minus that reading's. Null whenever there is nothing to subtract from. */
  delta: number | null;
}

export interface DailyMean {
  /** The mean of one value a day. */
  mean: number;
  /** How many days it is made of. Fewer than the window when the history is younger. */
  days: number;
  /** The first and last day counted, as dates on the source's clock. */
  from: string;
  to: string;
  /** The most days it could cover. */
  window: number;
}

export interface UnitTrends {
  /** The server's clock when this was read. */
  at: string;
  /** Keyed by measure, for the measures that have a value at the unit. */
  changes: Record<string, MeasureChange>;
  /** Keyed by measure, for the measures whose value describes a day and that have days kept. */
  means: Record<string, DailyMean>;
}

interface TrendRow {
  metric: string;
  value: number | null;
  observed_at: Date | null;
  recorded_at: Date;
}

/** The date a moment falls on, on a named clock: `2026-11-22`. */
export function dayOn(at: Date, zone: string | null | undefined): string {
  try {
    // en-CA writes a date as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * The reading before the one on screen, and how far the value moved since.
 *
 * `kept` is newest first. The newest kept reading is usually the value on
 * screen itself, written down a few minutes ago: it is recognised by its time
 * (within the tolerance that makes two readings one, D11), or by its value when
 * the source gives no time, and stepped over. When the recorder has not caught
 * up yet, the newest kept reading is the one before, and is used as such.
 * A value corrected within its hour leaves two readings at the same time: both
 * are stepped over, and the change is counted from the hour before.
 *
 * A value that describes a day is compared with the last reading of an earlier
 * day: the same daily figure republished an hour ago is not "the reading
 * before".
 */
export function changeOf(
  current: { value: number; observedAt: Date | null; period?: string | null; zone?: string | null },
  kept: readonly TrendRow[],
  now: Date,
): MeasureChange {
  const timeOf = (r: TrendRow) => r.observed_at ?? r.recorded_at;
  let previous: TrendRow | undefined;
  if (current.period === "previous_day") {
    const today = dayOn(current.observedAt ?? now, current.zone);
    previous = kept.find((r) => dayOn(timeOf(r), current.zone) < today);
  } else if (current.observedAt) {
    // Every reading kept at the hour of the value on screen is that value, or
    // an earlier writing of it: a figure corrected within its hour is kept
    // twice at the same time. None of them is "the reading before".
    const at = current.observedAt.getTime();
    previous = kept.find((r) => !r.observed_at || Math.abs(at - r.observed_at.getTime()) > SAME_READING_SECONDS * 1000);
  } else {
    const first = kept[0];
    const isCurrent = first !== undefined && !first.observed_at && first.value === current.value;
    previous = isCurrent ? kept[1] : first;
  }
  if (!previous) return { previous: null, delta: null };
  return {
    previous: {
      value: previous.value,
      at: timeOf(previous).toISOString(),
      atIs: previous.observed_at ? "observed" : "recorded",
    },
    delta: previous.value === null ? null : current.value - previous.value,
  };
}

/**
 * The mean of one value a day, over the days kept.
 *
 * `days` is newest first, one row a day. Nothing is filled in for a day that
 * has no reading: the mean says how many days it is made of.
 */
export function meanOfDays(days: readonly { day: string; value: number }[], window: number = MEAN_DAYS): DailyMean | null {
  const counted = days.slice(0, window);
  if (counted.length === 0) return null;
  return {
    mean: counted.reduce((a, d) => a + d.value, 0) / counted.length,
    days: counted.length,
    from: counted[counted.length - 1]!.day,
    to: counted[0]!.day,
    window,
  };
}

/**
 * For every measure that has a value at this unit: the change since the reading
 * before. For those whose value describes a day: their mean over the days kept.
 *
 * One read for the changes, whatever the number of measures, and one per daily
 * measure for its days.
 */
export async function readUnitTrends(
  db: DbClient,
  projectId: string,
  unitId: string,
  metrics: Pick<UnitMetrics, "values" | "valueAges">,
  now: Date = new Date(),
): Promise<UnitTrends> {
  const measures = Object.entries(metrics.values).filter(
    (e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]),
  );
  const out: UnitTrends = { at: now.toISOString(), changes: {}, means: {} };
  if (measures.length === 0) return out;

  const { rows } = await db.query<TrendRow>(
    `SELECT metric, value, observed_at, recorded_at
       FROM (SELECT metric, value, observed_at, recorded_at,
                    row_number() OVER (PARTITION BY metric ORDER BY recorded_at DESC) AS n
               FROM app.twin_reading
              WHERE project_id = $1 AND unit_instance_id = $2 AND metric = ANY($3::text[])) x
      WHERE n <= $4
      ORDER BY metric, recorded_at DESC`,
    [projectId, unitId, measures.map(([key]) => key), TREND_READINGS],
  );
  const keptBy = new Map<string, TrendRow[]>();
  for (const r of rows) keptBy.set(r.metric, [...(keptBy.get(r.metric) ?? []), r]);

  for (const [metric, value] of measures) {
    const age = metrics.valueAges[metric];
    const seconds = age?.seconds ?? null;
    const observedAt = seconds === null || !Number.isFinite(seconds) ? null : new Date(now.getTime() - seconds * 1000);
    out.changes[metric] = changeOf({ value, observedAt, period: age?.period ?? null, zone: age?.zone ?? null }, keptBy.get(metric) ?? [], now);

    if (age?.period !== "previous_day") continue;
    // One value a day: the last one written down that day, on the source's clock.
    const days = await db.query<{ day: string; value: number }>(
      `SELECT DISTINCT ON (day) day::text AS day, value
         FROM (SELECT (COALESCE(observed_at, recorded_at) AT TIME ZONE $4)::date AS day, value, recorded_at
                 FROM app.twin_reading
                WHERE project_id = $1 AND unit_instance_id = $2 AND metric = $3
                  AND value IS NOT NULL AND recorded_at >= $5) x
        ORDER BY day DESC, recorded_at DESC`,
      [projectId, unitId, metric, age.zone || "UTC", new Date(now.getTime() - (MEAN_DAYS + 1) * 86_400_000)],
    );
    const mean = meanOfDays(days.rows);
    if (mean) out.means[metric] = mean;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------------

let started = false;

export function startTwinHistory(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (started || process.env.TWIN_HISTORY_DISABLED === "1") return;
  started = true;
  log.info({ everyMs: RECORD_EVERY_MS }, "twin history recorder started");

  const pass = async (): Promise<void> => {
    const startedAt = Date.now();
    try {
      const r = await recordAllProjects(pool as DbClient, (projectId, err) => log.warn({ err, projectId }, "twin history: a project could not be read"));
      if (r.written > 0 || r.failed > 0) log.info({ ...r, ms: Date.now() - startedAt }, "twin history written");
    } catch (err) {
      log.warn({ err }, "twin history pass failed");
    }
    // Scheduled once the pass is over, never on a clock: two passes cannot overlap.
    setTimeout(() => void pass(), RECORD_EVERY_MS).unref?.();
  };
  setTimeout(() => void pass(), FIRST_AFTER_MS).unref?.();
}
