# Procédure d'activation WhatsApp via Twilio - OS-5

Cette procédure prépare un test Sandbox réversible. Elle ne vaut ni autorisation de production, ni autorisation de paiement, ni autorisation d'envoyer plus de deux messages. Aucun secret ne doit être copié dans le chat, le dépôt, les logs ou les audits.

## États de santé

- `disabled` : le feature flag est coupé; aucun prérequis sensible n'est inspecté et aucune action n'est possible.
- `not_configured` : le manifeste, les références gérées, l'endpoint tenant-aware ou une URL HTTPS est absent ou invalide.
- `awaiting_human_auth` : les métadonnées techniques sont prêtes, mais l'autorisation durable manque, est introuvable, invalide, expirée ou révoquée.
- `degraded` : le checkpoint humain est valide, mais le registre réel conserve volontairement le transport désactivé.
- `ready` : état futur réservé à une composition explicitement autorisée; le registre préparé actuel ne peut pas le produire.

La readiness reçoit uniquement l'identifiant interne d'une autorisation et la charge par le service tenant/endpoint-scoped. Elle n'accepte plus d'objet de preuve libre, n'appelle jamais Twilio, ne résout aucune référence du gestionnaire de secrets, ne construit aucun keyring et ne retourne ni référence, Account SID, numéro, token ou URL complète.

## Checkpoint humain obligatoire

1. Autoriser un compte Twilio d'essai dédié et confirmer qu'aucun moyen de paiement ni upgrade n'est requis.
2. Vérifier que les unités gratuites sont visibles, accepter les conditions de la Sandbox et joindre le seul téléphone de test.
3. Autoriser un endpoint HTTPS temporaire et révocable pour le webhook entrant et le callback de statut.
4. Autoriser le stockage des credentials uniquement dans le gestionnaire de secrets choisi, jamais en clair dans la configuration.
5. Produire via `issueWhatsAppTwilioActivationAuthorization`, après contrôle propriétaire/administrateur et jamais depuis une entrée navigateur brute, une autorisation liée au tenant et à l'endpoint avec portée `twilio_whatsapp_sandbox`, expiration explicite, confirmation des unités gratuites et plafond d'un ou deux messages.

Sans ces cinq validations, l'état doit rester `awaiting_human_auth` ou inférieur.

## Preuve durable et révocation

- La table `channel_provider_activation_authorizations` conserve uniquement des identifiants internes, la portée, le plafond, la confirmation des unités gratuites, les dates, les acteurs et le hash de la clé d'idempotence.
- La table est tenant-owned, reliée à l'endpoint par clé composite, indexée tenant-first et protégée par RLS. Elle ne contient ni secret, numéro, URL, SID, corps, ciphertext ou référence complète.
- Une émission rejouée avec la même clé et le même contrat retourne la preuve existante sans second audit; une collision avec un autre contrat est refusée.
- `revokeWhatsAppTwilioActivationAuthorization` rend la révocation monotone et auditée. Une preuve révoquée ou expirée redescend à `awaiting_human_auth`.
- La table `channel_provider_activation_consumptions` associe immuablement une unité à une livraison du même tenant, endpoint et provider. Elle verrouille le plafond sous concurrence et permet au worker de retrouver l'autorisation par `delivery_id` sans la transporter à nouveau.
- Pour un manifeste `ready`, le service outbound exécute obligatoirement membership, contexte/claim et policy avant de consommer une unité, puis appelle le transport. Absence, expiration ou révocation finalisent un refus durable avant adaptateur, credentials, destination, client ou réseau. Les transports `mock` ne consomment jamais ce plafond humain.

## Activation et test borné

1. Vérifier que le feature flag, les références versionnées du keyring, l'endpoint actif du bon tenant, les deux URLs HTTPS et l'autorisation interne chargée par référence passent la readiness.
2. Vérifier que le registre est explicitement promu par une future tranche autorisée; la présente tranche ne le fait pas.
3. Construire le keyring depuis le gestionnaire de secrets uniquement après l'état `ready`, puis créer les résolveurs tenant-aware et la fabrique officielle.
4. Fournir l'identifiant d'autorisation seulement dans les options serveur internes du premier essai; laisser les retries le retrouver par la consommation liée à la livraison. Envoyer au plus le nombre de messages autorisé vers le téléphone de test, avec policy, idempotence, mission durable et audit sans contenu sensible.
5. Prouver réception unique, callback monotone, replay sans doublon et miroir dans la conversation web.

## Rotation, révocation et désactivation

1. Rotation : ajouter une nouvelle version de clé gérée, la déclarer active, rechiffrer par le service tenant-aware puis vérifier la lecture avant de révoquer l'ancienne version.
2. Révocation : révoquer d'abord l'autorisation d'activation, puis les secrets endpoint et identité; confirmer que les résolveurs échouent fermé et que la santé redescend à `awaiting_human_auth`, `not_configured` ou `degraded` selon le prérequis manquant.
3. Désactivation : couper d'abord le transport et le feature flag, désactiver l'endpoint, retirer les URLs du tunnel, puis révoquer le tunnel et les credentials d'essai.
4. Audit : conserver uniquement tenant, acteur, type d'action, cible interne, état et corrélation; jamais numéro, corps, SID, ciphertext, token ou référence complète.

## Rollback et limite irréversible

La configuration, l'endpoint, le tunnel, les secrets et le feature flag sont révocables. Un message déjà remis à Twilio ou au téléphone ne peut pas être annulé; le rollback empêche uniquement les actions futures et ne doit jamais promettre l'effacement d'un effet externe déjà produit.
