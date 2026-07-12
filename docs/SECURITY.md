# Security

## Modele de menace

Risques principaux : fuite cross-tenant, vol de session, injection SQL, XSS via contenu de site, webhook abuse, secrets connecteurs, actions IA non approuvees.

## Mesures MVP

- Mots de passe hashes avec scrypt et salt unique.
- Sessions HTTP-only, SameSite Lax, Secure en production.
- Tokens de session hashes en base avec révocation serveur au logout.
- Tokens de reset password et d'invitation hashes en base, expirables et a usage unique.
- Requetes parametrees PGlite/Postgres.
- Validation Zod des entrees critiques.
- Membership verifie cote serveur avant acces tenant.
- Audit log pour actions importantes.
- Webhook avec token unique et secret optionnel.
- Fondations HMAC webhook et chiffrement AES-256-GCM des secrets connecteurs.
- Credentials connecteurs modelises separement pour chiffrement futur.
- Aucune cle reelle commitee.
- Limitation de debit atomique et partagee pour authentification, invitations, formulaires publics, demo et webhooks, avec cles de sujet et de tenant hachees.
- Liens de reinitialisation et d'invitation remis uniquement au fournisseur e-mail; jetons bruts absents des logs, de la base et des reponses ordinaires.

## Production hardening

- Activer PostgreSQL RLS.
- Completer les tests RLS avec role PostgreSQL non proprietaire.
- Ajouter CSRF token explicite pour mutations critiques.
- Ajouter CSP stricte et validation upload.
- Chiffrer credentials avec KMS.
- Ajouter monitoring, alertes et journaux structures centralises.
- Ne pas declarer la conformite RGPD sans audit juridique.
