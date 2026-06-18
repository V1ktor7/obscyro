-- ============================================================================
-- Obscyro: multi-domain ontology (environments + object/link types & instances)
-- Migration 010: ontology_environments, ontology_object_types, ontology_link_types,
--                ontology_object_instances, ontology_link_instances
--
-- Additive. Generalizes the per-user ontology from 009 into environment-scoped,
-- linkable, provenance-bearing objects. The 009 tables (app.object_types,
-- app.objects) and their routes are left intact; their data is backfilled here.
-- All data steps are idempotent so the file is safe to re-run.
-- ============================================================================

-- --- Schema -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.ontology_environments (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id  UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,
    slug           TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_user_id, slug)
);

CREATE INDEX IF NOT EXISTS ontology_environments_owner_idx
    ON app.ontology_environments (owner_user_id);

CREATE TABLE IF NOT EXISTS app.ontology_object_types (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id  UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    description     TEXT,
    property_schema JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, name)
);

CREATE INDEX IF NOT EXISTS ontology_object_types_env_idx
    ON app.ontology_object_types (environment_id);

CREATE TABLE IF NOT EXISTS app.ontology_link_types (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id  UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    from_type_id    UUID        NOT NULL REFERENCES app.ontology_object_types(id) ON DELETE CASCADE,
    to_type_id      UUID        NOT NULL REFERENCES app.ontology_object_types(id) ON DELETE CASCADE,
    cardinality     TEXT        NOT NULL DEFAULT 'many_to_many'
                                 CHECK (cardinality IN ('one_to_one','one_to_many','many_to_one','many_to_many')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, name)
);

CREATE INDEX IF NOT EXISTS ontology_link_types_env_idx
    ON app.ontology_link_types (environment_id);

CREATE TABLE IF NOT EXISTS app.ontology_object_instances (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type_id  UUID        NOT NULL REFERENCES app.ontology_object_types(id) ON DELETE CASCADE,
    properties      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    provenance      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ontology_object_instances_type_idx
    ON app.ontology_object_instances (object_type_id, created_at DESC);

-- GIN index supports the context-envelope `where` filters on /objects.
CREATE INDEX IF NOT EXISTS ontology_object_instances_props_gin
    ON app.ontology_object_instances USING GIN (properties);

CREATE TABLE IF NOT EXISTS app.ontology_link_instances (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    link_type_id      UUID        NOT NULL REFERENCES app.ontology_link_types(id) ON DELETE CASCADE,
    from_instance_id  UUID        NOT NULL REFERENCES app.ontology_object_instances(id) ON DELETE CASCADE,
    to_instance_id    UUID        NOT NULL REFERENCES app.ontology_object_instances(id) ON DELETE CASCADE,
    provenance        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (link_type_id, from_instance_id, to_instance_id)
);

CREATE INDEX IF NOT EXISTS ontology_link_instances_from_idx
    ON app.ontology_link_instances (from_instance_id);
CREATE INDEX IF NOT EXISTS ontology_link_instances_to_idx
    ON app.ontology_link_instances (to_instance_id);

-- --- Backfill 009 data into the generalized model ---------------------------

-- One "Default" environment per owner that has legacy object types.
INSERT INTO app.ontology_environments (owner_user_id, name, slug)
SELECT DISTINCT ot.user_id, 'Default', 'default'
  FROM app.object_types ot
ON CONFLICT (owner_user_id, slug) DO NOTHING;

-- Legacy object types -> generalized object types (properties array -> property_schema).
INSERT INTO app.ontology_object_types (environment_id, name, description, property_schema)
SELECT e.id, ot.name, ot.description, ot.properties
  FROM app.object_types ot
  JOIN app.ontology_environments e
    ON e.owner_user_id = ot.user_id AND e.slug = 'default'
ON CONFLICT (environment_id, name) DO NOTHING;

-- Legacy objects -> generalized instances (guarded by legacy id for idempotency).
INSERT INTO app.ontology_object_instances (object_type_id, properties, provenance, created_at, updated_at)
SELECT nt.id,
       o.properties,
       jsonb_build_object(
         'source', 'migration_009',
         'created_at', o.created_at,
         'legacy_object_id', o.id::text,
         'source_event_id', o.source_event_id
       ),
       o.created_at,
       o.updated_at
  FROM app.objects o
  JOIN app.object_types lt ON lt.id = o.type_id
  JOIN app.ontology_environments e
    ON e.owner_user_id = o.user_id AND e.slug = 'default'
  JOIN app.ontology_object_types nt
    ON nt.environment_id = e.id AND nt.name = lt.name
 WHERE NOT EXISTS (
   SELECT 1 FROM app.ontology_object_instances oi
    WHERE oi.provenance->>'legacy_object_id' = o.id::text
 );

-- --- Seed: CHUM Lab demo environment ----------------------------------------
-- Owned by the earliest existing user (the studio account from migration 007).
-- If no users exist yet, every statement below is a harmless no-op.

INSERT INTO app.ontology_environments (owner_user_id, name, slug)
SELECT u.id, 'CHUM Lab', 'chum-lab'
  FROM app.users u
 ORDER BY u.created_at ASC
 LIMIT 1
ON CONFLICT (owner_user_id, slug) DO NOTHING;

-- ClinicalFinding type carries the full context envelope.
INSERT INTO app.ontology_object_types (environment_id, name, description, property_schema)
SELECT e.id, 'ClinicalFinding',
       'Clinical finding extracted from text with its context envelope',
       '[
         {"key":"span","type":"string","label":"Span"},
         {"key":"snomed_code","type":"string","label":"SNOMED code"},
         {"key":"display","type":"string","label":"Display"},
         {"key":"assertion","type":"string","label":"Assertion"},
         {"key":"subject","type":"string","label":"Subject"},
         {"key":"temporality","type":"string","label":"Temporality"},
         {"key":"certainty","type":"string","label":"Certainty"},
         {"key":"trigger","type":"string","label":"Trigger"},
         {"key":"confidence","type":"number","label":"Context confidence"},
         {"key":"decision","type":"string","label":"Decision"},
         {"key":"readable_note","type":"string","label":"Readable note"}
       ]'::jsonb
  FROM app.ontology_environments e
 WHERE e.slug = 'chum-lab'
   AND e.owner_user_id = (SELECT id FROM app.users ORDER BY created_at ASC LIMIT 1)
ON CONFLICT (environment_id, name) DO NOTHING;

INSERT INTO app.ontology_object_types (environment_id, name, description, property_schema)
SELECT e.id, 'Patient', 'Subject of clinical findings',
       '[
         {"key":"label","type":"string","label":"Label"},
         {"key":"external_id","type":"string","label":"External ID"}
       ]'::jsonb
  FROM app.ontology_environments e
 WHERE e.slug = 'chum-lab'
   AND e.owner_user_id = (SELECT id FROM app.users ORDER BY created_at ASC LIMIT 1)
ON CONFLICT (environment_id, name) DO NOTHING;

INSERT INTO app.ontology_link_types (environment_id, name, from_type_id, to_type_id, cardinality)
SELECT e.id, 'has_finding', pt.id, cf.id, 'many_to_many'
  FROM app.ontology_environments e
  JOIN app.ontology_object_types pt ON pt.environment_id = e.id AND pt.name = 'Patient'
  JOIN app.ontology_object_types cf ON cf.environment_id = e.id AND cf.name = 'ClinicalFinding'
 WHERE e.slug = 'chum-lab'
   AND e.owner_user_id = (SELECT id FROM app.users ORDER BY created_at ASC LIMIT 1)
ON CONFLICT (environment_id, name) DO NOTHING;

-- Coherent demo instances (chest pain = affirmed/patient; family MI = subject:family;
-- rule-out MI = uncertain/differential). Guarded by a seed_key for idempotency.
INSERT INTO app.ontology_object_instances (object_type_id, properties, provenance)
SELECT cf.id, v.props::jsonb,
       jsonb_build_object('source', 'seed', 'seed', 'chum-lab-demo',
                          'seed_key', v.seed_key, 'confidence', v.conf)
  FROM app.ontology_environments e
  JOIN app.ontology_object_types cf ON cf.environment_id = e.id AND cf.name = 'ClinicalFinding'
  CROSS JOIN (VALUES
    ('cf-chest-pain', 0.97,
     '{"span":"chest pain","snomed_code":"29857009","display":"Chest pain","assertion":"affirmed","subject":"patient","temporality":"current","certainty":"confirmed","trigger":null,"decision":"accept","readable_note":"Chest pain"}'),
    ('cf-family-mi', 0.95,
     '{"span":"father had an MI","snomed_code":"22298006","display":"Myocardial infarction","assertion":"affirmed","subject":"family","temporality":"past","certainty":"confirmed","trigger":"father","decision":"flag","readable_note":"Myocardial infarction \u2014 FAMILY subject"}'),
    ('cf-ruleout-mi', 0.90,
     '{"span":"rule out acute myocardial infarction","snomed_code":"57054005","display":"Acute myocardial infarction","assertion":"uncertain","subject":"patient","temporality":"current","certainty":"differential","trigger":"rule out","decision":"escalate","readable_note":"Acute myocardial infarction \u2014 DIFFERENTIAL"}')
  ) AS v(seed_key, conf, props)
 WHERE e.slug = 'chum-lab'
   AND e.owner_user_id = (SELECT id FROM app.users ORDER BY created_at ASC LIMIT 1)
   AND NOT EXISTS (
     SELECT 1 FROM app.ontology_object_instances oi
      WHERE oi.provenance->>'seed_key' = v.seed_key
   );

INSERT INTO app.ontology_object_instances (object_type_id, properties, provenance)
SELECT pt.id, '{"label":"Demo patient","external_id":"DEMO-0001"}'::jsonb,
       jsonb_build_object('source', 'seed', 'seed', 'chum-lab-demo', 'seed_key', 'patient-demo')
  FROM app.ontology_environments e
  JOIN app.ontology_object_types pt ON pt.environment_id = e.id AND pt.name = 'Patient'
 WHERE e.slug = 'chum-lab'
   AND e.owner_user_id = (SELECT id FROM app.users ORDER BY created_at ASC LIMIT 1)
   AND NOT EXISTS (
     SELECT 1 FROM app.ontology_object_instances oi
      WHERE oi.provenance->>'seed_key' = 'patient-demo'
   );

-- Link only the patient-subject findings to the demo patient (coherent semantics).
INSERT INTO app.ontology_link_instances (link_type_id, from_instance_id, to_instance_id, provenance)
SELECT lt.id, p.id, f.id,
       jsonb_build_object('source', 'seed', 'seed', 'chum-lab-demo')
  FROM app.ontology_environments e
  JOIN app.ontology_link_types lt ON lt.environment_id = e.id AND lt.name = 'has_finding'
  JOIN app.ontology_object_instances p ON p.provenance->>'seed_key' = 'patient-demo'
  JOIN app.ontology_object_instances f ON f.provenance->>'seed_key' IN ('cf-chest-pain', 'cf-ruleout-mi')
 WHERE e.slug = 'chum-lab'
   AND e.owner_user_id = (SELECT id FROM app.users ORDER BY created_at ASC LIMIT 1)
ON CONFLICT (link_type_id, from_instance_id, to_instance_id) DO NOTHING;
