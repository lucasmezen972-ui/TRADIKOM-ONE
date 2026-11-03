# Restauration du kit applicatif au schéma 135

Le format 2 ajoute `app_private` au périmètre `public` : schémas, propriétaires,
tables et lignes, fonctions, contraintes, index, triggers, policies RLS, ACL et
privilèges par défaut. Les compteurs de quota et les brokers privés font donc
partie du même export cohérent que les images et leurs métadonnées.

Le format 1 historique reste lisible pour les sauvegardes publiques au schéma
132. Il n'enregistrait pas le propriétaire du schéma ; cette propriété ne peut
donc pas être attestée depuis ce format. Aucun ancien fichier de sauvegarde ni
aucune ancienne preuve ne sont modifiés.

L'export reste un SELECT unique. Les colonnes BYTEA sont explicitement encodées
au format hexadécimal PostgreSQL, indépendamment de `bytea_output`.
`json_populate_recordset` les recharge dans leurs colonnes BYTEA ; la recette
locale compare les octets et SHA-256. Les noms de table identiques dans les deux
schémas sont distingués par leur schéma dans le kit et le manifeste.

La restauration est réservée à une **base neuve, vide et isolée**, avec ses
propres identités applicatives : les rôles PostgreSQL sont globaux au cluster.
Le SQL refuse les objets publics, autres schémas applicatifs, privilèges par
défaut préexistants et rôles applicatifs déjà présents avant de les modifier.
Le vérificateur crée toujours un moteur PGlite local neuf ; il n'accepte aucune
URL de connexion ni base utilisateur cible.

Les tables et fonctions sont créées, puis toutes les lignes des deux schémas
sont chargées **avant les triggers**. Les compteurs sont ainsi restaurés tels
qu'ils ont été capturés, sans recompter les images pendant leur chargement.
Contraintes, triggers, policies, propriétaires et ACL sont ensuite restaurés
dans la même transaction. Le rejeu du journal 135 ne recharge pas les lignes.

Ce kit n'est pas une sauvegarde de la plateforme Supabase. Aucun contenu ou
inventaire Auth, Storage ou Vault, aucun `pg_authid` et aucun mot de passe de
rôle n'est collecté. Les paramètres de rôle se limitent à `search_path`,
`statement_timeout` et `idle_in_transaction_session_timeout`. Les données
applicatives restent privées, y compris les empreintes d'authentification
nécessaires à une restauration fidèle : tout kit réel doit être chiffré avant
stockage hors site et ne doit jamais être journalisé.

Les régressions utilisent seulement des identités et images fictives, un export
SQL réellement exécuté sur ces fixtures, puis des bases locales isolées. Elles
ne prouvent ni restauration plateforme, ni restauration PostgreSQL distante,
ni équivalence entre le moteur PGlite local et une version fournisseur cible.
Les séquences, vues, types personnalisés, partitions et colonnes générées restent
hors format et provoquent un refus explicite plutôt qu'une restauration partielle.
