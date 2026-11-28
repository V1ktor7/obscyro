-- ============================================================================
-- Les prévisions figées d'un modèle à l'essai.
-- Migration 075 : app.forecast_issued, et la mise à l'essai sur app.forecast_model
-- ============================================================================
--
-- Un essai sur le passé (migration 074) dit ce qu'un modèle aurait prévu. Il
-- ne suffit pas pour s'y fier : rien n'empêche de le refaire jusqu'à ce que le
-- résultat plaise. Une mise à l'essai, elle, se passe au présent. Le modèle
-- tourne à heure fixe, et chaque prévision est écrite une fois, avec l'heure
-- où elle a été faite. Quand l'heure visée arrive, on la tient contre ce que
-- le jumeau a mesuré.
--
-- Cette table garde ces prévisions. Une ligne, c'est un modèle, une unité et
-- une origine (le début du premier pas prévu) :
--
--   low, likely, high   la prévision du modèle, une valeur par pas de
--                       l'horizon ;
--   ref_likely          ce que la règle « même heure, la semaine passée »
--                       disait au même moment, avec ce qu'on savait alors.
--                       Une case vide quand elle n'avait rien à dire ;
--   held                la dernière valeur connue à l'origine : la seconde
--                       règle, « la dernière valeur tient » ;
--   issued_at           quand la prévision a été faite ;
--   said                ce que le modèle disait de lui-même (nom, version).
--
-- Les deux règles sont figées avec la prévision, pour la même raison qu'elle :
-- les recalculer plus tard, avec des relevés arrivés ou corrigés depuis,
-- changerait la barre après coup.
--
-- Une prévision figée ne se modifie pas. Ce n'est pas seulement une habitude
-- du code : un déclencheur refuse toute mise à jour de la table. On ne peut
-- que l'écrire une fois (une seconde écriture pour le même modèle, la même
-- unité et la même origine est ignorée) ou la retirer avec son modèle.
--
-- La note d'un modèle et le droit de le montrer ne sont pas rangés ici : ce
-- sont des règles fixées d'avance, appliquées à ces prévisions et aux relevés
-- du jumeau. `standing`, sur le modèle, n'en garde que le dernier calcul, pour
-- qu'un écran n'ait pas à le refaire à chaque lecture.
--
-- Sur le modèle : trial_every_hours dit à quel rythme il tourne quand il est
-- à l'essai, trial_started_at depuis quand, last_run_at quand il a tourné pour
-- la dernière fois.
--
-- Rien ici ne parle d'une personne : une mesure agrégée, par unité du réseau.

ALTER TABLE app.forecast_model
    ADD COLUMN IF NOT EXISTS trial_every_hours INTEGER     NOT NULL DEFAULT 6,
    ADD COLUMN IF NOT EXISTS trial_started_at  TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_run_at       TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS standing          JSONB       NULL;

CREATE TABLE IF NOT EXISTS app.forecast_issued (
    id               BIGINT             GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model_id         UUID               NOT NULL REFERENCES app.forecast_model(id) ON DELETE CASCADE,
    project_id       UUID               NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    unit_instance_id UUID               NOT NULL,
    origin           TIMESTAMPTZ        NOT NULL,
    issued_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    step             TEXT               NOT NULL CHECK (step IN ('hour', 'day')),
    low              DOUBLE PRECISION[] NOT NULL,
    likely           DOUBLE PRECISION[] NOT NULL,
    high             DOUBLE PRECISION[] NOT NULL,
    ref_likely       DOUBLE PRECISION[] NOT NULL,
    held             DOUBLE PRECISION   NULL,
    said             JSONB              NULL,
    UNIQUE (model_id, unit_instance_id, origin)
);

-- Ce que la page Network lit : la dernière prévision d'une unité.
CREATE INDEX IF NOT EXISTS forecast_issued_unit_idx
    ON app.forecast_issued (project_id, unit_instance_id, origin DESC);

-- Une prévision figée ne se modifie pas : la base le refuse, quel que soit le code.
CREATE OR REPLACE FUNCTION app.forecast_issued_is_frozen() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'A frozen forecast is never modified (app.forecast_issued).';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS forecast_issued_frozen ON app.forecast_issued;
CREATE TRIGGER forecast_issued_frozen
    BEFORE UPDATE ON app.forecast_issued
    FOR EACH ROW EXECUTE FUNCTION app.forecast_issued_is_frozen();
