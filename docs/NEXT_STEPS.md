# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

L'audit OS-2 et le contrat commun sont préparés dans `OS2_CHANNEL_AUDIT.md` et `src/modules/channels`. Valider ce checkpoint en CI, puis extraire le provider Email/Resend de la PR #10 derrière l'abstraction email existante, sans activer de webhook ni de transport réel.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Le head OS-1 `95da35e` est entièrement vert dans les runs `30554462472` et `30554462620`. Le rapport `OS1_VALIDATION_REPORT.md` clôt la première verticale. L'audit OS-2 classe les quatre canaux et le premier checkpoint transversal attend sa validation CI.

```text
1. Valider en CI le contrat commun, le registre sans réseau et les états fournisseurs honnêtes.
2. Extraire uniquement le provider Resend HTTP de la PR #10 et le revalider dans l'abstraction email courante.
3. Tester mode développement, refus production sans clé, timeout, redirection, idempotence et classification d'erreur.
4. Préparer ensuite le webhook Resend signé, désactivé sans secret.
5. Conserver WhatsApp, Teams et Slack en `awaiting_human_auth` jusqu'aux SDK, consentements et tests officiels.
6. Ajouter l'ingestion canonique, l'audit et l'isolation tenant avant toute activation.
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
2. OS-2 audit des préparations omnicanales. Terminé.
3. Contrat d'adaptateur commun et provider states. Checkpoint actif.
4. Email/Resend derrière feature flag et refus sûr.
5. Webhooks signés et normalisation d'erreurs sans clés.
6. Adaptateurs WhatsApp, Teams et Slack derrière feature flags.
7. Tests provider mocks, sécurité, intégration et Playwright pertinents.
