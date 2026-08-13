-- Un événement devient une définition, comme une métrique l'est devenue en 042.
--
-- La couche de résilience livrait trois crises en conserve — pandémie,
-- inondation, cyberattaque — générées en Python à partir de l'état du réseau.
-- C'est une démonstration, pas une plateforme : personne ne peut y écrire
-- « la capacité de ce site baisse de 40 % du pas 3 au pas 20 », et le seul
-- recours est d'éditer un fichier du service de simulation.
--
-- Un événement est ici une liste d'effets. Le moteur n'en connaît que trois,
-- et ils ne parlent pas de catastrophe :
--
--   demand        la demande change quelque part
--   capacity      une ressource change quelque part
--   connectivity  une liaison change quelque part
--
-- Rien ne teste si un changement est mauvais. Un multiplicateur de capacité
-- au-dessus de 1, c'est une aile qui ouvre ; un volume de demande négatif,
-- c'est une campagne de vaccination. C'est délibéré : une pandémie et
-- l'ouverture d'un hôpital sont le même objet avec d'autres chiffres, sinon la
-- moitié des questions qu'un réseau se pose n'ont nulle part où s'écrire.
--
-- `effects` reste du JSONB plutôt qu'une table par type d'effet. Le contrat de
-- forme appartient au moteur, qui le valide déjà avec pydantic et refuse un
-- effet visant une cible absente ; le dupliquer en contraintes SQL donnerait
-- deux vérités à tenir d'accord, et c'est la version SQL qui prendrait du
-- retard.

CREATE TABLE IF NOT EXISTS app.crisis_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',

    -- Nombre de pas de simulation. Un événement dont les effets se terminent
    -- après l'horizon est licite : il dit que la crise n'est pas finie quand on
    -- arrête de regarder.
    horizon INTEGER NOT NULL DEFAULT 60,

    -- [{ id, kind, ... , profile: { start, end, shape, peak } }]
    effects JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Les effets visent des instances par identifiant. Un événement écrit
    -- contre un scénario ne veut donc rien dire ailleurs, et cette colonne dit
    -- lequel — NULL pour le jumeau réel.
    twin_scenario_id UUID NULL REFERENCES app.scenario(id) ON DELETE CASCADE,

    created_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deux événements ne peuvent pas partager un nom dans une organisation : une
-- comparaison est archivée sous le nom de l'événement, et il faudrait sinon
-- décider duquel on parle six mois plus tard.
CREATE UNIQUE INDEX IF NOT EXISTS crisis_event_name_unique
    ON app.crisis_event (organization_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS crisis_event_org_idx
    ON app.crisis_event (organization_id, created_at DESC);
