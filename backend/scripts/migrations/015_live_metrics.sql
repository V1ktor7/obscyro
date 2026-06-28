-- ============================================================================
-- Obscyro: live metric definitions (computed on-read in v1)
-- Migration 015: metric_definition
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.metric_definition (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    kind             TEXT        NOT NULL CHECK (kind IN ('aggregate', 'score')),
    spec             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    owner_user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, name)
);

CREATE INDEX IF NOT EXISTS metric_definition_env_idx
    ON app.metric_definition (environment_id);
