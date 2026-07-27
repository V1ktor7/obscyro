-- ============================================================================
-- Organization hierarchy: a network coordinates institutions, but is not
-- itself a data custodian.
--
-- The boundary that matters legally is custodianship, so:
--   institution — holds data, answers for a breach
--   network     — groups institutions for shared projects and roll-up
--                 reporting; holds no patient data and inherits NO access
--
-- Parent linkage is deliberately not an access grant. Any visibility a network
-- has into a member's data must be an explicit, audited grant per shared
-- project, otherwise the sovereignty gate has a silent door in it.
-- ============================================================================

ALTER TABLE app.organizations
    ADD COLUMN IF NOT EXISTS parent_organization_id UUID
        REFERENCES app.organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'institution'
        CHECK (kind IN ('institution', 'network'));

CREATE INDEX IF NOT EXISTS organizations_parent_idx
    ON app.organizations (parent_organization_id);

-- Guard against a cycle (an org that is its own ancestor), which would make
-- hierarchy traversal loop forever.
CREATE OR REPLACE FUNCTION app.organizations_no_cycle()
RETURNS TRIGGER AS $$
DECLARE
    cursor_id UUID := NEW.parent_organization_id;
    hops INT := 0;
BEGIN
    WHILE cursor_id IS NOT NULL AND hops < 32 LOOP
        IF cursor_id = NEW.id THEN
            RAISE EXCEPTION 'organization parent cycle detected for %', NEW.id;
        END IF;
        SELECT parent_organization_id INTO cursor_id
          FROM app.organizations WHERE id = cursor_id;
        hops := hops + 1;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_no_cycle_trg ON app.organizations;
CREATE TRIGGER organizations_no_cycle_trg
    BEFORE INSERT OR UPDATE OF parent_organization_id ON app.organizations
    FOR EACH ROW EXECUTE FUNCTION app.organizations_no_cycle();
