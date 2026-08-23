# Fichiers de démonstration — provenance

**Aucun des deux fichiers de ce dossier n'est une source vérifiée.** Ils sont là
pour faire la démonstration du chemin *Data → pipeline → ontologie*, pas pour
soutenir une conclusion. Le registre MSSS des 190 installations, lui, est
authentiquement gouvernemental ; ceux-ci ne le sont pas, et la différence doit
rester visible.

## `contacts-par-milieu-HYPOTHESE.csv`

Ordres de grandeur saisis de mémoire d'après l'enquête **CONNECT** (Université
Laval / INSPQ). Trois réserves, chacune suffisante pour interdire de les citer :

1. Rien n'a été confronté à la publication. Un indice : le total mémorisé était
   7,8 contacts/jour, et les composantes écrites ici font 7,9.
2. CONNECT est une enquête universitaire, pas un jeu de données ouvertes
   gouvernemental.
3. L'enquête ne se décompose pas par RLS. **La même moyenne provinciale est
   recopiée sur les douze lignes** — le fichier a l'air d'un relevé territorial
   et n'en est pas un.

Pour un usage réel : récupérer les chiffres publiés, par groupe d'âge et par
milieu, et remplacer ce fichier.

## `parametres-transmission-HYPOTHESE.csv`

Ce ne sont pas des données. Ce sont des paramètres construits :

| Quantité | Valeur | D'où elle vient |
|---|---|---|
| Période infectieuse | 5 jours | hypothèse |
| Fraction urgence | 3,5 % | hypothèse — la moins assurée |
| Fraction hospitalisation | 1,5 % | hypothèse — la moins assurée |
| Temps de doublement | 2,5 jours | mémoire, non vérifié |
| Taux par contact | 0,0604 | arithmétique sur les quatre lignes ci-dessus |

Le taux par contact se dérive de R₀ = 1 + r/γ, avec r = ln2 / 2,5 j et γ = 0,2/j,
puis divisé par le nombre de contacts et la durée. Il n'est pas repris d'une
publication : les R₀ publiés pour Omicron viennent de modèles portant un état
latent, que ce modèle-ci n'a pas, et transporter le nombre d'une structure à
l'autre donne une vague qui double deux fois par jour.

**Ce qu'il faut faire de ces nombres :** les ajuster contre la courbe observée de
2021-2022, qui est déjà dans le jumeau. C'est le seul usage honnête.
