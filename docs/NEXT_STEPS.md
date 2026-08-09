# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le candidat unique OS-5 reste **WhatsApp via Twilio Sandbox**. La preuve d'autorisation et son plafond d'un ou deux messages sont désormais persistés, tenant-aware, expirants, révocables et consommables atomiquement par livraison. La readiness ne reçoit plus de preuve libre et le registre reste incapable de produire `ready`; aucun provider réel ou Sandbox n'est connecté.

La prochaine action non bloquée est de brancher `reserveWhatsAppTwilioActivationBudget` dans `src/modules/channels/whatsapp-twilio-outbound-service.ts` juste avant le premier appel d'un transport futur `ready`. L'`authorization_id` doit rester récupérable par la consommation liée au `delivery_id`; tout retry doit retrouver la même unité, et tout envoi sans consommation active doit échouer avant résolveurs, client ou réseau. Le registre réel conserve `transportEnabled: false` et aucun appel Twilio ne sera effectué.

## Référence prompt maître

Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement, en texte et en rendu. Les pages 14, 18, 22, 26, 28-29, 32, 37, 64, 66 et 69 imposent frontière provider, tenant/RLS, action durable, idempotence, policy, audit sans contenu sensible, état honnête et tests provider/sécurité.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Partir du commit fonctionnel b561ac0 et confirmer la CI PostgreSQL/Playwright du lot de consommation atomique.
4. Relire docs/OS5_PROVIDER_SELECTION.md et docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md.
5. Ajouter l'autorisation d'activation au contrat interne du premier envoi futur ready, sans l'exposer au navigateur ni au message canonique.
6. Appeler la réservation de budget après membership/contexte/policy et immédiatement avant tout transport; aucun resolver ou client ne doit être atteint si elle échoue.
7. Sur retry worker, retrouver la consommation par delivery_id et conserver le même authorization_id sans seconde unité ni second audit d'effet.
8. Prouver ordre des gardes, expiration/révocation après consommation, retry, concurrence et zéro réseau dans les états réels désactivés.
9. Ne promouvoir aucun manifeste vers ready et ne créer aucune Sandbox, credential, URL publique ou message réel sans l'autorisation humaine externe.
```

## Critères du prochain checkpoint

- réservation du budget obligatoire avant tout futur transport `ready` et après policy;
- association durable `delivery_id` -> `authorization_id` récupérable par le worker;
- expiration, révocation, endpoint désactivé et budget épuisé refusés avant secrets/client/réseau;
- retry/replay sans seconde unité ni second audit d'effet, y compris après reprise worker;
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

- Livré : OS-1 à OS-4; sélection OS-5; chaîne WhatsApp préparée; readiness; autorisation durable; consommation atomique du plafond; runbook.
- Réel préparé : inbound signé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel fournisseur.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique uniquement dans les tests; aucune consommation de test n'est présentée comme un message réel.
- Bloqué humain : compte Twilio, téléphone, conditions Sandbox, credentials gérés, endpoint HTTPS et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre immédiat : sender WhatsApp production, WABA, OS-6 à OS-8, fusion et déploiement.
