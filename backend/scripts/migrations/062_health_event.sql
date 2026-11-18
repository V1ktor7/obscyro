-- Le calendrier d'événements : ce qui se passait autour du réseau, tiré de
-- sources officielles et validé par une personne.
--
-- L'analyste ne connaît que le jumeau. Il ne peut pas dire qu'un couvre-feu
-- commençait tel jour, ni que les écoles rouvraient tel autre. L'onglet
-- « Event finder » lui donne une recherche en ligne limitée aux sources que le
-- projet autorise ; chaque trouvaille est un candidat, et un candidat n'est
-- rien tant qu'une personne ne l'a pas accepté. Cette migration porte les
-- trois choses que cela demande.
--
-- 1. app.health_event : les événements acceptés, et eux seuls. Un candidat
--    refusé n'y entre pas, et aucun outil ne le lit ailleurs.
--
--      title, place, door      ce qui s'est passé, où, et par quelle porte cela
--                              touche un réseau de santé : demand (plus de gens
--                              ont besoin de soins), capacity (moins de quoi
--                              soigner), access (on n'atteint plus les soins),
--                              care (chaque patient demande plus) ;
--      starts_on, ends_on      les dates validées. Elles viennent de la
--                              personne : elle a pu corriger ce que l'analyste
--                              proposait. ends_on vide : un seul jour, ou pas
--                              de fin annoncée ;
--      proposed_starts_on,     ce que l'analyste proposait, gardé à côté pour
--      proposed_ends_on        qu'on voie ce qui a été corrigé. Vide quand le
--                              passage cité ne donnait pas le jour ;
--      source_url,             le lien, le titre de la page et le court passage
--      source_title, passage   cité (moins de quinze mots) ;
--      sources                 tous les passages sur lesquels le candidat
--                              reposait, tels que la recherche les a rendus ;
--      exchange_id, candidate  l'échange journalisé et le candidat dont la
--                              ligne sort. Le navigateur n'envoie que ces deux
--                              repères et les dates : le reste est recopié par
--                              le serveur depuis son journal ;
--      validated_by,           qui a accepté, et quand.
--      validated_at
--
--    Ce sont des faits publiés sur le monde autour du réseau, jamais des
--    données sur des personnes.
--
-- 2. app.project_web_source : les domaines où la recherche a le droit de
--    chercher, réglables par projet. Pas de ligne : la liste de départ du code
--    s'applique (INSPQ, Québec, MSSS, Données Québec, Canada, OMS).
--
-- 3. Le journal app.analyst_exchange garde une troisième sorte d'échange,
--    `events` (une demande, des candidats), et un troisième « monde » regardé,
--    `web` : dans cet échange l'analyste ne lit ni le jumeau ni un scénario.
--    Les deux contraintes sont remplacées ; on les retrouve par ce qu'elles
--    contrôlent plutôt que par leur nom, pour ne pas dépendre du nom que
--    Postgres leur a donné.

CREATE TABLE IF NOT EXISTS app.health_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES app.project(id) ON DELETE CASCADE,

    title TEXT NOT NULL,
    place TEXT NOT NULL,
    door TEXT NOT NULL CHECK (door IN ('demand', 'capacity', 'access', 'care')),
    starts_on DATE NOT NULL,
    ends_on DATE NULL,
    proposed_starts_on DATE NULL,
    proposed_ends_on DATE NULL,

    source_url TEXT NOT NULL,
    source_title TEXT NULL,
    passage TEXT NOT NULL,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,

    proposed_by_analyst BOOLEAN NOT NULL DEFAULT TRUE,
    exchange_id UUID NULL REFERENCES app.analyst_exchange(id) ON DELETE SET NULL,
    candidate TEXT NULL,

    validated_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS health_event_project_dates
    ON app.health_event (project_id, starts_on);

-- Accepter deux fois le même candidat ne crée pas deux événements.
CREATE UNIQUE INDEX IF NOT EXISTS health_event_one_per_candidate
    ON app.health_event (exchange_id, candidate)
    WHERE exchange_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.project_web_source (
    project_id UUID PRIMARY KEY REFERENCES app.project(id) ON DELETE CASCADE,
    domains JSONB NOT NULL,
    updated_by UUID NULL REFERENCES app.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
           AND (pg_get_constraintdef(con.oid) LIKE '%kind%'
                OR pg_get_constraintdef(con.oid) LIKE '%looking%')
    LOOP
        EXECUTE format('ALTER TABLE app.analyst_exchange DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE app.analyst_exchange
    ADD CONSTRAINT analyst_exchange_kind_check CHECK (kind IN ('ask', 'options', 'events'));

ALTER TABLE app.analyst_exchange
    ADD CONSTRAINT analyst_exchange_looking_check CHECK (looking IN ('reality', 'scenario', 'web'));
