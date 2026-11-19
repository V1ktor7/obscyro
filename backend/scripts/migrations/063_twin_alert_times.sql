-- Une alerte dit de quand date sa valeur, et de quand date la donnée qui l'a
-- ouverte.
--
-- Une alerte ne portait qu'une heure : created_at, le moment où une évaluation
-- a vu le seuil franchi. Deux autres heures comptent pour qui doit agir vite,
-- et elles n'étaient gardées nulle part.
--
--   observed_at  le moment où la valeur était vraie, d'après l'horodatage que
--                la source publie (docs/algorithms.md, D7). Rafraîchi à chaque
--                évaluation, comme la valeur elle-même. Vide quand la source ne
--                le dit pas : un âge inconnu reste inconnu, il n'est pas
--                remplacé par l'heure de notre téléchargement.
--
--   written_at   le moment où la donnée qui a fait franchir le seuil a été
--                écrite ici. Fixé à l'ouverture de l'alerte et jamais retouché.
--                created_at - written_at est donc le temps que nous avons mis
--                à voir le dépassement : c'est la part du délai qui dépend de
--                nous, et elle se mesure sur chaque alerte au lieu de se
--                supposer.
--
-- Les deux ne se confondent pas. Un recensement publié à chaque heure peut
-- avoir cinquante minutes quand il arrive ; une alerte ouverte trois secondes
-- après son écriture reste une alerte sur une valeur vieille de cinquante
-- minutes, et l'écran doit pouvoir le dire.
--
-- Les alertes déjà ouvertes gardent les deux colonnes vides : rien ne permet
-- de reconstituer ces heures après coup, et les inventer serait pire.

ALTER TABLE app.twin_alert
    ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS written_at TIMESTAMPTZ NULL;
