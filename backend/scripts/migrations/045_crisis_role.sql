-- Migration 045: crisis_role sur ontology_object_types.
--
-- Le moteur de crise ne raisonne pas sur des lits ni sur des infirmières. Il
-- raisonne sur quatre catégories de contrainte — espace, personnel, matériel,
-- systèmes — plus la demande qui les traverse. Pour brancher le jumeau dessus,
-- il faut savoir de quel côté tombe chaque type d'objet.
--
-- Ce n'est pas déductible. `nature` distingue le physique du conceptuel, ce qui
-- ne dit pas si un ventilateur est du matériel ou un système. Le premier jet du
-- pont devinait à partir du nom du type ; c'est précisément ce que 044 a retiré
-- des liens, et ça n'a pas plus sa place ici. Un rôle mal deviné change quelle
-- perturbation atteint quoi : une cyberattaque frappe `systems` et épargne
-- `stuff`, donc se tromper de colonne, c'est se tromper de crise.
--
-- NULL est une réponse valide et la valeur par défaut : un type sans rôle
-- n'entre simplement pas dans la simulation, et l'export le signale au lieu de
-- l'inventer.

ALTER TABLE app.ontology_object_types
    ADD COLUMN IF NOT EXISTS crisis_role TEXT NULL
        CHECK (crisis_role IS NULL OR crisis_role IN
               ('space', 'staff', 'stuff', 'systems', 'demand'));

COMMENT ON COLUMN app.ontology_object_types.crisis_role IS
    'Ce que ce type contraint pendant une crise : space | staff | stuff | systems | demand. NULL = hors simulation.';

-- Amorce unique, sur les trois seuls noms que le socle du jumeau crée lui-même
-- (voir seedTwinSchema). Volontairement pas de correspondance approximative :
-- une amorce trop large donnerait des rôles qui ont l'air choisis alors qu'ils
-- ont été devinés, et personne ne reviendrait les vérifier. Tout le reste se
-- déclare dans l'interface.
UPDATE app.ontology_object_types SET crisis_role = 'space'
    WHERE crisis_role IS NULL AND name = 'Bed';
UPDATE app.ontology_object_types SET crisis_role = 'demand'
    WHERE crisis_role IS NULL AND name = 'Patient';
