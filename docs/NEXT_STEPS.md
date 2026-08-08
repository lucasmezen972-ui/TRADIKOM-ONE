# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Sont livrés avec doubles : inbound signé, mapping tenant HMAC, outbound durable, worker lease/backoff, callbacks monotones, transport à résolutions éphémères, coffre chiffré/rotatif, bootstrap serveur du keyring par références gérées et fabrique bornée du client officiel. Aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est d'ajouter `src/modules/channels/whatsapp-twilio-readiness.ts` : une vérification de santé et une composition d'activation explicite qui contrôlent le manifeste, les références du keyring, l'endpoint, les URLs HTTPS et l'autorisation humaine sans résoudre de secret ni construire de client dans les états `disabled`, `not_configured` ou `awaiting_human_auth`. Le registre doit rester incapable de produire `ready` dans ce checkpoint.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement, en texte et en rendu. Les pages 14, 18, 22, 26, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider sans logique métier, action durable, tenant/RLS, secrets chiffrés et rotatifs, états honnêtes, policy, idempotence et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel 423c9d1 et vérifier la CI/continuité de la PR brouillon #11.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Ajouter src/modules/channels/whatsapp-twilio-readiness.ts sans modifier le registre vers ready.
6. Vérifier séparément configuration déclarée, références gérées, endpoint actif, URLs HTTPS, checkpoint humain et santé provider; ne jamais retourner une valeur sensible.
7. Prouver avec doubles qu'aucun resolver, client ou réseau n'est touché avant autorisation; garder disabled/not_configured/awaiting_human_auth.
8. Documenter la procédure d'activation, rotation, révocation et désactivation réversible.
9. Ne créer la Sandbox, saisir les credentials ou envoyer un message qu'après autorisation explicite du checkpoint humain.
```

## Critères du prochain checkpoint

- la santé distingue configuration absente, références invalides, intervention humaine attendue et état dégradé sans exposer de secret;
- aucun keyring ni client n'est construit avant toutes les gardes et aucune vérification de santé n'effectue d'appel fournisseur;
- la composition conserve membership, tenant, policy, idempotence et audit du service sortant existant;
- la procédure décrit activation, test borné, rotation, révocation, désactivation et rollback sans promettre d'annuler un message envoyé;
- tests unitaires, intégration, provider et sécurité, plus régression canaux, lint, typecheck, build, continuité et CI;
- aucun compte, paiement, message externe, endpoint public, déploiement, fusion ou effet irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4; sélection OS-5; outbound durable; worker; callbacks Twilio; coffre AES-256-GCM tenant/RLS; résolveurs éphémères; bootstrap serveur par références; fabrique SDK officielle sans réseau à la construction.
- Réel préparé : inbound WhatsApp signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans composition active ni appel fournisseur.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références et clés de chiffrement, résolveurs, clients et réponses Twilio de test; canal test, `tradikom_mock` et missions durables.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
