-- Le journal d'audit survit à ce qu'il audite.
--
-- `app.audit_log` porte deux règles qui se contredisent depuis la 028.
--
-- La première est un trigger `BEFORE UPDATE OR DELETE` qui lève
-- « app.audit_log is append-only ». C'est le bon comportement : un journal
-- qu'on peut réécrire ne prouve rien.
--
-- La seconde est trois clés étrangères en `ON DELETE SET NULL`, vers
-- `organizations`, `project` et `users`. Or `SET NULL` n'est pas une
-- suppression discrète : Postgres exécute un **UPDATE** sur les lignes
-- référencées, et cet UPDATE déclenche le trigger ci-dessus.
--
-- Les deux ne peuvent donc pas tenir ensemble. Supprimer un projet — ou une
-- organisation, ou un utilisateur — qui a la moindre trace d'audit échoue avec
-- « app.audit_log is append-only (attempted UPDATE) », remonté au client en
-- 500 « An unexpected error occurred ». Personne ne l'avait vu parce que rien
-- ne supprimait jamais un projet.
--
-- La contradiction se résout dans un seul sens. Ce sont les clés étrangères qui
-- partent, pas l'immuabilité :
--
--   * Une entrée qui dit « le projet X a été supprimé » doit survivre au projet
--     X. C'est précisément l'entrée qu'on vient consulter six mois plus tard.
--   * Mettre la colonne à NULL effacerait de quoi parlait l'entrée, ce qui est
--     une réécriture du journal par un autre chemin.
--   * Passer en CASCADE serait pire : la trace disparaîtrait avec son sujet, et
--     un journal d'audit qu'une suppression peut vider ne sert à rien.
--
-- Les colonnes restent, avec leur valeur. Elles cessent simplement d'être
-- contraintes par la durée de vie de ce qu'elles nomment — ce qui est la
-- définition d'une trace historique, par opposition à une référence vivante.
-- Le nom lisible voyage déjà dans `metadata`, donc une entrée reste
-- interprétable quand la ligne qu'elle désigne n'existe plus.

DO $$
DECLARE r RECORD;
BEGIN
    -- Par le catalogue plutôt que par une liste écrite à la main : les noms de
    -- contraintes sont générés par Postgres, et la 033 a renversé
    -- `environment_id` en `project_id` sans renommer la contrainte qui va avec.
    FOR r IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'app'
           AND rel.relname = 'audit_log'
           AND con.contype = 'f'
    LOOP
        EXECUTE format('ALTER TABLE app.audit_log DROP CONSTRAINT %I', r.conname);
        RAISE NOTICE 'audit_log: dropped foreign key %', r.conname;
    END LOOP;
END $$;

COMMENT ON COLUMN app.audit_log.project_id IS
    'Le projet concerné au moment de l''écriture. Volontairement sans clé étrangère : une entrée qui dit qu''un projet a été supprimé doit survivre à ce projet.';
COMMENT ON COLUMN app.audit_log.organization_id IS
    'L''organisation au moment de l''écriture. Sans clé étrangère, même raison.';
COMMENT ON COLUMN app.audit_log.actor_user_id IS
    'L''auteur au moment de l''écriture. Sans clé étrangère : un compte fermé ne doit pas effacer ce qu''il a fait.';

-- --- app.signal_event : la même contradiction, en pire ----------------------
--
-- Le journal de transitions d'un signal porte le même trigger
-- `BEFORE UPDATE OR DELETE`. Il a en plus un `signal_id` en `ON DELETE
-- CASCADE`, et une cascade est un DELETE : le trigger la refuse aussi.
--
-- La chaîne complète, mesurée sur les migrations :
--
--     app.project --CASCADE--> app.signal --CASCADE--> app.signal_event --X
--
-- donc supprimer un projet ayant le moindre signal avec la moindre transition
-- échouait, avant même d'atteindre le reste.
--
-- Ici la résolution est l'inverse de celle du journal d'audit, et pour une
-- raison de fond : `signal_event` raconte l'histoire *d'un signal*. Quand le
-- signal disparaît, cette histoire n'a plus de sujet — la garder produirait des
-- lignes qui pointent vers un `signal_id` qui n'existe plus. Le journal
-- d'audit, lui, raconte l'histoire de la plateforme, et l'entrée « ce projet a
-- été supprimé » est précisément celle qu'on vient lire plus tard.
--
-- Donc : la cascade depuis le signal passe, et rien d'autre ne peut toucher une
-- ligne. Le trigger ne garde que l'UPDATE, qui est la réécriture qu'il existait
-- pour empêcher. Et les trois clés en `SET NULL` partent, parce qu'une
-- transition qui nomme une étape doit rester lisible quand l'étape est
-- renommée ou supprimée.

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'app'
           AND rel.relname = 'signal_event'
           AND con.contype = 'f'
           AND con.confdeltype = 'n'   -- 'n' = SET NULL ; la cascade reste
    LOOP
        EXECUTE format('ALTER TABLE app.signal_event DROP CONSTRAINT %I', r.conname);
        RAISE NOTICE 'signal_event: dropped foreign key %', r.conname;
    END LOOP;
END $$;

DROP TRIGGER IF EXISTS signal_event_immutable_trg ON app.signal_event;
CREATE TRIGGER signal_event_immutable_trg
    BEFORE UPDATE ON app.signal_event
    FOR EACH ROW EXECUTE FUNCTION app.signal_event_immutable();

