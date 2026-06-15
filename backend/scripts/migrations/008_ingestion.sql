-- ============================================================================
-- Obscyro: data intake (REST + webhook)
-- Migration 008: ingest_sources, ingest_events
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.ingest_sources (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,
    type           TEXT        NOT NULL CHECK (type IN ('rest', 'webhook')),
    webhook_token  TEXT        UNIQUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ingest_sources_user_idx
    ON app.ingest_sources (user_id);

CREATE TABLE IF NOT EXISTS app.ingest_events (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id      UUID        REFERENCES app.ingest_sources(id) ON DELETE SET NULL,
    user_id        UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    payload        JSONB       NOT NULL,
    content_type   TEXT        NOT NULL DEFAULT 'application/json',
    status         TEXT        NOT NULL DEFAULT 'received'
                                CHECK (status IN ('received', 'processed', 'failed')),
    received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ingest_events_user_time_idx
    ON app.ingest_events (user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS ingest_events_source_idx
    ON app.ingest_events (source_id, received_at DESC);
