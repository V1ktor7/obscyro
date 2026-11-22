import type { DbClient } from "../lib/db.js";
import type { FreshnessBasis } from "./observed-at.js";
import { evaluationPulse, type EvaluationPulse } from "./twin-alert-scheduler.js";

/**
 * The open alerts of a project, for every screen at once.
 *
 * An alert used to reach a person only on the page that happened to ask for
 * it, each on its own clock: the unit canvas every ten seconds, the globe
 * every thirty, the unit tree by fetching each unit in turn, the response
 * board when somebody pressed Refresh. The same ward could be red on one page
 * and absent from the next. This is the one reading all of them make.
 *
 * What a person needs to act is on each alert: which unit, how bad, since
 * when, how old the value is, and the signal it became. Nothing here is about
 * a person: an alert is a unit and an aggregate value.
 *
 * It only reads. Alerts are opened and closed by the evaluator
 * (`twin-alert-scheduler.ts`), and `evaluation` says when it last ran, so a
 * screen can tell "nothing is wrong" from "nobody has checked".
 */

/** Alerts listed in full. Past this the feed counts them and says how many it left out. */
export const FEED_LIMIT = 200;

export type AlertSeverity = "info" | "warn" | "critical";

export interface FeedAlert {
  id: string;
  unitId: string;
  /** The unit's name as the twin gives it: its name, else its code, else the start of its id. */
  unitName: string;
  severity: AlertSeverity;
  metric: string;
  value: number;
  message: string;
  /** When an evaluation first saw the threshold crossed. */
  openedAt: string;
  /** When the value was true, from the timestamp the source published; null when it does not say. */
  observedAt: string | null;
  /**
   * What that age rests on, counted on what the alert's measure reads and not
   * on everything under its unit: the source's own timestamp, a floor because
   * one of the sources the measure reads published no time, or the reason
   * there is no age at all. Null for an alert last evaluated before this was
   * kept.
   */
  observedBasis: FreshnessBasis | null;
  /** When the data that opened the alert was written here; null for alerts opened before this was kept. */
  writtenAt: string | null;
  /** The signal this alert raised, when a signal type claims its metric. */
  signalId: string | null;
}

export interface AlertFeed {
  /** The server's clock when this was read: ages are counted from it, not from the browser's. */
  at: string;
  /** Worst first, then newest first. */
  alerts: FeedAlert[];
  /** Every open alert, by severity: the list may be shorter. */
  counts: Record<AlertSeverity, number>;
  /** Open alerts beyond the list's limit. */
  omitted: number;
  /** Enough to know the response board changed: how many signals are open, and when one last moved. */
  signals: { open: number; changedAt: string | null };
  evaluation: EvaluationPulse;
}

export interface FeedAlertRow {
  id: string;
  unit_instance_id: string;
  unit_name: string;
  severity: AlertSeverity;
  metric: string;
  value: string;
  message: string;
  created_at: Date;
  observed_at: Date | null;
  observed_basis: FreshnessBasis | null;
  written_at: Date | null;
  signal_id: string | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The feed, from what the three queries returned. Kept apart from them so it can be tested without a database. */
export function feedFrom(
  rows: FeedAlertRow[],
  counted: { severity: AlertSeverity; n: number }[],
  signals: { open: number; changed_at: Date | null },
  pulse: EvaluationPulse,
  now: Date,
): AlertFeed {
  const counts: Record<AlertSeverity, number> = { critical: 0, warn: 0, info: 0 };
  for (const c of counted) counts[c.severity] = c.n;
  const total = counts.critical + counts.warn + counts.info;
  return {
    at: now.toISOString(),
    alerts: rows.map((r) => ({
      id: r.id,
      unitId: r.unit_instance_id,
      unitName: r.unit_name,
      severity: r.severity,
      metric: r.metric,
      value: Number(r.value),
      message: r.message,
      openedAt: r.created_at.toISOString(),
      observedAt: iso(r.observed_at),
      observedBasis: r.observed_basis,
      writtenAt: iso(r.written_at),
      signalId: r.signal_id,
    })),
    counts,
    omitted: Math.max(0, total - rows.length),
    signals: { open: signals.open, changedAt: iso(signals.changed_at) },
    evaluation: pulse,
  };
}

export async function readAlertFeed(db: DbClient, projectId: string, limit = FEED_LIMIT): Promise<AlertFeed> {
  const [alerts, counted, signals] = await Promise.all([
    db.query<FeedAlertRow>(
      // The unit is named the way the twin's tree names it (`getUnitTree`), so
      // the banner and the map cannot call one ward two things.
      `SELECT a.id, a.unit_instance_id, a.severity, a.metric, a.value::text AS value, a.message,
              a.created_at, a.observed_at, a.observed_basis, a.written_at,
              COALESCE(NULLIF(oi.properties ->> 'name', ''), NULLIF(oi.properties ->> 'code', ''),
                       left(a.unit_instance_id::text, 8)) AS unit_name,
              (SELECT s.id FROM app.signal s
                WHERE s.origin_kind = 'twin_alert' AND s.origin_id = a.id
                ORDER BY s.detected_at LIMIT 1) AS signal_id
         FROM app.twin_alert a
         LEFT JOIN app.ontology_object_instances oi ON oi.id = a.unit_instance_id
        WHERE a.project_id = $1 AND a.status = 'open'
        ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a.created_at DESC
        LIMIT $2`,
      [projectId, limit],
    ),
    db.query<{ severity: AlertSeverity; n: number }>(
      `SELECT severity, count(*)::int AS n FROM app.twin_alert WHERE project_id = $1 AND status = 'open' GROUP BY severity`,
      [projectId],
    ),
    db.query<{ open: number; changed_at: Date | null }>(
      `SELECT count(*) FILTER (WHERE closed_at IS NULL)::int AS open,
              GREATEST(max(updated_at), max(detected_at)) AS changed_at
         FROM app.signal WHERE project_id = $1`,
      [projectId],
    ),
  ]);
  return feedFrom(alerts.rows, counted.rows, signals.rows[0] ?? { open: 0, changed_at: null }, evaluationPulse(), new Date());
}
