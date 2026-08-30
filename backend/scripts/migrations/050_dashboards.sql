-- Un tableau de bord est une composition, pas une analyse.
--
-- Contour et Quiver séparent les deux : l'analyse produit des planches, le
-- tableau de bord en choisit quelques-unes et les met en page. La séparation
-- vaut ici aussi, et pour une raison précise — une carte ne conserve aucune
-- donnée. Elle nomme une source qui existe déjà dans la plateforme (un jeu de
-- données, une métrique du jumeau, un type d'objet) et dit comment la dessiner.
-- Le jour où le sync horaire rafraîchit le relevé des urgences, la carte montre
-- le nouveau chiffre sans que personne la touche.
--
-- Copier les valeurs dans la carte donnerait un tableau de bord qui vieillit en
-- silence : il continuerait d'afficher, avec le même aplomb, l'état du réseau
-- au moment où quelqu'un a cliqué.
--
-- `config` reste du JSONB, comme `effects` en 046 et `rules` en 049. La forme
-- dépend du genre de carte, elle changera plus vite que le schéma, et la figer
-- en colonnes obligerait à une migration pour chaque nouveau type de
-- graphique — c'est-à-dire à un déploiement pour ajouter un histogramme.

CREATE TABLE IF NOT EXISTS app.dashboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Rattaché au projet et non à l'organisation, contrairement aux réponses de
    -- simulation : une réponse nomme des installations qui existent dans tous
    -- les projets d'une organisation, un tableau de bord nomme des jeux de
    -- données qui appartiennent à un projet précis.
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',

    created_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_name_unique
    ON app.dashboard (project_id, lower(name));

CREATE INDEX IF NOT EXISTS dashboard_project_idx
    ON app.dashboard (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS app.dashboard_card (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES app.dashboard(id) ON DELETE CASCADE,

    -- L'ordre de lecture. Un entier plutôt qu'un rang implicite : deux cartes
    -- ajoutées la même seconde se départagent, et déplacer une carte n'oblige
    -- pas à réécrire les autres.
    position INTEGER NOT NULL DEFAULT 0,

    title TEXT NOT NULL,

    -- line | bar | number | table. Contraint ici parce que le rendu ne sait
    -- dessiner que ceux-là : un genre inconnu produirait une carte vide et
    -- silencieuse, ce qui se lit comme une donnée absente.
    kind TEXT NOT NULL CHECK (kind IN ('line', 'bar', 'number', 'table')),

    -- D'où viennent les valeurs. `dataset` aujourd'hui ; le jumeau et
    -- l'ontologie suivront, et c'est cette colonne qui les distinguera.
    source_kind TEXT NOT NULL CHECK (source_kind IN ('dataset', 'twin', 'ontology')),
    source_id TEXT NOT NULL,

    -- { x, y, agg, limit, ... } — dépend du genre, voir plus haut.
    config JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dashboard_card_order_idx
    ON app.dashboard_card (dashboard_id, position, created_at);
