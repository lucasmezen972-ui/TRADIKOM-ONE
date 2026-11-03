# Qualification de la mise à niveau Supabase — 3 novembre 2026

Projet : `iwngumaqdjiglhfekgug`. Aucun upgrade, redémarrage, changement d’extension ou abonnement effectué. Le moteur reste PostgreSQL 17.6 ; le journal applicatif est à 132.

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

1. Conserver une sauvegarde fraîche avec données applicatives, rôles/politiques et objets nécessaires, puis prouver sa restauration isolée. L’ancien export public précède les comptes et documents de recette et n’est pas une sauvegarde complète actuelle de la plateforme.
2. Sauvegarder séparément les clés et versions de chiffrement, credentials de rôles personnalisés et réglages externes. Un dump ne remplace pas ces éléments ; les objets Storage ont leur propre sauvegarde.
3. Qualifier les extensions et l’éventuel historique PGP, vérifier les prérequis présentés par le tableau de bord et la version cible exacte disponible.
4. Préparer une interruption annoncée et un retour arrière. Ne lancer l’upgrade qu’après ces preuves et la confirmation fournisseur ; ne pas utiliser pause/restauration pour contourner cette préparation.
5. Après upgrade : revérifier journal 132, propriétaires/RLS, connexion runtime TLS, health et parcours personnel mobile. Un health seul ne clôt pas la recette.

## Sources officielles consultées

- [Changelog PostgreSQL 15.19/17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) : contrôles de compatibilité adaptés dans la sonde.
- [Procédure d’upgrade](https://supabase.com/docs/guides/platform/upgrading) : interruption, prérequis et préparation de sauvegarde.
- [Sauvegardes](https://supabase.com/docs/guides/platform/backups) : exports hors site pour le forfait Free, exclusions des mots de passe de rôles personnalisés et des objets Storage.

Cette qualification partielle ne vaut pas autorisation de dépense, preuve de restauration de plateforme ou validation de production.
