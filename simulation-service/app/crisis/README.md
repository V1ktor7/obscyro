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

## Ce qui n'est pas fait

- **Aucun optimiseur.** `evaluate(system, scenario, policy, objective, seed)` est
  la signature qu'il appellera ; la boucle de recherche viendra après.
- **Aucune persistance, aucune interface.** Tout en mémoire, comme spécifié.
- **Le mode de validation historique** — rejouer un événement réel et comparer à
  des données de terrain — reste à écrire.
- **Rien ne lit l'ontologie.** Le monde de référence est construit à la main dans
  `examples/system.py`. Le pont vers le jumeau réel (Institution, OrgUnit, Bed,
  et les métriques déjà calculées) est le raccordement évident, et il n'existe
  pas encore.
