-- Les métriques du jumeau deviennent des définitions.
--
-- L'occupation était deux chaînes littérales dans le cumul : compter les
-- instances dont le type s'appelle `Bed`, compter celles dont la propriété
-- `status` vaut `occupied`, diviser. Dans une plateforme dont l'argument est
-- que chaque établissement nomme ses propres types, cela rend `null` à qui
-- modélise `Lit`, ou `Civière`, ou écrit `occupé`.
--
-- Une métrique est désormais un agrégat sur les instances du sous-arbre d'une
-- unité, éventuellement divisé par un second agrégat. Cela couvre les lits
-- occupés sur les lits totaux, les patients admis sur les lits, le personnel
-- disponible, et la moyenne de n'importe quelle propriété numérique — sans que
-- le moteur sache ce qu'est un lit.

CREATE TABLE IF NOT EXISTS app.twin_metric (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,

    -- Ce que les règles d'alerte et le sélecteur d'affichage nomment.
    key TEXT NOT NULL,
    label TEXT NOT NULL,

    -- Le type d'objet pour lequel la métrique est rapportée. Les unités du
    -- jumeau aujourd'hui; d'autres types physiques quand la carte en portera.
    object_type TEXT NOT NULL DEFAULT 'OrgUnit',

    -- percent | ratio | count | number — décide de la mise en forme et de la
    -- présence obligatoire d'un dénominateur.
    unit TEXT NOT NULL DEFAULT 'count',

    -- Sélecteurs : { ofType, where[], agg, property }. Le dénominateur est
    -- absent pour un agrégat simple : « personnel disponible » est un compte,
    -- pas un rapport.
    numerator JSONB NOT NULL,
    denominator JSONB NULL,

    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'twin_metric_unit_check'
    ) THEN
        ALTER TABLE app.twin_metric ADD CONSTRAINT twin_metric_unit_check
            CHECK (unit IN ('percent', 'ratio', 'count', 'number'));
    END IF;
END $$;

-- Deux métriques ne peuvent pas partager une clé dans la même organisation :
-- une règle d'alerte désigne une métrique par sa clé, et il faudrait alors
-- décider laquelle elle vise.
CREATE UNIQUE INDEX IF NOT EXISTS twin_metric_key_unique
    ON app.twin_metric (organization_id, key);

CREATE INDEX IF NOT EXISTS twin_metric_org_idx
    ON app.twin_metric (organization_id) WHERE active;
