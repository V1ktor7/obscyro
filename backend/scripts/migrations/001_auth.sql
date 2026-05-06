-- ============================================================================
-- Obscyro: API key authentication + usage tracking
-- Migration 001: app schema, api_keys, api_usage
--
-- The `app` schema holds application data and is intentionally separate from
-- `snomed` (which is dropped/recreated on every SNOMED import). Run this via
-- `npm run migrate`.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.api_keys (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash       TEXT        NOT NULL UNIQUE,
    key_prefix     TEXT        NOT NULL,
    name           TEXT        NOT NULL,
    owner_email    TEXT        NOT NULL,
    plan           TEXT        NOT NULL DEFAULT 'free'
                                CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
    monthly_quota  INT         NOT NULL DEFAULT 1000,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at   TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_key_prefix_idx
    ON app.api_keys (key_prefix);

CREATE INDEX IF NOT EXISTS api_keys_active_idx
    ON app.api_keys (id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app.api_usage (
    id           BIGSERIAL   PRIMARY KEY,
    api_key_id   UUID        REFERENCES app.api_keys(id) ON DELETE SET NULL,
    endpoint     TEXT        NOT NULL,
    status_code  INT         NOT NULL,
    duration_ms  INT         NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_usage_key_time_idx
    ON app.api_usage (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS api_usage_time_idx
    ON app.api_usage (created_at DESC);

CREATE TABLE IF NOT EXISTS app.schema_migrations (
    version    TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
