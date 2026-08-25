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

Le module `src/modules/provider-readiness/cloudflare-contract.ts` autorise seulement ces trois opérations `GET`. Il fixe l'origine à `https://api.cloudflare.com`, borne chaque page à 50 éléments, limite les dix premières pages, définit une réponse maximale de 512 Kio pour le futur transport et ne place aucun credential dans le plan sérialisable.

Le contrat réduit les réponses à des champs explicitement revus. Les libellés de compte, propriétaires, commentaires, tags, erreurs brutes et autres données non nécessaires ne sont pas conservés. Les erreurs deviennent uniquement des classifications sûres et bornées.

Le checkpoint reste strictement contractuel: aucune matérialisation de credential et aucun transport réseau ne sont disponibles dans le module.

## Fondation du cycle de vie des credentials

Le module `src/modules/provider-readiness/credential-lifecycle.ts` fournit maintenant la logique de domaine préalable au futur stockage:

- environnement limité à `test`;
- capacités limitées aux trois lectures revues;
- secret chiffré en AES-256-GCM avec la primitive existante;
- empreinte HMAC tenant-scoped pour détecter un même secret sans le réafficher;
- version de clé et version de credential explicites;
- rotation qui crée une nouvelle version et marque l'ancienne comme remplacée;
- révocation idempotente;
- vue applicative construite champ par champ sans ciphertext ni empreinte;
- comparaison d'empreintes en temps constant;
- aucune fonction de déchiffrement ou de transport exportée.

Cette fondation est testée en mémoire mais n'est pas encore persistée. Elle ne constitue donc pas encore un coffre tenant-scoped complet. La migration, les relations composées, la RLS, l'audit transactionnel et l'interface restent obligatoires avant toute saisie réelle.

## Modèle de credentials attendu

- secret chiffré côté serveur uniquement;
- version et identifiant de clé de chiffrement;
- empreinte non réversible pour détecter les doublons;
- libellé, environnement, capacités et date d'expiration sans secret;
- rotation atomique;
- révocation et suppression logique auditée;
- aucune valeur sensible dans les journaux, erreurs, événements, cartes ou réponses navigateur;
- aucune réaffichage du secret après la saisie initiale.

Aucun jeton Cloudflare n'est stocké dans ce checkpoint.

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
- le contrat Cloudflare est testé sans réseau: origine fixe, méthodes `GET`, pagination bornée, absence de credential dans les résumés, réduction des réponses et classifications d'erreur sûres;
- le cycle de vie des credentials couvre création chiffrée, détection d'égalité, rotation, remplacement, révocation, redaction et refus des capacités d'écriture.

## Prochaine décision technique

Persister le cycle de vie dans un stockage tenant-scoped avec migrations, relations composées, index tenant-leading, PostgreSQL RLS, transactions et audit sans secret. Ensuite seulement, préparer un préflight Cloudflare manuel avec un compte de test dédié. Aucun appel réseau réel ne sera activé tant que ces garanties ne seront pas vertes.
