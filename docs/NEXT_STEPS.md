# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le contrat commun et le provider Email/Resend préparé sont verts. Le vérificateur Svix officiel est maintenant écrit sans route publique. Valider ce checkpoint en CI, puis ajouter la persistance tenant/RLS de la livraison et de `svix-id` avant tout effet métier.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Le contrat transversal `d181a97` et le provider préparé `f716b16` sont entièrement verts dans leurs CI et workflows de continuité. Le lot local suivant ajoute uniquement les tags sûrs et la vérification officielle du webhook; il ne crée ni route, ni table, ni activation.

```text
1. Valider en CI le vérificateur Svix, ses limites et sa dépendance épinglée.
2. Créer les tables tenant-scoped de livraisons email et événements fournisseur avec relations composées.
3. Ajouter index tenant-leading, unicité provider/email et `svix-id`, RLS et tests PostgreSQL d'isolation.
4. Vérifier la correspondance tenant/email fournisseur après signature et avant mise à jour.
5. Empêcher un événement tardif de faire régresser un statut plus avancé.
6. Tester rejeu, ordre tardif, événement cross-tenant, payload trop grand et secret absent.
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
5. Webhook Resend signé et filtré. Checkpoint actif.
6. Persistance tenant/RLS des livraisons et événements Resend.
7. Adaptateurs WhatsApp, Teams et Slack derrière feature flags.
8. Tests provider mocks, sécurité, intégration et Playwright pertinents.
