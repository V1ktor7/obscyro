-- ============================================================================
-- Foundry alignment, stage 1 of 3: the ontology becomes an organization-wide
-- namespace instead of one ontology per project.
--
-- Foundry keeps two trees over the same objects:
--   filing    — Organization > Project > Folder > resource. Where a type is
--               stored, who may edit it, what gets exported together.
--   resolving — one flat Ontology per organization. `Patient` means one thing,
--               whichever project happens to define it.
--
-- We had only the filing tree, so UNIQUE (environment_id, name) made `Patient`
-- in two projects two unrelated types. This migration adds the resolution
-- scope and moves uniqueness onto it.
--
-- Safe on current production data: all five environments belong to one
-- organization and only ruisss-est holds any types, so the merge has zero
-- name collisions to resolve.
--
-- environment_id is retained as the filing column (it becomes project_id in
-- stage 3); this migration only changes what uniqueness and linking mean.
-- ============================================================================

-- --- 1. Resolution scope + folder path -------------------------------------

ALTER TABLE app.ontology_object_types
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES app.organizations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS path TEXT NOT NULL DEFAULT '/';

ALTER TABLE app.ontology_link_types
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES app.organizations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS path TEXT NOT NULL DEFAULT '/';

UPDATE app.ontology_object_types t
   SET organization_id = e.organization_id
  FROM app.ontology_environments e
 WHERE e.id = t.environment_id AND t.organization_id IS NULL;

UPDATE app.ontology_link_types l
   SET organization_id = e.organization_id
  FROM app.ontology_environments e
 WHERE e.id = l.environment_id AND l.organization_id IS NULL;

-- An environment with no organization would leave orphans; fail loudly rather
-- than silently creating types that resolve nowhere.
DO $$
DECLARE orphans INT;
BEGIN
    SELECT COUNT(*) INTO orphans FROM app.ontology_object_types WHERE organization_id IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION 'ontology_object_types: % rows have no organization; backfill first', orphans;
    END IF;
    SELECT COUNT(*) INTO orphans FROM app.ontology_link_types WHERE organization_id IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION 'ontology_link_types: % rows have no organization; backfill first', orphans;
    END IF;
END $$;

ALTER TABLE app.ontology_object_types ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE app.ontology_link_types  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS ontology_object_types_org_idx
    ON app.ontology_object_types (organization_id);
CREATE INDEX IF NOT EXISTS ontology_link_types_org_idx
    ON app.ontology_link_types (organization_id);

-- --- 2. Merge duplicate names into one type per organization --------------
-- Unifying a namespace means the duplicates genuinely become one type, not
-- that one is renamed out of the way: renaming leaves link types pointing at
-- the renamed copy while new instances resolve to the survivor, which breaks
-- the graph (caught by the twin integration tests).
--
-- So for each (organization, name) collision the copy with the most instances
-- wins (ties broken by age), and every reference is repointed to it before the
-- loser is removed. Property schemas are unioned, so no field is lost.

DO $$
DECLARE w RECORD; l RECORD;
BEGIN
    FOR w IN
        SELECT organization_id, name,
               (ARRAY_AGG(id ORDER BY
                    (SELECT COUNT(*) FROM app.ontology_object_instances i
                      WHERE i.object_type_id = t.id) DESC,
                    created_at ASC, id ASC))[1] AS winner_id,
               COUNT(*) AS n
          FROM app.ontology_object_types t
         GROUP BY organization_id, name
        HAVING COUNT(*) > 1
    LOOP
        FOR l IN
            SELECT id FROM app.ontology_object_types
             WHERE organization_id = w.organization_id AND name = w.name
               AND id <> w.winner_id
        LOOP
            -- Keep every property the loser declared.
            UPDATE app.ontology_object_types win
               SET property_schema = win.property_schema || COALESCE((
                     SELECT jsonb_agg(lp)
                       FROM jsonb_array_elements(lose.property_schema) lp
                      WHERE NOT EXISTS (
                            SELECT 1 FROM jsonb_array_elements(win.property_schema) wp
                             WHERE wp->>'key' = lp->>'key')
                   ), '[]'::jsonb)
              FROM app.ontology_object_types lose
             WHERE win.id = w.winner_id AND lose.id = l.id;

            UPDATE app.ontology_object_instances SET object_type_id = w.winner_id
             WHERE object_type_id = l.id;
            UPDATE app.ontology_link_types SET from_type_id = w.winner_id
             WHERE from_type_id = l.id;
            UPDATE app.ontology_link_types SET to_type_id = w.winner_id
             WHERE to_type_id = l.id;

            DELETE FROM app.ontology_object_types WHERE id = l.id;
            RAISE NOTICE 'merged duplicate object type % into the surviving definition', w.name;
        END LOOP;
    END LOOP;

    FOR w IN
        SELECT organization_id, name, from_type_id, to_type_id,
               (ARRAY_AGG(id ORDER BY created_at ASC, id ASC))[1] AS winner_id
          FROM app.ontology_link_types
         GROUP BY organization_id, name, from_type_id, to_type_id
        HAVING COUNT(*) > 1
    LOOP
        FOR l IN
            SELECT id FROM app.ontology_link_types
             WHERE organization_id = w.organization_id AND name = w.name
               AND id <> w.winner_id
        LOOP
            UPDATE app.ontology_link_instances SET link_type_id = w.winner_id
             WHERE link_type_id = l.id;
            DELETE FROM app.ontology_link_types WHERE id = l.id;
            RAISE NOTICE 'merged duplicate link type %', w.name;
        END LOOP;
    END LOOP;

    -- Link types that still collide on name but connect different types cannot
    -- be merged; suffix those so the namespace is still valid.
    FOR l IN
        WITH ranked AS (
            SELECT id, name, ROW_NUMBER() OVER (
                       PARTITION BY organization_id, name ORDER BY created_at ASC, id ASC) rn
              FROM app.ontology_link_types
        )
        SELECT id, name FROM ranked WHERE rn > 1
    LOOP
        UPDATE app.ontology_link_types SET name = l.name || '_' || LEFT(id::text, 4)
         WHERE id = l.id;
        RAISE NOTICE 'link type % connects different types; suffixed instead of merged', l.name;
    END LOOP;
END $$;

-- --- 3. Uniqueness moves from project to organization ----------------------
-- This is the change that makes the ontology one namespace.

ALTER TABLE app.ontology_object_types
    DROP CONSTRAINT IF EXISTS ontology_object_types_environment_id_name_key;
ALTER TABLE app.ontology_link_types
    DROP CONSTRAINT IF EXISTS ontology_link_types_environment_id_name_key;

ALTER TABLE app.ontology_object_types
    ADD CONSTRAINT ontology_object_types_org_name_key UNIQUE (organization_id, name);
ALTER TABLE app.ontology_link_types
    ADD CONSTRAINT ontology_link_types_org_name_key UNIQUE (organization_id, name);

-- --- 4. Links resolve across projects, within one organization -------------
-- Previously a link required all three parties in the same environment, so a
-- Patient in one project could never link to a Bed in another. The boundary
-- that actually matters is the organization: data must not cross custodians,
-- but it may cross a folder.

CREATE OR REPLACE FUNCTION app.ontology_link_instances_check_environment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_lt_org   UUID;
    v_from_org UUID;
    v_to_org   UUID;
BEGIN
    SELECT lt.organization_id INTO v_lt_org
      FROM app.ontology_link_types lt WHERE lt.id = NEW.link_type_id;
    IF v_lt_org IS NULL THEN
        RAISE EXCEPTION 'ontology_link_instances: link_type_id % does not exist', NEW.link_type_id;
    END IF;

    SELECT ot.organization_id INTO v_from_org
      FROM app.ontology_object_instances oi
      JOIN app.ontology_object_types ot ON ot.id = oi.object_type_id
     WHERE oi.id = NEW.from_instance_id;
    IF v_from_org IS NULL THEN
        RAISE EXCEPTION 'ontology_link_instances: from_instance_id % does not exist', NEW.from_instance_id;
    END IF;

    SELECT ot.organization_id INTO v_to_org
      FROM app.ontology_object_instances oi
      JOIN app.ontology_object_types ot ON ot.id = oi.object_type_id
     WHERE oi.id = NEW.to_instance_id;
    IF v_to_org IS NULL THEN
        RAISE EXCEPTION 'ontology_link_instances: to_instance_id % does not exist', NEW.to_instance_id;
    END IF;

    -- The sovereignty gate: links may cross projects, never organizations.
    IF v_lt_org <> v_from_org OR v_lt_org <> v_to_org THEN
        RAISE EXCEPTION
            'ontology_link_instances: organization mismatch — link_type org %, from org %, to org %',
            v_lt_org, v_from_org, v_to_org;
    END IF;

    RETURN NEW;
END;
$$;
