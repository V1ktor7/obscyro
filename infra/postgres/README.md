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

**Pas mesuré : la version exacte de pgvector.** La console Data de Railway a
cessé de se connecter avant que je puisse la lire. C'est précisément ce que
`npm run preflight` compare, et le comparer automatiquement juste avant la
bascule vaut mieux que l'avoir lu une fois sur une capture d'écran.

**Pas vérifié non plus : que le tag `:18` soit publié.** Le listing public des
paquets s'arrêtait à 17 quand ceci a été écrit, alors que la base tourne en
18.4 — donc Railway construit bien une 18 quelque part. À confirmer avant de
construire :

```bash
docker manifest inspect ghcr.io/railwayapp-templates/postgres-ssl:18
```

S'il n'existe pas, épingler le minor exact que le service rapporte. **Ne pas se
rabattre sur `postgres:18`** : ça perd SSL et pgbackrest en silence, et la
panne se manifesterait comme une erreur de certificat des jours plus tard.

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

**Les 3 Go de SNOMED n'ont pas besoin de traverser.** Ils se rechargent depuis
la source avec `npm run import:snomed`. Exclure le schéma fait passer le dump de
3,6 Go à 433 Mo, et la fenêtre d'arrêt de dizaines de minutes à quelques-unes :

```bash
pg_dump --format=custom --no-owner --no-privileges --exclude-schema=snomed "<source>"
```

C'est un compromis, pas une évidence : la recherche sémantique reste muette tant
que le rechargement n'est pas fini. À décider selon ce qui coûte le plus cher ce
jour-là.

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
