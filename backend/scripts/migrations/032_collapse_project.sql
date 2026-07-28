-- ============================================================================
-- Foundry alignment, stage 2 of 3: collapse the redundant project table.
--
-- Migration 029 introduced app.project as a child of an environment, before it
-- was clear that the environment IS the project — every environment received
-- exactly one auto-created "default" project, so the layer only added a hop.
--
-- After this, resources hang directly off the environment (renamed to project
-- in stage 3), matching Foundry's Organization > Project > Folder > resource.
-- Folders come from the `path` column, not from a table.
-- ============================================================================

-- --- 1. Datasets point at the environment ----------------------------------

ALTER TABLE app.dataset DROP CONSTRAINT IF EXISTS dataset_project_id_fkey;

UPDATE app.dataset d
   SET project_id = p.environment_id
  FROM app.project p
 WHERE p.id = d.project_id;

-- Any dataset whose project vanished would now dangle; fail rather than
-- silently orphan data.
DO $$
DECLARE bad INT;
BEGIN
    SELECT COUNT(*) INTO bad
      FROM app.dataset d
      LEFT JOIN app.ontology_environments e ON e.id = d.project_id
     WHERE e.id IS NULL;
    IF bad > 0 THEN
        RAISE EXCEPTION 'dataset: % rows do not resolve to an environment', bad;
    END IF;
END $$;

ALTER TABLE app.dataset
    ADD CONSTRAINT dataset_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES app.ontology_environments(id) ON DELETE CASCADE;

-- --- 2. Ingest sources point at the environment ----------------------------

ALTER TABLE app.ingest_sources DROP CONSTRAINT IF EXISTS ingest_sources_project_id_fkey;

UPDATE app.ingest_sources s
   SET project_id = p.environment_id
  FROM app.project p
 WHERE p.id = s.project_id;

-- Sources with no channel were never homed; leave them NULL rather than
-- guessing an owner.
UPDATE app.ingest_sources s
   SET project_id = NULL
 WHERE s.project_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM app.ontology_environments e WHERE e.id = s.project_id);

ALTER TABLE app.ingest_sources
    ADD CONSTRAINT ingest_sources_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES app.ontology_environments(id) ON DELETE SET NULL;

-- --- 3. Drop the redundant layer -------------------------------------------

DROP TABLE IF EXISTS app.project;
