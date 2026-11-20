import type { DbClient } from "../lib/db.js";
import { readAlertFeed, type AlertFeed, type AlertSeverity, type FeedAlert } from "./alert-feed.js";
import type { FreshnessBasis } from "./observed-at.js";
import { DEFAULT_OCCUPANCY, listTwinMetrics, type MetricUnit } from "./twin-metrics.js";
import { getUnitTree, listAlertRules, rollupAllUnits, type UnitMetrics } from "./twin.js";

/**
 * The twin as the live pages read it, in one reading.
 *
 * The unit page shows a roll-up; the alert banner shows the alert feed. The
 * analyst used to read neither: it read the simulation export, which counts
 * what stands at a unit itself and not under it (`twin-figures.unit.test.ts`),
 * and it had no tool for an alert at all. A person looking at a red ward and
 * asking the analyst about it could be told a different number, about a
 * different thing.
 *
 * So everything said about "now" — by the analyst (`list_alerts`, `unit_now`)
 * and by the situation card — is built here, from the very functions the
 * screens call: `rollupAllUnits` for a unit's figures, `readAlertFeed` for the
 * alerts. Nothing below recounts anything.
 *
 * Reality only. No scenario raises an alert, and a live figure read through a
 * "what if" would be a figure about a world that is not there.
 *
 * Every figure carries its age, or says that it has none and why. Acting fast
 * on an old value is the danger this exists to prevent.
 *
 * Nothing here is about a person: a unit, a measure, an aggregate value.
 */

export interface LiveUnit {
  id: string;
  name: string;
  parentId: string | null;
}

/** A measure the organisation defined: what its key is called on screen, and what it counts in. */
export interface LiveMeasure {
  key: string;
  label: string;
  unit: MetricUnit;
}

/** A signal with the names a person reads: its type, and where it stands in its workflow. */
export interface LiveSignal {
  id: string;
  title: string;
  severity: AlertSeverity;
  detectedAt: string;
  closedAt: string | null;
  /** The unit the signal is about, when it is about one. */
  unitId: string | null;
  /** The alert that raised it, when one did. */
  alertId: string | null;
  /** Its kind, by id and by name: prepared responses are kept per kind. */
  typeId: string;
  type: string;
  domain: string;
  stage: string;
  /** The stage's place in its workflow, counted from one, and how many stages there are. */
  stageNo: number;
  stages: number;
  needsApproval: boolean;
  isLast: boolean;
}

export interface LiveReading {
  /** The server's clock when this was read: ages are counted from it. */
  at: string;
  units: LiveUnit[];
  /** The roll-up the unit page shows, by unit. */
  metrics: Map<string, UnitMetrics>;
  measures: LiveMeasure[];
  feed: AlertFeed;
  /** How many alert rules the project has. None is not the same as nothing wrong. */
  rules: number;
  /** The signals the listed alerts raised. */
  signals: LiveSignal[];
  /** Every open signal of the project, by the stage it stands at, in workflow order. */
  openSignalsByStage: { stage: string; n: number }[];
}

// ---------------------------------------------------------------------------
// Saying a value and an age the way the screens do.
// ---------------------------------------------------------------------------

/** A duration the way the alert banner says it: "12 s", "4 min", "3 h", "2 d". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/**
 * A value rounded the way the unit page shows it (`formatMetricValue`).
 *
 * The analyst is handed the number the screen prints, not the one behind it:
 * handed 152.38 it would write "152.4 %" beside a page that says 152 %, and a
 * reader comparing the two would be right to trust neither.
 */
export function shown(value: number | null, unit: MetricUnit): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (unit === "percent" || unit === "count") return Math.round(value);
  if (unit === "ratio") return Math.round(value * 100) / 100;
  return Math.round(value * 10) / 10;
}

/** Why a value has no age, or only a floor: the sentences of the unit's card. */
export function whyAge(basis: FreshnessBasis | null): string | null {
  switch (basis) {
    case "undeclared":
      return "No property of this type is declared as carrying the time of the reading.";
    case "unreadable":
      return "The declared timestamp property carries nothing readable.";
    case "zone-unknown":
      return "The timestamp names a wall clock and no zone is declared for it.";
    case "partial":
      return "One of the sources feeding this unit published no readable time, so this is a floor.";
    case "empty":
      return "Nothing is linked to this unit.";
    default:
      return null;
  }
}

export interface ValueAge {
  /** `exact`: the source's own timestamp. `at_least`: a floor. `unknown`: no age. */
  known: "exact" | "at_least" | "unknown";
  /** The age as the screen says it ("37 min"), or null when unknown. */
  age: string | null;
  /** The whole phrase, as the alert banner writes it. */
  says: string;
  /** Why there is no exact age; null when there is one. */
  why: string | null;
}

/**
 * How old a value is, said with what the age rests on.
 *
 * The same three cases the alert banner writes (`valueAge` in the Studio): an
 * exact age, a floor said as a floor, or no age. An unknown age is never
 * rounded toward the reassuring.
 */
export function ageOfValue(seconds: number | null, basis: FreshnessBasis | null): ValueAge {
  const why = basis && basis !== "observed" ? whyAge(basis) : null;
  if (seconds === null || !Number.isFinite(seconds)) return { known: "unknown", age: null, says: "age of the value unknown", why };
  const age = duration(seconds * 1000);
  if (basis === "partial") return { known: "at_least", age, says: `value read at least ${age} ago`, why };
  return { known: "exact", age, says: seconds < 5 ? "value read just now" : `value read ${age} ago`, why };
}

const secondsBetween = (fromIso: string | null, toIso: string): number | null => {
  if (!fromIso) return null;
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
};

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

interface SignalRow {
  id: string;
  title: string;
  severity: AlertSeverity;
  detected_at: Date;
  closed_at: Date | null;
  subject_id: string | null;
  origin_kind: string;
  origin_id: string | null;
  signal_type_id: string;
  type_name: string;
  domain: string;
  stage_name: string;
  requires_approval: boolean;
  is_terminal: boolean;
  stage_no: number;
  stages: number;
}

const SIGNAL_SELECT = `
  SELECT s.id, s.title, s.severity, s.detected_at, s.closed_at, s.subject_id, s.origin_kind, s.origin_id,
         s.signal_type_id, t.name AS type_name, t.domain, ws.name AS stage_name, ws.requires_approval, ws.is_terminal,
         (SELECT count(*)::int FROM app.workflow_stage x WHERE x.workflow_id = ws.workflow_id AND x.seq <= ws.seq) AS stage_no,
         (SELECT count(*)::int FROM app.workflow_stage x WHERE x.workflow_id = ws.workflow_id) AS stages
    FROM app.signal s
    JOIN app.signal_type t ON t.id = s.signal_type_id
    JOIN app.workflow_stage ws ON ws.id = s.stage_id`;

export function signalFrom(r: SignalRow): LiveSignal {
  return {
    id: r.id,
    title: r.title,
    severity: r.severity,
    detectedAt: r.detected_at.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    unitId: r.subject_id,
    alertId: r.origin_kind === "twin_alert" ? r.origin_id : null,
    typeId: r.signal_type_id,
    type: r.type_name,
    domain: r.domain,
    stage: r.stage_name,
    stageNo: r.stage_no,
    stages: r.stages,
    needsApproval: r.requires_approval,
    isLast: r.is_terminal,
  };
}

/** Signals by id, within one project: a signal of another project is not found, whoever asks. */
export async function signalsById(db: DbClient, projectId: string, ids: string[]): Promise<LiveSignal[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.project_id = $1 AND s.id = ANY($2::uuid[])`, [projectId, ids]);
  return rows.map(signalFrom);
}

export async function readLive(db: DbClient, env: { id: string; organizationId: string }): Promise<LiveReading> {
  const [tree, metrics, stored, feed, rules, byStage] = await Promise.all([
    getUnitTree(db, env.id),
    rollupAllUnits(db, env.id),
    listTwinMetrics(db, env.organizationId),
    readAlertFeed(db, env.id),
    listAlertRules(db, env.id),
    db.query<{ stage: string; n: number }>(
      `SELECT ws.name AS stage, count(*)::int AS n
         FROM app.signal s JOIN app.workflow_stage ws ON ws.id = s.stage_id
        WHERE s.project_id = $1 AND s.closed_at IS NULL
        GROUP BY ws.name, ws.seq ORDER BY ws.seq, ws.name`,
      [env.id],
    ),
  ]);
  const signals = await signalsById(
    db,
    env.id,
    feed.alerts.map((a) => a.signalId).filter((id): id is string => id !== null),
  );
  // An organisation that defined no measure is rolled up with the default one, so that is the one on screen.
  const measures = (stored.length > 0 ? stored : [DEFAULT_OCCUPANCY]).map((m) => ({ key: m.key, label: m.label, unit: m.unit }));
  return {
    at: feed.at,
    units: tree.nodes.map((n) => ({ id: n.id, name: n.name, parentId: n.parentId })),
    metrics,
    measures,
    feed,
    rules: rules.length,
    signals,
    openSignalsByStage: byStage.rows,
  };
}

// ---------------------------------------------------------------------------
// What is said of it. Pure: the analyst's tools and the situation card both
// call these, so they cannot disagree.
// ---------------------------------------------------------------------------

const SIGNAL_STEP = (s: LiveSignal) => ({
  id: s.id,
  title: s.title,
  kind: s.type,
  domain: s.domain,
  stage: s.stage,
  step: `${s.stageNo} of ${s.stages}`,
  needs_approval: s.needsApproval,
  closed: s.closedAt !== null,
});

/** One alert, as a person needs it: where, how bad, since when, how old, and the signal it became. */
export function alertNow(a: FeedAlert, live: Pick<LiveReading, "at" | "measures" | "signals">) {
  const measure = live.measures.find((m) => m.key === a.metric) ?? null;
  const signal = a.signalId ? (live.signals.find((s) => s.id === a.signalId) ?? null) : null;
  return {
    id: a.id,
    unit: a.unitName,
    unit_id: a.unitId,
    severity: a.severity,
    measure: measure?.label ?? a.metric,
    measure_key: a.metric,
    value: shown(a.value, measure?.unit ?? "number"),
    counted_in: measure?.unit ?? "number",
    says: a.message,
    opened_at: a.openedAt,
    open_for: duration(Date.parse(live.at) - Date.parse(a.openedAt)),
    value_age: ageOfValue(secondsBetween(a.observedAt, live.at), a.observedBasis),
    signal: signal ? SIGNAL_STEP(signal) : null,
  };
}

/**
 * When the thresholds were last checked, in words: "nothing is open" means
 * little if nobody looked.
 *
 * The evaluator's pulse is the server's, not the project's. In a project with
 * no rule it would say "checked 5 s ago" about thresholds that do not exist,
 * so that case is said first.
 */
export function lastChecked(live: Pick<LiveReading, "at" | "feed" | "rules">): { at: string | null; says: string } {
  if (live.rules === 0) return { at: null, says: "no alert rule exists in this project, so nothing can open" };
  const at = live.feed.evaluation.lastAt;
  const s = secondsBetween(at, live.at);
  if (at === null || s === null) return { at: null, says: "the thresholds have not been checked since the server started" };
  return { at, says: `thresholds last checked ${duration(s * 1000)} ago` };
}

/** The alerts open right now, for the whole project or for one unit. */
export function alertsNow(live: LiveReading, only: LiveUnit | null = null) {
  const listed = live.feed.alerts.filter((a) => !only || a.unitId === only.id);
  const open = only
    ? {
        critical: listed.filter((a) => a.severity === "critical").length,
        warn: listed.filter((a) => a.severity === "warn").length,
        info: listed.filter((a) => a.severity === "info").length,
      }
    : live.feed.counts;
  const total = open.critical + open.warn + open.info;
  return {
    read_at: live.at,
    ...(only ? { unit: only.name } : {}),
    open_alerts: { total, ...open },
    alerts: listed.map((a) => alertNow(a, live)),
    // The feed lists the worst and newest; past its limit it counts.
    ...(only ? {} : { not_listed: live.feed.omitted }),
    alert_rules: live.rules,
    checked: lastChecked(live),
    open_signals: { total: live.feed.signals.open, by_stage: live.openSignalsByStage },
    how_to_read: [
      "Reality only: no scenario raises an alert.",
      "Worst first, then newest. `value` is the measure's value as the screen shows it; `value_age` says how old that value is, or that its age is unknown and why. Give the age with the value.",
      total === 0 && live.rules === 0
        ? "No alert rule exists in this project, so nothing can open: no open alert is not a sign that nothing is wrong."
        : total === 0
          ? "No alert is open. That is what the rules saw when they were last checked (`checked`), not a guarantee."
          : "An alert is a unit and an aggregate value, never a person.",
      "`open_signals` counts every open signal of the project, including those whose alert has since cleared: it can be far larger than the alerts open now.",
      "There is no history: this cannot say what was open earlier, or what changed since this morning.",
    ],
  };
}

/** A unit's live figures, exactly as the unit page shows them. */
export function unitNow(live: LiveReading, unit: LiveUnit) {
  const m = live.metrics.get(unit.id) ?? null;
  const children = live.units.filter((u) => u.parentId === unit.id);
  const parent = unit.parentId ? (live.units.find((u) => u.id === unit.parentId) ?? null) : null;
  const age = ageOfValue(m?.freshnessSeconds ?? null, m?.freshnessBasis ?? "empty");
  return {
    read_at: live.at,
    unit: { id: unit.id, name: unit.name, inside: parent?.name ?? null, sub_units: children.length },
    measures: live.measures.map((d) => ({
      key: d.key,
      measure: d.label,
      value: shown(m?.values[d.key] ?? null, d.unit),
      counted_in: d.unit,
      ...(m?.qualifiers[d.key]?.length ? { about: m.qualifiers[d.key] } : {}),
    })),
    under_it_by_type: m?.instanceCountByType ?? {},
    linked: m?.linkedInstanceCount ?? 0,
    value_age: age,
    last_written_here: m?.fetchedAgeSeconds == null ? null : `${duration(m.fetchedAgeSeconds * 1000)} ago`,
    open_alerts: live.feed.alerts.filter((a) => a.unitId === unit.id).map((a) => alertNow(a, live)),
    how_to_read: [
      "These are the figures the unit page shows. They count everything under the unit, its sub-units included.",
      "`get_site` gives what the simulation engine counts at the unit itself. For a unit with sub-units the two differ, and both are right: say which one you are giving.",
      "A measure with value null has nothing to be computed from here (no bed is no occupancy, not 0 %).",
      "`value_age` is the age of the unit's reading as a whole: the oldest of its sources when it has several. `last_written_here` is when the data was last written to the twin, which is not when it was true.",
      "There is no history: this is the reading now, and nothing here says what it was earlier.",
    ],
  };
}
