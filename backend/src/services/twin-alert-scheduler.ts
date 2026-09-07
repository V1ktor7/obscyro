import type { DbClient } from "../lib/db.js";

import {
  compareOp,
  evaluateAlerts,
  getUnitTree,
  listAlertRules,
  metricValue,
  rollupAllUnits,
  type TwinAlertRuleRow,
  type UnitMetrics,
} from "./twin.js";

// ---------------------------------------------------------------------------
// The twin evaluates its own alerts, with or without an audience.
//
// `evaluateAlerts` lives inside `getTwinTreeSnapshot`, which is a read path:
// the REST call and the five-second SSE tick. So a rule only ever fired while
// somebody had the page open. An emergency ward crossing capacity at 03:00
// raised nothing, and the signal it should have produced appeared hours later,
// stamped with the hour someone opened a browser rather than the hour it
// happened.
//
// Two halves, and the second is the one that could not exist before:
//
//   opened    a condition that now holds and did not before
//   resolved  a condition that held and now demonstrably does not
//
// Resolution only belongs here, never in the read path, and the reason is
// sharper than tidiness: `getTwinTreeSnapshot` takes a read lens. Under a lens
// that hides units, their metrics are simply absent from the rollup — which is
// indistinguishable, to a resolver, from a ward that emptied. One analyst with
// a narrow lens would close every alert outside it. This scheduler runs
// unlensed, over the whole project, which is the only footing from which
// "no longer firing" can be asserted.
// ---------------------------------------------------------------------------

const TICK_MS = 30_000;

/**
 * Past this many projects a tick costs more than it is worth, and the cure is
 * rotation rather than a bigger loop. Crossing it is logged rather than
 * silently absorbed, so it is known before it hurts.
 */
const BUSY_PROJECTS = 20;

let started = false;

export interface EvalResult {
  projectId: string;
  opened: number;
  resolved: number;
  /** Alerts left open because the metric could not be read at all. */
  unreadable: number;
}

/**
 * Projects worth evaluating: the ones that have at least one rule.
 *
 * A project with no rule has nothing an evaluation could discover, and a
 * rollup over its whole ontology to learn that would be the most expensive way
 * to compute zero.
 */
export async function projectsWithAlertRules(db: DbClient): Promise<string[]> {
  const { rows } = await db.query<{ project_id: string }>(
    `SELECT DISTINCT project_id FROM app.twin_alert_rule ORDER BY project_id`,
  );
  return rows.map((r) => r.project_id);
}

export interface OpenAlertRef {
  id: string;
  unitInstanceId: string;
  ruleId: string | null;
}

/**
 * Which open alerts have demonstrably stopped firing.
 *
 * Three outcomes, and the third is the one worth being careful about:
 *
 *   resolve     the rule still applies here and the metric reads a number
 *               that no longer crosses the threshold
 *   unreadable  the unit stopped reporting, so the metric is null — absent is
 *               not calm, and closing on silence would turn a hospital we have
 *               lost sight of into a hospital that is fine
 *   keep        everything else
 *
 * An alert whose rule was deleted is never resolved here. The delete dialog
 * promises "open alerts it already raised stay where they are", and a
 * scheduler quietly sweeping them up an hour later would make that a lie.
 * Same for a rule whose `unitKind` no longer covers this unit: that is a human
 * changing the configuration, not a condition clearing.
 */
export function alertsToResolve(
  open: OpenAlertRef[],
  rules: TwinAlertRuleRow[],
  metricsByUnit: Map<string, UnitMetrics>,
  unitKinds: Map<string, string>,
): { resolve: string[]; unreadable: string[] } {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const resolve: string[] = [];
  const unreadable: string[] = [];

  for (const a of open) {
    if (!a.ruleId) continue;
    const rule = ruleById.get(a.ruleId);
    if (!rule) continue;

    // The same test evaluateAlerts makes, so a rule cannot open an alert the
    // resolver then refuses to consider.
    const kind = unitKinds.get(a.unitInstanceId) ?? null;
    if (rule.unitKind && rule.unitKind !== kind) continue;

    const metrics = metricsByUnit.get(a.unitInstanceId);
    if (!metrics) {
      unreadable.push(a.id);
      continue;
    }
    const value = metricValue(metrics, rule.metric);
    if (value == null) {
      unreadable.push(a.id);
      continue;
    }
    if (!compareOp(rule.op, value, rule.threshold)) resolve.push(a.id);
  }

  return { resolve, unreadable };
}

/**
 * One project, evaluated whole: open what now holds, close what demonstrably
 * stopped.
 *
 * No lens, on purpose — see the note at the top of the file.
 */
export async function evaluateProject(db: DbClient, projectId: string): Promise<EvalResult> {
  const rules = await listAlertRules(db, projectId);
  if (rules.length === 0) {
    return { projectId, opened: 0, resolved: 0, unreadable: 0 };
  }

  const metricsByUnit = await rollupAllUnits(db, projectId);

  // The tree, for the same reason the read path builds one: a unit's kind is
  // `properties.kind ?? "org"` and its name falls back through code to a UUID
  // prefix. Re-deriving that here would work today and drift the day either
  // rule changes, and a rule that fires for a viewer but not for the scheduler
  // is the worst shape this bug could take. Thirty milliseconds to have one
  // definition instead of two.
  const { nodes } = await getUnitTree(db, projectId);
  const unitKinds = new Map(nodes.map((n) => [n.id, n.kind]));
  const unitNames = new Map(nodes.map((n) => [n.id, n.name]));

  const firing = await evaluateAlerts(db, projectId, metricsByUnit, unitKinds, unitNames, rules);
  const opened = firing.filter((a) => a.isNew).length;

  const { rows: open } = await db.query<{
    id: string;
    unit_instance_id: string;
    rule_id: string | null;
  }>(
    `SELECT id, unit_instance_id, rule_id
       FROM app.twin_alert
      WHERE project_id = $1 AND status = 'open'`,
    [projectId],
  );

  const stillFiring = new Set(firing.map((a) => a.id));
  const { resolve, unreadable } = alertsToResolve(
    open
      .filter((r) => !stillFiring.has(r.id))
      .map((r) => ({ id: r.id, unitInstanceId: r.unit_instance_id, ruleId: r.rule_id })),
    rules,
    metricsByUnit,
    unitKinds,
  );

  if (resolve.length > 0) {
    await db.query(
      `UPDATE app.twin_alert
          SET status = 'resolved', resolved_at = NOW()
        WHERE id = ANY($1::uuid[]) AND status = 'open'`,
      [resolve],
    );
  }

  return { projectId, opened, resolved: resolve.length, unreadable: unreadable.length };
}

export async function runTwinAlertEvaluation(db: DbClient): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  for (const projectId of await projectsWithAlertRules(db)) {
    // One project's failure must not cost the others their evaluation.
    try {
      out.push(await evaluateProject(db, projectId));
    } catch {
      // Counted by its absence from the result; the caller logs the tick.
    }
  }
  return out;
}

export function startTwinAlertScheduler(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (started || process.env.TWIN_ALERT_SCHEDULER_DISABLED === "1") return;
  started = true;
  log.info({ tickMs: TICK_MS }, "twin alert scheduler started");

  setInterval(() => {
    void (async () => {
      const db = pool as DbClient;
      try {
        const results = await runTwinAlertEvaluation(db);
        if (results.length > BUSY_PROJECTS) {
          log.warn(
            { projects: results.length, limit: BUSY_PROJECTS },
            "twin alert evaluation is walking more projects than a tick was sized for",
          );
        }
        const opened = results.reduce((n, r) => n + r.opened, 0);
        const resolved = results.reduce((n, r) => n + r.resolved, 0);
        const unreadable = results.reduce((n, r) => n + r.unreadable, 0);
        if (opened > 0 || resolved > 0) {
          log.info({ opened, resolved, unreadable }, "twin alerts evaluated");
        }
      } catch (err) {
        log.warn({ err }, "twin alert scheduler tick failed");
      }
    })();
  }, TICK_MS).unref?.();
}
