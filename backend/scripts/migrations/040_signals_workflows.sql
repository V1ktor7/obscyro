-- Les verbes.
--
-- L'ontologie n'a que des noms : types d'objets, types de liens. Palantir le
-- dit dans sa propre documentation d'architecture — « les objets, les noms,
-- doivent être complétés par des verbes pour modéliser des décisions ; la
-- sémantique doit être appariée à la cinétique ». Il manque la cinétique.
--
-- Un signal est quelque chose qui demande une suite. Il traverse un flux de
-- travail jusqu'à être clos, et chaque pas laisse une trace de qui a décidé
-- quoi. Rien de tout cela n'est codé en dur : les domaines, les flux et leurs
-- étapes sont des lignes, définies par établissement. Le CHUM écrit
-- « Suspecté → Investigué → Mesures » ; un autre écrit autre chose ; le moteur
-- ne change pas.
--
-- twin_alert reste : c'est une *source* de signaux, pas leur modèle. Une alerte
-- ne concerne qu'une unité, alors qu'un flux mort ou une rupture de stock n'ont
-- pas d'unité du tout.

-- --- le flux de travail, défini par l'établissement ---------------------------

CREATE TABLE IF NOT EXISTS app.workflow (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    key              TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    description      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS app.workflow_stage (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id       UUID        NOT NULL REFERENCES app.workflow(id) ON DELETE CASCADE,
    seq               INTEGER     NOT NULL,
    key               TEXT        NOT NULL,
    name              TEXT        NOT NULL,
    -- L'étape où quelqu'un signe. C'est ce qui manquait à ma maquette : un
    -- remplacement de personnel ou une substitution d'antibiotique ne devrait
    -- pas avancer sans que le système sache qui l'a autorisé.
    requires_approval BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Une étape terminale clôt le signal. Il y en a plusieurs sortes : résolu,
    -- levé, ou rejeté comme faux positif — et les distinguer est la seule
    -- façon de mesurer son taux de fausses alertes.
    is_terminal       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workflow_id, key),
    UNIQUE (workflow_id, seq)
);

-- --- le type de signal --------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.signal_type (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID        NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    key              TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    -- Texte libre, délibérément. Une liste fermée de domaines suppose qu'on
    -- connaît d'avance tout ce qui peut arriver dans un réseau de santé, ce
    -- qui est faux. L'établissement nomme les siens.
    domain           TEXT        NOT NULL,
    workflow_id      UUID        NOT NULL REFERENCES app.workflow(id) ON DELETE RESTRICT,
    default_severity TEXT        NOT NULL DEFAULT 'warn'
                                 CHECK (default_severity IN ('info', 'warn', 'critical')),
    description      TEXT,
    active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, key)
);

CREATE INDEX IF NOT EXISTS signal_type_domain_idx
    ON app.signal_type (organization_id, domain) WHERE active;

-- --- le signal ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.signal (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID        NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    signal_type_id UUID        NOT NULL REFERENCES app.signal_type(id) ON DELETE RESTRICT,
    stage_id       UUID        NOT NULL REFERENCES app.workflow_stage(id) ON DELETE RESTRICT,
    -- Le sujet n'est pas toujours une unité. Un flux arrêté porte sur une
    -- synchro, une rupture de stock sur un jeu de données, une éclosion sur
    -- une unité. Le vocabulaire suit celui de resource_reference.
    subject_kind   TEXT        NOT NULL DEFAULT 'none'
                               CHECK (subject_kind IN ('none', 'object_instance', 'dataset',
                                                       'source', 'sync', 'pipeline',
                                                       'object_type', 'model')),
    subject_id     UUID        NULL,
    title          TEXT        NOT NULL,
    detail         TEXT,
    severity       TEXT        NOT NULL DEFAULT 'warn'
                               CHECK (severity IN ('info', 'warn', 'critical')),
    -- Charge utile propre au type : seuil franchi, code SNOMED, jours de stock.
    properties     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Un signal peut exister dans un scénario — une fermeture planifiée est un
    -- signal comme un autre, mais elle ne concerne pas la réalité.
    scenario_id    UUID        NULL REFERENCES app.scenario(id) ON DELETE CASCADE,
    -- D'où il vient, quand il en vient d'ailleurs.
    origin_kind    TEXT        NOT NULL DEFAULT 'manual'
                               CHECK (origin_kind IN ('manual', 'twin_alert', 'pipeline',
                                                      'sync', 'rule')),
    origin_id      UUID        NULL,
    -- Clé de déduplication : une règle qui se déclenche à chaque tick ne doit
    -- pas produire un signal par tick. Nul = pas de dédoublonnage.
    dedupe_key     TEXT        NULL,
    closed_at      TIMESTAMPTZ NULL,
    closed_reason  TEXT        NULL,
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signal_project_open_idx
    ON app.signal (project_id, detected_at DESC) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS signal_stage_idx ON app.signal (stage_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS signal_subject_idx ON app.signal (subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS signal_scenario_idx
    ON app.signal (scenario_id) WHERE scenario_id IS NOT NULL;

-- Un seul signal ouvert par clé de dédoublonnage.
CREATE UNIQUE INDEX IF NOT EXISTS signal_dedupe_open_idx
    ON app.signal (project_id, signal_type_id, dedupe_key)
 WHERE dedupe_key IS NOT NULL AND closed_at IS NULL;

-- --- la trace -----------------------------------------------------------------

-- En ajout seulement. C'est la réponse à « qui a décidé ça, et quand » — la
-- question qu'on posera après coup, et la seule qui compte en santé.
CREATE TABLE IF NOT EXISTS app.signal_event (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id      UUID        NOT NULL REFERENCES app.signal(id) ON DELETE CASCADE,
    seq            INTEGER     NOT NULL,
    kind           TEXT        NOT NULL
                               CHECK (kind IN ('detected', 'advanced', 'reverted', 'noted',
                                               'approved', 'option_taken', 'closed',
                                               'dismissed', 'reopened')),
    from_stage_id  UUID        NULL REFERENCES app.workflow_stage(id) ON DELETE SET NULL,
    to_stage_id    UUID        NULL REFERENCES app.workflow_stage(id) ON DELETE SET NULL,
    actor_user_id  UUID        NULL REFERENCES app.users(id) ON DELETE SET NULL,
    note           TEXT,
    payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (signal_id, seq)
);

CREATE INDEX IF NOT EXISTS signal_event_signal_idx
    ON app.signal_event (signal_id, seq);

-- La trace ne se réécrit pas. Même règle que app.audit_log : un journal qu'on
-- peut modifier après coup ne prouve rien.
CREATE OR REPLACE FUNCTION app.signal_event_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'signal_event is append-only (attempted %)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS signal_event_immutable_trg ON app.signal_event;
CREATE TRIGGER signal_event_immutable_trg
    BEFORE UPDATE OR DELETE ON app.signal_event
    FOR EACH ROW EXECUTE FUNCTION app.signal_event_immutable();

-- --- comment on calcule les options ------------------------------------------

-- Une règle produit des candidats classés sur des faits mesurables. Le genre de
-- règle est une valeur connue du moteur ; ce qu'elle vise et ses paramètres
-- sont de la configuration.
CREATE TABLE IF NOT EXISTS app.response_rule (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_type_id UUID        NOT NULL REFERENCES app.signal_type(id) ON DELETE CASCADE,
    seq            INTEGER     NOT NULL DEFAULT 0,
    name           TEXT        NOT NULL,
    kind           TEXT        NOT NULL,
    config         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    active         BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS response_rule_type_idx
    ON app.response_rule (signal_type_id, seq) WHERE active;
