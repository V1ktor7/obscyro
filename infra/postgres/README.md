# L'image Postgres

## La trouvaille

La base de production tourne déjà sur l'image de Railway,
`ghcr.io/railwayapp-templates/postgres-ssl`, et son `Dockerfile.18` installe
**`postgresql-18-pgvector`**. C'est de là que vient l'extension `vector` dans
une base à laquelle personne n'a délibérément donné pgvector.

Elle n'installe pas PostGIS. C'est toute la différence.

Donc ce n'est pas une nouvelle image de base : c'est celle de Railway avec un
paquet apt de plus. Ça garde tout ce dont le déploiement actuel dépend :

- le certificat TLS que `init-ssl.sh` génère et renouvelle — `SSL_CERT_DAYS`
  est dans les variables du service aujourd'hui ;
- `pgbackrest`, et l'onglet Backups qui le lit ;
- `wrapper.sh` comme point d'entrée, et la disposition de `PGDATA` dessous.

Reconstruire tout ça depuis `postgres:18` voudrait dire en devenir responsable.
Ajouter une couche veut dire ne pas l'être.

## Ce qui a été mesuré, et ce qui ne l'a pas été

Mesuré sur la base de production le 7 août 2026, en lecture seule :

| | |
|---|---|
| version | PostgreSQL 18.4 (Debian) |
| rôle | `postgres`, superutilisateur |
| installées | `btree_gin`, `pg_trgm`, `pgcrypto`, `plpgsql`, `vector` |
| `postgis` | absent de `pg_available_extensions` (47 extensions, aucune postgis) |
| taille | 3659 Mo — `snomed` 3048 Mo (9 tables), `app` 433 Mo (53 tables) |

Le service tire de `ghcr.io/railwayapp-templates/postgres-ssl:18` — lu dans ses
réglages. Le tag flottant, donc : la base passera en 18.5 le jour où Railway en
publiera une, sans que personne l'ait décidé.

**Pas mesuré : la version exacte de pgvector en production.** La console Data de
Railway a cessé de se connecter avant que je puisse la lire.

Ce que la CI mesure, elle, c'est le contenu de l'image construite :

```
postgis  3.6.4
vector   0.8.6
postgres 18.4-1.pgdg13+1
```

Comme `:18` et `:18.4` sont le même digest, le pgvector de la production est
selon toute vraisemblance ce 0.8.6 — même image de base, même paquet. C'est une
déduction, pas une lecture, et c'est exactement ce que `npm run preflight`
vérifie avant qu'on touche à quoi que ce soit.

## Le tag, vérifié au registre

La page publique des paquets GitHub s'arrêtait à 17, ce qui m'a fait écrire que
le tag 18 restait à confirmer. La page mentait par omission. Interrogé
directement, le registre en rapporte 27, dont :

| tag | digest | plateformes |
|---|---|---|
| `18` | `sha256:268850e5d26b…` | linux/amd64, linux/arm64 |
| `18.4` | `sha256:268850e5d26b…` | linux/amd64, linux/arm64 |
| `18.3` | `sha256:1e3613f98b80…` | linux/amd64, linux/arm64 |

`18` et `18.4` sont **le même digest** : `18` *est* 18.4 aujourd'hui — et
deviendra 18.5 en silence dès que Railway en publiera une.

D'où l'épinglage sur `18.4` dans le Dockerfile. Un tag flottant sous une base de
données est le mauvais genre de surprise ; le passage au minor suivant devrait
être un commit que quelqu'un a fait exprès, un jour qu'il a choisi. Et 18.4 est
exactement ce que la production rapporte, ce qui fait de la bascule un
changement d'image et rien d'autre.

Refaire le contrôle, sans Docker, depuis n'importe quel navigateur :

```js
const repo = "railwayapp-templates/postgres-ssl";
const t = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`).then(r => r.json());
await fetch(`https://ghcr.io/v2/${repo}/tags/list?n=1000`,
  { headers: { Authorization: `Bearer ${t.token}` } }).then(r => r.json());
```

À lancer depuis une page `ghcr.io` — sinon le navigateur refuse la requête.

## Le mode opératoire

Rien ici ne touche à la base existante avant l'étape 5.

**1. Construire et publier l'image.**

```bash
docker build -t ghcr.io/<toi>/obscyro-postgres:18 infra/postgres
```

La construction échoue si `postgis.control` ou `vector.control` manque. Une
image qui démarre bien et ne révèle le trou qu'au moment où une restauration
atteint `CREATE EXTENSION` est pire qu'une qui n'a jamais été construite.

**2. Déployer un *nouveau* service Postgres sur cette image.** Nouveau volume,
base vide. L'ancien continue de servir la production sans rien remarquer.

**3. Le contrôle préalable.**

```bash
DATABASE_URL="<l'actuelle>" TARGET_DATABASE_URL="<la nouvelle>" npm run preflight
```

Par variables d'environnement et pas en argument, délibérément : npm réaffiche
la ligne de commande avant de l'exécuter, donc une chaîne de connexion passée en
argument finit dans l'historique du shell et dans les journaux de CI. (Et npm
avale un `--target` nu, le prenant pour une de ses propres options.)

Il compare les versions du serveur, chaque extension installée à la source
contre ce que la cible a ou peut avoir, et refuse si la cible a des tables dans
le schéma `app` — restaurer là-dedans fusionnerait deux bases. Lecture seule des
deux côtés ; aucune des deux URL n'est imprimée.

Tant qu'il rapporte un blocage, il n'y a pas de migration à commencer.

**4. Une sauvegarde que tu as déjà restaurée une fois.** Une sauvegarde jamais
restaurée est une hypothèse.

**5. La bascule.** C'est la seule étape irréversible, et elle demande une
fenêtre d'arrêt.

```bash
pg_dump --format=custom --no-owner --no-privileges "<source>" > obscyro.dump
pg_restore --no-owner --no-privileges --dbname "<cible>" obscyro.dump
```

Puis pointer `DATABASE_URL` du service `obscyro` sur la nouvelle base et
redéployer.

Tout traverse, y compris les 3 Go de SNOMED. C'est plus lent et c'est le point :
la base d'arrivée est alors la même que celle de départ, à PostGIS près, et il
n'y a rien à se rappeler de rallumer.

### L'option d'alléger, et ce qu'elle coûte

`--exclude-schema=snomed` fait passer le dump de 3,6 Go à 433 Mo et la fenêtre
d'arrêt de dizaines de minutes à quelques-unes. Le schéma se recharge ensuite
avec `npm run import:snomed`.

C'est tentant et ce n'est pas gratuit. Voilà ce qui reste éteint entre les deux
— rien de tout ça ne se voit depuis le Studio, qui continue de fonctionner
normalement.

| | |
|---|---|
| `/v1/translate` | la correspondance SNOMED → ICD-10, annoncée sur la page d'accueil |
| `/v1/concepts`, `/v1/hierarchy`, `/v1/synonyms` | lecture de la terminologie |
| `/v1/normalize`, `/v1/batch`, `/v1/disambiguate` | passent par `lib/normalize` → `snomed.concepts` et `snomed.descriptions` |
| la recherche sémantique | `snomed.description_embeddings`, le seul usage de pgvector |
| la vue Quality | `snomedExists()` interroge `snomed.concepts` **sans `try/catch`** |

Le dernier point mérite une nuance : la règle ne se déclenche que sur une
instance portant une propriété de code SNOMED. Une ontologie de sites, d'unités
et de lits n'en a aucune, donc la vue tient — jusqu'au jour où quelqu'un importe
un jeu de données qui en contient, et là c'est le contrôle entier qui lève.
C'est une casse latente, déclenchée par les données et pas par l'ouverture de la
vue.

Ce qui **ne** dépend pas de SNOMED : l'ontologie, le jumeau, la carte, les
pipelines, les signaux, les scénarios, les jeux de données, la traçabilité.
Tout ça vit dans `app`.

Le rechargement :

```bash
DATABASE_URL="<la nouvelle>" npm run import:snomed
```

**6. Activer le spatial.**

```bash
DATABASE_URL="<la nouvelle>" npm run enable-spatial
```

`CREATE EXTENSION postgis` plus la table `app.instance_geometry` et ses index.
Ce n'est délibérément pas une migration : `railway.json` démarre l'API avec
`migrate && node dist/index.js`, donc une migration qui échoue empêche l'API de
démarrer. Voir `design/SPATIAL.md`.

**7. Garder l'ancien volume.** Quelques jours, jusqu'à ce que la nouvelle base
ait porté du trafic réel. C'est le seul retour en arrière qui existe.

## Ce qui reste vrai après tout ça

L'outil de dessin d'aires est déployé depuis `f444745` et attend une base qui
puisse recevoir ce qu'il produit. Rien d'autre dans le produit ne dépend de
PostGIS : tant qu'il est absent, `/geo/capability` le dit, le bouton reste
désactivé, et le reste fonctionne.
