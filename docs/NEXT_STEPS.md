# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Le correctif ciblé `nanoid` 3.3.18 est publié dans `e845b23`; la CI `32077411092` est entièrement verte (audit, migrations, backup/restauration, RLS, lint, typecheck, 118 fichiers/488 tests, build et 20/20 Playwright) et la continuité `32077411096` est verte. Cette maintenance ne sélectionne aucune nouvelle tranche produit.

Dernière reconfirmation locale : 18 août 2026 à 18:21 UTC, après vérification de l'empreinte et des 71 pages du PDF, relecture directe textuelle et en rendu des pages requises et `pnpm agent:continuity-check` à l'état `ready`. Le handoff `290a621` est couvert par la CI `32140716991` et la continuité `32140716921`, toutes deux vertes.

La chaîne OS-5 non bloquée reste complète jusqu'à la frontière I/O : un futur manifeste `ready` doit consommer l'autorisation durable après membership, contexte, claim et policy, immédiatement avant le transport. Le retry worker retrouve l'`authorization_id` par la consommation liée au `delivery_id` sans seconde unité ni second audit; absence, expiration ou révocation refusent avant adaptateur, credentials, destination, client ou réseau.

La prochaine action est le **checkpoint humain OS-5** décrit ci-dessous. Sans autorisation explicite, ne créer aucun compte, secret, Sandbox, endpoint public ou message réel et ne sélectionner aucune tâche CRM, Kanban, dashboard, OS-6 ou fournisseur alternatif. Le registre réel conserve `transportEnabled: false`; aucun provider réel n'est connecté.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement, en texte et en rendu. Les pages 14, 18, 22, 26, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider, tenant/RLS, action durable, idempotence, policy, audit sans contenu sensible, état honnête et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du head `290a621`; le correctif nanoid 3.3.18 est publié. La CI PostgreSQL/Playwright `32140716991` et la continuité `32140716921` sont vertes.
4. Relire docs/OS5_PROVIDER_SELECTION.md et docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md.
5. Ne modifier le registre ou la configuration réelle qu'après autorisation explicite du checkpoint humain; saisir les secrets uniquement dans un gestionnaire officiel.
6. Émettre une autorisation durable d'au plus deux messages seulement si les unités gratuites sont visibles et la Sandbox acceptée.
7. Exécuter la preuve verticale Conversation web -> WhatsApp Sandbox -> retour signé, avec la même livraison/idempotence sous retry.
8. Vérifier PostgreSQL/RLS, provider, sécurité et Playwright, puis désactiver endpoint/transport, révoquer autorisation et credentials temporaires.
9. Documenter séparément livré, réel, Sandbox, mock et irréversible; ne fusionner ni déployer sans autorisation.
```

## Critères du prochain checkpoint

- correction ciblée `nanoid` 3.3.18 publiée, audit production sans vulnérabilité connue et CI `32077411092` entièrement verte : 118 fichiers/488 tests et 20/20 Playwright;
- autorisation humaine explicite, unités gratuites confirmées et plafond d'au plus deux messages;
- endpoint HTTPS temporaire, sender Sandbox et credentials uniquement dans un gestionnaire de secrets;
- preuve bidirectionnelle réelle marquée Sandbox, avec signature, mapping tenant, idempotence, callback et audit sans contenu sensible;
- expiration, révocation, endpoint désactivé et budget épuisé refusés avant secrets/client/réseau;
- désactivation et révocation vérifiées après preuve; limites irréversibles d'un message déjà remis documentées;
- aucun paiement, dépassement, fusion, production ou changement DNS sans nouvelle autorisation.

## Intervention humaine indispensable pour la preuve réelle

```text
Checkpoint humain OS-5 - ne transmettre aucun secret dans le chat.

1. Autoriser explicitement un compte Twilio d'essai dédié.
2. Confirmer les unités gratuites et l'absence de paiement ou upgrade.
3. Vérifier le téléphone, accepter la Sandbox et rejoindre avec le seul téléphone de test.
4. Autoriser un endpoint HTTPS temporaire et révocable.
5. Autoriser le stockage des credentials uniquement dans un gestionnaire de secrets.
6. Émettre l'autorisation durable pour au plus deux messages de preuve, puis désactiver et révoquer.
```

## État de vérité

- Livré : OS-1 à OS-4; sélection OS-5; chaîne WhatsApp préparée; readiness; autorisation durable; consommation atomique et garde outbound obligatoire du plafond; runbook.
- Réel préparé : inbound signé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel fournisseur.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique uniquement dans les tests; les consommations de test prouvent l'ordre policy -> budget -> transport sans être présentées comme messages réels.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials gérés, endpoint HTTPS et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
