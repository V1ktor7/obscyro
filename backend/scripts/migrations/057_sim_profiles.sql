-- Un profil devient une définition réutilisable, comme un événement en 046 et
-- une réponse en 049.
--
-- Un profil, c'est un paquet de changements sourcé, avec une forme dans le
-- temps, qu'on dépose dans un événement : une vague observée ramenée à un taux
-- pour 1 000 résidents, une exposition (fumée, ozone) multipliée par un effet
-- publié, ou des changements gardés d'un événement déjà écrit. Le catalogue
-- livré avec le Studio vit dans le code ; cette table garde ceux que
-- l'organisation crée elle-même, pour qu'ils servent à tout le monde et
-- survivent à l'onglet qui les a créés.
--
-- `body` reste du JSONB, pour la même raison qu'`effects` en 046 : il ne nomme
-- rien du jumeau où il a été créé. Une série est un taux par habitant, une
-- exposition est un coefficient et une suite de valeurs ; c'est en déposant le
-- profil dans un événement qu'il prend les lieux du réseau ouvert. Le moteur
-- ne le lit jamais : il ne voit que les effets que le profil produit.
--
-- Pas de `twin_scenario_id` : un profil est fait pour passer d'un réseau à
-- l'autre, de Montréal à Rimouski.

CREATE TABLE IF NOT EXISTS app.sim_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',

    -- { kind: "series" | "exposure" | "changes", ... }
    body JSONB NOT NULL,

    created_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Le catalogue se lit par nom : deux profils homonymes ne se distinguent plus.
CREATE UNIQUE INDEX IF NOT EXISTS sim_profile_name_unique
    ON app.sim_profile (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS sim_profile_org_idx
    ON app.sim_profile (organization_id, updated_at DESC);
