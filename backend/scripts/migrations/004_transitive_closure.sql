-- ============================================================================
-- Obscyro: pre-computed IS-A transitive closure for hierarchy endpoints
-- Migration 004: table + indexes + populate (semi-naive iterative)
-- Populate body is duplicated in scripts/sql/transitive_closure_populate.sql
-- (used by npm run build:tc and import:snomed).
-- ============================================================================

CREATE TABLE IF NOT EXISTS snomed.transitive_closure (
    ancestor_id   BIGINT   NOT NULL,
    descendant_id BIGINT   NOT NULL,
    depth         SMALLINT NOT NULL,
    PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX IF NOT EXISTS transitive_closure_anc_depth_idx
    ON snomed.transitive_closure (ancestor_id, depth, descendant_id);

CREATE INDEX IF NOT EXISTS transitive_closure_desc_depth_idx
    ON snomed.transitive_closure (descendant_id, depth, ancestor_id);

TRUNCATE snomed.transitive_closure;

DO $tc$
DECLARE
    added          BIGINT;
    iter           SMALLINT := 1;
    is_a_type_id   CONSTANT BIGINT := 116680003;
BEGIN
    INSERT INTO snomed.transitive_closure (ancestor_id, descendant_id, depth)
    SELECT destination_id, source_id, 1::SMALLINT
      FROM snomed.relationships
     WHERE type_id = is_a_type_id
       AND active = true
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS added = ROW_COUNT;
    RAISE NOTICE 'TC seed depth %: added %', iter, added;

    WHILE added > 0 AND iter < 30 LOOP
        iter := iter + 1;

        WITH ins AS (
            INSERT INTO snomed.transitive_closure (ancestor_id, descendant_id, depth)
            SELECT t.ancestor_id, r.source_id, iter::SMALLINT
              FROM snomed.transitive_closure t
              JOIN snomed.relationships r ON r.destination_id = t.descendant_id
             WHERE t.depth = iter - 1
               AND r.type_id = is_a_type_id
               AND r.active = true
            ON CONFLICT DO NOTHING
            RETURNING 1
        )
        SELECT COUNT(*) INTO added FROM ins;

        RAISE NOTICE 'TC depth %: added %', iter, added;
    END LOOP;

    RAISE NOTICE 'TC build finished at iter %', iter;
END $tc$;

ANALYZE snomed.transitive_closure;
