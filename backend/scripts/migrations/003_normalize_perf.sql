-- ============================================================================
-- Obscyro: normalize /normalize exact_matches fast path
-- Migration 003: functional index on lower(term) for active descriptions
-- ============================================================================

CREATE INDEX IF NOT EXISTS descriptions_lower_term_idx
    ON snomed.descriptions (lower(term))
    WHERE active = true;
