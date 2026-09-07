-- Un échec n'est pas une décision d'arrêter.
--
-- `app.sync.status` faisait deux métiers à la fois : « ce flux est-il allumé »,
-- qui est une décision humaine, et « la dernière exécution a-t-elle réussi »,
-- qui est une observation. Les confondre veut dire qu'une observation éteint le
-- flux — et c'est exactement ce qui est arrivé.
--
-- Le fichier horaire des urgences du MSSS a renvoyé un 502 passager. La même
-- URL répond 200 dans la minute qui suit, depuis la même machine. Mais
-- `recordSyncRun` avait bascule le statut à 'error', le planificateur ne
-- ramasse que 'active', et le flux est resté mort six heures — il le serait
-- resté pour toujours, jusqu'à ce que quelqu'un le remarque.
--
-- Pour un produit dont la promesse est la donnée vivante, une panne d'une
-- minute chez la source ne peut pas coûter le flux.
--
-- Donc : `status` redevient l'interrupteur, `last_error` reste l'observation, et
-- un compteur d'échecs consécutifs porte de quoi espacer les tentatives sans
-- jamais renoncer. La plateforme n'éteint pas un flux parce que le monde a été
-- brièvement cassé ; elle réessaie plus lentement et le dit.

ALTER TABLE app.sync
    ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;

-- Les syncs éteintes par une observation sont rallumées. `last_error` est
-- conservé : l'échec reste visible, il cesse seulement d'être fatal. Une sync
-- que quelqu'un a mise en pause délibérément n'est pas touchée.
UPDATE app.sync
   SET status = 'active',
       consecutive_failures = 1,
       updated_at = now()
 WHERE status = 'error';

-- 'error' n'est plus un état qu'une sync peut prendre : il décrivait la
-- dernière exécution, pas le flux.
ALTER TABLE app.sync DROP CONSTRAINT IF EXISTS sync_status_check;
ALTER TABLE app.sync
    ADD CONSTRAINT sync_status_check CHECK (status IN ('active', 'paused'));
