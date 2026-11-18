-- Les décisions : ce qu'une personne a retenu, et le résultat qu'elle en
-- attendait au moment de le retenir.
--
-- La boucle d'aide à la décision se ferme ici. L'analyste propose des options
-- et le moteur les teste ; c'est une personne qui choisit. Pour pouvoir, plus
-- tard, confronter ce choix à ce qui est arrivé, il faut avoir gardé ce qu'on
-- en attendait : sans cela on ne compare qu'un souvenir à un résultat.
--
-- Une ligne par décision :
--
--   objective      l'objectif tel que la personne l'a écrit ;
--   option_label   l'option retenue, en une ligne ;
--   option_stamps  ses tampons, tels que la page les écrit dans un scénario ;
--   expected       les chiffres du run testé : avec l'option et sans, les sites
--                  où l'on attend, les arrivées jour par jour, et ce sur quoi
--                  le run repose avec son niveau de preuve ;
--   source_steps   les étapes de l'analyste dont ces chiffres sortent, entrée
--                  et résultat compris.
--
-- Les chiffres ne viennent jamais du navigateur. Ils sont recopiés par le
-- serveur depuis l'échange journalisé (app.analyst_exchange, étape
-- `test_option`) : on ne peut enregistrer qu'une option que le moteur a
-- réellement testée.
--
-- La ligne se suffit à elle-même. Elle garde le nom du scénario et une copie
-- des étapes, pour rester lisible si le scénario ou l'échange disparaît.
-- Rien n'est modifié après l'insertion : une décision qu'on revoit est une
-- nouvelle décision. Données agrégées seulement, comme partout dans la boucle.

CREATE TABLE IF NOT EXISTS app.decision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    -- Gardés même si le scénario est supprimé ensuite : la décision reste lisible.
    scenario_id UUID NULL,
    scenario_name TEXT NOT NULL,
    -- L'échange où l'option a été testée, et l'étape du test dans cet échange.
    exchange_id UUID NULL REFERENCES app.analyst_exchange(id) ON DELETE SET NULL,
    option_step TEXT NOT NULL,

    objective TEXT NOT NULL,
    option_label TEXT NOT NULL,
    option_stamps JSONB NOT NULL,
    expected JSONB NOT NULL,
    source_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    note TEXT NULL,

    decided_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS decision_project_recent
    ON app.decision (project_id, decided_at DESC);
