import type { DbClient } from "../lib/db.js";
import { readStamp } from "./observed-at.js";

// ---------------------------------------------------------------------------
// Keeping the points of a series read from a dataset.
//
// Every sync keeps a whole copy of its file. That is a history of files, not
// of values: nothing in it is filed by entity and by instant, and a file
// re-read unchanged is kept twice. A declared series says which column is the
// time, which is the value and which name the entity; this file turns the rows
// of one copy into points and writes down the ones that changed.
//
// It runs inside every write of a dataset, so it must never cost that write
// its result: what cannot be read is counted and said on the series, and a
// failure here is written there too rather than thrown.
//
// Kept apart from `series.ts` so that `datasets.ts` can call it without the
// two files importing each other.
// ---------------------------------------------------------------------------

export const SERIES_STEPS = ["hour", "day", "week"] as const;
export type SeriesStep = (typeof SERIES_STEPS)[number];

export interface SeriesDef {
  id: string;
  projectId: string;
  datasetId: string;
  key: string;
  label: string;
  timeColumn: string;
  /** The clock of a time that carries none; null when the column says its own. */
  timeZone: string | null;
  valueColumn: string;
  entityColumns: string[];
  step: SeriesStep;
  unit: string | null;
  /** What the last write could not read; null when it read everything. */
  lastNote: string | null;
  lastWrittenAt: string | null;
}

export interface SeriesDbRow {
  id: string;
  project_id: string;
  dataset_id: string;
  key: string;
  label: string;
  time_column: string;
  time_zone: string | null;
  value_column: string;
  entity_columns: string[] | null;
  step: SeriesStep;
  unit: string | null;
  last_note: string | null;
  last_written_at: Date | null;
}

export const SERIES_COLUMNS = `id, project_id, dataset_id, key, label, time_column, time_zone, value_column, entity_columns, step, unit, last_note, last_written_at`;

export function seriesOf(r: SeriesDbRow): SeriesDef {
  return {
    id: r.id,
    projectId: r.project_id,
    datasetId: r.dataset_id,
    key: r.key,
    label: r.label,
    timeColumn: r.time_column,
    timeZone: r.time_zone,
    valueColumn: r.value_column,
    entityColumns: r.entity_columns ?? [],
    step: r.step,
    unit: r.unit,
    lastNote: r.last_note,
    lastWrittenAt: r.last_written_at ? r.last_written_at.toISOString() : null,
  };
}

/** What joins the values that name an entity. Readable, and unlikely inside a name. */
export const ENTITY_JOIN = " | ";
/** The entity of a series that declares no entity column: there is one, and it has no name. */
export const WHOLE = "";

/** A cell as a number, or null when it is not one. "pas d'information disponible" is an absence, not a zero. */
export function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  // A decimal comma, as a French file writes it. A thousands separator is left unread rather than guessed.
  const n = Number(/^-?\d+,\d+$/.test(s) ? s.replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

/** What a row is about, from the columns the series names. */
export function entityOf(row: Record<string, unknown>, columns: readonly string[]): string {
  if (columns.length === 0) return WHOLE;
  return columns
    .map((c) => {
      const v = row[c];
      const s = v === null || v === undefined ? "" : String(v).trim();
      return s === "" ? "(not said)" : s;
    })
    .join(ENTITY_JOIN);
}

export interface Candidate {
  entity: string;
  at: Date;
  value: number | null;
}

export interface Extracted {
  points: Candidate[];
  /** Rows read. */
  rows: number;
  /** Rows whose time could not be read at all. */
  unreadableTime: number;
  /** Rows whose time names a wall clock, when the series does not say which. */
  zoneUnknown: number;
  /** Rows that share an entity and a time with another row and disagree on the value. */
  ambiguous: number;
  /** Points whose value is not a number: kept, as an absence. */
  empty: number;
}

/**
 * The points one copy of a dataset holds, for one series.
 *
 * Two rows that name the same entity at the same time and give different
 * values are not a point: a column that tells them apart is missing from the
 * declaration. They are left out and counted, never averaged or picked from.
 */
export function extractPoints(rows: readonly Record<string, unknown>[], def: Pick<SeriesDef, "timeColumn" | "timeZone" | "valueColumn" | "entityColumns">): Extracted {
  const out: Extracted = { points: [], rows: rows.length, unreadableTime: 0, zoneUnknown: 0, ambiguous: 0, empty: 0 };
  const seen = new Map<string, { point: Candidate; rows: number; clash: boolean }>();
  for (const row of rows) {
    const stamp = readStamp(row[def.timeColumn], def.timeZone);
    if (!stamp.at) {
      if (stamp.basis === "zone-unknown") out.zoneUnknown += 1;
      else out.unreadableTime += 1;
      continue;
    }
    const point: Candidate = { entity: entityOf(row, def.entityColumns), at: stamp.at, value: numberOf(row[def.valueColumn]) };
    const id = `${point.entity}\u0000${point.at.getTime()}`;
    const held = seen.get(id);
    if (!held) seen.set(id, { point, rows: 1, clash: false });
    else {
      held.rows += 1;
      if (held.point.value !== point.value) held.clash = true;
    }
  }
  for (const held of seen.values()) {
    if (held.clash) {
      out.ambiguous += held.rows;
      continue;
    }
    if (held.point.value === null) out.empty += 1;
    out.points.push(held.point);
  }
  return out;
}

const rowsText = (n: number): string => `${n.toLocaleString("en-CA")} row${n === 1 ? "" : "s"}`;

/** What a write could not read, in sentences a person can act on. Null when it read everything. */
export function noteOf(x: Extracted): string | null {
  const said: string[] = [];
  if (x.zoneUnknown > 0) {
    said.push(
      x.zoneUnknown === x.rows
        ? `The times carry no time zone and the series declares none: none of the ${rowsText(x.rows)} could be placed. Say which clock the file is written on.`
        : `${rowsText(x.zoneUnknown)} carry a time with no time zone, and the series declares none.`,
    );
  }
  if (x.unreadableTime > 0) said.push(`${rowsText(x.unreadableTime)} ${x.unreadableTime === 1 ? "has" : "have"} a time that cannot be read.`);
  if (x.ambiguous > 0) {
    said.push(`${rowsText(x.ambiguous)} share an entity and a time and give different values: a column that tells them apart is missing from the series. They were left out.`);
  }
  return said.length ? said.join(" ") : null;
}

/** How many candidates one statement compares and writes. */
const WRITE_CHUNK = 5000;

/**
 * Write down the points that changed, as of `seenAt`. Returns how many were written.
 *
 * A candidate becomes a point when nothing was noted yet for its entity at its
 * instant, or when the last value noted for it (as of `seenAt`) differs. A
 * value corrected by its source therefore keeps both, each with when it was
 * read; a value re-read unchanged keeps one.
 */
export async function writePoints(
  db: DbClient,
  seriesId: string,
  points: readonly Candidate[],
  seenAt: Date,
  versionId: string | null,
  replayed: boolean,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < points.length; i += WRITE_CHUNK) {
    const chunk = points.slice(i, i + WRITE_CHUNK);
    const { rows } = await db.query<{ n: number }>(
      `WITH written AS (
         INSERT INTO app.series_point (series_id, entity, at, value, seen_at, version_id, replayed)
         SELECT $1, c.entity, c.at, c.value, $5, $6, $7
           FROM unnest($2::text[], $3::timestamptz[], $4::double precision[]) AS c(entity, at, value)
           LEFT JOIN LATERAL (
                 SELECT true AS kept, p.value
                   FROM app.series_point p
                  WHERE p.series_id = $1 AND p.entity = c.entity AND p.at = c.at AND p.seen_at <= $5
                  ORDER BY p.seen_at DESC, p.id DESC
                  LIMIT 1) last ON true
          WHERE last.kept IS NULL OR last.value IS DISTINCT FROM c.value
         RETURNING 1
       )
       SELECT count(*)::int AS n FROM written`,
      [
        seriesId,
        chunk.map((p) => p.entity),
        // As text: an array of timestamps is sent the same way by every driver.
        chunk.map((p) => p.at.toISOString()),
        chunk.map((p) => p.value),
        seenAt.toISOString(),
        versionId,
        replayed,
      ],
    );
    written += rows[0]?.n ?? 0;
  }
  return written;
}

export interface CaptureResult {
  key: string;
  written: number;
  note: string | null;
}

/** One copy read into one series, and what could not be read said on the series. */
export async function captureInto(
  db: DbClient,
  def: SeriesDef,
  rows: readonly Record<string, unknown>[],
  seenAt: Date,
  versionId: string | null,
  replayed = false,
): Promise<CaptureResult> {
  const extracted = extractPoints(rows, def);
  const written = await writePoints(db, def.id, extracted.points, seenAt, versionId, replayed);
  const note = noteOf(extracted);
  // A replay reads old copies: what one of them lacked says nothing of the series as it is written today.
  if (!replayed) {
    await db.query(`UPDATE app.kept_series SET last_note = $2, last_written_at = $3, updated_at = NOW() WHERE id = $1`, [def.id, note, seenAt.toISOString()]);
  }
  return { key: def.key, written, note };
}

/**
 * Every series declared on a dataset, fed from the copy that was just written.
 *
 * Never throws: a dataset's write has already happened, and a series that
 * could not follow says so on its own line instead of failing the sync.
 */
export async function captureForDataset(
  db: DbClient,
  datasetId: string,
  versionId: string,
  rows: readonly Record<string, unknown>[],
  seenAt: Date = new Date(),
): Promise<CaptureResult[]> {
  let defs: SeriesDef[];
  try {
    const found = await db.query<SeriesDbRow>(`SELECT ${SERIES_COLUMNS} FROM app.kept_series WHERE dataset_id = $1 ORDER BY key`, [datasetId]);
    defs = found.rows.map(seriesOf);
  } catch {
    // The table is not there yet on a database that has not been migrated: nothing is declared, nothing is kept.
    return [];
  }
  const out: CaptureResult[] = [];
  for (const def of defs) {
    try {
      out.push(await captureInto(db, def, rows, seenAt, versionId));
    } catch (err) {
      const note = `The last write of the dataset could not be read into this series: ${(err as Error).message}`;
      await db.query(`UPDATE app.kept_series SET last_note = $2, updated_at = NOW() WHERE id = $1`, [def.id, note]).catch(() => undefined);
      out.push({ key: def.key, written: 0, note });
    }
  }
  return out;
}
