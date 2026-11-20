# L'analyste

L'analyste est le panneau repliable « Analyst » de la page Scenarios. On lui pose une question sur le jumeau, le scénario ouvert ou le run à l'écran ; il répond en ne s'appuyant que sur ce que des outils de lecture lui ont renvoyé, et montre tout ce qu'il a lu.

Le panneau a quatre onglets, qui couvrent cinq étapes de la [boucle d'aide à la décision](decision-loop.md) :

| Onglet | Étape de la boucle | Ce qu'on y fait |
|---|---|---|
| Ask | Situation | Poser une question, lire la réponse et ce qui a été lu pour l'écrire |
| Event finder | Précédents | Chercher dans des sources officielles ce qui se passait autour du réseau, accepter ou refuser chaque événement trouvé |
| Options | Options testées, Recommandation | Dire un objectif, voir jusqu'à trois options testées par le moteur à côté du scénario tel quel |
| Decisions | Suivi | Relire ce qui a été retenu, ce qu'on en attendait, et l'écart avec ce qui a été observé |

Les schémas de la boucle, du vérificateur et de la calculatrice sont dans [algorithms.md](algorithms.md), sections A1 à A3 ; ceux des options testées et des décisions, sections A8 et A9 ; celui de la recherche en ligne et du calendrier, section A10.

## Ce qu'il fait, et ce qu'il ne fait pas

| Il fait | Il ne fait pas |
|---|---|
| Choisir quoi lire, puis rédiger | Détenir un fait sur le réseau |
| Citer, pour chaque paragraphe, les étapes sur lesquelles il repose | Calculer de tête |
| Dire ce qui manque quand les outils ne peuvent pas répondre | Combler un manque par une estimation |
| Lire | Écrire dans le jumeau ou le scénario |
| Faire tester une option par le moteur, et dire ce que le test montre | Classer des options qu'il n'a pas testées, recommander, décider |
| Chercher en ligne, dans les sources que le projet autorise, et proposer des événements | Mettre un événement au calendrier, envoyer dans une recherche quoi que ce soit du jumeau, tenir pour mesuré ce qu'une source a publié |

## Le mettre en service

Il lit le jumeau à travers l'API Claude. Il lui faut la variable `ANTHROPIC_API_KEY` sur le service de l'API. Sans elle il est éteint, le panneau le dit, et rien d'autre dans le produit n'en dépend.

Ce que les outils lisent du jumeau (des comptes et des capacités, jamais une personne) est envoyé à l'API Claude pour rédiger la réponse. Le panneau le dit en pied.

L'onglet Event finder utilise la recherche web de l'API Claude. Elle n'a pas de variable à elle : elle marche avec la même clé, à deux conditions qui se règlent dans la console Claude et non dans le produit. La recherche web doit être permise pour l'organisation (elle l'est par défaut ; coupée, la demande échoue avec une erreur du modèle), et les domaines du projet ne doivent pas sortir d'une liste que l'organisation aurait restreinte. Elle est facturée en plus des jetons : 10 $ US pour 1 000 recherches au tarif lu le 2026-11-17, huit recherches au plus par demande.

État au 2026-11-17 : en service en production, vérifié avec le vrai modèle. Le premier test a trouvé deux défauts, corrigés le jour même (une interversion de deux sites et un chiffre arrondi deux fois, voir « La règle des chiffres »), puis les questions de référence ont toutes passé deux fois de suite (voir plus bas).

## Les routes

| Route | Ce qu'elle rend |
|---|---|
| `GET /v1/ontology/:env/analyst` | `{ configured, model }` : l'analyste peut-il être interrogé |
| `POST /v1/ontology/:env/analyst/ask` | Un flux, une ligne JSON par événement : une question et sa réponse |
| `POST /v1/ontology/:env/analyst/options` | Le même flux : un objectif et les options testées |
| `POST /v1/ontology/:env/analyst/events` | Le même flux : une demande et les événements candidats trouvés en ligne |
| `POST /v1/ontology/:env/analyst/run` | Un flux plus court : le scénario tourné par le serveur comme le fait Run, et son résumé, dans la forme que `ask` et `options` acceptent comme `run`. N'appelle aucun modèle et n'écrit rien |
| `POST /v1/ontology/:env/decisions` | Enregistre une décision à partir d'une option testée |
| `GET /v1/ontology/:env/decisions` | Les décisions du projet, les plus récentes d'abord (`scenarioId` pour un seul scénario) |
| `GET /v1/ontology/:env/decisions/:id/follow-up` | Les arrivées attendues par une décision à côté de la série observée, avec l'écart |
| `POST /v1/ontology/:env/health-events` | Accepte un candidat : il entre au calendrier |
| `GET /v1/ontology/:env/health-events` | Le calendrier du projet, du plus ancien au plus récent (`from`, `to` pour une période) |
| `DELETE /v1/ontology/:env/health-events/:id` | Retire un événement du calendrier |
| `GET /v1/ontology/:env/web-sources` | Les domaines où la recherche a le droit de chercher |
| `PUT /v1/ontology/:env/web-sources` | Remplace cette liste |

Corps de la question : `question`, `scenarioId` (ou `null`), `looking` (`reality` ou `scenario`), `run` (le résumé du run à l'écran, ou `null`).

Corps d'un objectif : `objective`, `scenarioId` (obligatoire : une option s'ajoute à un scénario), `horizon` et `activity` (ceux de la page, pour que le test réponde à ce que Run montrerait), `run`.

Corps d'une décision : `exchangeId` et `step`, rien d'autre. Les chiffres sont recopiés par le serveur depuis son journal.

Corps d'une recherche d'événements : `request`, et `scenarioId` (ou `null`), qui ne sert qu'à dire au journal d'où la demande a été faite. Ni le run ni rien du jumeau n'en fait partie.

Corps d'une acceptation : `exchangeId`, `candidate` (`c1`, `c2`…), `startsOn` et `endsOn` (ou `null`). Le titre, le lien et le passage sont recopiés par le serveur depuis son journal.

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

Aucun n'écrit. Onze lisent ; un douzième, `test_option`, fait tourner le moteur, et n'existe que dans l'onglet Options. Deux mondes : `reality`, le jumeau tel qu'il est ; `scenario`, le même jumeau lu à travers le scénario ouvert.

L'onglet Event finder est à part : il n'a aucun de ces outils. Il n'a que la recherche web de l'API (`web_search`), qui tourne chez Anthropic et non chez nous, et son outil de livraison. C'est ce qui garantit qu'une recherche ne peut rien emporter du jumeau.

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
| `list_events` | Le calendrier : les événements validés, leurs dates, leur lieu, leur porte, la source qui les a publiés et le passage cité. Quand le jour 0 du scénario a une date, chaque événement est aussi placé sur les jours du run |
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
| Remplacer un choix du scénario : la même capacité ou la même mesure, avec d'autres unités, un autre jour, une autre durée | Le choix est désigné par le nom que lui donne `scenario_recipe` ; c'est une capacité remplacée par une capacité, ou une mesure par une mesure |
| Retirer un choix du scénario | Le choix est désigné par son nom |

« 40 lits au lieu des 60 du scénario » est donc un seul tampon à +40 : le test tourne sans les 60 et avec les 40, et c'est ce que la recette contient une fois l'option appliquée. Seuls les choix (mesures, capacité) se remplacent ou se retirent. Les conditions de départ et les événements sont ce qui arrive : une option ne les défait pas.

Ce qui vient du modèle et ce qui n'en vient pas :

| À l'écran | D'où ça vient |
|---|---|
| Le tableau : pic, sites avec une file, jours-patients d'attente, premier jour de file, pour le scénario tel quel et chaque option | Les runs du moteur, lus dans le relevé de chaque test. Jamais d'une phrase |
| Le niveau de preuve de chaque élément : Measured, Published, Assumption | Le programme, d'après d'où vient l'élément (jumeau, scénario, option, règle du moteur) |
| Les tampons qu'ajoute « Add to scenario » | Le test : ce sont ceux que le moteur a reçus |
| « What it does to the scenario » : ce que l'option ajoute, remplace et retire, quand elle ne fait pas qu'ajouter | Le programme, à partir des tampons. Le bouton dit alors « Apply to scenario » |
| Le mécanisme en une phrase, ce que le test ne dit pas, la lecture, les arbitrages, les limites | Le modèle, chaque chiffre contrôlé par le vérificateur |

Ce que l'onglet ne fait pas, par construction : classer les options (elles restent dans l'ordre des tests), en lister une qui n'a pas été testée, en cacher une qui l'a été, écrire dans le scénario. Les arbitrages de valeur sont présentés à part, sous « Yours to weigh ».

Coût et durée sont bornés : trois tests au plus par objectif, et le scénario tel quel n'est lancé qu'une fois pour les trois, en une seule passe du moteur. Trois options font quatre passes. Pendant un test, l'onglet dit depuis combien de temps il tourne.

## Les événements

L'analyste ne connaît que le jumeau. Il ne peut pas dire qu'un couvre-feu commençait tel jour. L'onglet Event finder lui donne une recherche en ligne, limitée aux sources officielles que le projet autorise, et un calendrier où n'entre que ce qu'une personne a accepté. Le schéma complet est dans [algorithms.md](algorithms.md), section A10.

On écrit une demande : « What measures were in force in Montréal between 2021-12-01 and 2022-02-28? ». L'analyste cherche, puis rend des événements **candidats** : un titre, des dates, un lieu, la porte par laquelle l'événement touche un réseau de santé (demande, capacité, accès, soins), le lien vers la source et un court passage cité, entre guillemets.

Ce qui vient du modèle et ce qui n'en vient pas :

| À l'écran | D'où ça vient |
|---|---|
| Le lien, le titre de la page, le passage | Les citations de la recherche, rendues par l'API. Le serveur vérifie que la page est dans les sources autorisées |
| La citation entre guillemets, moins de quinze mots | Le modèle la choisit **dans** un passage ; le serveur vérifie qu'elle y est, mot pour mot. Sinon ce sont les premiers mots du passage, et l'écran le dit |
| Les dates | Le modèle les propose ; le serveur ne garde que celles qu'un passage énonce. Les autres restent vides, et la personne les saisit d'après la source |
| Le niveau « Published » et la puce WEB | Le programme |
| Le titre, le lieu, la porte | Le modèle. Un chiffre du titre qui n'est pas dans les passages est retiré |

**Accept** fait entrer le candidat au calendrier, avec les dates que la personne a validées ; elle peut les corriger d'abord, et les deux versions sont gardées. **Reject** n'envoie rien au serveur : le candidat n'entre dans aucune table d'événements, et ni l'analyste ni la frise ne le voient. Il reste dans le journal de l'échange où il a été proposé, comme tout ce que l'analyste a écrit.

Une fois accepté, un événement :

- apparaît dans le couloir « Context » de la frise, placé d'après la date que le scénario donne à son jour 0 (réglage « Reality check »). Sans cette date, le couloir dit pourquoi il est vide ;
- est lu par l'analyste avec `list_events`, dans les onglets Ask et Options. Une réponse qui s'en sert porte, sous le paragraphe, une puce WEB avec le lien et le niveau « Published » ;
- se retire du calendrier depuis la frise, sur un clic confirmé.

Les sources se règlent dans l'onglet (« Sources searched », Change) : une liste de domaines par projet, vingt au plus. Sans réglage, la liste de départ s'applique : inspq.qc.ca, quebec.ca, msss.gouv.qc.ca, donneesquebec.ca, canada.ca, who.int.

Rien du jumeau ne part dans une recherche. Dans cet échange le modèle n'a aucun outil de lecture, et son contexte ne nomme ni le projet ni le scénario : il n'a que la demande, la liste des sources et la date du jour.

État au 2026-11-17, en production, avec le vrai modèle et la vraie recherche, sur le scénario « Omicron · Montréal — calibrated on INSPQ ».

- La demande « What public health measures were in force in Montréal between 2021-12-13 and 2022-02-10? Include the curfew and the dates schools closed and reopened in Québec. » a rendu douze candidats en cinq recherches, sans rien de retiré. Parmi eux le couvre-feu, du 31 décembre 2021 au 17 janvier 2022 (quebec.ca), et les écoles, fermées à compter du 21 décembre avec un retour en classe le 17 janvier (inspq.qc.ca et quebec.ca). Les passages de ces deux candidats ont été relus un à un : ils disent ce que les candidats en retiennent.
- Deux candidats sont arrivés sans date de début, parce que leur passage ne la donnait pas : l'écran demande de la lire dans la source.
- Reject n'a déclenché aucun appel au serveur.
- Dans l'onglet Ask, `list_events` a répondu que le calendrier est vide et a renvoyé vers Event finder ; une question de référence sur le jumeau a redonné ses chiffres connus.
- **Pas encore exercé en production : Accept, le couloir Context, et une réponse qui cite un événement.** Ils sont couverts par les tests. Accepter écrit dans le calendrier du projet de démonstration : ce clic revient à une personne.
- Coût observé de cette demande : 32 étapes, 5 recherches, environ 319 000 jetons lus et écrits, la plupart étant le contenu des pages que la recherche renvoie au modèle.

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
6. Un chiffre venu du web doit se trouver dans le passage cité, ou dans le titre de sa page. Une date y compte quand le passage l'écrit, même en toutes lettres. Dans une réponse, un événement du calendrier se cite par l'étape `list_events` qui l'a rendu : ses dates sont celles qu'une personne a validées.

Les outils rendent les comptes de personnes et les pourcentages arrondis une seule fois, comme l'écran les écrit (103, 93 %). Rendus avec une décimale, le modèle les arrondissait une seconde fois : 103,46 devenait 103,5 puis « environ 104 », à côté d'un panneau qui dit 103. Et la liste des sites où l'on attend arrive dans l'ordre où ils cassent, pour que « lequel d'abord » se lise au lieu de se calculer.

Ce que la règle garantit : aucun chiffre affiché n'a été inventé, ni pris dans la ligne d'un autre site. Ce qu'elle ne garantit pas : que la phrase autour du chiffre est juste. C'est pourquoi chaque étape s'ouvre sous la réponse, avec ce que l'outil a renvoyé.

## Le journal

Chaque échange est gardé dans `app.analyst_exchange` (migration 059) : la question ou l'objectif, le monde regardé, chaque étape avec son entrée, son résultat et son relevé, ce qui a été affiché, les chiffres retirés, le modèle et les jetons. La colonne `kind` dit si c'est une question (`ask`), un objectif (`options`, migration 060) ou une recherche d'événements (`events`, migration 062). Pour une recherche, le monde regardé est `web`, et les étapes sont les requêtes, les pages rendues et les passages cités. Rien n'est modifié après l'insertion.

L'identifiant de la ligne est choisi avant l'échange et part avec la ligne `done` du flux. C'est ce qui permet d'enregistrer une décision à partir d'un test : si l'écriture au journal a échoué, la décision est refusée et il faut tester à nouveau.

Les décisions sont dans `app.decision` (migration 061). Les événements acceptés sont dans `app.health_event`, et les sources autorisées d'un projet dans `app.project_web_source` (migration 062).

## L'écran

`AnalystPanel.tsx`, dans un `OverlayPanel` sous « Layers », replié à l'arrivée. Quatre onglets, dans l'ordre de la boucle ; chacun n'est construit qu'à sa première ouverture, puis garde ce qu'on y a fait.

**Event finder** (`EventFinderTab.tsx`), de haut en bas : la demande, et des demandes suggérées sur les dates du scénario, où il reste à écrire le lieu ; les sources cherchées et de quoi les changer ; les recherches, qui s'affichent pendant qu'elles tournent ; un bandeau qui dit si tout a été trouvé dans les passages ; une carte par candidat (porte, niveau « Published », puce WEB, titre, lieu, citation et lien, les passages sur lesquels il repose, qui ouvrent l'étape où le passage se lit en entier, dates à corriger, Accept, Reject) ; ce qui n'a pas été trouvé ; les limites ; les étapes. Un candidat refusé se replie en une ligne, avec de quoi revenir dessus : le refus n'a rien écrit nulle part.

**Context** (`ContextLane.tsx`) n'est pas dans le panneau mais dans la frise : le couloir des événements validés, au-dessus des couloirs de tampons. Un clic sur un événement l'ouvre : source, citation, qui l'a accepté, et de quoi le retirer.

**Options** (`OptionsTab.tsx`), de haut en bas : sur quoi les options sont testées ; l'objectif, et des objectifs suggérés d'après le run à l'écran ; les tests, qui s'affichent pendant qu'ils tournent, avec la durée de ce qui est en cours ; le tableau ; une carte par option (mécanisme, sur quoi elle repose avec les niveaux de preuve, ce que le test ne dit pas, « Add to scenario », « Record decision ») ; la lecture ; les arbitrages laissés à la personne ; les limites ; ce sur quoi toutes les colonnes reposent ; les étapes. Un bandeau dit quand le scénario n'est plus celui qui a été testé, et pourquoi : une option ajoutée depuis l'onglet, plusieurs ajoutées ensemble, ou une modification faite ailleurs.

**Decisions** (`DecisionsTab.tsx`) : les décisions du scénario ouvert d'abord, puis celles des autres scénarios du projet. Chacune montre qui l'a prise, quand, l'objectif, l'attendu sans et avec l'option, sur quoi elle reposait, et le suivi à la demande. L'onglet se lit même quand l'analyste est éteint : une décision est un enregistrement, pas une réponse.

**Ask**, de haut en bas :

- ce qu'il va lire (le scénario ou la réalité, et le run s'il y en a un) ;
- la question, et des questions suggérées selon ce qui est à l'écran ;
- les étapes, qui arrivent pendant la lecture ;
- la réponse : un bandeau vert quand tous les chiffres sont tracés, orange avec leur nombre quand certains ont été retirés ; sous chaque paragraphe, les puces des étapes citées, qui ouvrent l'étape, et, quand le paragraphe s'appuie sur des événements du calendrier, une puce WEB par événement avec son lien et le niveau « Published » ;
- ce qui est supposé, ce que la réponse ne peut pas dire ;
- les sites dont parle la réponse, qui pointent la carte dessus ;
- les questions à poser ensuite.

La maquette d'origine est `design/scenario-analyst.html`. Elle montre aussi un onglet qui n'est pas encore construit : « What it can use ».

## Ajouter un outil

1. L'écrire dans `backend/src/services/analyst-tools.ts` : un nom, une description pour le modèle, un schéma d'entrée, une validation, une fonction pure qui lit. L'ajouter à `READ_TOOLS`. Un outil qui ne sert qu'aux options va dans `analyst-options.ts` et dans `OPTION_TOOLS`.
2. Il lit, il n'écrit pas. S'il doit proposer une écriture, la validation reste un clic humain à l'écran. S'il doit rendre plus que le modèle n'a besoin de lire (des séries jour par jour, de quoi agir), il rend un `Recorded` : le résultat va au modèle, le relevé à l'écran et au journal.
3. Ses résultats nomment les choses comme le jumeau les nomme, et portent leurs unités dans le nom des champs (`occupancy_pct`, `units_per_1000_residents`).
4. Un cas qu'il ne sait pas traiter lève une `ToolError` qui dit quoi faire à la place.
5. Lui donner un libellé lisible dans `stepLabel` (`frontend/app/studio/analyst-api.ts`).
6. Le tester dans `analyst-tools.unit.test.ts`.
7. Mettre à jour la table des outils ci-dessus, et le schéma A1 si la boucle change.

## Les questions de référence

L'analyste est un modèle de langage : « ça a marché quand j'ai essayé » n'est pas un test. La même question peut être bien répondue un jour et mal le lendemain, après un changement de ses consignes ou de la description d'un outil. Seize questions de référence, sur le jumeau de Montréal et le scénario Omicron calé sur l'INSPQ, disent ce qu'une bonne réponse doit contenir.

```bash
# backend/ — à la main, jamais dans la suite de tests : appelle la vraie API
npm run eval:analyst
npm run eval:analyst -- --times 2 --show
npm run eval:analyst -- --only three-sites,two-catchments,in-french
```

**La clé.** Le script agit comme une personne : il lui faut une clé d'API Obscyro d'un utilisateur qui peut lire l'environnement. Elle se crée sur la page des clés du compte (`/app/keys`) et s'y révoque ensuite. Le script la lit dans `OBSCYRO_API_KEY` si la variable existe ; sinon il la demande au terminal, tapée ou collée sans s'afficher. C'est la façon à préférer : la clé n'est alors écrite nulle part, ni dans un fichier, ni dans l'historique du terminal. Elle n'a sa place ni dans le dépôt, ni dans `backend/.env`, ni dans un journal, et le script ne l'imprime jamais.

**Le run.** Certaines questions portent sur « le run à l'écran ». Le script n'a pas d'écran : il demande au serveur de faire tourner le scénario de référence (`POST /v1/ontology/:env/analyst/run`), c'est-à-dire les deux passes que fait Run sur la page, résumées comme la page les résume. Ce résumé part avec les questions sur le run. Il faut compter environ une minute avant la première question, et le script écrit en une ligne de quel run il s'agit (pic, sites avec une file, jours-patients d'attente, avec et sans les choix) : c'est ce qui permet de distinguer une réponse fausse d'un scénario modifié depuis.

| Option | Ce qu'elle fait |
|---|---|
| `--horizon`, `--activity` | Les jours du run et l'activité qu'il lit. Par défaut 60 jours et `litsantephysique`, comme la page |
| `--save-run fichier.json` | Garde le run fait par le serveur |
| `--run fichier.json` | Rejoue un run gardé, sans en refaire un |
| `--no-run` | Ne fait aucun run : les questions sur le run sont sautées, et le rapport le dit |
| `--only id,id` | Seulement ces questions |
| `--times n` | Chaque question n fois. Par défaut 2 |
| `--show` | Imprime chaque réponse, pour qu'une personne la lise |

| Ce qui est jugé | Comment |
|---|---|
| Une réponse a été donnée | L'échange se termine comme attendu |
| Aucun chiffre retiré | `verified` vrai, liste des chiffres retirés vide |
| Les bons outils ont lu | Chaque outil attendu a été appelé et a renvoyé quelque chose (`a\|b` : l'un ou l'autre) |
| Les faits connus y sont | Chaque chiffre attendu est dans la réponse, exact ou arrondi comme le vérificateur l'admet |
| Les mots attendus y sont | Sans tenir compte de la casse ni des accents |
| Chaque nom garde son chiffre | Un nom et son chiffre sont dans la même proposition (`pairs`) : c'est ce qui attrape deux chiffres justes écrits chacun à côté du mauvais site |

Ce qui n'est pas jugé : la qualité de la rédaction. Il faut encore une personne, qui lit les réponses avec `--show`.

- Chaque question est rejouée deux fois par défaut : un jeu qui passe une fois n'a pas montré qu'il passe.
- Trois questions ont été ajoutées après le premier rejeu réel, pour ce qu'il avait montré de fragile : trois sites cités avec un chiffre chacun (`three-sites`), deux territoires comparés (`two-catchments`), une question posée en français (`in-french`).
- Le script sort en erreur dès qu'une question échoue : il peut servir de garde avant de changer les consignes ou un outil.
- Les faits attendus sont dans le code (`QUESTIONS`). Quand le jumeau ou le scénario change, c'est la question qu'on corrige.

### Dernier rejeu

2026-11-17, en production, modèle `claude-opus-5-5`, effort `medium`, scénario « Omicron · Montréal — calibrated on INSPQ » avec son run à l'écran :

| | |
|---|---|
| Questions | 13, rejouées 2 fois chacune : 26 réponses |
| Réussies | 26 sur 26 |
| Chiffres retirés | aucun |
| Durée médiane d'une réponse | 15,1 s |
| Réponse la plus lente | 38,8 s (une question sur le run, 7 étapes) |
| Jetons par réponse | de 11 500 à 61 800 |

L'effort reste à `medium` : à cette durée il n'y a rien à gagner à le baisser, et le rejeu passe sans rien retirer.

Ce rejeu a été lancé depuis la page, dans le navigateur, avec le même code de jugement (`judge`, `QUESTIONS`) que le script, et le résumé du run venait de la page elle-même. Il portait sur les treize questions d'alors.

Depuis le 2026-11-20, le script n'a plus besoin de rien de préparé à la main : le serveur fait le run, et la clé se donne au terminal. **Il reste à le lancer une fois contre la production, deux passes, et à remplacer ce tableau par son résultat** : c'est une personne qui détient la clé, pas un outil.

Quatre réponses ont été relues par une personne et comparées au panneau Result : l'ordre des files, le résumé des choix, le cas sans run, et la question à laquelle l'outil ne peut pas répondre.

**Code.** `backend/src/services/analyst-eval.ts` (les questions, le jugement, la lecture d'un flux), `backend/scripts/analyst-eval.ts` (le rejeu), `serverRun` dans `backend/src/services/scenario-run.ts` et la route `POST /v1/ontology/:env/analyst/run` dans `backend/src/routes/analyst.ts` (le run fait par le serveur). **Tests.** `analyst-eval.unit.test.ts`, `scenario-run.unit.test.ts`, `routes/analyst.unit.test.ts`.

## Limites connues

- Chaque question, chaque objectif est indépendant : l'analyste ne se souvient pas du précédent.
- Il ne cherche en ligne que dans l'onglet Event finder. Dans Ask et Options il lit les événements déjà validés, et dit quand aucun ne couvre le moment demandé.
- Une recherche ne voit que ce que les sources autorisées publient et que le moteur de recherche de l'API en a retenu. Un événement absent des candidats n'est pas un événement qui n'a pas eu lieu.
- Le serveur ne détient d'une page web que le passage cité, 150 caractères au plus. Une date que la page donne ailleurs que dans ce passage reste vide : il faut ouvrir la source et la saisir.
- Ce qui est vérifié d'un candidat : son lien, sa citation, ses dates. Que le passage dise bien ce que le titre en retient, et que la porte soit la bonne, c'est la personne qui le juge en acceptant.
- Le titre, le lieu et la porte d'un candidat ne se corrigent pas à l'écran : seules les dates le peuvent. Un candidat mal titré se refuse.
- Un événement n'a qu'un lieu écrit en mots. Il n'est relié à aucun territoire du jumeau, et le moteur ne le reçoit pas : c'est un repère pour lire un run, pas une entrée du run.
- Les événements validés sont ceux du projet, pas d'un scénario : tous les scénarios du projet voient le même calendrier.
- Une recherche coûte cher en jetons : chaque recherche renvoie jusqu'à dix pages au modèle, et elles sont relues à la requête suivante. Environ 300 000 jetons pour cinq recherches, en plus du prix des recherches : [issue 11](https://github.com/V1ktor7/obscyro/issues/11).
- Le jumeau ne contient ni personnel, ni stocks, ni historique : l'analyste le dit, il ne le comble pas.
- Le run à l'écran n'est pas gardé au rechargement de la page ; il faut relancer Run. Les options testées non plus : ce qui reste, ce sont les décisions enregistrées et le journal.
- Une option est faite de capacité et de mesures. Un transfert de patients, du personnel, un stock, un lien nouveau entre un site et un territoire ne se testent pas : le moteur ou le jumeau ne les portent pas. L'analyste les range dans les limites.
- Une option est testée sur le scénario tel qu'il est au moment du test. Ajouter une option puis une autre donne un scénario qu'aucun test n'a couvert : l'écran prévient, et il faut redire l'objectif.
- Une option peut remplacer ou retirer un choix du scénario, mais pas une condition de départ ni un événement. Remplacer une capacité par une mesure se fait en deux changements de la même option : retirer l'une, ajouter l'autre.
- Appliquer une option qui retire un choix se fait en deux écritures, le nouveau tampon puis le retrait de l'ancien, et non en une seule opération. Si la seconde échoue, la recette garde les deux tampons : l'écran le montre, et le retrait se fait à la main. Si le tampon à retirer n'est plus là au moment du clic, rien n'est écrit.
- Le nom d'un choix (`choice-a`) vaut pour un échange. Une question suivante relit la recette et peut lui donner un autre nom.
- Un objectif prend plusieurs minutes sur le jumeau de Montréal. Le premier test lance deux passes du moteur (le scénario tel quel, puis l'option) après avoir lu le jumeau et calculé la propagation ; les suivants, une seule. Mesuré en production le 2026-11-18, sur le scénario de démonstration et le même objectif (« How do we stop the queue at Lakeshore? »), trois options testées :

  | | Avant (trois passes au premier test) | Après (deux passes) |
  |---|---|---|
  | Premier test | 161 s | 64 s : une passe de 31 s, une de 32 s |
  | Deuxième et troisième tests | 30 s et 31 s | 33 s et 33 s |
  | Les trois tests | 222 s | 130 s |
  | L'objectif entier | cinq à six minutes | un peu moins de trois minutes |

  La passe retirée fait gagner une passe, une trentaine de secondes. Le reste de l'écart sur le premier test vient de la lecture du jumeau, qu'une étape précédente avait déjà faite dans le second relevé et pas dans le premier. La colonne « As it is » est restée la même : 93 %, 3 sites sur 34, 267 jours-patients, première file au jour 20. Une passe du moteur prend donc une trentaine de secondes sur ce jumeau, et c'est elle qui fixe la durée : pour aller plus vite il faut accélérer le moteur, pas l'analyste.
- Le suivi d'une décision ne compare que des arrivées (voir « Les décisions »).

État au 2026-11-17 : vérifié en production avec le vrai modèle et le vrai moteur, sur le scénario « Omicron · Montréal — calibrated on INSPQ ».

- Un objectif (« How do we stop the queue at Lakeshore? ») a rendu trois options testées, sans aucun chiffre retiré, et la colonne « As it is » redonne les chiffres du panneau Result.
- Une option ajoutée au scénario, puis Run : le panneau Result redonne les chiffres de sa colonne (pic 92 %, 3 sites sur 34, 267 jours-patients d'attente, première file au jour 20). Ses tampons retirés, le scénario est revenu à ses 20 tampons et à ses chiffres d'origine.
- Une décision enregistrée se relit dans l'onglet Decisions, et son suivi donne 2 954 arrivées attendues contre 2 944 observées sur 60 jours.

Cette décision de test (« 40 beds at Lakeshore from day 10 instead of 60 ») reste dans la liste du projet de démonstration : rien à l'écran ne permet de la supprimer.

## Fichiers

| Rôle | Fichier |
|---|---|
| Boucle, clôture d'une question, `give_answer` | `backend/src/services/analyst.ts` |
| Outils de lecture, résumé du run | `backend/src/services/analyst-tools.ts` |
| Outil `test_option`, clôture d'un objectif, `give_options` | `backend/src/services/analyst-options.ts` |
| Clôture d'une recherche d'événements, `give_events` | `backend/src/services/analyst-events.ts` |
| Lecture de la recherche web : requêtes, pages, passages, dates, citations | `backend/src/services/analyst-web.ts` |
| Sources autorisées d'un projet | `backend/src/services/web-sources.ts` |
| Calendrier des événements acceptés | `backend/src/services/health-events.ts` |
| Run d'un scénario sur le serveur | `backend/src/services/scenario-run.ts`, `scenario-stamps.ts` |
| Décisions et suivi | `backend/src/services/decisions.ts` |
| Vérificateur | `backend/src/services/analyst-verify.ts` |
| Calculatrice | `backend/src/services/analyst-calc.ts` |
| Routes de l'analyste, contexte, journal | `backend/src/routes/analyst.ts` |
| Routes des décisions | `backend/src/routes/decisions.ts` |
| Routes du calendrier et des sources | `backend/src/routes/health-events.ts` |
| Réponse en flux | `backend/src/lib/ndjson.ts` |
| Journal, décisions, calendrier | `backend/scripts/migrations/059_analyst_exchange.sql`, `060_analyst_exchange_kind.sql`, `061_decision.sql`, `062_health_event.sql` |
| Appels et libellés côté écran | `frontend/app/studio/analyst-api.ts` |
| Panneau et onglet Ask | `frontend/app/studio/simulation/hex/AnalystPanel.tsx` |
| Onglets Options et Decisions | `frontend/app/studio/simulation/hex/OptionsTab.tsx`, `DecisionsTab.tsx` |
| Onglet Event finder | `frontend/app/studio/simulation/hex/EventFinderTab.tsx` |
| Couloir Context de la frise | `frontend/app/studio/simulation/hex/ContextLane.tsx`, `context-lane.ts` |
| Pièces communes aux onglets | `frontend/app/studio/simulation/hex/analyst-parts.tsx` |
| Résumé du run | `frontend/app/studio/simulation/hex/run-digest.ts` |
