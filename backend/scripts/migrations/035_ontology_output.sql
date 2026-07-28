-- ============================================================================
-- Ontology output: bind a dataset to an object type.
--
-- This is the last edge of the chain — Source → Sync → Dataset → Ontology —
-- and the piece that makes the ontology derived rather than hand-fed.
--
-- Foundry's semantics, adopted directly: a primary key identifies the object,
-- columns map to properties, and a re-run UPSERTS (updates rows matching the
-- key, inserts the rest) rather than replacing. That is exactly what
-- upsertInstanceByIdentity already does for the Map step.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.object_type_datasource (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID        NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    object_type_id UUID        NOT NULL REFERENCES app.ontology_object_types(id) ON DELETE CASCADE,
    dataset_id     UUID        NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    -- Target properties forming the natural key. Without one, a re-run would
    -- duplicate every row instead of updating it.
    identity_properties TEXT[] NOT NULL DEFAULT '{}',
    -- [{ column, property, coerce }] — same rule shape the Map step uses, so
    -- the transform and its coercion behaviour are shared, not reimplemented.
    column_mapping JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- Stream-backed types cannot be hand-edited: the next materialize would
    -- overwrite the edit. Recorded so the UI can say so rather than lose work.
    writeback      BOOLEAN     NOT NULL DEFAULT false,
    last_synced_at TIMESTAMPTZ,
    last_status    TEXT,
    last_error     TEXT,
    created_by     UUID        REFERENCES app.users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One binding per (type, dataset) pair; a type may be fed by several
    -- datasets, and a dataset may feed several types.
    UNIQUE (object_type_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS object_type_datasource_project_idx
    ON app.object_type_datasource (project_id);
CREATE INDEX IF NOT EXISTS object_type_datasource_type_idx
    ON app.object_type_datasource (object_type_id);
CREATE INDEX IF NOT EXISTS object_type_datasource_dataset_idx
    ON app.object_type_datasource (dataset_id);
