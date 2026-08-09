# Le spatial

## Pourquoi PostGIS, alors qu'un polygone tient déjà en JSONB

Les types de propriété `object` et `array` existent et la colonne des instances
est du JSONB : un polygone GeoJSON s'y range depuis toujours. Ce qui ne s'y
range pas, ce sont les **questions** :

- quels territoires de desserte se recoupent, et de combien
- quel établissement est le plus proche d'ici, en mètres
- qui n'est couvert par personne

Postgres ne sait pas intersecter un polygone rangé en JSON. Il faut une colonne
typée et un index GiST.

## `geography`, pas `geometry`

Une distance entre deux hôpitaux doit revenir **en mètres**. Avec `geometry` sur
des latitudes et longitudes, elle revient en degrés — et un degré de longitude
vaut 78 km à Montréal contre 111 km à l'équateur. Personne ne veut reprojeter à
la main pour demander « à quelle distance ».

## Une table à part

`app.instance_geometry`, clé sur `instance_id`, plutôt qu'une colonne sur les
instances. La géométrie ne concerne que les objets qui ont une étendue réelle,
et son index GiST n'a pas à alourdir la table que tout le reste lit.

Le champ `kind` est libre — « territoire de desserte », « zone d'exclusion »,
« corridor » n'est pas une liste qu'on peut arrêter d'avance. Même raisonnement
que le domaine d'un signal.

## Ce n'est pas une migration, et c'est délibéré

`railway.json` démarre l'API ainsi :

```
node scripts/migrate.mjs && node dist/index.js
```

Une migration qui échoue **empêche l'API de démarrer**. Or `CREATE EXTENSION
postgis` peut échouer pour des raisons étrangères à ce code : l'extension n'est
pas dans l'image, ou le rôle n'a pas le droit. Découvrir ça pendant un
déploiement voudrait dire une panne causée par l'ajout d'une fonctionnalité que
personne n'utilisait encore.

Activer une extension sur une base de production est une décision. Elle a donc
une commande :

```bash
npm run enable-spatial
```

Tant qu'elle n'a pas été lancée, `spatialAvailable()` rend faux, les routes
`/geo/*` le disent honnêtement, et le reste du produit ne s'en aperçoit pas.

## Ce que dit la base de production (mesuré le 7 août 2026)

Interrogée par la console Railway, sans rien modifier :

| | |
|---|---|
| version | PostgreSQL 18.4 (Debian) |
| rôle | `postgres`, **superutilisateur** |
| extensions disponibles | 47, **`postgis` n'en fait pas partie** |
| extensions installées | `btree_gin`, `pg_trgm`, `pgcrypto`, `plpgsql`, `vector` |

Le rôle est superutilisateur : ce n'est donc **pas une question de droit**. Et
`pg_available_extensions` trouve bien `pgcrypto`, donc la vue fonctionne — le
vide sur `postgis` est un vrai vide, pas un artefact de la requête. L'image ne
contient pas PostGIS, point.

`npm run enable-spatial` échouerait ici, et c'est précisément pourquoi ce n'est
pas une migration : une migration qui échoue empêche l'API de démarrer.

### Le poids réel d'un déménagement

| schéma | taille | tables |
|---|---|---|
| `snomed` | 3048 Mo | 9 |
| `app` | 433 Mo | 53 |

Les 3,6 Go de la base sont à **85 % la terminologie SNOMED**, qui se recharge
depuis la source. Ce qui doit vraiment traverser, c'est `app` — 433 Mo, dont
400 Mo de `ingest_events` (825 207 lignes de journal d'ingestion). Le produit
lui-même pèse quelques dizaines de mégaoctets.

### Le piège

`snomed.description_embeddings` porte une colonne de type `vector`. Toute image
de remplacement doit donc fournir **pgvector *et* PostGIS**. L'image
`postgis/postgis` ne fournit que la seconde : basculer dessus sans vérifier
casserait la recherche sémantique SNOMED, qui, elle, sert déjà.

C'est le genre de chose qui ne se découvre pas pendant la bascule.

## Ce qui est fait

| | |
|---|---|
| `GET /geo/capability` | PostGIS est-il là, et sinon pourquoi |
| `GET /geo/shapes` | les formes de l'organisation, en GeoJSON, avec leur aire |
| `PUT /geo/shapes/:instanceId` | attacher une forme à une instance |
| `DELETE /geo/shapes/:instanceId` | la retirer |
| `GET /geo/overlaps` | quelles formes se recoupent, et de combien |
| `GET /geo/nearest?lng=&lat=` | les plus proches d'un point, en mètres |
| `GET /geo/uncovered` | les instances géolocalisées dans aucune forme |

Deux choix qui méritent d'être dits :

**Chaque paire une seule fois.** `overlaps` apparie sur `a.instance_id <
b.instance_id` : « A recoupe B » et « B recoupe A » sont la même trouvaille, et
les lister deux fois double un rapport de couverture pour rien.

**Une frontière commune n'est pas un recouvrement.** PostGIS la rapporte comme
une intersection d'aire nulle. Un rapport plein de celles-là cache les vraies,
donc elles sont écartées.

**Et le recouvrement est asymétrique.** `sharedOfSmaller` rapporte la part du
plus petit des deux : une clinique entièrement dans le territoire d'un hôpital
est couverte à 100 %, tandis que l'hôpital n'est presque pas affecté. Une seule
proportion aurait effacé la différence.

## L'interface

La carte du réseau (`Twin › Network`) dessine et interroge.

**Dessiner** — sélectionner un site, « Draw area », cliquer les coins. Cliquer
un site accroche le sommet dessus : c'est comme ça qu'un corridor entre deux
bâtiments se trace sans chercher le centre. Retour arrière défait le dernier
coin, Entrée enregistre, Échap abandonne — un outil de dessin qu'on ne peut
quitter qu'à la souris est un piège dès que le curseur est parti sur la carte.

L'aire part dans l'ontologie, sur l'instance, exactement comme un flux tracé
devient un lien.

**Interroger** — la fenêtre « Coverage » pose les trois questions : ce qui est
dessiné, où les aires se recoupent, qui ne tombe dans aucune.

Deux choix de conception :

**Écrit à la main plutôt que Mapbox Draw.** La carte change de fond de plan à
chaud, et `setStyle` jette toutes les sources et couches. Une bibliothèque de
dessin devrait alors être démontée et reconstruite sur `style.load` — c'est-à-dire
exactement la couture que cette vue gère déjà pour ses arcs. Un mécanisme vaut
mieux que deux.

**Les aires sont le fond, les flux la figure.** Un territoire de desserte est du
contexte qu'on lit *à travers* : lavis neutre, sous les arcs. Lui donner une des
couleurs catégorielles en aurait fait une voie de plus.

## C'est actif — 8 août 2026

La production tourne sur `Postgres-PostGIS` : **PostGIS 3.6.4**, table
`app.instance_geometry` créée avec son index GiST. La fenêtre « Coverage » ne
montre plus le bandeau d'indisponibilité — elle exécute `ST_Covers` sur les
instances géolocalisées et rapporte les neuf sites qui ne tombent dans aucune
aire, faute d'aire dessinée.

Voir `infra/postgres/README.md` pour le déroulé de la bascule.

## Le dessin, exercé pour de vrai

Deux aires tracées à la main sur la carte de production, le 8 août au soir. Le
cycle complet tient :

| | |
|---|---|
| créer | polygone à 4 coins → `PUT /geo/shapes/:id` → `app.instance_geometry` |
| mesurer | `ST_Area` sur la géographie — 42,64 km² et 33,40 km², en mètres carrés vrais |
| recouper | `ST_Intersection` trouve 2,5 ha communs entre les deux |
| supprimer | la corbeille de la fenêtre Coverage, le compte retombe |

Vérifié en base et pas seulement à l'écran : `sommets=5` pour un quadrilatère,
c'est-à-dire quatre coins plus le point de fermeture que `polygonFrom` ajoute.

## Ce qui reste, et deux défauts trouvés en le faisant

**Une aire a été créée sans que je la dessine.** Entre mes deux tracés, une
troisième forme est apparue — `GMF Centre-Sud`, six coins, sur un site que je
n'avais jamais sélectionné. Les horodatages la placent pendant que je fermais
une fenêtre et cliquais un marqueur : le mode dessin a capté des clics destinés
à autre chose. Je n'ai pas su reconstruire quelle séquence exacte l'a produite,
et c'est précisément ce qui la rend gênante — **rien à l'écran ne disait qu'un
dessin était en cours**. Le bandeau du haut annonce l'état, mais il se lit mal
quand on regarde ailleurs.

À corriger : sortir du mode dessin dès qu'une autre interaction commence, ou
rendre l'état bien plus visible que ce chip.

**« Covered by nobody » ne bouge pas quand on dessine.** Les trois sites que
j'ai touchés n'ont **aucune coordonnée** en propriété — ils font partie des 21
que la carte place sur un anneau de repli autour de Montréal. Or `uncovered`
ne considère que les instances dont `latitude`/`longitude` passent le filtre
numérique. Dessiner autour de leur position *affichée* ne pouvait donc rien
changer, et c'est le comportement correct.

Mais leurs **noms** figurent dans la liste des non couverts. Donc il existe deux
instances « GMF Centre-Sud », deux « Hôpital Notre-Dame » : une avec
coordonnées, une sans. C'est le problème d'identité déjà connu — les types
d'objet n'ont pas de propriété d'identité et rien n'empêche les doublons — et
il se manifeste ici en rendant la couverture illisible.

**Reste aussi :** le recouvrement s'affiche « 0% of the smaller » pour 2,5 ha
sur 33,4 km². C'est juste, et inutile : sous le demi-pour-cent, la barre est
vide et le chiffre ne dit rien. Une part minuscule mérite un « < 1 % » plutôt
qu'un zéro.
- **Le temps de trajet.** C'est la vraie question pour une ambulance, et ce
  n'est pas de la géométrie : il faut un service de routage externe. La distance
  à vol d'oiseau que rend `nearest` n'est pas une réponse clinique.
- **Les trous de couverture au sens propre.** `uncovered` répond pour les
  instances que l'ontologie connaît. « Quelle population n'est couverte par
  personne » demande une couche de population — un découpage de recensement —
  que l'ontologie ne porte pas.

## Le mouvement spatio-temporel

Une chose que j'ai affirmée à tort plus tôt : l'ontologie *a* une dimension
temporelle, partielle. La migration `038` a ajouté `valid_from` et `valid_to`
sur les **instances de liens**, avec un index unique partiel `WHERE valid_to IS
NULL` qui garantit qu'un seul lien est courant.

Donc « le patient X était dans le service A de 8 h à 14 h, puis dans le service
B » est déjà modélisable : une trajectoire est une suite de liens datés.

Ce qui manque vraiment :

- **les instances n'ont pas d'intervalle**, seulement les liens. Un lit qui
  passe de `free` à `occupied` écrase sa propriété ; son histoire n'existe pas ;
- **presque rien ne lit ces intervalles.** Le jumeau, les métriques et le cumul
  les ignorent. Seul le calque de scénario s'en sert.
