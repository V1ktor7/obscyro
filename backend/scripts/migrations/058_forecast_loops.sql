-- La boucle de prévision quotidienne : prévoir, figer, noter, surveiller,
-- réentraîner.
--
-- Une prévision montrée un matin n'a pu utiliser que ce qu'on savait ce
-- matin-là. Le Lab sait déjà ajuster un modèle et le noter en marchant dans le
-- passé ; ce qui manquait, c'est la boucle qui le refait chaque matin et garde
-- chaque prévision telle qu'elle a été faite. C'est ce qui permet de dire
-- « voilà ce qu'on prévoyait il y a sept jours, et voilà ce qui est arrivé »
-- sans que personne ait pu retoucher le chiffre après coup.
--
-- Trois tables :
--   forecast_loop     ce qu'on prévoit (une série d'un jeu de données, un
--                     éventuel moteur tiré d'un autre jeu), à quels horizons,
--                     avec quels modèles, et jusqu'à quel matin c'est figé ;
--   forecast_frozen   une prévision par matin, horizon et modèle. Insérée une
--                     fois, jamais modifiée : ON CONFLICT DO NOTHING, aucune
--                     route n'écrit dessus autrement ;
--   forecast_retrain  chaque réentraînement (le premier matin, puis chaque
--                     lundi) et l'erreur à attendre qu'il a mesurée sur les
--                     huit dernières semaines connues.
--
-- Le modèle en vigueur, les alertes de dérive et les remplacements ne sont pas
-- stockés : ce sont des règles fixées d'avance, appliquées aux prévisions
-- figées, qui donnent toujours la même réponse sur les mêmes données.

CREATE TABLE IF NOT EXISTS app.forecast_loop (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    name TEXT NOT NULL,

    dataset_id UUID NOT NULL REFERENCES app.dataset(id) ON DELETE CASCADE,
    time_column TEXT NOT NULL,
    target TEXT NOT NULL,

    -- Un moteur publié plus tard que la cible (la positivité, un jour après
    -- les admissions) : un autre jeu, joint par date.
    driver_dataset_id UUID NULL REFERENCES app.dataset(id) ON DELETE SET NULL,
    driver_time_column TEXT NULL,
    driver_column TEXT NULL,
    driver_delay INT NOT NULL DEFAULT 1,

    horizons INT[] NOT NULL,
    lags INT NOT NULL DEFAULT 14,
    -- [{ key, label, estimator, exog: bool, params }]
    specs JSONB NOT NULL,

    start_date DATE NOT NULL,
    -- Le dernier matin figé. NULL tant que rien ne l'est.
    frozen_through DATE NULL,
    status TEXT NOT NULL DEFAULT 'replaying'
        CHECK (status IN ('replaying', 'live', 'failed')),
    last_error TEXT NULL,

    created_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS forecast_loop_name_unique
    ON app.forecast_loop (project_id, lower(name));

CREATE TABLE IF NOT EXISTS app.forecast_frozen (
    loop_id UUID NOT NULL REFERENCES app.forecast_loop(id) ON DELETE CASCADE,
    made_on DATE NOT NULL,
    horizon INT NOT NULL,
    spec TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (loop_id, made_on, horizon, spec)
);

CREATE TABLE IF NOT EXISTS app.forecast_retrain (
    loop_id UUID NOT NULL REFERENCES app.forecast_loop(id) ON DELETE CASCADE,
    on_date DATE NOT NULL,
    horizon INT NOT NULL,
    spec TEXT NOT NULL,
    -- NULL quand l'historique était trop court pour mettre huit semaines de côté.
    mae DOUBLE PRECISION NULL,
    points INT NOT NULL,
    PRIMARY KEY (loop_id, on_date, horizon, spec)
);
