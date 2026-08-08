# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Sont maintenant livrés avec doubles : inbound signé, mapping tenant HMAC, transport sortant derrière `ChannelAdapter`, réservation/idempotence, worker avec lease/backoff et callbacks de statut signés, dédupliqués et monotones. Aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est de préparer la frontière de transport Twilio réelle sans l'activer : résoudre les credentials et la destination uniquement par références sûres et de façon éphémère après les gardes service/policy, transmettre l'URL HTTPS de callback de statut configurée, classer les erreurs et refuser avant le client dans les états `disabled`, `not_configured` et `awaiting_human_auth`. Les tests doivent injecter tous les doubles; aucun secret, numéro, appel réseau ou état `ready` réel.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement. Les pages 14, 18, 22, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider sans logique métier, action durable, tenant/RLS, secrets non exposés, états honnêtes, policy, idempotence et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel `65176fb`, confirmé par la CI PostgreSQL `31248824059` et la continuité `31248824055` vertes sur la PR brouillon #11.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Ajouter une frontière de transport Twilio à client injecté, avec résolveurs de credentials et destination par références; ne jamais persister ni retourner leur valeur.
6. Transmettre l'URL TWILIO_WHATSAPP_STATUS_CALLBACK_URL et prouver fail-closed, policy préalable, idempotence, classification, absence de réseau et audit sans PII avec doubles uniquement.
7. Ne créer la Sandbox, saisir les credentials ou promouvoir l'état qu'après autorisation explicite du checkpoint humain du rapport.
```

## Critères du prochain checkpoint

- aucun client Twilio n'est construit ou appelé sans état autorisé, credentials résolus, destination résolue et URL HTTPS de callback;
- credentials, token, sender, numéro destinataire, SID et contenu ne sont jamais retournés, audités ou loggés;
- la destination est résolue éphémèrement depuis l'identité tenant-scoped après membership et policy, jamais depuis une entrée frontend seule;
- le même identifiant d'envoi et la même URL de callback traversent le transport; erreurs temporary/permanent/auth/rate_limit restent normalisées;
- les états réels restent `disabled`, `not_configured` ou `awaiting_human_auth`; seul un client double explicitement injecté est utilisable en test;
- tests unitaires, intégration, PostgreSQL/RLS, provider et sécurité, plus lint, typecheck, build, continuité et CI;
- aucun paiement, message externe, endpoint public, déploiement, fusion ou effet irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4; sélection OS-5; outbound durable; worker; callbacks Twilio signés/dédupliqués/monotones.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound durable et convergence de statut, sans client réel.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : canal test, `tradikom_mock`, missions durables et transports/callbacks WhatsApp simulés par doubles.
- Bloqué humain : compte Twilio, vérification téléphone, conditions Sandbox, credentials en secret manager, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
