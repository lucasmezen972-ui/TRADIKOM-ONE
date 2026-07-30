# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Resend, le vérificateur et la route/enveloppe WhatsApp `f4e4816` sont entièrement verts. Le mapping tenant `01d8f61` a sa continuité verte et sa CI en cours. L'ingestion locale relie signature, endpoint et Conversation Hub dans une transaction système, pseudonymise l'identité et rejoue `MessageSid` sans doublon. Le registre reste incapable de produire `ready`.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Les checkpoints Resend jusqu'à `6dd61b5` sont entièrement verts. La copie de travail active est `/Users/TRADIKOM/Developer/TRADIKOM-ONE`, hors iCloud, et l'automation horaire la cible explicitement.

```text
1. Clore la CI du mapping `01d8f61`.
2. Publier le service entrant WhatsApp et laisser PostgreSQL/RLS/tests complets l'arbitrer.
3. Produire le rapport OS-2 confronté à la Definition of Done page 32 et à la matrice page 69.
4. Garder les adresses et URLs média éphémères; aucun fetch média avant autorisation explicite.
5. Ouvrir ensuite Teams puis Slack derrière les mêmes états fail-closed et consentements humains.
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
8. Route HTTP Resend fail-closed. Verte sur `6dd61b5`.
9. Vérification WhatsApp/Twilio officielle. Publiée sur `7609ad8`, CI en cours.
10. Route HTTP WhatsApp/Twilio fail-closed. Verte sur `f4e4816`.
11. Enveloppe WhatsApp après signature, sans transport. Verte sur `f4e4816`.
12. Mapping tenant WhatsApp avec HMAC/RLS/audit. Publié sur `01d8f61`, CI en cours.
13. Ingestion canonique WhatsApp derrière feature flag. Checkpoint local actif.
14. Adaptateurs Teams et Slack derrière feature flags.
15. Tests provider mocks, sécurité, intégration et Playwright pertinents.
