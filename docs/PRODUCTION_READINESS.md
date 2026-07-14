# Preparation production

## Architecture d'exploitation

- PostgreSQL 17 est obligatoire en production.
- Le role de migration possede les droits DDL; le role runtime reste restreint et soumis aux politiques RLS.
- L'application web et le worker utilisent des identites separees lorsque la plateforme le permet.
- Les workers sont limites en batch, gerent SIGTERM/SIGINT et reprennent les baux expires.
- HTTPS termine avant l'application; cookies securises, HSTS et CSP sont actives en production.

## Configuration obligatoire

- `NODE_ENV=production`.
- `APP_URL` public en HTTPS.
- `DATABASE_URL` PostgreSQL sans credential affiche dans les logs.
- `DATABASE_POOL_MAX` borne.
- `CONNECTOR_ENCRYPTION_KEY` non vide, non exemple et gere comme secret versionne.
- `COOKIE_SECURE=true`.
- `FEATURE_PUBLIC_DEMO=false`.
- `FEATURE_LIVE_INTEGRATIONS=false` tant qu'aucun flux Phase 4 n'est approuve.
- Un fournisseur email de production; `console` et `test` sont interdits sauf derogation explicite de developpement.
- `WORKER_MODE`, taille de batch et intervalle adaptes au deploiement.
- Fuseau metier IANA valide, limites de taux et maintenance explicitement configurees.

La validation Zod demarre avant le runtime et retourne uniquement les noms de variables invalides, jamais leur valeur.

## Sante et observabilite

- La route de sante ne retourne ni secret, ni stack, ni detail SQL.
- La readiness doit verifier l'acces PostgreSQL et les migrations attendues.
- La liveness verifie seulement que le processus repond.
- Les erreurs utilisent des identifiants de correlation et des messages publics bornes.
- Des alertes doivent couvrir workflows, dead letters, webhooks, connecteurs, relectures API, contrats, approbations en attente et retards de worker.
- Les logs ne contiennent ni token, ni payload sensible, ni URL avec identifiants.

## Donnees et reprise

- Executer les migrations depuis une base vide et depuis la derniere base Phase 2.
- Conserver la validation RLS restreinte dans la CI obligatoire.
- Tester sauvegarde et restauration selon `docs/BACKUP_AND_RECOVERY.md`.
- Executer la maintenance avec une identite controlee et surveiller ses comptes de suppression.
- Preserver audits, approbations, preuves actives, publications de rollback et historique de changements API.

## Checklist avant trafic

- [ ] CI du SHA de deploiement entierement verte.
- [ ] Migrations propres sur PostgreSQL 17 vide et sur copie de la base courante.
- [ ] Role runtime sans DDL et tests RLS passes.
- [ ] Secrets presents dans le gestionnaire de secrets et absents des logs.
- [ ] Fournisseur email reel teste; console/test desactives.
- [ ] Demo publique et seed desactives.
- [ ] Cookies, CSP, HSTS, no-store des pages de token et HTTPS verifies.
- [ ] Worker unique demarre, puis montee en charge controlee.
- [ ] Readiness, liveness, correlation et alertes verifies.
- [ ] Backup recent et restauration testee.
- [ ] Procedure de rollback applicative et base approuvee.
- [ ] Mode maintenance teste.
- [ ] Limites produit communiquees aux operateurs.

## Limites actuelles

- Aucun connecteur genere n'est installe ou active en production.
- Aucun appel sandbox externe ou ecriture reelle n'est execute par les contrats.
- Les contrats sont mock/statiques et ne prouvent pas une compatibilite reelle.
- Il n'existe pas d'approbation production.
- La decouverte Internet generale est interdite.
- SMS et WhatsApp restent simules.
- Il n'existe pas de marketplace publique de connecteurs.
- Les operations de plusieurs formats autoritatifs ne sont pas fusionnees.
- Le fournisseur OpenAI reste optionnel et desactive sans configuration explicite.
