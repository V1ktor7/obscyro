-- Scenarios become an overlay rather than a copy.
--
-- Migration 014 already created scenario_override with target_type/op/payload
-- — the right model — and 018 then added scenario_instance and scenario_link,
-- a full copy of the graph, which is what the code actually uses. The copy has
-- two problems: it is frozen at clone time, so it drifts as reality moves, and
-- it lives in tables nothing else reads, so the twin can never render a
-- scenario and alert rules can never evaluate one.
--
-- This completes the override model. The copy tables stay and keep working —
-- they are retired once reads can resolve overrides, not before.

-- --- the scenario itself -----------------------------------------------------

ALTER TABLE app.scenario
    -- Variants branch from a parent; resolution applies the parent's overrides
    -- first, then the child's. That is the whole "Variant A / Variant B"
    -- feature, with no second concept.
    ADD COLUMN IF NOT EXISTS parent_scenario_id UUID NULL
        REFERENCES app.scenario(id) ON DELETE CASCADE,
    -- NULL = overlay live reality, so the scenario moves as the world does.
    -- Set = pinned to an instant, so a run is reproducible. Operations wants
    -- the first, research wants the second; one nullable column serves both.
    ADD COLUMN IF NOT EXISTS base_as_of TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS description TEXT NULL,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scenario_status_check') THEN
        ALTER TABLE app.scenario ADD CONSTRAINT scenario_status_check
            CHECK (status IN ('draft', 'ready', 'submitted', 'archived'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS scenario_parent_idx
    ON app.scenario (parent_scenario_id) WHERE parent_scenario_id IS NOT NULL;

-- A scenario that is its own ancestor would loop the resolver forever, and the
-- resolver walks that chain on every read once phase 3 lands.
CREATE OR REPLACE FUNCTION app.scenario_no_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_cursor UUID;
    v_depth  INTEGER := 0;
BEGIN
    IF NEW.parent_scenario_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_scenario_id = NEW.id THEN
        RAISE EXCEPTION 'scenario %: cannot be its own parent', NEW.id;
    END IF;

    v_cursor := NEW.parent_scenario_id;
    WHILE v_cursor IS NOT NULL LOOP
        v_depth := v_depth + 1;
        IF v_depth > 32 THEN
            RAISE EXCEPTION 'scenario %: parent chain deeper than 32', NEW.id;
        END IF;
        IF v_cursor = NEW.id THEN
            RAISE EXCEPTION 'scenario %: parent chain forms a cycle', NEW.id;
        END IF;
        SELECT parent_scenario_id INTO v_cursor FROM app.scenario WHERE id = v_cursor;
    END LOOP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scenario_no_cycle_trg ON app.scenario;
CREATE TRIGGER scenario_no_cycle_trg
    BEFORE INSERT OR UPDATE OF parent_scenario_id ON app.scenario
    FOR EACH ROW EXECUTE FUNCTION app.scenario_no_cycle();

-- --- the overrides -----------------------------------------------------------

ALTER TABLE app.scenario_override
    -- Deterministic order. Later wins on the same target and property, and
    -- created_at is not good enough: two overrides added in the same
    -- millisecond would resolve arbitrarily.
    ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0,
    -- A scenario that creates something has nothing to point at yet. "Open a
    -- new isolation ward, then route patients into it" needs the ward to have
    -- a name inside the scenario before it has an id in the ontology.
    ADD COLUMN IF NOT EXISTS target_local_key TEXT NULL,
    -- Offsets, not timestamps: a scenario re-run next month should not need
    -- every event edited.
    ADD COLUMN IF NOT EXISTS effective_offset_hours INTEGER NOT NULL DEFAULT 0,
    -- NULL = permanent. Set = the effect reverses after this many hours.
    ADD COLUMN IF NOT EXISTS duration_hours INTEGER NULL,
    ADD COLUMN IF NOT EXISTS note TEXT NULL;

-- The table has never been written to — nothing in the codebase references it —
-- but the constraints are added defensively so a surprise row cannot fail a
-- deploy for the whole platform.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scenario_override_target_type_check')
       AND NOT EXISTS (SELECT 1 FROM app.scenario_override
                        WHERE target_type NOT IN ('instance', 'link', 'param')) THEN
        ALTER TABLE app.scenario_override ADD CONSTRAINT scenario_override_target_type_check
            CHECK (target_type IN ('instance', 'link', 'param'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scenario_override_op_check')
       AND NOT EXISTS (SELECT 1 FROM app.scenario_override
                        WHERE op NOT IN ('create', 'set_property', 'delete',
                                         'link', 'unlink', 'set_param')) THEN
        ALTER TABLE app.scenario_override ADD CONSTRAINT scenario_override_op_check
            CHECK (op IN ('create', 'set_property', 'delete',
                          'link', 'unlink', 'set_param'));
    END IF;
END $$;

-- Resolution reads a scenario's overrides in order, filtered by the offset it
-- is being read at.
CREATE INDEX IF NOT EXISTS scenario_override_order_idx
    ON app.scenario_override (scenario_id, effective_offset_hours, seq);

CREATE INDEX IF NOT EXISTS scenario_override_local_key_idx
    ON app.scenario_override (scenario_id, target_local_key)
 WHERE target_local_key IS NOT NULL;
