# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

OS-1 est vert et documenté. Auditer maintenant le framework de connecteurs et les préparations WhatsApp, Teams, Slack et email existantes, puis définir le contrat commun minimal d'OS-2 avant d'ajouter un adaptateur.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Le head `95da35e` est entièrement vert dans les runs `30554462472` et `30554462620`. Le rapport `OS1_VALIDATION_REPORT.md` clôt la première verticale. La reprise commence par l'audit OS-2, pas par un fournisseur choisi au hasard.

```text
1. Relire les pages 13-15 et 64-68 du PDF maître.
2. Inventorier les contrats, connecteurs, webhooks, flags et tests WhatsApp, Teams, Slack et email déjà présents.
3. Classer chaque canal : réutilisable, partiel, absent, ou bloqué par credential/consentement.
4. Définir un contrat d'adaptateur commun minimal sans transport réel.
5. Ajouter les tests d'état `not_configured`, signature invalide, erreur temporaire/permanente et idempotence avant le code.
6. Implémenter le premier incrément OS-2 le plus transversal, puis relancer la CI complète.
```

## Critères du prochain checkpoint

- contrat commun borné, versionné et sans secret;
- états réels `not_configured`, `disabled`, `mock` ou `manual` sans statut connecté inventé;
- vérification des signatures avant ingestion et erreurs normalisées;
- idempotence et anti-boucle conservées par le Conversation Hub;
- aucun transport fournisseur sans feature flag, credential et consentement;
- tests unitaires, intégration, sécurité et provider mocks ajoutés avant activation;
- toute persistance reste tenant-scoped, RLS et auditée;
- état de reprise mis à jour avant l'arrêt.

## Ordre

1. OS-1 Conversation Hub canonique. Terminé et validé par `30554462472`.
2. OS-2 audit des préparations omnicanales. Étape active.
3. Contrat d'adaptateur commun et provider states.
4. Webhooks signés et normalisation d'erreurs sans clés.
5. Adaptateurs WhatsApp, Teams, Slack et email derrière feature flags.
6. Tests provider mocks, sécurité, intégration et Playwright pertinents.
