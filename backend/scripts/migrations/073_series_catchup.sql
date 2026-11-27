-- ============================================================================
-- Rattraper une série depuis les copies gardées.
-- Migration 073 : app.series_catchup, où en est chaque rattrapage
-- ============================================================================
--
-- Une série commence le jour où on a commencé à la garder : le premier relevé
-- d'une mesure du jumeau, la déclaration d'une série sur un jeu de données.
-- Mais la plateforme gardait déjà, avant ce jour, une copie entière du fichier
-- à chaque synchronisation. Ces copies contiennent ce que la série aurait
-- noté si elle avait existé.
--
-- Un rattrapage relit ces copies, de la plus ancienne à la plus récente, et
-- note ce qui en sort :
--
--   pour une série de jeu de données   les points de chaque copie, datés de
--                                      l'heure où la copie a été prise ;
--   pour une mesure du jumeau          chaque copie passe par le pipeline tel
--                                      qu'il est aujourd'hui, en mémoire, et
--                                      la mesure est calculée telle qu'elle
--                                      est définie aujourd'hui. Rien n'est
--                                      écrit dans l'ontologie.
--
-- Ce qui est noté ainsi est marqué (`replayed`, migration 072) : un relevé
-- rattrapé n'est pas un relevé que le jumeau a affiché à l'époque.
--
-- Un jeu peut avoir plus de mille copies. Le rattrapage avance donc par lots
-- bornés, et cette table dit où il en est, pour qu'on puisse l'arrêter et le
-- reprendre :
--
--   until_at          les copies prises avant cet instant sont à relire :
--                     c'est le moment où la série a commencé à être gardée ;
--   through_version   la dernière copie relue. Vide tant que rien n'est lu ;
--   pipeline_id       pour une mesure du jumeau, le pipeline par lequel les
--                     copies passent. Vide pour une série de jeu de données ;
--   in_place_of       quand les copies relues sont celles d'un autre jeu que
--                     celui que le pipeline lit aujourd'hui (la source a
--                     changé de fichier) : le jeu d'entrée qu'elles remplacent.
--
-- Les compteurs disent ce qui a été écrit et ce qui n'a pas pu l'être : une
-- copie illisible ou coupée, une ligne sans identité, une ligne qui nomme un
-- endroit que le jumeau ne contient pas. Rien n'est deviné pour les placer.
--
-- Un rattrapage par série et par jeu relu. Le reprendre continue le même.
-- L'oublier efface ce qu'il avait noté, jamais un relevé pris en direct.
--
-- Rien ici ne parle d'une personne.

CREATE TABLE IF NOT EXISTS app.series_catchup (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID        NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    -- `twin:<mesure>` ou la clé d'une série déclarée.
    series_key       TEXT        NOT NULL,
    dataset_id       UUID        NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    pipeline_id      UUID        NULL,
    in_place_of      UUID        NULL,
    until_at         TIMESTAMPTZ NOT NULL,
    through_version  INTEGER     NULL,
    versions_total   INTEGER     NOT NULL DEFAULT 0,
    points_written   INTEGER     NOT NULL DEFAULT 0,
    copies_left_out  INTEGER     NOT NULL DEFAULT 0,
    rows_left_out    INTEGER     NOT NULL DEFAULT 0,
    rows_unattached  INTEGER     NOT NULL DEFAULT 0,
    last_note        TEXT        NULL,
    started_by       UUID        NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ NULL,
    UNIQUE (project_id, series_key, dataset_id)
);

-- Un relevé rattrapé se compare au dernier relevé noté avant lui pour la même
-- unité et la même mesure : l'index de la migration 067 le sert déjà.
