-- Les réponses préparées : ce qu'on a testé à froid pour un type de signal,
-- prêt à être engagé quand un signal de ce type se lève.
--
-- Dans l'urgence on ne bâtit pas un scénario : on applique ce qui a été
-- préparé. Une réponse préparée est une option que le moteur a réellement
-- testée (onglet Options de l'analyste), qu'une personne a choisi de garder
-- pour un type de signal. Le jour où un signal de ce type s'ouvre, sa fiche de
-- situation la montre avec les chiffres de son test, et un clic l'engage.
--
-- Pourquoi une table à elle, alors que app.response_rule existe depuis la
-- migration 040 et que rien ne la remplit : une règle de réponse décrit un
-- calcul qui produit des candidats classés. Une réponse préparée n'est ni
-- calculée ni classée : c'est un test gardé tel quel, avec sa date et l'état
-- sur lequel il a tourné. Les deux ne sont pas la même chose, et les ranger
-- ensemble aurait fait passer l'une pour l'autre.
--
-- Une ligne par réponse gardée :
--
--   label          l'étiquette, telle que la personne la lit sur la fiche ;
--   approver       qui peut l'approuver, en mots : un rôle, jamais un compte ;
--   objective, option_stamps, expected, source_steps
--                  recopiés par le serveur depuis l'échange journalisé
--                  (app.analyst_exchange, étape `test_option`), comme pour une
--                  décision : on ne peut garder qu'une option que le moteur a
--                  testée, et aucun chiffre ne vient du navigateur ;
--   tested_at      quand le moteur a fait ce test : la date de l'échange ;
--   scenario_mark  l'empreinte des choix du scénario au moment où la réponse a
--                  été gardée. Si le scénario change ensuite, l'empreinte ne
--                  correspond plus et la fiche dit que le test porte sur un
--                  autre état.
--
-- Rien n'est modifié après l'insertion, sauf `retired_at` : une réponse qu'on
-- ne veut plus voir proposée est retirée, pas effacée, parce que des décisions
-- peuvent s'y référer. Données agrégées seulement.

CREATE TABLE IF NOT EXISTS app.prepared_response (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    signal_type_id UUID NOT NULL REFERENCES app.signal_type(id) ON DELETE CASCADE,

    label TEXT NOT NULL,
    approver TEXT NULL,

    -- L'échange où l'option a été testée, et l'étape du test dans cet échange.
    exchange_id UUID NULL REFERENCES app.analyst_exchange(id) ON DELETE SET NULL,
    option_step TEXT NOT NULL,
    -- Gardés même si le scénario est supprimé ensuite : la réponse reste lisible.
    scenario_id UUID NULL,
    scenario_name TEXT NOT NULL,
    scenario_mark TEXT NULL,

    objective TEXT NOT NULL,
    option_stamps JSONB NOT NULL,
    expected JSONB NOT NULL,
    source_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    tested_at TIMESTAMPTZ NOT NULL,

    kept_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    kept_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS prepared_response_for_type
    ON app.prepared_response (project_id, signal_type_id, kept_at)
    WHERE retired_at IS NULL;

-- Une décision peut maintenant être prise sur un signal, en engageant une
-- réponse préparée. Les deux colonnes sont vides pour une décision
-- enregistrée depuis l'onglet Options, comme avant.
ALTER TABLE app.decision
    ADD COLUMN IF NOT EXISTS signal_id UUID NULL REFERENCES app.signal(id) ON DELETE SET NULL;
ALTER TABLE app.decision
    ADD COLUMN IF NOT EXISTS prepared_response_id UUID NULL REFERENCES app.prepared_response(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS decision_for_signal
    ON app.decision (signal_id) WHERE signal_id IS NOT NULL;
