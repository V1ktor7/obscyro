import type { DbClient } from "../lib/db.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { getDataset, previewRows } from "./datasets.js";
import {
  offersFor,
  readColumns,
  whyNoChart,
  type CardKind as ChartKind,
  type ChartOffer,
  type ColumnFit,
} from "./chartable.js";
import {
  assertMeasure,
  crossReference,
  getRun,
  liveIdsFor,
  observedByDate,
  placeSites,
  predictedOnBranch,
  seriesFromTrajectories,
  siteValueFromUnits,
  valuesAtStep,
  dayToDate,
  type BandPoint,
  type MapSite,
  type MapState,
  type TrajectoryMeasure,
} from "./dashboard-twin.js";
import { getModel, runForecast } from "./lab-models.js";
import { getTwinNetwork } from "./twin.js";

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

/**
 * What a card can be drawn as.
 *
 * The first four read a table. The last three read the rest of the platform —
 * the geolocated twin, a stored simulation run, a model from the lab — and are
 * kept in the same list because a board mixes them freely: an occupancy map
 * beside the curve that predicts it is the whole point.
 */
export type CardKind = ChartKind | "map" | "series" | "compare";
export type SourceKind = "dataset" | "twin" | "ontology" | "simulation" | "model";

const AGGREGATES: readonly Aggregate[] = ["sum", "avg", "max", "min", "count"];
const KINDS: readonly CardKind[] = ["line", "bar", "number", "table", "map", "series", "compare"];

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

  // --- map ---------------------------------------------------------------
  /** The twin metric each site is coloured by. */
  metric?: string;
  /** Now, a step of a run, or the prediction written onto a branch. */
  state?: MapState;
  /** Which run, when the state is `run`. */
  runId?: string;
  /** Which day of it. */
  step?: number;
  /** Which branch, when the state is `scenario`. */
  scenarioId?: string;

  // --- series / compare --------------------------------------------------
  /** Which trajectory of a run. */
  measure?: TrajectoryMeasure;
  /** The observed series a prediction is checked against. */
  datasetId?: string;
  /** How far a model is asked to project. */
  steps?: number;
}

export interface CardRow {
  id: string;
  dashboardId: string;
  position: number;
  title: string;
  kind: CardKind;
  sourceKind: SourceKind;
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

  /** Map cards: the sites, placed. Empty for every other kind. */
  sites: MapSite[];
  /**
   * Sites the source said nothing about.
   *
   * A run's alert timeline holds breaches, not a reading per unit per day, so a
   * map frozen at a step legitimately knows nothing about most sites. Drawing
   * those as zero would invent calm; this counts them and the card says so.
   */
  sitesUnread: number;
  /** Sites with no coordinates, which cannot be drawn at all. */
  sitesUnplaced: number;

  /** Series cards: the p5–p95 envelope the median came out of. */
  band: BandPoint[];

  /** Compare cards: the two series, and how far apart they are where both exist. */
  predicted: Array<{ label: string; value: number }>;
  real: Array<{ label: string; value: number }>;
  overlap: number;
  meanGap: number | null;
  worstGap: { label: string; predicted: number; observed: number } | null;

  /** A sentence the card prints as-is: provenance, coverage, or a caveat. */
  note: string | null;

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
  source_kind: SourceKind;
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
export function validateCard(input: CardInput): {
  kind: CardKind;
  sourceKind: SourceKind;
  title: string;
  config: CardConfig;
} {
  const kind = input.kind as CardKind;
  if (!KINDS.includes(kind)) throw BadRequest("UNKNOWN_CARD_KIND", `Type de carte inconnu : ${input.kind}`);

  const sourceKind = input.sourceKind as SourceKind;
  // Each kind reads exactly one sort of source. A `map` over a dataset would
  // store happily and render an error forever, which reads as broken rather
  // than as misconfigured.
  const EXPECTED: Record<CardKind, SourceKind[]> = {
    line: ["dataset"],
    bar: ["dataset"],
    number: ["dataset"],
    table: ["dataset"],
    map: ["twin"],
    series: ["simulation"],
    compare: ["model", "simulation"],
  };
  if (!EXPECTED[kind].includes(sourceKind)) {
    throw BadRequest(
      "UNSUPPORTED_CARD_SOURCE",
      `Une carte « ${kind} » se lit depuis ${EXPECTED[kind].join(" ou ")}, pas depuis ${input.sourceKind}.`,
    );
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

  if (kind === "map") {
    if (!cfg.metric) {
      throw BadRequest("CARD_METRIC_REQUIRED", "Une carte a besoin d'une metrique a colorer.");
    }
    const state: MapState = cfg.state ?? "live";
    if (state === "run" && (!cfg.runId || cfg.step == null)) {
      // A run without a step is not "a given time"; it is the whole run, and
      // the card would silently pick one.
      throw BadRequest("CARD_STEP_REQUIRED", "Une carte figee a besoin d'une execution et d'un jour.");
    }
    if (state === "scenario" && !cfg.scenarioId) {
      throw BadRequest("CARD_SCENARIO_REQUIRED", "Une carte de prevision a besoin d'une branche.");
    }
  }
  if (kind === "series") assertMeasure(cfg.measure);
  if (kind === "compare") {
    if (sourceKind === "simulation") {
      assertMeasure(cfg.measure);
      if (!cfg.datasetId || !cfg.x || !cfg.y) {
        throw BadRequest(
          "CARD_REAL_SERIES_REQUIRED",
          "Comparer demande une serie observee : un jeu de donnees, sa colonne de temps et sa mesure.",
        );
      }
    }
  }
  return { kind, sourceKind, title, config: cfg };
}

export async function addCard(
  db: DbClient,
  dashboardId: string,
  input: CardInput,
): Promise<CardRow> {
  const { kind, sourceKind, title, config } = validateCard(input);
  // Fail here rather than at render time: a card naming a deleted dataset or a
  // run from another project should never be storable in the first place.
  const board = await getDashboard(db, dashboardId);
  if (sourceKind === "dataset") await getDataset(db, input.sourceId);
  if (sourceKind === "model") await getModel(db, input.sourceId);
  if (sourceKind === "simulation" && !(await getRun(db, board.projectId, input.sourceId))) {
    throw NotFound("RUN_NOT_FOUND", "Cette execution n'existe pas dans ce projet.");
  }
  if (config.runId && !(await getRun(db, board.projectId, config.runId))) {
    throw NotFound("RUN_NOT_FOUND", "Cette execution n'existe pas dans ce projet.");
  }

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

const EMPTY: CardData = {
  points: [],
  rows: [],
  columns: [],
  rowsRead: 0,
  rowsSkipped: 0,
  categoriesHidden: 0,
  sampledEvery: 1,
  sites: [],
  sitesUnread: 0,
  sitesUnplaced: 0,
  band: [],
  predicted: [],
  real: [],
  overlap: 0,
  meanGap: null,
  worstGap: null,
  note: null,
  error: null,
};

/**
 * The twin on a map, at one of three moments.
 *
 * `live` is the metric as it stands. `run` is one day of a stored run, and
 * `scenario` is what a model wrote onto a branch. The geography is always the
 * live network — a run happens on a copy, and the copy has no coordinates — so
 * every number is joined back through the instance it was cloned from.
 */
/**
 * State shared by the cards of one read.
 *
 * The network roll-up walks every instance and link in the project, and three
 * map cards on one board asked for it three times. It cannot be cached beyond
 * the read — the whole design rests on the values being current — so it is
 * memoised for exactly as long as one page takes to build.
 */
export interface ReadContext {
  network: () => Promise<Awaited<ReturnType<typeof getTwinNetwork>>>;
}

export function readContext(db: DbClient, projectId: string): ReadContext {
  let pending: Promise<Awaited<ReturnType<typeof getTwinNetwork>>> | null = null;
  return {
    network: () => (pending ??= getTwinNetwork(db, projectId)),
  };
}

async function readMapCard(
  db: DbClient,
  projectId: string,
  cfg: CardConfig,
  ctx: ReadContext,
): Promise<CardData> {
  const metric = cfg.metric!;
  const net = await ctx.network();
  const state: MapState = cfg.state ?? "live";

  if (state === "live") {
    const placed = placeSites(net.sites, (site) => {
      const v = site.metrics?.values?.[metric];
      return { value: typeof v === "number" ? v : null, from: null };
    });
    return {
      ...EMPTY,
      sites: placed.sites,
      sitesUnread: placed.unread,
      sitesUnplaced: placed.unplaced,
      rowsRead: placed.sites.length,
      note: `Etat courant, lu le ${net.computedAt.slice(0, 16).replace("T", " a ")}.`,
    };
  }

  if (state === "scenario") {
    const out = await predictedOnBranch(db, cfg.scenarioId!, metric);
    // Predicted properties are already keyed by the live instance they were
    // cloned from, so this state needs no translation step.
    const placed = placeSites(net.sites, (site) => siteValueFromUnits(site, out.values));
    return {
      ...EMPTY,
      sites: placed.sites,
      sitesUnread: placed.unread,
      sitesUnplaced: placed.unplaced,
      rowsRead: placed.sites.length,
      note: out.provenance
        ? `Valeurs predites (${out.provenance}). Ce ne sont pas des mesures.`
        : "Valeurs predites par une execution du modele. Ce ne sont pas des mesures.",
    };
  }

  const run = await getRun(db, projectId, cfg.runId!);
  if (!run) return { ...EMPTY, error: "L'execution de cette carte n'existe plus." };
  const byScenarioInstance = valuesAtStep(run.alertTimeline, cfg.step ?? 0);

  // A run happens on a copy of the network, so its unit ids exist nowhere on
  // the map. Matching them directly would leave every site unread while the
  // run plainly has readings.
  const live = await liveIdsFor(db, run.scenarioId);
  const byLiveId = new Map<string, { value: number; message: string }>();
  for (const [scenarioInstanceId, hit] of byScenarioInstance) {
    const liveId = live.get(scenarioInstanceId);
    if (liveId) byLiveId.set(liveId, hit);
  }

  const placed = placeSites(net.sites, (site) => siteValueFromUnits(site, byLiveId));
  return {
    ...EMPTY,
    sites: placed.sites,
    sitesUnread: placed.unread,
    sitesUnplaced: placed.unplaced,
    rowsRead: placed.sites.length,
    note:
      `Execution du ${run.createdAt.slice(0, 10)}, jour ${cfg.step ?? 0}. ` +
      "Une execution enregistre les depassements de seuil, pas un releve par site et par jour : " +
      "les sites sans lecture restent vides plutot que dessines a zero.",
  };
}

/** One trajectory of a stored run, with the spread it came out of. */
async function readSeriesCard(
  db: DbClient,
  projectId: string,
  card: CardRow,
): Promise<CardData> {
  const run = await getRun(db, projectId, card.sourceId);
  if (!run) return { ...EMPTY, error: "L'execution de cette carte n'existe plus." };
  const measure = assertMeasure(card.config.measure);
  const { points, band } = seriesFromTrajectories(run.trajectories, measure);
  if (points.length === 0) {
    return { ...EMPTY, error: "Cette execution n'a pas de trajectoire enregistree." };
  }
  return {
    ...EMPTY,
    points,
    band,
    rowsRead: points.length,
    note:
      band.length === points.length
        ? "Mediane des executions, avec l'intervalle p5 a p95."
        : `Mediane des executions. Intervalle disponible sur ${band.length} jours sur ${points.length}.`,
  };
}

/**
 * A prediction against what actually happened.
 *
 * Two series on one axis invite the reader to compare them, so the card counts
 * the days where both exist and prints that count. Where they never overlap —
 * a forecast projects past the last observation, by construction — the count is
 * zero and the card says so rather than printing a gap computed over nothing.
 */
async function readCompareCard(
  db: DbClient,
  projectId: string,
  card: CardRow,
): Promise<CardData> {
  const cfg = card.config;

  if (card.sourceKind === "model") {
    const model = await getModel(db, card.sourceId);
    if (model.kind !== "timeseries" || !model.datasetId || !model.timeColumn) {
      return { ...EMPTY, error: "Seul un modele de serie temporelle peut etre compare au reel." };
    }
    const ds = await getDataset(db, model.datasetId);
    const observed = await observedByDate(
      db,
      model.datasetId,
      ds.kind,
      model.timeColumn,
      model.target,
    );
    const real = [...observed.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-90)
      .map(([label, value]) => ({ label, value }));

    const forecast = await runForecast(db, card.sourceId, Math.min(cfg.steps ?? 14, 120));
    const predicted = forecast.points.map((pt) => ({
      label: String(pt.t).slice(0, 10),
      value: pt.value,
    }));
    const x = crossReference(predicted, real);
    const mase = model.metrics.mase;
    return {
      ...EMPTY,
      real,
      predicted,
      overlap: x.overlap,
      meanGap: x.meanGap,
      worstGap: x.worstGap,
      rowsRead: real.length,
      note:
        "Le reel s'arrete ou la prevision commence : les deux courbes ne se recouvrent pas. " +
        (Number.isFinite(mase)
          ? `Sur les fenetres deja evaluees, ce modele fait ${mase} fois l'erreur de repeter la derniere valeur.`
          : "Ce modele n'a pas de score utilisable."),
    };
  }

  const run = await getRun(db, projectId, card.sourceId);
  if (!run) return { ...EMPTY, error: "L'execution de cette carte n'existe plus." };
  const measure = assertMeasure(cfg.measure);
  const mid = run.trajectories?.p50 ?? [];
  const predicted = mid.map((d) => ({
    label: dayToDate(run.createdAt, d.day),
    value: Number(d[measure] ?? 0),
  }));

  const ds = await getDataset(db, cfg.datasetId!);
  const observed = await observedByDate(db, cfg.datasetId!, ds.kind, cfg.x!, cfg.y!);
  const window = new Set(predicted.map((pt) => pt.label));
  const real = [...observed.entries()]
    .filter(([d]) => window.has(d))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

  const x = crossReference(predicted, real);
  return {
    ...EMPTY,
    predicted,
    real,
    overlap: x.overlap,
    meanGap: x.meanGap,
    worstGap: x.worstGap,
    rowsRead: real.length,
    note:
      x.overlap === 0
        ? `Aucun jour commun : l'execution couvre ${predicted[0]?.label ?? "?"} a ${predicted.at(-1)?.label ?? "?"}, et ${ds.name} n'a rien sur cette periode.`
        : `${x.overlap} jours compares sur ${predicted.length} simules.`,
  };
}

export async function readCard(
  db: DbClient,
  card: CardRow,
  projectId: string,
  ctx: ReadContext = readContext(db, projectId),
): Promise<CardData> {
  const empty = EMPTY;

  if (card.kind === "map") return readMapCard(db, projectId, card.config, ctx);
  if (card.kind === "series") return readSeriesCard(db, projectId, card);
  if (card.kind === "compare") return readCompareCard(db, projectId, card);

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

/** What a card's source is called, whichever sort of source it is. */
async function sourceNameOf(db: DbClient, card: CardRow): Promise<string> {
  try {
    if (card.sourceKind === "dataset") return (await getDataset(db, card.sourceId)).name;
    if (card.sourceKind === "model") return (await getModel(db, card.sourceId)).name;
    if (card.sourceKind === "twin") return "Jumeau du reseau";
    if (card.sourceKind === "simulation") return `Execution ${card.sourceId.slice(0, 8)}`;
  } catch {
    return "(source supprimee)";
  }
  return card.sourceId;
}

export async function readDashboard(
  db: DbClient,
  dashboardId: string,
  projectId: string,
): Promise<CardWithData[]> {
  const cards = await listCards(db, dashboardId);
  const ctx = readContext(db, projectId);
  const out: CardWithData[] = [];
  for (const card of cards) {
    // One card failing must not take the board down with it: a map whose
    // scenario was deleted is one broken rectangle, not an empty page.
    let data: CardData;
    try {
      data = await readCard(db, card, projectId, ctx);
    } catch (err) {
      data = { ...EMPTY, error: err instanceof Error ? err.message : "Lecture impossible." };
    }
    out.push({ ...card, sourceName: await sourceNameOf(db, card), data });
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
