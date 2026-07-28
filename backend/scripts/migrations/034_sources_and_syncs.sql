-- ============================================================================
-- Data connectivity: Source and Sync, per Foundry's model
--   Source → Sync → Dataset → (pipeline) → Ontology
--
-- A Source is a connection: which system, which credentials, which parameters.
-- A Sync is the operation: what to pull, how often, snapshot or incremental or
-- streaming, with its own run history. One source can feed many syncs.
--
-- The channel conflated the two, which is why it could not express "poll this
-- every 5 minutes incrementally" or "the same source feeding two datasets".
-- Channels keep running untouched; this path is built alongside them.
-- ============================================================================

-- --- 1. Source: connector kinds --------------------------------------------
-- 'rest' and 'webhook' predate this and are retained so existing rows stay
-- valid; 'webhook' is the push listener, the rest are pull connectors.

ALTER TABLE app.ingest_sources
    DROP CONSTRAINT IF EXISTS ingest_sources_type_check;

ALTER TABLE app.ingest_sources
    ADD CONSTRAINT ingest_sources_type_check
    CHECK (type IN (
        'webhook',      -- push: an external system POSTs to us
        'rest',         -- legacy alias of webhook
        'file_upload',  -- push: CSV/Excel uploaded through the UI
        'http_poll',    -- pull: periodic GET of a JSON/CSV endpoint
        'postgres',     -- pull: query a database
        'hl7v2'         -- push: MLLP / file drop, the healthcare workhorse
    ));

ALTER TABLE app.ingest_sources
    -- Connector-specific settings: url, method, headers, query, table name.
    -- Secrets are referenced by name, never stored inline.
    ADD COLUMN IF NOT EXISTS connector_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'error')),
    ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

-- --- 2. Sync: the operation that moves data into a dataset -----------------

CREATE TABLE IF NOT EXISTS app.sync (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID        NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    source_id     UUID        NOT NULL REFERENCES app.ingest_sources(id) ON DELETE CASCADE,
    -- Where rows land. A stream source needs a stream dataset; a snapshot sync
    -- needs a table dataset. Enforced in the service, not here, so a misconfig
    -- surfaces as a readable error rather than a constraint violation.
    dataset_id    UUID        NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    mode          TEXT        NOT NULL DEFAULT 'stream'
                              CHECK (mode IN ('stream', 'snapshot', 'incremental')),
    -- Interval in seconds for pull connectors; NULL for push (stream) syncs,
    -- which are triggered by arrival rather than a clock.
    interval_seconds INT,
    -- Incremental mode: the column carrying the watermark, and the highest
    -- value seen so far, so the next run resumes rather than re-reads.
    incremental_column TEXT,
    watermark     TEXT,
    status        TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'paused', 'error')),
    last_run_at   TIMESTAMPTZ,
    last_error    TEXT,
    created_by    UUID        REFERENCES app.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_project_idx ON app.sync (project_id);
CREATE INDEX IF NOT EXISTS sync_source_idx  ON app.sync (source_id);
CREATE INDEX IF NOT EXISTS sync_due_idx     ON app.sync (status, last_run_at)
    WHERE mode <> 'stream';

-- --- 3. Sync run history ---------------------------------------------------
-- Row counts per run are what make a stalled or shrinking feed visible.

CREATE TABLE IF NOT EXISTS app.sync_run (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_id      UUID        NOT NULL REFERENCES app.sync(id) ON DELETE CASCADE,
    status       TEXT        NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running', 'succeeded', 'failed')),
    rows_read    BIGINT      NOT NULL DEFAULT 0,
    rows_written BIGINT      NOT NULL DEFAULT 0,
    error        TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sync_run_sync_time_idx
    ON app.sync_run (sync_id, started_at DESC);
