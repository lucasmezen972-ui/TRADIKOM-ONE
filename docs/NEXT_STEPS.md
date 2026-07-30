# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le service de réservation, déduplication et ordre tardif est publié sur `199482a`. Sa CI a passé migrations, backup, lint, typecheck et 268 tests; les six échecs restants provenaient d'une divergence runtime/miroir du trigger et d'un token de fixture partagé, désormais corrigés avec un garde de parité. La route webhook Resend est préparée localement mais refuse toute ingestion tant que le registre n'est pas explicitement `ready`.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Les checkpoints `d181a97`, `f716b16` et `860a14d` sont entièrement verts. Le checkpoint `76cf327` a validé migrations, backup, lint, typecheck et RLS; ses deux échecs de tests étaient des fixtures devenues obsolètes. Le lot local actif les corrige et ajoute le service sans endpoint public.

```text
1. Publier les corrections runtime/fixture avec la route HTTP Resend.
2. Publier la route HTTP Resend avec refus par défaut, corps brut borné et réponses sans PII.
3. Vérifier que le runtime ne peut toujours pas atteindre `ready` sans consentement humain.
4. Ajouter l'adaptateur WhatsApp/Twilio avec vérification officielle de l'URL exacte et des paramètres bruts.
5. Tester replay, signature, payload, erreur et absence d'appel réseau.
6. Conserver Teams et Slack en `awaiting_human_auth` jusqu'aux SDK, consentements et tests officiels.
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
4. Email/Resend préparé avec refus runtime sûr. Checkpoint actif.
5. Webhook Resend signé et filtré. Vert sur `860a14d`.
6. Persistance tenant/RLS des livraisons et événements Resend. Publiée sur `76cf327`; fixtures CI corrigées localement.
7. Service de déduplication et d'ordre tardif Resend. Publié sur `199482a`; corrections CI incluses dans le checkpoint local.
8. Route HTTP Resend fail-closed. Checkpoint local actif.
9. Adaptateurs WhatsApp, Teams et Slack derrière feature flags.
10. Tests provider mocks, sécurité, intégration et Playwright pertinents.
