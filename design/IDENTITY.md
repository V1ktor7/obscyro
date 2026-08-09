# L'identité

## Le problème

Rien ne disait ce qui identifie une instance. `upsertInstanceByIdentity`
recevait les clés **en paramètre**, depuis la configuration du canal ou du
pipeline qui écrivait, et `insertObjectInstance` n'en recevait aucune. Deux
pipelines pouvaient donc être en désaccord sur ce qui nomme un lit, et rien
n'empêchait un troisième chemin d'écriture de créer un doublon en silence.

`findInstanceIdByKey` le détectait — il rend `ambiguous` quand deux instances
répondent — mais constater l'ambiguïté après coup n'est pas la prévenir. Une
vue qui agrège par site répond alors faux, de façon plausible, sans rien
signaler.

## Ce qui a changé

L'identité est déclarée **sur le type**, et **la base la fait respecter**.

- `ontology_object_types.identity_properties` : les propriétés qui identifient.
  Vide par défaut, donc aucun type existant ne change de comportement.
- `app.instance_identity` : une table d'appoint dont la clé primaire est
  `(type, clé)`. C'est elle qui porte la contrainte.
- Un déclencheur la tient à jour à chaque insertion ou modification.

Trois décisions qui méritent d'être dites.

**La contrainte est dans la base, pas dans le code.** Une vérification
applicative perd la course entre deux insertions concurrentes, et il y a quatre
chemins d'écriture. Un déclencheur tient quel que soit celui qui écrit — y
compris celui que quelqu'un ajoutera l'an prochain sans lire ce fichier.

**La clé est un tableau JSON, pas une concaténation.** Avec un séparateur,
`('a|b', 'c')` et `('a', 'b|c')` deviennent la même clé, et deux objets
distincts fusionnent à cause d'un caractère mal choisi.

**Les valeurs sont normalisées** — `lower(btrim(v))`. « HND-01 » et « hnd-01 »
désignent le même lit pour tout lecteur humain, et un code recopié à la main
arrive avec une casse et des espaces au hasard. La même règle est écrite deux
fois, en plpgsql pour le déclencheur et en TypeScript pour le chemin
d'écriture ; `identity.unit.test.ts` existe pour épingler cette couture, parce
que si les deux divergent l'application ne trouve rien, insère, et se fait
refuser par sa propre contrainte.

## Déclarer une identité peut être refusé, et c'est le but

`PUT /ontology/:env/types/:name/identity` refuse plutôt que d'appliquer à
moitié :

- des instances partagent déjà ces valeurs → la réponse **les liste** ;
- des instances n'ont pas la propriété → refus, parce qu'un objet sans elle ne
  pourrait plus jamais être écrit.

`POST …/identity/check` répond la même chose sans rien modifier, pour qu'une
interface puisse montrer le mur avant qu'on s'y jette.

## L'état réel, mesuré le 9 août 2026

| type | propriété | avec valeur | sans valeur | doublons |
|---|---|---|---|---|
| **Institution** | **`name`** | 9 | 0 | **0** |
| Bed | `bed_code` | 24 | **126** | 0 |
| Bed | `label` | 150 | 0 | 34 |
| OrgUnit | `code` | 29 | 0 | 8 |
| OrgUnit | `name` | 29 | 0 | 7 |
| Patient | `external_id` | 31 | 32 | 27 |
| Patient | `label` | 59 | 4 | 28 |

**Un seul type est prêt aujourd'hui : `Institution` sur `name`.**

`Bed` sur `bed_code` n'a aucun doublon — mais 126 lits sur 150 n'ont pas de
code. L'identité serait creuse, et toute écriture ultérieure sur ces 126 serait
refusée. Il faut d'abord leur donner un code, ou choisir une autre propriété.

Le reste porte de vrais doublons, à fusionner avant de pouvoir déclarer quoi que
ce soit.

## Ce que l'identité sur les types ne corrige pas

J'avais attribué à ce défaut les « deux Hôpital Notre-Dame » vus sur la carte.
Vérification faite, c'est autre chose :

| nom | instances | types |
|---|---|---|
| Hôpital Notre-Dame | **3** | Institution + OrgUnit |
| GMF Centre-Sud | 2 | Institution + OrgUnit |
| HCS Pharmacy | 1 | OrgUnit |

Le même lieu existe sous **deux types différents**. Une identité par type ne
peut rien contre ça — elle garantit qu'un `OrgUnit` ne se dédouble pas, pas
qu'un lieu n'apparaisse qu'une fois dans le produit.

Et ce n'est peut-être pas une erreur : `Institution` peut légitimement être le
site physique et `OrgUnit` l'unité organisationnelle qui s'y trouve, l'arbre du
jumeau étant bâti sur la seconde. Ce qui trompe, c'est la carte, qui les affiche
tous les deux comme des « sites » sans dire lequel est lequel.

Trois instances pour Notre-Dame reste suspect et mérite un coup d'œil.

**À décider, et ce n'est pas une décision technique :** un lieu est-il une
`Institution`, un `OrgUnit`, ou les deux liés ? Tant que la réponse n'est pas
écrite, la carte comptera des sites deux fois.
