-- ============================================================================
-- Les modèles de prévision importés.
-- Migration 074 : app.forecast_model, un modèle déjà entraîné branché au projet
-- ============================================================================
--
-- La plateforme n'entraîne pas ces modèles. Des modèles de prévision déjà
-- entraînés existent, ouverts, et font mieux qu'un modèle entraîné sur
-- quelques semaines de données. Ce qui manquait est un moyen d'en brancher
-- un : lui montrer l'historique que la plateforme garde (migration 072),
-- recevoir sa prévision, la noter, et ne l'afficher que si elle vaut mieux
-- qu'une règle simple.
--
-- Une ligne de cette table est un modèle branché à un projet. Elle dit :
--
--   d'où il vient       source = 'reference' : la règle intégrée « même heure,
--                       la semaine passée », qui n'appelle aucun modèle ;
--                       source = 'service'   : un modèle ouvert servi par le
--                       service de modèle (service_model le nomme) ;
--                       source = 'endpoint'  : une adresse qui parle le contrat.
--   ce qu'il prévoit    une mesure du jumeau (metric), pour toutes les unités
--                       qui la portent ou pour celles que units nomme ;
--   ce qu'on lui montre le pas (heure ou jour), la longueur de l'historique,
--                       l'horizon, ses séries compagnes, et combien de temps
--                       une valeur tient quand la source se tait (hold_hours) ;
--   où il en est        importé, vérifié (son contrat a été tenu sur un
--                       échantillon), essayé (rejoué sur le passé), à l'essai.
--
-- « Montré » n'est pas un état rangé ici. C'est une règle fixée d'avance,
-- appliquée à des prévisions figées : elle donne la même réponse à chaque
-- lecture, et personne ne peut la cocher à la main.
--
-- Aucune clé n'est rangée ici. Une adresse externe qui demande une clé la lit
-- dans une variable d'environnement qu'un administrateur a posée sur l'API :
-- endpoint_key_env ne garde que le NOM de cette variable.
--
-- backtest garde le dernier essai sur le passé : l'erreur du modèle à côté de
-- celle de la référence, en tout et par pas de l'horizon. Rien n'y est
-- entraîné.
--
-- Rien ici ne parle d'une personne : une mesure agrégée, par unité du réseau.

CREATE TABLE IF NOT EXISTS app.forecast_model (
    id               UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID             NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    key              TEXT             NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{2,47}$'),
    label            TEXT             NOT NULL,

    source           TEXT             NOT NULL CHECK (source IN ('reference', 'service', 'endpoint')),
    service_model    TEXT             NULL,
    endpoint_url     TEXT             NULL,
    endpoint_key_env TEXT             NULL,

    metric           TEXT             NOT NULL,
    units            JSONB            NULL,
    step             TEXT             NOT NULL CHECK (step IN ('hour', 'day')),
    history_steps    INTEGER          NOT NULL,
    horizon_steps    INTEGER          NOT NULL,
    hold_hours       DOUBLE PRECISION NULL,
    min_history_days INTEGER          NOT NULL DEFAULT 14,
    companions       JSONB            NOT NULL DEFAULT '[]'::jsonb,
    time_zone        TEXT             NULL,

    state            TEXT             NOT NULL DEFAULT 'imported'
                     CHECK (state IN ('imported', 'verified', 'tried', 'on_trial')),
    verified_at      TIMESTAMPTZ      NULL,
    tried_at         TIMESTAMPTZ      NULL,
    backtest         JSONB            NULL,
    last_error       TEXT             NULL,

    created_by       UUID             NULL,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, key)
);
