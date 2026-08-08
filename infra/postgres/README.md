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
réglages. Le tag flottant.

### La déduction qui était fausse

J'avais écrit ceci : puisque `:18` et `:18.4` sont le même digest, le pgvector
de la production doit être le 0.8.6 que contient l'image. Lecture faite dans le
conteneur, le 8 août :

```
vector | 0.8.2
```

**0.8.2, pas 0.8.6.** Un tag flottant ne flotte que pour celui qui le tire :
Railway a épinglé le digest au moment du déploiement, et le conteneur tourne
depuis sur cette image-là. `:18` a avancé, la production non.

C'est le même piège que je dénonçais, vu de l'autre côté — je surveillais le
risque que la base saute en 18.5 toute seule, alors qu'elle était en réalité
gelée sur une image vieillissante. Et c'est la meilleure justification qu'on
puisse donner au contrôle préalable : je m'étais persuadé d'un chiffre par
raisonnement, et il était faux.

### Le contrôle préalable, fait le 8 août 2026

Par les consoles Railway des deux services, en lecture seule — aucun mot de
passe manipulé.

| | source | cible | |
|---|---|---|---|
| Postgres | 18.4 (180004) | 18.4 (180004) | identique |
| `btree_gin` | 1.3 | 1.3 | |
| `pg_trgm` | 1.6 | 1.6 | |
| `pgcrypto` | 1.4 | 1.4 | |
| `plpgsql` | 1.0 | 1.0 | |
| `vector` | **0.8.2** | **0.8.6** | montée de version |
| `postgis` | absent | **3.6.4** | ce qu'on venait chercher |
| tables dans `app` | 53 | 0 | la cible est vide |
| taille | 3667 Mo | — | |

**Aucun blocage.** Une extension plus récente à l'arrivée est le sens permis :
`pg_dump` n'épingle pas la version dans le `CREATE EXTENSION`, donc la
restauration prendra le 0.8.6 de la cible. L'inverse aurait bloqué.

À noter quand même : la bascule est donc aussi une montée de pgvector 0.8.2 →
0.8.6. Rien dans les notes de version de pgvector ne casse le type `vector`
entre ces deux-là, mais c'est un changement de plus que « la même chose avec
PostGIS », et il mérite d'être dit plutôt que découvert.

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

## Où on en est

Les étapes 1 et 2 sont faites. La base de production n'a pas été touchée.

| | |
|---|---|
| image | `ghcr.io/v1ktor7/obscyro-postgres:sha-bff7a14` (aussi `:18.4`) |
| digest | `sha256:396a0d75279a…` — 233 Mo, 23 couches |
| service | `Postgres-PostGIS`, volume `postgres-volume-r8mS`, base vide |

Vérifié sur la nouvelle base, par sa console :

```
postgis  3.6.4   disponible
vector   0.8.6   disponible
postgres PostgreSQL 18.4 (Debian 18.4-1.pgdg13+1)
```

Même version de Postgres que la production, aux deux extensions près. Ce qui
règle au passage la version de pgvector que la console de l'ancienne base
refusait de me donner : 0.8.6 vient de l'image de base, donc c'est aussi ce qui
tourne aujourd'hui.

Reste les étapes 3 à 7.

## Le mode opératoire

Rien ici ne touche à la base existante avant l'étape 5.

**1. Construire et publier l'image.** Fait par
`.github/workflows/postgres-image.yml`, à chaque modification de `infra/postgres`.

La construction échoue si `postgis.control` ou `vector.control` manque, et la
publication n'a lieu qu'après ce contrôle. Une image qui démarre bien et ne
révèle le trou qu'au moment où une restauration atteint `CREATE EXTENSION` est
pire qu'une qui n'a jamais été construite.

**2. Déployer un *nouveau* service Postgres sur cette image.** Créé par le
modèle Postgres de Railway — donc variables, volume, `PGDATA` et l'onglet
Backups tels que Railway les fait — puis l'image seule remplacée. Nouveau
volume, base vide. L'ancien continue de servir la production sans rien
remarquer.

Épinglé sur le tag `sha-…`, pas sur `18.4`, et surtout pas sur un tag flottant
comme celui de l'ancien service.

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

**4. Une sauvegarde.** Une sauvegarde jamais restaurée est une hypothèse, et
celle-ci mérite qu'on regarde de près ce qu'elle vaut.

État constaté le 8 août 2026 sur le service `Postgres` : **PITR désactivé,
aucune planification**, et une seule sauvegarde de volume datant de deux mois —
477 Mo, prise quand la base en pesait autant. Autrement dit : rien d'utilisable.

Une sauvegarde de volume a été prise le 8 août (5,08 Go, service resté en
ligne). Elle vaut mieux que rien, avec deux réserves :

- c'est un instantané d'un Postgres **en marche**, donc cohérent au sens d'un
  crash, pas d'un arrêt propre. Postgres rejouerait son WAL au démarrage. C'est
  normal et ça fonctionne, mais ce n'est pas une restauration vérifiée ;
- **la restaurer passe par un redéploiement du service**, et les
  redéploiements de ce service sont bloqués par la région `sfo`. Le filet
  existe, mais la corde passe par une poulie coincée.

D'où le vrai filet pour cette migration : **le dump de l'étape 5 lui-même**.
C'est un fichier que tu tiens, indépendant de Railway, restaurable n'importe
où. Les étapes 4 et 5 partagent donc le même artefact — prends le dump,
vérifie-le, garde-le, puis restaure-le.

```bash
pg_restore --list obscyro.dump | head -40
```

Si la table des matières liste tes schémas et tes tables, le fichier est lisible.
Ça ne prouve pas la restauration, mais ça élimine le cas où on découvre au pire
moment qu'on a sauvegardé zéro octet.

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
