import type { DbClient } from "../lib/db.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { addReference, appendToStream, loadTableVersion } from "./datasets.js";
import { fetchRecords, type RestConfig } from "./rest-connector.js";

// ---------------------------------------------------------------------------
// Data connectivity: Source → Sync → Dataset.
//
// A Source is a connection (where, with what credentials). A Sync is the
// operation (what, how often, snapshot | incremental | stream). Splitting them
// is what makes "one source feeding two datasets" and "poll every 5 minutes
// incrementally" expressible at all — the channel could do neither.
//
// Every sync run records a lineage edge, so the graph is a by-product of
// normal use rather than something crawled for later.
// ---------------------------------------------------------------------------

export type ConnectorKind =
  | "webhook"
  | "rest"
  | "file_upload"
  | "http_poll"
  | "postgres"
  | "hl7v2";

export type SyncMode = "stream" | "snapshot" | "incremental";

export interface ConnectorMeta {
  kind: ConnectorKind;
  label: string;
  /** push = the source calls us; pull = we call the source on a schedule. */
  direction: "push" | "pull";
  /** Sync modes this connector can drive. */
  modes: SyncMode[];
  description: string;
  /** false = the shape is defined but execution is not implemented yet. */
  implemented: boolean;
  /** Still runs for existing sources, but not offered for new ones. */
  deprecated?: boolean;
}

/**
 * The connector catalogue. Deliberately short: five good connectors beat forty
 * broken ones, and each one here is either working or honestly marked as not.
 */
export const CONNECTORS: ConnectorMeta[] = [
  {
    kind: "webhook",
    label: "Webhook",
    direction: "push",
    modes: ["stream"],
    description: "An external system POSTs records to a generated URL.",
    implemented: true,
  },
  {
    kind: "file_upload",
    label: "File upload",
    direction: "push",
    modes: ["snapshot"],
    description: "CSV or Excel uploaded through the interface, versioned on load.",
    implemented: true,
  },
  {
    kind: "rest",
    label: "REST / HTTP API",
    direction: "pull",
    modes: ["snapshot", "incremental"],
    description:
      "Call any JSON or CSV endpoint on a schedule. Method, query, headers, auth, " +
      "the path to the record array, and pagination are all configurable.",
    implemented: true,
  },
  {
    kind: "http_poll",
    label: "HTTP endpoint (simple)",
    direction: "pull",
    modes: ["snapshot", "incremental"],
    description: "Plain GET of a JSON endpoint. Superseded by REST / HTTP API.",
    implemented: true,
    deprecated: true,
  },
  {
    kind: "postgres",
    label: "PostgreSQL",
    direction: "pull",
    modes: ["snapshot", "incremental"],
    description: "Query a database on a schedule.",
    implemented: false,
  },
  {
    kind: "hl7v2",
    label: "HL7 v2",
    direction: "push",
    modes: ["stream"],
    description: "ADT, ORU and ORM messages over MLLP or file drop.",
    implemented: false,
  },
];

export interface SyncRow {
  id: string;
  projectId: string;
  sourceId: string;
  datasetId: string;
  name: string;
  mode: SyncMode;
  intervalSeconds: number | null;
  incrementalColumn: string | null;
  watermark: string | null;
  status: string;
  lastRunAt: string | null;
  lastError: string | null;
}

interface SyncDbRow {
  id: string;
  project_id: string;
  source_id: string;
  dataset_id: string;
  name: string;
  mode: SyncMode;
  interval_seconds: number | null;
  incremental_column: string | null;
  watermark: string | null;
  status: string;
  last_run_at: Date | null;
  last_error: string | null;
}

function out(r: SyncDbRow): SyncRow {
  return {
    id: r.id,
    projectId: r.project_id,
    sourceId: r.source_id,
    datasetId: r.dataset_id,
    name: r.name,
    mode: r.mode,
    intervalSeconds: r.interval_seconds,
    incrementalColumn: r.incremental_column,
    watermark: r.watermark,
    status: r.status,
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
    lastError: r.last_error,
  };
}

const SYNC_SELECT = `
  SELECT id, project_id, source_id, dataset_id, name, mode, interval_seconds,
         incremental_column, watermark, status, last_run_at, last_error
    FROM app.sync`;

export async function listSyncs(db: DbClient, projectId: string): Promise<SyncRow[]> {
  const { rows } = await db.query<SyncDbRow>(
    `${SYNC_SELECT} WHERE project_id = $1 ORDER BY created_at ASC`,
    [projectId],
  );
  return rows.map(out);
}

export async function getSync(db: DbClient, id: string): Promise<SyncRow> {
  const { rows } = await db.query<SyncDbRow>(`${SYNC_SELECT} WHERE id = $1`, [id]);
  if (!rows[0]) throw NotFound("SYNC_NOT_FOUND", "Sync not found.");
  return out(rows[0]);
}

/**
 * Create a sync. The dataset kind and the sync mode must agree: a streaming
 * sync appends forever and needs a stream dataset, a snapshot sync replaces
 * and needs a versioned table.
 */
export async function createSync(
  db: DbClient,
  input: {
    projectId: string;
    sourceId: string;
    datasetId: string;
    name: string;
    mode: SyncMode;
    intervalSeconds?: number | null;
    incrementalColumn?: string | null;
    createdBy?: string | null;
  },
): Promise<SyncRow> {
  const ds = await db.query<{ kind: string }>(
    `SELECT kind FROM app.dataset WHERE id = $1`,
    [input.datasetId],
  );
  const kind = ds.rows[0]?.kind;
  if (!kind) throw NotFound("DATASET_NOT_FOUND", "Dataset not found.");
  if (input.mode === "stream" && kind !== "stream") {
    throw BadRequest(
      "MODE_DATASET_MISMATCH",
      "A streaming sync appends continuously and needs a stream dataset.",
    );
  }
  if (input.mode !== "stream" && kind !== "table") {
    throw BadRequest(
      "MODE_DATASET_MISMATCH",
      "A snapshot or incremental sync writes versions and needs a table dataset.",
    );
  }

  const { rows } = await db.query<SyncDbRow>(
    `INSERT INTO app.sync (project_id, source_id, dataset_id, name, mode,
                           interval_seconds, incremental_column, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, project_id, source_id, dataset_id, name, mode, interval_seconds,
               incremental_column, watermark, status, last_run_at, last_error`,
    [
      input.projectId,
      input.sourceId,
      input.datasetId,
      input.name,
      input.mode,
      input.intervalSeconds ?? null,
      input.incrementalColumn ?? null,
      input.createdBy ?? null,
    ],
  );

  // The lineage edges for this hop, recorded once at configuration time.
  await addReference(db, {
    fromType: "source",
    fromId: input.sourceId,
    toType: "dataset",
    toId: input.datasetId,
    kind: "writes",
  });

  return out(rows[0]!);
}

export interface SyncOutcome {
  rowsRead: number;
  rowsWritten: number;
  error: string | null;
}

/** Record a sync run and update the sync's own status. Never throws. */
export async function recordSyncRun(
  db: DbClient,
  syncId: string,
  outcome: SyncOutcome,
): Promise<void> {
  await db
    .query(
      `INSERT INTO app.sync_run (sync_id, status, rows_read, rows_written, error, finished_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        syncId,
        outcome.error ? "failed" : "succeeded",
        outcome.rowsRead,
        outcome.rowsWritten,
        outcome.error,
      ],
    )
    .catch(() => undefined);
  await db
    .query(
      // Cast the parameter. Without it Postgres cannot type $2 — it appears in
      // "$2 IS NULL" inside a CASE, where nothing constrains it — and the whole
      // statement fails with "could not determine data type of parameter $2".
      //
      // That failure was swallowed, and it was not cosmetic: last_run_at stayed
      // null, the scheduler reads "(last_run_at IS NULL OR ...)" as due, and an
      // hourly sync called the source every thirty seconds instead. A failing
      // sync was never marked in error either.
      `UPDATE app.sync
          SET last_run_at = now(), last_error = $2::text,
              status = CASE WHEN $2::text IS NULL THEN 'active' ELSE 'error' END,
              updated_at = now()
        WHERE id = $1`,
      [syncId, outcome.error],
    )
    .catch(() => undefined);
}

/**
 * Land records arriving from a push source (webhook, HL7) into every stream
 * sync configured on it. A source may feed several datasets; each gets the
 * same payload.
 */
export async function ingestPush(
  db: DbClient,
  sourceId: string,
  records: Record<string, unknown>[],
): Promise<{ syncs: number; rowsWritten: number }> {
  const { rows: syncs } = await db.query<SyncDbRow>(
    `${SYNC_SELECT} WHERE source_id = $1 AND mode = 'stream' AND status = 'active'`,
    [sourceId],
  );
  let rowsWritten = 0;
  for (const s of syncs) {
    try {
      const { appended } = await appendToStream(db, s.dataset_id, records);
      rowsWritten += appended;
      await recordSyncRun(db, s.id, {
        rowsRead: records.length,
        rowsWritten: appended,
        error: null,
      });
    } catch (err) {
      await recordSyncRun(db, s.id, {
        rowsRead: records.length,
        rowsWritten: 0,
        error: (err as Error).message,
      });
    }
  }
  return { syncs: syncs.length, rowsWritten };
}

/** Connectors runPullSync knows how to call. */
const PULLABLE = new Set<string>(["rest", "http_poll"]);

/**
 * Run one pull sync. Snapshot replaces the dataset with a new version;
 * incremental keeps only rows past the watermark and advances it.
 *
 * The HTTP work — auth, record path, flattening, pagination, SSRF refusal —
 * lives in rest-connector so both connector kinds behave identically and the
 * pipeline can reuse the same reader later.
 */
export async function runPullSync(db: DbClient, syncId: string): Promise<SyncOutcome> {
  const sync = await getSync(db, syncId);
  const { rows: srcRows } = await db.query<{
    type: string;
    connector_config: Record<string, unknown>;
  }>(`SELECT type, connector_config FROM app.ingest_sources WHERE id = $1`, [sync.sourceId]);
  const src = srcRows[0];
  if (!src) return { rowsRead: 0, rowsWritten: 0, error: "Source not found." };
  if (!PULLABLE.has(src.type)) {
    return { rowsRead: 0, rowsWritten: 0, error: `Connector "${src.type}" cannot be pulled.` };
  }

  const cfg = src.connector_config as unknown as RestConfig;
  const url = String(cfg?.url ?? "").trim();
  if (!url) return { rowsRead: 0, rowsWritten: 0, error: "Source has no URL configured." };

  try {
    const { records: fetched, truncated } = await fetchRecords({ ...cfg, url });
    let records = fetched;
    const rowsRead = records.length;

    let nextWatermark = sync.watermark;
    if (sync.mode === "incremental" && sync.incrementalColumn) {
      const col = sync.incrementalColumn;
      if (sync.watermark) {
        records = records.filter((r) => String(r[col] ?? "") > sync.watermark!);
      }
      for (const r of records) {
        const v = String(r[col] ?? "");
        if (v && (!nextWatermark || v > nextWatermark)) nextWatermark = v;
      }
    }

    if (records.length > 0) {
      await loadTableVersion(db, sync.datasetId, records, {
        note: `${sync.mode} sync from ${url}`,
      });
    }
    if (nextWatermark && nextWatermark !== sync.watermark) {
      await db.query(`UPDATE app.sync SET watermark = $2 WHERE id = $1`, [
        syncId,
        nextWatermark,
      ]);
    }
    // Truncation is reported, not swallowed: a silently short read looks
    // exactly like a source that had less data.
    const outcome = {
      rowsRead,
      rowsWritten: records.length,
      error: truncated ? "Row or page cap reached — this run may be incomplete." : null,
    };
    await recordSyncRun(db, syncId, outcome);
    return outcome;
  } catch (err) {
    const outcome = { rowsRead: 0, rowsWritten: 0, error: (err as Error).message };
    await recordSyncRun(db, syncId, outcome);
    return outcome;
  }
}

// ---------------------------------------------------------------------------
// Pull scheduler
// ---------------------------------------------------------------------------

const TICK_MS = 30_000;
let started = false;

/**
 * Run due pull syncs. Ticks slowly and takes a small batch, because a pull
 * sync hits an external system — being late is cheaper than hammering it.
 * Set SYNC_SCHEDULER_DISABLED=1 to turn it off.
 */
export function startSyncScheduler(
  pool: { query: DbClient["query"] },
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): void {
  if (started || process.env.SYNC_SCHEDULER_DISABLED === "1") return;
  started = true;
  log.info({ tickMs: TICK_MS }, "sync scheduler started");

  setInterval(() => {
    void (async () => {
      try {
        const { rows } = await (pool as DbClient).query<{ id: string }>(
          // Due is decided against the run log as well as the column. The
          // column is a denormalised convenience and one swallowed error left
          // it null through four successful runs — which reads as "never ran"
          // and turns an hourly sync into one that fires every tick. The log
          // cannot lie about that: a row is written before the column is
          // touched, so the second test holds even when the first is stale.
          `SELECT s.id FROM app.sync s
            WHERE s.mode <> 'stream'
              AND s.status = 'active'
              AND s.interval_seconds IS NOT NULL
              AND (s.last_run_at IS NULL
                   OR s.last_run_at < now() - make_interval(secs => s.interval_seconds))
              AND NOT EXISTS (
                SELECT 1 FROM app.sync_run r
                 WHERE r.sync_id = s.id
                   AND r.started_at > now() - make_interval(secs => s.interval_seconds)
              )
            ORDER BY s.last_run_at ASC NULLS FIRST
            LIMIT 5`,
        );
        for (const r of rows) {
          await runPullSync(pool as DbClient, r.id);
        }
      } catch (err) {
        log.warn({ err }, "sync scheduler tick failed");
      }
    })();
  }, TICK_MS).unref?.();
}
