-- Une alerte dit sur quoi repose l'âge de sa valeur.
--
-- La migration 063 a donné à une alerte l'heure à laquelle sa valeur était
-- vraie (observed_at). Cette heure seule ne dit pas ce qu'elle vaut. Le jumeau,
-- lui, le sait déjà pour chaque unité (docs/algorithms.md, D7) :
--
--   observed       l'horodatage que la source publie : c'est l'âge de la valeur.
--   partial        plusieurs sources alimentent l'unité et l'une d'elles n'a
--                  publié aucune heure lisible. L'âge est alors un plancher :
--                  « au moins deux heures », pas « deux heures ».
--   undeclared, unreadable, zone-unknown, empty
--                  il n'y a pas d'âge, et voici pourquoi.
--
-- Sans cette colonne, l'écran des alertes affichait un plancher comme une
-- réponse, et un âge inconnu sans sa raison, alors que la fiche de la même
-- unité disait les deux. Agir vite sur une valeur plus vieille qu'on ne le
-- croit est le danger que cet écran doit éviter.
--
-- La colonne suit observed_at : elle est réécrite à chaque évaluation, avec la
-- valeur. Pas de contrainte sur ses valeurs : si le jumeau apprend un jour une
-- raison de plus, une évaluation ne doit pas échouer, et une alerte ne pas
-- s'ouvrir, pour un mot que cette table ne connaît pas encore.
--
-- Les alertes ouvertes avant cette migration gardent la colonne vide jusqu'à
-- leur prochaine évaluation, quelques secondes après le démarrage.

ALTER TABLE app.twin_alert
    ADD COLUMN IF NOT EXISTS observed_basis TEXT NULL;
