# Journal des changements

Ce qui a changé dans Obscyro, du plus récent au plus ancien. Chaque entrée dit ce qu'elle est :

- **Nouvelle fonction** : quelque chose que le produit ne faisait pas.
- **Modification** : quelque chose qu'il faisait déjà, et qu'il fait autrement, mieux ou plus vite. Une correction en est une.

Une entrée est écrite le jour où le changement est livré, dans le même commit que le code. Depuis novembre 2026, chaque changement visible a la sienne. Les mois d'avant sont résumés. Le détail complet, commit par commit, est dans [l'historique du dépôt](https://github.com/V1ktor7/obscyro/commits/main).

## 27 novembre 2026

- **Nouvelle fonction · Models.** Importer un modèle de prévision déjà entraîné. Sous Models › Imported models, on branche un modèle au lieu d'en entraîner un : la règle de référence intégrée, un modèle ouvert servi par le service de modèle, ou un modèle hébergé à une adresse. Chaque modèle suit le même chemin, dans l'ordre : son contrat est vérifié sur un échantillon, il est rejoué sur les 14 derniers jours avec ce qu'on savait alors, puis mis à l'essai, chaque prévision figée et impossible à modifier. Il n'est montré que tant qu'il fait mieux que deux règles simples : « même heure, la semaine passée » et « la dernière valeur tient ». L'écran dit où partent les séries avant que rien ne parte, et ne demande jamais de clé.
- **Modification · Données.** La page Kept series défile dans le cadre du Studio. La liste dépassait l'écran et faisait remonter la barre du bas du Studio au milieu de la page. Sur chaque série, ce qu'un rattrapage a laissé de côté tient maintenant en quelques mots ; le détail se lit dans « Catch up ».
- **Nouvelle fonction · Données.** Rattraper une série depuis les copies gardées. Une série commence le jour où on a commencé à la garder, mais chaque synchronisation gardait déjà une copie entière de son fichier. Sur une série, « Catch up » dit combien de copies plus anciennes existent, puis les relit de la plus ancienne à la plus récente, par lots, et peut être arrêté et repris. Pour une mesure du jumeau, chaque copie repasse par le pipeline et la mesure d'aujourd'hui, en mémoire : rien n'est écrit dans l'ontologie. Quand la source a changé de fichier, on peut faire lire les copies de l'ancien jeu à la place de l'entrée du pipeline. Ce qui est noté ainsi est marqué comme rattrapé ; ce qui ne peut pas être placé est laissé de côté et compté. « Forget what was caught up » retire ce qui a été rattrapé, et rien d'autre.
- **Modification · Units.** La fiche d'une unité dit quels relevés de l'historique ont été rattrapés depuis une copie gardée : le jumeau ne les affichait pas à l'époque.
- **Modification · Données.** Une valeur ne tient plus pour toujours. Quand une source cesse d'être lue pendant des jours, « Look » ne prolonge plus son dernier chiffre en ligne plate : pour une série de jeu de données, une valeur tient deux pas de la source au plus, puis c'est un trou. Une lecture faite pour un modèle règle elle-même cette durée.
- **Nouvelle fonction · Données.** Les séries gardées. Sous Data › Kept series, on voit tout ce que la plateforme peut montrer du passé à un modèle : les mesures du jumeau, unité par unité, et les jeux de données gardés comme séries. Chaque ligne dit sur quelle période elle porte, depuis quand elle est gardée, combien de points elle a, pour combien d'unités ou d'entités, et ce qui manque.
- **Nouvelle fonction · Données.** Garder un jeu de données comme série. On choisit, dans les colonnes du jeu, celle du temps, celle de la valeur et celles qui nomment l'entité (une région, un site, un virus). À partir de là, chaque écriture du jeu est lue et seul ce qui change est noté. Une valeur que la source corrige garde l'ancienne et la nouvelle. Ce qu'une écriture n'a pas pu lire est écrit sur la série.
- **Nouvelle fonction · Données.** « Look » montre une série telle qu'un modèle la recevrait : une grille régulière, sur 48 heures par heure ou 30 jours par jour. Une valeur tient jusqu'à la suivante, et un trou reste un trou, jamais un zéro.

## 26 novembre 2026

- **Modification · Studio.** Le panneau « Analyst » du cadre se ferme vraiment. Sa croix, la touche Échap et le bouton « Analyst » le laissaient affiché par-dessus la page, où il cachait ce qui se trouvait dessous. Fermé, il garde toujours ce qui a été demandé.

## 25 novembre 2026

- **Nouvelle fonction · Ontologie.** Les types d'action. Sous Ontology › Action types, un projet déclare ce que l'analyste peut proposer : un nom en mots de l'établissement, ce que le type change (capacité, mesure, transfert, réponse enregistrée), ses bornes (une plage d'unités, des sites, des couches et leur facteur, des jours, des patients par jour), les jours qu'il faut avant de pouvoir l'appliquer, et qui peut l'approuver. L'activité, les sites et les couches se choisissent dans ce que le jumeau déclare. Un type que le jumeau ne permet pas de tester le dit, avec ce qui manque.
- **Nouvelle fonction · Analyste.** L'analyste s'en tient aux types d'action du projet. Il lit la liste avant de proposer, une proposition hors bornes est refusée avant de tourner dans le moteur et n'est pas affichée, et une idée qu'aucun type ne couvre va dans les limites de sa réponse. Quatre types intégrés, sans borne, couvrent ce qu'il proposait déjà : un projet qui ne règle rien travaille exactement comme avant.
- **Nouvelle fonction · Analyste.** Une option dit sous quel type d'action elle tombe et qui peut l'approuver, et la décision enregistrée le garde. C'est une mention : appliquer une option reste le clic d'une personne.
- **Nouvelle fonction · Ontologie.** La même page montre les outils de l'analyste, avec ce que chacun lit, et permet d'en éteindre un pour le projet. Avec la recherche en ligne éteinte, Event finder et Investigate le disent au lieu de chercher.

- **Nouvelle fonction · Ontologie.** Les types de fonction. Sous Ontology › Functions, un projet déclare lui-même ce que l'analyste peut lire, sans code : un compte ou un total sur les objets d'un type (en une valeur, par propriété, par unité ou par site), une liste d'objets, une formule, l'historique d'une mesure à une unité, ou des lignes d'un jeu de données. On choisit dans ce que le projet contient, on dit ce que l'outil reçoit (un texte, un nombre borné, une date, une valeur parmi une liste) et le nom de chaque valeur rendue. Un outil qui ne peut pas tourner le dit, avec ce qui manque.
- **Nouvelle fonction · Ontologie.** Un outil déclaré s'essaie avant de servir. « Try » le lance une fois avec les entrées qu'on lui donne et montre ce que l'analyste lirait, ou la phrase du refus. Aucun modèle n'est appelé.
- **Nouvelle fonction · Analyste.** L'analyste se sert des outils que le projet a déclarés, dans Ask et dans Options, comme des siens. La trace écrit leur libellé suivi de « (declared in this project) », et un chiffre qu'un outil déclaré n'a pas rendu est retiré de la réponse, comme pour les autres. Un outil éteint n'est plus offert.
- **Modification · Ontologie.** La vue Functions et la vue Action types disent qu'un outil de lecture se déclare sous Functions, et un outil déclaré y dit où il s'allume et s'éteint.

- **Nouvelle fonction · Analyste.** Ce que l'analyste peut utiliser se voit à l'écran. L'onglet « What it can use », sur les pages Scenarios et Network, liste ses outils par ce qu'ils lisent, avec une phrase pour chacun, ce qu'il reçoit, et ceux que le projet a éteints. La même liste est en tête de la vue Functions de l'ontologie.

## 24 novembre 2026

- **Nouvelle fonction · Analyste.** Enquêter sur la série d'une unité. Sur la page Network, on choisit un site, et l'onglet Investigate cherche dans les sources officielles ce qui se passait autour sur 24 heures, 72 heures, 7 jours ou 30 jours. Chaque événement trouvé est posé à côté de la série que le jumeau a gardée : l'épisode de dépassement du seuil d'alerte avec lequel il va, à combien de jours, la moyenne des trois jours avant et des trois jours à partir de son début, et les raisons de douter. Les événements déjà au calendrier sont comparés de la même façon. Un rapprochement est une coïncidence dans le temps : l'écran écrit « goes with », jamais « caused ».
- **Nouvelle fonction · Analyste.** On voit l'enquête travailler, et elle laisse sa trace. Chaque étape s'écrit à l'écran quand elle se termine : la série lue, le calendrier, les unités voisines, ce qui part vers le web, chaque recherche, chaque passage cité, la comparaison, le contrôle. Une barre dit où l'on en est. Tout est gardé au journal, et une enquête passée se rouvre telle qu'elle a été livrée.
- **Nouvelle fonction · Analyste.** Seule la phrase part dans une recherche. L'onglet en propose une, qui nomme l'unité et les dates et aucun de ses chiffres ; on peut la changer avant de l'envoyer. La série, le seuil et les voisins sont lus par le serveur et ne sont jamais envoyés au modèle. Sans relevé sur le laps de temps, aucune recherche n'est faite.
- **Nouvelle fonction · Studio.** La page Network porte l'analyste dans un panneau repliable, sous l'inspecteur du site choisi, avec les onglets Ask et Investigate. L'ouvrir replie l'inspecteur ; le replier ne perd pas ce qui est en cours. Le bouton « Analyst » en bas à droite n'est plus montré sur cette page.
- **Nouvelle fonction · Studio.** La frise de la page Network trace la série de l'unité choisie : la mesure que la carte colore, en escalier, avec son seuil d'alerte. Quand une enquête est à l'écran, ses épisodes y sont des bandes et ses événements des repères, au jour où leur source les date.
- **Modification · Studio.** La frise de la page Network offre quatre fenêtres au lieu de deux : 24 h, 72 h, 7 jours, 30 jours. C'est aussi le laps de temps d'une enquête.
- **Nouvelle fonction · Studio.** Les alertes ouvertes sont dans l'explorateur de la page Network, sous l'onglet « Alerts », avec leur nombre. Un clic sur une alerte choisit son site sur la carte et ouvre son inspecteur ; « Situation » mène à sa fiche.
- **Modification · Studio.** Les six pages de la section Twin sont rangées en trois groupes : Network, la carte d'où l'on travaille ; « Library » (Scenarios, Events, Profiles) ; « Setup » (Response, Units). La section s'ouvre maintenant sur Network. Aucune page n'a changé d'adresse.
- **Nouvelle fonction · Studio.** Les deux cartes du jumeau portent la même bascule, « Live · Scenario », en tête de leur barre : elle dit sur quelle carte on est et mène à l'autre, sur le même projet.

## 23 novembre 2026

- **Modification · Studio.** Chaque chiffre que rapporte une unité porte son âge. La liste « Also reports » de la fiche d'une unité, et celle de l'inspecteur de la carte du réseau, écrivent une fois l'âge que partagent leurs valeurs (« Values read 27m ago. »). Une valeur lue à une autre heure porte le sien sur sa ligne, et un chiffre de la veille dit quand il a été publié.
- **Modification · Jumeau.** L'écart d'une valeur se compte toujours depuis une heure d'avant. Quand une valeur est corrigée dans son heure, le jumeau garde deux relevés à la même heure : l'écart se comptait contre la première écriture. Les deux sont maintenant enjambés.

## 22 novembre 2026

- **Nouvelle fonction · Studio.** La fiche d'une unité dit, pour chaque mesure, l'écart avec le relevé gardé qui précède et l'heure de ce relevé : « Up 6 pts since the reading of 16:45. ». Sans relevé d'avant, elle l'écrit ; contre un relevé sans valeur, aucun écart n'est compté. Un écart n'a pas de couleur : plus n'est pas toujours pire.
- **Nouvelle fonction · Jumeau.** Un chiffre peut être déclaré « de la veille ». Une propriété numérique dit la période qu'elle décrit (éditeur d'un type, « Describes ») ; une mesure qui la lit s'écrit « Yesterday's average, published 14m ago » au lieu de prendre l'âge de l'heure qui l'a republiée. Sa moyenne sur 30 jours est donnée avec le nombre de jours sur lequel elle repose.
- **Nouvelle fonction · Jumeau.** Une mesure peut être une durée, tenue en heures et écrite « 5 h 59 ». Le nouvel agrégat `only` prend la valeur du seul objet qui la porte : sous une unité qui en contient plusieurs, une moyenne déjà faite n'est pas moyennée de nouveau, et la fiche dit pourquoi il n'y a pas de valeur. Une source qui n'a publié aucun chiffre est dite telle, et n'est jamais lue comme un zéro.
- **Modification · Studio.** Sur la carte du réseau, l'inspecteur d'un site est refait. L'alerte ouverte vient en tête ; puis la mesure que la carte colore, avec sa jauge et son âge ; ce que le site rapporte d'autre, chaque chiffre avec son écart ; les chiffres de la veille à part, avec leur moyenne ; l'historique sur 24 heures. Chaque bloc se replie, et le panneau entier aussi. Un site qui compte plusieurs unités dit que l'historique se lit unité par unité.
- **Nouvelle fonction · Studio.** La fiche d'une unité et l'inspecteur d'un site disent d'où viennent les chiffres : « About these figures » imprime ce que l'organisation a écrit sur les types d'objets lus, c'est-à-dire la source, sa licence et ses limites.
- **Modification · Analyste.** `unit_now` dit quand une mesure est un chiffre de la veille, comment une durée s'écrit, et pourquoi une mesure n'a pas de valeur quand il y a une raison.
- **Nouvelle fonction · Jumeau.** Le jumeau peut déclarer une liste de prix. Un prix est un objet de l'ontologie, sous le nom que l'organisation veut : ce que coûte une unité d'une activité à ouvrir et à garder ouverte un jour, en cents entiers, avec une fourchette si on veut, un mode (normal, accéléré) et son délai, et sa source. Une ligne rattachée à un site vaut pour ce site et passe avant le prix du réseau. Un prix peut aussi être une formule, qui nomme les nombres de sa ligne et les quantités de l'opération. Une ligne sans source est un prix de démo, et l'écran le dit partout où il sert.
- **Nouvelle fonction · Analyste.** Dans l'onglet Options, chaque option se lit sur trois comptes : ce qu'elle change, le jour où elle peut être prête, ce qu'elle coûte. Un clic sur un coût ouvre ses lignes : la quantité, le prix, le calcul et la source de chacune. Quand la liste tarife une activité en plusieurs modes, l'analyste peut proposer la même capacité plus tôt à un prix plus élevé, ou plus tard à un prix plus bas ; un jour que le délai ne permet pas est refusé. Les options qu'aucune autre ne bat à la fois sur l'attente et sur le coût sont marquées « Not beaten », sans être classées entre elles. Sans liste de prix, rien ne change.
- **Nouvelle fonction · Analyste.** L'analyste lit la liste de prix (`list_prices`), et un montant qu'aucun outil n'a rendu est retiré d'une réponse comme n'importe quel autre chiffre.
- **Nouvelle fonction · Ontologie.** La vue « Functions » montre la liste de prix du jumeau : les formules de coût avec ce que chacune peut nommer, chaque ligne de prix, et les lignes qui n'ont pas pu être lues, avec la raison. Le panneau d'un type montre les prix de ses unités.
- **Modification · Analyste.** Une décision enregistrée garde le coût attendu et les prix dont il a été compté. Un prix corrigé plus tard ne change pas ce qu'elle montre.
- **Modification · Studio.** Les coûts des réponses enregistrées sont montrés comme des prix de démo : sur une carte d'option, sous le classement de la page Events et sous les options du rejeu. Ce sont les montants que leurs règles déclarent, et aucun n'a de source.
- **Nouvelle fonction · Studio.** La fiche de situation suit un signal après sa levée. Elle montre la mesure qui l'a levé telle que le jumeau l'a notée : à la levée, à la décision, puis le plus bas, le plus haut et le dernier relevé. Elle écrit combien de temps après le signal la décision a été prise, ce qu'est devenue l'alerte, et ce que donnait le run testé. Ce qui est mesuré et ce qui était attendu sont côte à côte, jamais soustraits, et la fiche ne conclut pas.
- **Nouvelle fonction · Alertes.** L'éditeur de seuils dit, pour chaque règle, ce que sont devenus les signaux qu'elle a levés, dont la part de ceux qu'une personne a clos comme faux positifs.
- **Nouvelle fonction · Jumeau.** Le jumeau garde ce qu'il mesure. Toutes les cinq minutes il note, pour chaque unité, les mesures dont la valeur a changé ou a été relue à une nouvelle heure. La fiche d'une unité montre l'historique de la valeur affichée sur 48 heures : un trait en escalier, le plus bas, le plus haut, et la date du premier relevé gardé. L'historique commence aujourd'hui : rien d'avant n'est reconstitué, et l'écran le dit.
- **Modification · Alertes.** Chaque alerte donne l'âge de sa propre valeur. L'âge se compte sur ce que la mesure de l'alerte lit, et non plus sur tout ce qui est sous l'unité : une alerte d'occupation des civières, dans une unité qui porte aussi une station de qualité de l'air, a l'âge du relevé des civières, pas celui de la station. Si ce que la mesure lit ne publie aucune heure, l'alerte dit que l'âge est inconnu, même quand une autre source de l'unité en a un. C'est le même âge dans le bandeau, la liste des alertes, la fiche de situation et les réponses de l'analyste.
- **Modification · Alertes.** Un relevé d'urgence a un âge à toute heure. Le fichier des urgences écrit l'heure sur un seul chiffre de minuit à dix heures (`9:45`), ce qui n'était pas lu : pendant ces dix heures, les alertes disaient « age of the value unknown ». Une date sans heure se lit aussi, comme le début de ce jour : l'âge peut alors être trop grand d'un jour au plus, jamais trop petit.
- **Modification · Studio.** La fiche d'une unité nomme trois âges. Sous la valeur, celui de cette valeur (« This value was read 14m ago »). Dans chaque alerte, celui de la valeur qui l'a levée. Dans la case « Oldest source », celui de l'unité entière, la plus vieille de toutes ses sources. La fiche de situation fait de même : chaque chiffre porte son âge, et celui de l'unité est nommé à part. Détail : [la page Units](units-page.md).

## 21 novembre 2026

- **Modification · Données.** Un fichier large se charge comme jeu de données. L'API refusait les lignes d'un fichier au-delà de 1 Mio, et un CSV d'un demi-mégaoctet avec une cinquantaine de colonnes, comme une série quotidienne de santé publique, passe déjà ce seuil une fois ses lignes envoyées. La limite est de 16 Mio pour le chargement des lignes, comme pour les couches de la carte. Sur la carte, « Add data » garde aussi le fichier comme jeu de données jusqu'à cette taille. Le reste de l'API garde 1 Mio.
- **Modification · Analyste.** Dans l'onglet Options, après « Add to scenario », le bandeau dit que l'option est dans le scénario et que Run doit redonner les chiffres de sa carte. Il affichait à la place l'avertissement prévu pour une modification faite ailleurs.
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
