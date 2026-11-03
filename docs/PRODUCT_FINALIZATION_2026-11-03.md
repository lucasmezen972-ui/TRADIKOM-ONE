## Supabase 17.11 mis à niveau et parcours personnel vérifié — 3 novembre 2026

La mise à niveau native vers **17.11.0.011** a été confirmée après préparation : début 12:32:59UTC, retour ACTIVE_HEALTHY constaté à 12:39:48UTC, interface fournisseur «Upgrade completed!». Aucun changement de forfait ni pause/restauration de contournement. La [preuve structurée](./SUPABASE_UPGRADE_VERIFICATION_2026-11-03.json) complète la sauvegarde fraîche chiffrée hors Supabase et sa restauration depuis la copie relue.

Comparaison avant toute nouvelle connexion de recette : **153 tables / 215 lignes exactes**, journal 132, propriétaires, RLS/politiques/ACL, fonctions, privilèges par défaut et rôles/memberships inchangés. 133 tables sous RLS ; zéro table hors propriétaire tradikom_owner et zéro avis de sécurité. Sept CHECK sont affichés avec des groupes AND aplatis ; les opérandes et la priorité des OR sont conservés, relus individuellement, et 81 combinaisons booléennes/nulles donnent zéro différence. Aucun correctif des données n’est nécessaire.

Deux valeurs Vault toujours conformes aux secrets Vercel séparés ; extensions/version inchangées. Health du déploiement applicatif a0920cf : HTTP 200/database=ok. Connexion personnelle indépendante en 390 × 844, dashboard/contacts/site/Conversation et rechargements sans débordement réussis, puis déconnexion de cette session. Le compte personnel et Caraïbe Démo Services sont conservés ; zéro ancien utilisateur jetable.

TLS du client vers le pooler : certificat fourni, verify-full et rejectUnauthorized=true vérifiés dans la configuration réelle et le code. La vue serveur pg_stat_ssl observe ssl=false sur les connexions du pooler à PostgreSQL ; elle ne prouve pas le premier segment et aucune garantie TLS de bout en bout n’est revendiquée. Cette liaison interne et la restauration complète de plateforme restent à qualifier pour la production. Les fichiers temporaires de données/clé de sauvegarde et le lien privé de recette ont été retirés ; sauvegarde chiffrée et accès personnel privé conservés.

Code métier et préversion inchangés : aucun redéploiement pour cette opération. La clé OpenAI reste enregistrée pour la prochaine préversion ; IA désactivée, plafonds 0/0, aucun appel payant. Plans mock, fournisseurs privés et microphone physique restent des limites réelles. L’audit des dépendances conserve zéro high/critical et un modéré minimatch, sans avis ignoré. Ne pas répéter l’upgrade ou les recettes déjà prouvées sans changement utile.

## Sauvegarde fraîche et restauration isolée vérifiées — 3 novembre 2026

Capture SQL cohérente du schéma public à 12:18:22 UTC, journal 132 : **153 tables, 215 lignes**, puis chiffrement AES-256-GCM/HKDF avec la clé existante conservée séparément dans Vercel. Sauvegarde hors Supabase `libfile_d0c868f3eb008191ab682973a8be075f`, relue et déchiffrée : empreinte externe et toutes les empreintes internes conformes. La restauration a été rejouée depuis cette copie relue sur PostgreSQL 17.5 embarqué : données exactes, 1 281 contraintes, 540 index, 260 politiques, 65 triggers et 53 fonctions ; propriétaires, ACL, privilèges par défaut, memberships et paramètres des rôles vérifiés. Rôle runtime limité et contexte remis à zéro éprouvés ; deux rejeux de migrations sous tradikom_owner conservent les 132 entrées.

Les deux valeurs Vault correspondent par empreinte aux secrets Vercel indépendants ; les trois anciens payloads de connecteur AES-GCM sont déchiffrables avec cette clé, sans sortie du contenu. Auth et Storage sont vides. Aucun secret brut dans le dépôt ou la sauvegarde exportée de Vault. Les mots de passe de rôles et les réglages/schémas internes de plateforme restent exclus ; les rôles restaurés sont volontairement NOLOGIN. Cette preuve ne certifie pas une restauration complète de plateforme ni PostgreSQL 17.11 : le cloud interdit le lancement natif sous un autre utilisateur. Voir [preuve structurée](./BACKUP_VERIFICATION_2026-11-03.json) et [procédure](./BACKUP_AND_RECOVERY.md).

Le tableau de bord propose 17.11.0.011 avec une coupure pouvant atteindre une heure et aucun retour direct vers 17.6.1.141. Aucun upgrade n’est encore déclenché à ce checkpoint. IA désactivée et budgets à zéro ; compte personnel conservé.

## Clé OpenAI enregistrée, aucun budget autorisé — 3 novembre 2026

Lucas a autorisé le provisionnement d’une clé sans budget API. Une nouvelle clé nommée TRADIKOM ONE preview a été créée via le connecteur chiffré dans l’organisation opspilot / Default project, puis enregistrée comme OPENAI_API_KEY de type sensitive dans Vercel, exclusivement pour preview et la branche codex/tradikom-one-os. Métadonnées de stockage et portée relues ; copie locale cloud en .env.local ignorée par Git et protégée en 0600. Aucun secret brut dans les notes, le dépôt ou les sorties de conversation ; clé de transport temporaire supprimée.

Les valeurs FEATURE_CONVERSATION_MODEL=false, FEATURE_AI_GENERATION=false et les plafonds global/organisation 0/0 ont été relus. Aucun appel OpenAI, test de génération, budget ou redéploiement activé. La nouvelle variable sera injectée au prochain déploiement ; ne pas la recréer entre-temps. L’ancienne clé perdue n’est pas récupérée ni révoquée par cette opération. La configuration ne prouve pas un aller-retour modèle réel. Le code applicatif testé reste a0920cf ; les preuves de recette précédentes ne sont pas réémises.

## Plafond IA corrigé et candidat vérifié — 3 novembre 2026

Source applicatif `a0920cfa074c0168bc1161ce350629e02164b6b5`, [PR 11](https://github.com/lucasmezen972-ui/TRADIKOM-ONE/pull/11), préversion protégée `dpl_9i28ecomWHuJ9uNd1yY5xgDhdmfy` READY. Aucun changement de schéma ; Supabase reste à 132. Le correctif remplace le fallback implicite du plafond d’organisation : seule une variable absente donne le défaut de 0,10 USD. Zéro, valeur invalide ou plafond inférieur à une réservation bloque la génération avant tout débit ou appel fournisseur. Le readiness et le runtime utilisent la même lecture des deux plafonds.

Preuves de cette reprise : régression rouge avant correction, 27 tests ciblés verts ; suite locale complète **1 110 tests verts, 37 ignorés, zéro échec**, 179 fichiers verts et 16 ignorés sur 195, 1 567,97 secondes. Les tests PostgreSQL distants ignorés ne sont pas présentés comme exécutés. Lint et TypeScript globaux verts. Vercel exécute corepack pnpm@11.7.0 build avec succès sur le SHA exact (machine Standard, build terminé en 26 s). Health du déploiement exact : HTTP 200/database=ok. Connexion indépendante mobile 390×844 au compte personnel puis dashboard/contacts/site/Conversation et rechargements verts, sans débordement ; la session de ce contrôle a été fermée par l’interface.

Trois variables sont ajoutées à la seule branche preview, puis relues : génération modèle false, budgets global et organisation 0/0. Aucune clé n’est entrée, aucun appel IA payant ni message métier externe. Le coût final facturé de l’hébergement n’est pas confirmé ; aucun forfait ou add-on souscrit.

Le nettoyage des deux anciennes fixtures example.test a réussi via confirmation native et gardes d’identité/membership : zéro utilisateur, tenant ou session jetable restant en SQL. Le compte personnel et Caraïbe Démo Services restent actifs ; ne jamais les nettoyer. Les temporaires locaux identifiés des seules fixtures ont été supprimés.

Le PDF canonique a été retrouvé dans les fichiers de Lucas : référence libfile_87452c8e10f88191b16e89dede16aca9, SHA-256 exact et 71 pages vérifiés. Pages 3–7, 31–33, 46, 48 et 69–71 relues, pages 48/69 inspectées en rendu ; aucune nouvelle lecture intégrale revendiquée. Le contrôle de continuité repasse prêt, sans erreur ni avertissement, avec TRADIKOM_MASTER_PROMPT_PATH pointant vers la copie matérialisée hors dépôt.

La sonde en lecture seule de [qualification Supabase](./SUPABASE_UPGRADE_2026-11-03.md) est versionnée et exécutée : aucun index/opérateur concerné par le changelog, aucun slot logique, aucune référence PGP dans les fonctions publiques. Cela ne prouve pas la restauration plateforme ou l’absence de données PGP historiques. Aucun upgrade ou redémarrage effectué.

Restent : remplacement/transfert sécurisé de la clé perdue et budget IA distinct, aller-retour modèle réel, qualification des fournisseurs privés et préparation backup/restauration avant upgrade Supabase17.6. Les plans restent mock. La production n’est pas qualifiée ; aucune fusion ni GitHub Actions, aucune installation sur le Mac.

Les sections ci-dessous sont datées et historiques ; ce checkpoint remplace leurs instructions contradictoires.

## Recette hébergée confirmée — 3 novembre 2026

Le source `9022539246b091f3e64918b18a91c37768e97b31` est déployé en préversion protégée : `dpl_5gEdmyp1f7rVz43uFiviFYZMDupJ`, READY, target nul (preview), SHA vérifié auprès de Vercel. Le health du candidat exact répond HTTP 200, ok=true/database=ok à 07:08:30 UTC (03:08 Martinique). Ce checkpoint remplace les anciens états schéma124/non-déployé ci-dessous ; Supabase est au schéma132. L’analyseur sécurité consulté dans cette reprise renvoie zéro alerte.

Le défaut PDF hébergé est corrigé : le répertoire d’assets tracé est transmis explicitement par l’hôte au worker isolé. Recette mobile 390×844 exécutée sur la fixture ed86f8f3d252b8ce8e90 : upload d’un vrai PDF texte, extrait visible, téléchargement identique octet pour octet et extrait retrouvé après rechargement. Sept tests documents et un test de découverte sous rôle restreint repassent dans cette reprise (8/8, 14 secondes). Ce lot local ne remplace pas une suite PostgreSQL distante exhaustive.

Les journaux retrouvés confirment aussi une lecture GitHub publique et sa révocation terminale persistante après rechargement. Les preuves hébergées précédentes couvrent message/TXT, dashboard, import CSV, tâche CRM avec audit et rapport persistants, création/pause/reprise consentie/arrêt d’objectif sur mobile. Les 1 106 tests verts et 37 ignorés concernent le source7958638, pas une nouvelle campagne exhaustive sur9022539.

Le compte personnel de Lucas et Caraïbe Démo Services sont présents, actifs, avec membership owner vérifié en SQL ; ils doivent être conservés. L’onboarding, le brouillon de site et la connexion indépendante ont été prouvés dans la reprise précédente. La nouvelle relance de connexion n’a pas pu démarrer : l’ancien workspace cloud et ses dépendances ne sont plus accessibles. Aucun mot de passe, cookie ou secret n’est copié ici.

Les deux anciens comptes example.test restent à nettoyer : leurs identités/propriétés ont été vérifiées et une nouvelle transaction ciblée avec gardes a été soumise au dialogue natif ; la confirmation a expiré sans succès confirmé. Ne pas contourner ce dialogue et ne jamais inclure le compte personnel dans le nettoyage.

Restent ouverts : transfert sécurisé de la clé OpenAI (ancien fichier cloud maintenant inaccessible) et budget OpenAI distinct, aller-retour modèle réel, préparation backup/restauration/compatibilité avant upgrade du moteur Supabase17.6, qualification des fournisseurs privés. Les plans restent mock. Aucun OCR, antivirus, microphone physique, application entièrement livrée ou production validée n’est revendiqué. Le PDF maître reste inaccessible. Aucun appel IA payant ni message métier externe.

# Finalisation produit — 3 novembre 2026

Ce document remplace les anciens états pour le périmètre décrit. Il ne signifie pas que les fournisseurs absents sont activés. Le PDF canonique sur le Mac n’a pas été consulté dans cette session ; les exigences versionnées servent de référence de travail.

## Comportements implémentés

- **Objectifs** : consentement durable, pause, reprise confirmée, arrêt terminal, versions et création idempotente. Les objectifs historiques sans consentement ne sont pas évalués. Les contrôles, preuves et audits héritent des droits du fil. Aucun cron n’est ajouté.
- **Action CRM réelle** : depuis Conversation, création d’une tâche sur un contact de l’organisation, après confirmation de visibilité équipe. Tâche, activité, rapport et audit sont atomiques. Rejouer la même demande ne duplique pas la tâche.
- **Brouillons OpenAI** : composition serveur avec consentement sur le message et consentement séparé pour les extraits externes. Les propositions restent soumises aux contrats du moteur ; leur pipeline d’exécution demeure mock. L’action CRM réelle reste une commande distincte explicite. Aucune émission de message externe.
- **Documents** : TXT/CSV UTF-8 et PDF texte, 512 Kio maximum ; PDF limité à 20 pages, worker isolé, tas V8 et durée bornés. Pas d’OCR ni de scanner antivirus revendiqué. L’extrait est filtré et limité à 8 000 caractères ; son hash vérifie l’intégrité. L’original est chiffré AES-256-GCM avec AAD tenant/objet/hash et clé distincte par domaine. Téléchargement POST authentifié, même origine, sans cache ; nouveau contrôle des droits du fil. La transaction contient message, métadonnées, objet chiffré et audit. Quotas : 10 Mio par organisation et 100 Mio par instance, calculés sur les octets originaux. La suppression de l’organisation retire les objets ; la sauvegarde conserve les données chiffrées. La clé et sa version doivent être sauvegardées séparément ; changer la clé sans migration rend les anciens fichiers illisibles.
- **Dictée** : SpeechRecognition du navigateur, consentement explicite, texte modifiable avant envoi, aucun enregistrement audio conservé par TRADIKOM. Le fournisseur du navigateur peut traiter l’audio. Compatibilité et permission microphone dépendent du navigateur ; le test simule son API, pas un microphone physique. Permissions-Policy autorise uniquement le microphone de même origine ; caméra et géolocalisation restent fermées.
- **Connecteur GitHub public** : manifeste borné à public_repository_issues.read, installation consentie par un responsable, lecture manuelle et révocation terminale. API GitHub à origine fixe, sans jeton, redirection interdite, timeout, réponse bornée, 25 éléments maximum, demandes de fusion exclues. Aucun corps, commentaire ou donnée privée n’est importé. Une requête par minute par installation ; 20 installations maximum par organisation. Un résultat arrivé après révocation n’est pas publié. Les résultats sont affichés comme données externes, sans exécution.

## Configuration OpenAI, désactivée par défaut

La clé serveur ne doit jamais passer par une conversation, un journal ou le navigateur. Configuration requise : OPENAI_API_KEY, FEATURE_CONVERSATION_MODEL=true et CONVERSATION_MODEL_BUDGET_MICRO_USD. Ne pas activer FEATURE_AI_GENERATION pour ce parcours : ce drapeau concerne d’autres générateurs.

Snapshot autorisé : gpt-5.4-mini-2026-03-17. Prix standard vérifiés le 3 novembre 2026 : entrée 0,75 USD/Mtokens, sortie 4,50 USD/Mtokens ([source officielle](https://developers.openai.com/api/docs/models/gpt-5.4-mini)). Entrée complète bornée à 20 000 octets avec marge protocole de 4 096 tokens ; sortie à 1 024 tokens, sans outils et sans priorité. Réservation conservatrice de 25 000 microUSD (0,025 USD) par demande, y compris échec. Pas de remboursement automatique de la réservation, ni de remise à zéro périodique. Plafond global configurable jusqu’à 1 USD, plafond organisation par défaut 0,10 USD uniquement si la variable correspondante est absente. Un plafond explicite nul, invalide ou inférieur à une réservation bloque la génération, sans débit ni appel fournisseur. Une demande échoue fermée si le disponible est insuffisant. Le registre de coût est append-only, indépendant des sorties et de la suppression d’un tenant. Une demande réussie rejouée utilise son résultat validé sans nouvel appel ; une demande échouée ou en cours n’est jamais réémise silencieusement.

Le budget de 1 USD accordé à la préversion ne constitue pas une autorisation de dépense OpenAI. Aucun appel OpenAI réel effectué par cette recette.

## Schéma et déploiement

Migrations applicatives 125–132, miroirs SQL 0119–0126 : contrôles Goal Watch, réservations/coûts modèle, objets documentaires et connecteurs publics, avec RLS dédiée. Les politiques génériques sont retirées des nouvelles tables pour empêcher un élargissement de visibilité.

La base Supabase distante observée est au journal 124. Deux confirmations natives des migrations 125/126, puis une confirmation du lot complet 125–132, ont expiré sans effet. Ne pas envoyer ces DDL via execute_sql pour contourner la confirmation. Appliquer le lot revu par apply_migration, vérifier journal, rôles et analyseur de sécurité, puis déployer le SHA exact en preview. Le runtime de production ne migre pas au démarrage et refuse un journal incomplet. Ne pas publier ce candidat sur une base 124.

La préversion actuellement hébergée conserve le socle 0dfa1f2 et ses protections Vercel. PR 11 ouverte sans fusion ; aucun GitHub Actions, cron ni production activé. Les intégrations Meta, email et OAuth propriétaires restent à authentifier et valider séparément.

## Validation

Les résultats finaux sont reportés après la recette, avec les tests distants ignorés explicitement distingués des tests PostgreSQL embarqués. La première campagne navigateur de cette tranche a subi l’arrêt mémoire du serveur pendant une suite globale concurrente ; elle ne constitue pas une recette verte et doit être relancée seule.

Audit npm du 3 novembre : aucun avis high/critical ; un avis modéré minimatch GHSA-g3hv-75wg-m249 affecte aussi des dépendances existantes ExcelJS/ESLint. Aucun avis masqué. Le correctif publié exige la majeure 11 ; imposer cette API aux consommateurs de la majeure 3 casserait leur contrat. Les chemins concernés utilisent des motifs internes, sans motif glob contrôlé par un utilisateur dans ces nouveaux parcours. Une migration compatible des consommateurs reste suivie ; ne pas annoncer un audit sans avis.


Recette du candidat 0da2c88 : lint, TypeScript, build webpack de production et 4/4 Playwright verts. Le téléchargement mobile POST a été corrigé pour le flux vide de l’adaptateur Node tout en rejetant les corps, origines étrangères et flux non terminés. Les tests HTTP couvrent ces refus. Le PDF réel est extrait avec ses polices locales ; worker, PDF.js, assets et canvas natif sont présents dans le fichier de trace Next. Quatorze tests modèle/documents/connecteur sur PostgreSQL 17.5 embarqué sont verts. L’export applicatif restauré passe au journal 124 puis le lot exact gardé jusqu’à 132 ; propriétaires, RLS, absence de politique tenant générique et accès runtime sont vérifiés. Aller-retour GitHub réel HTTP 200 : deux éléments reçus, tous deux demandes de fusion, donc zéro ticket importé ; installation révoquée ensuite.

Première campagne exhaustive pendant développement : 1 099 tests verts, deux échecs (liste des tables attendue avant extension et ancien module SQL chargé pendant ajout de la politique d’audit), 37 ignorés. Les tests ciblés corrigés repassent ; une nouvelle campagne sur le source figé établit le résultat final : 1 105 tests réussis, 37 ignorés ; 178 fichiers verts, 16 ignorés, 194 au total, zéro échec, 551 secondes, source figé 0da2c88. Aucun test PostgreSQL distant n’est déduit des tests embarqués.


## Moteur Supabase à mettre à niveau avant production

Lecture SQL réelle du 3 novembre : PostgreSQL 17.6 et journal 124. Le [changelog officiel du 25 septembre](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) annonce que 17.11 ferme 44 CVE amont, dont certaines élevées. Le [correctif tzdata du 30 octobre](https://supabase.com/changelog/tzdata-local-time-vancouver-edmonton-casablanca) demande 17.11.0.003 ou ultérieure pour les zones citées ; America/Martinique n’y est pas signalée. Cela ne démontre pas que toutes ces CVE sont exploitables dans cette application.

Inventaire public vérifié : zéro index ltree, zéro index GiST flottant et zéro opérateur personnalisé. Les données PGP historiques pgcrypto, extensions internes et sauvegardes plateforme ne sont pas qualifiées par l’export applicatif. La mise à niveau moteur entraîne une interruption selon Supabase ; elle nécessite une sauvegarde adaptée et une fenêtre convenue. Aucun redémarrage ou upgrade moteur effectué silencieusement. Le lot applicatif 125–132 ne remplace pas ce correctif fournisseur.


Le contrôle de continuité est bloqué : PDF maître indisponible et aucune page nouvellement consultée déclarée. Les fichiers requis sont présents ; aucune conformité nouvelle au PDF complet n’est revendiquée. Le travail couvre les exigences déjà versionnées. Ce blocage de documentation ne doit pas être renommé en succès du contrôle.
