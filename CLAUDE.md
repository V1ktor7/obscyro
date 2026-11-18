# Obscyro — consignes de travail

Ce fichier est lu au début de chaque session. Il dit ce qu'est le produit, comment on y travaille, et ce qui doit être vrai à la fin de chaque changement. Le détail est dans [docs/](docs/README.md).

## Le produit

Obscyro est un outil d'aide à la décision pour un réseau de santé. Il tient un jumeau numérique du réseau (sites, capacités, territoires), y fait passer des événements par un moteur de simulation, et explique ce qui en sort à une personne qui doit décider.

La pièce en construction est la **boucle d'aide à la décision** : signal, situation, précédents, effets mesurés, options testées, recommandation, suivi. Où elle en est : [docs/decision-loop.md](docs/decision-loop.md).

## Carte du dépôt

| Dossier | Ce que c'est | Hébergement |
|---|---|---|
| `frontend/` | Studio, Next.js 14 | Vercel |
| `backend/` | API Fastify, TypeScript, Postgres | Railway, service `obscyro` |
| `simulation-service/` | Moteur de simulation et laboratoire, Python | Railway |
| `nlp-service/` | Extraction clinique, Python | Railway |
| `backend/scripts/migrations/` | Migrations SQL numérotées | appliquées au démarrage de l'API |
| `docs/` | Documentation du fonctionnement | — |
| `design/` | Notes et maquettes de conception | — |

## Vérifier avant de pousser

```bash
# backend/
npx tsc --noEmit -p .
npm run test:unit

# frontend/
npx tsc --noEmit -p . --typeRoots ./node_modules/@types
npx vitest run
npx next build

# simulation-service/
pytest
```

Le `--typeRoots` du frontend n'est pas décoratif : sans lui, un paquet de types installé hors du dépôt masque des types manquants, et la compilation échoue seulement sur Vercel.

## Conventions

- **Langue.** Réponses à la personne en français, en langage simple. Interface du produit en anglais. Messages de commit et documentation en français. Commentaires de code en anglais.
- **Git.** On pousse directement sur `main` une fois testé. Un commit par changement cohérent, avec sa documentation.
- **Cartes.** Sur une page qui montre une carte, tout panneau est un overlay repliable posé sur la carte (`OverlayPanel` dans `frontend/app/studio/map-overlay.tsx`). Jamais de panneau latéral.
- **Secrets.** Ne jamais saisir, créer ni écrire une clé d'API ou un mot de passe. Une variable manquante se signale ; c'est un administrateur qui la pose.
- **Tests.** Un changement de comportement arrive avec son test. Les appels à un modèle de langage sont simulés dans les tests ; la vraie API n'est appelée que par un script lancé à la main.
- **Migrations.** Ne jamais modifier une migration déjà appliquée : ajouter le numéro suivant. L'en-tête du fichier explique, en français, pourquoi la table existe.

## Règles du produit

Elles ne se négocient pas, et elles s'appliquent à tout ce qui touche à la boucle de décision.

1. **Aucun chiffre sans outil ni source.** Un modèle de langage ne détient aucun fait sur le réseau et ne calcule pas. Tout chiffre affiché vient d'un résultat d'outil, vérifié par programme.
2. **Le modèle lit et explique ; une personne décide.** Ce que l'IA écrit dans le jumeau ou un scénario est une proposition, validée par un clic humain.
3. **Un run n'est pas une prévision.** C'est le résultat d'un modèle sous des conditions énoncées. L'écran le dit.
4. **Le système suit le réseau, jamais des personnes.** Données agrégées seulement.
5. **Ce qui est mesuré, publié ou supposé reste distinct**, à l'écran comme dans le code.
6. **Une limite se dit.** Ce que le jumeau ne contient pas (personnel, stocks, historique) est nommé plutôt que comblé.

## Documentation : la règle

**Chaque ajout, modification ou suppression met à jour la documentation dans le même commit.** Un changement sans sa documentation n'est pas terminé.

| Ce qui change | Ce qu'on met à jour |
|---|---|
| Un algorithme (ajouté, modifié, supprimé) | Sa section **et son schéma** dans [docs/algorithms.md](docs/algorithms.md), et la table en tête du fichier |
| L'analyste (outil, prompt, vérificateur, écran) | [docs/analyst.md](docs/analyst.md), et les schémas A1 à A3 |
| La page Scenarios (un panneau, le guide) | [docs/scenarios-page.md](docs/scenarios-page.md) |
| Une étape de la boucle de décision | La table d'état de [docs/decision-loop.md](docs/decision-loop.md) |
| Le moteur d'événements | `simulation-service/app/events/README.md`, et les schémas de la partie B |
| Une route de l'API | Son `summary` et sa `description` dans le schéma de la route, et le document qui en parle |
| Une variable d'environnement | `backend/.env.example` et `backend/DEPLOY.md` |
| Une migration | L'en-tête du fichier SQL |
| Une suppression | On retire la section et le schéma. Pas de documentation orpheline |

Les schémas sont en Mermaid, pour qu'ils s'affichent sur GitHub et se relisent dans un diff. Un schéma se dessine d'après le code qu'on vient de lire, jamais de mémoire : un schéma faux est pire qu'un schéma absent. Chaque section d'algorithme nomme ses fichiers et ses tests, pour qu'on puisse vérifier.

## Travailler sur une issue

Les prochaines étapes sont des issues du dépôt. Chacune se suffit à elle-même : contexte, travail à faire, règles, critères de fin.

**Avant.** Lire l'issue, puis [docs/decision-loop.md](docs/decision-loop.md) et les sections de [docs/algorithms.md](docs/algorithms.md) qu'elle touche. Lire le code avant de le décrire ou de le changer.

**Pendant.** Tests et documentation avancent avec le code, dans les mêmes commits.

**Après.** Pour que le contexte survive à la session :

1. Suites de tests vertes, déployé, vérifié en production.
2. Documentation et schémas à jour (table ci-dessus).
3. Un commentaire sur l'issue : ce qui a été fait, comment c'est vérifié, ce qui reste imparfait, les commits.
4. Les critères de fin cochés, puis l'issue fermée.
5. La table d'état de `docs/decision-loop.md` mise à jour.
6. Ce qui reste à faire devient une nouvelle issue, pas une phrase dans la conversation.

**Créer une issue.** Titre à l'impératif, en français. Corps : `Contexte` (fichiers nommés), `À faire` (numéroté), `Règles du produit`, `Critères de fin` (cases à cocher, dont « documentation et schémas à jour »). Ni nom de personne, ni chemin local, ni secret, ni identifiant de production.

## Déploiement et données

- Pousser sur `main` déploie : Vercel pour le frontend, Railway pour les services dont les fichiers ont changé. L'état se lit sur le commit, dans GitHub.
- L'API applique les migrations à son démarrage (`node scripts/migrate.mjs`). Une migration qui échoue empêche le service de démarrer.
- La base Postgres n'a pas d'adresse publique. On y accède depuis le conteneur de l'API. Son volume est la seule copie des données : on ne le supprime jamais.
- L'analyste a besoin de `ANTHROPIC_API_KEY` sur le service de l'API. Sans elle il est éteint et le dit ; rien d'autre n'en dépend.

## Pièges connus

- **Moteur.** L'occupation plafonne à 100 % : le débordement se lit dans la file (`waiting`), pas dans l'occupation. Les patients ne vont qu'aux sites liés à leur territoire, au prorata de la capacité, et personne n'est transféré sans politique.
- **Jumeau.** Les lectures de l'ontologie ont un plafond (`ROLLUP_INSTANCE_CAP`). Une lecture qui l'atteint le signale ; ne jamais remettre une limite en dur plus basse.
- **Deux organisations.** Un type d'objet se résout par organisation : deux projets de deux organisations ne voient rien l'un de l'autre.
- **Flux.** Une réponse en flux passe par `streamLines` (`backend/src/lib/ndjson.ts`), qui garde les en-têtes CORS. Prendre la main sur le socket les perd.
- **Poste Windows.** Dans Git Bash, un heredoc perd la moitié des barres obliques inverses. Écrire les fichiers avec l'outil d'écriture, pas par heredoc.
