-- Les modèles de série temporelle vivent dans la même table que les autres.
--
-- Un utilisateur pense « mes modèles », pas « mes modèles tabulaires et mes
-- modèles de série ». Deux tables imposeraient deux listes, deux écrans et deux
-- endroits où chercher — pour une différence qui tient dans une colonne.
--
-- `kind` distingue les deux, et les colonnes qui suivent n'ont de sens que pour
-- la prévision. Elles restent nulles ailleurs plutôt que d'être remplies de
-- valeurs par défaut qui se liraient comme des choix.

ALTER TABLE app.lab_model
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tabular',
    ADD COLUMN IF NOT EXISTS time_lags INTEGER NULL,
    ADD COLUMN IF NOT EXISTS horizon INTEGER NULL,
    ADD COLUMN IF NOT EXISTS exog JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Le détail de chaque origine de l'évaluation glissante. Une moyenne seule
    -- cache qu'un modèle excellent sur trois fenêtres est mauvais sur la
    -- quatrième, et c'est souvent la plus récente.
    ADD COLUMN IF NOT EXISTS folds JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lab_model_kind_check'
    ) THEN
        ALTER TABLE app.lab_model
            ADD CONSTRAINT lab_model_kind_check
            CHECK (kind IN ('tabular', 'timeseries'));
    END IF;
END $$;

-- La cible d'une prévision est une colonne, pas une catégorie : la contrainte
-- de tâche existante vaut toujours, une prévision étant une régression.
CREATE INDEX IF NOT EXISTS lab_model_kind_idx
    ON app.lab_model (project_id, kind, created_at DESC);
