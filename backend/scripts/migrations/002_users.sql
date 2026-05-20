-- ============================================================================
-- Obscyro: self-serve onboarding
-- Migration 002: app.users + api_keys.user_id FK
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    name        TEXT        NOT NULL,
    company     TEXT,
    use_case    TEXT        CHECK (use_case IN ('developer', 'research', 'clinical', 'other')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app.api_keys
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON app.api_keys (user_id);
