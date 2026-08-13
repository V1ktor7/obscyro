# La couche crise

Un gouvernement décrit son système de santé, lui envoie une crise, choisit une
politique de réponse, et obtient une trajectoire notée : morts évitables, soins
non rendus, ressources épuisées, coût. Puis il change la politique et
recommence.

L'exigence qui commande tout : **la même machine doit modéliser une pandémie,
une inondation, une cyberattaque et une grève** — sans qu'aucune ne soit un cas
particulier dans le code.

## Comment la versatilité tient

Une crise n'est pas modélisée par ce qu'elle *est*, mais par ses **effets sur
trois primitives** :

| verbe | ce que ça décrit |
|---|---|
| `DemandPerturbation` | la demande monte quelque part |
| `CapacityPerturbation` | une ressource baisse quelque part |
| `ConnectivityPerturbation` | une liaison se rompt quelque part |

Une pandémie, c'est demande ↑ + personnel ↓ + matériel ↓. Une inondation, c'est
espace = 0 à un nœud + pic de demande + routes coupées. Une cyberattaque, c'est
`systems` ↓ et rien d'autre — tout le reste passe par la cascade.

Les trois sont dans `examples/scenarios.py`, en données pures. **Ajouter une
crise n'exige aucune modification du moteur.**

## Les quatre couches

```
domain.py     le monde de référence — établissements, ressources, populations, réseau
events.py     la crise — un paquet de perturbations typées. N'exécute rien.
policy.py     la réponse — des règles déclaratives, inspectables. N'exécute rien.
dynamics.py   l'exécutif — possède l'horloge, applique tout, écrit la trace
```

Plus `scoring.py` (trajectoire → score) et `harness.py` (comparer des
politiques).

**Le principe qui décide de tout** : les politiques sont **déclarées** comme des
données et **exécutées** procéduralement. Ne pas essayer de faire tourner la
simulation dans un raisonneur OWL — il est sans état, monotone, et faible en
arithmétique et en temps, c'est-à-dire exactement ce dont une simulation a
besoin. L'ontologie dit ce qu'*est* une politique ; le moteur la fait tourner.

## Écrire une nouvelle ressource, crise ou politique

**Une ressource** — n'importe quoi qui contraint les soins. Le moteur ne connaît
aucun nom :

```python
Resource(id="oxygene", category="stuff", quantity=5, capacity=5,
         enables=frozenset({"apport_oxygene"}))
```

Puis un besoin de soin qui la consomme. Aucune ligne de moteur à toucher — c'est
`test_new_resource_type_needs_no_engine_change`.

**Une crise** — un `Scenario` avec des perturbations. Voir `examples/scenarios.py`.

**Une politique** — des `Rule` ordonnées par priorité :

```python
Rule(id="urgence-pleine",
     condition=Condition(compare=Comparison(
         left=Metric(fn="occupancy_ratio", facility="north", activity="icu_bed"),
         op=">", right=0.9)),
     action=Action(kind="transfer", source="north", target="south", amount=6,
                   friction=Friction(delay=0, cost=500, effectiveness=0.9)))
```

**Une action ou un objectif** — via le registre (`@register_action`,
`@register_objective`), jamais en éditant l'exécutif.

## Deux pièges trouvés au premier lancement

**Lire l'occupation d'une catégorie ment.** Dix lits de soins intensifs parmi
soixante lits ordinaires : les soins intensifs sont pleins, quarante patients
critiques sont refusés, et l'établissement affiche **44 %**. Les politiques
d'exemple étaient écrites sur la catégorie et **n'ont jamais déclenché**.
Utiliser `activity=` — la catégorie n'a de sens que pour un total.

**Un bâtiment détruit affiche 0 % d'occupation**, comme un bâtiment vide. Une
règle qui doit distinguer les deux lit `capacity`, pas l'occupation. La clinique
inondée retenait cent patients bloqués pendant qu'une règle d'occupation voyait
un immeuble tranquille.

## Déterminisme

Un seul générateur aléatoire traverse toute l'exécution. Même
`(système, crise, politique, graine)` → même trajectoire, toujours. Sans ça, une
boucle d'optimisation optimise la graine et non la politique.

Là où le modèle est stochastique, utiliser `replicate()` et comparer des
distributions — jamais une trajectoire unique.

## Lancer

```bash
cd simulation-service
PYTHONPATH=. python -m pytest tests/test_crisis.py -q
```

Comparer trois politiques sur les trois crises :

```python
from app.crisis.examples.system import toy_system
from app.crisis.examples.scenarios import ALL as SC
from app.crisis.examples.policies import ALL as PO
from app.crisis.harness import compare, format_table
from app.crisis.scoring import Objective

obj = Objective(weights={"excess_deaths": 1.0, "response_cost": 0.000002})
pols = [PO["null"](), PO["load-balance"](), PO["surge-and-balance"]()]
print(format_table(compare(toy_system(), SC["flood"](), pols, obj)))
```

## Branché sur l'ontologie

`examples/system.py` invente trois établissements. Le vrai monde de référence
vient maintenant du jumeau :

```
GET  /v1/ontology/:env/twin/crisis-export     le jumeau, tel que le moteur le lit
POST /v1/ontology/:env/twin/crisis-compare    lance, renvoie une ligne par réponse
POST /crisis/compare                          le même, côté Python
```

Le backend fait la traduction, parce que c'est lui qui possède déjà les règles.
**Rien n'est reconnu par son nom** : ce qui devient une capacité, un patient ou
une route se lit sur les déclarations — `crisis_role` sur le type d'objet
(migration 045), `aggregates`/`transitive` sur le type de lien (migration 044).
Un hôpital qui appelle ses unités *pavillons* et son placement `héberge`
s'exporte à l'identique.

Ce qui traverse est une charge utile, pas une connexion. Le moteur reste une
fonction pure de son entrée, et les deux moitiés se testent séparément.

### Ce que l'ontologie ne peut pas fournir

| manquant | pourquoi | où ça se règle |
|---|---|---|
| population desservie | aucune aire de desserte dans le jumeau | sur le lancement |
| débit d'une route | un lien ne porte pas de capacité | sur le lancement |
| modèle de soins | ce qu'une admission consomme, et qui meurt quand on la refuse | dans la crise |

Les trois sont **refusés plutôt que devinés** (`UnrunnableExport`). Chacun
produit sinon un résultat parfaitement lisible et faux : un réseau sans capacité
ne refuse personne, ne tue personne, et classe toutes les réponses à égalité.

### Composer un événement

Trois crises en conserve, c'est une démonstration. `POST /crisis/compare` accepte
désormais **soit** `scenario` (un nom de gabarit) **soit** `event` (un événement
écrit à la main), et exactement l'un des deux — les envoyer tous les deux
laisserait à l'endpoint le soin de deviner. Les événements composés sont
persistés côté plateforme (`app.crisis_event`, migration 046) et se rédigent
dans l'écran Résilience.

Deux corrections rendaient cela possible :

**La demande peut baisser.** `volume` était un `NonNegativeFloat`, donc les
seuls événements exprimables étaient ceux qui aggravent. Une campagne de
vaccination, un dépistage, un déclin démographique n'avaient nulle part où
s'écrire — sinon déguisés en *politique*, ce qu'ils ne sont pas : ce sont des
faits sur le monde, et ils apparaissaient alors dans le coût de réponse. Le net
par (population, gravité) est borné à zéro : on ne peut pas prévenir plus de cas
qu'il n'en serait arrivé, et aucune file ne devient négative.

**Les effets sont discriminés sur `kind`.** Les trois partagent assez de champs
pour qu'un effet composé à la main arrive sur le mauvais modèle. Un effet de
capacité lu comme de la connectivité ne s'applique à rien du tout, et la
simulation a simplement l'air paisible.

Et un garde-fou : un effet qui vise un établissement, une population ou une
route absente du jumeau est **refusé** (422). C'est la sortie la plus dangereuse
que ce service puisse produire, parce qu'un effet inerte est indiscernable de la
résilience. Les gabarits ne peuvent pas déclencher ce refus — ils génèrent leurs
cibles depuis l'état.

### Les scénarios s'adaptent au système

Un vrai jumeau nomme ses unités avec des UUID, donc `examples/scenarios.py` ne
peut pas être pointé dessus. `templates.py` prend un `SystemState` et rend un
`Scenario` ou une `Policy` ajustés aux identifiants réellement présents —
volume calibré sur la capacité totale, une règle de transfert par route
existante, un renfort par ressource. Le moteur n'est pas touché : ce qui sort
est la même donnée pure qu'avant.

## Trois défauts trouvés au premier branchement sur un vrai jumeau

**Les morts ne quittaient pas la file.** Un patient non pris en charge mourait
0,15 fois par tick et restait dans la file — donc remourait au tick suivant,
indéfiniment. Le bilan n'était borné que par l'horizon, la file devenait une
dette qu'aucune réponse ne pouvait rembourser, et **les trois politiques
tombaient à 0,1 % les unes des autres**. Les chiffres publiés avant ce correctif
(965 morts en pandémie, etc.) étaient gonflés.

**Le transfert prenait la file la plus longue, pas la plus grave.** Il envoyait
donc des cas de routine sur la seule route disponible ; ils prenaient les lits à
l'arrivée, et les cas critiques qu'ils déplaçaient mouraient. La politique
notait *moins bien* que ne rien faire, pendant que sa trace montrait une règle
qui se déclenche et des patients qui bougent.

**Le renfort visait la contrainte du premier jour.** Une unité à court
d'infirmières qui devenait à court de lits continuait d'embaucher : 1,2 M
dépensé, aucun patient de plus, cinquante-cinq déclenchements dans une trace
d'apparence saine. Chaque ressource surveille maintenant sa propre rareté.

## Ce qui n'est pas fait

- **Aucun optimiseur.** `evaluate(system, scenario, policy, objective, seed)` est
  la signature qu'il appellera ; la boucle de recherche viendra après.
- **Les réponses ne se composent pas.** Un événement s'écrit maintenant depuis
  l'application ; une politique reste trois gabarits Python. Le registre
  d'actions du moteur — `transfer`, `surge_resource`, `reallocate`,
  `modify_demand` — n'a par ailleurs aucun rapport avec la plateforme, donc une
  politique validée en simulation ne peut pas être exécutée pour de vrai.
- **Aucun objectif ne mesure un gain.** Morts, soins non rendus, pénurie de
  pointe, coût. Le registre est ouvert, mais rien de livré ne compte les
  personnes soignées — ce qui rend l'outil myope à l'ouverture d'une aile, que
  les effets savent pourtant décrire.
- **Aucune persistance, aucune interface.** Tout en mémoire, comme spécifié.
- **Le mode de validation historique** — rejouer un événement réel et comparer à
  des données de terrain — reste à écrire.
- **Le service n'est pas déployé.** Le pont existe des deux côtés, mais tant que
  `SIM_SERVICE_URL` ne pointe pas sur une instance de ce service,
  `/twin/crisis-compare` répond 503. L'export, lui, marche sans lui.
- **Un seul modèle de soins pour tout le réseau.** Une exigence globale ne peut
  demander que ce que *chaque* établissement possède, sinon celui qui n'a pas
  d'infirmière déclarée ne peut soigner personne. Tant que le modèle n'est pas
  par établissement, un réseau hétérogène est décrit par son plus petit
  dénominateur — et un manque de soins intensifs reste sous-évalué.
