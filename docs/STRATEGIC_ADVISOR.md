# Conseiller stratégique

Le conseiller produit des recommandations déterministes à partir des signaux vérifiés du Cerveau d'entreprise. Chacune porte son problème, sa justification, son gain attendu, son effort, son risque et ses preuves ; aucune n'exécute quoi que ce soit — l'approbation valide une orientation, pas une action.

## Apprentissage des refus

Un refus vaut pour **la règle**, pas pour la proposition qui l'a portée.

La déduplication d'origine compare une empreinte calculée sur `ruleKey` **et les preuves**, valeurs observées comprises. Elle empêchait bien de recréer une proposition strictement identique, mais pas de faire revenir le même conseil dès qu'un compteur bougeait d'une unité : nouvelle empreinte, nouvelle proposition, alors que le dirigeant venait de l'écarter. Ce n'était pas un apprentissage, c'était de l'insistance.

Depuis, refuser une recommandation met sa règle **en sourdine pendant 30 jours** (`strategicRefusalMuteDays`). Pendant cette fenêtre, la génération écarte la règle **avant** toute vérification d'empreinte, quelle que soit l'évolution des valeurs observées.

### Ce que voit le dirigeant

La page `/conseiller-strategique` affiche une section « Règles en sourdine » listant, pour chaque règle écartée : le titre du conseil, le motif du refus tel qu'il a été saisi, l'auteur, la date du refus et la date de réapparition. Le point compte : sans cet affichage, un conseil absent est indiscernable d'un conseil qui ne serait plus détecté.

Après une analyse, le bandeau indique combien de propositions ont été écartées pour cause de sourdine, en plus du nombre de nouvelles propositions.

### Réactivation

Le propriétaire, un administrateur ou un manager peut lever la sourdine d'une règle avant l'échéance. **La décision de refus n'est pas modifiée** : elle reste dans l'historique avec son motif et son auteur. Seule la levée est enregistrée (`mute_lifted_at`, `mute_lifted_by`), et elle est tracée dans le journal d'audit (`strategic_advisor.rule_mute_lifted`).

Lever une sourdine deux fois est refusé (`strategic_rule_mute_not_found`), tout comme lever la sourdine d'une règle appartenant à une autre organisation — la requête est tenant-scopée, la seconde organisation ne voit tout simplement aucune ligne.

## Implémentation

| Élément | Emplacement |
| --- | --- |
| Durée de sourdine et calculs de fenêtre | `src/modules/strategic-advisor/rules.ts` |
| Lecture des règles en sourdine | `listActiveStrategicRuleMutes` (`repository.ts`) |
| Écart à la génération | `generateStrategicRecommendations` (`service.ts`) |
| Levée | `liftStrategicRecommendationMute` (`service.ts`) |

La migration `074_strategic_refusal_learning` (miroir SQL `0068`) ajoute deux colonnes additives à `strategic_recommendations` et un index `(tenant_id, rule_key, decided_at desc)`. La table porte déjà sa politique RLS : aucune migration d'isolation n'est nécessaire. Une contrainte `check` garantit que `mute_lifted_at` et `mute_lifted_by` sont renseignés ensemble ou pas du tout — une levée sans auteur ne serait pas traçable.

L'état de sourdine est **dérivé** du refus le plus récent de chaque règle (`distinct on (rule_key)` trié par `decided_at desc`), et non stocké dans une table séparée : il n'existe donc aucun état à resynchroniser avec les décisions.

## Limites actuelles

- La durée de 30 jours est une constante, pas un réglage par organisation.
- La sourdine est binaire : elle ne pondère pas la confiance d'une règle souvent refusée, elle la suspend.
- Le motif du refus est conservé et affiché, mais il n'influence pas le contenu des recommandations suivantes — les règles restent déterministes.
- Une règle refusée puis réactivée peut immédiatement reproposer la même proposition si l'empreinte a changé entre-temps.
