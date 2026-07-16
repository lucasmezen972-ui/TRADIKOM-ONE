# Phase 5 - Préparation des fournisseurs réels

Statut: démarré sur `codex/phase-5-provider-readiness` depuis le merge Phase 5 `7ac09bfb593783c3b447102d5b88282f78477ef9`.

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

## Modèle de credentials attendu

- secret chiffré côté serveur uniquement;
- version et identifiant de clé de chiffrement;
- empreinte non réversible pour détecter les doublons;
- libellé, environnement, scopes et date d'expiration sans secret;
- rotation atomique;
- révocation et suppression logique auditée;
- aucune valeur sensible dans les journaux, erreurs, événements, cartes ou réponses navigateur;
- aucune réaffichage du secret après la saisie initiale.

## Limites du premier lot réel

- lecture seule;
- un fournisseur et un compte de test;
- aucune modification DNS;
- aucune création, modification ou suppression chez le fournisseur;
- aucun envoi externe;
- aucun paiement;
- aucune activation automatique;
- approbation explicite du propriétaire ou d'un administrateur;
- arrêt d'urgence et révocation disponibles avant le premier appel réel.

## Validation actuelle

La première tranche mock a été fusionnée par la PR #6 après deux runs complets verts, dont `29513872220` sur le head de clôture. Les protections de soumission HTML native sont maintenant couvertes par un test unitaire dédié dans ce lot suivant.

## Prochaine décision technique

Évaluer les fournisseurs candidats uniquement à partir de leurs sources officielles, puis retenir celui qui offre le meilleur couple utilité métier, environnement test, lecture seule, révocation et reproductibilité CI. Aucun adaptateur réel ne sera annoncé comme compatible avant ce contrôle.
