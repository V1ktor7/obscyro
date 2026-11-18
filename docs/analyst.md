# L'analyste

L'analyste est le panneau repliable « Analyst » de la page Scenarios. On lui pose une question sur le jumeau, le scénario ouvert ou le run à l'écran ; il répond en ne s'appuyant que sur ce que des outils de lecture lui ont renvoyé, et montre tout ce qu'il a lu.

C'est la première pièce de la [boucle d'aide à la décision](decision-loop.md) : l'étape « Situation ».

Les schémas de la boucle, du vérificateur et de la calculatrice sont dans [algorithms.md](algorithms.md), sections A1 à A3.

## Ce qu'il fait, et ce qu'il ne fait pas

| Il fait | Il ne fait pas |
|---|---|
| Choisir quoi lire, puis rédiger | Détenir un fait sur le réseau |
| Citer, pour chaque paragraphe, les étapes sur lesquelles il repose | Calculer de tête |
| Dire ce qui manque quand les outils ne peuvent pas répondre | Combler un manque par une estimation |
| Lire | Écrire dans le jumeau ou le scénario, lancer une simulation, décider |

## Le mettre en service

Il lit le jumeau à travers l'API Claude. Il lui faut la variable `ANTHROPIC_API_KEY` sur le service de l'API. Sans elle il est éteint, le panneau le dit, et rien d'autre dans le produit n'en dépend.

Ce que les outils lisent du jumeau (des comptes et des capacités, jamais une personne) est envoyé à l'API Claude pour rédiger la réponse. Le panneau le dit en pied.

État au 2026-11-17 : livré, testé avec un modèle simulé, **pas encore vérifié avec le vrai modèle**. C'est l'objet de la première issue de la suite.

## Les routes

| Route | Ce qu'elle rend |
|---|---|
| `GET /v1/ontology/:env/analyst` | `{ configured, model }` : l'analyste peut-il être interrogé |
| `POST /v1/ontology/:env/analyst/ask` | Un flux, une ligne JSON par événement |

Corps de la question : `question`, `scenarioId` (ou `null`), `looking` (`reality` ou `scenario`), `run` (le résumé du run à l'écran, ou `null`).

Lignes du flux :

| `type` | Contenu |
|---|---|
| `status` | Ce qui est en train d'être fait |
| `step` | Un appel d'outil : son numéro (`s1`, `s2`…), son entrée, son résultat ou son refus |
| `done` | La réponse, les chiffres retirés, les étapes, le modèle, les jetons |
| `failed` | Le modèle n'a pas pu être joint ; remplace `done` |
| `ping` | Rien : garde la connexion ouverte |

Une question refusée avant de commencer (pas de session, analyste éteint, corps invalide) est une erreur HTTP ordinaire, pas un flux.

## Les outils

Tous lisent, aucun n'écrit. Deux mondes : `reality`, le jumeau tel qu'il est ; `scenario`, le même jumeau lu à travers le scénario ouvert.

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

Un outil qui ne peut pas répondre (nom inconnu, deux sites pour un nom, pas de run à l'écran, table qui contient plusieurs séries) le dit par un refus motivé que le modèle lit. Il ne devine jamais.

Le résumé du run est construit par la page (`run-digest.ts`) avec les fonctions que lit déjà le panneau Result : l'analyste et le panneau ne peuvent pas diverger sur un chiffre.

## La règle des chiffres

1. Chaque paragraphe cite les étapes sur lesquelles il repose.
2. Chaque chiffre du paragraphe doit se trouver dans les résultats de **ces** étapes, ou dans la question de la personne.
3. Un chiffre dérivé (différence, part, taux) passe par `calculate`, qui devient une étape citée.
4. Un chiffre introuvable renvoie le brouillon au modèle, deux fois au plus. Ensuite il est retiré, et l'écran montre l'endroit où il manquait.

Ce que la règle garantit : aucun chiffre affiché n'a été inventé. Ce qu'elle ne garantit pas : que la phrase autour du chiffre est juste. Un chiffre peut exister dans l'étape citée et être mal étiqueté. C'est pourquoi chaque étape s'ouvre sous la réponse, avec ce que l'outil a renvoyé.

## Le journal

Chaque question est gardée dans `app.analyst_exchange` (migration 059) : la question, le monde regardé, chaque étape avec son entrée et son résultat, la réponse affichée, les chiffres retirés, le modèle et les jetons. Rien n'est modifié après l'insertion.

## L'écran

`AnalystPanel.tsx`, dans un `OverlayPanel` sous « Layers », replié à l'arrivée. De haut en bas :

- ce qu'il va lire (le scénario ou la réalité, et le run s'il y en a un) ;
- la question, et des questions suggérées selon ce qui est à l'écran ;
- les étapes, qui arrivent pendant la lecture ;
- la réponse : un bandeau vert quand tous les chiffres sont tracés, orange avec leur nombre quand certains ont été retirés ; sous chaque paragraphe, les puces des étapes citées, qui ouvrent l'étape ;
- ce qui est supposé, ce que la réponse ne peut pas dire ;
- les sites dont parle la réponse, qui pointent la carte dessus ;
- les questions à poser ensuite.

La maquette d'origine est `design/scenario-analyst.html`. Elle montre aussi deux onglets qui ne sont pas encore construits : « Event finder » (recherche en ligne) et « What it can use ».

## Ajouter un outil

1. L'écrire dans `backend/src/services/analyst-tools.ts` : un nom, une description pour le modèle, un schéma d'entrée, une validation, une fonction pure qui lit. L'ajouter à `READ_TOOLS`.
2. Il lit, il n'écrit pas. S'il doit proposer une écriture, la validation reste un clic humain à l'écran.
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

- Chaque question est indépendante : l'analyste ne se souvient pas de la précédente.
- Il ne cherche pas en ligne et ne teste pas d'option : ce sont les deux issues suivantes.
- Le jumeau ne contient ni personnel, ni stocks, ni historique : l'analyste le dit, il ne le comble pas.
- Le run à l'écran n'est pas gardé au rechargement de la page ; il faut relancer Run.

## Fichiers

| Rôle | Fichier |
|---|---|
| Boucle, consignes, `give_answer` | `backend/src/services/analyst.ts` |
| Outils de lecture, résumé du run | `backend/src/services/analyst-tools.ts` |
| Vérificateur | `backend/src/services/analyst-verify.ts` |
| Calculatrice | `backend/src/services/analyst-calc.ts` |
| Routes, contexte, journal | `backend/src/routes/analyst.ts` |
| Réponse en flux | `backend/src/lib/ndjson.ts` |
| Journal | `backend/scripts/migrations/059_analyst_exchange.sql` |
| Appels et libellés côté écran | `frontend/app/studio/analyst-api.ts` |
| Panneau | `frontend/app/studio/simulation/hex/AnalystPanel.tsx` |
| Résumé du run | `frontend/app/studio/simulation/hex/run-digest.ts` |
