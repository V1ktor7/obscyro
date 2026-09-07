-- ============================================================================
-- Une alerte qui s'est éteinte doit pouvoir le dire.
-- Migration 055 : twin_alert.status accepte 'resolved'
-- ============================================================================
--
-- twin_alert ne connaissait que deux états : 'open', et 'ack' quand quelqu'un
-- l'a vue. Rien ne refermait une alerte dont la condition avait cessé. Une
-- urgence redescendue à 40 % restait rouge sur la carte jusqu'à ce qu'un
-- humain clique dessus.
--
-- Tant que les alertes n'étaient évaluées qu'au moment où quelqu'un regardait
-- l'écran, le défaut se voyait tout de suite. Avec un évaluateur de fond, il
-- s'accumule sans témoin : au bout d'une journée toute urgence ayant franchi
-- 100 % une seule fois est rouge pour toujours, et la carte ne distingue plus
-- ce qui déborde maintenant de ce qui a débordé cette nuit.
--
-- 'resolved' est un troisième état, pas un 'ack' déguisé. Le pont vers les
-- signaux sépare exprès « quelqu'un s'en est occupé » de « c'est parti tout
-- seul » (voir noteClearedAlerts, écrit pour un état qui n'existait pas
-- encore) ; poser acked_at sur une condition qui s'est éteinte seule
-- effacerait précisément la différence que ce code cherche à garder.
--
-- L'index unique partiel de 019 ne porte que sur status='open'. Une alerte
-- résolue libère donc la place, et un nouveau dépassement ouvre une alerte
-- neuve avec son propre horodatage au lieu de réveiller l'ancienne. Chaque
-- franchissement garde sa propre heure, ce qui est le seul moyen de compter
-- les épisodes plutôt que les hôpitaux.
--
-- La contrainte est retrouvée avant d'être remplacée plutôt que nommée : 017
-- l'a écrite en contrainte de colonne, donc son nom est celui que Postgres a
-- choisi. Deviner et se tromper serait silencieux — le DROP ne trouverait
-- rien, le nouveau CHECK s'ajouterait à côté de l'ancien, et la première
-- résolution serait refusée en production par une contrainte que personne ne
-- saurait nommer.

ALTER TABLE app.twin_alert
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL;

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
           AND rel.relname = 'twin_alert'
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) LIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE app.twin_alert DROP CONSTRAINT %I', con.conname);
    END LOOP;
END
$$;

ALTER TABLE app.twin_alert
    ADD CONSTRAINT twin_alert_status_check
    CHECK (status IN ('open', 'ack', 'resolved'));

-- Ce que l'évaluateur de fond lit à chaque tour : les alertes encore ouvertes
-- d'un projet, avec la règle qui les a levées. Sans cet index il relit la
-- table entière toutes les trente secondes.
CREATE INDEX IF NOT EXISTS twin_alert_open_rule_idx
    ON app.twin_alert (project_id, rule_id)
 WHERE status = 'open';
