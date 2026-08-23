-- Une réponse devient une définition, comme un événement l'est devenu en 046.
--
-- Le moteur livrait trois réponses en conserve — ne rien faire, transférer,
-- renforcer — générées en Python à partir de l'état du réseau. Pourtant
-- `Policy` était déjà de la donnée entièrement inspectable : un arbre de
-- conditions typé, quatre actions, et les frictions qui empêchent une réponse
-- de paraître gratuite et instantanée. La première ligne du module le dit —
-- « the object the user iterates on ». Elle était simplement inatteignable :
-- la seule entrée était un nom dans un dictionnaire de trois.
--
-- Sans cette table, personne ne peut écrire « quand l'occupation dépasse 90 %
-- à ce site, transférer vers celui-là, avec deux jours de délai », et surtout
-- personne ne peut écrire un levier de santé publique : réduire la demande
-- d'un tiers dans les douze bassins à partir du jour 21.
--
-- `rules` reste du JSONB, pour la même raison qu'`effects` en 046 : le contrat
-- de forme appartient au moteur, qui le valide déjà avec pydantic et refuse
-- une règle visant une cible absente. Le dupliquer en contraintes SQL donnerait
-- deux vérités à tenir d'accord, et c'est la version SQL qui prendrait du
-- retard.
--
-- Pas de `twin_scenario_id` ici, contrairement à un événement. Un événement
-- nomme des instances par identifiant et n'a donc de sens que dans le monde où
-- il a été écrit ; une réponse nomme des installations et des bassins, qui
-- existent dans les deux. Une règle dont la cible a disparu est refusée par le
-- moteur au chargement, ce qui est la bonne panne.

CREATE TABLE IF NOT EXISTS app.sim_policy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',

    -- [{ id, trigger, condition, action, priority, scope, unless }]
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Le classement des résultats se lit par nom autant que par identifiant, et
-- deux réponses homonymes dans une même comparaison ne se distinguent plus.
CREATE UNIQUE INDEX IF NOT EXISTS sim_policy_name_unique
    ON app.sim_policy (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS sim_policy_org_idx
    ON app.sim_policy (organization_id, updated_at DESC);
