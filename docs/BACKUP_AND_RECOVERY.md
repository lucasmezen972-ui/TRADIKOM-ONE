# Sauvegarde et reprise

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
