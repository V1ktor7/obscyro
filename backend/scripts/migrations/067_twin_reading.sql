-- ============================================================================
-- Le jumeau garde ce qu'il a mesuré.
-- Migration 067 : app.twin_reading, les relevés de chaque mesure, par unité
-- ============================================================================
--
-- Le jumeau ne savait dire que « maintenant ». Les mesures d'une unité
-- (occupation, comptes, moyennes) sont calculées à la lecture, à partir des
-- objets tels qu'ils sont : quand une donnée en remplace une autre, la valeur
-- d'avant est perdue. On ne pouvait donc dire ni ce qu'une urgence affichait
-- ce matin, ni ce qui est habituel pour elle à cette heure, ni ce qu'une
-- décision a changé ensuite.
--
-- Cette table garde les relevés. Un relevé, c'est une unité, une mesure, une
-- valeur, et deux heures qui ne disent pas la même chose :
--
--   observed_at   quand la valeur était vraie, d'après l'horodatage que la
--                 source publie. Vide quand la source ne le dit pas.
--   recorded_at   quand nous l'avons notée. Toujours là.
--
-- observed_basis dit ce que vaut observed_at, dans les mots du jumeau
-- (observed, partial, undeclared, …) : un âge qui n'est qu'un plancher ne
-- devient pas une heure exacte parce qu'il est rangé dans une colonne.
--
-- On ne note que ce qui change : une valeur différente, ou la même valeur
-- relue à une nouvelle heure. Une mesure qui n'a plus de valeur est notée
-- avec value à NULL : un trou dans les relevés n'est pas un zéro, et il doit
-- se voir.
--
-- Seule la réalité entre ici. Une lecture faite à travers un scénario décrit
-- un monde qui n'existe pas, et n'a rien à faire dans un historique.
--
-- unit_instance_id n'a pas de clé étrangère, exprès. Une unité retirée du
-- jumeau n'efface pas ce qu'on a mesuré quand elle y était : l'historique
-- raconte ce qui a été, pas ce qui est encore là. Le projet, lui, emporte ses
-- relevés avec lui.
--
-- Rien ici ne parle d'une personne : une unité et une valeur agrégée.

CREATE TABLE IF NOT EXISTS app.twin_reading (
    id               BIGINT           GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id       UUID             NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    unit_instance_id UUID             NOT NULL,
    metric           TEXT             NOT NULL,
    value            DOUBLE PRECISION NULL,
    observed_at      TIMESTAMPTZ      NULL,
    observed_basis   TEXT             NULL,
    recorded_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Ce que l'enregistreur lit à chaque passe (le dernier relevé d'une unité
-- pour une mesure) et ce que la fiche d'une unité lit (ses relevés sur une
-- période).
CREATE INDEX IF NOT EXISTS twin_reading_unit_metric_idx
    ON app.twin_reading (unit_instance_id, metric, recorded_at DESC);

-- Pour lire un projet entier sur une période : ce dont un calcul du « normal »
-- aura besoin.
CREATE INDEX IF NOT EXISTS twin_reading_project_idx
    ON app.twin_reading (project_id, recorded_at DESC);
