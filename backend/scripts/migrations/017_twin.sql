-- ============================================================================
-- Obscyro: live digital twin alert rules and alerts
-- Migration 017: twin_alert_rule, twin_alert
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.twin_alert_rule (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id           UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    unit_kind                TEXT        NULL,
    metric                   TEXT        NOT NULL,
    op                       TEXT        NOT NULL CHECK (op IN ('<', '>', '>=', '<=', '==')),
    threshold                NUMERIC     NOT NULL,
    severity                 TEXT        NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
    message_template         TEXT        NOT NULL,
    recommendation_template  TEXT        NOT NULL DEFAULT '',
    owner_user_id            UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    organization_id          UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS twin_alert_rule_env_idx
    ON app.twin_alert_rule (environment_id);

CREATE TABLE IF NOT EXISTS app.twin_alert (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id    UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    unit_instance_id  UUID        NOT NULL REFERENCES app.ontology_object_instances(id) ON DELETE CASCADE,
    rule_id           UUID        NULL REFERENCES app.twin_alert_rule(id) ON DELETE SET NULL,
    severity          TEXT        NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
    metric            TEXT        NOT NULL,
    value             NUMERIC     NOT NULL,
    message           TEXT        NOT NULL,
    recommendation    TEXT        NOT NULL DEFAULT '',
    status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ack')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acked_at          TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS twin_alert_env_status_idx
    ON app.twin_alert (environment_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS twin_alert_unit_status_idx
    ON app.twin_alert (unit_instance_id, status);
