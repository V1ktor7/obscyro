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

## Ce qui reste

- **Personne ne peut encore s'en servir.** La base de production n'a pas
  PostGIS, donc le bouton reste désactivé et la fenêtre affiche le bandeau
  d'indisponibilité. L'outil de dessin est écrit et déployé ; il attend une base
  qui puisse recevoir ce qu'il produit. La construction du polygone est
  couverte par des tests, l'interaction avec la carte ne l'est pas — elle n'a
  jamais tourné contre une vraie base.
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
