-- Pipelines: the transformation that used to live inside a data channel.
--
-- A channel welded one webhook to one linear list of steps, so it could not
-- express a join, a second output, or a source it did not own. A pipeline is
-- the same work as a graph: nodes carry their own config, edges carry which
-- output feeds which input, and the shape is whatever the data needs.
--
-- Nodes and edges are stored as JSONB on the pipeline rather than as their own
-- tables. The whole graph is read and written together every time — there is no
-- query that wants one node in isolation — and keeping it in one row means an
-- edit is one atomic update instead of a diff across three tables.

CREATE TABLE IF NOT EXISTS app.pipeline (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  -- [{ id, kind, name, x, y, config }]
  nodes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ from, to, toPort }] — toPort names the input for two-input nodes.
  edges         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'live', 'paused')),
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,
  last_error    TEXT,
  created_by    UUID REFERENCES app.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_project_slug_key
  ON app.pipeline (project_id, slug);
CREATE INDEX IF NOT EXISTS pipeline_project_idx ON app.pipeline (project_id);

-- One execution. Per-node counts live in node_stats so the canvas can show
-- where rows were lost without replaying the run.
CREATE TABLE IF NOT EXISTS app.pipeline_run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   UUID NOT NULL REFERENCES app.pipeline(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'succeeded', 'failed')),
  trigger       TEXT NOT NULL DEFAULT 'manual'
                CHECK (trigger IN ('manual', 'preview', 'stream', 'schedule')),
  rows_in       INTEGER NOT NULL DEFAULT 0,
  rows_out      INTEGER NOT NULL DEFAULT 0,
  -- { <nodeId>: { in, out, dropped, ms, error } }
  node_stats    JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pipeline_run_pipeline_idx
  ON app.pipeline_run (pipeline_id, started_at DESC);
