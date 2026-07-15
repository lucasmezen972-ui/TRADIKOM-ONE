# Phase 5 - Connectivité réelle et contrôlée

Statut: en cours sur `codex/phase-5-real-connectivity`.

## Objectif

Permettre à une organisation de préparer et superviser ses connexions externes sans confondre recommandation, simulation, sandbox et production.

## Premier checkpoint livré

- analyse DNS mock déterministe et sans réseau;
- configuration manuelle clairement marquée comme non vérifiée;
- preuves avec source, confiance, date et statut;
- instantanés DNS et plans de changement tenant-scoped;
- blocage des suppressions, changements MX, remplacement SPF, affaiblissement DMARC et changement de serveurs de noms;
- double confirmation et revalidation de l'état courant;
- simulation sans effet DNS externe;
- audit, transactions, clés tenant-composées, index et RLS.

## Deuxième checkpoint en cours

- espace français `/connexions/domaines` validé avec analyse, preuves, plan, double confirmation et simulation;
- fournisseur OAuth mock Authorization Code + PKCE;
- état haché, anti-rejeu, expiration et redirect URI exacte;
- credentials chiffrés et versionnés, rafraîchissement verrouillé et révocation;
- catalogue logiciel limité à une fixture locale annoncée comme mock et lecture seule;
- consentement français, code d'autorisation haché à usage unique et callback serveur sûr;
- espace `/connexions/logiciels` avec scopes, expiration, statut et déconnexion;
- stockage tenant-scoped, clés composées, RLS, audit et tests de sécurité ciblés.

## Troisième checkpoint en cours

- installation mock créée désactivée puis activée explicitement en lecture seule;
- policy engine obligatoire pour l'interface et le worker;
- contrôle tenant, environnement, opération, capacité, scopes, credential, versions, suspension, rupture API et quota;
- exécutions réservées par clé d'idempotence avant le quota et l'effet;
- résultats et erreurs bornés sans payload ni secret;
- centre de santé français avec état, authentification, synchronisations, latence, quota, versions, dérive, rupture et action recommandée;
- déconnexion qui révoque OAuth, invalide les demandes en attente et arrête l'installation.

## Quatrième checkpoint en cours

- import universel CSV, JSON et XLSX avec mapping explicite;
- fichier brut non conservé, aperçu normalisé et validation à blanc obligatoire;
- limites de taille, lignes, colonnes, cellules et profondeur JSON;
- rejet des formules de tableur, dédoublonnage tenant-scoped et références contrôlées;
- finalisation transactionnelle par lots, reprise, rapport d'erreur et retour arrière;
- interface française `/connexions/donnees`, rôles, audit et tests ciblés;
- correction de cohérence: une déconnexion logicielle remet aussi le résumé historique du connecteur en état non configuré.
- export CSV, JSON et XLSX par événement durable et worker idempotent;
- champs allowlistés, périodes de 366 jours, 5 000 lignes et 10 Mo maximum;
- neutralisation des formules, téléchargement authentifié sans cache et expiration après 24 heures;
- annulation, maintenance de rétention, audit et isolation tenant.

## Cinquième checkpoint en cours

- liaison tenant-scoped entre un domaine, un plan simulé et le site existant;
- preuve explicite de la version publiée présente à la demande, sans publication du brouillon;
- vérification de propagation mock par événement durable, idempotence et état de certificat;
- déconnexion auditée sans suppression DNS ni modification du snapshot public;
- relations tenant-composées, RLS, tests de prise de contrôle, isolation PostgreSQL et scénario navigateur draft/publication.
- planification bornée des credentials OAuth mock proches de l'expiration dans la file durable commune;
- événement de refresh sans secret, clé d'idempotence par échéance, corrélation et rejet des demandes obsolètes;
- verrou atomique, rotation chiffrée et reprise gérées par le worker existant.

Le checkpoint domaine et liaison est vert dans le run `29382435553`. Le refresh OAuth durable est vert dans le run `29382920239`.

## Sixième checkpoint en cours

- carte bornée composée des services domaine, site, e-mail, logiciels, installations, santé connecteur, file workflow et approbations permission-aware;
- nœuds sélectionnables, flux entrants/sortants/internes, environnements et états français;
- alternative textuelle accessible et liens directs vers les espaces propriétaires;
- synthèse de valeur qualitative avec effort, tâches potentiellement réduites, automatisations prouvées et réduction de risque;
- gain financier et gain de temps laissés indisponibles sans volumes, durées et coûts validés;
- aucune copie de credential, payload ou donnée client dans le modèle de carte.

## Revue de la première tranche verticale

Le parcours mock couvre maintenant l'analyse et la simulation DNS, la liaison au snapshot public, OAuth avec PKCE, l'installation désactivée, l'activation explicite en lecture seule, la synchronisation, la santé, l'import mappé, l'export expirant, la carte et la déconnexion. Les tests PostgreSQL vérifient les relations tenant-composées et RLS; Playwright utilise aussi une seconde session et une seconde organisation pour vérifier l'absence de fuite du libellé de connexion. Les tests de fermeture vérifient aussi les limites de fichier, les CSV malformés et le refus des cibles locales, privées ou contenant une identité URL. Aucun appel Internet, effet DNS externe, publication de brouillon ou écriture fournisseur n'est réalisé.

## Frontière de sécurité

Aucune écriture de production, modification DNS réelle, activation automatique de connecteur ou utilisation libre d'Internet n'est disponible.
