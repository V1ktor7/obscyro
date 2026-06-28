-- ============================================================================
-- Obscyro: twin-clone scenario copies (extends gen-1 scenario tables from 014)
-- Migration 018: scenario_instance, scenario_link, column alters
-- ============================================================================

ALTER TABLE app.scenario
    ADD COLUMN IF NOT EXISTS root_unit_instance_id UUID NULL
        REFERENCES app.ontology_object_instances(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app.scenario_instance (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id         UUID        NOT NULL REFERENCES app.scenario(id) ON DELETE CASCADE,
    source_instance_id  UUID        NULL,
    object_type_name    TEXT        NOT NULL,
    properties          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scenario_instance_scenario_idx
    ON app.scenario_instance (scenario_id);

CREATE TABLE IF NOT EXISTS app.scenario_link (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id     UUID        NOT NULL REFERENCES app.scenario(id) ON DELETE CASCADE,
    link_type_name  TEXT        NOT NULL,
    from_id         UUID        NOT NULL REFERENCES app.scenario_instance(id) ON DELETE CASCADE,
    to_id           UUID        NOT NULL REFERENCES app.scenario_instance(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scenario_link_scenario_idx
    ON app.scenario_link (scenario_id);

ALTER TABLE app.simulation_run
    ADD COLUMN IF NOT EXISTS alert_timeline JSONB NULL;
