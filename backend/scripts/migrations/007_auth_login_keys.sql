-- ============================================================================
-- Obscyro: platform login + multi-key management
-- Migration 007: password_hash on users, seed studio account
-- ============================================================================

ALTER TABLE app.users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Studio account (access code hashed with bcrypt via pgcrypto).
-- Change the access code in production via UPDATE after first deploy.
INSERT INTO app.users (email, name, use_case, password_hash)
VALUES (
    'victormorency7@gmail.com',
    'Victor Morency',
    'developer',
    crypt('Normalize120$', gen_salt('bf'))
)
ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name;
