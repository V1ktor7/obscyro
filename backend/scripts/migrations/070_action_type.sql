-- ============================================================================
-- Ce que l'analyste peut proposer se règle depuis le Studio.
-- Migration 070 : app.action_type et app.project_analyst_tool_off
-- ============================================================================
--
-- Ce qu'une option de l'analyste pouvait contenir était une liste fixe dans le
-- code : de la capacité, une mesure, un transfert de patients, une réponse
-- enregistrée. Un établissement qui voulait qu'il propose « ouvrir des lits de
-- débordement, de dix à soixante, dans ces trois sites, et c'est la direction
-- des soins qui approuve » n'avait nulle part où l'écrire.
--
-- 1. app.action_type : les types d'action d'un projet.
--
--      key          le nom que l'analyste donne dans un test (« capacity »,
--                   « ouvrir-des-lits-de-debordement »). Unique dans le projet ;
--      name         en mots de l'établissement ;
--      description  ce que c'est, pour une personne et pour l'analyste ;
--      effect       ce que le type change, parmi ce qu'un run sait changer :
--                   capacity (des unités d'une activité à un site), measure
--                   (des couches de contact), transfer (des patients en attente
--                   envoyés d'un site à un autre), response (une réponse
--                   enregistrée que le run suit) ;
--      bounds       ses bornes, selon ce qu'il change : une plage d'unités, les
--                   sites permis, l'activité, le mode de la liste de prix ; les
--                   couches et la plage de leur facteur, le nombre de jours,
--                   les territoires ; les patients par jour et les deux bouts ;
--                   les réponses permises. Une borne absente n'est pas une
--                   borne à zéro : rien ne limite de ce côté ;
--      lead_days    les jours qu'il faut avant qu'il puisse s'appliquer, comptés
--                   depuis la décision (le jour 0 d'un run). Vide : aucun
--                   délai déclaré ;
--      approver     qui peut l'approuver, en mots ;
--      active       éteint, il n'est plus proposé.
--
--    Chaque projet part avec quatre types intégrés, un par effet, sans borne
--    et actifs : ce que l'analyste pouvait proposer avant cette table. Ils ne
--    sont pas écrits ici. Un projet sans aucune ligne se comporte donc
--    exactement comme avant. Une ligne sous la clé d'un type intégré
--    (« capacity », « measure », « transfer », « response ») est ce que le
--    projet y a changé ; la retirer rend le type tel qu'il était.
--
--    Un type d'action ne donne aucun droit d'écrire : une option qui en relève
--    est toujours testée par le moteur, et toujours appliquée par le clic
--    d'une personne. Et il ne vise rien par son nom : une activité, une couche
--    ou un site qu'il nomme sont ceux que le jumeau déclare.
--
-- 2. app.project_analyst_tool_off : les outils de l'analyste qu'un projet a
--    éteints. Les outils restent du code ; un projet peut seulement en retirer
--    un de ce que l'analyste a sous la main, la recherche en ligne par exemple.
--    Une ligne veut dire « éteint » ; aucune ligne, tout est offert comme
--    avant.
--
-- Ce sont des réglages d'un projet, jamais des données sur des personnes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.action_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    key TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    effect TEXT NOT NULL CHECK (effect IN ('capacity', 'measure', 'transfer', 'response')),
    bounds JSONB NOT NULL DEFAULT '{}'::jsonb,
    lead_days INT NULL CHECK (lead_days IS NULL OR lead_days >= 0),
    approver TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS app.project_analyst_tool_off (
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    switched_off_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    switched_off_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, tool)
);
