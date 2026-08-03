# Le parcours complet

Une donnée entre, devient un objet, fait bouger le jumeau, franchit un seuil,
lève un signal, traverse un flux de travail. Six étapes, aucune n'a jamais été
parcourue d'affilée.

Le but n'est **pas** de vérifier que ça marche. C'est de noter chaque endroit où
ça bloque. « Ce serait mieux si » ne compte pas — seulement « je ne peux pas
continuer ».

Compte 30 à 45 minutes. Environnement : `chum-operations`.

---

## Avant de commencer — deux cassures déjà connues

Je les ai trouvées en préparant ce parcours, pour que tu ne perdes pas de temps
à les redécouvrir :

1. **Il n'existe aucune interface pour créer une règle d'alerte.** La route
   existe côté serveur, rien ne l'appelle côté client. L'étape 4 se fait donc en
   ligne de commande. C'est la première chose à construire si tu veux montrer
   cette chaîne à quelqu'un.
2. **Ton total contient des restes de test.** `LAB_TEST` à 839 et
   `PATIENT_TWIN_TEST` à 100, vieux de 95 heures. Ils ne cassent rien, mais si
   quelqu'un demande « c'est quoi ces 1178 instances », tu dois pouvoir
   répondre.

---

## Étape 1 — La donnée entre

**Data › Upload CSV**, prends `1-lits-urgence.csv`.

24 lits d'une urgence, dont 23 occupés. Les colonnes sont `bed_code`, `ward`,
`status`, `beds_label`.

> À noter : le nom du jeu de données créé, et si le compte de lignes affiché
> est bien 24.

## Étape 2 — Elle devient des objets

**Builder** › nouveau pipeline.

- Un nœud **dataset_input** sur le jeu que tu viens de créer.
- Un nœud **object_output** relié derrière, configuré ainsi :
  - type d'objet : `Bed`
  - propriétés d'identité : `bed_code` — **c'est obligatoire**, sans ça chaque
    exécution duplique les lignes au lieu de les mettre à jour
  - règle de lien : type `located_in`, type cible `OrgUnit`, colonne source
    `ward`, propriété cible `name`

Cette règle de lien est ce qui rattache les lits à une unité. Elle cherche un
`OrgUnit` dont la propriété `name` vaut `Urgence Notre-Dame`.

> **Si cette unité n'existe pas, les lits seront créés sans lien et le jumeau
> ne les verra jamais.** Vérifie d'abord dans Ontology › Instances qu'un
> `OrgUnit` porte ce nom exact, ou crée-le. C'est le piège le plus probable de
> tout ce parcours.

Exécute le pipeline.

> À noter : combien d'objets écrits, combien de liens créés, et si un message
> d'erreur apparaît.

## Étape 3 — Le jumeau bouge

**Twin › Network**, métrique d'affichage **Occupancy**.

Tu devrais voir l'unité `Urgence Notre-Dame` à environ **96 %** (23 sur 24), et
l'occupation de son hôpital parent bouger en conséquence.

> À noter : le pourcentage de l'unité, celui du parent, et si le parent te
> paraît juste connaissant le nombre réel de lits. **C'est le chiffre qui a
> changé aujourd'hui** — il était calculé comme une moyenne de moyennes.

## Étape 4 — Le seuil est franchi

Il n'y a pas d'interface. Depuis un terminal, avec ta clé d'API :

```bash
curl -X POST "https://<ton-api>/v1/ontology/chum-operations/twin/alert-rules" -H "Authorization: Bearer <ta-clé>" -H "Content-Type: application/json" -d '{"metric":"occupancy","op":">=","threshold":90,"severity":"critical","messageTemplate":"Occupation critique à {unit} — {value}%","recommendationTemplate":"Envisager un détournement"}'
```

Le champ `metric` doit valoir la **clé** d'une de tes métriques, pas son
libellé. `occupancy` est celle qui a été amorcée. L'évaluation tourne au
prochain calcul du jumeau.

> À noter : la règle est-elle acceptée, et l'alerte apparaît-elle sur l'unité
> dans le panneau de droite du jumeau.

## Étape 5 — L'alerte devient un signal

Le pont tourne **toutes les 15 secondes**. Il ne lève un signal que si un type
de signal porte `alertMetric = "occupancy"`.

Va dans **Response**. Si le tableau est vide, installe le jeu de départ — il
crée les flux et les types de signaux, dont un branché sur l'occupation.

Attends une minute, puis rafraîchis.

> À noter : un signal apparaît-il tout seul, dans quel domaine, à quelle étape,
> et porte-t-il la mention « levé automatiquement ».

## Étape 6 — Le signal traverse le flux

Ouvre le signal. Fais-le avancer d'une étape, puis regarde son **journal de
décision**.

> À noter : le journal enregistre-t-il ton passage, avec ton nom. C'est ce
> journal qui est l'argument de vente auprès d'un établissement — pas la carte.

## Étape 7 — La crise se résorbe

Reprends l'étape 1 avec `2-lits-urgence-apres.csv` : mêmes 24 lits, 12 occupés.
Réexécute le pipeline.

L'occupation doit retomber à 50 %, l'alerte se refermer, et le signal — selon
ce que fait le pont — se clore ou rester ouvert en attente d'une décision
humaine.

> À noter : que devient le signal quand la condition disparaît. C'est une vraie
> question de conception, pas seulement un test : un signal qui se ferme tout
> seul efface la trace de l'incident.

---

## Ce que je veux en retour

La liste des blocages, dans l'ordre où tu les as rencontrés. Rien d'autre. Pas
de propositions d'amélioration — on décidera après, ensemble, lesquelles sont
sur le chemin.
