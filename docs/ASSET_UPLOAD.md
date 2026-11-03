# Images du site

Ce contrat décrit le candidat courant. La recette hébergée du nouveau stockage reste à vérifier sur le SHA déployé : l’ancien envoi PNG de 5 513 octets a échoué `asset_storage_unavailable`, sans ligne créée. Ce défaut n’est pas une preuve de livraison.

## Validation et transport de préversion

| Contrôle | Règle |
| --- | --- |
| Types | PNG, JPEG et WebP, reconnus par signature binaire ; extension et Content-Type déclarés ne font pas foi |
| Service et interface | 3 MiB maximum par image, fichier vide refusé |
| Server Actions | enveloppe de `4mb`, avec marge multipart sous la limite du fournisseur ; les imports partagent la limite utilisateur 3 MiB |
| Défense SQL | payload PostgreSQL borné à 3 MiB, longueur exacte, SHA256 et signature cohérents avec les métadonnées |
| Nom affiché | séparateurs, segments `..` et contrôles supprimés,120 caractères maximum |

Les 3 MiB sont une adaptation explicite de la préversion cloud. Le code ne revendique aucun upload hébergé de 5 MiB. Les documents natifs 512 KiB et les attachments legacy 25 MiB conservent leurs contrats distincts.

## Persistance

L’envoi normal conserve les octets dans `tenant_assets.content_bytes` (`bytea`) avec `storage_backend=postgres`. La transaction vérifie le membership et le rôle, verrouille le tenant avec le même verrou que publication/suppression, réutilise un contenu identique du même tenant/type, puis insère la ligne et l’audit. Les déclencheurs de quota, l’image et l’audit réussissent ou sont annulés ensemble. Un rejeu exact du contenu n’ajoute ni fichier, ni consommation, ni nouvel audit d’upload.

Les anciens fichiers restent `external` sans payload et sans conversion destructive, y compris une référence historique dépassant 3 MiB. Un nouvel envoi depuis la préversion Vercel reste limité à 3 MiB. Le contrat `AssetStorage` injecté reste disponible pour les tests et le stockage local explicitement demandé. Aucun disque Vercel éphémère, clé, provider, abonnement ou budget nouveau n’est utilisé par le chemin normal. `ASSET_STORAGE_DIR` ne fournit jamais un fallback de disque sur Vercel.

## Quotas

| Périmètre | Octets logiques | Nombre de fichiers |
| --- | --- | --- |
| Tenant | 10 MiB | 64 |
| Application | 50 MiB | 512 |

Ces plafonds sont fixes. Ils couvrent aussi les métadonnées d’anciens fichiers externes. Des compteurs privés atomiques, alimentés uniquement pour les insertions/suppressions réellement effectuées, évitent la consommation sur `ON CONFLICT DO NOTHING` et les courses entre tenants. Une réservation globale annulée pour dépassement du quota tenant est annulée dans la même transaction. Un total historique déjà supérieur n’est ni supprimé ni ramené artificiellement au plafond ; de nouveaux envois sont refusés.

Les compteurs ne sont ni lisibles, ni modifiables, ni appelables par le runtime. Leur fonction de trigger est propriétaire borné dans `app_private`, avec `search_path=''`, sans flag SYSTEM global ni GRANT de table supplémentaire. Les limites portent sur octets logiques et nombre de fichiers ; elles ne constituent pas une mesure du WAL, des sauvegardes ou de l’espace physique fournisseur.

## Lecture et suppression

Les listes et la suppression lisent seulement les métadonnées. La lecture privée exige une session, son organisation vérifiée et un membership ; la requête inclut tenant et identifiant. Elle répond `private, no-store`. La lecture publique projette les octets uniquement si l’image est référencée par une section active du dernier snapshot publié du même tenant. Un brouillon, un identifiant privé ou une référence copiée d’un autre tenant ne suffit pas.

Les images locales passent directement par `/fichiers/:id` : le renderer ne les confie pas à l’optimiseur Next et celui-ci refuse les sources locales. Les réponses publiques demandent revalidation ; une publication ne transforme pas ses brouillons ultérieurs en contenu public.

L’association à une section et la persistance de l’image sont deux transactions. Toute association locale, publication et restauration prend le même verrou tenant puis vérifie les références par métadonnées et tenant. Si une suppression précède l’association, celle-ci est refusée explicitement ; un fichier privé peut rester listé après un autre échec d’association.

La suppression vérifie sections courantes, profil et dernier snapshot publié sous le même verrou tenant que la publication. Ligne PostgreSQL, payload, quota et audit sont supprimés atomiquement. Pour un ancien stockage externe, les octets sont retirés après le commit logique ; une erreur de ce nettoyage peut laisser un objet invisible. L’envoi et la suppression refusent un client déjà engagé dans une transaction afin de conserver leurs frontières de commit.

## Limites et preuves

- Aucune analyse antivirus, validation complète du décodeur, réencodage, OCR ou miniature n’est annoncée.
- SVG refusé. Le SHA256 vérifie l’intégrité des octets, pas leur innocuité.
- Les anciennes versions non publiées ou remplacées peuvent référencer un fichier supprimé ; seule la dernière publication bénéficie du garde de suppression.
- Un fichier déjà téléchargé ne peut pas être rappelé. Le nouveau contrôle de cache ne supprime pas les copies déjà détenues par un visiteur.
- Les tests locaux, la migration fournisseur, les advisors et la recette hébergée doivent être consignés séparément ; ce document ne les déclare pas exécutés.
