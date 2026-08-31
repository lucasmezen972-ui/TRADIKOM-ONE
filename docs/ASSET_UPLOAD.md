# Envoi de fichiers

Les images du site (photos de section, logo) peuvent être envoyées depuis l'éditeur. C'était le dernier manque fonctionnel du générateur de site : les visuels ne pouvaient venir que d'une URL externe.

## Validation

Le type est déterminé par la **signature binaire** du fichier, jamais par son extension ni par le `Content-Type` annoncé — les deux viennent du client et se falsifient trivialement. Un script renommé `photo.png` est refusé avant toute écriture.

| Contrôle | Règle |
| --- | --- |
| Types acceptés | PNG, JPEG, WebP, reconnus par magic bytes |
| Taille | 5 Mo maximum, fichier vide refusé |
| Nom d'origine | conservé pour l'affichage seulement, nettoyé (séparateurs, `..`, caractères de contrôle), borné à 120 caractères |

Le WebP exige la présence du marqueur `WEBP` après l'en-tête `RIFF` : un fichier audio RIFF n'est pas accepté comme image.

## Stockage

`AssetStorage` suit le même principe que le fournisseur email : une interface, plusieurs implémentations.

| `ASSET_STORAGE_DIR` | Comportement |
| --- | --- |
| renseigné | stockage local sur disque |
| absent | `unavailable` : l'envoi échoue avec un message explicite, rien n'est écrit |

**La clé de stockage est entièrement dérivée d'identifiants générés côté serveur** (`tenantId/assetId.ext`). Aucun fragment ne provient du nom envoyé, ce qui rend la traversée de répertoire impossible par construction. Un garde-fou supplémentaire vérifie malgré tout que le chemin résolu reste sous la racine — défense en profondeur, couverte par un test.

Le stockage local convient au développement et à un hébergement à disque persistant. Sur un hébergement éphémère, il faut écrire un fournisseur objet au même contrat, sans toucher aux appelants.

## Cohérence base / disque

L'écriture disque précède l'insertion en base. Si l'insertion échoue, le fichier est supprimé : aucun fichier orphelin ne subsiste. La ligne en base fait toujours foi.

## Service des fichiers

`GET /fichiers/{assetId}` sert l'image d'un site publié. L'identifiant est un UUID non devinable ; **le chemin n'est jamais construit à partir de l'URL**, la ligne en base fournit la clé de stockage. La réponse ne révèle ni l'organisation propriétaire ni la clé.

En-têtes : `x-content-type-options: nosniff`, `content-disposition: inline`, et un cache immuable d'un an — le contenu d'un identifiant ne change jamais, un nouvel envoi crée un nouvel identifiant.

## Isolation et traçabilité

La table `tenant_assets` est tenant-scopée, sous RLS (migration `072`), avec index tenant-leading. Chaque envoi est réservé aux rôles `owner`, `administrator` et `manager`, et tracé en audit (`asset.uploaded`) avec le type, la taille et le format — jamais le contenu.

Un checksum SHA-256 est conservé pour chaque fichier et sert d'`ETag`.

## Suppression

`Mon site` liste les fichiers envoyés avec un bouton de suppression. Le geste est réservé aux mêmes rôles que l'envoi.

**La suppression est refusée tant que le fichier est utilisé** (`asset_in_use`, 409), et le message nomme les endroits concernés. La raison n'est pas la prudence de principe : une image supprimée alors qu'elle est encore affichée ne produit qu'un **404 silencieux** sur la page publiée. Personne ne s'en aperçoit, sauf les visiteurs.

Deux emplacements sont vérifiés : `website_sections.image_url`, comparé à l'URL exacte, et le profil de l'entreprise (`business_profiles.data`, JSON contenant `brand.logoUrl` et `brand.photoUrls`), cherché par sous-chaîne. La sous-chaîne suffit ici : l'URL contient un identifiant non devinable, il n'existe pas de collision réaliste.

### Ordre des opérations

La ligne est supprimée **avant** le fichier. Si l'effacement du fichier échoue, il reste un orphelin — invisible, sans effet pour l'utilisateur, récupérable par une tâche de ménage. Dans l'ordre inverse, une ligne survivante pointerait vers un fichier absent et servirait un 404 sur un site publié. C'est la symétrie de l'envoi, où le fichier est écrit d'abord et effacé si l'insertion échoue.

Une organisation ne peut pas supprimer le fichier d'une autre : la recherche est tenant-scopée et renvoie `asset_not_found`, sans révéler que l'identifiant existe ailleurs.

## Limites actuelles

- Aucune analyse antivirus ni réencodage de l'image : le fichier est servi tel qu'il a été reçu.
- Pas de redimensionnement ni de génération de miniatures.
- L'URL d'un fichier est non devinable mais non authentifiée, comme n'importe quelle image de site public.
- Aucune tâche de ménage ne ramasse les fichiers orphelins laissés par un effacement partiel.
- Une version antérieure d'un site peut référencer un fichier supprimé : la vérification ne porte que sur les sections courantes, pas sur l'historique des versions.
- Le SVG est volontairement exclu : il peut porter du script.
