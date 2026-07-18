-- ============================================================================
-- Obscyro: webhook-fed data channels.
-- Migration 024: bind a data channel to the ingest source that feeds it.
--   When an inbound webhook (or REST intake with sourceId) stores an event,
--   live channels bound to that source execute server-side.
-- ============================================================================

ALTER TABLE app.data_channel
    ADD COLUMN IF NOT EXISTS source_id UUID NULL
        REFERENCES app.ingest_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS data_channel_source_idx
    ON app.data_channel (source_id)
    WHERE source_id IS NOT NULL;
