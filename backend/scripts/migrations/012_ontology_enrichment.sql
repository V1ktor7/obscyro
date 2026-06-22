-- ============================================================================
-- Obscyro: ontology enrichment (first-class codes, context column, pipeline runs)
-- Migration 012: extends 010 ontology tables — additive, idempotent where possible.
-- (011 is occupied by 011_webhook_config.sql in this repo.)
-- ============================================================================

-- --- ontology_object_instances: dedicated code + context columns ------------

ALTER TABLE app.ontology_object_instances
    ADD COLUMN IF NOT EXISTS code_system TEXT,
    ADD COLUMN IF NOT EXISTS code TEXT,
    ADD COLUMN IF NOT EXISTS display TEXT,
    ADD COLUMN IF NOT EXISTS context JSONB;

-- --- ontology_object_types: FHIR hint + context flag ------------------------

ALTER TABLE app.ontology_object_types
    ADD COLUMN IF NOT EXISTS fhir_resource_type TEXT,
    ADD COLUMN IF NOT EXISTS has_context BOOLEAN NOT NULL DEFAULT FALSE;

-- --- ontology_pipeline_run --------------------------------------------------

CREATE TABLE IF NOT EXISTS app.ontology_pipeline_run (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id  UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    source          TEXT,
    input_hash      TEXT,
    status          TEXT        NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    stats           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ontology_pipeline_run_env_idx
    ON app.ontology_pipeline_run (environment_id, started_at DESC);

-- --- Link-instance integrity triggers ---------------------------------------

CREATE OR REPLACE FUNCTION app.ontology_link_instances_check_types()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_lt_from_type   UUID;
    v_lt_to_type     UUID;
    v_from_inst_type UUID;
    v_to_inst_type   UUID;
BEGIN
    SELECT lt.from_type_id, lt.to_type_id
      INTO v_lt_from_type, v_lt_to_type
      FROM app.ontology_link_types lt
     WHERE lt.id = NEW.link_type_id;

    IF v_lt_from_type IS NULL THEN
        RAISE EXCEPTION
            'ontology_link_instances: link_type_id % does not exist',
            NEW.link_type_id;
    END IF;

    SELECT oi.object_type_id
      INTO v_from_inst_type
      FROM app.ontology_object_instances oi
     WHERE oi.id = NEW.from_instance_id;

    IF v_from_inst_type IS NULL THEN
        RAISE EXCEPTION
            'ontology_link_instances: from_instance_id % does not exist',
            NEW.from_instance_id;
    END IF;

    SELECT oi.object_type_id
      INTO v_to_inst_type
      FROM app.ontology_object_instances oi
     WHERE oi.id = NEW.to_instance_id;

    IF v_to_inst_type IS NULL THEN
        RAISE EXCEPTION
            'ontology_link_instances: to_instance_id % does not exist',
            NEW.to_instance_id;
    END IF;

    IF v_from_inst_type <> v_lt_from_type THEN
        RAISE EXCEPTION
            'ontology_link_instances: from_instance object_type_id % does not match link_type from_type_id %',
            v_from_inst_type, v_lt_from_type;
    END IF;

    IF v_to_inst_type <> v_lt_to_type THEN
        RAISE EXCEPTION
            'ontology_link_instances: to_instance object_type_id % does not match link_type to_type_id %',
            v_to_inst_type, v_lt_to_type;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.ontology_link_instances_check_environment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_lt_env    UUID;
    v_from_env  UUID;
    v_to_env    UUID;
BEGIN
    SELECT lt.environment_id
      INTO v_lt_env
      FROM app.ontology_link_types lt
     WHERE lt.id = NEW.link_type_id;

    IF v_lt_env IS NULL THEN
        RAISE EXCEPTION
            'ontology_link_instances: link_type_id % does not exist',
            NEW.link_type_id;
    END IF;

    SELECT ot.environment_id
      INTO v_from_env
      FROM app.ontology_object_instances oi
      JOIN app.ontology_object_types ot ON ot.id = oi.object_type_id
     WHERE oi.id = NEW.from_instance_id;

    IF v_from_env IS NULL THEN
        RAISE EXCEPTION
            'ontology_link_instances: from_instance_id % does not exist',
            NEW.from_instance_id;
    END IF;

    SELECT ot.environment_id
      INTO v_to_env
      FROM app.ontology_object_instances oi
      JOIN app.ontology_object_types ot ON ot.id = oi.object_type_id
     WHERE oi.id = NEW.to_instance_id;

    IF v_to_env IS NULL THEN
        RAISE EXCEPTION
            'ontology_link_instances: to_instance_id % does not exist',
            NEW.to_instance_id;
    END IF;

    IF v_lt_env <> v_from_env OR v_lt_env <> v_to_env THEN
        RAISE EXCEPTION
            'ontology_link_instances: environment mismatch — link_type env %, from_instance env %, to_instance env %',
            v_lt_env, v_from_env, v_to_env;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ontology_link_instances_check_types_trg
    ON app.ontology_link_instances;
CREATE TRIGGER ontology_link_instances_check_types_trg
    BEFORE INSERT OR UPDATE OF link_type_id, from_instance_id, to_instance_id
    ON app.ontology_link_instances
    FOR EACH ROW
    EXECUTE FUNCTION app.ontology_link_instances_check_types();

DROP TRIGGER IF EXISTS ontology_link_instances_check_environment_trg
    ON app.ontology_link_instances;
CREATE TRIGGER ontology_link_instances_check_environment_trg
    BEFORE INSERT OR UPDATE OF link_type_id, from_instance_id, to_instance_id
    ON app.ontology_link_instances
    FOR EACH ROW
    EXECUTE FUNCTION app.ontology_link_instances_check_environment();

-- --- Optional backfill: context envelope from properties (properties kept) ----

UPDATE app.ontology_object_instances oi
   SET context = jsonb_strip_nulls(
         jsonb_build_object(
           'assertion', oi.properties->'assertion',
           'subject', oi.properties->'subject',
           'temporality', oi.properties->'temporality',
           'certainty', oi.properties->'certainty',
           'trigger', oi.properties->'trigger',
           'confidence', oi.properties->'confidence',
           'decision', oi.properties->'decision'
         )
       )
 WHERE oi.context IS NULL
   AND (
         oi.properties ? 'assertion'
      OR oi.properties ? 'subject'
      OR oi.properties ? 'temporality'
      OR oi.properties ? 'certainty'
   );

UPDATE app.ontology_object_types ot
   SET has_context = TRUE
 WHERE ot.name = 'ClinicalFinding'
   AND ot.has_context IS NOT TRUE;

UPDATE app.ontology_object_types ot
   SET fhir_resource_type = 'Patient'
 WHERE ot.name = 'Patient'
   AND ot.fhir_resource_type IS NULL;

UPDATE app.ontology_object_types ot
   SET fhir_resource_type = 'Condition'
 WHERE ot.name = 'ClinicalFinding'
   AND ot.fhir_resource_type IS NULL;

-- Populate first-class code columns from legacy properties where present.
UPDATE app.ontology_object_instances oi
   SET code_system = COALESCE(oi.code_system, 'http://snomed.info/sct'),
       code        = COALESCE(oi.code, oi.properties->>'snomed_code'),
       display     = COALESCE(oi.display, oi.properties->>'display')
 WHERE oi.code IS NULL
   AND oi.properties ? 'snomed_code';

-- --- Indexes ----------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ontology_object_instances_context_gin
    ON app.ontology_object_instances USING GIN (context);

CREATE INDEX IF NOT EXISTS ontology_object_types_env_type_idx
    ON app.ontology_object_types (environment_id, id);

CREATE INDEX IF NOT EXISTS ontology_object_instances_code_system_code_idx
    ON app.ontology_object_instances (code_system, code)
    WHERE code IS NOT NULL;
