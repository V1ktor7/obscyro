# Documentation d'Obscyro

| Document | Ce qu'on y trouve |
|---|---|
| [decision-loop.md](decision-loop.md) | La boucle d'aide à la décision : ses sept étapes, ses règles, où elle en est, ce qui vient ensuite |
| [analyst.md](analyst.md) | L'analyste de la page Scenarios : ses quatre onglets (questions, recherche d'événements en ligne, options testées, décisions), ses outils, la règle des chiffres, ses routes, comment lui ajouter un outil |
| [scenarios-page.md](scenarios-page.md) | La page Scenarios : ses panneaux et le guide en trois étapes |
| [algorithms.md](algorithms.md) | Tous les algorithmes du produit, chacun avec son schéma, ses règles, ses fichiers et ses tests |

Ailleurs dans le dépôt :

| Document | Ce qu'on y trouve |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | Les consignes de travail : conventions, règles du produit, règle de documentation, déroulé d'une issue |
| [../simulation-service/app/events/README.md](../simulation-service/app/events/README.md) | Le moteur d'événements en détail : catalogue des quantités, couches, pièges |
| [../simulation-service/README.md](../simulation-service/README.md) | Le service de simulation : lancer, tester, modèles lourds |
| [../nlp-service/README.md](../nlp-service/README.md) | Le service d'extraction clinique |
| [../backend/DEPLOY.md](../backend/DEPLOY.md) | Le déploiement de l'API et ses variables d'environnement |
| [../design/PALETTE.md](../design/PALETTE.md) | Le thème du Studio : les rôles de couleur, où ils se règlent, les rampes des cartes |
| [../design/](../design/) | Notes et maquettes de conception |

## La règle

Chaque ajout, modification ou suppression met à jour la documentation dans le même commit. Un algorithme qui change, c'est aussi sa section et son schéma dans [algorithms.md](algorithms.md). Le détail est dans [CLAUDE.md](../CLAUDE.md).

Les schémas sont en Mermaid : GitHub les dessine, et ils se relisent dans un diff.
