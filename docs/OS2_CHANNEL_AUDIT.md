# Audit des canaux OS-2

Date : 30 juillet 2026
Source normative : prompt maître, pages 13 à 15 et 64 à 68.

## Décision

OS-2 commence par un contrat commun et un registre de préparation sans transport. Aucun fournisseur ne peut être déclaré prêt tant que sa configuration, son consentement humain, sa vérification officielle et ses tests d'intégration ne sont pas réunis.

Les plugins Slack et Teams proposés mais non installés ne sont pas nécessaires à ce socle. Leur installation ou toute connexion de compte demanderait une décision explicite et des credentials; aucun accès externe n'est effectué dans ce checkpoint.

## Inventaire

| Canal | État du dépôt | Réutilisable | Écart avant transport |
| --- | --- | --- | --- |
| WhatsApp / Twilio | Absent du runtime courant; la PR #10 ne contient qu'un lien manuel `wa.me` | Normalisation d'un numéro et expérience de contact manuel, après extraction et nouveaux tests | SDK Twilio officiel, validation de signature sur URL exacte et paramètres bruts, idempotence Twilio, mapping d'identité, pièces jointes, envoi, statuts et consentement humain |
| Microsoft Teams | Absent | Contrats Conversation Hub, sécurité connecteurs, idempotence et audit communs | Application Microsoft, JWT officiel, consentement administrateur, mapping tenant/identité, webhook, envoi, erreurs et tests fournisseur |
| Slack | Absent | Contrats Conversation Hub, sécurité connecteurs, idempotence et audit communs | Application Slack, signature v0 avec horodatage/rejeu, OAuth humain, mapping d'identité, événements, envoi, erreurs et tests fournisseur |
| Email / Resend | Provider console/test sûr dans la branche; provider HTTP et suppressions présents dans la PR #10 | Mode console de développement et provider Resend HTTP de la PR #10 à extraire séparément | Refus production sans clé, expéditeur vérifié, signature Svix/Resend, bounce/suppression, idempotence, audit et tests d'intégration |

## Socle existant à conserver

- le Conversation Hub canonique pour les fils, messages, identités, provenance, idempotence et anti-boucle;
- `src/modules/connectors` pour les métadonnées, erreurs normalisées, chiffrement des secrets, HMAC et fenêtre anti-rejeu;
- le runtime de workflows pour les effets durables, reprises et preuves;
- les transactions tenant-aware, RLS et audits côté serveur;
- les providers email `console`, `test` et `unavailable` qui évitent déjà une fausse livraison en production.

## Contrat du premier checkpoint

Le module `src/modules/channels` définit désormais :

- quatre fournisseurs bornés et leurs capacités;
- les états `disabled`, `not_configured`, `awaiting_human_auth` et `ready`;
- l'invariant qu'un transport ne peut être actif que dans l'état `ready`;
- un webhook brut borné avant vérification, sans ingestion métier anticipée;
- les opérations de vérification, normalisation canonique, récupération autorisée des pièces jointes, envoi et normalisation d'erreurs;
- un registre sans appel réseau qui n'atteint jamais `ready` avec les seules variables d'environnement.

## Sécurité et limites

- Aucun secret réel n'est lu, écrit, journalisé ou envoyé.
- Aucun appel fournisseur, création d'application, OAuth, message ou dépense n'est réalisé.
- Le feature flag seul ne suffit jamais : les variables manquantes produisent `not_configured`; une configuration complète reste `awaiting_human_auth`.
- Les signatures ne sont pas simulées. L'adaptateur Twilio utilisera le SDK officiel, notamment parce que la signature dépend de l'URL publique exacte et du corps ou des paramètres reçus.
- Le registre prépare l'activation; il ne constitue pas encore un adaptateur entrant ni une preuve d'intégration réelle.

## Provider Email/Resend préparé

Le client HTTP extrait de la PR #10 est durci dans `src/modules/email/resend-provider.ts` : origine fixe, redirections refusées, timeout, contenu et réponse bornés, identifiant de réponse borné, clé d'idempotence opaque dérivée du payload exact et erreurs temporaires/permanentes sans fuite du corps fournisseur. Les conflits Resend `409` concurrents sont réessayables; une même clé avec un payload différent est permanente.

Il n'est pas sélectionné par `createRuntimeEmailProvider`. Même avec des noms de variables présents, le runtime retourne `unavailable`; la console reste locale et est toujours refusée en production. Le code est donc testable sans constituer une activation, un consentement ou une livraison réelle.

## Prochain incrément

Le vérificateur préparé utilise `svix@1.99.1`, refuse le secret absent, les en-têtes incomplets, les timestamps expirés, toute modification du corps et les payloads supérieurs à 512 Kio. Il ne retient que les événements opérationnels et retourne uniquement `svix-id`, tenant, email fournisseur, type, statut et date. Les ouvertures/clics et toutes les données personnelles du payload sont ignorés.

Le client d'envoi ajoute les tags bornés `tradikom_kind` et `tradikom_tenant`; Resend les restitue officiellement dans ses événements. Un événement sans tenant canonique est refusé au lieu d'être attribué par supposition.

Le prochain incrément doit persister la correspondance entre livraison et email fournisseur ainsi que `svix-id` sous RLS, vérifier cette correspondance après signature et gérer les événements tardifs sans régression d'état. Aucun endpoint public ne sera activé avant cette preuve.

## Références fournisseur vérifiées

- [API d'envoi Resend](https://resend.com/docs/api-reference/emails/send-email) : origine, payload et en-tête d'idempotence;
- [clés d'idempotence Resend](https://resend.com/docs/dashboard/emails/idempotency-keys) : limite de 256 caractères, rétention de 24 heures et conflits `409`;
- [classification officielle des erreurs](https://www.resend.com/docs/api-reference/errors) : authentification, quota, concurrence et indisponibilité;
- [vérification des webhooks Resend](https://resend.com/docs/webhooks/verify-webhooks-requests) : corps brut et en-têtes Svix obligatoires avant parsing.
- [types d'événements Resend](https://resend.com/docs/webhooks/event-types) : événements de livraison normalisés;
- [tags Resend](https://resend.com/docs/dashboard/emails/tags) : tags d'envoi restitués dans le webhook;
- [garanties de livraison webhook](https://resend.com/docs/webhooks/introduction) : livraison au moins une fois, ordre non garanti et déduplication par `svix-id`.
