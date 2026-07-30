# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

La route Resend `6dd61b5` est entièrement verte, y compris 268 tests, build et Playwright. Le vérificateur WhatsApp/Twilio utilise désormais `twilio@6.0.2`, borne formulaire et JSON, vérifie l'URL exacte et ne restitue aucune PII. Le registre reste incapable de produire `ready` et aucun transport n'est activé.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Les checkpoints Resend jusqu'à `6dd61b5` sont entièrement verts. La copie de travail active est `/Users/TRADIKOM/Developer/TRADIKOM-ONE`, hors iCloud, et l'automation horaire la cible explicitement.

```text
1. Publier le vérificateur Twilio officiel et laisser la CI complète l'arbitrer.
2. Ajouter une route HTTP Twilio qui refuse avant lecture tant que le registre n'est pas `ready`.
3. Conserver le corps exact et tous les paramètres uniquement en mémoire après vérification, sans journalisation de PII.
4. Préparer la normalisation WhatsApp vers le message canonique sans l'activer.
5. Tester replay, signature, payload, erreur, URL proxy exacte et absence d'appel réseau.
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
9. Vérification WhatsApp/Twilio officielle. Checkpoint local actif.
10. Route HTTP et normalisation WhatsApp/Twilio derrière feature flag.
11. Adaptateurs Teams et Slack derrière feature flags.
12. Tests provider mocks, sécurité, intégration et Playwright pertinents.
