# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Le transport sortant préparé passe désormais par `ChannelAdapter.sendMessage`, une policy obligatoire, une réservation durable tenant/RLS et un audit sans contenu sensible. Cette preuve est strictement `mock` avec client injecté; aucun provider réel ou sandbox n'est connecté et le registre reste fail-closed dans `disabled`, `not_configured` ou `awaiting_human_auth`.

La prochaine action non bloquée est d'ajouter un worker durable pour reprendre les livraisons `reserved`, `temporary` et `rate_limit`. Il doit utiliser un lease tenant-aware borné, conserver exactement la même clé d'idempotence, limiter les tentatives, ne jamais rejouer une livraison déjà `accepted`/`delivered`, réconcilier le message canonique et auditer sans corps, numéro, SID ni secret. Les tests utilisent uniquement des doubles; aucun credential ou appel Twilio réel.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues. Les pages 14, 18, 22, 28-29, 32, 64, 66 et 69 imposent adaptateur sans logique métier, action durable, tenant/RLS, observabilité sûre, états honnêtes, policy, idempotence, retry et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Vérifier la PR #11 et les checks du commit publiant le transport outbound OS-5.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Auditer channel_provider_deliveries et ajouter un worker de reprise avec lease, tentatives bornées et doubles uniquement.
6. Prouver interruption après réservation, reprise temporary/rate_limit, non-rejeu après succès, tenant/RLS, policy et audit sans PII.
7. Ne créer la sandbox et ne promouvoir l'état qu'après autorisation explicite du checkpoint humain du rapport.
```

## Critères du prochain checkpoint

- une livraison `reserved` peut reprendre après interruption sans double effet;
- `temporary` et `rate_limit` sont réessayés avec backoff borné, `permanent`, `auth`, `policy`, `validation` et `not_configured` ne le sont pas automatiquement;
- la clé d'idempotence, le message, l'endpoint et l'identité restent tenant-scoped et immuables;
- aucun audit ou log ne contient texte, numéro, SID, token, credential ou payload brut;
- le message canonique converge une seule fois vers `sent`, `delivered` ou `failed`;
- le provider réel reste `disabled`, `not_configured` ou `awaiting_human_auth`; le double reste explicitement `mock`;
- tests unitaires, intégration, PostgreSQL/RLS, provider, sécurité et Playwright pertinents;
- aucun paiement, déploiement, fusion ou effet externe irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4, sélection OS-5 et outbound WhatsApp durable/fail-closed avec doubles.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound derrière adaptateur/policy/persistance, sans client réel.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : canal test, `tradikom_mock`, missions durables et transport outbound WhatsApp injecté en tests.
- Bloqué humain : compte Twilio, vérification téléphone, conditions Sandbox, credentials en secret manager, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
