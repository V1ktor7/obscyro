-- ============================================================================
-- Obscyro: scenario-based outbreak simulations (read-only over ontology)
-- Migration 014: scenario, scenario_override, simulation_run
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.scenario (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    params           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    owner_user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, name)
);

CREATE INDEX IF NOT EXISTS scenario_env_idx ON app.scenario (environment_id);

CREATE TABLE IF NOT EXISTS app.scenario_override (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id  UUID        NOT NULL REFERENCES app.scenario(id) ON DELETE CASCADE,
    target_type  TEXT        NOT NULL,
    target_id    UUID        NULL,
    op           TEXT        NOT NULL,
    payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scenario_override_scenario_idx
    ON app.scenario_override (scenario_id);

CREATE TABLE IF NOT EXISTS app.simulation_run (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id   UUID        NOT NULL REFERENCES app.scenario(id) ON DELETE CASCADE,
    status        TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'completed', 'failed')),
    seed          BIGINT      NOT NULL,
    params        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    runs          INT         NOT NULL DEFAULT 1,
    summary       JSONB       NULL,
    trajectories  JSONB       NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS simulation_run_scenario_idx
    ON app.simulation_run (scenario_id, created_at DESC);
