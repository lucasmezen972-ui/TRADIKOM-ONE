# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Le transport sortant préparé passe par `ChannelAdapter.sendMessage`, une policy obligatoire et une réservation tenant/RLS. Le worker réclame les tentatives par lease, reprend `reserved`/`temporary`/`rate_limit` avec backoff borné, réutilise la même clé d'idempotence et ne sélectionne jamais `accepted`/`delivered` ou un échec terminal. Cette preuve reste strictement `mock`; aucun provider réel ou sandbox n'est connecté.

La prochaine action non bloquée est d'ajouter l'ingestion des callbacks de statut Twilio derrière la vérification de signature existante. Elle doit dédupliquer le replay fournisseur, résoudre la livraison par référence technique sans exposer le SID, appliquer des transitions monotones vers `accepted`, `delivered` ou `failed`, réconcilier le message canonique et auditer sans corps, numéro, token ni payload brut. Les tests utilisent uniquement des doubles; aucun credential ou appel Twilio réel.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues. Les pages 14, 18, 22, 28-29, 32, 64, 66 et 69 imposent adaptateur sans logique métier, action durable, tenant/RLS, observabilité sûre, états honnêtes, policy, idempotence, retry et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Confirmer le commit publiant le worker OS-5 et ses runs CI/continuité verts sur la PR #11.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Auditer les statuts Twilio officiels et ajouter le callback signé/dédupliqué avec transitions monotones et doubles uniquement.
6. Prouver replay, ordre tardif, tenant/RLS, statut canonique, désactivation et audit sans PII.
7. Ne créer la sandbox et ne promouvoir l'état qu'après autorisation explicite du checkpoint humain du rapport.
```

## Critères du prochain checkpoint

- un callback signé retrouve exactement une livraison tenant-aware et un replay ne crée aucun second effet;
- un événement tardif ne régresse jamais `delivered` vers `accepted` ou `failed`;
- les statuts inconnus, signatures invalides, payloads trop grands et références absentes sont refusés proprement;
- aucun audit ou log ne contient texte, numéro, SID, token, credential ou payload brut;
- le message canonique converge une seule fois vers `sent`, `delivered` ou `failed`;
- le provider réel reste `disabled`, `not_configured` ou `awaiting_human_auth`; le double reste explicitement `mock`;
- tests unitaires, intégration, PostgreSQL/RLS, provider, sécurité et Playwright pertinents;
- aucun paiement, déploiement, fusion ou effet externe irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4, sélection OS-5, outbound WhatsApp fail-closed et worker durable avec doubles.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound avec réservation, lease, retry et réconciliation, sans client réel.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : canal test, `tradikom_mock`, missions durables et transport outbound WhatsApp injecté en tests.
- Bloqué humain : compte Twilio, vérification téléphone, conditions Sandbox, credentials en secret manager, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
