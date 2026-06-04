-- ============================================================================
-- SNOMED description embeddings for nlp-service pgvector search
-- Dimension 384 = paraphrase-multilingual-MiniLM-L12-v2
-- HNSW index created after bulk populate (see nlp-service/scripts/populate_embeddings.py)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS snomed.description_embeddings (
    id              BIGSERIAL PRIMARY KEY,
    description_id  BIGINT NOT NULL UNIQUE,
    concept_id      BIGINT NOT NULL,
    term            TEXT NOT NULL,
    language_code   TEXT NOT NULL,
    type_id         BIGINT NOT NULL,
    embedding       vector(384) NOT NULL
);

CREATE INDEX IF NOT EXISTS description_embeddings_concept_id_idx
    ON snomed.description_embeddings (concept_id);
