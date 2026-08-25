# Fichiers de démonstration — provenance

Deux familles de fichiers vivent ici, et la différence entre elles est le
premier argument de la démonstration.

## Sources gouvernementales — vérifiables

| Fichier | Source | Ce qu'il porte |
|---|---|---|
| `msss-installations-montreal.csv` | [Fichiers cartographiques M02, MSSS, via Données Québec](https://www.donneesquebec.ca/recherche/dataset/fichiers-cartographiques-m02-des-installations-et-etablissements) | 312 installations de la région 06, coordonnées, RLS, missions |
| `msss-capacites-montreal.csv` | [Répartition des capacités au permis, MSSS, via Données Québec](https://www.donneesquebec.ca/recherche/dataset/m02-repartition-des-capacites-et-des-services-autorises-au-permis-par-installation) | dernier relevé mensuel, région 06 |
| `isq-population-montreal.csv` | [Estimations de population par territoire sociosanitaire, ISQ, via Données Québec](https://www.donneesquebec.ca/recherche/dataset/estimations-et-projections-de-population-comparables) | région 06 et ses 12 RLS, 2021 |
| `inspq-hospitalisations-montreal.csv` | INSPQ, `covid19-hist-archives` | admissions quotidiennes, région 06, déc. 2021 – févr. 2022 |

Filtrés sur la région et sur la période, colonnes telles que publiées. **Rien
n'est recalculé.** Le fichier des capacités est publié en Windows-1252 et a été
réencodé en UTF-8 sans que sa valeur change.

## Hypothèses — pas des sources

`hypotheses-soins-montreal.csv` porte la durée d'occupation d'un lit par une
hospitalisation. Aucun fichier de cet import ne la publie. Elle entre par le
même chemin que le reste, et son nom comme la description de son jeu de données
disent qu'elle est une hypothèse à ajuster.

Les deux fichiers `*-HYPOTHESE.csv` (contacts par milieu, paramètres de
transmission) servent au modèle de propagation, qui répond à des questions
contrefactuelles — « et si on avait fermé les écoles ». Ils sont conservés parce
que ces questions ont de la valeur, et étiquetés parce qu'aucun jeu de données
gouvernemental ne publie ces nombres.

## Ce que le partage en deux permet de dire

La vague Omicron montée depuis les admissions de l'INSPQ ne contient **aucun
paramètre inventé** : pas de R₀, pas de matrice de contacts, pas de fraction
hospitalisée. Le fichier dit combien de personnes ont été admises chaque jour,
et c'est le nombre d'arrivées. Le modèle de propagation, lui, est un modèle —
il sert à demander ce qui *aurait* pu se passer, ce qu'aucune donnée observée
ne peut dire.

## Rejouer le montage

`provision.cjs` monte le projet **Montréal — données ouvertes** entièrement par
le chemin Data → pipeline → ontologie : rien n'est écrit droit dans l'ontologie,
et rien n'est remodelé dans un tableur avant l'import. Le registre publie des
comptes de lits ; le nœud « déplier » en fait des unités sur le canevas, où le
remodelage est visible et rejoue quand le registre change.

Le script est idempotent — chaque écriture est un upsert sur les identifiants du
gouvernement.
