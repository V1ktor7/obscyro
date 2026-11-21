# L'analyste

L'analyste est le panneau repliable « Analyst » de la page Scenarios. On lui pose une question sur le jumeau, le scénario ouvert ou le run à l'écran ; il répond en ne s'appuyant que sur ce que des outils de lecture lui ont renvoyé, et montre tout ce qu'il a lu.

Il est aussi à un clic sur les autres pages du Studio, par le bouton « Analyst » en bas à droite, et dans la fiche de situation qui s'ouvre depuis une alerte. Là il répond sur le réseau tel qu'il est maintenant : ce qui est ouvert, et les chiffres en direct d'une unité, chacun avec son âge.

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

Il lui faut aussi du crédit sur le compte Claude de cette clé. Quand il n'y en a plus, l'API refuse chaque demande, et l'analyste le dit tel quel : « The analyst's Claude account has no credit left, so it cannot answer. An administrator has to add credit in the Claude Console; trying again will not help until then. » Aucune réponse n'est inventée à la place.

Ce que les outils lisent du jumeau (des comptes et des capacités, jamais une personne) est envoyé à l'API Claude pour rédiger la réponse. Le panneau le dit en pied.

L'onglet Event finder utilise la recherche web de l'API Claude. Elle n'a pas de variable à elle : elle marche avec la même clé, à deux conditions qui se règlent dans la console Claude et non dans le produit. La recherche web doit être permise pour l'organisation (elle l'est par défaut ; coupée, la demande échoue avec une erreur du modèle), et les domaines du projet ne doivent pas sortir d'une liste que l'organisation aurait restreinte. Elle est facturée en plus des jetons : 10 $ US pour 1 000 recherches au tarif lu le 2026-11-17 et relu le 2026-11-20, huit recherches au plus par demande.

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
| `POST /v1/ontology/:env/prepared-responses` | Garde une option testée comme réponse préparée pour un type de signal |
| `GET /v1/ontology/:env/prepared-responses` | Les réponses préparées du projet, dans l'ordre où elles ont été gardées (`signalTypeId` pour un seul type de signal) |
| `DELETE /v1/ontology/:env/prepared-responses/:id` | Retire une réponse préparée : elle n'est plus proposée, sans être effacée |
| `POST /v1/ontology/:env/signals/:id/engage` | Engage une réponse préparée sur un signal : enregistre la décision, l'inscrit au journal du signal, et fait avancer le signal d'une étape |
| `POST /v1/ontology/:env/health-events` | Accepte un candidat : il entre au calendrier |
| `GET /v1/ontology/:env/health-events` | Le calendrier du projet, du plus ancien au plus récent (`from`, `to` pour une période) |
| `DELETE /v1/ontology/:env/health-events/:id` | Retire un événement du calendrier |
| `GET /v1/ontology/:env/situation` | La fiche de situation d'une unité, d'une alerte ou d'un signal (`unit`, `alert`, `signal`) : les chiffres en direct de l'unité avec leur âge, l'alerte, l'étape du signal et une question déjà écrite. N'appelle aucun modèle et n'écrit rien |
| `GET /v1/ontology/:env/web-sources` | Les domaines où la recherche a le droit de chercher |
| `PUT /v1/ontology/:env/web-sources` | Remplace cette liste |

Corps de la question : `question`, `scenarioId` (ou `null`), `looking` (`reality` ou `scenario`), `run` (le résumé du run à l'écran, ou `null`), et `focus` (ou `null`) : ce que la personne a sous les yeux quand elle pose sa question ailleurs que sur la carte des scénarios, soit `page`, `unitId`, `signalId`. Ce sont des identifiants : le serveur retrouve lui-même les noms, et un identifiant qu'il ne trouve pas dans le projet est laissé de côté.

Corps d'un objectif : `objective`, `scenarioId` (obligatoire : une option s'ajoute à un scénario), `horizon` et `activity` (ceux de la page, pour que le test réponde à ce que Run montrerait), `run`.

Corps d'une décision : `exchangeId` et `step`, rien d'autre. Les chiffres sont recopiés par le serveur depuis son journal.

Corps d'une réponse préparée : `exchangeId`, `step`, `signalTypeId`, et au besoin `label` (son étiquette) et `approver` (qui peut l'approuver, en mots). Aucun chiffre : le serveur les recopie de son journal, comme pour une décision. Corps d'un engagement : `responseId`, et `note` au besoin.

Corps d'une recherche d'événements : `request`, et `scenarioId` (ou `null`), qui ne sert qu'à dire au journal d'où la demande a été faite. Ni le run ni rien du jumeau n'en fait partie.

Corps d'une acceptation : `exchangeId`, `candidate` (`c1`, `c2`…), `startsOn` et `endsOn` (ou `null`). Le titre, le lien et le passage sont recopiés par le serveur depuis son journal.

Lignes du flux :

| `type` | Contenu |
|---|---|
| `status` | Ce qui est en train d'être fait |
| `step` | Un appel d'outil : son numéro (`s1`, `s2`…), son entrée, son résultat ou son refus, et le relevé que l'outil a gardé pour l'écran s'il en garde un |
| `done` | La réponse ou la proposition, les chiffres retirés, les étapes, le modèle, les jetons, et `exchangeId`, l'identifiant de l'échange dans le journal |
| `failed` | Le modèle ou le moteur n'a pas pu être joint, ou le compte Claude n'a plus de crédit ; remplace `done` |
| `ping` | Rien : garde la connexion ouverte |

Une demande refusée avant de commencer (pas de session, analyste éteint, service de simulation non configuré, corps invalide) est une erreur HTTP ordinaire, pas un flux.

## Les outils

Aucun n'écrit. Treize lisent. Deux autres n'existent que dans l'onglet Options : `list_responses`, qui lit ce qu'une option peut contenir comme réponse enregistrée, et `test_option`, qui fait tourner le moteur. Deux mondes : `reality`, le jumeau tel qu'il est ; `scenario`, le même jumeau lu à travers le scénario ouvert.

L'onglet Event finder est à part : il n'a aucun de ces outils. Il n'a que la recherche web de l'API (`web_search`), qui tourne chez Anthropic et non chez nous, et son outil de livraison. C'est ce qui garantit qu'une recherche ne peut rien emporter du jumeau.

| Outil | Ce qu'il lit |
|---|---|
| `describe_twin` | Vue d'ensemble : sites, activités et unités, territoires, modèle de soins et de propagation déclaré, ce qui manque au jumeau. À part de ce qui manque, les unités qui n'ont pas de capacité propre parce qu'elle est dans leurs sous-unités |
| `find_sites` | Les sites, filtrés par nom, activité ou territoire, les plus grands d'abord |
| `get_site` | Un site : lieu, unités par activité, patients présents, territoires servis, ce que le scénario y change |
| `compare_catchments` | Pour une activité : chaque territoire, ses résidents, ses sites, ses unités par 1 000 résidents |
| `scenario_recipe` | Le scénario : conditions de départ, événements, choix (mesures, capacité, réponse enregistrée que le run suit), liens modifiés, série de comparaison |
| `read_run` | Le run à l'écran : résumé des deux passes, sites où l'on attend, un site jour par jour, le réseau jour par jour |
| `list_datasets` | Les jeux de données du projet et leurs colonnes |
| `preview_dataset` | Les premières lignes d'un jeu et les valeurs de ses colonnes de catégorie |
| `read_series` | Une colonne lue comme série quotidienne : total, moyenne, extrêmes, valeurs |
| `list_events` | Le calendrier : les événements validés, leurs dates, leur lieu, leur porte, la source qui les a publiés et le passage cité. Quand le jour 0 du scénario a une date, chaque événement est aussi placé sur les jours du run |
| `list_alerts` | Ce qui est ouvert maintenant : les alertes, la pire d'abord, chacune avec son unité, sa mesure et sa valeur, depuis quand elle est ouverte, l'âge de la valeur, et le signal qu'elle a levé avec son étape. Dit aussi combien de règles d'alerte existent et quand les seuils ont été vérifiés. Pour tout le projet ou pour une unité |
| `unit_now` | Les chiffres en direct d'une unité, tels que sa page les montre : chaque mesure définie par l'organisation, ce qui est sous l'unité par type, l'âge de la lecture (ou qu'il est inconnu, et pourquoi), ses alertes ouvertes |
| `calculate` | Un calcul, sur des nombres déjà lus ou donnés dans la question |
| `list_responses` | Onglet Options seulement. Les réponses enregistrées qu'une option peut contenir : celles de la bibliothèque de l'organisation (page Events) et celles que le moteur écrit lui-même, chacune sous un nom, avec ce que font ses règles et si elles déclarent un coût. Avec `routes_from`, les sites vers lesquels les patients qui attendent à un site peuvent être transférés |
| `test_option` | Onglet Options seulement. Ajoute une option au scénario ouvert, le temps d'un run sur le serveur, et rend le scénario tel quel à côté du scénario avec l'option, avec ce que le moteur a compté comme coût quand une réponse enregistrée est dans l'un des deux runs |

Un outil qui ne peut pas répondre (nom inconnu, deux sites pour un nom, pas de run à l'écran, table qui contient plusieurs séries, option qu'on ne peut pas tester) le dit par un refus motivé que le modèle lit. Il ne devine jamais.

**Le direct.** `list_alerts` et `unit_now` ne lisent pas l'export du jumeau comme les autres : ils lisent ce que lisent les écrans, le fil d'alertes du bandeau et le calcul de la page des unités ([algorithms.md](algorithms.md), D9). C'est voulu. La page d'une unité additionne tout ce qui est sous elle, ses sous-unités comprises ; l'export, lui, ne compte que ce qui est rattaché à l'unité elle-même, parce que c'est ce qu'un run utilise. Pour un service sans sous-unité les deux donnent le même chiffre ; pour un hôpital qui a des services, non. Une personne qui regarde la page d'une unité et interroge l'analyste doit recevoir le chiffre de cette page : `unit_now` le donne, arrondi comme la page l'écrit, et `get_site` reste la lecture du moteur. La vue d'ensemble (`describe_twin`) suit la même séparation. Un établissement dont toute la capacité est dans ses installations n'en a aucune à lui dans un run : l'outil le range sous « how_the_tree_is_built », dit que rien ne manque, et renvoie à `unit_now` pour le chiffre de sa page. Seule une unité sous laquelle rien ne porte de capacité figure parmi les manques. Les trois comptes de sites (capacité propre, capacité dans les sous-unités, aucune capacité dessous) font le total. Trois règles vont avec le direct : une valeur ne se donne jamais sans son âge (exact, « au moins », ou inconnu avec sa raison) ; aucune alerte ouverte n'est pas une bonne nouvelle en soi (l'outil dit quand les seuils ont été vérifiés, et s'il n'existe aucune règle) ; et il n'y a pas d'historique.

Le résumé du run à l'écran est construit par la page (`run-digest.ts`) avec les fonctions que lit déjà le panneau Result : l'analyste et le panneau ne peuvent pas diverger sur un chiffre. Le résumé d'une option testée est construit par le serveur (`scenario-run.ts`), et un test tient les deux ensemble : [algorithms.md](algorithms.md), section A4.

## Les options

On dit un objectif : « plus personne n'attend à tel site », « le moins de jours-patients d'attente avec au plus 100 lits ajoutés ». L'analyste lit la situation, propose jusqu'à trois options et fait tourner chacune dans le moteur avant de la montrer.

Une option est une étiquette et un à quatre changements :

| Changement | Ce qu'il faut pour le tester |
|---|---|
| Capacité : des unités d'une activité, à un site, à partir d'un jour (négatif : des unités fermées) | Le site offre déjà cette activité ; on ne ferme pas plus qu'il n'a |
| Mesure : des couches de contact multipliées, dans certains territoires, pendant des jours | Le jumeau déclare ces couches |
| Transfert : des patients qui attendent à un site, envoyés à un autre, tant par jour, à partir d'un jour | Le jumeau contient une route de transfert entre les deux sites, le site d'arrivée offre l'activité, et on ne demande pas plus de vingt patients par jour |
| Réponse enregistrée : une réponse de la bibliothèque de l'organisation, ou une de celles que le moteur écrit lui-même | Elle est désignée par le nom que lui donne `list_responses`. Une réponse du moteur vaut pour tout le run |
| Remplacer un choix du scénario : la même capacité ou la même mesure, avec d'autres unités, un autre jour, une autre durée | Le choix est désigné par le nom que lui donne `scenario_recipe` ; c'est une capacité remplacée par une capacité, ou une mesure par une mesure |
| Retirer un choix du scénario | Le choix est désigné par son nom |

« 40 lits au lieu des 60 du scénario » est donc un seul tampon à +40 : le test tourne sans les 60 et avec les 40, et c'est ce que la recette contient une fois l'option appliquée. Seuls les choix (mesures, capacité, réponse enregistrée) se remplacent ou se retirent. Les conditions de départ et les événements sont ce qui arrive : une option ne les défait pas.

Un transfert et une réponse enregistrée sont d'une autre nature que les deux premiers : ce ne sont pas des choses posées un jour donné, mais des règles que le moteur évalue à chaque pas du run. Un transfert de quatre patients par jour de Lakeshore vers Nord n'envoie personne tant que personne n'attend à Lakeshore, ni quand Nord est plein. Un run suit une réponse à la fois : une option contient donc soit une réponse enregistrée, soit des transferts, qui en font une à eux tous ; et si le scénario en suit déjà une, l'option doit la retirer pour en tester une autre à sa place.

### Deux façons de demander « et si », un seul run

Le produit avait deux chemins qui ne se connaissaient pas. Depuis qu'une réponse enregistrée peut être un tampon du scénario, le second sait lancer ce que le premier écrit, par le même run que ses autres tampons, sur la page comme sur le serveur.

| | Page Events et rejeu de la page des unités | Page Scenarios et analyste |
|---|---|---|
| Ce qu'on fait varier | Une réponse : des règles que le moteur évalue à chaque pas, sur un événement donné | Des tampons : ce qui arrive un jour donné (éclosion, canicule, mesure, capacité, conditions de départ), et une réponse enregistrée |
| Ce que ce chemin sait faire et que l'autre ne sait pas | Écrire et modifier une réponse : ses conditions, son délai, son efficacité, son coût. Comparer plusieurs réponses sur un même événement et les classer sur des comptes (morts, soins non rendus, coût), sur plusieurs graines. Faire varier la force d'une réponse (la moitié, le double). Bifurquer : « et si on avait agi ce jour-là » | Propager une épidémie d'après le modèle que le jumeau déclare. Poser des conditions de départ. Remplacer ou retirer un choix. Faire proposer et tester des options par l'analyste, avec leurs niveaux de preuve. Enregistrer une décision et la suivre. Garder une réponse préparée, retestée quand un signal s'ouvre |
| Ce qu'il ne sait toujours pas | Partir d'un scénario fait de tampons. Enregistrer une décision. Garder une réponse préparée ([issue 22](https://github.com/V1ktor7/obscyro/issues/22)) | Suivre plus d'une réponse dans un run. Écrire ou modifier les règles d'une réponse, hors le transfert entre deux sites. Faire commencer un jour donné une réponse que le moteur écrit lui-même. Donner un prix à une capacité ou à une mesure ([issue 20](https://github.com/V1ktor7/obscyro/issues/20)). Lancer plusieurs graines |

Ce qui est commun aux deux : le moteur, la forme d'une réponse (des règles, avec délai, efficacité et coût), et le marquage d'une option dominée, fait par la même fonction.

Ce qui vient du modèle et ce qui n'en vient pas :

| À l'écran | D'où ça vient |
|---|---|
| Les chiffres des cartes : pic, sites avec une file, jours-patients d'attente, premier jour de file, pour le scénario tel quel et chaque option. La barre et les cases les dessinent, elles n'ajoutent rien | Les runs du moteur, lus dans le relevé de chaque test. Jamais d'une phrase |
| L'écart d'une option avec le scénario tel quel (« −7,049 vs as it is ») | Le programme : la soustraction des deux chiffres affichés, arrondis, pour qu'on puisse la refaire de tête |
| Le décompte « 2 measured · 1 published · 3 assumption » d'une carte | Le programme : il compte les éléments de la liste par niveau. Les trois niveaux ne sont jamais additionnés |
| Le niveau de preuve de chaque élément : Measured, Published, Assumption | Le programme, d'après d'où vient l'élément (jumeau, scénario, option, règle du moteur) |
| Les tampons qu'ajoute « Add to scenario » | Le test : ce sont ceux que le moteur a reçus. Une réponse enregistrée en est un, avec ses règles |
| « Cost counted : 7,500 $ » sur une carte, ou la phrase qui dit pourquoi rien n'est compté | Le moteur : le coût que chaque règle de la réponse déclare, chaque fois qu'elle s'est déclenchée dans ce run. Une capacité et une mesure n'ont pas de prix : la carte dit alors que le compte n'est pas le coût entier, ou qu'il n'y en a pas |
| « Dominated », avec le nom d'une autre option | Le programme, d'après les deux runs : l'autre coûte autant ou moins et laisse autant ou moins d'attente. Seulement entre options dont le coût est entier |
| « What it does to the scenario » : ce que l'option ajoute, remplace et retire, quand elle ne fait pas qu'ajouter | Le programme, à partir des tampons. Le bouton dit alors « Apply to scenario » |
| Le mécanisme en une phrase, ce que le test ne dit pas, la lecture, les arbitrages, les limites | Le modèle, chaque chiffre contrôlé par le vérificateur |

Ce que l'onglet ne fait pas, par construction : classer les options (elles restent dans l'ordre des tests, et aucune carte n'est marquée comme la meilleure), en lister une qui n'a pas été testée, en cacher une qui l'a été, écrire dans le scénario. Les arbitrages de valeur sont présentés à part, sous « Yours to weigh ». Une seule chose est dite d'une option par rapport à une autre : qu'elle est dominée, quand l'autre coûte autant ou moins et laisse autant ou moins d'attente. Cela reste vrai quelle que soit la valeur qu'on donne à un jour-patient d'attente, donc ce n'est pas un arbitrage ; entre deux options dont aucune ne domine l'autre, l'onglet ne dit rien.

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

### Ce que coûte une recherche

Une recherche d'événements coûte environ 70 cents, aux prix de l'API lus le 2026-11-20. Ce qui coûte, c'est de lire les pages une première fois : chaque recherche lancée renvoie dix pages, près de 15 000 jetons, soit à peu près 8 cents, et le modèle en lance en général cinq ou six par demande, huit au plus.

Ce que le produit fait pour ne pas payer deux fois les mêmes pages :

- **Les recherches partent ensemble.** Les consignes demandent de les prévoir et de les lancer dans la même étape, parce qu'une recherche lancée seule fait relire tout ce que les précédentes ont renvoyé. C'est une consigne, pas une garantie : si le modèle cherche en plusieurs temps, la relecture revient.
- **La livraison se fait sans les pages.** Dès que des passages sont relevés, les candidats sont livrés dans une conversation neuve, qui ne contient que la demande, les recherches faites et les passages. L'outil de recherche n'y est plus offert : le plafond de huit recherches tient pour tout l'échange.
- **Le journal garde les jetons de chaque requête, par prix** (`usage.byRequest`) : lus au plein tarif, écrits au cache, relus du cache, écrits par le modèle, et les recherches.

Ce qui n'est pas fait, et pourquoi :

- **Le filtrage des résultats par l'API** (la recherche lancée depuis son bac à code, qui ne garde que les extraits utiles). La documentation de l'API le dit : les recherches lancées ainsi ne comptent pas dans le plafond d'un échange à plusieurs requêtes, et ce mode n'est pas admissible aux engagements de non-conservation des données. Le plafond de huit recherches doit tenir, donc la recherche reste appelée directement.
- **Couper le cache pour cet échange.** Écrire les pages au cache coûte un quart de plus que de les lire simplement. Mais si le modèle lance une recherche après les autres, tout ce qui précède est relu, et sans cache cette relecture coûterait vingt fois plus. Le cache reste, comme une assurance.
- **Baisser le plafond de huit recherches.** Le plafond est une limite, pas une cible.

## Les décisions

« Record decision » garde l'option retenue avec ce qu'on en attend. Le navigateur n'envoie que l'identifiant de l'échange et l'étape du test ; le serveur recopie tout le reste depuis son journal : l'objectif, les tampons, les chiffres du run testé avec et sans l'option, les arrivées jour par jour, les niveaux de preuve, les étapes sources. On ne peut donc enregistrer qu'une option que le moteur a testée.

Une décision peut porter sur une réponse enregistrée ou sur un transfert : elle en garde les règles, telles que le moteur les a reçues, et ce que le run a compté comme coût. L'onglet Decisions l'écrit sous les chiffres attendus.

Une décision ne se modifie pas : la revoir, c'est en enregistrer une autre.

Le suivi (« Compare with observed ») existe quand une série observée est liée au scénario, par le réglage « Reality check » du panneau Result. Il pose les arrivées que le run testé attendait à côté de celles qui ont été comptées, et donne l'écart : totaux sur les jours que les deux rapportent, écart moyen par jour, décalage des pics. Il ne conclut pas. Et il ne compare que des arrivées : le jumeau ne garde aucun historique des files ni de l'occupation, donc la file attendue n'a rien d'observé en face, ce que l'écran dit.

### Réponses préparées, et « Engage »

Dans l'urgence on ne bâtit pas un scénario : on applique ce qui a été préparé. Le travail se fait donc en deux temps.

**En temps calme.** Sous chaque option testée, « Keep as a prepared response for… » la garde pour un type de signal. On choisit le type, et au besoin qui peut l'approuver, en mots (un rôle). Rien d'autre ne part : le serveur recopie les chiffres du test depuis son journal, avec sa date et une empreinte des choix du scénario sur lequel il a tourné. Une réponse préparée est donc toujours une option que le moteur a réellement testée. Le bouton refuse quand le scénario a changé depuis les tests : les chiffres seraient ceux d'un autre scénario.

**En direct.** La fiche de situation d'un signal montre les réponses préparées pour son type, dans l'ordre où elles ont été gardées, sans classement. Chacune dit : ce qu'elle change ; le run avec elle à côté du même run sans elle ; sur quoi ce run repose, compté par niveau de preuve ; ce que son test ne dit pas ; et ce que ce test vaut aujourd'hui. Trois choses se savent sans rien relancer, et chacune s'écrit au-dessus du bouton, avant le clic : le scénario du test n'existe plus, ses choix ont changé depuis, ou le test a plus de trente jours. Aucune ne dit que la réponse est mauvaise ; elles disent de quoi les chiffres sont les chiffres.

**Le retest.** Dès qu'un signal s'ouvre, le serveur repasse dans le moteur chaque réponse préparée pour son type, sur le réseau tel qu'il est : le jumeau lu à l'instant, et le scénario avec ses choix d'aujourd'hui. Personne ne le demande, et aucun modèle de langage n'intervient. La fiche montre d'abord le dernier test connu, avec sa date, et dit qu'un test attend son tour ou tourne. Quand il finit, ses deux runs prennent la place de ceux du test gardé, et la ligne au-dessus dit quand il a tourné (« Tested on the current state 40 s ago ») ; ce que donnait le test gardé reste écrit dessous, en une ligne. Pendant ce temps la fiche se relit toutes les cinq secondes au lieu de trente : le résultat arrive sans clic.

Un retest prend environ une minute sur le jumeau de Montréal. Le coût est borné. Un run à la fois par projet. Pas de nouveau run tant que l'état n'a pas changé : la fiche dit alors que l'état a été retrouvé identique, et quand. Et un délai de trois minutes, après lequel le test est abandonné. Un test en file, en cours, abandonné ou raté n'est jamais montré comme un résultat : la fiche dit ce qu'il est devenu et pourquoi, et garde les chiffres du dernier test connu. Un moteur injoignable ne bloque ni la fiche ni « Engage ». Après quinze minutes, un retest n'est plus dit « de l'état du moment » : la fiche écrit de quand il date, et le signale avant le clic. Le retest part à l'ouverture d'un signal, pas tant que la fiche reste ouverte. Le détail : [algorithms.md](algorithms.md), A11.

« Engage » fait trois écritures d'un clic : une décision, rattachée au signal, avec les chiffres du test gardé comme ce qu'on en attend et, quand la fiche montrait un retest, ses chiffres à côté avec leur date ; une ligne au journal du signal, qui nomme la réponse et la personne ; et le passage du signal à l'étape suivante. Si cette étape exige une approbation, c'est la personne qui engage qui est inscrite comme l'ayant donnée. Tout refus arrive avant la première écriture : signal fermé, signal à sa dernière étape, réponse préparée pour un autre type de signal. Rien n'est déclenché dans un autre système : Obscyro enregistre et suit, et l'écran le dit.

La décision se relit à trois endroits : sur la fiche, parmi les décisions déjà prises sur ce type de signal ; dans le journal du signal, page Response ; et dans l'onglet Decisions, où elle porte le nom du signal.

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

Les jetons sont gardés requête par requête (`usage.byRequest`) et par prix : ce qui a été lu au plein tarif (`input`), ce qui a été écrit au cache (`cacheWrite`), ce qui a été relu du cache (`cacheRead`), ce qui a été écrit par le modèle (`output`), et les recherches web lancées dans la requête. Un échange coûte peu ou cher selon la part de chaque requête qui est relue du cache : c'est ce que ce détail permet de vérifier après coup, au lieu de le supposer. Le total affiché à l'écran reste la somme de tous les jetons, quel que soit leur prix.

L'identifiant de la ligne est choisi avant l'échange et part avec la ligne `done` du flux. C'est ce qui permet d'enregistrer une décision à partir d'un test : si l'écriture au journal a échoué, la décision est refusée et il faut tester à nouveau.

Les décisions sont dans `app.decision` (migration 061). Les événements acceptés sont dans `app.health_event`, et les sources autorisées d'un projet dans `app.project_web_source` (migration 062).

## L'écran

`AnalystPanel.tsx`, dans un `OverlayPanel` sous « Layers », replié à l'arrivée. Quatre onglets, dans l'ordre de la boucle ; chacun n'est construit qu'à sa première ouverture, puis garde ce qu'on y a fait.

**Event finder** (`EventFinderTab.tsx`), de haut en bas : la demande, et des demandes suggérées sur les dates du scénario, où il reste à écrire le lieu ; les sources cherchées et de quoi les changer ; les recherches, qui s'affichent pendant qu'elles tournent ; un bandeau qui dit si tout a été trouvé dans les passages ; une carte par candidat (porte, niveau « Published », puce WEB, titre, lieu, citation et lien, les passages sur lesquels il repose, qui ouvrent l'étape où le passage se lit en entier, dates à corriger, Accept, Reject) ; ce qui n'a pas été trouvé ; les limites ; les étapes. Un candidat refusé se replie en une ligne, avec de quoi revenir dessus : le refus n'a rien écrit nulle part.

**Context** (`ContextLane.tsx`) n'est pas dans le panneau mais dans la frise : le couloir des événements validés, au-dessus des couloirs de tampons. Un clic sur un événement l'ouvre : source, citation, qui l'a accepté, et de quoi le retirer.

**Options** (`OptionsTab.tsx`), de haut en bas : sur quoi les options sont testées ; l'objectif, et des objectifs suggérés d'après le run à l'écran ; les tests, qui s'affichent pendant qu'ils tournent, avec la durée de ce qui est en cours ; la carte du scénario tel quel, en pointillé ; une carte par option ; la lecture ; les arbitrages laissés à la personne ; les limites ; ce sur quoi toutes les options reposent ; les étapes. Un bandeau dit quand le scénario n'est plus celui qui a été testé, et pourquoi : une option ajoutée depuis l'onglet, plusieurs ajoutées ensemble, ou une modification faite ailleurs.

Une carte d'option se lit d'un coup d'œil et s'explique d'un clic (`option-cards.tsx`). En haut : sa lettre, son libellé, et ce à quoi le run aboutit en trois mots (« Nobody waits », ou « 4 sites with a queue »). Puis ses chiffres, dessinés :

- les jours-patients d'attente, avec l'écart au scénario tel quel, et une barre. Toutes les barres de l'onglet sont à la même échelle, celle de la plus longue attente, et un trait y marque le scénario tel quel : on compare deux options sans lire un chiffre ;
- les sites avec une file, « 3 of 34 », et une case par site, rouge quand il a une file. Au-delà de 60 sites, les cases deviennent une part de barre ;
- le pic d'occupation et son jour, le premier jour où quelqu'un attend, et l'attente là où aucun site ne sert quand le scénario en a.

Sous les chiffres, trois lignes repliées, qui s'ouvrent d'un clic : « Why this option » (le mécanisme, ce que l'option remplace ou retire, et l'étape qui l'a testée), « What it rests on » (chaque élément avec son niveau de preuve ; le décompte par niveau se lit sans ouvrir), « What this test does not say ». Une ligne dont le texte a perdu un chiffre s'ouvre toute seule : un retrait ne se cache pas derrière un clic. En bas, « Add to scenario » (ou « Apply to scenario ») et « Record decision ».

**Decisions** (`DecisionsTab.tsx`) : les décisions du scénario ouvert d'abord, puis celles des autres scénarios du projet. Chacune est une carte du même dessin : qui l'a prise, quand, l'objectif, les chiffres attendus avec l'option (l'écart est donné contre le même run sans elle), puis, repliés, l'attendu sans l'option, le mécanisme, sur quoi elle reposait, ce que le test ne disait pas. Le suivi se demande d'un bouton. L'onglet se lit même quand l'analyste est éteint : une décision est un enregistrement, pas une réponse.

**Ask**, de haut en bas :

- ce qu'il va lire (le scénario ou la réalité, et le run s'il y en a un) ;
- la question, et des questions suggérées selon ce qui est à l'écran ;
- les étapes, qui arrivent pendant la lecture ;
- la réponse : un bandeau vert quand tous les chiffres sont tracés, orange avec leur nombre quand certains ont été retirés ; sous chaque paragraphe, les puces des étapes citées, qui ouvrent l'étape, et, quand le paragraphe s'appuie sur des événements du calendrier, une puce WEB par événement avec son lien et le niveau « Published » ;
- ce qui est supposé, ce que la réponse ne peut pas dire ;
- les sites dont parle la réponse, qui pointent la carte dessus ;
- les questions à poser ensuite.

**Ailleurs que sur la carte des scénarios** (`AnalystDock.tsx`). Le cadre du Studio porte un bouton « Analyst », en bas à droite de chaque page. Il ouvre l'onglet Ask seul, sur le réseau tel qu'il est maintenant. La question part avec ce que la personne a sous les yeux : la page, et l'unité sélectionnée sur Units ou le signal ouvert sur Response. Les questions suggérées suivent : « What is open right now, and where? », plus une sur l'unité ou le signal quand il y en a un. Le panneau garde ce qui a été demandé quand on le ferme et le rouvre. Deux pages n'ont pas ce bouton, parce qu'elles tiennent déjà l'analyste là où se fait le travail : Scenarios, dont le panneau a aussi le scénario, le run et les options, et la fiche de situation.

**La fiche de situation** (`situation/SituationView.tsx`, à l'adresse `/studio/situation`). Elle s'ouvre par « Situation » : sur une alerte, dans la liste en haut à droite et dans le bandeau ; sur un signal, dans Response ; sur une unité, dans sa fiche de la page Units. De haut en bas :

- l'unité, et où elle se trouve dans l'arbre ;
- l'heure de la lecture, quand les seuils ont été vérifiés, et combien de règles d'alerte le projet a (sans aucune règle, la fiche dit que rien ne peut s'ouvrir) ;
- l'alerte d'où la fiche a été ouverte, avec sa valeur, depuis quand elle est ouverte et l'âge de la valeur ; ou la mention qu'elle n'est plus ouverte ;
- les chiffres en direct de l'unité, tels que sa page les montre, avec l'âge de la lecture et sa raison quand il n'est pas exact, puis ce qui est sous l'unité par type ;
- les autres alertes ouvertes de l'unité ;
- le signal, et le chemin de son workflow avec l'étape où il se trouve ;
- les réponses préparées pour le type du signal, avec les chiffres de leur dernier test et ce qu'il vaut aujourd'hui, le retest de chacune sur l'état du moment, et le bouton « Engage » (voir « Réponses préparées ») ;
- les décisions déjà prises sur des signaux de ce type, avec ce qu'on en attendait ;
- l'analyste, avec une question déjà écrite d'après l'unité et l'alerte. Elle n'est pas envoyée : la poser est un clic de la personne ;
- ce que la fiche ne peut pas dire.

La fiche se relit toutes les trente secondes, et toutes les cinq secondes tant qu'une réponse préparée est en cours de retest. Si une lecture échoue, la dernière reste à l'écran, dite comme n'étant plus à jour. Tout ce qui est au-dessus de l'analyste se lit sans lui : quand il est éteint, la fiche est entière et le dit.

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

L'analyste est un modèle de langage : « ça a marché quand j'ai essayé » n'est pas un test. La même question peut être bien répondue un jour et mal le lendemain, après un changement de ses consignes ou de la description d'un outil. Vingt questions de référence, sur le jumeau de Montréal et le scénario Omicron calé sur l'INSPQ, disent ce qu'une bonne réponse doit contenir.

```bash
# backend/ — à la main, jamais dans la suite de tests : appelle la vraie API
npm run eval:analyst
npm run eval:analyst -- --times 2 --show
npm run eval:analyst -- --only three-sites,two-catchments,in-french,run-waiting-by-site
```

**La clé.** Le script agit comme une personne : il lui faut une clé d'API Obscyro d'un utilisateur qui peut lire l'environnement. Celle du navigateur se lit et se copie dans le Studio, sous Admin → API keys ; on peut aussi en créer une là, ou sur la page des clés du compte (`/app/keys`). Sur cette dernière, une clé créée devient aussitôt celle du navigateur : la révoquer ensuite déconnecte le Studio. Le script lit la clé dans `OBSCYRO_API_KEY` si la variable existe ; sinon il la demande au terminal, tapée ou collée sans s'afficher. C'est la façon à préférer : la clé n'est alors écrite nulle part, ni dans un fichier, ni dans l'historique du terminal. Elle n'a sa place ni dans le dépôt, ni dans `backend/.env`, ni dans un journal, et le script ne l'imprime jamais.

Quand le terminal ne laisse pas coller à l'invite, la clé peut passer du presse-papiers à la variable sans s'afficher ni entrer dans l'historique. Dans Git Bash sous Windows, après avoir copié la clé :

```bash
OBSCYRO_API_KEY="$(powershell.exe -NoProfile -Command Get-Clipboard | tr -d '\r\n')" npm run eval:analyst
```

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
| Chaque nom garde son chiffre | Un nom et son chiffre sont dans la même proposition (`pairs`) : c'est ce qui attrape deux chiffres justes écrits chacun à côté du mauvais site. Un deux-points ne coupe pas la proposition : « Dorval has slightly more: 1.15 per 1,000 » dit bien 1,15 de Dorval (`statementsOf`) |

Ce qui n'est pas jugé : la qualité de la rédaction. Il faut encore une personne, qui lit les réponses avec `--show`.

- Chaque question est rejouée deux fois par défaut : un jeu qui passe une fois n'a pas montré qu'il passe.
- Quatre questions couvrent ce qui s'est montré fragile avec le vrai modèle : trois sites cités avec un chiffre chacun (`three-sites`), les sites d'un run avec leur attente (`run-waiting-by-site`), deux territoires comparés (`two-catchments`), une question posée en français (`in-french`).
- Trois questions portent sur le direct, là où un modèle est le plus tenté de rassurer. `open-now` : rien n'est ouvert, mais le projet de référence n'a aucune règle d'alerte, et une bonne réponse le dit au lieu de conclure que tout va bien. `unit-now` : le chiffre de la page de l'unité, avec un âge inconnu dit comme inconnu. `no-history` : « qu'est-ce qui a changé depuis ce matin » n'a pas de réponse, et une bonne réponse le dit sans déduire un changement d'une seule lecture.
- Le script sort en erreur dès qu'une question échoue : il peut servir de garde avant de changer les consignes ou un outil.
- Les faits attendus sont dans le code (`QUESTIONS`). Quand le jumeau ou le scénario change, c'est la question qu'on corrige.

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
- Une recherche d'événements coûte environ 70 cents : chaque recherche lancée renvoie dix pages, près de 15 000 jetons, et aucun réglage de l'API ne permet d'en demander moins sans renoncer au plafond de recherches. Voir « Ce que coûte une recherche ».
- Le jumeau ne contient ni personnel, ni stocks, ni historique : l'analyste le dit, il ne le comble pas. Il ne peut donc pas dire ce qui était ouvert plus tôt, ni ce qui a changé depuis ce matin.
- L'âge d'un chiffre en direct est celui de la lecture de l'unité entière, le plus vieux de ses sources quand elle en a plusieurs.
- Les signaux ouverts que `list_alerts` compte comprennent ceux dont l'alerte est retombée : ils peuvent être bien plus nombreux que les alertes ouvertes.
- Le run à l'écran n'est pas gardé au rechargement de la page ; il faut relancer Run. Les options testées non plus : ce qui reste, ce sont les décisions enregistrées et le journal.
- Une option est faite de capacité, de mesures, de transferts de patients ou d'une réponse enregistrée. Du personnel, un stock, un lien nouveau entre un site et un territoire ne se testent pas : le moteur ou le jumeau ne les portent pas. L'analyste les range dans les limites.
- Un run suit une seule réponse enregistrée. Deux réponses ne se testent pas ensemble, et une réponse que le moteur écrit lui-même ne peut pas commencer un jour donné.
- Un transfert ne se teste qu'entre deux sites que le jumeau relie par une route de transfert. Le jumeau ne contient le débit d'aucune route : le run donne à chacune vingt patients par jour, et c'est une hypothèse.
- Les deux réponses que le moteur écrit lui-même surveillent une seule activité, la première du jumeau par ordre alphabétique parmi celles qui sont de l'espace, quelle que soit l'activité que le run lit. `list_responses` dit laquelle.
- Un coût n'existe que là où une règle en déclare un. Une capacité, une mesure et un transfert écrit par l'analyste n'ont pas de prix : aucune option qui en contient ne peut être dite dominée ou dominante.
- Avec une réponse qui ajoute ou déplace des unités pendant le run, l'occupation de l'île est pondérée par la capacité habituelle : le moteur ne rend pas la capacité de chaque jour. Le run le dit.
- Une option est testée sur le scénario tel qu'il est au moment du test. Ajouter une option puis une autre donne un scénario qu'aucun test n'a couvert : l'écran prévient, et il faut redire l'objectif.
- Une option peut remplacer ou retirer un choix du scénario, mais pas une condition de départ ni un événement. Remplacer une capacité par une mesure se fait en deux changements de la même option : retirer l'une, ajouter l'autre.
- Appliquer une option qui retire un choix se fait en deux écritures, le nouveau tampon puis le retrait de l'ancien, et non en une seule opération. Si la seconde échoue, la recette garde les deux tampons : l'écran le montre, et le retrait se fait à la main. Si le tampon à retirer n'est plus là au moment du clic, rien n'est écrit.
- Le nom d'un choix (`choice-a`) vaut pour un échange. Une question suivante relit la recette et peut lui donner un autre nom.
- Un objectif prend un peu moins de trois minutes sur le jumeau de Montréal. Une passe du moteur y prend une trentaine de secondes ; le premier test en lance deux (le scénario tel quel, puis l'option) après avoir lu le jumeau et calculé la propagation, les suivants une seule. C'est le moteur qui fixe la durée : pour aller plus vite il faut accélérer le moteur, pas l'analyste.
- Le suivi d'une décision ne compare que des arrivées (voir « Les décisions »).
- Une réponse préparée se garde depuis une option testée dans l'onglet Options. Une réponse écrite sur la page Events ne peut pas encore l'être : elle n'a pas de test journalisé dont recopier les chiffres.
- Ce qu'on sait d'un test gardé se limite à sa date et au scénario sur lequel il a tourné. L'empreinte du scénario est prise au moment où la réponse est gardée ; que le jumeau lui-même ait changé depuis (des lits en plus ou en moins) ne se voit pas. Retester une réponse sur l'état du moment n'existe pas encore.
- Engager fait trois écritures à la suite, pas une seule opération : si la dernière échoue, la décision et sa ligne au journal existent, et le signal n'a pas avancé.
- Une décision enregistrée ne se supprime pas à l'écran.

## Fichiers

| Rôle | Fichier |
|---|---|
| Boucle, clôture d'une question, `give_answer` | `backend/src/services/analyst.ts` |
| Lecture du direct, `list_alerts`, `unit_now` | `backend/src/services/live-reading.ts` |
| Fiche de situation | `backend/src/services/situation.ts`, `backend/src/routes/situation.ts`, `frontend/app/studio/situation/SituationView.tsx`, `situation-api.ts` |
| L'analyste dans le cadre du Studio | `frontend/app/studio/AnalystDock.tsx` |
| Réponses préparées, retest, « Engage » | `backend/src/services/prepared-responses.ts`, `backend/src/services/response-retest.ts`, `backend/src/routes/prepared-responses.ts`, `frontend/app/studio/simulation/hex/KeepPrepared.tsx`, `frontend/app/studio/situation/PreparedResponses.tsx`, `prepared-api.ts` |
| Outils de lecture, résumé du run | `backend/src/services/analyst-tools.ts` |
| Outil `test_option`, clôture d'un objectif, `give_options` | `backend/src/services/analyst-options.ts` |
| Outil `list_responses`, réponses enregistrées, règle d'un transfert | `backend/src/services/analyst-responses.ts` |
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
| Carte d'une option ou d'une décision : chiffres dessinés, écart, niveaux de preuve, lignes repliées | `frontend/app/studio/simulation/hex/option-cards.tsx`, tests `option-cards.test.tsx` |
| Résumé du run | `frontend/app/studio/simulation/hex/run-digest.ts` |
