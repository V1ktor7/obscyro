-- The review queue stops belonging to channels.
--
-- Low-confidence extractions are queued for a human rather than discarded, and
-- that is worth keeping when the extraction moves into a pipeline node. The
-- table was keyed to channel_id NOT NULL, so a pipeline could not write to it
-- at all.
--
-- Renamed rather than duplicated: two review queues would mean two inboxes, and
-- whichever one a reviewer did not open would quietly accumulate clinical
-- findings nobody looked at. Existing rows keep their channel_id and stay
-- visible in the same queue.

ALTER TABLE IF EXISTS app.channel_review_item RENAME TO review_item;

DO $$
BEGIN
  -- Either a channel or a pipeline produced the item, never both.
  ALTER TABLE app.review_item ALTER COLUMN channel_id DROP NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'app' AND table_name = 'review_item'
       AND column_name = 'pipeline_id'
  ) THEN
    ALTER TABLE app.review_item
      ADD COLUMN pipeline_id UUID REFERENCES app.pipeline(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'app' AND table_name = 'review_item'
       AND column_name = 'node_id'
  ) THEN
    -- Which node flagged it, so the reviewer can go back to the rule.
    ALTER TABLE app.review_item ADD COLUMN node_id TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_item_one_origin'
  ) THEN
    ALTER TABLE app.review_item
      ADD CONSTRAINT review_item_one_origin
      CHECK (num_nonnulls(channel_id, pipeline_id) = 1);
  END IF;
END $$;

ALTER INDEX IF EXISTS app.channel_review_item_env_status_idx
  RENAME TO review_item_project_status_idx;
ALTER INDEX IF EXISTS app.channel_review_item_channel_idx
  RENAME TO review_item_channel_idx;

CREATE INDEX IF NOT EXISTS review_item_pipeline_idx
  ON app.review_item (pipeline_id) WHERE pipeline_id IS NOT NULL;
