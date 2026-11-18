-- Le journal de l'analyste garde désormais deux sortes d'échanges.
--
-- Jusqu'ici une ligne de app.analyst_exchange était toujours une question et
-- sa réponse (onglet « Ask »). L'analyste sait maintenant aussi recevoir un
-- objectif, proposer des options et les faire tester par le moteur (onglet
-- « Options »). Les deux se journalisent au même endroit, avec les mêmes
-- colonnes : la question ou l'objectif dans `question`, les étapes dans
-- `steps`, ce qui a été affiché dans `answer`.
--
-- `kind` dit laquelle des deux c'est, pour qu'on n'ait pas à le deviner à la
-- forme du JSON :
--
--   ask      une question, une réponse en paragraphes ;
--   options  un objectif, des options testées et leur comparaison.
--
-- Une décision (migration 061) ne peut s'appuyer que sur un échange `options`.
-- Les lignes déjà écrites sont toutes des questions : la valeur par défaut les
-- range du bon côté.

ALTER TABLE app.analyst_exchange
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ask'
        CHECK (kind IN ('ask', 'options'));
