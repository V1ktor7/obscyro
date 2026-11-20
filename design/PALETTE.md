# Thème du Studio

Le Studio est dessiné en thème sombre : **IBM Carbon Gray 100**. Un fond presque
noir, des panneaux un cran plus clairs, un seul bleu, des coins carrés, et la
police IBM Plex. La couleur est gardée pour ce qu'elle veut dire.

Le site public (accueil, documentation, connexion) n'est pas concerné : il reste
clair, avec son propre système.

## Où ça se règle

| Quoi | Où |
|---|---|
| Les valeurs des couleurs | `frontend/app/globals.css`, bloc `.theme-g100` |
| Les noms que les écrans utilisent | `frontend/tailwind.config.ts`, `theme.extend.colors` |
| L'endroit où le thème est posé | `frontend/components/site/SiteChrome.tsx` : la classe `theme-g100` sur l'élément qui enveloppe toutes les pages `/studio` |
| Le fond de carte | `frontend/app/studio/map-style.ts` |

Changer une couleur du Studio, c'est changer une ligne dans `.theme-g100`. Aucun
écran n'est à toucher.

## La règle

**Un écran nomme un rôle, jamais une couleur.** On écrit `bg-surface`,
`text-ink-muted`, `border-line` ; on n'écrit ni `bg-white`, ni `text-gray-500`,
ni `text-[#8f99a8]`. Le thème dit à quoi ressemble le rôle.

Les valeurs sont gardées en trois nombres (`38 38 38`) et non en hex, pour qu'une
opacité reste possible : `bg-surface/95`, `border-danger/40`.

## Les rôles

| Rôle | Valeur sombre | Usage |
|---|---|---|
| `canvas` | `#161616` | le fond, derrière les panneaux |
| `surface` | `#262626` | panneaux, cartes, champs |
| `surface-hover` | `#333333` | une ligne ou un bouton discret sous le pointeur |
| `canvas-raised` | `#303030` | un bloc en relief dans un panneau, une carte d'option |
| `ink` | `#f4f4f4` | titres, texte principal |
| `ink-body` | `#e0e0e0` | texte courant |
| `ink-muted` | `#c6c6c6` | texte secondaire |
| `ink-faint` | `#a8a8a8` | étiquettes, métadonnées : le texte le plus pâle qui reste lisible |
| `ink-ghost` | `#6f6f6f` | désactivé, points inactifs. Jamais pour du texte à lire |
| `inverse` | `#161616` | le texte posé sur un aplat clair (`bg-ink`, `bg-danger`, `bg-warn`, `bg-ok`) |
| `line` | `#393939` | bordures de panneaux et de cartes |
| `line-soft` | `#333333` | séparateurs dans un panneau |
| `line-faint` | `#2c2c2c` | séparateurs de lignes |
| `line-strong` | `#525252` | une bordure qui doit se voir : un champ, une poignée, le fond d'une barre |
| `brand` | voir plus bas | l'accent |
| `brand-soft` | `#16305f` | lignes sélectionnées, pastilles actives |
| `brand-line` | `#2a4f8f` | la bordure de ce qui est posé sur `brand-soft` |
| `ok` / `ok-soft` / `ok-line` / `ok-ink` | `#42be65` · `#12301c` · `#1f5b33` · `#6fdc8c` | vérifié, calme |
| `warn` / `warn-soft` / `warn-line` / `warn-ink` | `#f1c21b` · `#33290a` · `#684e00` · `#fddc69` | à regarder ; une hypothèse |
| `danger` / `danger-soft` / `danger-line` / `danger-ink` | `#fa4d56` · `#3b1518` · `#75252b` · `#ffb3b8` | une file, un site au-dessus de sa capacité, une erreur |
| `scenario` / `scenario-soft` / `scenario-line` | `#be95ff` · `#2a1f45` · `#5a3fa0` | ce qui sort d'un modèle et non du réseau |
| `teal` / `teal-soft` | `#3ddbd9` · `#0b3233` | la capacité qu'une option ajoute ; « personne n'attend » |

Les variantes `-ink` existent parce que le ton moyen ne passe pas le contraste
sur son propre fond `-soft`. Sur un fond `-soft`, le texte est en `-ink`.

**`scenario` n'est pas une gravité.** Elle veut dire « tu ne regardes pas la
réalité », ce qui est un autre axe que « c'est grave ».

### Le bleu a trois valeurs

Sur un fond sombre, un seul bleu ne peut pas tout faire. La classe reste `brand`
partout ; ce qu'elle donne dépend de ce qu'on peint :

| On écrit | On obtient | Pourquoi |
|---|---|---|
| `bg-brand` | `#0f62fe` | un bouton plein : le texte blanc doit rester lisible dessus |
| `hover:bg-brand-deep` | `#0353e9` | le même bouton sous le pointeur |
| `text-brand` | `#78a9ff` | un lien : c'est du texte sur un panneau sombre |
| `text-brand-deep` | `#a6c8ff` | du texte sur `brand-soft` |
| `border-brand`, `ring-brand`, `accent-brand` | `#4589ff` | un contour d'un pixel, une case cochée |

C'est réglé dans `tailwind.config.ts` (`brandText`, `brandEdge`).

### Texte sur un aplat

| Aplat | Texte |
|---|---|
| `bg-brand`, `bg-scenario` | `text-white` |
| `bg-ink`, `bg-danger`, `bg-warn`, `bg-ok`, `bg-teal` | `text-inverse` |

Du blanc sur du rouge vif ou du jaune ne se lit pas.

## Les formes et la police

- **Coins carrés.** `rounded`, `rounded-md`, `rounded-lg`… donnent zéro dans le
  Studio : chaque rayon lit une variable que le thème met à zéro.
  `rounded-full` n'est pas touché : un point et une pastille restent ronds.
- **IBM Plex Sans** pour tout, **IBM Plex Mono** pour le code et les
  identifiants d'étape. Les grands chiffres sont en graisse 300.
- **Le focus** est un contour blanc de deux pixels, à l'intérieur du contrôle.

## Les motifs

```
carte      border border-line bg-surface p-3
panneau    border border-line bg-surface
sur carte  OverlayPanel (map-overlay.tsx) : bg-surface/95, flou derrière
en-tête    border-b border-line px-3 py-2
titre      text-xs font-semibold text-ink
méta       text-[10px] text-ink-faint
étiquette  text-[10px] font-semibold uppercase tracking-wide text-ink-faint
sélection  border-brand bg-brand-soft text-brand-deep
bouton     bg-brand text-white hover:bg-brand-deep
bouton 2   border border-line-strong bg-surface text-ink hover:bg-surface-hover
bandeau    bg-ok-soft text-ok-ink · bg-warn-soft text-warn-ink · bg-danger-soft text-danger-ink
voile      bg-black/60 (derrière une fenêtre)
```

## La navigation

Un rail d'icônes à gauche pour les sections. Les pages d'une section sont une
rangée d'onglets au-dessus de la page, pour que la page garde toute la largeur :
sur une page carte, une colonne de liens prendrait un cinquième de l'écran.
Une section qui a plus de huit pages (Ontology) garde une liste sur le côté : une
rangée qui défile cache les pages au-delà de son bord. Code :
`frontend/app/studio/PlatformRail.tsx`.

Une page ne répète pas ces onglets. Quand ils désignent des vues d'une même
page, comme les huit de Models, la page lit la vue dans l'adresse (`?tab=…`) et
n'a pas de rangée à elle : deux rangées qui disent la même chose font chercher
une différence qui n'existe pas. Un test tient la liste de la page et celle de
la navigation ensemble (`frontend/app/studio/lab/lab-tabs.test.ts`).

## Ce qui reste en valeurs littérales

Un attribut SVG, un style en ligne, un canevas ou une couche Mapbox ne peuvent
pas nommer un rôle. Ils portent la valeur sombre du rôle, écrite en hex. Si une
valeur du thème change, ces endroits sont à reprendre à la main :

| Quoi | Où |
|---|---|
| Rampes de la carte Scenarios (pression, malades, densité) | `simulation/hex/HexTwinView.tsx` |
| Couches ajoutées à la carte | `simulation/hex/layers.ts` |
| Couches Mapbox (grille, contours, halos des libellés) | `simulation/hex/HexGlobe.tsx`, `command/NetworkTwinView.tsx`, `dashboards/MapCard.tsx` |
| Couleur d'un site selon sa mesure | `command/site-metric.ts`, `command/twin-hierarchy.ts`, `events/replay-frames.ts` |
| Graphiques en SVG | les vues `lab/`, `dashboards/CardChart.tsx`, `flux/` |
| Image exportée d'un rejeu | `events/download.ts` (fond `#161616` par défaut) |

### Une rampe sur un fond sombre

Le bas de l'échelle reste près du fond, et chaque palier est plus lumineux que le
précédent : ce qui ressort est ce qui est élevé. C'est l'inverse d'une rampe
dessinée pour un fond clair, où le plus foncé est le plus élevé. La pression
garde ses teintes (vert, jaune, orange, rouge, puis magenta au-delà du double de
la capacité).

Un libellé posé sur la carte a un halo de la couleur du fond (`#161616`), pas
blanc.

## L'exception : les teintes catégorielles

`TYPE_TINTS` (`manager/ManagerView.tsx`), `TINTS` (`events/builder/ui.tsx`),
`SEV_COLOURS` (`events/builder/ApplyPanel.tsx`) et `AUTO_TINTS`
(`command/map-shapes.ts`) restent en hex littéral, volontairement. Ce sont six
couleurs attribuées par position ou par hachage d'un nom, pour qu'une chose garde
la même partout. Elles ne veulent rien dire : la cinquième teinte est rose parce
qu'elle est la cinquième, pas parce que quelque chose ne va pas.

Les nommer `danger` ou `ok` ferait déduire une gravité qui n'existe pas. Une
échelle catégorielle et une échelle sémantique ne se mélangent pas.

Le ciel et l'indigo de Tailwind (`sky-*`, `indigo-*`) servent aussi de teintes
catégorielles dans quelques graphes de nœuds ; ils gardent leur teinte, dans sa
variante sombre (`text-sky-300`, `bg-sky-400/15`, `border-sky-400`).

## Les valeurs claires

`:root` garde les mêmes rôles en clair. Le Studio ne les utilise plus ; elles
servent à la visite du produit sur le site public, qui dessine des composants du
Studio sur une page blanche.

## Historique

Le Studio était clair jusqu'au 2026-11-20, avec des couleurs écrites en hex dans
les classes (`text-[#8f99a8]` 303 fois, `border-[#d3d8de]` 295). La conversion a
remplacé environ 2 700 emplois par des rôles, dans 90 fichiers. La maquette de
référence est l'artefact « Obscyro Dark Redesign ».
