-- ============================================================================
-- Obscyro: durable channel job queue.
-- Migration 026:
--   * app.channel_job — one row per (ingest event × live channel) execution.
--     Webhook handlers enqueue inside the request transaction; a worker loop
--     claims due jobs with FOR UPDATE SKIP LOCKED and retries transient
--     failures (e.g. NLP service down) with exponential backoff.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.channel_job (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id    UUID        NOT NULL REFERENCES app.data_channel(id) ON DELETE CASCADE,
    event_id      UUID        NULL REFERENCES app.ingest_events(id) ON DELETE SET NULL,
    -- Payload snapshot: processing must not depend on the event row surviving.
    payload       JSONB       NOT NULL,
    run_trigger   TEXT        NOT NULL DEFAULT 'webhook'
                              CHECK (run_trigger IN ('webhook', 'source')),
    -- 'failed' is terminal: retries exhausted or permanent error.
    status        TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    attempts      INTEGER     NOT NULL DEFAULT 0,
    run_after     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at     TIMESTAMPTZ NULL,
    last_error    TEXT        NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channel_job_due_idx
    ON app.channel_job (status, run_after);

CREATE INDEX IF NOT EXISTS channel_job_channel_idx
    ON app.channel_job (channel_id, created_at DESC);
