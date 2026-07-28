-- ============================================================================
-- Foundry alignment, stage 3 of 3: the schema adopts the product's vocabulary.
--
-- `ontology_environments` has been the project since stage 2 — it holds
-- datasets, channels and object-type filing, and the UI has called it a
-- project since the Home page shipped. This renames the table and every
-- environment_id column so the schema stops disagreeing with the model.
--
-- Purely a rename: no rows move, no semantics change. Postgres renames
-- columns and tables atomically and carries indexes, constraints and foreign
-- keys with them, so this is safe to run against live data.
--
-- A compatibility view is deliberately NOT created: a silent alias would let
-- stale code keep working and hide whatever the rename missed. The build and
-- the test suite are the check instead.
-- ============================================================================

ALTER TABLE app.ontology_environments RENAME TO project;

-- Every table that filed a resource under an environment now files it under a
-- project. Derived from the catalogue rather than a hand-written list: a typo
-- in a hardcoded table name would silently skip a rename and leave the schema
-- half-migrated.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT table_name
          FROM information_schema.columns
         WHERE table_schema = 'app' AND column_name = 'environment_id'
         ORDER BY table_name
    LOOP
        EXECUTE format('ALTER TABLE app.%I RENAME COLUMN environment_id TO project_id', r.table_name);
        RAISE NOTICE 'renamed %.environment_id -> project_id', r.table_name;
    END LOOP;
END $$;

-- The kind column reads as a project kind now, not an environment type.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='app' AND table_name='project'
                  AND column_name='environment_type') THEN
        ALTER TABLE app.project RENAME COLUMN environment_type TO project_kind;
    END IF;
END $$;

-- Triggers written against the old column names are recreated in stage 3's
-- companion code change; the link check reads organization_id (stage 1) and is
-- unaffected by this rename.
