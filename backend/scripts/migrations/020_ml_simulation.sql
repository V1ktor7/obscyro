-- ============================================================================
-- Obscyro: ML-based simulation (ontology-bound, scenario-branched, hybrid).
-- Migration 020:
--   * predicted properties + provenance on scenario branch instances
--   * ML columns on simulation_run (engine, model, quantiles, baseline, error)
--   * simulation_model registry + simulation_training_run ops log
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Predicted properties on the scenario branch. Kept separate from the cloned
--    (observed) `properties` so the UI/queries can distinguish model output from
--    source data. prediction_provenance carries { model_id, version, run_id, seed }.
-- ----------------------------------------------------------------------------
ALTER TABLE app.scenario_instance
    ADD COLUMN IF NOT EXISTS predicted_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS prediction_provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. simulation_run: ML metadata. All nullable / defaulted so the existing
--    mechanistic /run path keeps working unchanged.
-- ----------------------------------------------------------------------------
ALTER TABLE app.simulation_run
    ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'mechanistic'
        CHECK (engine IN ('mechanistic', 'ml')),
    ADD COLUMN IF NOT EXISTS model_id UUID NULL,
    ADD COLUMN IF NOT EXISTS model_version TEXT NULL,
    ADD COLUMN IF NOT EXISTS graph_spec JSONB NULL,
    ADD COLUMN IF NOT EXISTS quantiles JSONB NULL,
    ADD COLUMN IF NOT EXISTS baseline JSONB NULL,
    ADD COLUMN IF NOT EXISTS ml_baseline_error JSONB NULL,
    ADD COLUMN IF NOT EXISTS feature_importances JSONB NULL;

-- ----------------------------------------------------------------------------
-- 3. Model registry: versioned models bound to (optionally) an environment.
--    artifact_uri points at the on-disk weights the simulation-service loads.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.simulation_model (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id   UUID        NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    model_type       TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    version          TEXT        NOT NULL,
    dataset_version  TEXT        NULL,
    status           TEXT        NOT NULL DEFAULT 'registered'
                                 CHECK (status IN ('registered', 'training', 'ready', 'failed')),
    metrics          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    artifact_uri     TEXT        NULL,
    owner_user_id    UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    is_active        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, name, version)
);

CREATE INDEX IF NOT EXISTS simulation_model_env_idx
    ON app.simulation_model (environment_id, created_at DESC);

-- At most one active model per (environment, name).
CREATE UNIQUE INDEX IF NOT EXISTS simulation_model_active_idx
    ON app.simulation_model (environment_id, name)
    WHERE is_active;

-- Loose FK from runs to the registry (nullable; SET NULL on model delete).
ALTER TABLE app.simulation_run
    ADD CONSTRAINT simulation_run_model_fk
    FOREIGN KEY (model_id) REFERENCES app.simulation_model(id) ON DELETE SET NULL
    NOT VALID;

-- ----------------------------------------------------------------------------
-- 4. Training run ops log (metrics, dataset kind, seed for reproducibility).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.simulation_training_run (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id         UUID        NOT NULL REFERENCES app.simulation_model(id) ON DELETE CASCADE,
    environment_id   UUID        NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    status           TEXT        NOT NULL DEFAULT 'running'
                                 CHECK (status IN ('running', 'completed', 'failed')),
    dataset_kind     TEXT        NOT NULL DEFAULT 'synthetic'
                                 CHECK (dataset_kind IN ('synthetic', 'history')),
    metrics          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    seed             BIGINT      NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS simulation_training_run_model_idx
    ON app.simulation_training_run (model_id, created_at DESC);
