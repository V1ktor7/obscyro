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

## Ce qui reste

- **Dessiner sur la carte.** Aujourd'hui une forme s'attache par l'API. Le
  polygone se trace à la main dans Mapbox Draw, et la carte doit le rendre —
  elle n'affiche pour l'instant que des points et des arcs.
- **Le temps de trajet.** C'est la vraie question pour une ambulance, et ce
  n'est pas de la géométrie : il faut un service de routage externe. La distance
  à vol d'oiseau que rend `nearest` n'est pas une réponse clinique.
- **Les trous de couverture au sens propre.** `uncovered` répond pour les
  instances que l'ontologie connaît. « Quelle population n'est couverte par
  personne » demande une couche de population — un découpage de recensement —
  que l'ontologie ne porte pas.
- **Rien ne consomme ces requêtes.** Elles existent et aucune vue ne les appelle.

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
