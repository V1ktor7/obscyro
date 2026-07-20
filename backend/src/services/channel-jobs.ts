import type { Pool } from "pg";

import type { DbClient } from "../lib/db.js";
import {
  executeChannel,
  isRetryableOutcome,
  payloadToInputText,
  recordChannelRun,
  type ChannelStepRow,
} from "./channel-runner.js";

// ---------------------------------------------------------------------------
// Durable channel job queue (app.channel_job).
//
// Webhook/REST intake enqueues one job per live channel inside the request,
// so once the sender gets a 2xx the work cannot be lost. A worker loop in
// the API process claims due jobs with FOR UPDATE SKIP LOCKED (safe with
// multiple instances) and retries transient failures — NLP service down —
// with exponential backoff. Only final outcomes are written to the
// app.data_channel_run history.
// ---------------------------------------------------------------------------

const TICK_MS = 1_000;
const CLAIM_BATCH = 5;
export const MAX_ATTEMPTS = 5;
/** Delay before retry N+1, indexed by the attempt number that just failed. */
const BACKOFF_MS = [30_000, 120_000, 480_000, 1_800_000];
const STALE_RUNNING_MS = 10 * 60_000;
const CLEANUP_EVERY_TICKS = 3_600; // ~hourly
const TERMINAL_KEEP_DAYS = 7;

/** Milliseconds to wait before the next attempt, given the attempt that just failed (1-based). */
export function backoffMs(failedAttempt: number): number {
  const idx = Math.min(Math.max(failedAttempt - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx]!;
}

/**
 * Enqueue one job per live channel bound to `sourceId`. Runs on the caller's
 * DB client so it joins the webhook request's connection; the insert is the
 * durability point. Returns the number of jobs created.
 */
export async function enqueueChannelJobs(
  db: DbClient,
  sourceId: string,
  payload: unknown,
  trigger: "webhook" | "source",
  eventId: string | null,
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.channel_job (channel_id, event_id, payload, run_trigger)
     SELECT c.id, $2, $3::jsonb, $4
       FROM app.data_channel c
      WHERE c.source_id = $1 AND c.status = 'live'
     RETURNING id`,
    [sourceId, eventId, JSON.stringify(payload ?? null), trigger],
  );
  return rows.length;
}

interface ClaimedJob {
  id: string;
  channel_id: string;
  payload: unknown;
  run_trigger: "webhook" | "source";
  attempts: number;
}

async function processJob(db: DbClient, job: ClaimedJob): Promise<void> {
  const channelRes = await db.query<{
    id: string;
    environment_id: string;
    status: "draft" | "live" | "paused";
    steps: unknown;
  }>(
    `SELECT id, environment_id, status, steps
       FROM app.data_channel
      WHERE id = $1`,
    [job.channel_id],
  );
  const channel = channelRes.rows[0];

  if (!channel || channel.status !== "live") {
    await db.query(
      `UPDATE app.channel_job
          SET status = 'failed', last_error = $2, locked_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [job.id, channel ? "Channel is no longer live." : "Channel was deleted."],
    );
    return;
  }

  const inputText = payloadToInputText(job.payload);
  const outcome = await executeChannel(
    db,
    {
      id: channel.id,
      environmentId: channel.environment_id,
      status: channel.status,
      steps: (channel.steps as ChannelStepRow[]) ?? [],
    },
    inputText,
  );

  if (isRetryableOutcome(outcome) && job.attempts < MAX_ATTEMPTS) {
    // Transient dependency failure — requeue without polluting run history.
    await db.query(
      `UPDATE app.channel_job
          SET status = 'queued',
              run_after = NOW() + ($2 || ' milliseconds')::interval,
              last_error = $3,
              locked_at = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [job.id, String(backoffMs(job.attempts)), outcome.error],
    );
    return;
  }

  await recordChannelRun(db, channel.id, job.run_trigger, inputText.length, outcome);
  await db.query(
    `UPDATE app.channel_job
        SET status = $2, last_error = $3, locked_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [job.id, outcome.status === "failed" ? "failed" : "succeeded", outcome.error],
  );
}

let workerStarted = false;

/** Start the channel job worker. Call once after the server begins listening. */
export function startChannelJobWorker(
  pool: Pool,
  log: { info: (msg: string) => void; error: (obj: unknown, msg?: string) => void },
): void {
  if (workerStarted) return;
  if (process.env.CHANNEL_WORKER_DISABLED === "1") {
    log.info("channel-job worker disabled (CHANNEL_WORKER_DISABLED=1)");
    return;
  }
  workerStarted = true;
  log.info("channel-job worker started");

  const db: DbClient = { query: (sql, params) => pool.query(sql, params) };
  let ticking = false;
  let tickCount = 0;

  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      try {
        tickCount += 1;

        // Crash recovery: requeue jobs whose worker died mid-run.
        await db.query(
          `UPDATE app.channel_job
              SET status = 'queued', locked_at = NULL, updated_at = NOW()
            WHERE status = 'running'
              AND locked_at < NOW() - INTERVAL '${STALE_RUNNING_MS} milliseconds'`,
        );

        const { rows: jobs } = await db.query<ClaimedJob>(
          `UPDATE app.channel_job j
              SET status = 'running', locked_at = NOW(),
                  attempts = attempts + 1, updated_at = NOW()
            WHERE j.id IN (
              SELECT id FROM app.channel_job
               WHERE status = 'queued' AND run_after <= NOW()
               ORDER BY created_at
                 FOR UPDATE SKIP LOCKED
               LIMIT ${CLAIM_BATCH})
            RETURNING j.id, j.channel_id, j.payload, j.run_trigger, j.attempts`,
        );

        for (const job of jobs) {
          try {
            await processJob(db, job);
          } catch (err) {
            log.error(err, `channel-job ${job.id} processing failed`);
            await db
              .query(
                `UPDATE app.channel_job
                    SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
                        run_after = NOW() + ($2 || ' milliseconds')::interval,
                        last_error = $3,
                        locked_at = NULL,
                        updated_at = NOW()
                  WHERE id = $1`,
                [job.id, String(backoffMs(job.attempts)), (err as Error).message],
              )
              .catch(() => undefined);
          }
        }

        if (tickCount % CLEANUP_EVERY_TICKS === 0) {
          await db.query(
            `DELETE FROM app.channel_job
              WHERE status IN ('succeeded', 'failed')
                AND updated_at < NOW() - INTERVAL '${TERMINAL_KEEP_DAYS} days'`,
          );
        }
      } catch (err) {
        log.error(err, "channel-job worker tick failed");
      } finally {
        ticking = false;
      }
    })();
  }, TICK_MS);
}
