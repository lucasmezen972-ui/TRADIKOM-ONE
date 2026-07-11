# Connector SDK

Un connecteur expose :

- metadata : nom, description, statut, capacites
- auth : OAuth2, API key, basic, webhook, CSV, SFTP ou email parsing
- testConnection
- pull/sync
- push
- handleWebhook
- health
- normalizeError
- rateLimit metadata

Connecteurs MVP :

- Generic Webhook : token entrant, mapping JSON vers contact/lead, journal de livraison.
- CSV Contacts Import : mapping simple, validation, doublons probables, rapport.
- Mock Business Software : synchronisation simulee clients/rendez-vous/devis/factures.
