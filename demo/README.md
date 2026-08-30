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

Filtrés sur la région et sur la période, colonnes telles que publiées. **Aucune
valeur n'est recalculée.** Deux fichiers ont subi une correction de forme, et
elles sont nommées ici plutôt que passées sous silence : le fichier des
capacités est publié en Windows-1252 et a été réencodé en UTF-8 ; la colonne de
dates du fichier Rt était écrite en `AAAA-JJ-MM` et a été réécrite en ISO
`AAAA-MM-JJ` (voir plus bas). Dans les deux cas les valeurs elles-mêmes sont
intactes.

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

**Les dates du Rt étaient inversées.** Le fichier arrivait avec le jour et le
mois permutés : `2020-01-07` n'était pas le 7 janvier mais le 1er juillet. Six
cent quarante-cinq lignes sur 1074 portaient un mois entre 13 et 31, donc une
date qui n'existe pas ; les 429 autres passaient inaperçues parce qu'un jour
inférieur à 13 se lit dans les deux sens. C'est la forme la plus dangereuse
d'une erreur de date : elle ne fait rien tomber, elle décale.

La permutation a été corrigée, et non devinée. Réinterprétées en `AAAA-JJ-MM`,
les 1074 lignes donnent 1074 dates valides et distinctes, du 1er juillet 2020
au 9 juin 2023, soit exactement 1074 jours : une série quotidienne sans un seul
trou ni doublon. Et la correspondance tient contre l'extérieur — le Rt maximal
tombe le 13 décembre 2021, le décollage d'Omicron au Québec, avec 1,84 de
moyenne sur décembre 2021, 0,91 en juin 2021 après la vaccination et 0,87 en
février 2022 après le pic. Aucune valeur de Rt n'a été touchée : seules les
dates ont été réécrites, et les lignes retriées, l'ordre d'origine ayant suivi
la chaîne cassée.

Les neuf autres fichiers de l'INSPQ ont été vérifiés colonne par colonne : ils
sont en `AAAA-MM-JJ` et n'ont rien eu à corriger.

**Une réserve sur les éclosions.** C'est la donnée québécoise la plus proche
d'une structure de contacts par milieu, et c'est pour ça qu'elle est là. Mais des
éclosions ne sont pas des contacts : elles suivent aussi l'intensité du dépistage
et les règles de déclaration. Elles disent où le virus a été *trouvé*, pas où il
a circulé.

**Une réserve sur la corrélation, et ce qu'il a fallu pour la lever.** Deux
courbes qui montent puis descendent corrèlent fortement, que le modèle soit juste
ou non. Mesuré sur la seule vague Omicron, ces fichiers semblaient dire : décès
7 jours après les hospitalisations, positivité 2 jours avant. **Aucune de ces
deux affirmations ne tenait** — 52 jours de courbe lisse ne portent que cinq
observations indépendantes, et un r de 0,895 sur cinq observations n'est rien.

La série complète va du 2020-01-23 au 2023-01-01 et contient **dix vagues** :
avril 2020, octobre 2020, janvier 2021, avril 2021, septembre 2021, janvier 2022,
avril 2022, juillet 2022, octobre 2022, novembre 2022. Chacune est un épisode
distinct, avec son variant, sa saison et son régime de dépistage. Le décalage a
donc été cherché **dans chaque vague séparément**, et ce qui compte est l'accord
entre elles — pas la force d'une seule.

| Signal | décalage médian | mesuré sur | vagues à ±2 j | verdict |
|---|---|---|---|---|
| Décès | **−7 j** (suivent) | 10/10 | 50 % | structure réelle, sous la barre |
| Positivité | +3,5 j | 10/10 | 40 % | non |
| Soins intensifs | −0,5 j | 10/10 | 30 % | non |
| Cas déclarés | −6 j | 10/10 | 20 % | non |

**Le décalage mortalité–hospitalisation est le seul à montrer une vraie
structure** : huit vagues sur dix le placent entre −4 et −12 jours, groupées
autour de −7. C'est cohérent avec la littérature, et cette fois ça repose sur dix
épidémies indépendantes plutôt que sur une.

Il ne franchit quand même pas la barre fixée (70 % des vagues à ±2 jours).
Élargir la tolérance à ±4 jours le ferait passer à 70 % — **et ce serait
exactement la faute que ce module existe pour empêcher.** On choisit sa tolérance
avant de regarder le résultat, sinon on ne mesure plus rien, on négocie.

Les trois autres signaux sont du bruit : la positivité saute de −14 à +12 selon
la vague, ce qui est la signature d'un décalage qui n'est pas identifié du tout.

## Eaux usées — ce que trois vagues permettent de dire

`phac-eaux-usees-montreal.csv` et `phac-bassins-collecte-montreal.csv` viennent de
l'[Enquête canadienne sur les eaux usées](https://open.canada.ca/data/fr/dataset/f9e0d3ad-223c-490a-ac36-f918b42b823f)
(ASPC / Statistique Canada). Deux intercepteurs montréalais, 528 mesures sur
89 jours d'échantillonnage, du 2021-04-02 au 2022-01-30. Les bassins portent leur
propre population — Nord 1 018 516, Sud 1 033 404 — donc la pondération ne se
devine pas.

Le programme *québécois* de l'INSPQ couvre une fenêtre plus longue mais **n'a pas
de CSV ouvert** : il n'existe que dans un tableau de bord.

Trois vagues sont couvertes : avril 2021, septembre 2021, et Omicron avec son pic.

| Traitement | avance | r | n | n effectif | survit |
|---|---|---|---|---|---|
| Concentration brute | 21 j | **−0,108** | 89 | 17 | non |
| Log, aberrants retirés | **7 j** | **0,694** | 84 | 16 | non |

**Le signal est réel.** La ligne de base tourne autour de 0,0001 tout l'été 2021 ;
elle passe à 0,0044 le 23 décembre, quand les admissions montent de 7 à 40. Un
facteur vingt, au bon moment.

**Pourquoi le log.** Une charge virale est log-normale et court sur trois ordres
de grandeur. Sur l'échelle brute, une corrélation de Pearson est décidée presque
entièrement par la journée la plus haute — et un seul mauvais échantillon, comme
le 2021-05-20 à cent fois la ligne de base, renverse le signe d'une vague
entière. Sur l'échelle log, un doublement compte pareil en bas et en haut.

**Divulgation honnête :** ce changement a été fait *après* avoir vu le résultat
brut nul. Sa justification tient sans lui — c'est la pratique courante du domaine
et ça découle de la nature de la mesure, pas du résultat — mais vous devez le
savoir pour en juger.

**Ce que ça ne dit pas.** L'avance de 7 jours ne franchit pas la barre : 84 points
ne portent que 16 observations indépendantes, contre 43 combinaisons essayées. Et
la réplication vague par vague **échoue** — les fenêtres de 61 jours ne
contiennent que 8 à 20 échantillons chacune, et le décalage trouvé se colle au
bord de la recherche, ce qui est la signature d'un décalage non identifié.

Autrement dit : l'avance d'environ une semaine est cohérente avec la littérature
et apparaît dans ces données, **mais ces trois vagues ne suffisent pas à
l'établir**. Il faudrait la fenêtre québécoise complète — qui n'est pas ouverte.

## Rejouer le montage

`provision.cjs` monte le projet **Montréal — données ouvertes** entièrement par
le chemin Data → pipeline → ontologie : rien n'est écrit droit dans l'ontologie,
et rien n'est remodelé dans un tableur avant l'import. Le registre publie des
comptes de lits ; le nœud « déplier » en fait des unités sur le canevas, où le
remodelage est visible et rejoue quand le registre change.

Le script est idempotent — chaque écriture est un upsert sur les identifiants du
gouvernement.
