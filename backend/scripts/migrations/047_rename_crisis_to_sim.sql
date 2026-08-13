-- « Crise » était le mauvais mot, et il avait fui jusque dans le schéma.
--
-- Le moteur ne modélise pas des catastrophes. Il modélise des effets sur des
-- quantités, et rien en lui ne teste si un changement est mauvais. Un
-- multiplicateur de capacité au-dessus de 1, c'est une aile qui ouvre ; un
-- volume de demande négatif, c'est une campagne de vaccination. Appeler ça
-- « crisis » disait à quiconque modélise une fusion ou un agrandissement que
-- l'outil n'était pas pour lui.
--
-- `crisis_role` était doublement mal nommé : ce que la colonne déclare, c'est
-- ce qu'un type d'objet apporte au modèle de capacité, ce qui vaut identiquement
-- pour un plan d'expansion et pour une inondation.
--
-- Renommage sans perte : les deux objets sont vides en production — 046 a été
-- appliquée le jour même et aucun événement n'a encore été composé. Ce coût-là
-- ne fera qu'augmenter, d'où maintenant.
--
-- Idempotent par construction : sur une base neuve, 045 et 046 créent déjà les
-- anciens noms, donc les renommages s'appliquent ; sur une base où ce fichier
-- est rejoué, les gardes `IF EXISTS` et le test de colonne évitent l'erreur.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'app'
           AND table_name = 'ontology_object_types'
           AND column_name = 'crisis_role'
    ) THEN
        ALTER TABLE app.ontology_object_types RENAME COLUMN crisis_role TO sim_role;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'app' AND table_name = 'crisis_event'
    ) THEN
        ALTER TABLE app.crisis_event RENAME TO sim_event;
    END IF;
END $$;

-- Un index garde son ancien nom après un ALTER ... RENAME sur sa table. Sans
-- ceci, la prochaine personne qui lit `\d app.sim_event` trouve un index appelé
-- `crisis_event_name_unique` et cherche une table qui n'existe plus.
ALTER INDEX IF EXISTS app.crisis_event_name_unique RENAME TO sim_event_name_unique;
ALTER INDEX IF EXISTS app.crisis_event_org_idx RENAME TO sim_event_org_idx;
ALTER INDEX IF EXISTS app.crisis_event_pkey RENAME TO sim_event_pkey;

COMMENT ON COLUMN app.ontology_object_types.sim_role IS
    'Ce que ce type apporte au modèle : space | staff | stuff | systems | demand. NULL = hors simulation.';
