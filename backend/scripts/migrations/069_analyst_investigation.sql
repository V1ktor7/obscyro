-- ============================================================================
-- Le journal de l'analyste garde une quatrième sorte d'échange : l'enquête.
-- Migration 069 : la sorte « investigation » sur app.analyst_exchange
-- ============================================================================
--
-- Le journal app.analyst_exchange gardait trois sortes d'échanges : une
-- question (`ask`), des options testées (`options`), une recherche
-- d'événements dans les sources officielles (`events`).
--
-- Une enquête est autre chose. Une personne regarde la série d'une mesure à
-- une unité, sur un laps de temps, et demande ce qui se passait autour. Le
-- programme lit la série gardée par le jumeau, y marque les épisodes où la
-- mesure dépassait son seuil d'alerte, lit le calendrier et les unités
-- voisines ; le modèle cherche des événements dans les sources permises, à
-- partir de la seule phrase de la personne ; puis le programme pose chaque
-- événement à côté de la série. Chaque étape de cette démarche est écrite
-- dans `steps`, celles du programme (p1, p2, …) comme celles de la recherche
-- (s1, s2, …), et le résultat dans `answer` : les candidats de la recherche,
-- et ce qui a été mesuré à côté de chacun.
--
-- On la range sous sa propre sorte, `investigation`, pour qu'on puisse la
-- relire plus tard sans la confondre avec une simple recherche : c'est la
-- trace de la démarche qui est demandée, pas seulement sa conclusion.
--
-- Un candidat d'une enquête s'accepte dans le calendrier comme celui d'une
-- recherche : app.health_event.exchange_id pointe vers la ligne du journal.
--
-- Une migration appliquée ne se modifie pas : d'où ce fichier plutôt qu'une
-- retouche de la 062, qui avait posé la contrainte à trois sortes.
-- ============================================================================

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'app'
           AND rel.relname = 'analyst_exchange'
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) LIKE '%kind%'
    LOOP
        EXECUTE format('ALTER TABLE app.analyst_exchange DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE app.analyst_exchange
    ADD CONSTRAINT analyst_exchange_kind_check CHECK (kind IN ('ask', 'options', 'events', 'investigation'));

-- Les enquêtes d'un projet, de la plus récente à la plus ancienne : ce que la
-- liste « enquêtes passées » lit.
CREATE INDEX IF NOT EXISTS analyst_exchange_investigations
    ON app.analyst_exchange (project_id, created_at DESC)
    WHERE kind = 'investigation';
