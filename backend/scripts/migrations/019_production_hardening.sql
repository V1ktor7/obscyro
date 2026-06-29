-- ============================================================================
-- Obscyro: production hardening for twin, live-analysis, simulation, data-quality
-- Migration 019:
--   * idempotent open twin alerts (no SSE duplicate spam)
--   * incremental data-quality scan cursor
--   * default per-environment score spec marker
--   * hot-query indexes for rollups, metrics, and incremental scans
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Twin alerts: one OPEN alert per (environment, unit, rule). evaluateAlerts
--    upserts on this index so the 5s SSE/poll loop refreshes instead of
--    inserting a new row every tick.
-- ----------------------------------------------------------------------------
-- Collapse any pre-existing duplicate open alerts down to the newest per key so
-- the unique index can be created on dirty data.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY environment_id, unit_instance_id, rule_id
               ORDER BY created_at DESC, id DESC
           ) AS rn
      FROM app.twin_alert
     WHERE status = 'open' AND rule_id IS NOT NULL
)
DELETE FROM app.twin_alert
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS twin_alert_open_unique_idx
    ON app.twin_alert (environment_id, unit_instance_id, rule_id)
    WHERE status = 'open';

-- ----------------------------------------------------------------------------
-- 2. Incremental data-quality scans: remember the high-water mark per env so a
--    re-scan only re-evaluates instances changed since the last scan.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.data_quality_scan_state (
    environment_id   UUID        PRIMARY KEY
                                 REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    last_scanned_at  TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
    last_full_at     TIMESTAMPTZ NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. Score specs: mark the per-environment default score definition. Partial
--    unique index guarantees at most one default per environment.
-- ----------------------------------------------------------------------------
ALTER TABLE app.metric_definition
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS metric_definition_default_idx
    ON app.metric_definition (environment_id, kind)
    WHERE is_default;

-- ----------------------------------------------------------------------------
-- 4. Hot-query indexes.
--    * metrics aggregation & incremental scans group/filter by type + recency
--    * data-quality flag listing already has an index; add a severity filter aid
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ontology_object_instances_type_updated_idx
    ON app.ontology_object_instances (object_type_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS data_quality_flag_env_sev_status_idx
    ON app.data_quality_flag (environment_id, severity, status, created_at DESC);
