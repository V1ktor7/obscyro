-- ============================================================================
-- Obscyro: causal simulation lab.
-- Migration 022:
--   * app.causality_edge — auto-discovered lagged influences between signals
--   * simulation_model.spec — inline model definition + trained coefficients
--     (target signal, feature signals with lags, horizon, ridge weights)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.causality_edge (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id  UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    from_signal     TEXT        NOT NULL,
    to_signal       TEXT        NOT NULL,
    lag_hours       INTEGER     NOT NULL,
    strength        REAL        NOT NULL,
    confidence      REAL        NOT NULL,
    sample_count    INTEGER     NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, from_signal, to_signal)
);

CREATE INDEX IF NOT EXISTS causality_edge_env_to_idx
    ON app.causality_edge (environment_id, to_signal, strength DESC);

ALTER TABLE app.simulation_model
    ADD COLUMN IF NOT EXISTS spec JSONB NOT NULL DEFAULT '{}'::jsonb;
