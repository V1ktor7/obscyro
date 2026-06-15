-- ============================================================================
-- Obscyro: minimal ontology (Foundry-style object types + instances)
-- Migration 009: object_types, objects
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.object_types (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT,
    properties  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS object_types_user_idx
    ON app.object_types (user_id);

CREATE TABLE IF NOT EXISTS app.objects (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    type_id          UUID        NOT NULL REFERENCES app.object_types(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    properties       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    source_event_id  UUID        REFERENCES app.ingest_events(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS objects_type_idx
    ON app.objects (type_id, created_at DESC);

CREATE INDEX IF NOT EXISTS objects_user_idx
    ON app.objects (user_id, created_at DESC);
