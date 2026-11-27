-- ============================================================================
-- Un historique que les modèles peuvent lire.
-- Migration 072 : app.kept_series, app.series_point, et la marque des relevés
-- rattrapés dans app.twin_reading
-- ============================================================================
--
-- Un modèle de prévision ne sait que ce qu'on lui montre du passé. La
-- plateforme gardait ce passé sous deux formes : les relevés du jumeau
-- (app.twin_reading, une ligne quand une mesure change), et les copies des jeux
-- de données (chaque synchronisation garde une version entière du fichier).
-- Les copies ne se lisent pas comme une série : rien n'y est rangé par entité
-- et par instant, et un fichier relu sans changement y est gardé deux fois.
--
-- Une série gardée dit comment lire un jeu de données comme une série :
--
--      key             son nom, unique dans le projet ;
--      label           ce que l'écran affiche ;
--      dataset_id      le jeu d'où elle vient ;
--      time_column     la colonne qui dit quand la valeur était vraie ;
--      time_zone       l'horloge de cette colonne quand elle n'en porte pas
--                      (« 2026-11-27T12:50 » ne dit pas de quelle ville) ;
--      value_column    la colonne de la valeur ;
--      entity_columns  les colonnes qui nomment ce que la valeur décrit : une
--                      région, un site, un virus. Vide : une seule entité ;
--      step            le pas de la source : heure, jour ou semaine ;
--      unit            l'unité de mesure, en mots ;
--      last_note       ce que la dernière écriture n'a pas pu lire, pour que
--                      l'écran le dise au lieu de le taire.
--
-- Les mesures du jumeau n'ont pas de ligne ici : elles sont des séries sans
-- rien avoir à déclarer, lues dans app.twin_reading.
--
-- Un point, c'est une entité, l'instant que la valeur décrit (at), la valeur,
-- et l'instant où nous l'avons vue pour la première fois (seen_at). Ce sont
-- deux heures différentes, et les deux sont gardées : la seconde permet de
-- rejouer une prévision passée en ne montrant au modèle que ce qui était connu
-- ce jour-là.
--
-- On ne note que ce qui change. Une valeur identique relue n'est pas un
-- nouveau point. Une valeur que la source corrige après coup garde les deux :
-- l'ancienne et la nouvelle, chacune avec l'instant où elle a été lue. Une
-- valeur absente est notée avec value à NULL : un trou n'est pas un zéro.
--
-- version_id n'a pas de clé étrangère, exprès : une copie retirée un jour ne
-- doit pas effacer ce qui en a été lu.
--
-- replayed marque un point ou un relevé rattrapé depuis une copie gardée,
-- après coup. Il n'est pas inventé : il vient d'un fichier réellement gardé,
-- et il porte l'heure où cette copie a été prise.
--
-- Rien ici ne parle d'une personne : une entité du réseau et une valeur
-- agrégée.

CREATE TABLE IF NOT EXISTS app.kept_series (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID        NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    dataset_id      UUID        NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    key             TEXT        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{2,47}$'),
    label           TEXT        NOT NULL,
    time_column     TEXT        NOT NULL,
    time_zone       TEXT        NULL,
    value_column    TEXT        NOT NULL,
    entity_columns  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    step            TEXT        NOT NULL CHECK (step IN ('hour', 'day', 'week')),
    unit            TEXT        NULL,
    last_note       TEXT        NULL,
    last_written_at TIMESTAMPTZ NULL,
    created_by      UUID        NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, key)
);

-- Ce que chaque écriture d'un jeu lit : les séries déclarées sur lui.
CREATE INDEX IF NOT EXISTS kept_series_dataset_idx ON app.kept_series (dataset_id);

CREATE TABLE IF NOT EXISTS app.series_point (
    id         BIGINT           GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    series_id  UUID             NOT NULL REFERENCES app.kept_series(id) ON DELETE CASCADE,
    entity     TEXT             NOT NULL,
    at         TIMESTAMPTZ      NOT NULL,
    value      DOUBLE PRECISION NULL,
    seen_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    version_id UUID             NULL,
    replayed   BOOLEAN          NOT NULL DEFAULT FALSE
);

-- Le dernier point noté pour une entité à un instant (ce que chaque écriture
-- compare), et les points d'une entité sur une période (ce qu'une lecture
-- demande).
CREATE INDEX IF NOT EXISTS series_point_lookup_idx
    ON app.series_point (series_id, entity, at, seen_at DESC);

ALTER TABLE app.twin_reading
    ADD COLUMN IF NOT EXISTS replayed BOOLEAN NOT NULL DEFAULT FALSE;
