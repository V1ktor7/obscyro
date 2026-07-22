-- ============================================================================
-- Channel mapping + observability + review queue
--  1. data_channel_run.step_io — per-step input/output snapshots (truncated)
--     so a run can be debugged from the UI instead of blind counters.
--  2. channel_review_item — flagged/escalated extractions are queued for
--     human review instead of silently discarded; confirming one persists
--     the instance, rejecting closes it.
-- ============================================================================

ALTER TABLE app.data_channel_run
    ADD COLUMN IF NOT EXISTS step_io JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS app.channel_review_item (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id      UUID NOT NULL REFERENCES app.data_channel(id) ON DELETE CASCADE,
    environment_id  UUID NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    span            TEXT NOT NULL,
    code            TEXT,
    display         TEXT,
    decision        TEXT NOT NULL CHECK (decision IN ('flag', 'escalate')),
    confidence      DOUBLE PRECISION,
    -- Everything needed to persist faithfully on confirm:
    -- { result: PersistableExtractResult, objectType, patientIdentifier, inputHash }
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS channel_review_item_env_status_idx
    ON app.channel_review_item (environment_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS channel_review_item_channel_idx
    ON app.channel_review_item (channel_id);
