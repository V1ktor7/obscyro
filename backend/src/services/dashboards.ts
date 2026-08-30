import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { getDataset, previewRows } from "./datasets.js";
import {
  offersFor,
  readColumns,
  whyNoChart,
  type CardKind,
  type ChartOffer,
  type ColumnFit,
} from "./chartable.js";

/**
 * Dashboards, and the values that fill them.
 *
 * A card holds no data. It names a dataset and says how to draw it, and the
 * numbers are read at the moment somebody opens the page — so an hourly sync
 * lands on the dashboard without anyone touching the card. Storing the values
 * would give a board that ages in silence, still showing the state of the
 * network at the moment somebody clicked, with the same confidence as if it
 * were current.
 *
 * The arithmetic runs in SQL rather than over rows pulled into node, because a
 * dashboard is opened often and a table holds three hundred thousand rows. The
 * one thing that needs care there is the cast: `data->>'col'` is text, and one
 * cell reading "pas d'information disponible" — which is what the emergency
 * file writes when a hospital does not report — would abort the whole query
 * with an invalid input syntax error. So every numeric read is guarded by a
 * shape test and yields NULL instead of failing, and the aggregates skip it.
 * A chart missing four of sixteen hospitals is a chart; a chart that 500s is
 * not.
 */

/**
 * Note the absence of "last". A number card carries no time column, so the most
 * recent value cannot be identified from a card's config — only the largest can,
 * and an aggregate labelled "derniere valeur" that quietly returns the maximum
 * is worse than one that is missing.
 */
export type Aggregate = "sum" | "avg" | "max" | "min" | "count";

const AGGREGATES: readonly Aggregate[] = ["sum", "avg", "max", "min", "count"];
const KINDS: readonly CardKind[] = ["line", "bar", "number", "table"];

/** Past this a line is drawing more points than the card has pixels. */
const MAX_POINTS = 500;
/** Past this a bar chart is a wall of ticks. Matches the picker's own cap. */
const MAX_BARS = 30;
/** A table card is a glance, not an export. */
const MAX_TABLE_ROWS = 100;

export interface DashboardRow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardConfig {
  x?: string | null;
  y?: string | null;
  agg?: Aggregate;
  limit?: number;
}

export interface CardRow {
  id: string;
  dashboardId: string;
  position: number;
  title: string;
  kind: CardKind;
  sourceKind: "dataset" | "twin" | "ontology";
  sourceId: string;
  config: CardConfig;
}

export interface CardData {
  /** [{ label, value }] for line and bar; one entry for number. */
  points: Array<{ label: string; value: number }>;
  /** Rows as they are, for a table card. */
  rows: Record<string, unknown>[];
  columns: string[];
  /** How many rows the card read. Shown so a thin chart is legible as thin. */
  rowsRead: number;
  /** Rows whose measure was absent or unreadable. Named, never hidden. */
  rowsSkipped: number;
  /**
   * Categories the chart could not fit, for a bar card.
   *
   * A bar chart of the thirty largest out of a hundred and twenty is a useful
   * chart and a dishonest one unless it admits the ninety. The card reads
   * "30 barres sur 120" rather than "30 catégories", which somebody would
   * otherwise take for the size of the network.
   */
  categoriesHidden: number;
  /**
   * For a line: one point in this many was kept.
   *
   * A three-year daily series has more days than a card has pixels. Taking the
   * first five hundred would show 2020 to mid-2021 and cut the recent half off
   * without a word — the worst half to lose on a dashboard. Sampling evenly
   * keeps the whole window and the shape of the curve, and this number says so.
   * 1 means nothing was dropped.
   */
  sampledEvery: number;
  /** Set when the source is gone or the columns no longer exist. */
  error: string | null;
}

export interface CardWithData extends CardRow {
  sourceName: string;
  data: CardData;
}

// ---------------------------------------------------------------------------
// Dashboards

interface DashRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  card_count: string;
  created_at: Date;
  updated_at: Date;
}

function toDashboard(r: DashRow): DashboardRow {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    cardCount: Number(r.card_count),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const DASH_SELECT = `
  SELECT d.id, d.project_id, d.name, d.description, d.created_at, d.updated_at,
         (SELECT count(*) FROM app.dashboard_card c WHERE c.dashboard_id = d.id) AS card_count
    FROM app.dashboard d`;

export async function listDashboards(db: DbClient, projectId: string): Promise<DashboardRow[]> {
  const { rows } = await db.query<DashRow>(
    `${DASH_SELECT} WHERE d.project_id = $1 ORDER BY d.updated_at DESC`,
    [projectId],
  );
  return rows.map(toDashboard);
}

export async function getDashboard(db: DbClient, id: string): Promise<DashboardRow> {
  const { rows } = await db.query<DashRow>(`${DASH_SELECT} WHERE d.id = $1`, [id]);
  if (!rows[0]) throw NotFound("DASHBOARD_NOT_FOUND", "Tableau de bord introuvable.");
  return toDashboard(rows[0]);
}

export async function createDashboard(
  db: DbClient,
  projectId: string,
  name: string,
  description: string,
  userId: string | null,
): Promise<DashboardRow> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw BadRequest("DASHBOARD_NAME_REQUIRED", "Un tableau de bord a besoin d'un nom.");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.dashboard (project_id, name, description, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, lower(name)) DO NOTHING
     RETURNING id`,
    [projectId, trimmed, description ?? "", userId],
  );
  if (!rows[0]) throw Conflict("DASHBOARD_NAME_TAKEN", `Un tableau de bord nomme « ${trimmed} » existe deja.`);
  return getDashboard(db, rows[0].id);
}

export async function renameDashboard(
  db: DbClient,
  id: string,
  name: string,
  description: string,
): Promise<DashboardRow> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw BadRequest("DASHBOARD_NAME_REQUIRED", "Un tableau de bord a besoin d'un nom.");
  const { rowCount } = await db.query(
    `UPDATE app.dashboard SET name = $2, description = $3, updated_at = now() WHERE id = $1`,
    [id, trimmed, description ?? ""],
  );
  if (!rowCount) throw NotFound("DASHBOARD_NOT_FOUND", "Tableau de bord introuvable.");
  return getDashboard(db, id);
}

export async function deleteDashboard(db: DbClient, id: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.dashboard WHERE id = $1`, [id]);
  if (!rowCount) throw NotFound("DASHBOARD_NOT_FOUND", "Tableau de bord introuvable.");
}

// ---------------------------------------------------------------------------
// Cards

interface RawCard {
  id: string;
  dashboard_id: string;
  position: number;
  title: string;
  kind: CardKind;
  source_kind: "dataset" | "twin" | "ontology";
  source_id: string;
  config: CardConfig;
}

function toCard(r: RawCard): CardRow {
  return {
    id: r.id,
    dashboardId: r.dashboard_id,
    position: r.position,
    title: r.title,
    kind: r.kind,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    config: r.config ?? {},
  };
}

export async function listCards(db: DbClient, dashboardId: string): Promise<CardRow[]> {
  const { rows } = await db.query<RawCard>(
    `SELECT id, dashboard_id, position, title, kind, source_kind, source_id, config
       FROM app.dashboard_card WHERE dashboard_id = $1
      ORDER BY position ASC, created_at ASC`,
    [dashboardId],
  );
  return rows.map(toCard);
}

export interface CardInput {
  title: string;
  kind: string;
  sourceKind: string;
  sourceId: string;
  config: CardConfig;
}

/**
 * Refuse a card that could not draw anything, and say what is missing.
 *
 * Separated from the insert so it can be tested without a database. Every one
 * of these would otherwise be stored happily and render as a blank rectangle,
 * which reads as "no data" rather than "not configured".
 */
export function validateCard(input: CardInput): { kind: CardKind; title: string; config: CardConfig } {
  const kind = input.kind as CardKind;
  if (!KINDS.includes(kind)) throw BadRequest("UNKNOWN_CARD_KIND", `Type de carte inconnu : ${input.kind}`);
  if (input.sourceKind !== "dataset") {
    // Only one source is wired. Accepting the others would store a card that
    // renders an error forever, which reads as broken rather than as unbuilt.
    throw BadRequest("UNSUPPORTED_CARD_SOURCE", "Seuls les jeux de donnees peuvent alimenter une carte pour l'instant.");
  }
  const title = (input.title ?? "").trim();
  if (!title) throw BadRequest("CARD_TITLE_REQUIRED", "Une carte a besoin d'un titre.");

  const cfg = input.config ?? {};
  if (cfg.agg && !AGGREGATES.includes(cfg.agg)) {
    throw BadRequest("UNKNOWN_AGGREGATE", `Agregation inconnue : ${cfg.agg}`);
  }
  if ((kind === "line" || kind === "bar") && (!cfg.x || !cfg.y)) {
    throw BadRequest("CARD_AXES_REQUIRED", "Une courbe ou des barres ont besoin d'un axe et d'une mesure.");
  }
  if (kind === "number" && !cfg.y) throw BadRequest("CARD_MEASURE_REQUIRED", "Un chiffre a besoin d'une mesure.");
  return { kind, title, config: cfg };
}

export async function addCard(
  db: DbClient,
  dashboardId: string,
  input: CardInput,
): Promise<CardRow> {
  const { kind, title, config } = validateCard(input);
  await getDataset(db, input.sourceId); // 404s here rather than at render time

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.dashboard_card (dashboard_id, position, title, kind, source_kind, source_id, config)
     VALUES ($1,
             COALESCE((SELECT max(position) + 1 FROM app.dashboard_card WHERE dashboard_id = $1), 0),
             $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [dashboardId, title, kind, input.sourceKind, input.sourceId, JSON.stringify(config)],
  );
  await db.query(`UPDATE app.dashboard SET updated_at = now() WHERE id = $1`, [dashboardId]);
  const card = (await listCards(db, dashboardId)).find((c) => c.id === rows[0]!.id);
  if (!card) throw NotFound("CARD_NOT_FOUND", "Carte introuvable.");
  return card;
}

export async function deleteCard(db: DbClient, cardId: string): Promise<void> {
  const { rowCount } = await db.query(`DELETE FROM app.dashboard_card WHERE id = $1`, [cardId]);
  if (!rowCount) throw NotFound("CARD_NOT_FOUND", "Carte introuvable.");
}

export async function moveCard(db: DbClient, cardId: string, position: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE app.dashboard_card SET position = $2, updated_at = now() WHERE id = $1`,
    [cardId, Math.max(0, Math.trunc(position))],
  );
  if (!rowCount) throw NotFound("CARD_NOT_FOUND", "Carte introuvable.");
}

// ---------------------------------------------------------------------------
// Reading the values

/**
 * The rows of a dataset's current state, as a CTE.
 *
 * A table means its latest version; a stream means what has arrived. This is
 * the same rule `previewRows` applies, restated in SQL because the aggregate
 * has to run in the database — pulling three hundred thousand rows into node to
 * sum one column would make opening a dashboard slower than building it.
 */
export function rowsCte(kind: string): string {
  if (kind === "stream") {
    return `WITH src AS (SELECT data FROM app.dataset_row WHERE dataset_id = $1)`;
  }
  return `WITH src AS (
            SELECT r.data
              FROM app.dataset_row r
              JOIN app.dataset_version v ON v.id = r.version_id
             WHERE r.dataset_id = $1
               AND v.version = (SELECT MAX(version) FROM app.dataset_version WHERE dataset_id = $1))`;
}

/**
 * A numeric read that yields NULL instead of aborting the query.
 *
 * `(data->>'col')::numeric` raises on the first cell that is not a number, and
 * the emergency file writes "pas d'information disponible" in four rows of
 * sixteen. One such cell would take down the whole card.
 */
export function num(col: string): string {
  return `CASE WHEN (data->>${col}) ~ '^[[:space:]]*-?[0-9]+([.][0-9]+)?[[:space:]]*$'
               THEN (data->>${col})::numeric END`;
}

export function aggExpr(agg: Aggregate, valueSql: string): string {
  switch (agg) {
    case "avg":
      return `avg(${valueSql})`;
    case "max":
      return `max(${valueSql})`;
    case "min":
      return `min(${valueSql})`;
    case "count":
      return `count(${valueSql})`;
    default:
      return `sum(${valueSql})`;
  }
}

export async function readCard(db: DbClient, card: CardRow): Promise<CardData> {
  const empty: CardData = {
    points: [],
    rows: [],
    columns: [],
    rowsRead: 0,
    rowsSkipped: 0,
    categoriesHidden: 0,
    sampledEvery: 1,
    error: null,
  };

  let ds: Awaited<ReturnType<typeof getDataset>>;
  try {
    ds = await getDataset(db, card.sourceId);
  } catch {
    return { ...empty, error: "Le jeu de donnees de cette carte n'existe plus." };
  }

  const schema = (ds.columnSchema ?? []) as Array<{ name: string }>;
  const declared = new Set(schema.map((c) => c.name));
  const cfg = card.config ?? {};
  const missing = [cfg.x, cfg.y].filter(
    (c): c is string => !!c && declared.size > 0 && !declared.has(c),
  );
  if (missing.length) {
    // The pipeline was edited and a column went. Naming it is the difference
    // between a fixable card and a blank rectangle.
    return { ...empty, error: `Colonne absente du jeu de donnees : ${missing.join(", ")}` };
  }

  const cte = rowsCte(ds.kind);
  const agg = cfg.agg ?? "sum";

  if (card.kind === "table") {
    const rows = await previewRows(db, card.sourceId, Math.min(cfg.limit ?? 20, MAX_TABLE_ROWS));
    return { ...empty, rows, columns: schema.map((c) => c.name), rowsRead: rows.length };
  }

  if (card.kind === "number") {
    const { rows } = await db.query<{ v: string | null; n: string; miss: string }>(
      `${cte}
       SELECT ${aggExpr(agg, num("$2"))} AS v,
              count(*) AS n,
              count(*) FILTER (WHERE ${num("$2")} IS NULL) AS miss
         FROM src`,
      [card.sourceId, cfg.y],
    );
    const r = rows[0];
    return {
      ...empty,
      points: r?.v == null ? [] : [{ label: cfg.y ?? "", value: Number(r.v) }],
      rowsRead: Number(r?.n ?? 0),
      rowsSkipped: Number(r?.miss ?? 0),
    };
  }

  const isLine = card.kind === "line";

  // A bar chart keeps the largest and says how many it left out; a category has
  // no order, so the tallest are the ones worth drawing.
  //
  // A line cannot do that. Its axis has an order, and taking the first five
  // hundred days of a three-year series would end the curve in mid-2021 with
  // nothing on the card to say the rest exists. So it samples evenly instead:
  // every nth point across the whole window, which keeps both ends and the
  // shape between them.
  const rowsQuery = isLine
    ? `${cte},
       grouped AS (
         SELECT (data->>$2) AS label, ${aggExpr(agg, num("$3"))} AS value
           FROM src
          WHERE (data->>$2) IS NOT NULL AND (data->>$2) <> ''
          GROUP BY 1
       ),
       step AS (
         SELECT GREATEST(1, ceil(count(*)::numeric / ${MAX_POINTS})::int) AS every
           FROM grouped
       ),
       ranked AS (
         SELECT label, value, row_number() OVER (ORDER BY label ASC) AS rn FROM grouped
       )
       SELECT label, value, step.every AS every
         FROM ranked, step
        WHERE ranked.rn % step.every = 1 OR step.every = 1
        ORDER BY label ASC`
    : `${cte}
       SELECT (data->>$2) AS label, ${aggExpr(agg, num("$3"))} AS value, 1 AS every
         FROM src
        WHERE (data->>$2) IS NOT NULL AND (data->>$2) <> ''
        GROUP BY 1
        ORDER BY value DESC NULLS LAST
        LIMIT ${MAX_BARS}`;

  const { rows } = await db.query<{ label: string; value: string | null; every: number }>(
    rowsQuery,
    [card.sourceId, cfg.x, cfg.y],
  );

  // Counted rather than inferred from the page: `rows.length === cap` says the
  // chart is full, not how much it left out.
  const { rows: counts } = await db.query<{ n: string; miss: string; cats: string }>(
    `${cte}
     SELECT count(*) AS n,
            count(*) FILTER (WHERE ${num("$2")} IS NULL) AS miss,
            count(DISTINCT (data->>$3)) FILTER (
              WHERE (data->>$3) IS NOT NULL AND (data->>$3) <> ''
            ) AS cats
       FROM src`,
    [card.sourceId, cfg.y, cfg.x],
  );

  const points = rows
    .filter((r) => r.value !== null)
    .map((r) => ({ label: r.label, value: Number(r.value) }));

  return {
    ...empty,
    points,
    rowsRead: Number(counts[0]?.n ?? 0),
    rowsSkipped: Number(counts[0]?.miss ?? 0),
    categoriesHidden: isLine ? 0 : Math.max(0, Number(counts[0]?.cats ?? 0) - points.length),
    sampledEvery: isLine ? Number(rows[0]?.every ?? 1) : 1,
  };
}

export async function readDashboard(db: DbClient, dashboardId: string): Promise<CardWithData[]> {
  const cards = await listCards(db, dashboardId);
  const out: CardWithData[] = [];
  for (const card of cards) {
    let sourceName = card.sourceId;
    try {
      sourceName = (await getDataset(db, card.sourceId)).name;
    } catch {
      sourceName = "(jeu de donnees supprime)";
    }
    out.push({ ...card, sourceName, data: await readCard(db, card) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a dataset can be drawn as

export interface DatasetOffers {
  datasetId: string;
  name: string;
  rowCount: number;
  columns: ColumnFit[];
  offers: ChartOffer[];
  /** Why nothing but a table was offered, when that is the case. */
  blocked: string | null;
}

/**
 * What this dataset supports, read from its values.
 *
 * This is what the picker shows before a card exists: the chart types the data
 * can actually carry, each with the columns pre-filled and a sentence saying
 * why. Offering twelve types and letting somebody find out that ten of them
 * draw nonsense is the thing this replaces.
 */
export async function offersForDataset(db: DbClient, datasetId: string): Promise<DatasetOffers> {
  const ds = await getDataset(db, datasetId);
  const sample = await previewRows(db, datasetId, 200);
  const fits = readColumns(ds.columnSchema ?? [], sample);
  return {
    datasetId,
    name: ds.name,
    rowCount: ds.rowCount ?? 0,
    columns: fits,
    offers: offersFor(fits),
    blocked: whyNoChart(fits),
  };
}
