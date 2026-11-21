# La page Units

Toutes les unités du jumeau, en direct, classées sur une mesure. La page répond à une question : quelle unité lire en premier. Celles qui sont en alerte viennent d'abord, celles qui ne rapportent rien pour la mesure choisie sont repliées, et la fiche de l'unité choisie reste à côté de la liste.

Elle remplace une colonne de cartes sans ordre, où quatre cents unités faisaient une page de trente mille pixels, avec des noms coupés et une fenêtre de détail qui cachait tout.

## Trois états, jamais mélangés

On choisit une mesure dans le menu **Measure** : celles que l'organisation a définies, puis quatre comptes que tout jumeau a (objets liés, âge de la donnée, patients, lits). Chaque unité est alors dans un état, et un seul.

```mermaid
flowchart TD
    U["Une unité du jumeau"] --> A{"Une alerte ouverte sur elle ?"}
    A -->|"oui"| S1["In alert<br/>quelle que soit la mesure qui a levé l'alerte"]
    A -->|"non"| B{"Une valeur pour la mesure affichée ?"}
    B -->|"oui"| S2["Reporting, no alert"]
    B -->|"non"| S3["No value<br/>groupe replié, jamais lu comme un zéro"]
    S1 --> L["La liste : les trois groupes dans cet ordre.<br/>Les deux premiers suivent le tri choisi, le troisième est par nom"]
    S2 --> L
    S3 --> L
```

**Règles.**
- **Les compteurs sont les filtres.** « All units », « In alert », « Reporting, no alert », « No value » : les trois derniers s'additionnent toujours au premier. Un clic sur un compteur ne garde que ses unités.
- **Une alerte compte, quelle que soit sa mesure.** Une unité en alerte sur une autre mesure reste dans « In alert », et sa ligne écrit « no value ». L'en-tête du groupe n'ajoute « over the threshold » que si toutes les unités en alerte dépassent le seuil de la mesure affichée.
- **Sans valeur n'est pas zéro.** Une unité qui ne rapporte rien pour la mesure n'est jamais rangée dans le classement : elle va dans le groupe replié, qui s'ouvre d'un clic et dit qu'elle rapporte peut-être une autre mesure. Un vrai zéro est une valeur.
- **La couleur vient de la règle d'alerte.** Une pastille est rouge exactement quand la règle qui surveille la mesure se déclencherait sur l'unité, jaune à moins de 15 % du seuil, verte en deçà, grise quand la mesure n'a pas de seuil ou que l'unité n'a pas de valeur. La règle lue est celle du type de l'unité, comme le fait l'évaluateur d'alertes (D5).
- **Le tri.** Du plus haut au plus bas, l'inverse, ou par nom. Une unité sans valeur vient en dernier dans les deux sens : elle n'est pas la plus basse, elle est inconnue.
- **La recherche** porte sur le nom et le code, sans tenir compte des majuscules ni des accents. Elle ouvre le groupe replié quand il contient un résultat.
- **La barre** a une seule échelle pour toute la liste, de zéro au plus grand chiffre, arrondi. Elle ne change pas quand on filtre ou qu'on cherche : deux barres ne se comparent que sur la même échelle. Un trait marque le seuil de l'unité.
- **Un nom n'est jamais coupé.** S'il est long, il passe sur deux lignes.
- **Le type d'unité** (menu **Kind**) n'apparaît que si le jumeau en a plus d'un. Il réduit la liste et les compteurs à ce type.

## Quand le jumeau a une hiérarchie

Si des unités en contiennent d'autres, « All units » montre le haut de la hiérarchie, replié. Un clic sur une unité déplie ce qu'elle contient ; un second clic sur l'unité qu'on est en train de lire la replie.

- La valeur d'une unité compte tout ce qui est sous elle : c'est le calcul du jumeau, pas une somme faite par la page.
- Une unité repliée dit combien d'unités sous elle sont en alerte (« 2 in alert below »). Une branche fermée ne cache pas une alerte.
- Les frères sont classés selon le tri choisi.
- Un compteur autre que « All units » redonne une liste à plat : un filtre montre des unités, pas des branches.
- Une recherche ouvre le chemin jusqu'à chaque résultat et masque le reste.

## Les tuiles

La vue **Tiles** dessine une case par unité qui a une valeur, pour voir tout le réseau d'un coup d'œil. La couleur a trois pas au-delà du seuil, selon la distance : jusqu'à 20 % du seuil, de 20 à 60 %, plus de 60 %. Une case proche du seuil est jaune, les autres sont neutres.

- Quand toutes les unités ont le même seuil, la légende écrit ses chiffres (« over 160% », « over 120% », « over the threshold, 100% »). Quand les seuils diffèrent d'un type à l'autre, elle ne peut dire que la distance.
- Sans seuil sur la mesure, les cases n'ont pas de couleur, et la page le dit.
- Les unités sans valeur ne sont pas dessinées, et la page écrit combien.

## La fiche de l'unité

Elle est à côté de la liste, et passe dessous sur un écran étroit. Un clic sur une autre ligne la remplace : on compare sans rien fermer.

De haut en bas : le nom, où l'unité se situe par rapport à son seuil, sa valeur et la règle en mots (« alert when over 100% ») ; l'âge de la valeur et le nombre d'objets liés ; les alertes ouvertes ; les autres mesures que l'unité rapporte ; ce qu'elle contient, par type ; ses échanges avec d'autres unités ; la recommandation de la règle.

- **Un âge dit ce qu'il vaut.** Quand il est un plancher ou qu'il est inconnu, la fiche écrit pourquoi, en toutes lettres.
- **Une alerte se traite d'ici.** « Open the situation » ouvre sa fiche de situation, « Acknowledge » l'accuse. Une unité sans alerte garde un lien vers sa fiche de situation.
- **« Ask the analyst »** ouvre l'analyste avec cette unité : la question porte sur elle.
- **Deux lectures.** Le nom, la valeur et la barre viennent de la liste, et sont à l'écran au clic. Le reste est lu pour cette unité seule, et relu à chaque nouvelle lecture du jumeau ; en attendant, la fiche écrit « Reading this unit… ». Elle ne montre jamais les alertes d'une unité sous le nom d'une autre.
- **Un lien mène à une unité.** Une alerte ou un signal ouvre la page avec `?unit=` : l'unité est choisie à l'arrivée, et sa ligne est amenée à l'écran, la branche dépliée ou le groupe ouvert s'il le faut. Si le projet n'a pas cette unité, la fiche le dit.

## Les autres commandes

- **Measures** : définir ce que le jumeau mesure. **Alert thresholds** : régler les seuils qui lèvent une alerte ; la liste reprend ses couleurs à la fermeture. **Live metrics** : les comptes du projet en direct.
- La pastille dit comment la liste se tient à jour. « Connecting » : le flux est demandé, rien n'est encore arrivé par lui. « Live stream » : le flux a livré une lecture, et la liste suit le jumeau en continu. « Polling » : le flux a échoué six fois de suite, et la liste est relue toutes les cinq secondes. La page n'écrit « Live stream » qu'après une première donnée reçue par le flux, jamais à la simple demande.
- « Seed demo » n'est proposé que sur un projet sans unité.

## Limites

- Le classement porte sur une mesure à la fois.
- La page montre l'état du moment : le jumeau n'a pas d'historique.
- L'âge affiché est celui de l'unité entière, pas celui de chaque valeur ([issue 19](https://github.com/V1ktor7/obscyro/issues/19)).
- La mesure et le type choisis sont gardés par projet, dans le navigateur. Le tri, la vue et la recherche ne le sont pas.

**Code.** `frontend/app/studio/live/units-list.ts` (états, compteurs, tri, recherche, hiérarchie, échelle, couleurs, sans écran), `UnitsBoard.tsx` (les deux bandes, la liste, les tuiles), `UnitSheet.tsx` (la fiche), `UnitsView.tsx` (les lectures : arbre, mesures, seuils, détail) ; `twinMetricNumber` dans `frontend/app/studio/twin-ui.ts` ; `bandFor` dans `frontend/app/studio/command/site-metric.ts` ; `useOpenAnalyst` dans `frontend/app/studio/AnalystDock.tsx`. **Tests.** `units-list.test.ts`, `UnitsBoard.test.tsx`, `UnitSheet.test.tsx`, `twin-ui.test.ts`, `AnalystDock.test.tsx`.
