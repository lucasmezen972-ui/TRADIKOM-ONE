# Phase 5 - Préparation des fournisseurs réels

Statut: en cours sur `codex/phase-5-provider-readiness` depuis le merge Phase 5 `7ac09bfb593783c3b447102d5b88282f78477ef9`.

## But

Préparer le premier adaptateur fournisseur réellement utilisable sans transformer la tranche mock validée en accès implicite à la production.

Le lot ne doit pas sélectionner un fournisseur sur la base d'une documentation secondaire, d'un exemple ancien ou d'un environnement non reproductible. L'activation attend une documentation officielle vérifiée, un compte sandbox ou test contrôlé et des credentials dédiés.

## Ordre de livraison

1. figer les contrats de sécurité communs aux soumissions natives et aux redirections;
2. définir le registre des fournisseurs et leurs capacités déclarées;
3. ajouter un coffre tenant-scoped pour credentials chiffrés, versionnés et révocables;
4. créer un contrôle de prérequis sans effet externe;
5. intégrer un seul fournisseur en lecture seule dans un environnement test ou sandbox;
6. passer les contrats, l'isolation PostgreSQL, le build et Playwright avant toute activation;
7. maintenir les écritures fournisseur et DNS désactivées dans ce lot.

## Critères obligatoires d'un fournisseur candidat

- documentation officielle accessible et datée;
- authentification et scopes documentés;
- environnement sandbox, test ou compte de développement isolé;
- opérations de lecture bornées et utiles au produit;
- quotas et erreurs documentés;
- révocation vérifiable;
- aucune obligation de stocker une clé en clair;
- CI déterministe avec transport simulé fidèle au contrat officiel;
- test manuel séparé avec credentials dédiés avant tout déploiement;
- possibilité de désactiver immédiatement l'installation sans perte de données internes.

## Candidat retenu pour l'étude de contrat

Cloudflare est retenu uniquement comme **candidat de contrat** pour la première lecture DNS. Ce choix ne signifie ni compatibilité validée, ni activation, ni déploiement.

Sources officielles examinées dans `cloudflare/cloudflare-typescript`:

- le SDK officiel utilise un jeton API côté serveur et documente les erreurs, les délais, les reprises et la pagination;
- `GET /user/tokens/verify` vérifie le jeton courant;
- `GET /zones` liste les zones avec pagination;
- `GET /zones/{zone_id}/dns_records` liste les enregistrements DNS;
- le SDK expose aussi de nombreuses écritures, mais elles sont volontairement absentes du contrat TRADIKOM ONE.

Le module `src/modules/provider-readiness/cloudflare-contract.ts` autorise seulement ces trois opérations `GET`. Il fixe l'origine à `https://api.cloudflare.com`, borne chaque page à 50 éléments, limite les dix premières pages, impose une réponse de 512 Kio maximum au futur transport et ne place aucun credential dans le plan sérialisable.

Le contrat réduit les réponses à des champs explicitement revus. Les libellés de compte, propriétaires, commentaires, tags, erreurs brutes et autres données non nécessaires ne sont pas conservés. Les erreurs deviennent uniquement des classifications sûres et bornées.

## Modèle de credentials attendu

- secret chiffré côté serveur uniquement;
- version et identifiant de clé de chiffrement;
- empreinte non réversible pour détecter les doublons;
- libellé, environnement, scopes et date d'expiration sans secret;
- rotation atomique;
- révocation et suppression logique auditée;
- aucune valeur sensible dans les journaux, erreurs, événements, cartes ou réponses navigateur;
- aucune réaffichage du secret après la saisie initiale.

Ce modèle n'est pas encore branché à Cloudflare. Aucun jeton Cloudflare n'est stocké dans ce checkpoint.

## Limites du premier lot réel

- lecture seule;
- un fournisseur et un compte de test dédié;
- aucune modification DNS;
- aucune création, modification ou suppression chez le fournisseur;
- aucun envoi externe;
- aucun paiement;
- aucune activation automatique;
- approbation explicite du propriétaire ou d'un administrateur;
- arrêt d'urgence et révocation disponibles avant le premier appel réel.

## Validation actuelle

- la première tranche mock a été fusionnée par la PR #6 après deux runs complets verts, dont `29513872220` sur le head de clôture;
- les protections de soumission HTML native ont passé le run complet `29515810971` dans ce lot suivant;
- le contrat Cloudflare est testé sans réseau: origine fixe, méthodes `GET`, pagination bornée, absence de credential dans les résumés, réduction des réponses et classifications d'erreur sûres.

## Prochaine décision technique

Ajouter le cycle de vie tenant-scoped des credentials avant tout transport réel: chiffrement, version, empreinte, rotation, révocation, audit et absence totale de réaffichage. Ensuite seulement, préparer un préflight Cloudflare manuel avec un compte de test dédié. Aucun appel réseau réel ne sera activé tant que ces garanties et l'isolation PostgreSQL ne seront pas vertes.
