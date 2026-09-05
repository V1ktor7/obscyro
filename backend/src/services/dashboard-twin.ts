import type { DbClient } from "../lib/db.js";
import { BadRequest } from "../lib/errors.js";
import type { AlertTimelineEvent, DailyTrajectory } from "./simulation.js";

/**
 * Cards that read the twin, a simulation run, and a model — not a table.
 *
 * The rule 050 set holds: a card stores no values. A map card names a metric
 * and a state; a series card names a run. What changes is where the values come
 * from, and each of these sources has a way of lying that a dataset does not.
 *
 * A run happened on a *copy* of the network. Its unit ids are scenario
 * instances, not the live instances the map is drawn from, so every number here
 * is joined back through `source_instance_id` and the site's own
 * `contributingUnits`. Skipping that join and matching ids directly would
 * produce a map where nothing lines up and nothing says so.
 *
 * A run is also sparse where a dataset is dense. The alert timeline holds the
 * days a unit breached a rule, not a reading for every unit every day. So a map
 * frozen at a step reports how many sites the run actually spoke about, and
 * draws the rest as unread rather than as zero — the same rule the replay
 * overlay applies, for the same reason: a unit the run never touched must not
 * keep showing yesterday's colour.
 */

export type MapState = "live" | "run" | "scenario";
export type TrajectoryMeasure = "S" | "E" | "I" | "R" | "isolationDemand";

export const MEASURES: readonly TrajectoryMeasure[] = [
  "S",
  "E",
  "I",
  "R",
  "isolationDemand",
];

export interface MapSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Null when this source said nothing about this site. Never zero for absent. */
  value: number | null;
  /** Which unit inside the site the value came from, so a number can be traced. */
  from: string | null;
}

export interface BandPoint {
  label: string;
  low: number;
  high: number;
}

/**
 * A reading per unit at one step of a run.
 *
 * The alert timeline is the only per-unit, per-day record a completed run
 * keeps. It holds breaches, so a unit missing from a day is a unit that stayed
 * within its rules — which is information, and different from a unit the run
 * never modelled. The caller can only tell the two apart by counting sites, so
 * that count is returned alongside.
 */
export function valuesAtStep(
  timeline: AlertTimelineEvent[],
  day: number,
): Map<string, { value: number; message: string }> {
  const out = new Map<string, { value: number; message: string }>();
  for (const e of timeline) {
    if (e.day !== day) continue;
    const seen = out.get(e.unitInstanceId);
    // Worst reading wins. A unit whose beds are full and whose clinic is empty
    // is not half full; it is turning people away.
    if (!seen || e.value > seen.value) {
      out.set(e.unitInstanceId, { value: e.value, message: e.message });
    }
  }
  return out;
}

/** Every day the run said something about, so a step picker offers real steps. */
export function stepsIn(timeline: AlertTimelineEvent[]): number[] {
  return [...new Set(timeline.map((e) => e.day))].sort((a, b) => a - b);
}

interface SiteLike {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  contributingUnits: { id: string; name: string }[];
  metrics: { values: Record<string, number | null> };
}

/**
 * Sites placed on the map, with the value each one carries.
 *
 * A site without coordinates cannot be drawn. It is counted rather than
 * dropped: "22 sites, 3 without coordinates" is a fixable statement, and a map
 * quietly showing 19 is not.
 */
export function placeSites(
  sites: SiteLike[],
  valueOf: (site: SiteLike) => { value: number | null; from: string | null },
): { sites: MapSite[]; unplaced: number; unread: number } {
  const out: MapSite[] = [];
  let unplaced = 0;
  let unread = 0;
  for (const s of sites) {
    if (s.latitude == null || s.longitude == null) {
      unplaced += 1;
      continue;
    }
    const { value, from } = valueOf(s);
    if (value == null) unread += 1;
    out.push({
      id: s.id,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      value,
      from,
    });
  }
  return { sites: out, unplaced, unread };
}

/**
 * The value a run gave this site, through the units placed in it.
 *
 * `byLiveId` is keyed by live instance id — the run's scenario-instance ids
 * having already been translated. A site's own id is tried too, because a twin
 * whose installations carry their own coordinates has no placement link and is
 * its own contributing unit.
 */
export function siteValueFromUnits(
  site: SiteLike,
  byLiveId: Map<string, { value: number; message: string }>,
): { value: number | null; from: string | null } {
  let best: { value: number; from: string } | null = null;
  const candidates = [
    { id: site.id, name: site.name },
    ...site.contributingUnits,
  ];
  for (const u of candidates) {
    const hit = byLiveId.get(u.id);
    if (!hit) continue;
    if (!best || hit.value > best.value) best = { value: hit.value, from: u.name };
  }
  return best ? { value: best.value, from: best.from } : { value: null, from: null };
}

/**
 * A run's trajectory as a card's points, with its p5–p95 envelope.
 *
 * The band is not decoration. A median curve drawn alone from ten stochastic
 * runs reads as a forecast; drawn with the spread it came from, it reads as a
 * middle. The card carries both or the reader is being shown a confidence the
 * run never had.
 */
export function seriesFromTrajectories(
  trajectories: { p5?: DailyTrajectory[]; p50?: DailyTrajectory[]; p95?: DailyTrajectory[] } | null,
  measure: TrajectoryMeasure,
): { points: Array<{ label: string; value: number }>; band: BandPoint[] } {
  const mid = trajectories?.p50 ?? [];
  if (mid.length === 0) return { points: [], band: [] };
  const low = new Map((trajectories?.p5 ?? []).map((d) => [d.day, d[measure]]));
  const high = new Map((trajectories?.p95 ?? []).map((d) => [d.day, d[measure]]));

  const points = mid.map((d) => ({ label: `J${d.day}`, value: Number(d[measure] ?? 0) }));
  const band: BandPoint[] = [];
  for (const d of mid) {
    const lo = low.get(d.day);
    const hi = high.get(d.day);
    // A band is only drawn where both edges exist. Substituting the median for
    // a missing edge would draw a zero-width band, which reads as certainty.
    if (lo == null || hi == null) continue;
    band.push({ label: `J${d.day}`, low: Number(lo), high: Number(hi) });
  }
  return { points, band };
}

/** Day `d` of a run that started on `startISO`, as a calendar date. */
export function dayToDate(startISO: string, day: number): string {
  const t = new Date(startISO);
  if (Number.isNaN(t.getTime())) return `J${day}`;
  const out = new Date(t.getTime() + day * 86_400_000);
  return out.toISOString().slice(0, 10);
}

export interface CrossReference {
  /** Days where both a prediction and an observation exist. */
  overlap: number;
  /** Mean |predicted − observed| over the overlap, null when there is none. */
  meanGap: number | null;
  /** The single worst day, so a good average cannot hide it. */
  worstGap: { label: string; predicted: number; observed: number } | null;
}

/**
 * Where a prediction and reality can be compared, and where they cannot.
 *
 * Two series that do not overlap in time are not comparable, and drawing them
 * on one axis without saying so invites the reader to compare them anyway. The
 * overlap is counted, and when it is empty every other number here is null
 * rather than computed over an empty set — a mean of nothing is 0, and 0 reads
 * as perfect agreement.
 */
export function crossReference(
  predicted: Array<{ label: string; value: number }>,
  real: Array<{ label: string; value: number }>,
): CrossReference {
  const obs = new Map(real.map((p) => [p.label, p.value]));
  let sum = 0;
  let n = 0;
  let worst: CrossReference["worstGap"] = null;
  for (const p of predicted) {
    const o = obs.get(p.label);
    if (o == null) continue;
    const gap = Math.abs(p.value - o);
    sum += gap;
    n += 1;
    if (!worst || gap > Math.abs(worst.predicted - worst.observed)) {
      worst = { label: p.label, predicted: p.value, observed: o };
    }
  }
  return {
    overlap: n,
    meanGap: n === 0 ? null : Number((sum / n).toFixed(4)),
    worstGap: worst,
  };
}

// ---------------------------------------------------------------------------
// Reading from the database

export interface RunRow {
  id: string;
  scenarioId: string;
  scenarioName: string;
  status: string;
  engine: string | null;
  createdAt: string;
  horizonDays: number;
  measures: TrajectoryMeasure[];
  steps: number[];
}

/** Completed runs of this project's scenarios, newest first. */
export async function listRuns(db: DbClient, projectId: string): Promise<RunRow[]> {
  const { rows } = await db.query<{
    id: string;
    scenario_id: string;
    scenario_name: string;
    status: string;
    engine: string | null;
    created_at: Date;
    trajectories: { p50?: DailyTrajectory[] } | null;
    alert_timeline: AlertTimelineEvent[] | null;
  }>(
    `SELECT r.id, r.scenario_id, s.name AS scenario_name, r.status, r.engine,
            r.created_at, r.trajectories, r.alert_timeline
       FROM app.simulation_run r
       JOIN app.scenario s ON s.id = r.scenario_id
      WHERE s.project_id = $1 AND r.status = 'completed'
      ORDER BY r.created_at DESC
      LIMIT 50`,
    [projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    scenarioId: r.scenario_id,
    scenarioName: r.scenario_name,
    status: r.status,
    engine: r.engine,
    createdAt: r.created_at.toISOString(),
    horizonDays: (r.trajectories?.p50 ?? []).length,
    measures: [...MEASURES],
    steps: stepsIn(r.alert_timeline ?? []),
  }));
}

export interface RunDetail {
  id: string;
  scenarioId: string;
  createdAt: string;
  trajectories: { p5?: DailyTrajectory[]; p50?: DailyTrajectory[]; p95?: DailyTrajectory[] } | null;
  alertTimeline: AlertTimelineEvent[];
}

export async function getRun(
  db: DbClient,
  projectId: string,
  runId: string,
): Promise<RunDetail | null> {
  const { rows } = await db.query<{
    id: string;
    scenario_id: string;
    created_at: Date;
    trajectories: RunDetail["trajectories"];
    alert_timeline: AlertTimelineEvent[] | null;
  }>(
    `SELECT r.id, r.scenario_id, r.created_at, r.trajectories, r.alert_timeline
       FROM app.simulation_run r
       JOIN app.scenario s ON s.id = r.scenario_id
      WHERE r.id = $1 AND s.project_id = $2`,
    [runId, projectId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    scenarioId: r.scenario_id,
    createdAt: r.created_at.toISOString(),
    trajectories: r.trajectories,
    alertTimeline: r.alert_timeline ?? [],
  };
}

/**
 * Scenario-instance ids translated to the live instances they were cloned from.
 *
 * Without this the run's numbers land on ids that exist nowhere on the map, and
 * every site draws unread while the run plainly has readings.
 */
export async function liveIdsFor(
  db: DbClient,
  scenarioId: string,
): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; source_instance_id: string | null }>(
    `SELECT id, source_instance_id FROM app.scenario_instance WHERE scenario_id = $1`,
    [scenarioId],
  );
  const out = new Map<string, string>();
  for (const r of rows) if (r.source_instance_id) out.set(r.id, r.source_instance_id);
  return out;
}

/** Predicted properties written onto a branch by an ML run, by live instance. */
export async function predictedOnBranch(
  db: DbClient,
  scenarioId: string,
  property: string,
): Promise<{ values: Map<string, { value: number; message: string }>; provenance: string | null }> {
  const { rows } = await db.query<{
    source_instance_id: string | null;
    predicted_properties: Record<string, unknown>;
    prediction_provenance: Record<string, unknown>;
  }>(
    `SELECT source_instance_id, predicted_properties, prediction_provenance
       FROM app.scenario_instance
      WHERE scenario_id = $1 AND predicted_properties <> '{}'::jsonb`,
    [scenarioId],
  );
  const values = new Map<string, { value: number; message: string }>();
  let provenance: string | null = null;
  for (const r of rows) {
    if (!provenance) {
      const p = r.prediction_provenance ?? {};
      const version = typeof p.version === "string" ? p.version : null;
      const runId = typeof p.run_id === "string" ? p.run_id.slice(0, 8) : null;
      if (version || runId) {
        provenance = `modèle ${version ?? "—"} · exécution ${runId ?? "—"}`;
      }
    }
    if (!r.source_instance_id) continue;
    const raw = (r.predicted_properties ?? {})[property];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) continue;
    values.set(r.source_instance_id, { value: n, message: `prévu : ${n}` });
  }
  return { values, provenance };
}

/**
 * A dataset's series, keyed by calendar day.
 *
 * Guarded the same way `num` is in `dashboards`: a date column holding
 * "pas d'information disponible" yields NULL instead of aborting the query, and
 * the row is simply not in the map.
 */
export async function observedByDate(
  db: DbClient,
  datasetId: string,
  kind: string,
  timeColumn: string,
  measure: string,
): Promise<Map<string, number>> {
  const src =
    kind === "stream"
      ? `SELECT data FROM app.dataset_row WHERE dataset_id = $1`
      : `SELECT r.data
           FROM app.dataset_row r
           JOIN app.dataset_version v ON v.id = r.version_id
          WHERE r.dataset_id = $1
            AND v.version = (SELECT MAX(version) FROM app.dataset_version WHERE dataset_id = $1)`;
  const { rows } = await db.query<{ d: string; v: string | null }>(
    `WITH src AS (${src})
     SELECT left(data->>$2, 10) AS d,
            avg(CASE WHEN (data->>$3) ~ '^[[:space:]]*-?[0-9]+([.][0-9]+)?[[:space:]]*$'
                     THEN (data->>$3)::numeric END) AS v
       FROM src
      WHERE (data->>$2) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      GROUP BY 1`,
    [datasetId, timeColumn, measure],
  );
  const out = new Map<string, number>();
  for (const r of rows) if (r.v != null) out.set(r.d, Number(r.v));
  return out;
}

export function assertMeasure(measure: unknown): TrajectoryMeasure {
  if (typeof measure !== "string" || !MEASURES.includes(measure as TrajectoryMeasure)) {
    throw BadRequest(
      "UNKNOWN_MEASURE",
      `Mesure inconnue : ${String(measure)}. Attendu ${MEASURES.join(", ")}.`,
    );
  }
  return measure as TrajectoryMeasure;
}
