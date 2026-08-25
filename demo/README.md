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

## Séries d'observation — pour comparer, pas pour alimenter

Ces neuf-là ne deviennent aucun objet et n'alimentent aucune mécanique. Elles
existent pour être posées sur une course et répondre à la seule question qu'un
modèle ne peut pas se poser à lui-même : *a-t-il reproduit ce qui est arrivé.*

| Jeu | Portée | Ce qu'il sert à demander |
|---|---|---|
| Admissions aux soins intensifs | région 06 | la seconde sévérité de la même vague |
| Décès cumulatifs | région 06 | le décalage mortalité–hospitalisation |
| Cas et tests cumulatifs | région 06 | ce que le dépistage a vu, et quand il a saturé |
| Taux de positivité | région 06 | indicateur avancé ; décembre 2021 en particulier |
| Doses administrées par jour | région 06 | la contre-mesure, dans le temps |
| Taux de reproduction Rt | Québec | le régime de croissance estimé par l'INSPQ |
| Éclosions actives par milieu | Québec | travail, primaire, secondaire, cégep, université, garderie, soins |
| Part des variants par semaine | Québec | les changements de régime qu'un modèle ne voit pas venir |
| Cas selon le statut vaccinal et l'âge | Québec | l'effet de la vaccination, par âge |

**Une réserve sur les éclosions.** C'est la donnée québécoise la plus proche
d'une structure de contacts par milieu, et c'est pour ça qu'elle est là. Mais des
éclosions ne sont pas des contacts : elles suivent aussi l'intensité du dépistage
et les règles de déclaration. Elles disent où le virus a été *trouvé*, pas où il
a circulé.

**Une réserve sur la corrélation, et elle est plus grave que prévu.** Deux
courbes qui montent puis descendent corrèlent fortement, que le modèle soit juste
ou non. Mesuré d'abord par simple écart des pics, ces fichiers semblaient dire :
décès 7 jours après les hospitalisations, positivité 2 jours avant.

**Aucune de ces deux affirmations ne survit à un examen honnête.** Passées au
balayage de décalages avec correction de la taille effective :

| Signal | r apparent | jours | observations indépendantes | survit | sur la période de validation |
|---|---|---|---|---|---|
| Positivité | 0,895 | 10 | **5** sur 52 | non | 0,573 |
| Soins intensifs | 0,802 | 0 | **18** sur 62 | non | 0,490 |
| Décès | 0,888 | −10 | **6** sur 52 | non | 0,491 |

La raison : une courbe épidémique est lisse. Le compte d'aujourd'hui est presque
celui d'hier, donc 52 jours ne portent pas 52 observations indépendantes mais
cinq. Un r de 0,895 sur cinq observations n'est pas un résultat. Et le décalage
trouvé change selon la fenêtre — 2 jours ou 10 selon qu'on regarde tout ou les
premiers 70 % — ce qui est en soi le signe qu'il n'est pas déterminé.

**Ce qu'il faut en conclure :** une seule vague ne permet pas d'établir un délai
d'avance. Il en faut plusieurs, ou plusieurs territoires. Le décalage
mortalité–hospitalisation est probablement réel — la littérature le dit — mais
*ces fichiers-là ne le démontrent pas*, et c'est une chose différente.

## Rejouer le montage

`provision.cjs` monte le projet **Montréal — données ouvertes** entièrement par
le chemin Data → pipeline → ontologie : rien n'est écrit droit dans l'ontologie,
et rien n'est remodelé dans un tableur avant l'import. Le registre publie des
comptes de lits ; le nœud « déplier » en fait des unités sur le canevas, où le
remodelage est visible et rejoue quand le registre change.

Le script est idempotent — chaque écriture est un upsert sur les identifiants du
gouvernement.
