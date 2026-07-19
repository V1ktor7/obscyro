-- ============================================================================
-- Obscyro: server-side feed simulator.
-- Migration 025:
--   * app.feed_stream — generator streams that POST synthetic healthcare
--     objects to channel webhooks; run on the API server so they keep
--     feeding while no browser is open, and resume after restarts.
--   * app.feed_stream_send — recent sends per stream (pruned), read by the
--     Data Studio "Feed simulator" node and the UI's send log.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.feed_stream (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    owner_user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'paused'
                                 CHECK (status IN ('running', 'paused')),
    -- Target, template/datasets, rate, rhythm, and realism knobs.
    config           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sent_count       BIGINT      NOT NULL DEFAULT 0,
    failed_count     BIGINT      NOT NULL DEFAULT 0,
    dataset_index    INTEGER     NOT NULL DEFAULT 0,
    surge_until      TIMESTAMPTZ NULL,
    surge_factor     REAL        NOT NULL DEFAULT 1,
    stall_until      TIMESTAMPTZ NULL,
    last_sent_at     TIMESTAMPTZ NULL,
    last_error       TEXT        NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feed_stream_env_idx
    ON app.feed_stream (environment_id, created_at ASC);

CREATE INDEX IF NOT EXISTS feed_stream_status_idx
    ON app.feed_stream (status);

CREATE TABLE IF NOT EXISTS app.feed_stream_send (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id    UUID        NOT NULL REFERENCES app.feed_stream(id) ON DELETE CASCADE,
    payload      JSONB       NOT NULL,
    status_code  INTEGER     NULL,
    note         TEXT        NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feed_stream_send_stream_idx
    ON app.feed_stream_send (stream_id, created_at DESC);
