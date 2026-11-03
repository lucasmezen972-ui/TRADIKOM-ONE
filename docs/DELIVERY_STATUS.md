## Candidat produit vérifié — 3 novembre 2026

Source publié : `0da2c88ad2f7cd89526fc797530634251f4470fe` dans la PR 11 en brouillon. Objectifs avec consentement/pause/reprise/arrêt et RLS fine ; tâche CRM réelle et idempotente ; documents TXT/CSV/PDF texte chiffrés et téléchargement authentifié ; dictée après consentement ; connecteur GitHub public install/read/revoke. Génération OpenAI raccordée à une réservation durable, désactivée sans clé/budget dédiés. Le pipeline des plans reste mock et aucun message externe n’est envoyé.

Quatre parcours Playwright, lint, TypeScript et build de production réussis. PDF réellement extrait et dépendances du worker présentes dans les traces de production. Quatorze tests modèle/documents/connecteur passent sur PostgreSQL 17.5 embarqué. Le lot SQL exact 124→132 passe sur la copie restaurée, sous le rôle propriétaire ; RLS, journal et accès du rôle runtime sont vérifiés. Aller-retour GitHub réel HTTP 200 puis révocation vérifiés. Résultat exhaustif final : 1 105 tests réussis, 37 ignorés ; 178 fichiers verts, 16 ignorés, 194 au total, zéro échec, 551 secondes, source figé 0da2c88.

La préversion existante `0dfa1f2` reste READY et son health répond HTTP 200/database=ok le 3 novembre à 04:47 UTC. Supabase est active au schéma 124 ; le lot 125–132 n’est pas appliqué car sa confirmation native a expiré, après deux expirations antérieures du lot 125/126. Aucun déploiement du candidat contre ce schéma incomplet. Le plafond de 1 USD est réservé à la préversion ; OpenAI nécessite sa clé et un budget distinct. Aucune programmation, fusion, production, GitHub Actions ou installation sur le Mac.

Les sections antérieures décrivent leur date. Voir [PRODUCT_FINALIZATION_2026-11-03.md](./PRODUCT_FINALIZATION_2026-11-03.md) pour limites, activation et configuration.

## Démarrage sans privilèges DDL et configuration de préproduction — 2 novembre 2026

Le runtime de production ne lance plus de migrations : il vérifie uniquement le journal attendu. Le script de migration utilise explicitement le rôle de migration. Trois tests couvrent le schéma prêt en lecture seule, le schéma incomplet et l'absence de fuite d'erreur sensible. Le lot runtime/sécurité/environnement passe 16 tests ; lint, typecheck et build sont verts. Un cache Turbopack local incohérent a été supprimé, puis le build propre a réussi. Aucun résultat de connexion Vercel n'est déduit de cette compilation.

Une identité PostgreSQL dédiée à la préproduction a été créée, avec héritage des seuls droits runtime, sans droit SET vers le rôle parent, sans privilège propriétaire et sans accès au coffre. Deux secrets sont générés côté serveur et conservés chiffrés dans Vault. Huit variables sont configurées chiffrées dans Vercel, uniquement pour preview et la branche codex/tradikom-one-os ; aucun secret n'est enregistré dans le dépôt ou les notes. Le modèle de droits et le contrôle du schéma passent sur PostgreSQL 17.5 embarqué avec le compte limité. La connexion réseau Vercel/Supabase reste à prouver.

Le budget additionnel reste nul. Le réglage Vercel Standard/sans concurrence à la demande a été refusé par l'API, faute de droits sur cette opération. Aucun déploiement n'a été lancé sans pouvoir confirmer les conditions de coût. APP_URL reste à fixer sur l'URL de préproduction effectivement attribuée, puis le parcours réel doit être testé. OpenAI, Meta et email réel ne sont pas raccordés ; les écarts fonctionnels précédemment décrits demeurent.

## Durcissement SQL vérifié — 2 novembre 2026 (Martinique)

La migration 124 fixe le search_path de 26 fonctions à pg_catalog, public, pg_temp. Un test reproduit le masquage de pg_class par une table temporaire : le contrôle système était faussé avant correction et refuse cette tentative après mise à niveau. Les définitions, privilèges et rôles ne sont pas élargis.

Le correctif est publié dans a146281 puis appliqué à Supabase. Contrôles réels : 124 migrations, 26 chemins fixés et analyseur de sécurité sans alerte. Recette de restauration/migration/rejeu sous tradikom_owner sur PostgreSQL 17.5 embarqué réussie. Lint, typecheck et build réussis avec configuration factice, sans accès à la base réelle.

Tests natifs : lot service/sécurité de 11 tests, lot migrations/sécurité de 21 tests, lot configuration/authentification/isolation/transactions/accès aux objectifs de 72 tests, tous verts. Ces lots se recouvrent : ne pas additionner leurs nombres. La première tentative exhaustive a exposé quatre attentes de dernière migration restées sur 122/123 ; elles sont mises à jour pour 124 et le lot des migrations repasse. La suite exhaustive a été interrompue après ce diagnostic ; aucune suite exhaustive ou recette Playwright nouvelle n'est revendiquée.

Vercel : projet présent, aucun déploiement et aucune variable configurée. Les accès PostgreSQL runtime, la clé de chiffrement et les accès fournisseurs restent à provisionner dans un gestionnaire de secrets. Le raccord OpenAI/Meta, la gestion de consentement/arrêt et la RLS fine des objectifs, les documents/voix et l'installation tierce réelle restent incomplets. Ne pas déclarer le produit livré. Le budget additionnel reste nul ; aucune création de credential, activation de fournisseur, émission de message, dépense, fusion ou production effectuée par cette tranche.

## Mise à niveau Supabase réalisée — 2 novembre 2026 (Martinique)

Le blocage de sauvegarde est levé gratuitement : export logique indépendant du schéma public applicatif, avec données, contraintes, index, fonctions, triggers, politiques et privilèges. Restauration vérifiée sur PostgreSQL 17.5 embarqué : 121 tables, 856 contraintes, 392 index, 109 politiques, 30 triggers, nombres de lignes et journal identiques. Les 120 tables métier étaient vides ; le journal contenait 66 lignes. Les réglages internes Supabase, fichiers Storage et secrets de connexion sont hors de ce périmètre.

Le passage de 66 à 123 migrations et son rejeu ont passé la recette sur la copie restaurée, sous tradikom_owner. Les 57 migrations du dépôt ont ensuite été appliquées à Supabase en transaction, avec garde sur le journal, contrôle des données, verrou et rôle de migration. Le premier dialogue de confirmation a expiré sans effet ; le second a réussi. Contrôle réel : ACTIVE_HEALTHY, 123 migrations, 148 tables appartenant à tradikom_owner, tables Conversation avec RLS, aucun droit CRUD direct anon/authenticated sur les tables publiques.

L'analyseur signale désormais 26 fonctions sans search_path fixé, contre 6 avant les migrations : durcissement à traiter avant exploitation. Cette tranche ne valide pas les fournisseurs réels, le runtime web/worker, le consentement/arrêt Goal Watch, les pièces jointes réelles ni la production. Aucun abonnement payant, déploiement ou GitHub Actions. Les assertions plus anciennes ci-dessous décrivent leur date.

# Mise à jour — 2 novembre 2026 (Martinique)

Supabase TRADIKOM-ONE a été réactivé à la demande de Lucas. État ACTIVE_HEALTHY et connexion SQL vérifiés. Le journal applicatif contient 66 migrations, dernière 066_phase5_website_domain_bindings_rls du 23 juillet. La base réelle reste inchangée : sauvegarde exportable et restauration à vérifier avant mise à niveau. Le connecteur ne fournit pas de sauvegarde et le tableau de bord demande une authentification.

Le traitement Goal Watch parcourt désormais les lots par curseur d'identifiant : les entrées non échues ne consomment plus la limite d'évaluations. Le test de régression échoue sur le source précédent (0 évaluation au lieu de 1), puis les 51 tests ciblés passent sur trois fichiers. Lint, typecheck, build Next.js et diff check passent. Le build utilise une configuration factice et ne se connecte pas à Supabase. La suite exhaustive et Playwright ne sont pas rejoués sur ce lot. La mise à niveau depuis le socle 065 et son rejeu passent sur PGlite sans RLS (74 migrations, table conversation_threads présente). Cela ne remplace pas la recette PostgreSQL 17/RLS sur une copie de la base réelle.

Limites conservées : le parcours peut lire tous les objectifs non échus ; une grande volumétrie demande une sélection SQL par échéance et des index. Les objectifs invalides et l'équité entre entreprises restent à traiter. Consentement/pause/arrêt et RLS spécialisés ne sont pas livrés par cette correction. Aucun suivi récurrent activé. Aucun fournisseur, migration réelle, fusion, déploiement, dépense ou GitHub Actions.

Les constats datés ci-dessous sont historiques.

# État de livraison — 30 octobre 2026

Le lot de dépendances et de durabilité est vérifié. Le produit complet reste partiel ; aucun pourcentage d'achèvement n'est déduit des tests.

## Fonctionnalités et écarts

| Phase | Présent | Restant |
| --- | --- | --- |
| OS-5 | Conversation, plans, autorisations durables, adaptateurs et transports préparés | Composition serveur réelle autorisée et preuve aller-retour fournisseur ; les variables seules ne rendent pas le registre ready |
| OS-6 | Moteur et maintenance, accès applicatifs au fil, durabilité corrigée et testée | RLS spécialisée, sélection équitable/pagination, parcours Conversation et consentement/arrêt explicites |
| OS-7 | Conversation responsive, validation et délégation desktop/mobile testées | Capture vocale et parcours documentaire mobile complet avec stockage/extraction autorisés |
| OS-8 | SDK typé, catalogue privé et prévisualisations | Connecteur tiers minimal réellement installé, testé et révocable ; installations encore preview_only et désactivées |

Références : `src/modules/channels/provider-registry.ts`, `docs/OS5_META_CLOUD_API_ACTIVATION_RUNBOOK.md`, `src/modules/goal-watch/`, `src/modules/conversation-hub/attachment-access.ts`, `src/modules/app-marketplace/service.ts` et `tests/e2e/vertical.spec.ts`.

## Fichiers, compétences et connexions

| Catégorie | Accès ou usage réellement constaté |
| --- | --- |
| Pack TRADIKOM sur Mac | Catalogue, 1 239 skills, 434 profils, 12 points d'entrée et 16 agents principaux vérifiés dans la session ; README, team.py et points d'entrée examinés |
| Ressources réellement utilisées | Routage tk-pilotage, tk-web, tk-qualite et profil Next.js pertinent ; recherches sélectives, sans charger tout le catalogue |
| Délégation réellement exécutée | Implémentation et revues par generation_ia_reelle, verification_pack et verification_goal_watch ; les profils du catalogue ne sont pas tous lancés |
| GitHub | Connecteur authentifié utilisé pour lectures, blobs, commits, refs et PR ; Chrome utilisé pour Codespaces et la suspension du workflow |
| Notion | Consignes version 0.0.5 respectées, guide et contexte consultés antérieurement ; aucun nouveau sujet projet partagé créé |
| Vercel | Outil fonctionnel, projet dédié préparé et protégé ; aucun déploiement ou Sandbox |
| Supabase | Outil accessible ; projet applicatif inactif, runtime de production non validé |
| Resend | Domaine vérifié ; aucune clé créée, aucun envoi réel ou raccordement runtime |
| OpenAI/Teams | SDK présents, tests avec doubles de transport ; aucune génération ou authentification fournisseur réelle activée |
| Compétence dépendances/supply-chain du Mac | Indisponible lors du passage au runner distant, donc non revendiquée comme utilisée pour l'audit |

Les nombres du pack décrivent des ressources et profils accessibles, pas 1 239 outils SaaS connectés. Le runner distant ne reçoit pas automatiquement le pack du Mac.

## Blocages opérateur et prochaine tranche

Supabase doit être rétabli par son opérateur avant exploitation de cette base. Les fournisseurs réels exigent authentifications, références de secrets et consentements bornés ; ces accès ne remplacent pas le code de composition encore manquant.

La prochaine tranche de code concerne le parcours d'objectifs, son consentement/arrêt et sa RLS. Relire le prompt maître canonique avant toute nouvelle sélection autonome. Aucune surveillance récurrente n'est activée.

La démonstration mock Conversation a passé Playwright sur desktop/mobile. Elle utilise une base jetable et ne constitue pas un service permanent. Le Codespace est arrêté après conservation des résultats. La PR demeure en brouillon ; aucune fusion ou production.
