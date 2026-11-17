-- L'analyste : chaque question posée, ce qui a été lu pour y répondre, et la
-- réponse telle qu'elle a été affichée.
--
-- L'analyste est un modèle de langage qui lit le jumeau par des outils. Sa
-- règle est qu'aucun chiffre n'apparaît sans qu'un outil l'ait renvoyé ; ce
-- qui rend la règle vérifiable après coup, c'est de garder l'échange entier.
-- Une ligne par question :
--
--   steps     chaque appel d'outil, son entrée et ce qu'il a renvoyé, dans
--             l'ordre ;
--   answer    les paragraphes affichés, chacun avec les étapes qu'il cite ;
--   struck    les chiffres retirés de la réponse parce qu'aucune étape citée
--             ne les contenait ;
--   verified  vrai quand rien n'a dû être retiré.
--
-- Rien n'est modifié après l'insertion : c'est un journal, pas un brouillon.
-- La question d'une personne est la sienne ; la ligne tombe avec le projet.

CREATE TABLE IF NOT EXISTS app.analyst_exchange (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    -- Le scénario ouvert au moment de la question, s'il y en avait un. Gardé
    -- même si le scénario est supprimé ensuite : la trace reste lisible.
    scenario_id UUID NULL,
    asked_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,

    question TEXT NOT NULL,
    looking TEXT NOT NULL CHECK (looking IN ('reality', 'scenario')),

    status TEXT NOT NULL CHECK (status IN ('answered', 'declined', 'incomplete', 'failed')),
    answer JSONB NULL,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    struck JSONB NOT NULL DEFAULT '[]'::jsonb,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT NULL,

    model TEXT NOT NULL,
    usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analyst_exchange_project_recent
    ON app.analyst_exchange (project_id, created_at DESC);
