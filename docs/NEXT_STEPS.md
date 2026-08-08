# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Sont maintenant livrés avec doubles : inbound signé, mapping tenant HMAC, transport sortant derrière `ChannelAdapter`, réservation/idempotence, worker avec lease/backoff, callbacks de statut signés/dédupliqués/monotones et frontière Twilio à client injecté avec résolutions éphémères. Aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est d'implémenter le coffre chiffré et rotatif derrière les résolveurs déjà définis : une référence endpoint tenant-aware fournit éphémèrement Account SID/Auth Token/sender, une référence d'identité active fournit éphémèrement la destination, avec migrations additives, RLS, relations composées, rotation/révocation et audit sans valeur sensible. Les tests doivent utiliser une clé factice et des doubles; aucun secret réel, numéro réel, appel réseau ou état `ready` réel.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement. Les pages 14, 18, 22, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider sans logique métier, action durable, tenant/RLS, secrets non exposés, états honnêtes, policy, idempotence et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel `3b96716`, confirmé par la continuité `31250907674` et la CI PostgreSQL `31250907675` entièrement vertes sur la PR brouillon #11.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Ajouter un stockage chiffré tenant-aware et rotatif pour les références de credentials/sender et de destination, sans réutiliser une colonne de brouillon ou exposer la valeur claire.
6. Brancher des résolveurs sur ce coffre derrière membership, contexte et policy; prouver RLS, rotation, révocation, résolution éphémère, absence de réseau et audit sans PII avec doubles uniquement.
7. Ne créer la Sandbox, saisir les credentials ou promouvoir l'état qu'après autorisation explicite du checkpoint humain du rapport.
```

## Critères du prochain checkpoint

- credentials, sender et destination sont chiffrés au repos, versionnés, rotatifs, révocables et isolés par tenant/RLS;
- aucune valeur claire, token, numéro, SID ou contenu n'est retourné, audité ou loggé;
- les résolveurs exigent endpoint et identité tenant-scoped actifs après membership et policy, jamais une entrée frontend seule;
- la clé d'envoi durable et l'URL de callback restent inchangées; erreurs temporary/permanent/auth/rate_limit restent normalisées;
- les états réels restent `disabled`, `not_configured` ou `awaiting_human_auth`; seul un client double explicitement injecté est utilisable en test;
- tests unitaires, intégration, PostgreSQL/RLS, provider et sécurité, plus lint, typecheck, build, continuité et CI;
- aucun paiement, message externe, endpoint public, déploiement, fusion ou effet irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4; sélection OS-5; outbound durable; worker; callbacks Twilio signés/dédupliqués/monotones; transport à client et résolveurs injectés.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound durable, convergence de statut et frontière Twilio éphémère, sans coffre ni client officiel branché.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : canal test, `tradikom_mock`, missions durables et transports/callbacks WhatsApp simulés par doubles.
- Bloqué humain : compte Twilio, vérification téléphone, conditions Sandbox, credentials en secret manager, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
