# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le contrat commun OS-2 est publié et sa CI est en cours. Le provider Email/Resend est maintenant extrait et durci sans sélection runtime. Valider ce second checkpoint en CI, puis préparer le webhook Resend signé et idempotent, toujours désactivé sans secret et sans mapping tenant prouvé.

## Référence prompt maître

OS-1 satisfait désormais les pages 31, 32, 46, 48 et 69. Pour OS-2, relire les pages 13-15 et 64-68 : contrats de canaux, adaptateurs officiels, vérification des signatures, feature flags, état `not_configured` et aucune fausse connexion. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Le head OS-1 `95da35e` est entièrement vert. Le contrat transversal OS-2 est publié sur `d181a97`; sa continuité, son lint et son typecheck sont verts, tandis que la suite complète poursuit son exécution. Le provider Resend préparé reste local jusqu'à ce verdict.

```text
1. Valider en CI le contrat commun et le provider Resend préparé.
2. Définir le contrat du webhook Resend sur le corps brut et les trois en-têtes Svix.
3. Vérifier la signature avec la bibliothèque officielle, puis dédupliquer `svix-id` avant tout effet.
4. Persister uniquement les événements utiles avec tenant explicite, RLS, index tenant-leading et audit sûr.
5. Tester signature invalide, rejeu, ordre tardif, payload trop grand et secret absent.
6. Conserver WhatsApp, Teams et Slack en `awaiting_human_auth` jusqu'aux SDK, consentements et tests officiels.
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
5. Webhook Resend signé et idempotent.
6. Adaptateurs WhatsApp, Teams et Slack derrière feature flags.
7. Tests provider mocks, sécurité, intégration et Playwright pertinents.
