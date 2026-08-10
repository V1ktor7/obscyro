-- Ce qu'un lien *fait*, déclaré sur le type plutôt que deviné d'après son nom.
--
-- Le moteur du jumeau reconnaissait trois chaînes écrites en dur — `contains`,
-- `located_in`, `located_in_bed`. Un établissement qui modélise « chapeaute »
-- ou « se trouve dans » n'obtenait aucun cumul : pas d'erreur, pas de message,
-- un arbre vide et des pourcentages à zéro. C'est la même faute que les voies
-- de la carte triées par expression régulière et que l'occupation calculée sur
-- un type nommé `Bed` — le moteur n'a pas à connaître ton vocabulaire.
--
-- Plutôt qu'une liste fermée de significations, trois réglages orthogonaux.
-- Ils suffisent à exprimer les trois comportements qui existent, et ils en
-- laissent exprimer d'autres sans qu'on revienne écrire du code :
--
--   aggregates       ce qui remonte le long du lien. NULL = rien, et c'est le
--                    cas de la plupart des relations : un transfert entre deux
--                    services est une vraie relation, mais les lits de l'un
--                    n'appartiennent pas à l'autre.
--
--   aggregate_toward vers quelle extrémité. « A contient B » et « B fait
--                    partie de A » décrivent le même arbre, flèche inverse ;
--                    sans ce réglage, une convention de nommage retourne la
--                    hiérarchie.
--
--   transitive       est-ce que la relation s'enchaîne avec elle-même. Le CHUM
--                    doit voir les lits de l'urgence deux niveaux plus bas.
--                    N'a de sens que si les deux extrémités sont du même type :
--                    un lit est dans une salle, et la chaîne s'arrête là.
--
-- L'axe d'agrégation n'est *pas* une colonne : il se déduit de la `nature` du
-- type d'arrivée — conceptuel pour l'arbre organisationnel, physique pour le
-- lieu. Une notion de moins à saisir, et elle existe déjà. Un type sans nature
-- ne produit aucun axe, et le moteur refuse d'agréger plutôt que de deviner.
--
-- NULL partout par défaut. Le remplissage ci-dessous ne fait qu'écrire ce que
-- le code supposait déjà : aucun comportement ne change.

ALTER TABLE app.ontology_link_types
    ADD COLUMN IF NOT EXISTS aggregates TEXT
        CHECK (aggregates IS NULL OR aggregates IN ('metrics')),
    ADD COLUMN IF NOT EXISTS aggregate_toward TEXT
        CHECK (aggregate_toward IS NULL OR aggregate_toward IN ('source', 'target')),
    ADD COLUMN IF NOT EXISTS transitive BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app.ontology_link_types.aggregates IS
    'Ce qui remonte le long du lien. NULL = rien.';
COMMENT ON COLUMN app.ontology_link_types.aggregate_toward IS
    'Vers quelle extremite : source | target.';
COMMENT ON COLUMN app.ontology_link_types.transitive IS
    'La relation s enchaine avec elle-meme. Exige des extremites de meme type.';

-- Une relation qui agrège doit dire vers où. L'inverse est permis : préciser un
-- sens sans agréger ne fait rien de mal.
ALTER TABLE app.ontology_link_types
    DROP CONSTRAINT IF EXISTS ontology_link_types_aggregate_needs_direction;
ALTER TABLE app.ontology_link_types
    ADD CONSTRAINT ontology_link_types_aggregate_needs_direction
        CHECK (aggregates IS NULL OR aggregate_toward IS NOT NULL);

-- Remplissage unique, à partir des noms que le code reconnaissait. C'est le
-- seul endroit du système où ces chaînes sont légitimes : elles décrivent ce
-- qui existe, elles ne définissent pas une règle.
--
-- `contains` : A contient B, les chiffres de B remontent vers A, et ça
-- s'enchaîne — un lit de l'urgence doit compter dans le total du CHUM.
UPDATE app.ontology_link_types
   SET aggregates = 'metrics', aggregate_toward = 'source', transitive = true
 WHERE name = 'contains' AND aggregates IS NULL;

-- `located_in` / `located_in_bed` : l'objet source se rattache au nœud cible.
-- Pas transitif — il n'y a pas de lit dans un lit.
UPDATE app.ontology_link_types
   SET aggregates = 'metrics', aggregate_toward = 'target', transitive = false
 WHERE name IN ('located_in', 'located_in_bed') AND aggregates IS NULL;

CREATE INDEX IF NOT EXISTS ontology_link_types_aggregates_idx
    ON app.ontology_link_types (aggregates) WHERE aggregates IS NOT NULL;
