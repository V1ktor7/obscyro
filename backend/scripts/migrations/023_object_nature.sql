-- ============================================================================
-- Obscyro: physical vs conceptual object types.
-- Migration 023: nature column on ontology_object_types.
--   * physical   — has a real-world extent; twin anchor (latitude/longitude)
--   * conceptual — grouping/classifier with no footprint of its own; renders
--                  on the twin only through its linked physical members
--   * NULL       — unspecified (legacy types keep working unchanged)
-- ============================================================================

ALTER TABLE app.ontology_object_types
    ADD COLUMN IF NOT EXISTS nature TEXT NULL
        CHECK (nature IS NULL OR nature IN ('physical', 'conceptual'));
