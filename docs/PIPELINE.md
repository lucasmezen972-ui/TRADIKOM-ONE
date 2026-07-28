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

## Limites actuelles

- Pas de glisser-déposer entre étapes : le changement d'étape se fait depuis la fiche.
- La probabilité est saisie manuellement ; elle n'est pas déduite de l'étape ni calculée par un modèle.
- Un seul pipeline par organisation.
- L'historique conserve l'identifiant du responsable, pas son nom au moment du changement ; l'affichage indique donc « un autre responsable » plutôt que de résoudre un identifiant devenu obsolète.
