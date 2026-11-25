-- ============================================================================
-- Ce que l'analyste peut lire se déclare depuis le Studio.
-- Migration 071 : app.function_type
-- ============================================================================
--
-- Les outils de lecture de l'analyste sont écrits dans le code. Un
-- établissement qui veut qu'il lise autre chose (les respirateurs disponibles
-- par site, les lits fermés faute de personnel) devait attendre un
-- développeur. Un type de fonction est un outil de lecture que le projet
-- déclare lui-même.
--
-- Ce n'est pas du code. C'est l'un de cinq blocs que le programme sait déjà
-- exécuter, réglé par une personne :
--
--      objects     les objets d'un type, filtrés, avec les propriétés à rendre ;
--      aggregate   un compte, une somme, une moyenne, un minimum ou un maximum
--                  sur ces objets, en une valeur ou par groupe : une
--                  propriété, l'unité à laquelle l'objet est rattaché, ou
--                  son site ;
--      formula     un calcul de la calculatrice sur des agrégats nommés ;
--      history     les relevés que le jumeau a gardés d'une mesure à une unité ;
--      dataset     des colonnes d'un jeu de données du projet, filtrées.
--
-- Une ligne par type de fonction :
--
--      key          le nom de l'outil, tel que le modèle l'appelle. Unique dans
--                   le projet, et distinct de tout outil écrit dans le code ;
--      label        ce que la trace d'une réponse affiche, en mots de
--                   l'établissement ;
--      description  ce que l'outil lit et quand s'en servir : c'est ce que le
--                   modèle lit pour décider de l'appeler ;
--      inputs       ses entrées : un nom, une sorte (texte, nombre, date, une
--                   valeur parmi une liste), ses bornes, obligatoire ou non.
--                   Une entrée peut alimenter un filtre, un groupe ou une
--                   période du bloc ;
--      block        lequel des cinq blocs ;
--      config       le réglage du bloc : le type d'objet, les filtres, les
--                   propriétés rendues et le nom de chaque champ, la formule,
--                   la mesure, le jeu de données ;
--      active       éteint, il n'est plus offert à l'analyste.
--
-- Un outil déclaré ne fait que lire. Ce qu'il rend est une étape comme les
-- autres : un chiffre qu'il n'a pas rendu est retiré d'une réponse, comme pour
-- un outil de code. Il lit des objets du réseau et des valeurs agrégées,
-- jamais rien sur une personne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app.function_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{2,47}$'),
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
    block TEXT NOT NULL CHECK (block IN ('objects', 'aggregate', 'formula', 'history', 'dataset')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, key)
);
