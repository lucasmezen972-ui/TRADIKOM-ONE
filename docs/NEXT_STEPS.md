# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. Inbound signé, outbound durable, worker, callbacks, coffre, résolveurs éphémères, bootstrap keyring, fabrique officielle, readiness et composition fail-closed sont livrés avec doubles. Aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est d'ajouter une autorisation d'activation durable dans `src/modules/channels/whatsapp-twilio-activation-authorization-service.ts`, avec migration additive et miroir SQL. Seuls un propriétaire ou administrateur du tenant pourront émettre ou révoquer une autorisation `twilio_whatsapp_sandbox`, expirante, plafonnée à deux messages et auditée sans donnée sensible. La readiness devra charger cette preuve interne tenant-scoped au lieu d'accepter un objet libre. Le registre restera incapable de produire `ready` dans ce checkpoint et aucun appel Twilio ne sera effectué.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement, en texte et en rendu. Les pages 14, 18, 22, 26, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider sans logique métier, tenant/RLS, action durable, policy, audit, états honnêtes, secrets protégés et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel 1bdc5c4, dont la CI 31279987333 et la continuité 31279987339 sont vertes, puis vérifier le head documentaire courant de la PR brouillon #11.
4. Relire docs/OS5_PROVIDER_SELECTION.md et docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md.
5. Ajouter une table d'autorisations d'activation tenant-owned avec relations composites, index tenant-leading, RLS et expiration; ne stocker aucun secret, numéro, URL ou contenu.
6. Ajouter un service create/revoke/read exigeant owner ou administrator, idempotence, preuve du checkpoint humain sous forme de métadonnées sûres et audits sans contenu sensible.
7. Faire consommer à la readiness uniquement une autorisation chargée par le service tenant-aware; refuser expiration, révocation, autre tenant, autre provider et plafond supérieur à deux messages.
8. Prouver migration vide/upgrade, restricted-role RLS, replay, révocation monotone, audit sûr et zéro resolver/client/fetch.
9. Ne promouvoir aucun manifeste vers ready et ne créer aucune Sandbox, credential, URL publique ou message réel sans l'autorisation humaine externe.
```

## Critères du prochain checkpoint

- autorisation persistée avec `tenant_id`, relations composites, RLS, expiration, révocation et idempotence;
- rôle propriétaire/administrateur, membership et tenant vérifiés côté service;
- aucun secret, numéro, URL, message, SID, ciphertext ou référence complète en base, réponse ou audit;
- readiness impossible à activer avec une preuve libre, expirée, révoquée ou inter-tenant;
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
6. Autoriser au plus deux messages de preuve, puis désactivation et révocation.
```

## État de vérité

- Livré : OS-1 à OS-4; sélection OS-5; chaîne WhatsApp préparée; readiness; composition fail-closed; runbook opérateur.
- Réel préparé : inbound signé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel fournisseur.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique uniquement dans les tests.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials gérés, endpoint HTTPS et autorisation d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
