-- Un tableau de bord qui sait lire autre chose qu'un tableau.
--
-- 050 n'admettait qu'une source : un jeu de données. C'était honnête tant que
-- rien d'autre n'était câblé — une carte pointant le jumeau se serait affichée
-- en erreur pour toujours, ce qui se lit comme « cassé » et non comme « pas
-- encore construit ».
--
-- Trois sources s'ajoutent, et chacune existe déjà ailleurs dans la plateforme :
--
--   twin        le réseau géolocalisé, avec la métrique de chaque site
--   simulation  une exécution enregistrée (app.simulation_run) et sa trajectoire
--   model       un modèle du laboratoire (app.lab_model), et sa prévision
--
-- Et trois genres de cartes qui savent les dessiner :
--
--   map      les sites sur une carte, colorés par une mesure
--   series   une trajectoire jour par jour, avec son enveloppe p5–p95
--   compare  le prédit contre le réel, sur le même axe
--
-- La règle de 050 tient toujours : une carte ne conserve aucune valeur. Une
-- carte `map` nomme une métrique et un état, pas des coordonnées ; une carte
-- `series` nomme une exécution, pas ses points.
--
-- Les contraintes sont retrouvées avant d'être remplacées plutôt que nommées.
-- 050 les avait écrites en contraintes de colonne, donc leur nom est celui que
-- Postgres a choisi. Le deviner et se tromper serait silencieux au déploiement
-- — le DROP IF EXISTS ne trouverait rien, le nouveau CHECK s'ajouterait à côté
-- de l'ancien, et la première carte « map » serait refusée en production par
-- une contrainte que personne ne saurait nommer.

DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class rel ON rel.oid = c.conrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app'
           AND rel.relname = 'dashboard_card'
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) LIKE '%kind%'
    LOOP
        EXECUTE format('ALTER TABLE app.dashboard_card DROP CONSTRAINT %I', con.conname);
    END LOOP;
END
$$;

ALTER TABLE app.dashboard_card
    ADD CONSTRAINT dashboard_card_kind_check
    CHECK (kind IN ('line', 'bar', 'number', 'table', 'map', 'series', 'compare'));

ALTER TABLE app.dashboard_card
    ADD CONSTRAINT dashboard_card_source_kind_check
    CHECK (source_kind IN ('dataset', 'twin', 'ontology', 'simulation', 'model'));
