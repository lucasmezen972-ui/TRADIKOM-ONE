# Goal Watch : durabilité — brouillon à valider

## Problème et changement

Une évaluation périmée pouvait publier son rapport avant d'être refusée. Le rejeu ne retrouvait que la dernière clé et deux évaluations concurrentes pouvaient lire le même état.

Ce brouillon regroupe lecture, verrous, rapport Conversation et audit dans une transaction. Il verrouille l'objectif puis le fil, vérifie l'archive avant le rejeu, retrouve la clé dans tout l'historique, refuse une clé déjà liée à une autre observation, et refuse une nouvelle observation de même date ou antérieure. L'ordre de lecture dépend de l'instant observé, pas de l'identifiant aléatoire de l'audit.

PGlite utilise sa transaction native pour réserver sa connexion pendant le callback. PostgreSQL garde les verrous jusqu'au commit. Le schéma limite observations et preuves à zéro à trois décimales pour correspondre à la précision de Date.parse, exige un instant comparable et un décalage horaire inférieur à16heures accepté par PostgreSQL. L'année minimale est0001. Les historiques hors contrat sont refusés fermé, sans troncature.

## Validation réellement récoltée

- Avant le dernier correctif de précision :12 tests natifs service/accès ont réussi sous Node22/Vitest4.1.12 dans le runtime distant.
- Les fichiers ont été conservés sous blobs GitHub après interruption de cet environnement.
- La recette b8a83e912c494dfa5ce13cb6f77152e278416ac7 a passé49 tests ciblés, dont2 PostgreSQL réels,35 horodatages et12 service/accès. Lint et typecheck globaux et audit complet ont réussi dans le même runner.
- Le dernier correctif refuse l'année0000, acceptée par Zod mais refusée par PostgreSQL. Les38 cas d'horodatages de ce dernier schéma doivent encore être exécutés ; les49 tests précédents ne lui sont pas attribués.
- Le test de concurrence PostgreSQL efface son snapshot statistique à chaque lecture de pg_stat_activity pour éviter un résultat périmé.
- Lint et typecheck avaient été lancés avant l'interruption ; leurs résultats n'ont pas été récupérés. Aucun vert ne leur est attribué.
- La revue statique indépendante a identifié et fait corriger la précision temporelle, les offsets PostgreSQL et le snapshot du test ; elle ne remplace pas l'exécution.
- Le brouillon final doit être retesté depuis son SHA exact.

## Reprise sans Actions

Dans le Codespace existant, lire d'abord /tmp/tradikom-final-result.json et /tmp/tradikom-final-verification.log pour connaître le résultat de69a06604c033ba35670578fd97581a8292799838. Ne pas modifier le checkout pendant une recette active.

Après sa fin, récupérer ce brouillon et utiliser une nouvelle base PostgreSQL17 jetable. Exécuter les tests goal-watch (service, accès, précision, durabilité PostgreSQL), lint et typecheck ; vérifier le rollback et le blocage réel entre deux connexions. Ne pas attribuer au brouillon les résultats de69a0660.

Aucun clone ou node_modules sur le Mac, GitHub Actions, fournisseur réel ou programmation récurrente. Budget additionnel autorisé :0USD. Arrêter le Codespace après conservation des preuves ; sa fermeture et son arrêt n'ont pas encore été vérifiés après la coupure du contrôle de l'ordinateur.

## Limites maintenues

Aucune migration, contrainte unique dédiée aux évaluations, RLS Goal Watch spécialisée, sélection équitable/pagination, interface de consentement/arrêt ou activation de maintenance n'est livrée par cette tranche. OS-6 reste partiel. Aucune fusion ou production.
