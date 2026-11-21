-- Les retests d'une réponse préparée : ce que le moteur en dit sur le réseau
-- tel qu'il est, au moment où un signal s'ouvre.
--
-- Une réponse préparée porte le test fait à froid, le jour où elle a été
-- gardée (app.prepared_response). Ce test ne dit pas ce qu'elle donnerait
-- aujourd'hui. Quand un signal s'ouvre sur un type qui a des réponses
-- préparées, le serveur les repasse donc dans le moteur, sans qu'on le lui
-- demande et sans modèle de langage, pendant que la personne lit la fiche.
--
-- Une ligne par retest demandé, et la ligne dit ce qu'il est devenu :
--
--   queued     demandé, pas encore commencé (un run à la fois par projet) ;
--   running    en cours dans le moteur ;
--   done       terminé : `figures` tient le run avec la réponse et le même run
--              sans elle ;
--   unchanged  l'état est le même que celui du dernier retest terminé : rien
--              n'a été relancé, et `same_as` nomme ce retest ;
--   abandoned  arrêté sans résultat, et `reason` dit pourquoi : délai dépassé,
--              scénario disparu, choix à remplacer introuvable ;
--   failed     le moteur n'a pas pu être joint, ou a refusé.
--
-- Pas de contrainte sur `status` : la liste vit dans le code
-- (`response-retest.ts`), où une valeur de plus ne demande pas de migration.
--
--   state_mark  l'empreinte de l'état testé : le jumeau lu à travers le
--               scénario, les choix du scénario, l'horizon et l'activité.
--               Deux retests de même empreinte donneraient le même résultat,
--               donc le second n'est pas lancé.
--   signal_id   le signal dont l'ouverture a demandé ce retest. Le résultat
--               vaut pour la réponse, donc pour tous les signaux de son type.
--   timing      de quoi sa durée était faite : la lecture du jumeau, puis
--               chaque appel au moteur. Une mesure, pas un résultat.
--
-- Un retest abandonné ou en cours n'est jamais montré comme un résultat : la
-- fiche garde alors le dernier test connu, et dit lequel. Aucune ligne ne
-- change après sa fin. Données agrégées seulement.

CREATE TABLE IF NOT EXISTS app.prepared_response_test (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prepared_response_id UUID NOT NULL REFERENCES app.prepared_response(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,
    signal_id UUID NULL REFERENCES app.signal(id) ON DELETE SET NULL,

    status TEXT NOT NULL,
    state_mark TEXT NULL,
    same_as UUID NULL REFERENCES app.prepared_response_test(id) ON DELETE SET NULL,
    figures JSONB NULL,
    reason TEXT NULL,
    timing JSONB NULL,

    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS prepared_response_test_recent
    ON app.prepared_response_test (prepared_response_id, requested_at DESC);
