-- ============================================================================
-- Une mesure peut être une durée.
-- Migration 068 : l'unité « hours » sur app.twin_metric
-- ============================================================================
--
-- Une mesure du jumeau se comptait en pourcentage, en rapport, en nombre
-- entier ou en nombre. Le relevé horaire des urgences publie aussi des durées
-- moyennes de séjour, en heures décimales : 5,99 veut dire 5 h 59. Rangée
-- comme un nombre, une durée s'affichait « 6.0 », sans que rien dise six
-- quoi, et un écran ne pouvait pas l'écrire en heures et minutes.
--
-- La table app.twin_metric (migration 042) borne ses unités par une
-- contrainte. On la remplace par la même, plus « hours » : une durée tenue en
-- heures décimales, écrite en heures et minutes. Aucune ligne existante ne
-- change.
--
-- Une migration appliquée ne se modifie pas : d'où ce fichier plutôt qu'une
-- retouche de la 042.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'twin_metric_unit_check'
    ) THEN
        ALTER TABLE app.twin_metric DROP CONSTRAINT twin_metric_unit_check;
    END IF;
    ALTER TABLE app.twin_metric ADD CONSTRAINT twin_metric_unit_check
        CHECK (unit IN ('percent', 'ratio', 'count', 'number', 'hours'));
END $$;
