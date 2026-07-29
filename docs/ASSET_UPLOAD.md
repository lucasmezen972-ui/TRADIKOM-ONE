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

## Limites actuelles

- Aucune analyse antivirus ni réencodage de l'image : le fichier est servi tel qu'il a été reçu.
- Pas de redimensionnement ni de génération de miniatures.
- L'URL d'un fichier est non devinable mais non authentifiée, comme n'importe quelle image de site public.
- Aucune suppression depuis l'interface : un fichier remplacé reste stocké.
- Le SVG est volontairement exclu : il peut porter du script.
