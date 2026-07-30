# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

La verticale WhatsApp préparée jusqu'à l'ingestion `19ff401` est entièrement verte dans la CI et la continuité. La frontière Teams utilise maintenant le SDK officiel v2 épinglé : validation JWT Microsoft avant remise au métier, corps borné, projection sans payload brut et route inaccessible tant que le registre ne produit pas `ready`. Aucun consentement, credential ou endpoint Microsoft réel n'est créé.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Les checkpoints Resend et WhatsApp jusqu'à `19ff401` sont entièrement verts. La copie de travail active est `/Users/TRADIKOM/Developer/TRADIKOM-ONE`, hors iCloud, et l'automation horaire la cible explicitement.

```text
1. Publier le checkpoint de validation et route Teams fail-closed.
2. Étendre le mapping endpoint à `teams_microsoft` sans PII et avec isolation tenant/RLS/audit.
3. Ingérer les messages Teams vérifiés dans le Conversation Hub avec identité HMAC et replay de l'Activity ID.
4. Garder pièces jointes et URLs fournisseur hors stockage; aucun téléchargement avant autorisation explicite.
5. Ouvrir ensuite Slack avec signature v0, fenêtre anti-rejeu et OAuth humain non simulé.
6. Produire le rapport OS-2 confronté à la Definition of Done page 32 et à la matrice page 69.
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
9. Vérification WhatsApp/Twilio officielle. Verte sur `7609ad8`.
10. Route HTTP WhatsApp/Twilio fail-closed. Verte sur `f4e4816`.
11. Enveloppe WhatsApp après signature, sans transport. Verte sur `f4e4816`.
12. Mapping tenant WhatsApp avec HMAC/RLS/audit. Vert sur `01d8f61`.
13. Ingestion canonique WhatsApp derrière feature flag. Verte sur `19ff401`.
14. Validation JWT et route Teams fail-closed avec SDK officiel. Checkpoint local actif.
15. Mapping et ingestion Teams sans activation.
16. Adaptateur Slack derrière feature flag.
17. Tests provider mocks, sécurité, intégration et Playwright pertinents.
