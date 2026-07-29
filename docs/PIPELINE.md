# Pipeline commercial

Une opportunité porte, en plus de son étape et de sa valeur, les informations dont un dirigeant a besoin pour arbitrer : qui s'en occupe, quelle chance de la conclure, et quand.

## Champs

| Champ | Colonne | Règle |
| --- | --- | --- |
| Responsable | `assigned_user_id` | doit être membre de l'organisation, vérifié côté service |
| Probabilité de conclusion | `probability` | entier de 0 à 100, validé par zod |
| Clôture estimée | `expected_close_at` | date ISO, facultative |
| Prochaine action | `next_follow_up_at` | date ISO, alimente les vues « à relancer » et « bloquées » |

Les trois premiers sont ajoutés par la migration `068_pipeline_detail` (miroir SQL `0062`). Ce sont des colonnes additives : les opportunités existantes restent valides avec des valeurs nulles.

## Responsable et isolation

`assignedUserId` est vérifié contre les `memberships` de l'organisation avant écriture. Assigner une opportunité à un utilisateur d'une autre organisation est refusé (`assignee_not_member`, 400) — la contrainte de clé étrangère seule ne suffirait pas, `users` n'étant pas tenant-scopé.

La liste des responsables proposés vient de `listTenantMemberOptions`, qui exclut les comptes supprimés (`users.deleted_at`).

## Historique des changements

La table `opportunity_changes` enregistre une ligne **par champ réellement modifié** : étape, valeur, responsable, probabilité, clôture estimée et prochaine action. Une sauvegarde sans modification n'écrit rien.

Chaque ligne conserve la valeur précédente, la nouvelle valeur, l'auteur et l'horodatage. La table est tenant-scopée, relation composée sur `opportunities(tenant_id, id)`, index tenant-leading, et RLS activée par la migration `069_pipeline_detail_rls`.

L'historique est affiché sur la fiche de l'opportunité, le plus récent en premier, borné à 20 entrées.

## Vue tableau et déplacement

`/opportunites?vue=tableau` affiche le pipeline en colonnes par étape. Une carte se déplace de deux façons :

- **glisser-déposer** vers une autre colonne, sur les navigateurs de bureau ;
- **menu « Déplacer »** présent sur chaque carte, utilisable au clavier, sur mobile et par un lecteur d'écran.

Les deux chemins soumettent **le même formulaire** vers la même server action : il n'existe pas de route parallèle, donc aucune garde n'est contournée. Le glisser-déposer n'est qu'une amélioration ajoutée par-dessus une base qui fonctionne sans lui — il est inutilisable au clavier et peu fiable sur mobile, il ne pouvait donc pas être le seul moyen de déplacer une opportunité.

Le déplacement passe par le service `updateOpportunity` en reprenant les valeurs existantes : responsable, probabilité, montant et échéances sont préservés, la garde de rôle s'applique, et le changement d'étape entre dans l'historique comme n'importe quelle autre modification.

`src/components/pipeline-board.tsx` est le premier composant client du dépôt ; le reste de l'interface demeure en composants serveur.

## Ordre des cartes dans une colonne

Chaque carte porte deux boutons « ↑ » et « ↓ » qui la déplacent d'un cran dans sa colonne. Le choix des boutons plutôt que du glisser-déposer suit la règle du déplacement d'étape : le contrôle doit fonctionner au clavier, sur mobile et avec un lecteur d'écran. Chaque bouton porte un `aria-label` nommant l'opportunité et le sens du déplacement.

La colonne `board_position` (migration `078_opportunity_board_position`, miroir SQL `0072`) est **nullable et sans reprise de données** : une opportunité jamais réordonnée garde `null` et conserve le tri par date de mise à jour. Le tri est `board_position asc nulls last, updated_at desc` — les cartes rangées à la main viennent d'abord, les autres suivent dans l'ordre habituel.

Les positions sont attribuées **à la volée** depuis l'ordre affiché au moment du premier déplacement, et seules les deux cartes échangées sont réécrites : pas de renumérotation globale, pas de migration de données.

Un déplacement au-delà du bord de la colonne ne fait rien et ne remonte **pas** d'erreur : demander de monter la première carte est une intention légitime, pas une faute à signaler.

## Limites actuelles

- Le glisser-déposer ne réordonne pas les cartes à l'intérieur d'une colonne : il ne sert qu'au changement d'étape, l'ordre se règle avec les boutons.
- Une carte déplacée vers une autre étape conserve sa position numérique ; elle peut donc atterrir au milieu de la colonne d'arrivée plutôt qu'à la fin.
- La probabilité est saisie manuellement ; elle n'est pas déduite de l'étape ni calculée par un modèle.
- Un seul pipeline par organisation.
- L'historique conserve l'identifiant du responsable, pas son nom au moment du changement ; l'affichage indique donc « un autre responsable » plutôt que de résoudre un identifiant devenu obsolète.
