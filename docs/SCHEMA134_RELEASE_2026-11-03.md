# Recette complète et livraison compatible134 — 3 novembre2026

**En cours.** La préversion courante reste le source `d3f7a2ac9cbe24c50d5197ae697cf26c90315da7`, déploiement protégé `dpl_AseSRQa24RLsBvE4BtEUpa1xbWnp`. Le candidat compatible134 doit passer sa campagne globale et sa recette avant toute conclusion.

## Changements livrables sans migration

1. Générer explicitement le seul export de l’organisation autorisée, avec verrou, idempotence, expiration et audit. Le worker n’est pas prétendu provisionné.
2. Garder le statut Importé sélectionné dans la fiche CRM.
3. Retourner400 pour un webhook JSON malformé; accepter un ancien POST attachment réellement vide sous le garde HTTP borné.
4. Exécuter successivement les requêtes partageant une connexion de transaction, sans modifier filtres, SQL ou permissions.

Ces six patchs ont leurs régressions ciblées. Le corpus complet du release doit maintenant être exécuté sur son arbre exact. Aucune migration ni modification RLS dans cette livraison. `vercel.json` désactive l’autodéploiement seulement pour les deux branches de travail; les previews manuelles au SHA exact restent disponibles.

## Recette native acquise sur le source initial

Imports contacts/entreprises JSON, produit XLSX et opportunités CSV avec refus de montant négatif; note CRM, tâche fictive dédiée créée puis terminée; tâche précédente conservée ouverte; opportunité qualifiée avec historique et rechargement. Connaissance, stratégie, marketing, finance, réputation, veille, ventes, catalogue/bibliothèque et amélioration locale éprouvés avec leurs décisions et rechargements, sans exécution externe.

Préférences7→8→7 restaurées, rédacteur pause/reprise/version3, neuf profils disponibles. TXT224octets et PDF texte1484octets : extraction réelle, téléchargement original identique par SHA256 et rechargement. Nouvel objectif avec consentement, pause, reprise conditionnée au nouveau consentement, arrêt confirmé terminal puis rechargement. DNS : deux confirmations et simulation locale réussie, aucune modification réelle. OAuth mock : consentement PKCE, rafraîchissement, installation désactivée puis lecture explicite et synchronisation manuelle saine de fixtures3clients/2rendez-vous/1devis; aucun réseau externe. FAQ : soumission, approbation motivée, application explicite au seul brouillon puis rechargement, publication toujours manuelle.

L’ancien upload PNG5513octets échoue réellement faute de stockage, zéro asset créé. L’export existant `export_7c920f7be46344a6bd07c8fa94bc848d` reste à générer et télécharger après correction. Le sélecteur Importé doit être revérifié après déploiement.

## Candidat135 séparé et blocage natif

Le source préparé `fbb1a44177d49c0599ce85333376009bb1db27a5` contient les brokers publics, le stockage BYTEA d’images et ses quotas/ACL/intégrité, les verrous d’association/publication/restauration/suppression et le kit de restauration format2. Images/imports3MiB,10MiB/64fichiers par tenant et50MiB/512 global. Ces changements ne font pas partie du release134.

Preuves locales135 :54 tests distincts dans13fichiers pour stockage/associations;3tests dans2fichiers pour export/restauration132/135, octets/hash, quotas, ACL/RLS et rejeu; lint et TypeScript globaux verts; continuité ready avec PDF indisponible. Build local non prouvé. Le corpus216 fichiers a commencé mais a été suspendu; aucune suite globale135 verte n’est annoncée.

L’appel natif `apply_migration135` a retourné **expired**. Il n’a pas été réessayé ni contourné. SQL après expiration : journal134, `app_private` absent, zéro asset, propriétaire personnel intact. Aucun déploiement135. Une nouvelle confirmation native valide sera nécessaire à la reprise; les anciens accords ne remplacent pas cette confirmation.

## Limites

Recette native courante sur ordinateur; les preuves mobiles antérieures concernent leurs anciens SHA. Tests PostgreSQL distants ignorés non prouvés; PGlite et catalogue SQL ne les remplacent pas. Ni microphone physique, OCR, antivirus, restauration complète de plateforme ou segment interne pooler/base qualifiés ici. PDF maître inaccessible dans ce cloud, aucune nouvelle lecture revendiquée.

Compte personnel, Caraïbe Démo Services, données antérieures et session sont conservés. Aucun nouveau compte ou suppression réelle. IA modèle désactivée, budgets global/tenant0/0; clé privée existante inchangée. Plans moteur mock et propositions locales distingués d’une exécution réelle. Aucun message métier externe, abonnement, achat, fusion, production ou GitHub Actions.

## Prochaine action concrète

Terminer la campagne globale du release134, publier le SHA exact sans automatisation, créer une preview avec `target` omis et `withLatestCommit=false`, vérifier READY/SHA/protection puis générer l’export existant, télécharger et vérifier le fichier, sauver une fiche Importé, recharger documents/objectifs et consulter les logs bornés. Conserver séparément le candidat135 jusqu’à confirmation native valide.
