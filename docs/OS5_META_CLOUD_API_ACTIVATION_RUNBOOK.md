# Procédure d'activation WhatsApp Cloud API (Meta) - OS-5

Cette procédure décrit une future activation bornée. Elle ne vaut ni autorisation de créer ou modifier un compte Meta, ni autorisation de saisir des secrets, ni autorisation d'envoyer un message externe. Le transport Graph livré reste sans composition réelle et le registre préparé ne produit pas l'état `ready`.

Référence du contrat HTTP : [collection officielle WhatsApp Cloud API de Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## États de santé

- `disabled` : le feature flag est coupé et aucune action n'est possible.
- `not_configured` : une variable, une référence gérée, un endpoint tenant-aware ou une liaison d'identité manque.
- `awaiting_human_auth` : les prérequis déclaratifs existent, mais l'autorisation humaine et fournisseur n'est pas prouvée.
- `mock` : le transport et les réponses sont injectés par les tests; aucun réseau fournisseur n'est appelé.
- `ready` : état futur réservé à une composition serveur explicitement autorisée, avec endpoint, credentials et destination résolus par tenant.

Le transport réel refuse `disabled`, `not_configured` et `awaiting_human_auth` avant toute résolution de credentials, destination ou requête HTTP. Un manifeste `ready` sans transport composé redescend en `not_configured`.

## Variables et références attendues

Les placeholders sont versionnés dans `.env.example`; leurs valeurs restent hors dépôt et hors conversation :

- `FEATURE_CHANNEL_WHATSAPP_META`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_GRAPH_API_VERSION`
- `META_WHATSAPP_WABA_ID`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `META_WHATSAPP_WEBHOOK_URL`
- `CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION`
- `CHANNEL_PROVIDER_SECRET_KEY_REFERENCES`

Le token, l'App Secret et le verify token doivent provenir du gestionnaire de secrets au moment de l'exécution. Le transport ne lit aucune variable globale : il reçoit seulement des résolveurs serveur tenant/endpoint-scoped. La destination est résolue séparément par `tenantId`, `endpointId` et `channelIdentityId` puis utilisée en mémoire.

## Checkpoint humain obligatoire

1. Autoriser un compte de développement Meta dédié, l'app, le portefeuille WhatsApp Business, le numéro de test et l'absence d'engagement payant.
2. Confirmer dans la console officielle les permissions minimales requises pour l'essai, notamment la messagerie WhatsApp et, si nécessaire à l'administration, la gestion WhatsApp Business; ne pas demander de portée supplémentaire.
3. Autoriser un endpoint HTTPS temporaire et révocable, puis valider le challenge et la signature `X-Hub-Signature-256` avant toute ingestion.
4. Autoriser le stockage des credentials uniquement dans le gestionnaire de secrets choisi et la version Graph explicitement épinglée.
5. Autoriser séparément un message de preuve vers un unique destinataire de test, avec plafond explicite et classification `sandbox` ou `réel`.

Sans ces cinq validations, l'état reste `awaiting_human_auth` ou inférieur et aucun client réseau n'est composé.

## Composition serveur autorisée

1. Charger l'endpoint actif et les références chiffrées par les services tenant-aware existants, après membership et policy.
2. Résoudre en mémoire le token, le Phone Number ID, la version Graph épinglée et le numéro destinataire; ne jamais les placer dans l'audit ou la réponse applicative.
3. Composer `createWhatsAppMetaTransport` avec les résolveurs et un `fetch` serveur seulement après la preuve d'autorisation.
4. Promouvoir explicitement le manifeste en `ready`; le registre préparé ne le fait jamais automatiquement à partir des variables.
5. Laisser le service durable réserver l'idempotency key avant le transport. Le transport effectue une seule tentative HTTP; le worker conserve la responsabilité du lease, du backoff et des retries.

La requête sortante est bornée à `POST https://graph.facebook.com/{version}/{phone-number-id}/messages`, avec `Authorization: Bearer`, `Content-Type: application/json` et un message texte individuel. La réponse est limitée à 64 Kio et seul l'identifiant `messages[0].id` est conservé comme référence fournisseur sûre.

## Erreurs, quotas et audit

- `401`/`403` : `auth`, sans retry automatique.
- `429` : `rate_limit`, retry durable avec backoff.
- `408`, `425` et `5xx` : `temporary`, retry durable avec backoff.
- autres `4xx` : `permanent`.
- réponse malformée ou hors borne : `validation`.
- panne réseau ou timeout : `temporary`.

Les erreurs normalisées ne contiennent jamais token, numéro, contenu, URL complète résolue ou corps de réponse Meta. Les audits existants conservent seulement tenant, acteur, action, cible interne, statut, classification et corrélation.

## Preuve attendue et rollback

La preuve finale OS-5 devra montrer une réception unique, la continuité dans la conversation, le replay sans second envoi, le callback monotone et l'audit sans contenu sensible. Tant que le checkpoint humain n'est pas accordé, seuls les tests injectés sans réseau constituent une preuve logicielle.

Pour désactiver : couper d'abord le transport et le feature flag, désactiver l'endpoint, révoquer les credentials et le tunnel HTTPS, puis vérifier le retour à `disabled`, `not_configured` ou `awaiting_human_auth`. Un message déjà accepté par Meta est irréversible; le rollback empêche uniquement les actions futures.
