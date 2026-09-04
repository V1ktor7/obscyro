-- Modèles entraînés dans le lab.
--
-- Le service Python ne retient rien : il ajuste, il évalue, il rend l'artefact.
-- C'est ici que le modèle survit à un redémarrage — rangé à côté de l'ontologie
-- sur laquelle il a été entraîné, et non dans la mémoire d'un conteneur.
--
-- Tout ce qui a produit le score est stocké avec lui. Un modèle dont on ne peut
-- plus dire quelles colonnes il a vues, comment la séparation a été faite ni ce
-- que donnait la ligne de base est un chiffre sans provenance : exactement ce
-- que le reste de la plateforme refuse de produire.

CREATE TABLE IF NOT EXISTS app.lab_model (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    -- D'où viennent les lignes. Gardé même si le jeu disparaît ensuite : savoir
    -- que la source a été supprimée vaut mieux qu'un champ vide.
    dataset_id UUID NULL REFERENCES app.dataset(id) ON DELETE SET NULL,
    dataset_name TEXT NOT NULL DEFAULT '',

    task TEXT NOT NULL CHECK (task IN ('regression', 'classification')),
    estimator TEXT NOT NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,

    target TEXT NOT NULL,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    numeric_features JSONB NOT NULL DEFAULT '[]'::jsonb,
    categorical_features JSONB NOT NULL DEFAULT '[]'::jsonb,

    split TEXT NOT NULL CHECK (split IN ('random', 'chronological')),
    test_size DOUBLE PRECISION NOT NULL,
    time_column TEXT NULL,

    -- Le score, et ce que donne un modèle qui ignore les variables. Le second
    -- sans le premier ne veut rien dire, donc les deux sont obligatoires.
    metrics JSONB NOT NULL,
    baseline JSONB NOT NULL,
    importances JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    classes JSONB NOT NULL DEFAULT '[]'::jsonb,

    n_train INTEGER NOT NULL,
    n_test INTEGER NOT NULL,
    dropped_rows INTEGER NOT NULL DEFAULT 0,

    -- Le pipeline ajusté, sérialisé par le service Python. Seul ce service le
    -- relit, et seul lui l'écrit : c'est la raison pour laquelle rien d'autre
    -- ne doit jamais passer par ce chemin de désérialisation.
    artifact BYTEA NOT NULL,

    created_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lab_model_project_idx
    ON app.lab_model (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lab_model_dataset_idx
    ON app.lab_model (dataset_id);
