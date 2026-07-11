# Security

## Modele de menace

Risques principaux : fuite cross-tenant, vol de session, injection SQL, XSS via contenu de site, webhook abuse, secrets connecteurs, actions IA non approuvees.

## Mesures MVP

- Mots de passe hashes avec scrypt et salt unique.
- Sessions HTTP-only, SameSite Lax, Secure en production.
- Requetes parametrees PGlite/Postgres.
- Validation Zod des entrees critiques.
- Membership verifie cote serveur avant acces tenant.
- Audit log pour actions importantes.
- Webhook avec token unique et secret optionnel.
- Credentials connecteurs modelises separement pour chiffrement futur.
- Aucune cle reelle commitee.

## Production hardening

- Activer PostgreSQL RLS.
- Ajouter rate limiting distribue.
- Ajouter CSRF token explicite pour mutations critiques.
- Ajouter CSP stricte et validation upload.
- Chiffrer credentials avec KMS.
- Ajouter monitoring, alertes et journaux structures centralises.
- Ne pas declarer la conformite RGPD sans audit juridique.
