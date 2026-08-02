# Palette du Studio

Référence : **Ontology › Discover**. Fond `canvas`, cartes blanches, une seule
couleur de bordure, quatre poids de texte.

Les valeurs étaient écrites en hex littéral — `text-[#8f99a8]` apparaît 332
fois, `border-[#d3d8de]` 291 — ce qui rend tout changement de style long et
toute dérive invisible. Ce sont les mêmes valeurs, nommées, dans
`tailwind.config.ts`.

## Les tokens

| Token | Valeur | Usage |
|---|---|---|
| `ink` | `#1c2127` | titres, texte principal |
| `ink-body` | `#404854` | texte courant |
| `ink-muted` | `#5f6b7c` | texte secondaire |
| `ink-faint` | `#8f99a8` | étiquettes, métadonnées |
| `ink-ghost` | `#c5cbd3` | désactivé, points inactifs |
| `line` | `#d3d8de` | bordures de panneaux et de cartes |
| `line-soft` | `#e5e8eb` | séparateurs dans un panneau |
| `line-faint` | `#eef1f4` | séparateurs de lignes |
| `canvas` | `#f6f7f9` | la page derrière les cartes blanches |
| `canvas-raised` | `#f8f9fa` | blocs en creux sur du blanc |
| `brand` | `#2d72d2` | accent |
| `brand-deep` | `#215db0` | texte et bordures sur `brand-soft` |
| `brand-soft` | `#e7f2fd` | lignes sélectionnées, pastilles actives |
| `ok` / `ok-soft` / `ok-ink` | `#1d9e75` · `#e8f6f0` · `#1c6e42` | |
| `warn` / `warn-soft` / `warn-line` / `warn-ink` | `#d9822b` · `#fdf6ec` · `#f0d9b5` · `#935610` | |
| `danger` / `danger-soft` / `danger-ink` | `#c23030` · `#fdf1f1` · `#a82255` | |
| `scenario` / `scenario-soft` | `#5b4a86` · `#f0edf7` | |

Les variantes `-ink` existent parce que le ton moyen ne passe pas le contraste
sur son propre fond pâle.

**`scenario` n'est pas une gravité.** Elle veut dire « tu ne regardes pas la
réalité », ce qui est un autre axe que « c'est grave ».

## Les motifs

```
carte      rounded-md border border-line bg-white p-3 transition-colors
           hover:border-brand
panneau    border border-line bg-white rounded-md
en-tête    border-b border-line px-3 py-2
titre      text-xs font-medium text-ink
méta       text-[10px] text-ink-faint
étiquette  text-[10px] font-medium uppercase tracking-wide text-ink-faint
sélection  border-brand bg-brand-soft
```

## L'exception : les teintes catégorielles

`TYPE_TINTS` dans `ManagerView` reste en hex littéral, volontairement. Ce sont
six couleurs attribuées par hachage du nom d'un type, pour qu'un type garde la
même partout. Elles ne veulent rien dire — la cinquième teinte est rose parce
qu'elle est la cinquième, pas parce que quelque chose ne va pas.

Les nommer `danger` ou `ok` ferait déduire une gravité qui n'existe pas. Une
échelle catégorielle et une échelle sémantique ne se mélangent pas.

## État de la migration

`ResponseView` (85 remplacements) et `ManagerView` (151 classes dérivées + 134
littéraux) sont convertis. Le reste utilise encore des littéraux, et environ 390
des ~850 occurrences de gris Tailwind sont dans du code mort ou condamné :

- ~~`StudioOntologyMode`~~ — supprimé, 572 lignes importées nulle part
- `StudioEditor` et ses quatre panneaux — partent avec les canaux

Ne pas restyler ce qui va être supprimé. Ne remplacer que les hex identiques :
une correspondance approximative change l'apparence sans que personne l'ait
demandé.
