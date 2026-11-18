# L'analyste

L'analyste est le panneau repliable « Analyst » de la page Scenarios. On lui pose une question sur le jumeau, le scénario ouvert ou le run à l'écran ; il répond en ne s'appuyant que sur ce que des outils de lecture lui ont renvoyé, et montre tout ce qu'il a lu.

Le panneau a trois onglets, qui couvrent quatre étapes de la [boucle d'aide à la décision](decision-loop.md) :

| Onglet | Étape de la boucle | Ce qu'on y fait |
|---|---|---|
| Ask | Situation | Poser une question, lire la réponse et ce qui a été lu pour l'écrire |
| Options | Options testées, Recommandation | Dire un objectif, voir jusqu'à trois options testées par le moteur à côté du scénario tel quel |
| Decisions | Suivi | Relire ce qui a été retenu, ce qu'on en attendait, et l'écart avec ce qui a été observé |

Les schémas de la boucle, du vérificateur et de la calculatrice sont dans [algorithms.md](algorithms.md), sections A1 à A3 ; ceux des options testées et des décisions, sections A8 et A9.

## Ce qu'il fait, et ce qu'il ne fait pas

| Il fait | Il ne fait pas |
|---|---|
| Choisir quoi lire, puis rédiger | Détenir un fait sur le réseau |
| Citer, pour chaque paragraphe, les étapes sur lesquelles il repose | Calculer de tête |
| Dire ce qui manque quand les outils ne peuvent pas répondre | Combler un manque par une estimation |
| Lire | Écrire dans le jumeau ou le scénario |
| Faire tester une option par le moteur, et dire ce que le test montre | Classer des options qu'il n'a pas testées, recommander, décider |

## Le mettre en service

Il lit le jumeau à travers l'API Claude. Il lui faut la variable `ANTHROPIC_API_KEY` sur le service de l'API. Sans elle il est éteint, le panneau le dit, et rien d'autre dans le produit n'en dépend.

Ce que les outils lisent du jumeau (des comptes et des capacités, jamais une personne) est envoyé à l'API Claude pour rédiger la réponse. Le panneau le dit en pied.

État au 2026-11-17 : livré, testé avec un modèle simulé, **pas encore vérifié avec le vrai modèle**. C'est l'objet de la première issue de la suite.

## Les routes

| Route | Ce qu'elle rend |
|---|---|
| `GET /v1/ontology/:env/analyst` | `{ configured, model }` : l'analyste peut-il être interrogé |
| `POST /v1/ontology/:env/analyst/ask` | Un flux, une ligne JSON par événement : une question et sa réponse |
| `POST /v1/ontology/:env/analyst/options` | Le même flux : un objectif et les options testées |
| `POST /v1/ontology/:env/decisions` | Enregistre une décision à partir d'une option testée |
| `GET /v1/ontology/:env/decisions` | Les décisions du projet, les plus récentes d'abord (`scenarioId` pour un seul scénario) |
| `GET /v1/ontology/:env/decisions/:id/follow-up` | Les arrivées attendues par une décision à côté de la série observée, avec l'écart |

Corps de la question : `question`, `scenarioId` (ou `null`), `looking` (`reality` ou `scenario`), `run` (le résumé du run à l'écran, ou `null`).

Corps d'un objectif : `objective`, `scenarioId` (obligatoire : une option s'ajoute à un scénario), `horizon` et `activity` (ceux de la page, pour que le test réponde à ce que Run montrerait), `run`.

Corps d'une décision : `exchangeId` et `step`, rien d'autre. Les chiffres sont recopiés par le serveur depuis son journal.

Lignes du flux :

| `type` | Contenu |
|---|---|
| `status` | Ce qui est en train d'être fait |
| `step` | Un appel d'outil : son numéro (`s1`, `s2`…), son entrée, son résultat ou son refus, et le relevé que l'outil a gardé pour l'écran s'il en garde un |
| `done` | La réponse ou la proposition, les chiffres retirés, les étapes, le modèle, les jetons, et `exchangeId`, l'identifiant de l'échange dans le journal |
| `failed` | Le modèle ou le moteur n'a pas pu être joint ; remplace `done` |
| `ping` | Rien : garde la connexion ouverte |

Une demande refusée avant de commencer (pas de session, analyste éteint, service de simulation non configuré, corps invalide) est une erreur HTTP ordinaire, pas un flux.

## Les outils

Aucun n'écrit. Dix lisent ; un onzième, `test_option`, fait tourner le moteur, et n'existe que dans l'onglet Options. Deux mondes : `reality`, le jumeau tel qu'il est ; `scenario`, le même jumeau lu à travers le scénario ouvert.

| Outil | Ce qu'il lit |
|---|---|
| `describe_twin` | Vue d'ensemble : sites, activités et unités, territoires, modèle de soins et de propagation déclaré, ce qui manque au jumeau |
| `find_sites` | Les sites, filtrés par nom, activité ou territoire, les plus grands d'abord |
| `get_site` | Un site : lieu, unités par activité, patients présents, territoires servis, ce que le scénario y change |
| `compare_catchments` | Pour une activité : chaque territoire, ses résidents, ses sites, ses unités par 1 000 résidents |
| `scenario_recipe` | Le scénario : conditions de départ, événements, choix, liens modifiés, série de comparaison |
| `read_run` | Le run à l'écran : résumé des deux passes, sites où l'on attend, un site jour par jour, le réseau jour par jour |
| `list_datasets` | Les jeux de données du projet et leurs colonnes |
| `preview_dataset` | Les premières lignes d'un jeu et les valeurs de ses colonnes de catégorie |
| `read_series` | Une colonne lue comme série quotidienne : total, moyenne, extrêmes, valeurs |
| `calculate` | Un calcul, sur des nombres déjà lus ou donnés dans la question |
| `test_option` | Onglet Options seulement. Ajoute une option au scénario ouvert, le temps d'un run sur le serveur, et rend le scénario tel quel à côté du scénario avec l'option |

Un outil qui ne peut pas répondre (nom inconnu, deux sites pour un nom, pas de run à l'écran, table qui contient plusieurs séries, option qu'on ne peut pas tester) le dit par un refus motivé que le modèle lit. Il ne devine jamais.

Le résumé du run à l'écran est construit par la page (`run-digest.ts`) avec les fonctions que lit déjà le panneau Result : l'analyste et le panneau ne peuvent pas diverger sur un chiffre. Le résumé d'une option testée est construit par le serveur (`scenario-run.ts`), et un test tient les deux ensemble : [algorithms.md](algorithms.md), section A4.

## Les options

On dit un objectif : « plus personne n'attend à tel site », « le moins de jours-patients d'attente avec au plus 100 lits ajoutés ». L'analyste lit la situation, propose jusqu'à trois options et fait tourner chacune dans le moteur avant de la montrer.

Une option est une étiquette et un à quatre changements :

| Changement | Ce qu'il faut pour le tester |
|---|---|
| Capacité : des unités d'une activité, à un site, à partir d'un jour (négatif : des unités fermées) | Le site offre déjà cette activité ; on ne ferme pas plus qu'il n'a |
| Mesure : des couches de contact multipliées, dans certains territoires, pendant des jours | Le jumeau déclare ces couches |

Ce qui vient du modèle et ce qui n'en vient pas :

| À l'écran | D'où ça vient |
|---|---|
| Le tableau : pic, sites avec une file, jours-patients d'attente, premier jour de file, pour le scénario tel quel et chaque option | Les runs du moteur, lus dans le relevé de chaque test. Jamais d'une phrase |
| Le niveau de preuve de chaque élément : Measured, Published, Assumption | Le programme, d'après d'où vient l'élément (jumeau, scénario, option, règle du moteur) |
| Les tampons qu'ajoute « Add to scenario » | Le test : ce sont ceux que le moteur a reçus |
| Le mécanisme en une phrase, ce que le test ne dit pas, la lecture, les arbitrages, les limites | Le modèle, chaque chiffre contrôlé par le vérificateur |

Ce que l'onglet ne fait pas, par construction : classer les options (elles restent dans l'ordre des tests), en lister une qui n'a pas été testée, en cacher une qui l'a été, écrire dans le scénario. Les arbitrages de valeur sont présentés à part, sous « Yours to weigh ».

Coût et durée sont bornés : trois tests au plus par objectif, et le scénario tel quel n'est lancé qu'une fois pour les trois.

## Les décisions

« Record decision » garde l'option retenue avec ce qu'on en attend. Le navigateur n'envoie que l'identifiant de l'échange et l'étape du test ; le serveur recopie tout le reste depuis son journal : l'objectif, les tampons, les chiffres du run testé avec et sans l'option, les arrivées jour par jour, les niveaux de preuve, les étapes sources. On ne peut donc enregistrer qu'une option que le moteur a testée.

Une décision ne se modifie pas : la revoir, c'est en enregistrer une autre.

Le suivi (« Compare with observed ») existe quand une série observée est liée au scénario, par le réglage « Reality check » du panneau Result. Il pose les arrivées que le run testé attendait à côté de celles qui ont été comptées, et donne l'écart : totaux sur les jours que les deux rapportent, écart moyen par jour, décalage des pics. Il ne conclut pas. Et il ne compare que des arrivées : le jumeau ne garde aucun historique des files ni de l'occupation, donc la file attendue n'a rien d'observé en face, ce que l'écran dit.

## La règle des chiffres

1. Chaque paragraphe cite les étapes sur lesquelles il repose.
2. Chaque chiffre du paragraphe doit se trouver dans les résultats de **ces** étapes, ou dans la question de la personne.
3. Un chiffre dérivé (différence, part, taux) passe par `calculate`, qui devient une étape citée.
4. Un chiffre écrit à côté d'un nom de site ou de territoire doit être dans la ligne de ce nom. S'il est dans la ligne d'un autre, c'est une interversion.
5. Un chiffre introuvable ou interverti renvoie le brouillon au modèle, deux fois au plus. Ensuite il est retiré, et l'écran montre l'endroit où il manquait.

Les outils rendent les comptes de personnes et les pourcentages arrondis une seule fois, comme l'écran les écrit (103, 93 %). Rendus avec une décimale, le modèle les arrondissait une seconde fois : 103,46 devenait 103,5 puis « environ 104 », à côté d'un panneau qui dit 103. Et la liste des sites où l'on attend arrive dans l'ordre où ils cassent, pour que « lequel d'abord » se lise au lieu de se calculer.

Ce que la règle garantit : aucun chiffre affiché n'a été inventé, ni pris dans la ligne d'un autre site. Ce qu'elle ne garantit pas : que la phrase autour du chiffre est juste. C'est pourquoi chaque étape s'ouvre sous la réponse, avec ce que l'outil a renvoyé.

## Le journal

Chaque échange est gardé dans `app.analyst_exchange` (migration 059) : la question ou l'objectif, le monde regardé, chaque étape avec son entrée, son résultat et son relevé, ce qui a été affiché, les chiffres retirés, le modèle et les jetons. La colonne `kind` (migration 060) dit si c'est une question (`ask`) ou un objectif (`options`). Rien n'est modifié après l'insertion.

L'identifiant de la ligne est choisi avant l'échange et part avec la ligne `done` du flux. C'est ce qui permet d'enregistrer une décision à partir d'un test : si l'écriture au journal a échoué, la décision est refusée et il faut tester à nouveau.

Les décisions sont dans `app.decision` (migration 061).

## L'écran

`AnalystPanel.tsx`, dans un `OverlayPanel` sous « Layers », replié à l'arrivée. Trois onglets ; chacun n'est construit qu'à sa première ouverture, puis garde ce qu'on y a fait.

**Options** (`OptionsTab.tsx`), de haut en bas : sur quoi les options sont testées ; l'objectif, et des objectifs suggérés d'après le run à l'écran ; les tests, qui s'affichent pendant qu'ils tournent ; le tableau ; une carte par option (mécanisme, sur quoi elle repose avec les niveaux de preuve, ce que le test ne dit pas, « Add to scenario », « Record decision ») ; la lecture ; les arbitrages laissés à la personne ; les limites ; ce sur quoi toutes les colonnes reposent ; les étapes. Un bandeau prévient si le scénario a changé depuis les tests.

**Decisions** (`DecisionsTab.tsx`) : les décisions du scénario ouvert d'abord, puis celles des autres scénarios du projet. Chacune montre qui l'a prise, quand, l'objectif, l'attendu sans et avec l'option, sur quoi elle reposait, et le suivi à la demande. L'onglet se lit même quand l'analyste est éteint : une décision est un enregistrement, pas une réponse.

**Ask**, de haut en bas :

- ce qu'il va lire (le scénario ou la réalité, et le run s'il y en a un) ;
- la question, et des questions suggérées selon ce qui est à l'écran ;
- les étapes, qui arrivent pendant la lecture ;
- la réponse : un bandeau vert quand tous les chiffres sont tracés, orange avec leur nombre quand certains ont été retirés ; sous chaque paragraphe, les puces des étapes citées, qui ouvrent l'étape ;
- ce qui est supposé, ce que la réponse ne peut pas dire ;
- les sites dont parle la réponse, qui pointent la carte dessus ;
- les questions à poser ensuite.

La maquette d'origine est `design/scenario-analyst.html`. Elle montre aussi deux onglets qui ne sont pas encore construits : « Event finder » (recherche en ligne) et « What it can use ».

## Ajouter un outil

1. L'écrire dans `backend/src/services/analyst-tools.ts` : un nom, une description pour le modèle, un schéma d'entrée, une validation, une fonction pure qui lit. L'ajouter à `READ_TOOLS`. Un outil qui ne sert qu'aux options va dans `analyst-options.ts` et dans `OPTION_TOOLS`.
2. Il lit, il n'écrit pas. S'il doit proposer une écriture, la validation reste un clic humain à l'écran. S'il doit rendre plus que le modèle n'a besoin de lire (des séries jour par jour, de quoi agir), il rend un `Recorded` : le résultat va au modèle, le relevé à l'écran et au journal.
3. Ses résultats nomment les choses comme le jumeau les nomme, et portent leurs unités dans le nom des champs (`occupancy_pct`, `units_per_1000_residents`).
4. Un cas qu'il ne sait pas traiter lève une `ToolError` qui dit quoi faire à la place.
5. Lui donner un libellé lisible dans `stepLabel` (`frontend/app/studio/analyst-api.ts`).
6. Le tester dans `analyst-tools.unit.test.ts`.
7. Mettre à jour la table des outils ci-dessus, et le schéma A1 si la boucle change.

## Les questions de référence

L'analyste est un modèle de langage : « ça a marché quand j'ai essayé » n'est pas un test. La même question peut être bien répondue un jour et mal le lendemain, après un changement de ses consignes ou de la description d'un outil. Douze questions de référence, sur le jumeau de Montréal et le scénario Omicron calé sur l'INSPQ, disent ce qu'une bonne réponse doit contenir.

```bash
# backend/ — à la main, jamais dans la suite de tests : appelle la vraie API
OBSCYRO_API_KEY=... npm run eval:analyst
OBSCYRO_API_KEY=... npm run eval:analyst -- --run run.json --times 2 --show
```

| Ce qui est jugé | Comment |
|---|---|
| Une réponse a été donnée | L'échange se termine comme attendu |
| Aucun chiffre retiré | `verified` vrai, liste des chiffres retirés vide |
| Les bons outils ont lu | Chaque outil attendu a été appelé et a renvoyé quelque chose (`a\|b` : l'un ou l'autre) |
| Les faits connus y sont | Chaque chiffre attendu est dans la réponse, exact ou arrondi comme le vérificateur l'admet |
| Les mots attendus y sont | Sans tenir compte de la casse ni des accents |

Ce qui n'est pas jugé : la qualité de la rédaction. Il faut encore une personne, qui lit les réponses avec `--show`.

- Chaque question est rejouée deux fois par défaut : un jeu qui passe une fois n'a pas montré qu'il passe.
- Les questions sur un run demandent le résumé du run dans un fichier (`--run`), tel que la page l'envoie à l'analyste. Sans lui, elles sont sautées et le rapport le dit.
- Le script sort en erreur dès qu'une question échoue : il peut servir de garde avant de changer les consignes ou un outil.
- Les faits attendus sont dans le code (`QUESTIONS`). Quand le jumeau ou le scénario change, c'est la question qu'on corrige.

État au 2026-11-17 : écrit et testé avec des réponses simulées, **jamais exécuté contre le vrai modèle**, faute de clé.

**Code.** `backend/src/services/analyst-eval.ts` (les questions et le jugement), `backend/scripts/analyst-eval.ts` (le rejeu). **Tests.** `analyst-eval.unit.test.ts`.

## Limites connues

- Chaque question, chaque objectif est indépendant : l'analyste ne se souvient pas du précédent.
- Il ne cherche pas en ligne : c'est l'issue suivante.
- Le jumeau ne contient ni personnel, ni stocks, ni historique : l'analyste le dit, il ne le comble pas.
- Le run à l'écran n'est pas gardé au rechargement de la page ; il faut relancer Run. Les options testées non plus : ce qui reste, ce sont les décisions enregistrées et le journal.
- Une option est faite de capacité et de mesures. Un transfert de patients, du personnel, un stock, un lien nouveau entre un site et un territoire ne se testent pas : le moteur ou le jumeau ne les portent pas. L'analyste les range dans les limites.
- Une option est testée sur le scénario tel qu'il est au moment du test. Ajouter une option puis une autre donne un scénario qu'aucun test n'a couvert : l'écran prévient, et il faut redire l'objectif.
- Une option ajoute des tampons ; elle n'en retire ni n'en remplace aucun. « 40 lits au lieu des 60 du scénario » se teste donc comme un tampon de −20 par-dessus les +60. Le résultat est le bon, mais l'ajouter au scénario laisse les deux tampons dans la recette au lieu d'un seul à +40.
- Un objectif prend plusieurs minutes sur le jumeau de Montréal : chaque passe du moteur dure quelques dizaines de secondes, et le premier test en lance trois (les événements seuls, le scénario tel quel, l'option). Le tableau n'a besoin que des deux dernières : la première est à retirer.
- Le suivi d'une décision ne compare que des arrivées (voir « Les décisions »).

État au 2026-11-17 : l'onglet Options est vérifié en production avec le vrai modèle et le vrai moteur, sur le scénario « Omicron · Montréal — calibrated on INSPQ » : trois options testées pour un objectif, aucun chiffre retiré, et la colonne « As it is » redonne les chiffres du panneau Result. « Add to scenario », « Record decision » et le suivi sont couverts par les tests, **pas encore exercés en production** : ils écrivent dans le scénario de démonstration et dans la liste des décisions.

## Fichiers

| Rôle | Fichier |
|---|---|
| Boucle, clôture d'une question, `give_answer` | `backend/src/services/analyst.ts` |
| Outils de lecture, résumé du run | `backend/src/services/analyst-tools.ts` |
| Outil `test_option`, clôture d'un objectif, `give_options` | `backend/src/services/analyst-options.ts` |
| Run d'un scénario sur le serveur | `backend/src/services/scenario-run.ts`, `scenario-stamps.ts` |
| Décisions et suivi | `backend/src/services/decisions.ts` |
| Vérificateur | `backend/src/services/analyst-verify.ts` |
| Calculatrice | `backend/src/services/analyst-calc.ts` |
| Routes de l'analyste, contexte, journal | `backend/src/routes/analyst.ts` |
| Routes des décisions | `backend/src/routes/decisions.ts` |
| Réponse en flux | `backend/src/lib/ndjson.ts` |
| Journal et décisions | `backend/scripts/migrations/059_analyst_exchange.sql`, `060_analyst_exchange_kind.sql`, `061_decision.sql` |
| Appels et libellés côté écran | `frontend/app/studio/analyst-api.ts` |
| Panneau et onglet Ask | `frontend/app/studio/simulation/hex/AnalystPanel.tsx` |
| Onglets Options et Decisions | `frontend/app/studio/simulation/hex/OptionsTab.tsx`, `DecisionsTab.tsx` |
| Pièces communes aux onglets | `frontend/app/studio/simulation/hex/analyst-parts.tsx` |
| Résumé du run | `frontend/app/studio/simulation/hex/run-digest.ts` |
