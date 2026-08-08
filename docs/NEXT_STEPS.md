# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. La preuve d'autorisation est désormais persistée, tenant-aware, expirante, révocable, idempotente et auditée. La readiness ne reçoit plus de preuve libre et le registre reste incapable de produire `ready`; aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est d'ajouter une consommation durable et atomique du budget d'autorisation dans `src/modules/channels/whatsapp-twilio-activation-budget-service.ts`, avec migration additive et miroir SQL. Chaque livraison de preuve devra réserver exactement une unité sous `tenant_id`, `endpoint_id` et `authorization_id`, réutiliser la clé d'idempotence de livraison, refuser expiration/révocation/dépassement et ne jamais consommer deux fois lors d'un retry. Aucun appel Twilio ne sera effectué.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement, en texte et en rendu. Les pages 14, 18, 22, 26, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider, tenant/RLS, action durable, idempotence, policy, audit sans contenu sensible, état honnête et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel 720db0e et vérifier la PR brouillon #11 ainsi que sa CI PostgreSQL/Playwright.
4. Relire docs/OS5_PROVIDER_SELECTION.md et docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md.
5. Ajouter une table de consommation tenant-owned reliée par clés composites à l'autorisation et à la livraison, avec RLS et index tenant-leading.
6. Réserver une unité atomiquement avant tout futur transport; refuser autorisation absente, expirée, révoquée, autre endpoint/tenant ou budget épuisé.
7. Rendre le replay d'une même livraison sans double consommation et conserver le même authorization_id lors des retries.
8. Prouver migration vide/upgrade, restricted-role RLS, concurrence, replay, budget 1/2, révocation et audit sans donnée sensible.
9. Ne promouvoir aucun manifeste vers ready et ne créer aucune Sandbox, credential, URL publique ou message réel sans l'autorisation humaine externe.
```

## Critères du prochain checkpoint

- consommation persistée avec `tenant_id`, relations composites, RLS et unicité par livraison;
- compteur ou réservation atomique incapable de dépasser `max_messages` sous concurrence;
- expiration, révocation, provider, endpoint et tenant vérifiés côté service;
- retry/replay sans seconde unité ni second audit d'effet;
- aucun secret, numéro, URL, message, SID, ciphertext ou référence complète en base, réponse ou audit;
- tests unitaires, intégration, migrations, PostgreSQL/RLS, provider et sécurité, plus lint, typecheck, build, continuité et CI;
- aucun compte, paiement, message externe, endpoint public, déploiement, fusion ou effet irréversible sans autorisation.

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

- Livré : OS-1 à OS-4; sélection OS-5; chaîne WhatsApp préparée; readiness; autorisation durable; runbook.
- Réel préparé : inbound signé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel fournisseur.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique uniquement dans les tests.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials gérés, endpoint HTTPS et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
