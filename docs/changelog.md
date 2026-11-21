# Journal des changements

Ce qui a changé dans Obscyro, du plus récent au plus ancien. Chaque entrée dit ce qu'elle est :

- **Nouvelle fonction** : quelque chose que le produit ne faisait pas.
- **Modification** : quelque chose qu'il faisait déjà, et qu'il fait autrement, mieux ou plus vite. Une correction en est une.

Une entrée est écrite le jour où le changement est livré, dans le même commit que le code. Depuis novembre 2026, chaque changement visible a la sienne. Les mois d'avant sont résumés. Le détail complet, commit par commit, est dans [l'historique du dépôt](https://github.com/V1ktor7/obscyro/commits/main).

## 21 novembre 2026

- **Modification · Studio.** Sur la page Network, un clic sur une ligne de l'explorateur ouvre le site où l'unité se trouve, et la carte s'y déplace. Avant, la ligne s'allumait et rien d'autre ne se passait. Une ligne qui n'a pas de site à elle, un établissement par exemple, cadre la carte sur les sites de ce qu'elle contient, et l'explorateur écrit pourquoi aucun panneau ne s'est ouvert. Dans l'autre sens, un site choisi sur la carte allume son unité dans l'explorateur, qui ouvre la branche et défile jusqu'à elle.
- **Modification · Analyste.** Dans l'onglet Options, les cartes suivent l'ordre où les options ont été testées, même quand le modèle les liste dans un autre ordre.
- **Modification · Analyste.** Le modèle Claude de l'analyste se règle par une variable du service de l'API (`ANALYST_MODEL`) : Opus 5.5 comme avant quand elle est vide, ou Sonnet 5.5 ou Haiku 5.5, qui coûtent moins par question. Une valeur inconnue éteint l'analyste, et le panneau dit pourquoi.
- **Modification · Studio.** Le jumeau arrive de nouveau en continu sur la page Units, dans la vue d'un site de la page Network, et dans « Live metrics ». Le navigateur refusait ce flux : la page affichait « Live stream » pendant une demi-minute sans rien recevoir, puis relisait le jumeau toutes les cinq secondes. La pastille écrit maintenant « Connecting » tant que le flux n'a rien livré, et « Live stream » seulement après.
- **Nouvelle fonction · Analyste.** Une option peut contenir un transfert de patients entre deux sites, ou une réponse enregistrée : celles de la page Events et celles que le moteur écrit lui-même. Elle est testée par le même run que la capacité et les mesures. « Add to scenario » l'écrit dans la recette comme un tampon, et Run redonne alors les chiffres du test.
- **Nouvelle fonction · Analyste.** Dans l'onglet Options, ce que le moteur a compté comme coût est écrit sur chaque carte, et une option qui coûte autant ou plus qu'une autre pour autant ou plus d'attente est marquée « Dominated ». Rien d'autre n'est classé. Une capacité et une mesure n'ont pas de prix : la carte le dit à la place d'un chiffre.
- **Modification · Studio.** La page Units est refaite. Les unités ne sont plus une colonne de cartes sans ordre : c'est une liste classée sur la mesure choisie, les unités en alerte d'abord. Les compteurs du haut (« In alert », « Reporting, no alert », « No value ») sont aussi les filtres. Les unités qui ne rapportent rien pour la mesure sont repliées, et ne sont jamais lues comme un zéro. On cherche une unité par son nom, sans les accents, et on trie du plus haut au plus bas, l'inverse, ou par nom. Un nom se lit en entier. La fiche de l'unité reste à côté de la liste au lieu de s'ouvrir dans une fenêtre : on compare en cliquant d'une ligne à l'autre. Détail : [la page Units](units-page.md).
- **Nouvelle fonction · Studio.** Une vue « Tiles » sur la page Units : une case par unité qui a une valeur, colorée selon la distance au seuil d'alerte, pour voir tout le réseau d'un coup d'œil.
- **Nouvelle fonction · Studio.** Sur la page Units, un jumeau qui a une hiérarchie se déplie : un clic sur une unité montre ce qu'elle contient, et une unité repliée dit combien d'unités sous elle sont en alerte.
- **Modification · Studio.** Sur la page Units, « Measures » et « Alert thresholds » sont des boutons avec leur nom, à la place de deux icônes. « Seed demo » n'est plus proposé que sur un projet sans unité. « Ask the analyst », dans la fiche d'une unité, ouvre l'analyste avec cette unité.
- **Modification · Alertes.** Le tableau Response montre d'abord ce qui demande quelqu'un. Les signaux levés par une alerte retombée seule, et que personne n'a touchés, sont mis à part dans un onglet « Alert cleared », toujours compté à côté de l'onglet « Active ». Un signal que quelqu'un a pris en main reste sur le tableau, avec la mention « alert cleared » quand son alerte est retombée.
- **Nouvelle fonction · Alertes.** Les signaux mis à part se ferment en une fois, par domaine, avec un motif obligatoire. Le journal de chaque signal garde qui les a fermés et pourquoi, et ils sont enregistrés comme retombés seuls : ni résolus, ni faux positifs.
- **Modification · Alertes.** Un accusé de réception tient tant que la condition tient. Avant, une alerte accusée était rouverte cinq secondes plus tard, avec un nouveau signal et un nouveau bandeau. Si la règle se déclenche à une gravité plus haute, c'est une nouvelle alerte.
- **Modification · Alertes.** Les compteurs par domaine du tableau Response sont justes au-delà de 500 signaux : ils sont comptés sur tous les signaux ouverts, et non plus sur la liste affichée.

## 20 novembre 2026

- **Nouvelle fonction · Studio.** Les réponses préparées sont retestées sur l'état du moment. Dès qu'un signal s'ouvre, le moteur repasse chaque réponse préparée pour son type sur le réseau tel qu'il est, sans que personne le demande et sans modèle de langage. La fiche de situation montre d'abord le dernier test connu avec sa date, puis le nouveau résultat à sa place, avec l'heure du test (« Tested on the current state 40 s ago »). Un test en cours ou abandonné n'est jamais montré comme un résultat, et un moteur injoignable ne bloque ni la fiche ni « Engage ».
- **Modification · Analyste.** Dans sa vue d'ensemble du jumeau, l'analyste ne dit plus d'un établissement qu'il « ne porte aucune capacité » quand cette capacité est dans ses installations. Il sépare deux cas : une unité dont la capacité est dans ses sous-unités, ce qui est la forme de l'arbre et pas un manque, et une unité sous laquelle rien n'en porte, ce qui en est un. Pour la première, il renvoie au chiffre que montre la page de l'unité.
- **Nouvelle fonction · Studio.** Des réponses préparées. Une option testée dans Scenarios se garde pour un type de signal (« Keep as a prepared response for… »). La fiche de situation d'un signal de ce type la montre avec les chiffres de son test, sa date, et un avertissement si le scénario a changé depuis. Un clic sur « Engage » enregistre la décision sur le signal et le fait avancer d'une étape. Rien n'est déclenché dans un autre système.
- **Nouvelle fonction · Studio.** Une fiche de situation s'ouvre d'un clic depuis une alerte, un signal ou une unité : les chiffres en direct de l'unité avec leur âge, l'alerte, l'étape du signal, et une question déjà écrite pour l'analyste. Elle se lit en entier même quand l'analyste est éteint.
- **Nouvelle fonction · Analyste.** L'analyste est accessible depuis toutes les pages du Studio, par le bouton « Analyst » en bas à droite. La question part avec ce qu'on regarde : la page, et l'unité ou le signal sélectionné.
- **Nouvelle fonction · Analyste.** L'analyste lit ce qui se passe maintenant. On peut lui demander ce qui est ouvert et où : il rend les alertes, la valeur de chacune et son âge, et l'étape de son signal. On peut lui demander les chiffres en direct d'une unité : il donne ceux que sa page montre.
- **Modification · Analyste.** Quand le compte Claude de l'analyste n'a plus de crédit, l'écran le dit et précise qu'un administrateur doit en ajouter. Avant, il proposait de réessayer, ce qui ne pouvait rien changer.
- **Modification · Site.** La section « Core API » est retirée de la documentation du site : neuf pages, une par point d'accès de l'API de terminologie. Les points d'accès existent toujours ; leur référence est celle que l'API sert elle-même, à l'adresse `/documentation`.
- **Nouvelle fonction · Studio.** Une page « API keys » dans la section Admin. La clé que le navigateur utilise s'y affiche en entier, masquée tant qu'on ne demande pas à la voir, avec un bouton pour la copier. Les autres clés montrent leur début. On y crée une clé, qui s'affiche une fois pour être copiée, et on en révoque une.
- **Nouvelle fonction · Site.** La documentation du produit est sur le site, sous Docs : la boucle de décision, la page Scenarios, l'analyste, les algorithmes avec leurs schémas, et ce journal. Ce sont les pages du dépôt, en anglais comme le reste du site. La page française du dépôt reste l'originale : quand elle change, un test signale la page anglaise qui est en retard.
- **Modification · Site.** Le site public passe au thème sombre du Studio : accueil, pages de fonctions, documentation, connexion et compte. Le contenu ne change pas.
- **Modification · Studio.** Tout le Studio passe à un thème sombre : fond presque noir, panneaux gris foncé, un seul bleu, coins carrés. Les pages d'une section sont des onglets au-dessus de la page, pour que la carte garde toute la largeur. Les cartes ont un fond sombre et des échelles de couleur refaites pour lui.
- **Modification · Analyste.** Dans l'onglet Options, chaque option testée est une carte qui se lit d'un coup d'œil : le résultat en trois mots, une barre pour l'attente, une case par site. L'explication complète se déplie d'un clic. L'onglet Decisions reprend le même dessin.
- **Modification · Studio.** La page Models n'affiche plus ses onglets deux fois.
- **Nouvelle fonction · Analyste.** Une option peut remplacer ou retirer un choix que le scénario contient déjà, et non seulement en ajouter un. Le bouton dit alors « Apply to scenario ».
- **Nouvelle fonction · Analyste.** Une question de référence sur l'attente par site d'un run. Le rejeu des questions de référence devient une commande, et le journal garde ce que chaque requête a coûté.
- **Modification · Analyste.** La recherche d'événements en ligne est plus rapide : les recherches d'une demande partent ensemble, et les pages ne sont plus relues pour livrer.

## 19 novembre 2026

- **Nouvelle fonction · Alertes.** Une alerte arrive sur toutes les pages du Studio, avec un clic vers son unité et vers son signal.
- **Modification · Alertes.** Un écran qui se réveille annonce ce qui s'est ouvert pendant son absence. L'âge d'une valeur dit s'il est exact, s'il est un plancher, ou s'il est inconnu. Le lien « Signal » d'une alerte ancienne retrouve son signal.

## 18 novembre 2026

- **Modification · Scenarios.** Le test d'une option ne relance plus la passe « événements seuls » : il est plus court, et sa durée se mesure.

## 17 novembre 2026

- **Nouvelle fonction · Scenarios.** L'analyste : on pose une question sur le réseau ou sur un run, il lit le jumeau avec des outils, et aucun chiffre ne passe sans source.
- **Nouvelle fonction · Scenarios.** L'analyste propose des options, le moteur teste chacune, et la décision retenue s'enregistre avec ce qu'on en attend.
- **Nouvelle fonction · Analyste.** La recherche en ligne propose des événements tirés de sources officielles ; une personne les valide. Un candidat montre les passages sur lesquels il repose.
- **Nouvelle fonction · Analyste.** Douze questions de référence, rejouables contre le vrai modèle.
- **Nouvelle fonction · Scenarios.** Un guide en trois étapes sur la carte, qui lit où en est la page.
- **Modification · Moteur.** Une baisse de capacité a un effet et une fin, et ne rien faire ne gagne plus au classement sur le prix.
- **Modification · Analyste.** Un chiffre écrit à côté du nom d'un site doit venir de la ligne de ce site.
- **Modification · Scenarios.** Le guide tient sur un portable sans défiler, et seule l'étape en cours est détaillée. L'onglet Options dit pourquoi le scénario n'est plus celui qui a été testé.

## 13 novembre 2026

- **Nouvelle fonction · Scenarios.** Un scénario part d'un réseau déjà occupé, les lits ajoutés servent, et le résultat dit où ça casse.
- **Modification · Scenarios.** Les résultats ont leur propre panneau, et un panneau long défile. Un territoire sans hôpital pour l'activité lue est nommé, pas caché.

## 12 novembre 2026

- **Nouvelle fonction · Models.** La boucle de prévision quotidienne : une série se prévoit chaque jour, et la prévision est comparée à ce qui arrive.
- **Nouvelle fonction · Events.** Un événement se compose en phrases, à partir d'un catalogue de profils. Une courbe écrite jour par jour se lit en une ligne.
- **Modification · Models.** Une table sans dates est refusée, et une boucle de prévision se supprime.
- **Modification · Scenarios.** Un jumeau lu à travers un scénario garde ses hôpitaux.

## 11 novembre 2026

- **Modification · Studio.** Les cartes prennent toute la page, et les panneaux flottent dessus.

## 9 novembre 2026

- **Nouvelle fonction · Scenarios.** La carte hexagonale remplace les écrans Compose et Outbreak : on pose les événements et les mesures sur la carte.
- **Nouvelle fonction · Propagation.** Le mélange entre territoires se déclare par voie de contact, et une mesure peut viser certains territoires seulement.

## 6 novembre 2026

- **Nouvelle fonction · Site.** Le globe a son propre écran, et chaque fonction a sa page.
- **Modification · Site.** Une offre claire, sans mention de phase de test.

## Septembre 2026

- **Nouvelles fonctions.** Le laboratoire entraîne un modèle sur une table, avec sa ligne de base, prévoit une série en disant ce que la prévision vaut, et offre un carnet Python. Les tableaux de bord ont des cartes qui lisent le jumeau, une exécution ou un modèle. Sur la carte du réseau, on choisit la mesure affichée, colorée d'après le seuil de sa règle ; on dessine des bassins ; une frontière se colore d'après un nombre qu'elle porte. Les pipelines gagnent le nœud « dernier par clé », la composition d'une valeur à partir d'un motif, et une sortie qui est l'ensemble complet. Le jumeau évalue ses alertes même quand personne ne regarde.
- **Modifications.** Le Studio est entièrement en anglais. La fraîcheur d'une valeur mesure l'âge de la donnée, pas celui du téléchargement, et une valeur absente n'est plus un zéro. L'occupation n'est plus tronquée à 100 %. La carte du réseau ne coupe plus à 500 sites sans le dire. Les synchronisations lisent un fichier dans son vrai encodage, ne perdent plus de fichiers à la pagination, et un échec passager n'éteint plus un flux.

## Août 2026

- **Nouvelles fonctions.** Le moteur d'événements : on compose un événement, il part d'un endroit, met du temps à arriver et faiblit en route ; une frise place ses fenêtres ; la simulation rend ses données. Le modèle de propagation, branché sur la carte, avec ses leviers ajustés sur une vague observée. Les scénarios en calque : un scénario se modifie à côté du jumeau qu'il change, sans le copier. Les signaux : les alertes du jumeau deviennent des signaux, visibles et déplaçables sur un tableau. Les métriques du jumeau deviennent des définitions qu'on crée et règle depuis le logiciel, avec leurs seuils. Sur la carte : les couches viennent de l'ontologie, on trace un flux entre deux sites, on dessine des aires, et les questions spatiales passent par PostGIS. On rejoue une course pas à pas, sur la vraie carte, et on pose une série observée à côté. L'ontologie déclare l'identité d'un type, ce que fait un lien, et l'unité et les bornes d'une propriété. Les tableaux de bord se composent à partir de ce que les données portent.
- **Modifications.** La palette du Studio devient des noms de rôles. L'environnement vit dans l'adresse de la page et se choisit dans l'en-tête. La demande suit la population et non le nombre de lits ; les arrivées se répartissent selon la taille des sites ; la capacité se compte par rôle déclaré. L'ordre des effets d'un événement ne décide plus du résultat. Le site public est refait.

## Juillet 2026

- **Nouvelles fonctions.** Le gestionnaire d'ontologie. Les canaux de données, alimentés par webhook, avec une file durable. Les projets et leurs jeux de données, avec versions. Les sources, les synchronisations et le connecteur REST. Le graphe de lignage et le Pipeline Builder, avec des pipelines qui tournent seuls et des règles de liens. Le globe du réseau : sites, flux, et le détail d'un site. Les unités en arbre et en mosaïque. Le laboratoire causal. Le modèle de rôles et le journal d'audit. La navigation du Studio : rail, sous-navigation, palette de commandes. Les premiers scénarios en calque.
- **Modifications.** L'« environnement » devient le « projet ». La page d'accueil du Studio remplace le menu déroulant des environnements.

## Juin 2026

- **Nouvelles fonctions.** L'extraction clinique : concepts et contextes tirés d'un texte. Le Studio : un éditeur de nœuds, l'accès par compte, les nœuds Source et Webhook, un routeur de formats. L'ontologie par environnement et son API de requête. La qualité des données, avec ses scans. Les alertes et les cumuls du jumeau. Le service de simulation hybride et son mode prévision.
- **Modifications.** Le déploiement applique les migrations avant de démarrer le serveur.

## Mai 2026

- **Première version.** L'API de terminologie : clés d'API et limites par clé, recherche de concepts, synonymes, hiérarchie, normalisation, traduction et désambiguïsation, sur SNOMED CT (édition internationale de février 2026). Le site de documentation et la console du compte.
