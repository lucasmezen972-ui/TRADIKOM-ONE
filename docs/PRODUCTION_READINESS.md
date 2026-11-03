# Preparation production

## État vérifié — 30 octobre 2026

Le lot de dépendances et de durabilité Goal Watch est vérifié, sans GitHub Actions ni installation sur le Mac. L'audit complet retourne **zéro avis**. La suite exhaustive de la base `69a0660` passe **1 048 tests dans 181 fichiers**. Le correctif final `fa3b391` passe **52 tests ciblés**, dont deux PostgreSQL réels, ainsi que lint, typecheck, build et **20 scénarios Playwright**.

Ces deux périmètres sont distincts : la suite exhaustive n'a pas été rejouée après le correctif Goal Watch. Le reçu de sa recette ciblée retourne le code zéro sur son SHA exact. Le conteneur PostgreSQL jetable est supprimé et le Codespace a été arrêté, confirmation GitHub relue.

La PR reste en brouillon, sans fusion ou déploiement. Supabase demeure inactif. Les intégrations réelles, le parcours de consentement et d'arrêt des objectifs, la voix/documents et l'installation tierce minimale restent à finaliser. **TRADIKOM ONE n'est pas déclaré terminé.**

Preuves : [validation](./VALIDATION_2026-10-30.md), [état de livraison](./DELIVERY_STATUS.md) et [recette distante](./CLOUD_VALIDATION.md). Les états datés plus anciens ci-dessous sont historiques.

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

## Préparation supplémentaire du 30 octobre 2026

Les chemins applicatifs des objectifs internes sont durcis et un adaptateur modèle autonome est préparé. Ces changements n'activent aucun fournisseur ni suivi programmé. Le projet Vercel est configuré en Node22 avec protection conservée, sans déploiement. La recette isolée Linux/PostgreSQL17 est décrite dans `docs/CLOUD_VALIDATION.md`.

Les contrôles ciblés en mémoire ne lèvent aucune case de la checklist avant trafic. La base applicative, les accès opérateur et le budget du runner doivent être confirmés; les politiques RLS et limites d'évaluation des objectifs restent à auditer. Garder la PR en brouillon tant que la recette complète du nouveau SHA n'est pas exécutée.


## Dépendances et validation distante du 30 octobre 2026

Les dépendances corrigées donnent zéro avis dans l'audit de production sans ignoreGhsas. Un override MSAL7.1.0 limité au SDK Teams est couvert par10 tests natifs sans réseau; cela ne constitue pas une certification de Microsoft ni une validation OAuth/identité managée en production. Lint, typecheck et23 tests natifs OpenAI/accès objectifs passent. La recette exhaustive du nouveau SHA dans Codespaces, dont PostgreSQL/RLS, restauration, build corrigé et Playwright, reste obligatoire. La base applicative Supabase et les fournisseurs réels ne sont pas rétablis par ces contrôles. La PR reste en brouillon.


## Portée de la recette finale du 30 octobre

La recette de fa3b391fdc80b7a477a929af038e32aa3c17096b est verte dans un runner jetable : voir VALIDATION_2026-10-30.md. Elle ne valide pas la base Supabase inactive, les secrets de production, les fournisseurs réels, le worker exploité ou les sauvegardes de production. Les cases d'exploitation restent à vérifier avant trafic. Aucune fusion ni mise en production.
