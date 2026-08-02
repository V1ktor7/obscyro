-- Les alertes du jumeau deviennent des signaux.
--
-- twin_alert se déclenche déjà sur des règles réelles — un seuil d'occupation
-- sur une vraie unité — et s'arrête là : une ligne, un statut open/ack, aucune
-- suite. Le moteur de signaux sait porter une suite mais rien ne l'alimente.
--
-- Le lien est une colonne, pas une correspondance codée en dur. Un
-- établissement décide quel type de signal une métrique produit ; un autre
-- décide autrement, ou ne branche rien du tout.

ALTER TABLE app.signal_type
    -- Quand une alerte du jumeau porte cette métrique, elle lève ce type de
    -- signal. NULL = ce type ne s'alimente pas des alertes.
    ADD COLUMN IF NOT EXISTS alert_metric TEXT NULL;

-- Une métrique ne peut pas alimenter deux types de signaux dans la même
-- organisation : il faudrait alors décider lequel gagne, et ce choix n'aurait
-- pas de bonne réponse.
CREATE UNIQUE INDEX IF NOT EXISTS signal_type_alert_metric_key
    ON app.signal_type (organization_id, alert_metric)
 WHERE alert_metric IS NOT NULL AND active;

-- Le pont retrouve le signal déjà levé pour une alerte, et rien d'autre ne
-- cherche par origine.
CREATE INDEX IF NOT EXISTS signal_origin_idx
    ON app.signal (origin_kind, origin_id) WHERE origin_id IS NOT NULL;
