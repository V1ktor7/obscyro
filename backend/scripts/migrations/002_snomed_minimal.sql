-- ============================================================================
-- Empty SNOMED shell so migrations 003 (index) and 004 (closure) can apply
-- before `npm run import:snomed`. Replace data later via RF2 import.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE SCHEMA IF NOT EXISTS snomed;

CREATE TABLE IF NOT EXISTS snomed.concepts (
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

CREATE TABLE IF NOT EXISTS snomed.descriptions (
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

CREATE TABLE IF NOT EXISTS snomed.relationships (
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
