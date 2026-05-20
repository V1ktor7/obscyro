-- ============================================================================
-- Obscyro: SNOMED CT International Edition schema (RF2 Snapshot)
-- Release: 20260201 (February 2026)
--
-- Loads seven tab-delimited UTF-8 files from the SNOMED CT International
-- Snapshot release into a dedicated `snomed` schema.
--
--   File                                                  -> Table
--   ----------------------------------------------------- -> ---------------------
--   sct2_Concept_Snapshot_INT_20260201.txt                -> snomed.concepts
--   sct2_Description_Snapshot-en_INT_20260201.txt         -> snomed.descriptions
--   sct2_Relationship_Snapshot_INT_20260201.txt           -> snomed.relationships
--   der2_iisssccRefset_ExtendedMapSnapshot_INT_*.txt      -> snomed.extended_map
--   der2_sRefset_SimpleMapSnapshot_INT_20260201.txt       -> snomed.simple_map
--   sct2_TextDefinition_Snapshot-en_INT_20260201.txt      -> snomed.text_definitions
--   sct2_sRefset_OWLExpressionSnapshot_INT_20260201.txt   -> snomed.owl_expressions
--
-- Conventions:
--   * SCTIDs (concept/description/relationship ids and all "code" columns) are
--     BIGINT. RF2 SCTIDs are up to 18 digits, so INTEGER is unsafe.
--   * Refset row `id` columns (the four RF2 refset files) are UUID, per the
--     RF2 spec; only the four core component files (Concept, Description,
--     Relationship, TextDefinition) use SCTID `id`.
--   * `active` is stored as BOOLEAN; the loader maps the file's '0'/'1' to
--     false/true.
--   * `effective_time` is stored as INTEGER (YYYYMMDD) for compact, fast
--     comparisons. Each table also exposes a generated `effective_date` DATE
--     column (computed via `make_date`, which is IMMUTABLE and therefore legal
--     in a GENERATED column expression; `to_date` is only STABLE and would be
--     rejected).
--   * No foreign keys. Snapshot bulk loads via COPY would be crippled by FK
--     checks, and SNOMED snapshots are internally consistent.
--
-- Idempotent: running this script repeatedly drops and recreates the entire
-- `snomed` schema. Extensions are created with IF NOT EXISTS so re-runs are
-- safe at the cluster level.
-- ============================================================================

DROP SCHEMA IF EXISTS snomed CASCADE;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE SCHEMA snomed;

-- ----------------------------------------------------------------------------
-- 1. Concepts
--    sct2_Concept_Snapshot_INT_20260201.txt (~529k rows)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.concepts (
    id                   BIGINT  PRIMARY KEY,
    effective_time       INTEGER NOT NULL,
    effective_date       DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active               BOOLEAN NOT NULL,
    module_id            BIGINT  NOT NULL,
    definition_status_id BIGINT  NOT NULL
);

CREATE INDEX concepts_active_idx
    ON snomed.concepts (id)
    WHERE active = true;

-- ----------------------------------------------------------------------------
-- 2. Descriptions
--    sct2_Description_Snapshot-en_INT_20260201.txt (~1.7M rows)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.descriptions (
    id                   BIGINT  PRIMARY KEY,
    effective_time       INTEGER NOT NULL,
    effective_date       DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active               BOOLEAN NOT NULL,
    module_id            BIGINT  NOT NULL,
    concept_id           BIGINT  NOT NULL,
    language_code        TEXT    NOT NULL,
    type_id              BIGINT  NOT NULL,
    term                 TEXT    NOT NULL,
    case_significance_id BIGINT  NOT NULL
);

CREATE INDEX descriptions_concept_id_idx
    ON snomed.descriptions (concept_id);

CREATE INDEX descriptions_term_fts_idx
    ON snomed.descriptions
    USING GIN (to_tsvector('english', term));

CREATE INDEX descriptions_term_trgm_idx
    ON snomed.descriptions
    USING GIN (term gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 3. Relationships
--    sct2_Relationship_Snapshot_INT_20260201.txt (~3.5M rows)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.relationships (
    id                     BIGINT  PRIMARY KEY,
    effective_time         INTEGER NOT NULL,
    effective_date         DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active                 BOOLEAN NOT NULL,
    module_id              BIGINT  NOT NULL,
    source_id              BIGINT  NOT NULL,
    destination_id         BIGINT  NOT NULL,
    relationship_group     INTEGER NOT NULL,
    type_id                BIGINT  NOT NULL,
    characteristic_type_id BIGINT  NOT NULL,
    modifier_id            BIGINT  NOT NULL
);

CREATE INDEX relationships_source_id_idx
    ON snomed.relationships (source_id);

CREATE INDEX relationships_destination_id_idx
    ON snomed.relationships (destination_id);

CREATE INDEX relationships_type_id_idx
    ON snomed.relationships (type_id);

-- ----------------------------------------------------------------------------
-- 3b. Transitive IS-A closure (populated after RF2 load via npm run build:tc)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.transitive_closure (
    ancestor_id   BIGINT   NOT NULL,
    descendant_id BIGINT   NOT NULL,
    depth         SMALLINT NOT NULL,
    PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX transitive_closure_anc_depth_idx
    ON snomed.transitive_closure (ancestor_id, depth, descendant_id);

CREATE INDEX transitive_closure_desc_depth_idx
    ON snomed.transitive_closure (descendant_id, depth, ancestor_id);

-- ----------------------------------------------------------------------------
-- 4. Extended Map (refset)
--    der2_iisssccRefset_ExtendedMapSnapshot_INT_20260201.txt (~215k rows)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.extended_map (
    id                      UUID    PRIMARY KEY,
    effective_time          INTEGER NOT NULL,
    effective_date          DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active                  BOOLEAN NOT NULL,
    module_id               BIGINT  NOT NULL,
    refset_id               BIGINT  NOT NULL,
    referenced_component_id BIGINT  NOT NULL,
    map_group               INTEGER NOT NULL,
    map_priority            INTEGER NOT NULL,
    map_rule                TEXT,
    map_advice              TEXT,
    map_target              TEXT,
    correlation_id          BIGINT  NOT NULL,
    map_category_id         BIGINT  NOT NULL
);

CREATE INDEX extended_map_referenced_component_id_idx
    ON snomed.extended_map (referenced_component_id);

-- ----------------------------------------------------------------------------
-- 5. Simple Map (refset)
--    der2_sRefset_SimpleMapSnapshot_INT_20260201.txt (~556k rows)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.simple_map (
    id                      UUID    PRIMARY KEY,
    effective_time          INTEGER NOT NULL,
    effective_date          DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active                  BOOLEAN NOT NULL,
    module_id               BIGINT  NOT NULL,
    refset_id               BIGINT  NOT NULL,
    referenced_component_id BIGINT  NOT NULL,
    map_target              TEXT
);

CREATE INDEX simple_map_referenced_component_id_idx
    ON snomed.simple_map (referenced_component_id);

-- ----------------------------------------------------------------------------
-- 6. Text Definitions
--    sct2_TextDefinition_Snapshot-en_INT_20260201.txt (~19k rows)
--    Same column set as Description.
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.text_definitions (
    id                   BIGINT  PRIMARY KEY,
    effective_time       INTEGER NOT NULL,
    effective_date       DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active               BOOLEAN NOT NULL,
    module_id            BIGINT  NOT NULL,
    concept_id           BIGINT  NOT NULL,
    language_code        TEXT    NOT NULL,
    type_id              BIGINT  NOT NULL,
    term                 TEXT    NOT NULL,
    case_significance_id BIGINT  NOT NULL
);

CREATE INDEX text_definitions_concept_id_idx
    ON snomed.text_definitions (concept_id);

-- ----------------------------------------------------------------------------
-- 7. OWL Expressions (refset)
--    sct2_sRefset_OWLExpressionSnapshot_INT_20260201.txt (~412k rows)
-- ----------------------------------------------------------------------------
CREATE TABLE snomed.owl_expressions (
    id                      UUID    PRIMARY KEY,
    effective_time          INTEGER NOT NULL,
    effective_date          DATE GENERATED ALWAYS AS (
        make_date(effective_time / 10000,
                  (effective_time / 100) % 100,
                  effective_time % 100)
    ) STORED,
    active                  BOOLEAN NOT NULL,
    module_id               BIGINT  NOT NULL,
    refset_id               BIGINT  NOT NULL,
    referenced_component_id BIGINT  NOT NULL,
    owl_expression          TEXT    NOT NULL
);

CREATE INDEX owl_expressions_referenced_component_id_idx
    ON snomed.owl_expressions (referenced_component_id);
