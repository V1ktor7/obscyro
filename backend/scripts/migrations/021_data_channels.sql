-- ============================================================================
-- Obscyro: data channels (saved linear parse pipelines).
-- Migration 021:
--   * app.data_channel — named, ordered step list per environment
--   * app.data_channel_run — run history + stats per channel
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.data_channel (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    owner_user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    slug             TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'live', 'paused')),
    -- Ordered step list: [{ id, type, enabled, config }]. Step semantics live
    -- in the app layer; the DB only guarantees it is a JSON array.
    steps            JSONB       NOT NULL DEFAULT '[]'::jsonb
                                 CHECK (jsonb_typeof(steps) = 'array'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, slug)
);

CREATE INDEX IF NOT EXISTS data_channel_env_idx
    ON app.data_channel (environment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.data_channel_run (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id     UUID        NOT NULL REFERENCES app.data_channel(id) ON DELETE CASCADE,
    status         TEXT        NOT NULL
                               CHECK (status IN ('succeeded', 'flagged', 'failed')),
    run_trigger    TEXT        NOT NULL DEFAULT 'manual'
                               CHECK (run_trigger IN ('manual', 'webhook', 'source')),
    input_chars    INTEGER     NULL,
    concept_count  INTEGER     NOT NULL DEFAULT 0,
    saved_count    INTEGER     NOT NULL DEFAULT 0,
    flagged_count  INTEGER     NOT NULL DEFAULT 0,
    duration_ms    INTEGER     NULL,
    step_timings   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error          TEXT        NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS data_channel_run_channel_idx
    ON app.data_channel_run (channel_id, created_at DESC);
