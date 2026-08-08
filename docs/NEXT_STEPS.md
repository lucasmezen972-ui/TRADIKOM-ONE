# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Sont livrés avec doubles : inbound signé, mapping tenant HMAC, outbound durable, worker lease/backoff, callbacks monotones, transport à client injecté et coffre chiffré/rotatif tenant-aware pour credentials, sender et destination. Aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est d'ajouter une fabrique bornée du client officiel `twilio` et un bootstrap serveur du keyring versionné depuis des références de secret manager. Le registre doit rester incapable de produire `ready`; les tests doivent prouver qu'aucun client n'est construit et qu'aucun réseau n'est appelé en état `disabled`, `not_configured` ou `awaiting_human_auth`.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement, en texte et en rendu. Les pages 14, 18, 22, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider sans logique métier, action durable, tenant/RLS, secrets chiffrés et rotatifs, états honnêtes, policy, idempotence et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel 9c7e4db et vérifier la CI/continuité de la PR brouillon #11.
4. Relire docs/OS5_PROVIDER_SELECTION.md et conserver WhatsApp/Twilio comme seul candidat actif du chantier.
5. Ajouter src/modules/channels/whatsapp-twilio-client.ts : fabrique du client officiel, options bornées et aucune logique métier.
6. Ajouter un bootstrap serveur du keyring versionné depuis le gestionnaire de secrets, sans valeur par défaut de production et sans exposition navigateur.
7. Prouver avec doubles qu'aucun client/réseau n'existe avant état explicitement autorisé; conserver le provider réel disabled/not_configured/awaiting_human_auth.
8. Ne créer la Sandbox, saisir les credentials ou envoyer un message qu'après autorisation explicite du checkpoint humain.
```

## Critères du prochain checkpoint

- le client officiel est construit uniquement avec les credentials éphémères du coffre, jamais depuis une page ou une action métier;
- le keyring serveur exige une version active et des clés de 256 bits provenant d'une configuration gérée, sans fallback de production;
- aucun secret, numéro, SID, contenu, ciphertext ou erreur brute n'est retourné, audité ou loggé;
- le registre réel reste fail-closed et les états visibles restent honnêtes;
- tests unitaires, intégration, provider et sécurité, plus régression canaux, lint, typecheck, build, continuité et CI;
- aucun compte, paiement, message externe, endpoint public, déploiement, fusion ou effet irréversible sans autorisation.

## État de vérité

- Livré : OS-1 à OS-4; sélection OS-5; outbound durable; worker; callbacks Twilio; transport injecté; coffre AES-256-GCM tenant/RLS, rotation, révocation et résolveurs éphémères.
- Réel préparé : inbound WhatsApp signé/tenant-mappé et chaîne outbound jusqu'au contrat client, avec stockage chiffré mais sans fabrique officielle branchée.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : clé de chiffrement, résolveurs, client et réponses Twilio de test; canal test, `tradikom_mock` et missions durables.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
