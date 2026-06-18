-- ============================================================================
-- Obscyro: n8n-style webhook configuration
-- Migration 011: per-webhook HTTP method + config (auth, response, options)
-- ============================================================================

-- The HTTP method the webhook listens on. 'ANY' accepts every method.
ALTER TABLE app.ingest_sources
    ADD COLUMN IF NOT EXISTS webhook_method TEXT NOT NULL DEFAULT 'POST';

-- Everything else (auth, response shaping, options) lives in a single JSONB
-- blob so the shape can evolve without further migrations. Secrets for basic
-- and header auth are stored as SHA-256 hashes; the JWT shared secret is stored
-- as-is (it must be usable to verify signatures) and is never returned to the
-- client by the API.
ALTER TABLE app.ingest_sources
    ADD COLUMN IF NOT EXISTS webhook_config JSONB NOT NULL DEFAULT '{}'::jsonb;
