# Recette de toute l’application — 3 novembre 2026

La campagne est **en cours**. Le source hébergé au début est `d3f7a2ac9cbe24c50d5197ae697cf26c90315da7`, déploiement protégé `dpl_AseSRQa24RLsBvE4BtEUpa1xbWnp`; la branche de départ est `261efe488cd3cf5dcc4b53a701ab2cec2da848ef`. Les résultats ci-dessous ne prouvent pas encore le candidat corrigé en hébergement.

## Parcours natifs déjà vérifiés

| Fonction | Résultat et portée |
| --- | --- |
| Pages principales, dashboard, résultats | Chargement natif; rechargement et données fictives persistantes. |
| Connaissances | Création d’un fait fictif sourcé, confiance80, version1, rechargement. |
| Stratégie | Deux propositions locales, approbation de planification et refus motivé, rechargement; aucune exécution externe. |
| Marketing | Brouillons locaux, soumission et approbation de planification; aucun envoi. |
| Finance | Montant négatif refusé; revenu10000/coûts6000 → profit4000/marge40%; trésorerie5000, flux2000, CAC250; recalcul réutilise la version sans sources nouvelles. |
| Réputation et veille | Avis manuel fictif et observation illustrative, analyses locales, approbation/refus et rechargements; aucune publication ou collecte concurrentielle réelle. |
| CRM | Note, tâche dédiée créée puis terminée, conservation2027-11-03 sans opt-in marketing; tâche antérieure gardée ouverte, SQL distinct. |
| Imports | JSON contacts/entreprises, XLSX produits, CSV opportunités : aperçu sans création puis un objet valide par import; montant négatif non importé. Ancienne recette CSV/doublons conservée séparément. |
| Opportunités et vente | Recherche négative/positive, qualification125,50€/probabilité50/dates/assignation, six événements d’historique et rechargement; analyse commerciale locale persistante. |
| Catalogue et bibliothèque | Aperçus privés prêts mais désactivés, paquet workflow privé; aucune exécution installée. |
| Améliorations et santé | Décision de planification, métriques manquantes explicitement non instrumentées; avertissements mock attendus. |
| Préférences et équipe | Valeur0 refusée,7→8→7 restauré; rédacteur pause/reprise/version3; neuf profils disponibles, SQL distinct. |
| Conversation TXT | Upload224octets, extraction visible, téléchargement original identique SHA256, rechargement. |
| Conversation PDF texte | Upload1484octets, phrase réelle extraite, téléchargement original identique SHA256, rechargement. Ni OCR ni antivirus revendiqués. |
| Objectif consenti | Création, pause, reprise avec consentement obligatoire, arrêt avec confirmation obligatoire; arrêt terminal persistant sans boutons reprise/pause. Aucune programmation activée. |
| Radar et doublons | Alerte fictive ignorée puis retrouvée dans les ignorées; liste doublons vide, aucune fusion des contacts existants. |
| OAuth mock local | Consentement PKCE, rafraîchissement, installation d’abord désactivée puis lecture seule explicite; synchronisation manuelle saine de3clients/2rendez-vous/1devis fictifs, quota20→19, rechargement. Connexion mock conservée, aucun réseau externe. |
| DNS | Douze preuves de fixtures locales, deux confirmations puis simulation réussie après rechargement; aucun changement DNS. |

## Défauts reproduits et corrections intégrées au candidat

- Webhook générique : JSON invalide transformé en erreur publique400 au lieu d’une erreur500.
- Ancien accès attachment : POST réellement vide accepté par le garde HTTP borné.
- Fiche CRM : le statut importé absent du catalogue courant reste sélectionné au lieu d’être remplacé visuellement par Nouveau.
- Publication publique : brokers privés fixes avec propriétaire borné, `search_path=''`, projection du dernier snapshot cohérent et sections actives; jamais de SYSTEM global ni élargissement des tables.
- Leads publics : contexte tenant/acteur vérifié dans la transaction avant idempotence/limites; formulaire désactivé refusé.
- Images privées/publiques : accès session+membership pour le privé, snapshot exact pour le public, cache privé sans stockage, optimiseur local refusé, suppression d’image encore publiée bloquée.
- Images hébergées : le PNG fictif5513octets a réellement échoué `asset_storage_unavailable`, zéro asset SQL. Le candidat ajoute le stockage BYTEA PostgreSQL, intégrité/immutabilité,3MiB par fichier,10MiB/64fichiers par tenant et50MiB/512 global. Images/imports3MiB et enveloppe ServerAction4mb; documents512KiB inchangés.
- Association, publication, restauration et suppression : même verrou tenant, vérification des références locales de même tenant, suppression logique et audit atomiques. Upload et association restent deux transactions : un échec peut laisser une image privée inutilisée.
- Exports : génération explicite du seul job autorisé depuis l’interface, verrou/idempotence/expiry/audit; aucun worker prétendument provisionné.
- Requêtes PostgreSQL : lectures successives des sites partageant réellement une connexion de transaction. Les avertissements ont été observés dans stratégie/catalogue/améliorations; les nouveaux gardes single-flight locaux constituent une preuve distincte.
- Kit applicatif : format2 inclut `app_private`, ses brokers et compteurs, BYTEA hex et données chargées avant triggers; format1 historique132 conservé. Qualification du nouveau kit encore en cours.

## Validation locale et fournisseur

Le baseline261efe4 passe lint, TypeScript et build. Sa première campagne exhaustive interrompue n’est pas verte :48 fichiers disposent de rapports,202 tests réussis/13 ignorés, un fichier OOM non prouvé et148 non exécutés. Ne pas présenter ces nombres comme suite finale.

Les correctifs ont leurs régressions ciblées séparées. Le stockage/associations dispose de54 tests distincts dans13fichiers et lint ciblé vert : voir [reçu image](IMAGE_POSTGRES_STORAGE_VERIFICATION_2026-11-03.json). Un essai groupé a quitté132 sur allocation WASM et n’est pas compté. Les contrôles globaux du candidat doivent suivre sur un arbre gelé, fichiers isolés si nécessaire, sans secrets/fournisseurs.

La base distante est encore au schéma134. Migration135 préparée et non appliquée, aucun déploiement du candidat. Préflight : zéro asset global, `app_private` absent, propriétaire borné non-super/non-bypass, RLS des tables conservé; le LOGIN propriétaire existant ne doit pas être modifié. Confirmation native valide requise pour les opérations qui la demandent.

## Limites conservées

Cette reprise native est sur ordinateur. Les anciennes preuves mobiles concernent leurs anciens SHA et ne valident pas ce candidat. Les tests PostgreSQL distants ignorés ne sont pas prouvés par PGlite ou le catalogue SQL. Microphone physique, fournisseurs privés, restauration complète de plateforme et segment interne pooler/base restent distincts. Aucun PDF maître n’a été relu dans ce cloud; les exigences versionnées guident la campagne.

Le compte personnel et Caraïbe Démo Services sont conservés, session ouverte. Aucun nouveau compte, suppression réelle, message métier externe, achat, abonnement, production, fusion ou GitHub Actions. IA modèle désactivée et budgets global/tenant0/0; la clé existante reste privée. Les plans orchestrateur restent mock et les analyses locales ne sont pas des appels de modèle.

## Prochaine action concrète

Qualifier le kit132/135, geler et tester globalement le candidat, appliquer135 avec confirmation native valide puis déployer une preview au SHA exact sans `target` et avec `withLatestCommit=false`. Rejouer en hébergement images, publication/leads, export existant, statut Importé et les parcours corrigés; conserver source, déploiement, résultats et limites.
