-- ============================================================================
-- Obscyro: organizations + environment types
-- Migration 013: app.organizations, app.organization_members,
--                organization_id + environment_type on ontology_environments
--
-- Additive. Idempotent backfill: one org per user, CHUM org for studio account,
-- all existing environments typed as entity. Safe to re-run.
-- ============================================================================

-- --- New tables -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.organizations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.organization_members (
    organization_id UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    role            TEXT        NOT NULL DEFAULT 'member'
                                CHECK (role IN ('owner', 'member')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_user_idx
    ON app.organization_members (user_id);

-- --- Extend ontology_environments -------------------------------------------

ALTER TABLE app.ontology_environments
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES app.organizations(id);

ALTER TABLE app.ontology_environments
    ADD COLUMN IF NOT EXISTS environment_type TEXT NOT NULL DEFAULT 'entity';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ontology_environments_environment_type_check'
    ) THEN
        ALTER TABLE app.ontology_environments
            ADD CONSTRAINT ontology_environments_environment_type_check
            CHECK (environment_type IN ('reference', 'entity', 'operations'));
    END IF;
END $$;

-- --- Backfill: one org per user (slug includes user id prefix for uniqueness) -

INSERT INTO app.organizations (name, slug)
SELECT DISTINCT ON (u.id)
       COALESCE(NULLIF(TRIM(u.company), ''), u.name, SPLIT_PART(u.email, '@', 1)) AS name,
       LOWER(
         REGEXP_REPLACE(
           REGEXP_REPLACE(
             TRIM(COALESCE(NULLIF(u.company, ''), u.name, SPLIT_PART(u.email, '@', 1))),
             '[^a-zA-Z0-9]+', '-', 'g'
           ),
           '^-+|-+$', '', 'g'
         )
       ) || '-' || LEFT(u.id::text, 8) AS slug
  FROM app.users u
 WHERE NOT EXISTS (
   SELECT 1 FROM app.organization_members om WHERE om.user_id = u.id
 )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
  FROM app.users u
  JOIN app.organizations o
    ON o.slug = LOWER(
         REGEXP_REPLACE(
           REGEXP_REPLACE(
             TRIM(COALESCE(NULLIF(u.company, ''), u.name, SPLIT_PART(u.email, '@', 1))),
             '[^a-zA-Z0-9]+', '-', 'g'
           ),
           '^-+|-+$', '', 'g'
         )
       ) || '-' || LEFT(u.id::text, 8)
 WHERE NOT EXISTS (
   SELECT 1 FROM app.organization_members om
    WHERE om.user_id = u.id AND om.organization_id = o.id
 );

-- --- CHUM org for studio account --------------------------------------------

INSERT INTO app.organizations (name, slug)
VALUES ('CHUM', 'chum')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO app.organization_members (organization_id, user_id, role)
SELECT o.id, u.id, 'owner'
  FROM app.organizations o
  CROSS JOIN app.users u
 WHERE o.slug = 'chum'
   AND u.email = 'victormorency7@gmail.com'
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- Attach studio user's environments to CHUM org
UPDATE app.ontology_environments e
   SET organization_id = (SELECT id FROM app.organizations WHERE slug = 'chum' LIMIT 1),
       environment_type = 'entity'
 WHERE e.organization_id IS NULL
   AND e.owner_user_id = (
     SELECT id FROM app.users WHERE email = 'victormorency7@gmail.com' LIMIT 1
   );

-- Remaining environments → owner's auto-provisioned org
UPDATE app.ontology_environments e
   SET organization_id = om.organization_id,
       environment_type = 'entity'
  FROM app.organization_members om
 WHERE e.organization_id IS NULL
   AND om.user_id = e.owner_user_id
   AND om.role = 'owner';

-- Fallback: any env still missing org_id → earliest user's org
UPDATE app.ontology_environments e
   SET organization_id = (
     SELECT om.organization_id
       FROM app.organization_members om
       JOIN app.users u ON u.id = om.user_id
      ORDER BY u.created_at ASC
      LIMIT 1
   ),
       environment_type = 'entity'
 WHERE e.organization_id IS NULL;

-- --- Constraints: org-scoped slug uniqueness --------------------------------

ALTER TABLE app.ontology_environments
    ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE app.ontology_environments
    DROP CONSTRAINT IF EXISTS ontology_environments_owner_user_id_slug_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ontology_environments_organization_id_slug_key'
    ) THEN
        ALTER TABLE app.ontology_environments
            ADD CONSTRAINT ontology_environments_organization_id_slug_key
            UNIQUE (organization_id, slug);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ontology_environments_org_idx
    ON app.ontology_environments (organization_id);
