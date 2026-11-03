# Qualification de la mise à niveau Supabase — 3 novembre 2026

Projet : `iwngumaqdjiglhfekgug`. Mise à niveau native **17.6.1.141 →17.11.0.011** confirmée le 3 novembre 2026 après préparation. Début fournisseur 12:32:59UTC, état ACTIVE_HEALTHY constaté à 12:39:48UTC et interface «Upgrade completed!». Journal applicatif132. Aucun changement de forfait, activation IA ou pause/restauration de contournement.

## Résultat après mise à niveau

La [preuve complète](./SUPABASE_UPGRADE_VERIFICATION_2026-11-03.json) compare le schéma avant/après : 153 tables et215 lignes exactes avant nouvelle connexion, propriétaires/RLS/politiques/ACL, fonctions, privilèges par défaut et rôles/memberships préservés. 133 tables sous RLS, aucune table hors propriétaire tradikom_owner, zéro avis sécurité. Sept CHECK ont une présentation de groupes AND aplatie : mêmes opérandes/priorité OR, revue individuelle et 81 combinaisons booléennes/nulles sans différence. Aucun changement de données appliqué.

Extensions et versions inchangées ; deux valeurs Vault encore conformes aux secrets Vercel séparés. Health applicatif200/database=ok ; connexion personnelle indépendante en 390 × 844 et dashboard/contacts/site/Conversation avec rechargements sans débordement, puis déconnexion, réussis. Compte personnel conservé et zéro ancien utilisateur jetable. Aucune nouvelle campagne PostgreSQL distante exhaustive ou recette PDF post-upgrade revendiquée.

Client/pooler : certificat fourni, verify-full, rejectUnauthorized=true vérifiés dans la configuration réelle et le code. pg_stat_ssl rapporte ssl=false pour les connexions du pooler à PostgreSQL ; aucune garantie TLS de bout en bout déduite du health. Ce segment interne et une restauration complète de plateforme restent à qualifier pour la production. Les temporaires privés de données et clé de sauvegarde ont été retirés, sauvegarde chiffrée et accès personnel conservés.

Les sections suivantes décrivent la préparation antérieure au lancement, pas un upgrade restant à effectuer.

## Sauvegarde et contrôles supplémentaires réalisés

La [sauvegarde fraîche et sa preuve](./BACKUP_VERIFICATION_2026-11-03.json) couvrent le schéma public à 12:18:22UTC : 153 tables / 215 lignes, restauration depuis la copie chiffrée hors Supabase sur PostgreSQL 17.5 embarqué, données et métadonnées de sécurité exactes ; deux rejeux du journal 132 sans changement sous tradikom_owner. Auth/Storage sont vides. Les deux valeurs Vault correspondent aux secrets Vercel indépendants et trois payloads AES-GCM de connecteur sont déchiffrables avec cette clé, sans sortie de contenu. Tous les mots de passe des trois rôles personnalisés utilisent SCRAM-SHA-256. Aucun contenu bytea ni marqueur PGP armuré dans les lignes publiques actuelles ; pas de prétention à un scan PGP complet de la plateforme ou d’archives inaccessibles.

Le tableau de bord consulté propose17.11.0.011. Sa confirmation native annonce une coupure pouvant atteindre1heure, un redimensionnement du disque et aucun downgrade vers17.6.1.141. Ce checkpoint ne déclenche pas l’opération. Aucun pg_dump physique/de plateforme disponible dans le forfaitFree ; aucun abonnement souscrit. Le lancement natif de PostgreSQL17.11 dans ce cloud est bloqué par les permissions de changement d’utilisateur ; ne pas présenter le test embarqué17.5 comme une qualification de17.11.

## Sonde réellement exécutée

La requête en lecture seule [check-supabase-upgrade.sql](../scripts/check-supabase-upgrade.sql) a été exécutée sur le projet réel le 3 novembre 2026. Elle ne lit aucun contenu de document ou secret.

| Contrôle | Résultat |
| --- | --- |
| Index ltree ou GiST flottants visés par le changelog, tous schémas non système | Aucun |
| Opérateurs personnalisés avec estimateur concerné, hors extensions | Aucun |
| Slots de réplication logique | 0 |
| Références PGP dans les fonctions du schéma public | 0 |
| Taille de base observée | 23 276 691 octets |
| Extensions | pg_stat_statements 1.11 ; pgcrypto 1.3 ; plpgsql 1.0 ; supabase_vault 0.3.1 ; uuid-ossp 1.1 |

L’absence de référence PGP dans les fonctions publiques ne prouve pas l’absence de données PGP historiques ou d’usage interne à Vault. Aucun déchiffrement de secrets ni scan de ces données n’a été effectué. Les documents de Conversation utilisent AES-GCM côté Node ; cette sonde ne constitue pas une preuve de restauration de leurs clés.

## Conditions encore manquantes

1. Sauvegarde applicative fraîche et restauration isolée réalisées ci-dessus ; le périmètre plateforme reste distinct. L’ancien export de121 tables est remplacé pour la reprise applicative par celui de153 tables.
2. Clé/version et credential runtime préservés séparément dans Vercel, deux valeurs Vault et trois payloads AES-GCM vérifiés. Les autres mots de passe de rôles et réglages externes restent hors dump ; les rôles sont restaurés NOLOGIN. Les objets Storage ont leur propre sauvegarde s’ils deviennent non vides.
3. Qualifier les extensions et l’éventuel historique PGP, vérifier les prérequis présentés par le tableau de bord et la version cible exacte disponible.
4. Préparer une interruption annoncée et un retour arrière. Ne lancer l’upgrade qu’après ces preuves et la confirmation fournisseur ; ne pas utiliser pause/restauration pour contourner cette préparation.
5. Après upgrade : revérifier journal 132, propriétaires/RLS, connexion runtime TLS, health et parcours personnel mobile. Un health seul ne clôt pas la recette.

## Sources officielles consultées

- [Changelog PostgreSQL 15.19/17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) : contrôles de compatibilité adaptés dans la sonde.
- [Procédure d’upgrade](https://supabase.com/docs/guides/platform/upgrading) : interruption, prérequis et préparation de sauvegarde.
- [Sauvegardes](https://supabase.com/docs/guides/platform/backups) : exports hors site pour le forfait Free, exclusions des mots de passe de rôles personnalisés et des objets Storage.

Cette qualification partielle ne vaut pas autorisation de dépense, preuve de restauration de plateforme ou validation de production.
