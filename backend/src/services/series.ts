import { z } from "zod";

import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { getDataset, listDatasets, type DatasetRow } from "./datasets.js";
import { readStamp } from "./observed-at.js";
import { SERIES_COLUMNS, SERIES_STEPS, WHOLE, captureInto, seriesOf, type CaptureResult, type SeriesDbRow, type SeriesDef, type SeriesStep } from "./series-capture.js";
import { getUnitTree } from "./twin.js";
import { listTwinMetrics } from "./twin-metrics.js";

// ---------------------------------------------------------------------------
// Kept series: a history a model can read.
//
// A forecasting model only knows what it is shown of the past. The platform
// kept that past in two shapes: the twin's readings (one line when a measure
// changes, per unit) and the copies of its datasets (a whole file per sync).
// Neither answers "this measure, at this place, from this day to that one,
// hour by hour".
//
// A series is that answer. There are two kinds, read the same way:
//
//   a measure of the twin   every measure the organisation defined is one,
//                           with nothing to declare. Its points are the
//                           twin's readings (`app.twin_reading`), one unit
//                           being one entity.
//   a series of a dataset   declared from the Studio on a dataset: the column
//                           of the time, the column of the value, the columns
//                           that name the entity. Its points are written down
//                           at every write of the dataset (`series-capture.ts`).
//
// A read returns a regular grid. Three rules hold it:
//
//   a value holds     until the next point, the way the twin showed it;
//   a gap is a gap    a stretch with no value is null, never zero, and
//                     nothing is known before the first point;
//   as known at       a read can be made "as of" an instant: only what had
//                     been written down by then is used. That is what lets a
//                     forecast of last week be replayed honestly.
//
// Nothing here is about a person: an entity of the network and an aggregate.
// ---------------------------------------------------------------------------

export const GRID_STEPS = ["hour", "day"] as const;
export type GridStep = (typeof GRID_STEPS)[number];
export const STEP_MS: Record<GridStep, number> = { hour: 3_600_000, day: 86_400_000 };

export const GRID_AGGS = ["mean", "max", "last"] as const;
export type GridAgg = (typeof GRID_AGGS)[number];

/** The most steps one read returns: 125 days hour by hour. */
export const GRID_MAX = 3000;
/** The most entities one read returns. */
export const ENTITIES_MAX = 300;
/** The prefix of a twin measure's key: `twin:occupancy`. A declared key cannot hold a colon. */
export const TWIN_PREFIX = "twin:";

export interface KeptPoint {
  /** The instant the value is about. */
  at: Date;
  value: number | null;
  /** When it was written down here. */
  seenAt: Date;
  replayed?: boolean;
}

/**
 * What was known as of an instant: one point per instant described, the last
 * one written down, oldest first. With no instant, everything that was kept.
 *
 * A source that corrects a value leaves two points for one instant. Read as of
 * a day between the two, the first is the one that was known.
 */
export function knownAsOf<P extends KeptPoint>(points: readonly P[], asOf: Date | null): P[] {
  const byAt = new Map<number, P>();
  for (const p of points) {
    if (asOf && p.seenAt.getTime() > asOf.getTime()) continue;
    const held = byAt.get(p.at.getTime());
    if (!held || p.seenAt.getTime() >= held.seenAt.getTime()) byAt.set(p.at.getTime(), p);
  }
  return [...byAt.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

const round = (v: number): number => Math.round(v * 10_000) / 10_000;

/**
 * Points on a regular grid: `buckets` steps of `stepMs` from `from`, each step
 * covering [start, start + step).
 *
 * Each value holds until the next point. Over a step:
 *   mean  the average of what was in force, weighted by how long it was;
 *   max   the highest value in force at any moment of the step;
 *   last  the value in force when the step ends.
 * A stretch with no value in force counts for nothing: a step that had none
 * at all is null, never zero.
 *
 * `points` are those known (see `knownAsOf`), oldest first, and may start
 * before `from`: the last one before it is what was in force when the grid
 * begins.
 *
 * With `holdMs`, a value stops holding that long after the instant it is
 * about, when no newer point came: a source nobody read for a month did not
 * say the same thing for a month. Without it, a value holds until the next
 * point, however far that is.
 */
export function onGrid(points: readonly KeptPoint[], from: Date, buckets: number, stepMs: number, agg: GridAgg, holdMs: number | null = null): (number | null)[] {
  const out: (number | null)[] = [];
  let next = 0;
  let inForce: KeptPoint | null = null;
  for (let b = 0; b < buckets; b++) {
    const start = from.getTime() + b * stepMs;
    const end = start + stepMs;
    while (next < points.length && points[next]!.at.getTime() <= start) inForce = points[next++]!;

    let cur: KeptPoint | null = inForce;
    let t = start;
    let weighted = 0;
    let known = 0;
    let max: number | null = null;
    const close = (until: number) => {
      // Where the value in force stops holding: at the next point, or once it has gone stale.
      const holds = cur && holdMs !== null ? Math.min(until, cur.at.getTime() + holdMs) : until;
      if (cur && cur.value !== null && holds > t) {
        weighted += cur.value * (holds - t);
        known += holds - t;
        max = max === null ? cur.value : Math.max(max, cur.value);
      }
      t = until;
    };
    while (next < points.length && points[next]!.at.getTime() < end) {
      close(points[next]!.at.getTime());
      cur = points[next++]!;
    }
    close(end);
    inForce = cur;

    const stale = cur !== null && holdMs !== null && cur.at.getTime() + holdMs < end;
    const last = cur && cur.value !== null && !stale ? cur.value : null;
    const v = agg === "last" ? last : agg === "max" ? max : known > 0 ? weighted / known : null;
    out.push(v === null ? null : round(v));
  }
  return out;
}

// --- declaring a series on a dataset ------------------------------------------------

export const seriesDraft = z.object({
  label: z.string().trim().min(1).max(120),
  datasetId: z.string().uuid(),
  timeColumn: z.string().trim().min(1).max(200),
  /** An IANA zone ("America/Toronto"), for a time column that carries none. */
  timeZone: z.string().trim().min(1).max(64).nullable().default(null),
  valueColumn: z.string().trim().min(1).max(200),
  entityColumns: z.array(z.string().trim().min(1).max(200)).max(4).default([]),
  step: z.enum(SERIES_STEPS),
  unit: z.string().trim().max(40).nullable().default(null),
});
export type SeriesDraft = z.infer<typeof seriesDraft>;

const invalid = (message: string) => BadRequest("SERIES_INVALID", message);

/**
 * A draft held against the dataset it names, or a refusal that says what to correct.
 *
 * Nothing is recognised by its name: every column has to be one the dataset's
 * own schema lists.
 */
export function checkDraft(draft: SeriesDraft, dataset: Pick<DatasetRow, "projectId" | "kind" | "name" | "columnSchema">, projectId: string): void {
  if (dataset.projectId !== projectId) throw NotFound("DATASET_NOT_FOUND", "That dataset is not in this project.");
  if (dataset.kind !== "table") throw invalid(`“${dataset.name}” is a stream. A series is kept from a table: each of its writes is a whole copy to read.`);
  const columns = new Set(dataset.columnSchema.map((c) => c.name));
  const has = (c: string, what: string) => {
    if (!columns.has(c)) throw invalid(`“${dataset.name}” has no column called “${c}” for ${what}. Its columns are: ${[...columns].join(", ") || "none yet"}.`);
  };
  has(draft.timeColumn, "the time");
  has(draft.valueColumn, "the value");
  for (const c of draft.entityColumns) has(c, "the entity");
  if (draft.timeColumn === draft.valueColumn) throw invalid("The time and the value cannot be the same column.");
  if (new Set(draft.entityColumns).size !== draft.entityColumns.length) throw invalid("An entity column is named twice.");
  if (draft.entityColumns.includes(draft.timeColumn) || draft.entityColumns.includes(draft.valueColumn)) {
    throw invalid("The time and the value cannot also name the entity.");
  }
  if (draft.timeZone && !readStamp("2026-01-01T00:00", draft.timeZone).at) {
    throw invalid(`“${draft.timeZone}” is not a time zone this server knows. Write it as a region and a city, such as America/Toronto.`);
  }
}

/** A series key from a label: `respiratory_virus_detections`. Never one already taken. */
export function seriesKeyFrom(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^[_0-9]+|_+$/g, "")
      .slice(0, 40) || "series";
  // `read` and `catchup` are routes beside the series: a series cannot answer to their name.
  const start = base.length < 3 || base === "read" || base === "catchup" ? `${base}_series` : base;
  if (!taken.has(start)) return start;
  for (let n = 2; ; n++) if (!taken.has(`${start}_${n}`)) return `${start}_${n}`;
}

async function declaredOf(db: DbClient, projectId: string): Promise<SeriesDef[]> {
  const { rows } = await db.query<SeriesDbRow>(`SELECT ${SERIES_COLUMNS} FROM app.kept_series WHERE project_id = $1 ORDER BY label, key`, [projectId]);
  return rows.map(seriesOf);
}

/** The rows of a dataset's latest copy, whole, with when that copy was taken. Null when the dataset was never written. */
async function latestCopy(db: DbClient, datasetId: string): Promise<{ versionId: string; takenAt: Date; rows: Record<string, unknown>[] } | null> {
  const v = await db.query<{ id: string; created_at: Date }>(`SELECT id, created_at FROM app.dataset_version WHERE dataset_id = $1 ORDER BY version DESC LIMIT 1`, [datasetId]);
  const version = v.rows[0];
  if (!version) return null;
  const { rows } = await db.query<{ data: Record<string, unknown> }>(`SELECT data FROM app.dataset_row WHERE version_id = $1 ORDER BY id`, [version.id]);
  return { versionId: version.id, takenAt: version.created_at, rows: rows.map((r) => r.data) };
}

/**
 * Declare a series on a dataset, and read the dataset's latest copy into it.
 *
 * The points of that copy are dated at when the copy was taken: that is when
 * the platform first held them. Older copies are a catch-up, asked for apart
 * (`series-catchup.ts`).
 */
export async function declareSeries(db: DbClient, projectId: string, userId: string, draft: SeriesDraft): Promise<{ series: SeriesDef; captured: CaptureResult | null }> {
  const dataset = await getDataset(db, draft.datasetId);
  checkDraft(draft, dataset, projectId);
  const taken = new Set((await declaredOf(db, projectId)).map((s) => s.key));
  const key = seriesKeyFrom(draft.label, taken);
  const { rows } = await db.query<SeriesDbRow>(
    `INSERT INTO app.kept_series (project_id, dataset_id, key, label, time_column, time_zone, value_column, entity_columns, step, unit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
     RETURNING ${SERIES_COLUMNS}`,
    [projectId, draft.datasetId, key, draft.label, draft.timeColumn, draft.timeZone, draft.valueColumn, JSON.stringify(draft.entityColumns), draft.step, draft.unit || null, userId],
  );
  const series = seriesOf(rows[0]!);
  const copy = await latestCopy(db, draft.datasetId);
  const captured = copy ? await captureInto(db, series, copy.rows, copy.takenAt, copy.versionId) : null;
  return { series: captured ? { ...series, lastNote: captured.note, lastWrittenAt: copy!.takenAt.toISOString() } : series, captured };
}

export async function removeSeries(db: DbClient, projectId: string, key: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.kept_series WHERE project_id = $1 AND key = $2`, [projectId, key]);
  if (!rowCount) throw NotFound("SERIES_NOT_FOUND", "That series is not declared in this project. A measure of the twin is not removed here: it is a series as long as the twin keeps it.");
  // Its points went with it; where its catch-ups stood goes too.
  await db.query(`DELETE FROM app.series_catchup WHERE project_id = $1 AND series_key = $2`, [projectId, key]);
}

// --- what is kept -------------------------------------------------------------------

interface Project {
  id: string;
  organizationId: string;
}

export interface SeriesLine {
  key: string;
  label: string;
  origin: "twin" | "dataset";
  /** Where it is read from, in words: the dataset's name, or that it is a measure of the twin. */
  from: string;
  /** The source's own step, or "change" for a twin measure: written down when it changes. */
  step: SeriesStep | "change";
  unit: string | null;
  entities: number;
  points: number;
  /** Points written down with no value: absences that were seen. */
  emptyPoints: number;
  /** Points caught up afterwards from a kept copy. */
  replayed: number;
  /** The earliest and latest instants the points are about. */
  firstAt: string | null;
  lastAt: string | null;
  /** When the first point was written down here. */
  keptSince: string | null;
  /** What the last write could not read. */
  note: string | null;
  /** How a dataset series was declared; null for a twin measure. */
  declared: Pick<SeriesDef, "datasetId" | "timeColumn" | "timeZone" | "valueColumn" | "entityColumns"> | null;
}

interface SummaryRow {
  id: string;
  points: number;
  empty: number;
  replayed: number;
  entities: number;
  first_at: Date | null;
  last_at: Date | null;
  kept_since: Date | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Every series the project keeps: the twin's measures that have readings, then the series declared on datasets. */
export async function listSeries(db: DbClient, project: Project): Promise<SeriesLine[]> {
  const [twin, metrics, declared, points, datasets] = await Promise.all([
    db.query<SummaryRow>(
      `SELECT metric AS id, count(*)::int AS points, (count(*) FILTER (WHERE value IS NULL))::int AS empty,
              (count(*) FILTER (WHERE replayed))::int AS replayed, count(DISTINCT unit_instance_id)::int AS entities,
              min(COALESCE(observed_at, recorded_at)) AS first_at, max(COALESCE(observed_at, recorded_at)) AS last_at,
              min(recorded_at) AS kept_since
         FROM app.twin_reading
        WHERE project_id = $1
        GROUP BY metric
        ORDER BY metric`,
      [project.id],
    ),
    listTwinMetrics(db, project.organizationId),
    declaredOf(db, project.id),
    db.query<SummaryRow>(
      `SELECT p.series_id AS id, count(*)::int AS points, (count(*) FILTER (WHERE p.value IS NULL))::int AS empty,
              (count(*) FILTER (WHERE p.replayed))::int AS replayed, count(DISTINCT p.entity)::int AS entities,
              min(p.at) AS first_at, max(p.at) AS last_at, min(p.seen_at) AS kept_since
         FROM app.series_point p
         JOIN app.kept_series s ON s.id = p.series_id
        WHERE s.project_id = $1
        GROUP BY p.series_id`,
      [project.id],
    ),
    listDatasets(db, project.id),
  ]);
  const metricOf = new Map(metrics.map((m) => [m.key, m]));
  const pointsOf = new Map(points.rows.map((r) => [r.id, r]));
  const datasetName = new Map(datasets.map((d) => [d.id, d.name]));
  const line = (r: SummaryRow | undefined) => ({
    entities: r?.entities ?? 0,
    points: r?.points ?? 0,
    emptyPoints: r?.empty ?? 0,
    replayed: r?.replayed ?? 0,
    firstAt: iso(r?.first_at),
    lastAt: iso(r?.last_at),
    keptSince: iso(r?.kept_since),
  });
  return [
    ...twin.rows.map(
      (r): SeriesLine => ({
        key: `${TWIN_PREFIX}${r.id}`,
        label: metricOf.get(r.id)?.label ?? r.id,
        origin: "twin",
        from: "A measure of the twin",
        step: "change",
        unit: metricOf.get(r.id)?.unit ?? null,
        ...line(r),
        note: null,
        declared: null,
      }),
    ),
    ...declared.map(
      (s): SeriesLine => ({
        key: s.key,
        label: s.label,
        origin: "dataset",
        from: datasetName.get(s.datasetId) ?? "A dataset that is no longer there",
        step: s.step,
        unit: s.unit,
        ...line(pointsOf.get(s.id)),
        note: s.lastNote,
        declared: { datasetId: s.datasetId, timeColumn: s.timeColumn, timeZone: s.timeZone, valueColumn: s.valueColumn, entityColumns: s.entityColumns },
      }),
    ),
  ];
}

/** The tables a series can be declared on, with their columns: what the form offers. */
export async function seriesOffer(db: DbClient, projectId: string): Promise<{ datasets: { id: string; name: string; columns: { name: string; type: string }[] }[] }> {
  const all = await listDatasets(db, projectId);
  return {
    datasets: all
      .filter((d) => d.kind === "table")
      .map((d) => ({ id: d.id, name: d.name, columns: d.columnSchema.map((c) => ({ name: c.name, type: c.type })) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// --- reading a series on a grid --------------------------------------------------------

export const gridRequest = z.object({
  key: z.string().trim().min(1).max(120),
  /** The entities to read: unit ids for a twin measure, entity names for a dataset series. All of them when left out. */
  entities: z.array(z.string().max(400)).max(ENTITIES_MAX).optional(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  step: z.enum(GRID_STEPS),
  agg: z.enum(GRID_AGGS).default("mean"),
  /** Read as known at this instant; null for everything that was kept. */
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
  /**
   * How long a value holds when no newer point comes, in hours; null for until the next point.
   * Past it, the steps are gaps: a source that was not read for a while did not repeat itself.
   */
  holdHours: z
    .number()
    .positive()
    .max(24 * 400)
    .nullable()
    .default(null),
});
export type GridRequest = z.infer<typeof gridRequest>;

export interface GridSeries {
  entity: string;
  label: string;
  /** One value per step of the grid; null where nothing was in force. */
  values: (number | null)[];
  /** The earliest instant this entity has a point about, in its whole history as known. */
  firstAt: string | null;
  /** Points known inside the stretch. */
  points: number;
  /** Steps with no value. */
  emptySteps: number;
  /** Points of the stretch that were caught up from a kept copy. */
  replayed: number;
}

export interface GridAnswer {
  key: string;
  label: string;
  origin: "twin" | "dataset";
  unit: string | null;
  step: GridStep;
  agg: GridAgg;
  from: string;
  to: string;
  asOf: string | null;
  /** How long a value was let hold with no newer point, in hours; null for until the next point. */
  holdHours: number | null;
  /** The start of each step. */
  grid: string[];
  series: GridSeries[];
  howToRead: string;
}

/** What is said in place of the first sentence when the read bounds how long a value holds. */
const howToReadHeld = (hours: number): string =>
  HOW_TO_READ.replace("Each value holds until the next point.", `Each value holds until the next point, and for ${hours} h at most: past that with nothing newer, the steps are gaps.`);

export const HOW_TO_READ =
  "Each value holds until the next point. A step with no value is null: a gap, not a zero. Nothing is known before an entity's first point. Read as of an instant, only what had been written down by then is used.";

const refused = (message: string) => BadRequest("SERIES_READ_REFUSED", message);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The grid a request asks for, or a refusal that says what to narrow. */
export function gridOf(req: Pick<GridRequest, "from" | "to" | "step" | "asOf">): { from: Date; to: Date; asOf: Date | null; stepMs: number; buckets: number } {
  const from = new Date(req.from);
  const to = new Date(req.to);
  const asOf = req.asOf ? new Date(req.asOf) : null;
  const stepMs = STEP_MS[req.step];
  if (!(to.getTime() > from.getTime())) throw refused("The stretch ends before it starts. Give its start, then its end.");
  if (asOf && to.getTime() > asOf.getTime()) {
    throw refused("The stretch ends after the instant it is read as of. Nothing was known then of what came after: end the stretch at that instant.");
  }
  const buckets = Math.ceil((to.getTime() - from.getTime()) / stepMs);
  if (buckets > GRID_MAX) {
    throw refused(`That is ${buckets.toLocaleString("en-CA")} steps, where one read returns ${GRID_MAX.toLocaleString("en-CA")} at most. Shorten the stretch, or read it by the day.`);
  }
  return { from, to, asOf, stepMs, buckets };
}

interface PointRow {
  entity: string;
  value: number | null;
  at: Date;
  seen_at: Date;
  replayed: boolean;
}

/** Points and openings turned into one grid line per entity. */
function linesOf(
  entities: readonly string[],
  labelOf: (entity: string) => string,
  rows: readonly PointRow[],
  openings: readonly PointRow[],
  firsts: ReadonlyMap<string, Date>,
  g: ReturnType<typeof gridOf>,
  agg: GridAgg,
  holdMs: number | null = null,
): GridSeries[] {
  const byEntity = new Map<string, (KeptPoint & { replayed: boolean })[]>();
  const add = (r: PointRow) => {
    const list = byEntity.get(r.entity) ?? [];
    list.push({ at: r.at, value: r.value === null ? null : Number(r.value), seenAt: r.seen_at, replayed: r.replayed });
    byEntity.set(r.entity, list);
  };
  for (const r of openings) add(r);
  for (const r of rows) add(r);
  return entities.map((entity) => {
    const known = knownAsOf(byEntity.get(entity) ?? [], g.asOf);
    const inside = known.filter((p) => p.at.getTime() >= g.from.getTime());
    const values = onGrid(known, g.from, g.buckets, g.stepMs, agg, holdMs);
    return {
      entity,
      label: labelOf(entity),
      values,
      firstAt: iso(firsts.get(entity)),
      points: inside.length,
      emptySteps: values.filter((v) => v === null).length,
      replayed: inside.filter((p) => p.replayed).length,
    };
  });
}

/**
 * A series on a regular grid, for every entity asked for.
 *
 * The same read serves a twin measure and a dataset series: what differs is
 * where the points are, never how a grid is made from them.
 */
export async function readGrid(db: DbClient, project: Project, req: GridRequest): Promise<GridAnswer> {
  const g = gridOf(req);
  const known = (g.asOf ?? new Date()).toISOString();
  const grid = Array.from({ length: g.buckets }, (_, b) => new Date(g.from.getTime() + b * g.stepMs).toISOString());
  const answer = (label: string, origin: "twin" | "dataset", unit: string | null, series: GridSeries[]): GridAnswer => ({
    key: req.key,
    label,
    origin,
    unit,
    step: req.step,
    agg: req.agg,
    from: g.from.toISOString(),
    to: g.to.toISOString(),
    asOf: iso(g.asOf),
    holdHours: req.holdHours ?? null,
    grid,
    series,
    howToRead: req.holdHours ? howToReadHeld(req.holdHours) : HOW_TO_READ,
  });
  const holdMs = req.holdHours ? req.holdHours * 3_600_000 : null;

  if (req.key.startsWith(TWIN_PREFIX)) {
    const metric = req.key.slice(TWIN_PREFIX.length);
    const [tree, metrics] = await Promise.all([getUnitTree(db, project.id), listTwinMetrics(db, project.organizationId)]);
    const nameOf = new Map(tree.nodes.map((n) => [n.id, n.name]));
    let entities = req.entities;
    if (!entities) {
      const all = await db.query<{ entity: string }>(`SELECT DISTINCT unit_instance_id AS entity FROM app.twin_reading WHERE project_id = $1 AND metric = $2`, [project.id, metric]);
      entities = all.rows.map((r) => r.entity);
      if (entities.length === 0) throw NotFound("SERIES_NOT_FOUND", `The twin kept no reading of “${metric}” in this project. Only the measures the organisation defined are kept.`);
      if (entities.length > ENTITIES_MAX) throw refused(`${entities.length} units carry this measure, where one read returns ${ENTITIES_MAX} at most. Name the units to read.`);
    }
    const wrong = entities.find((e) => !UUID.test(e));
    if (wrong !== undefined) throw refused(`“${wrong}” is not a unit: a twin measure is read by the identifiers of its units.`);
    const where = `project_id = $1 AND metric = $2 AND unit_instance_id = ANY($3::uuid[]) AND recorded_at <= $4`;
    const at = `COALESCE(observed_at, recorded_at)`;
    const [rows, openings, firsts] = await Promise.all([
      db.query<PointRow>(
        `SELECT unit_instance_id AS entity, value, ${at} AS at, recorded_at AS seen_at, replayed
           FROM app.twin_reading WHERE ${where} AND ${at} >= $5 AND ${at} < $6`,
        [project.id, metric, entities, known, g.from.toISOString(), g.to.toISOString()],
      ),
      db.query<PointRow>(
        `SELECT DISTINCT ON (unit_instance_id) unit_instance_id AS entity, value, ${at} AS at, recorded_at AS seen_at, replayed
           FROM app.twin_reading WHERE ${where} AND ${at} < $5
          ORDER BY unit_instance_id, ${at} DESC, recorded_at DESC`,
        [project.id, metric, entities, known, g.from.toISOString()],
      ),
      db.query<{ entity: string; first_at: Date }>(`SELECT unit_instance_id AS entity, min(${at}) AS first_at FROM app.twin_reading WHERE ${where} GROUP BY 1`, [project.id, metric, entities, known]),
    ]);
    const def = metrics.find((m) => m.key === metric);
    return answer(
      def?.label ?? metric,
      "twin",
      def?.unit ?? null,
      linesOf(entities, (e) => nameOf.get(e) ?? "A unit that is no longer in the twin", rows.rows, openings.rows, new Map(firsts.rows.map((r) => [r.entity, r.first_at])), g, req.agg, holdMs),
    );
  }

  const found = await db.query<SeriesDbRow>(`SELECT ${SERIES_COLUMNS} FROM app.kept_series WHERE project_id = $1 AND key = $2`, [project.id, req.key]);
  if (!found.rows[0]) throw NotFound("SERIES_NOT_FOUND", "That series is not kept in this project.");
  const def = seriesOf(found.rows[0]);
  let entities = req.entities;
  if (!entities) {
    const all = await db.query<{ entity: string }>(`SELECT DISTINCT entity FROM app.series_point WHERE series_id = $1 ORDER BY entity`, [def.id]);
    entities = all.rows.map((r) => r.entity);
    if (entities.length > ENTITIES_MAX) throw refused(`This series has ${entities.length} entities, where one read returns ${ENTITIES_MAX} at most. Name the entities to read.`);
  }
  const where = `series_id = $1 AND entity = ANY($2::text[]) AND seen_at <= $3`;
  const [rows, openings, firsts] = await Promise.all([
    db.query<PointRow>(`SELECT entity, value, at, seen_at, replayed FROM app.series_point WHERE ${where} AND at >= $4 AND at < $5`, [def.id, entities, known, g.from.toISOString(), g.to.toISOString()]),
    db.query<PointRow>(
      `SELECT DISTINCT ON (entity) entity, value, at, seen_at, replayed
         FROM app.series_point WHERE ${where} AND at < $4
        ORDER BY entity, at DESC, seen_at DESC, id DESC`,
      [def.id, entities, known, g.from.toISOString()],
    ),
    db.query<{ entity: string; first_at: Date }>(`SELECT entity, min(at) AS first_at FROM app.series_point WHERE ${where} GROUP BY 1`, [def.id, entities, known]),
  ]);
  return answer(
    def.label,
    "dataset",
    def.unit,
    linesOf(entities, (e) => (e === WHOLE ? def.label : e), rows.rows, openings.rows, new Map(firsts.rows.map((r) => [r.entity, r.first_at])), g, req.agg, holdMs),
  );
}
