-- L'identité appartient au type, pas au pipeline qui écrit.
--
-- Jusqu'ici, `upsertInstanceByIdentity` recevait les clés en paramètre, depuis
-- la configuration de chaque mapping de canal. Deux pipelines pouvaient donc
-- déclarer des clés différentes pour le même type, et un `insertObjectInstance`
-- direct n'en déclarait aucune. Résultat : deux « HND Emergency » portant le
-- même code, et chaque vue qui agrège par site répondant faux de façon
-- plausible.
--
-- `findInstanceIdByKey` savait déjà le détecter — il rend `ambiguous` — mais
-- constater l'ambiguïté après coup n'est pas la prévenir.
--
-- Deux décisions à dire :
--
-- **La contrainte est dans la base, pas dans le code.** Une vérification
-- applicative perd la course entre deux insertions concurrentes, et il y a
-- quatre chemins d'écriture (API, pipeline, canal, calque de scénario). Un
-- déclencheur tient quel que soit celui qui écrit, y compris celui que
-- quelqu'un ajoutera l'an prochain sans lire ce fichier.
--
-- **Par défaut, rien ne change.** `identity_properties` vaut `'{}'` pour tous
-- les types existants, et un type sans identité déclarée se comporte
-- exactement comme avant. C'est délibéré : cette migration tourne avant que
-- l'API démarre, et elle ne doit pas pouvoir refuser une écriture que la
-- production faisait hier. On déclare l'identité type par type, quand on a
-- regardé les doublons en face.

ALTER TABLE app.ontology_object_types
    ADD COLUMN IF NOT EXISTS identity_properties TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN app.ontology_object_types.identity_properties IS
    'Propriétés qui identifient une instance. Vide = aucune contrainte.';

-- La table qui porte la contrainte.
--
-- Une clé unique partielle sur `ontology_object_instances` ne pourrait pas
-- l'exprimer : l'ensemble des propriétés identifiantes varie d'un type à
-- l'autre, et un index a besoin d'une expression fixe. Une table d'appoint,
-- alimentée par déclencheur, transforme ça en une vraie clé primaire.
CREATE TABLE IF NOT EXISTS app.instance_identity (
    object_type_id UUID NOT NULL
        REFERENCES app.ontology_object_types(id) ON DELETE CASCADE,

    -- Les valeurs identifiantes, normalisées et sérialisées en tableau JSON.
    -- Un tableau plutôt qu'une concaténation avec séparateur : sinon
    -- ('a|b', 'c') et ('a', 'b|c') deviennent la même clé, et deux objets
    -- distincts se retrouvent fusionnés par un caractère mal choisi.
    identity_key   TEXT NOT NULL,

    instance_id    UUID NOT NULL UNIQUE
        REFERENCES app.ontology_object_instances(id) ON DELETE CASCADE,

    PRIMARY KEY (object_type_id, identity_key)
);

CREATE OR REPLACE FUNCTION app.sync_instance_identity() RETURNS TRIGGER AS $$
DECLARE
    props TEXT[];
    parts TEXT[] := ARRAY[]::TEXT[];
    p     TEXT;
    v     TEXT;
    tname TEXT;
BEGIN
    SELECT identity_properties, name INTO props, tname
      FROM app.ontology_object_types
     WHERE id = NEW.object_type_id;

    -- Le cas de loin le plus fréquent, et il doit rester bon marché : les
    -- pipelines insèrent par milliers.
    IF props IS NULL OR array_length(props, 1) IS NULL THEN
        IF TG_OP = 'UPDATE' THEN
            DELETE FROM app.instance_identity WHERE instance_id = NEW.id;
        END IF;
        RETURN NEW;
    END IF;

    FOREACH p IN ARRAY props LOOP
        v := NEW.properties ->> p;
        IF v IS NULL OR btrim(v) = '' THEN
            RAISE EXCEPTION
                'La propriété % identifie le type % et manque sur cette instance.', p, tname
                USING ERRCODE = 'not_null_violation';
        END IF;
        -- Normalisé : « HND Emergency » et « hnd  emergency » désignent le même
        -- objet pour tout lecteur humain, et un code recopié à la main arrive
        -- avec une casse et des espaces au hasard.
        parts := parts || lower(btrim(v));
    END LOOP;

    INSERT INTO app.instance_identity (object_type_id, identity_key, instance_id)
    VALUES (NEW.object_type_id, to_jsonb(parts)::text, NEW.id)
    ON CONFLICT (instance_id) DO UPDATE
        SET object_type_id = EXCLUDED.object_type_id,
            identity_key   = EXCLUDED.identity_key;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- AFTER, parce que la clé étrangère vers l'instance exige que la ligne existe.
DROP TRIGGER IF EXISTS instance_identity_sync ON app.ontology_object_instances;
CREATE TRIGGER instance_identity_sync
    AFTER INSERT OR UPDATE OF properties, object_type_id
    ON app.ontology_object_instances
    FOR EACH ROW EXECUTE FUNCTION app.sync_instance_identity();
