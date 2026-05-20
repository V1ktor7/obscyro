-- Populates snomed.transitive_closure from active IS-A edges via semi-naive iteration.
-- Backs /v1/concepts/:code/ancestors and /v1/concepts/:code/descendants.
-- Sync this body with the populate section of migrations/004_transitive_closure.sql.

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
