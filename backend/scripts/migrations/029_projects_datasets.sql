-- ============================================================================
-- The data spine: projects own resources, datasets sit between a source and
-- the ontology, and references make the dependency order explicit.
--
-- Datasets come in two kinds from the start, because retrofitting streaming
-- onto a batch-only design means rewriting the write path:
--   table  — versioned snapshots (uploads, derived outputs); time travel
--   stream — append-only log with a retention window (webhooks, feeds);
--            event-triggered downstream, so live ingestion keeps its latency
-- ============================================================================

-- --- 1. Project: the resource-owning unit inside an environment -------------

CREATE TABLE IF NOT EXISTS app.project (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id  UUID        NOT NULL REFERENCES app.ontology_environments(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL,
    description     TEXT,
    -- Folder path within the project tree, e.g. '/' or '/raw'.
    path            TEXT        NOT NULL DEFAULT '/',
    status          TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'archived')),
    created_by      UUID        REFERENCES app.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (environment_id, slug)
);

CREATE INDEX IF NOT EXISTS project_environment_idx ON app.project (environment_id);

-- Every existing environment gets a default project so nothing is orphaned
-- and the project tab bar is populated on first load.
INSERT INTO app.project (environment_id, name, slug, description)
SELECT e.id, e.name, 'default', 'Default project for this environment.'
  FROM app.ontology_environments e
ON CONFLICT (environment_id, slug) DO NOTHING;

-- --- 2. Datasets ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.dataset (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID        NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL,
    kind            TEXT        NOT NULL DEFAULT 'table'
                                CHECK (kind IN ('table', 'stream')),
    description     TEXT,
    path            TEXT        NOT NULL DEFAULT '/',
    -- [{ name, type, nullable }] inferred on load, editable afterwards.
    column_schema   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    row_count       BIGINT      NOT NULL DEFAULT 0,
    -- Streams persist raw payloads, so a retention window is mandatory rather
    -- than optional: unbounded PHI at rest is a governance problem.
    retention_days  INT         NOT NULL DEFAULT 30,
    source_id       UUID        REFERENCES app.ingest_sources(id) ON DELETE SET NULL,
    last_written_at TIMESTAMPTZ,
    created_by      UUID        REFERENCES app.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, slug)
);

CREATE INDEX IF NOT EXISTS dataset_project_idx ON app.dataset (project_id);
CREATE INDEX IF NOT EXISTS dataset_kind_idx ON app.dataset (kind);

-- Immutable snapshots for table datasets. Streams do not create versions —
-- their history is the append log itself, bounded by retention.
CREATE TABLE IF NOT EXISTS app.dataset_version (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id    UUID        NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    version       INT         NOT NULL,
    kind          TEXT        NOT NULL DEFAULT 'snapshot'
                              CHECK (kind IN ('snapshot', 'append', 'update', 'delete')),
    row_count     BIGINT      NOT NULL DEFAULT 0,
    column_schema JSONB       NOT NULL DEFAULT '[]'::jsonb,
    note          TEXT,
    created_by    UUID        REFERENCES app.users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, version)
);

CREATE INDEX IF NOT EXISTS dataset_version_dataset_idx
    ON app.dataset_version (dataset_id, version DESC);

-- Row storage. JSONB keeps the shape flexible while the schema is inferred;
-- Postgres is the storage engine on purpose (do not build one).
CREATE TABLE IF NOT EXISTS app.dataset_row (
    id          BIGSERIAL   PRIMARY KEY,
    dataset_id  UUID        NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    -- NULL for stream appends; set for rows belonging to a table snapshot.
    version_id  UUID        REFERENCES app.dataset_version(id) ON DELETE CASCADE,
    data        JSONB       NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dataset_row_dataset_time_idx
    ON app.dataset_row (dataset_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS dataset_row_version_idx
    ON app.dataset_row (version_id);

-- --- 3. Resource references: the dependency graph ---------------------------
-- Generic so any resource kind can depend on any other without a new table
-- each time. Powers the References panel and the deletion-impact warning.

CREATE TABLE IF NOT EXISTS app.resource_reference (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    from_type  TEXT        NOT NULL
                           CHECK (from_type IN ('source', 'dataset', 'pipeline',
                                                'channel', 'object_type', 'model')),
    from_id    TEXT        NOT NULL,
    to_type    TEXT        NOT NULL
                           CHECK (to_type IN ('source', 'dataset', 'pipeline',
                                              'channel', 'object_type', 'model')),
    to_id      TEXT        NOT NULL,
    kind       TEXT        NOT NULL DEFAULT 'reads'
                           CHECK (kind IN ('reads', 'writes', 'derives')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (from_type, from_id, to_type, to_id, kind)
);

CREATE INDEX IF NOT EXISTS resource_reference_from_idx
    ON app.resource_reference (from_type, from_id);
CREATE INDEX IF NOT EXISTS resource_reference_to_idx
    ON app.resource_reference (to_type, to_id);

-- --- 4. Ownership fix -------------------------------------------------------
-- ingest_sources was scoped to a user: a source belonged to a person rather
-- than a workspace, so it was invisible to the org and dangled if the user
-- was removed.

ALTER TABLE app.ingest_sources
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES app.project(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ingest_sources_project_idx
    ON app.ingest_sources (project_id);

-- Backfill: a source's home is the project of the environment whose channel
-- consumes it. Sources with no channel stay NULL and are adopted on next use.
UPDATE app.ingest_sources s
   SET project_id = p.id
  FROM app.data_channel c
  JOIN app.project p ON p.environment_id = c.environment_id AND p.slug = 'default'
 WHERE c.source_id = s.id
   AND s.project_id IS NULL;
