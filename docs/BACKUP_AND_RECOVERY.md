# Sauvegarde et reprise

## Sauvegarde du projet hébergé — 3 novembre 2026

La [preuve structurée](./BACKUP_VERIFICATION_2026-11-03.json) décrit la capture cohérente du schéma public132 (153 tables / 215 lignes), son chiffrement, son stockage hors Supabase, la relecture exacte et la restauration depuis cette copie sur PostgreSQL 17.5 embarqué. Les deux rejeux de migrations sous tradikom_owner laissent le journal inchangé. Aucun GitHub Actions utilisé.

L’[upgrade natif 17.11.0.011 et la comparaison après bascule](./SUPABASE_UPGRADE_VERIFICATION_2026-11-03.json) sont ensuite vérifiés sur le projet hébergé. Cette preuve du projet migré reste distincte d’une restauration complète de plateforme. Les temporaires locaux de données et clé ont été retirés après contrôle ; seule la sauvegarde chiffrée est conservée hors Supabase.

Outils de cette reprise :

1. Exécuter [export-application-snapshot.sql](../scripts/export-application-snapshot.sql) en lecture seule. Conserver le résultat JSON en fichier privé0600 dans un dossier0700 ; ne pas le journaliser. Il contient des données privées. Vérifier l’inventaire de fonctionnalités supportées : aucune séquence, vue, partition, type personnalisé ou colonne générée. Cette capture est adaptée au schéma observé de TRADIKOM, et ne remplace pas un pg_dump général. Vérifier aussi les collations/options non standard, règles, triggers désactivés et tables d’extension : tous absents à cette reprise.
2. Exécuter `python scripts/prepare-application-restore.py SNAPSHOT_JSON DOSSIER_NEUF`. L’outil construit les tables, données, fonctions, contraintes/index, triggers, RLS, propriétaires, ACL, privilèges par défaut et memberships. Les rôles applicatifs restent volontairement NOLOGIN/NOSUPERUSER/NOBYPASSRLS ; reprovisionner les credentials séparément. Le SQL généré refuse un schéma public non vide ; l’exécuter uniquement dans un environnement neuf isolé, jamais sur la base existante.
3. Exécuter `node scripts/verify-application-snapshot.mjs DOSSIER_NEUF [MODULE_PGLITE]`. Le test compare toutes les lignes et les métadonnées de sécurité, puis vérifie le rôle restreint, l’isolation et la remise à zéro du contexte. Le moteur réellement testé est dans la preuve ; le PGlite du dépôt est18.3, celui de cette recette est17.5 (`@electric-sql/pglite@0.3.14` installé uniquement dans le cloud temporaire).
4. Archiver le kit et ses empreintes, puis utiliser `node scripts/seal-application-backup.mjs seal ARCHIVE_ZIP BACKUP [CLE_JSON_PRIVEE]`. AES-256-GCM et HKDF-SHA256 avec sel/nonce aléatoires ; clé d’environnement CONNECTOR_ENCRYPTION_KEY et version CONNECTOR_ENCRYPTION_KEY_VERSION, conservées séparément dans Vercel. Un fichier de clés éventuel doit être privé0600 et retiré après usage. La clé n’est jamais dans l’archive. La commande `open` inverse l’opération sans écraser un fichier existant. Vérifier mauvaise clé/version et altération refusées.
5. Stocker uniquement le fichier chiffré hors plateforme, relire cette copie, vérifier l’empreinte et toutes les entrées, déchiffrer puis restaurer depuis cette copie. Nettoyer les fichiers intermédiaires contenant données et clé après le contrôle.

Inventaire : Auth0 utilisateur, Storage0 bucket/objet ; deux valeurs Vault vérifiées par SHA256 contre les secrets Vercel existants, sans export en clair. Trois payloads historiques de connecteur AES-GCM déchiffrables avec la clé existante, sans affichage. Les schémas/configurations internes, mots de passe de rôles et racine Vault restent exclus : cette preuve ne certifie pas une restauration complète de plateforme, ni la version cible17.11. Le compte personnel et l’entreprise fictive de Lucas sont préservés.

L’ancien paragraphe de CI ci-dessous décrit une procédure historique ; aucun workflow n’a été exécuté dans cette reprise.

## Portee

PostgreSQL contient les donnees applicatives, audits, snapshots, definitions de workflow et references de credentials chiffres. Le depot ne stocke actuellement aucun objet client dans un service objet externe; tout futur stockage devra avoir sa propre politique de versionnement et de restauration.

Les secrets d'environnement, la cle de chiffrement et les credentials fournisseurs ne doivent pas etre inclus dans une sauvegarde SQL non chiffree. Ils doivent etre sauvegardes separement dans le gestionnaire de secrets de l'operateur.

## Sauvegarde PostgreSQL

1. Utiliser PostgreSQL 17 ou un client compatible avec le serveur.
2. Executer `pg_dump` au format custom avec `--no-owner --no-acl` depuis une identite de backup en lecture.
3. Chiffrer le fichier hors base, le stocker sur un support distinct et appliquer une retention definie par l'operateur.
4. Conserver l'heure, la version applicative, le SHA de migration et le checksum du fichier sans enregistrer l'URL de base.
5. Verifier regulierement la restauration, pas seulement la creation du dump.

## Restauration testee

La CI execute `scripts/verify-backup-restore.sh` sur PostgreSQL 17. Le controle:

1. cree une base source temporaire;
2. applique toutes les migrations;
3. ajoute un enregistrement de controle;
4. cree un dump custom;
5. restaure dans une base vide distincte;
6. rejoue les migrations de facon idempotente;
7. verifie l'enregistrement;
8. detruit les deux bases temporaires.

Le script ne journalise pas la chaine de connexion. Il est destine a la CI et a un environnement de reprise controle, jamais a une route publique.

## Procedure d'incident

1. Activer le mode maintenance et stopper les workers.
2. Preserver les journaux et identifier le dernier backup sain.
3. Restaurer dans une nouvelle base isolee.
4. Executer les migrations avec le role de migration.
5. Verifier les tables de migrations, RLS, index tenant et contraintes.
6. Tester connexion, lecture tenant, publication publique, worker et health checks.
7. Basculer l'application avec le role runtime restreint.
8. Relancer un seul worker, verifier les baux expires et l'idempotence, puis augmenter progressivement.
9. Sortir du mode maintenance apres validation fonctionnelle.

## Rotation apres compromission

- Regenerer sessions, secrets webhook, credentials connecteurs et cles fournisseurs.
- Remplacer `CONNECTOR_ENCRYPTION_KEY` avec une version de cle explicite et re-chiffrer les credentials selon la procedure operateur.
- Revoquer les anciens secrets avant de reouvrir le trafic.
- Ne jamais tenter de reconstituer un secret webhook depuis son historique; effectuer une rotation.
- Auditer chaque rotation et verifier qu'aucune valeur brute n'apparait dans les logs.

## Limites

La CI prouve la portabilite logique du schema et d'un dump PostgreSQL. Elle ne prouve pas la restauration du gestionnaire de secrets, des certificats, du DNS ou d'un futur stockage objet. Ces dependances restent sous la responsabilite de l'environnement de production et doivent etre testees dans son plan de reprise.
