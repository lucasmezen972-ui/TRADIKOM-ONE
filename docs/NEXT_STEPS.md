# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le contrat, le provider et le vérificateur Svix sont verts. Les migrations tenant/RLS des livraisons et événements sont préparées sans payload brut. Valider ce checkpoint en CI, puis publier le service de réservation, déduplication et ordre tardif déjà développé localement.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Les checkpoints `d181a97`, `f716b16` et `860a14d` sont entièrement verts. Le lot local actif ajoute uniquement les tables `email_provider_deliveries` et `email_provider_events`, leurs contraintes, index et RLS; le service reste dans le lot suivant.

```text
1. Valider migrations `071`/`072`, parité SQL, contraintes, RLS et PostgreSQL.
2. Publier le repository/service tenant-aware de réservation des livraisons Resend.
3. Vérifier la correspondance invitation/destinataire/email fournisseur après signature.
4. Dédupliquer `svix-id` et empêcher un événement tardif de faire régresser l'état.
5. Auditer livraison et événement sans adresse, sujet, token, corps ni détail fournisseur.
6. Tester replay, ordre tardif, conflit cross-tenant et intégration invitation.
7. Conserver WhatsApp, Teams et Slack en `awaiting_human_auth` jusqu'aux SDK, consentements et tests officiels.
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
6. Persistance tenant/RLS des livraisons et événements Resend. Checkpoint actif.
7. Service de déduplication et d'ordre tardif Resend.
8. Adaptateurs WhatsApp, Teams et Slack derrière feature flags.
9. Tests provider mocks, sécurité, intégration et Playwright pertinents.
