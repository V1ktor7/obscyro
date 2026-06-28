-- ============================================================================
-- Obscyro: data-quality rules and flags (never mutates instance properties)
-- Migration 016: data_quality_rule, data_quality_flag
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.data_quality_rule (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    target_type      TEXT        NULL,
    key              TEXT        NULL,
    kind             TEXT        NOT NULL,
    spec             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    owner_user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS data_quality_rule_env_idx
    ON app.data_quality_rule (environment_id);

CREATE TABLE IF NOT EXISTS app.data_quality_flag (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    instance_id      UUID        NOT NULL REFERENCES app.ontology_object_instances(id) ON DELETE CASCADE,
    layer            SMALLINT    NOT NULL CHECK (layer BETWEEN 1 AND 6),
    severity         TEXT        NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
    code             TEXT        NOT NULL,
    message          TEXT        NOT NULL,
    observed_value   TEXT        NULL,
    status           TEXT        NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open', 'reviewed', 'dismissed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS data_quality_flag_env_status_idx
    ON app.data_quality_flag (environment_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS data_quality_flag_open_unique_idx
    ON app.data_quality_flag (instance_id, layer, code)
    WHERE status = 'open';
