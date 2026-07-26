-- ============================================================================
-- Platform governance foundation (spec Part 2.2 / Part 7)
--   1. Widen organization_members.role to the specified role set
--   2. Organization + user profile fields the setup wizard would collect
--   3. app.audit_log — append-only; UPDATE/DELETE are blocked by trigger so a
--      privileged actor cannot erase evidence of their own actions
--   4. Seed one full-access Owner account (password hash only — the plaintext
--      access code is never stored in this repository)
-- ============================================================================

-- --- 1. Role model ----------------------------------------------------------
-- 'member' is retained so existing rows stay valid.

ALTER TABLE app.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE app.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN (
        'owner',
        'administrator',
        'security_administrator',
        'auditor',
        'data_engineer',
        'ontology_editor',
        'ontology_viewer',
        'model_developer',
        'model_approver',
        'data_steward',
        'app_builder',
        'app_user',
        'analyst',
        'guest',
        'member'
    ));

-- --- 2. Profile fields ------------------------------------------------------

ALTER TABLE app.organizations
    ADD COLUMN IF NOT EXISTS org_type TEXT,
    ADD COLUMN IF NOT EXISTS jurisdictions TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS regulations TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS data_residency TEXT,
    ADD COLUMN IF NOT EXISTS primary_language TEXT NOT NULL DEFAULT 'fr',
    ADD COLUMN IF NOT EXISTS secondary_language TEXT,
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto',
    ADD COLUMN IF NOT EXISTS retention_days INT NOT NULL DEFAULT 3650,
    ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

ALTER TABLE app.users
    ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'fr',
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto',
    ADD COLUMN IF NOT EXISTS job_title TEXT,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- --- 3. Append-only audit log ----------------------------------------------

CREATE TABLE IF NOT EXISTS app.audit_log (
    id              BIGSERIAL   PRIMARY KEY,
    organization_id UUID        REFERENCES app.organizations(id) ON DELETE SET NULL,
    environment_id  UUID        REFERENCES app.ontology_environments(id) ON DELETE SET NULL,
    actor_user_id   UUID        REFERENCES app.users(id) ON DELETE SET NULL,
    actor_email     TEXT,
    -- Verb in dot form: ontology.type.create, data.channel.run, admin.role.grant
    action          TEXT        NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    outcome         TEXT        NOT NULL DEFAULT 'success'
                                CHECK (outcome IN ('success', 'denied', 'error')),
    -- Never put PHI here: identifiers and counts only (spec Part 7.2).
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ip              TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_time_idx
    ON app.audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
    ON app.audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx
    ON app.audit_log (action, created_at DESC);

-- Append-only enforcement: the whole point of an audit trail is that the
-- person being audited cannot rewrite it.
CREATE OR REPLACE FUNCTION app.audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'app.audit_log is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON app.audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE ON app.audit_log
    FOR EACH ROW EXECUTE FUNCTION app.audit_log_immutable();

-- --- 4. Seed the platform Owner --------------------------------------------
-- Only the bcrypt hash lives here. This repository is public; the plaintext
-- access code is delivered out of band and can be rotated with:
--   UPDATE app.users SET password_hash = crypt('<new>', gen_salt('bf', 12))
--    WHERE email = 'victormorency7@gmail.com';

INSERT INTO app.users (email, name, company, use_case, password_hash, locale, timezone, job_title)
VALUES (
    'victormorency7@gmail.com',
    'Victor Morency',
    'Obscyro',
    'developer',
    '$2a$12$ozJ4uCFsIOZ7KtRW3BkGu.ZtXV3kNy63Ky8QtHDopQFhV.HNrcglm',
    'fr',
    'America/Toronto',
    'Platform owner'
)
ON CONFLICT (email) DO UPDATE
   SET password_hash = EXCLUDED.password_hash,
       name          = EXCLUDED.name,
       job_title     = EXCLUDED.job_title;

-- Organization for the owner, fully profiled so no setup wizard blocks login.
INSERT INTO app.organizations (name, slug, org_type, jurisdictions, regulations,
                               data_residency, primary_language, secondary_language,
                               timezone, retention_days, setup_completed_at)
VALUES (
    'Obscyro',
    'obscyro',
    'research_institution',
    ARRAY['CA-QC', 'CA'],
    ARRAY['law_25', 'pipeda'],
    'ca-central',
    'fr',
    'en',
    'America/Toronto',
    3650,
    now()
)
ON CONFLICT (slug) DO UPDATE
   SET org_type           = EXCLUDED.org_type,
       jurisdictions      = EXCLUDED.jurisdictions,
       regulations        = EXCLUDED.regulations,
       data_residency     = EXCLUDED.data_residency,
       setup_completed_at = COALESCE(app.organizations.setup_completed_at, EXCLUDED.setup_completed_at);

INSERT INTO app.organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
  FROM app.organizations o, app.users u
 WHERE o.slug = 'obscyro' AND u.email = 'victormorency7@gmail.com'
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner';

-- Record the seeding itself, so the very first audit entry explains where this
-- account came from.
INSERT INTO app.audit_log (organization_id, actor_user_id, actor_email, action,
                           resource_type, resource_id, metadata)
SELECT o.id, u.id, u.email, 'admin.account.seed', 'user', u.id::text,
       jsonb_build_object('role', 'owner', 'source', 'migration_028')
  FROM app.organizations o, app.users u
 WHERE o.slug = 'obscyro' AND u.email = 'victormorency7@gmail.com';
