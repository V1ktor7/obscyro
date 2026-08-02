import type { DbClient } from "../lib/db.js";

import { raiseSignal } from "./signals.js";

// ---------------------------------------------------------------------------
// The bridge from twin alerts to signals.
//
// twin_alert already fires on real rules and stops there. The signal engine can
// carry a follow-up and had nothing feeding it. This joins them.
//
// A scheduler rather than a hook inside evaluateAlerts, for the same reason the
// pipeline scheduler is one: evaluateAlerts runs inside getTwinTreeSnapshot,
// which the SSE calls every five seconds *per connected viewer*. Raising
// signals there would put writes in a read path and have two open browsers race
// each other.
// ---------------------------------------------------------------------------

const TICK_MS = 15_000;
const BATCH = 25;
let started = false;

export interface BridgeResult {
  raised: number;
  cleared: number;
}

/**
 * Open alerts whose metric a signal type claims, and that have not produced a
 * signal yet. The NOT EXISTS is the whole dedupe: one signal per alert, ever.
 */
export async function raiseSignalsForOpenAlerts(
  db: DbClient,
  limit = BATCH,
): Promise<number> {
  const { rows } = await db.query<{
    alert_id: string;
    project_id: string;
    unit_instance_id: string;
    signal_type_id: string;
    severity: "info" | "warn" | "critical";
    metric: string;
    value: string;
    message: string;
    recommendation: string;
    unit_name: string | null;
  }>(
    `SELECT a.id AS alert_id, a.project_id, a.unit_instance_id,
            st.id AS signal_type_id, a.severity, a.metric, a.value::text AS value,
            a.message, a.recommendation,
            oi.properties ->> 'name' AS unit_name
       FROM app.twin_alert a
       JOIN app.project p ON p.id = a.project_id
       JOIN app.signal_type st
         ON st.organization_id = p.organization_id
        AND st.alert_metric = a.metric
        AND st.active
       LEFT JOIN app.ontology_object_instances oi ON oi.id = a.unit_instance_id
      WHERE a.status = 'open'
        AND NOT EXISTS (
              SELECT 1 FROM app.signal s
               WHERE s.origin_kind = 'twin_alert' AND s.origin_id = a.id)
      ORDER BY a.created_at ASC
      LIMIT $1`,
    [limit],
  );

  let raised = 0;
  for (const r of rows) {
    try {
      const where = r.unit_name ? ` · ${r.unit_name}` : "";
      await raiseSignal(db, {
        projectId: r.project_id,
        signalTypeId: r.signal_type_id,
        title: `${r.message}${where}`,
        detail: r.recommendation || null,
        // The alert's own severity wins over the type's default: the same
        // metric at 80% and at 95% are not the same problem.
        severity: r.severity,
        subjectKind: "object_instance",
        subjectId: r.unit_instance_id,
        properties: { metric: r.metric, value: Number(r.value) },
        originKind: "twin_alert",
        originId: r.alert_id,
        actorUserId: null,
      });
      raised++;
    } catch {
      // One bad alert must not stop the batch — the next tick retries it.
    }
  }
  return raised;
}

/**
 * Note on signals whose alert has stopped firing.
 *
 * Deliberately not an auto-close. A condition that cleared on its own is
 * exactly the case worth distinguishing from one somebody fixed, and closing it
 * silently erases that. The reviewer gets told and decides.
 */
export async function noteClearedAlerts(db: DbClient, limit = BATCH): Promise<number> {
  const { rows } = await db.query<{ signal_id: string; next: number }>(
    `SELECT s.id AS signal_id,
            COALESCE((SELECT MAX(e.seq) FROM app.signal_event e WHERE e.signal_id = s.id), 0) + 1
              AS next
       FROM app.signal s
       JOIN app.twin_alert a ON a.id = s.origin_id
      WHERE s.origin_kind = 'twin_alert'
        AND s.closed_at IS NULL
        AND a.status <> 'open'
        AND NOT EXISTS (
              SELECT 1 FROM app.signal_event e
               WHERE e.signal_id = s.id
                 AND e.kind = 'noted'
                 AND e.payload ->> 'reason' = 'alert_cleared')
      LIMIT $1`,
    [limit],
  );

  for (const r of rows) {
    await db
      .query(
        `INSERT INTO app.signal_event (signal_id, seq, kind, note, payload)
         VALUES ($1, $2, 'noted', $3, $4::jsonb)`,
        [
          r.signal_id,
          r.next,
          "La condition qui a levé ce signal ne se déclenche plus. À confirmer avant de clore.",
          JSON.stringify({ reason: "alert_cleared" }),
        ],
      )
      .catch(() => undefined);
  }
  return rows.length;
}

export async function runAlertBridge(db: DbClient): Promise<BridgeResult> {
  return {
    raised: await raiseSignalsForOpenAlerts(db),
    cleared: await noteClearedAlerts(db),
  };
}

export function startAlertBridge(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (started || process.env.ALERT_BRIDGE_DISABLED === "1") return;
  started = true;
  log.info({ tickMs: TICK_MS }, "alert→signal bridge started");

  setInterval(() => {
    void (async () => {
      try {
        const r = await runAlertBridge(pool as DbClient);
        if (r.raised > 0 || r.cleared > 0) log.info(r, "alert bridge");
      } catch (err) {
        log.warn({ err }, "alert bridge tick failed");
      }
    })();
  }, TICK_MS).unref?.();
}
