# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 est **WhatsApp via Twilio Sandbox**. La décision repository-grounded, les sources officielles, le contrat de preuve et le checkpoint humain sont dans `docs/OS5_PROVIDER_SELECTION.md`. Aucun provider réel ou sandbox n'est connecté; le registre reste fail-closed dans `disabled`, `not_configured` ou `awaiting_human_auth`.

La prochaine action non bloquée est d'implémenter le transport sortant WhatsApp avec doubles de test uniquement. Il doit passer par `ChannelAdapter.sendMessage`, policy, réservation idempotente tenant-scoped, audit sans numéro ni corps, classification des erreurs et désactivation explicite. Il ne doit pas sélectionner le provider runtime, lire de credential réel ni appeler Twilio. La promotion vers `sandbox` et le test réel attendent l'autorisation humaine exacte du rapport.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-15, 26-30 et 64-68 ont été relues. La page 31 exige un provider réellement activé en sandbox ou avec clés; les pages 14, 29, 32, 64, 66 et 69 imposent adaptateur sans logique métier, états honnêtes, runtime commun, signature, idempotence, audit et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Confirmer la PR #11 et l'état final des runs du head contenant le rapport de sélection OS-5.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Implémenter l'outbound fail-closed avec un client injecté et des doubles; aucun fetch réel, credential ou état ready.
6. Prouver permission, tenant, idempotence, double envoi, erreurs temporary/permanent/auth/rate_limit/policy/not_configured et audit sans PII.
7. Ne créer la sandbox et ne promouvoir l'état qu'après autorisation explicite du checkpoint humain du rapport.
```

## Critères du prochain checkpoint

- un seul provider candidat : WhatsApp via Twilio Sandbox;
- état initial explicitement `disabled`, `not_configured` ou `awaiting_human_auth`;
- aucune clé dans le chat, le navigateur, le code, les logs ou l'audit;
- activation, webhook, sync, santé et erreurs derrière le framework connecteur commun;
- tenant, membership, RLS, idempotence, anti-rejeu et audit sûr conservés;
- preuve web + WhatsApp, sandbox clairement distinguée du mock;
- tests unitaires, intégration, PostgreSQL/RLS, provider, sécurité et Playwright pertinents;
- aucun paiement, déploiement, fusion ou effet externe irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4 et sélection documentée du candidat OS-5.
- Réel préparé : frontières Resend, WhatsApp/Twilio, Teams et Slack.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée.
- Mock : canal test, `tradikom_mock`, deux capacités génériques, compensation et reprise worker.
- Bloqué humain : compte Twilio, vérification téléphone, conditions Sandbox, credentials, endpoint HTTPS et autorisation de deux messages gratuits.
- Hors périmètre immédiat : OS-6 à OS-8, fusion et déploiement.
