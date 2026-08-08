# Sélection du premier provider réel - OS-5

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Décision : préparer puis valider **WhatsApp via Twilio Sandbox** comme premier provider réel
- État à ce checkpoint : `disabled`; il ne pourra passer à `awaiting_human_auth` qu'après configuration explicite, sans compte, credential, endpoint public, message externe ni dépense dans ce checkpoint
- Source normative : prompt maître PDF, pages 3-7, 13-15, 26-33, 46, 48 et 64-71

## Décision conversation-first

WhatsApp via Twilio Sandbox est le seul candidat qui combine le parcours demandé par la north star et le niveau de préparation actuel du dépôt : un utilisateur rejoint une sandbox depuis son téléphone, écrit dans WhatsApp, le message signé rejoint le fil canonique, une réponse approuvée repart par le provider et la preuve revient dans la même conversation.

La sandbox officielle permet l'envoi, la réponse, une URL de webhook et une URL de callback sans WhatsApp Business Account ni expéditeur WhatsApp enregistré. Un compte d'essai inclut actuellement 100 messages WhatsApp dans ses unités gratuites. Ce coût nul est borné : aucun message ne devra être envoyé si les unités gratuites ne sont pas visibles ou sont épuisées, et aucun upgrade ne sera accepté dans cette tranche.

Resend demande moins d'autorisations mais ne constitue pas le meilleur premier parcours conversationnel dans l'état présent du code : le transport sortant est limité aux emails applicatifs, le runtime de production le refuse encore et `email.received` n'est pas projeté vers le Conversation Hub. Slack et Teams permettraient une vraie conversation, mais exigent une installation d'application, des permissions de workspace ou tenant et davantage de consentements.

## Audit comparatif des frontières préparées

| Candidat | Preuve conversationnelle possible | Coût nul officiel | Intervention humaine | État réel du dépôt | Décision |
| --- | --- | --- | --- | --- | --- |
| WhatsApp / Twilio | Bidirectionnel : message téléphone -> webhook -> fil web, puis réponse web -> WhatsApp | Sandbox d'essai; 100 messages inclus dans les unités gratuites, sans WABA ni sender enregistré | Compte/login, vérification du téléphone, acceptation Sandbox, `join`, credentials et URL HTTPS | Inbound, outbound durable, callbacks et frontière client injectée livrés avec doubles; coffre chiffré, client officiel et promotion runtime absents | **Retenu** |
| Email / Resend | Outbound applicatif et événements de livraison; une vraie réponse email n'entre pas encore dans le fil | Plan gratuit; `resend.dev` envoie seulement à l'adresse du compte sans domaine | Compte/login, clé, webhook; domaine/DNS seulement pour d'autres destinataires | Provider d'envoi borné et webhooks de livraison livrés, mais runtime réel refusé et `email.received` non supporté | Rejeté pour la première preuve conversationnelle |
| Slack | Bidirectionnel possible via Events API et Web API | Workspace gratuit possible, sous limite d'apps | Création d'app, installation workspace, OAuth/scopes, token, signing secret et endpoint ou Socket Mode | Inbound signé et fil canonique livrés; OAuth, stockage token et outbound absents | Différé : surface d'autorisation supérieure |
| Microsoft Teams | Bidirectionnel possible avec agent/bot dans Teams | Playground local gratuit, mais ce serait une simulation; le test Teams réel demande tenant/app/tunnel | Compte Microsoft, tenant, application, endpoint et consentements potentiellement administrateur | Validation JWT et inbound canonique livrés; provisioning, consentement, token et outbound absents | Différé : intervention humaine la plus forte |

## Preuves repository-grounded

- `src/modules/channels/provider-registry.ts` garde les quatre providers dans `disabled`, `not_configured` ou `awaiting_human_auth`; `transportEnabled` reste toujours `false` et l'URL de callback de statut est désormais une configuration obligatoire distincte.
- `src/app/api/webhooks/twilio/whatsapp/route.ts` refuse avant lecture tant que le registre ne produit pas `ready` et exige une URL publique HTTPS configurée.
- `src/modules/channels/whatsapp-twilio-webhook.ts` vérifie la signature avec le SDK Twilio officiel sur l'URL exacte et borne le payload.
- `src/modules/channels/whatsapp-twilio-ingress-service.ts` résout un endpoint actif sous transaction système, pseudonymise l'identité avec HMAC tenant-scoped et ingère dans le Conversation Hub.
- `src/modules/channels/provider-endpoints-service.ts` réserve et désactive les endpoints avec contrôle de rôle, unicité inter-tenant et audit sans numéro ni secret.
- Le contrat `ChannelAdapter.sendMessage`, la réservation durable, le worker avec lease/backoff et la réconciliation canonique sont livrés avec un transport mock injecté.
- `src/modules/channels/whatsapp-twilio-transport.ts` reçoit uniquement les références sûres tenant/endpoint/identité après membership et policy, résout credentials et adresses éphémèrement, exige l'URL HTTPS de callback et construit uniquement un client injecté. Aucun résolveur de secrets réel ni client Twilio officiel n'est branché.
- Le callback de statut vérifie la signature Twilio officielle sur l'URL exacte, normalise `queued/sent`, `delivered/read` et `failed/undelivered`, déduplique sans stocker le SID dans le journal d'événements et refuse toute régression après `delivered`.
- Les tests actuels prouvent signature, replay, ordre tardif, mapping absent/désactivé, isolation tenant/RLS, audit sans PII et absence d'accès réseau; ils ne prouvent aucune requête contre la sandbox.

## Sources officielles vérifiées le 8 août 2026

- [Twilio - Test WhatsApp messaging with the Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) : sandbox de test, envoi/réponse, webhooks, absence de WABA/sender enregistré, procédure `join`, limites et unités d'essai.
- [Twilio - Try out WhatsApp Messaging](https://www.twilio.com/docs/usage/trials/try-out-whatsapp) : téléphone vérifié, templates d'essai, réception et configuration du webhook.
- [Resend - domaine `resend.dev`](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) : envoi de test limité à l'adresse du compte sans domaine vérifié.
- [Resend - tarifs](https://resend.com/docs/knowledge-base/what-is-resend-pricing) : plan transactionnel gratuit et quotas courants.
- [Resend - réception d'emails](https://resend.com/docs/dashboard/receiving/introduction) : événement `email.received`, URL publique ou tunnel et signature webhook nécessaires.
- [Slack - Events API](https://docs.slack.dev/apis/events-api/) et [installation OAuth](https://docs.slack.dev/authentication/installing-with-oauth/) : app, scopes, consentement, token et livraison via endpoint HTTP ou Socket Mode.
- [Microsoft - test avec Dev Tunnels](https://learn.microsoft.com/en-us/microsoft-agent-365/developer/test-with-devtunnels) : authentification, tunnel public, endpoint et test dans Teams; le Playground local n'est pas une preuve de provider réel.

## Contrat de preuve vertical OS-5

La tranche ne pourra passer à `completed` que si une exécution réelle, distincte des mocks, prouve les points suivants :

1. Un téléphone autorisé rejoint explicitement la Twilio Sandbox et envoie un message de test sans donnée métier sensible.
2. Twilio signe le webhook; TRADIKOM ONE vérifie la signature avant la base, résout exactement un tenant et crée ou retrouve un seul fil canonique.
3. Le message apparaît dans l'interface Conversation en français avec origine WhatsApp explicite.
4. Une réponse bornée et approuvée dans le fil utilise le runtime commun, la policy, une clé d'idempotence, un audit sûr et le transport Twilio officiel.
5. Le téléphone reçoit une seule réponse; un replay du webhook et un double clic ne créent ni second message, ni seconde livraison, ni second audit.
6. Un callback de livraison ou une réponse WhatsApp fait converger l'état sans exposer numéro, corps, token ou payload fournisseur dans les logs et audits.
7. La désactivation de l'endpoint empêche toute nouvelle ingestion et tout nouvel envoi; la révocation des credentials laisse le provider dans un état honnête `revoked` ou `not_configured`.
8. Unit, intégration, PostgreSQL/RLS, provider, sécurité, workflow, Playwright mobile/desktop et accessibilité passent; la CI du head est verte.

## Intervention humaine minimale indispensable

```text
Checkpoint humain OS-5 - ne transmettre aucun secret dans le chat.

1. Autoriser explicitement la création ou l'utilisation d'un compte Twilio d'essai dédié à TRADIKOM ONE.
2. Dans la console officielle, confirmer que l'essai affiche encore des unités gratuites et qu'aucun upgrade, moyen de paiement ou engagement payant n'est requis.
3. Activer « Try WhatsApp », accepter les conditions de la Sandbox et vérifier le numéro de téléphone de test si Twilio le demande.
4. Depuis ce téléphone, rejoindre la Sandbox avec le QR code ou le message `join` affiché par Twilio.
5. Autoriser un endpoint HTTPS de développement temporaire et révocable pour les webhooks; ne pas autoriser de déploiement production.
6. Autoriser le stockage de l'Account SID, de l'Auth Token et du sender Sandbox uniquement dans le gestionnaire de secrets local ou de preview. Ne jamais les copier dans le chat, le dépôt, les logs ou les audits.
7. Confirmer l'envoi d'au plus deux messages de preuve vers le seul téléphone de test, puis la désactivation de l'endpoint et la révocation du tunnel à la fin.
```

Sans cette autorisation, aucun compte, credential, tunnel, webhook fournisseur, endpoint actif ou message réel ne doit être créé. Le transport sortant, son worker durable, les callbacks de statut et la frontière client/résolveurs éphémères sont maintenant prouvés avec doubles. Le travail non bloqué suivant est le coffre chiffré et rotatif tenant-aware qui alimentera ces résolveurs sans activer le provider runtime ni effectuer d'appel réseau réel.

## Classification honnête

| Qualification | État après cet audit |
| --- | --- |
| Livré | audit comparatif, sélection unique, contrat de preuve et checkpoint humain exact |
| Réel préparé | frontières protocolaires Resend, WhatsApp/Twilio, Teams et Slack; WhatsApp inbound, outbound durable, callbacks canoniques et transport à client injecté |
| Réel connecté | aucun provider |
| Sandbox | aucune sandbox créée, configurée ou appelée |
| Mock | événements provider des tests, `tradikom_mock` et canal test |
| Bloqué humain | compte Twilio, téléphone, conditions Sandbox, credentials, URL HTTPS et autorisation des deux messages |
| Hors périmètre immédiat | sender WhatsApp production, WABA, paiement, Meta direct, Slack/Teams/Resend actifs, fusion et déploiement |

## Écarts restants avant activation

- conserver credentials, sender et destination dans un coffre chiffré et rotatif tenant-aware, puis brancher les résolveurs par références, jamais comme valeurs claires en base ou audit;
- instancier le client Twilio officiel derrière la fabrique injectée uniquement après configuration et autorisation explicites;
- créer une procédure d'activation, santé, rotation, révocation et désactivation explicite;
- ajouter la preuve Playwright web + WhatsApp sandbox, plus les pires cas de la matrice page 69;
- obtenir l'intervention humaine ci-dessus avant toute mutation externe.
