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

Snapshot autorisé : gpt-5.4-mini-2026-03-17. Prix standard vérifiés le 3 novembre 2026 : entrée 0,75 USD/Mtokens, sortie 4,50 USD/Mtokens ([source officielle](https://developers.openai.com/api/docs/models/gpt-5.4-mini)). Entrée complète bornée à 20 000 octets avec marge protocole de 4 096 tokens ; sortie à 1 024 tokens, sans outils et sans priorité. Réservation conservatrice de 25 000 microUSD (0,025 USD) par demande, y compris échec. Pas de remboursement automatique de la réservation, ni de remise à zéro périodique. Plafond global configurable jusqu’à 1 USD, plafond organisation par défaut 0,10 USD ; une demande échoue fermée si le disponible est insuffisant. Le registre de coût est append-only, indépendant des sorties et de la suppression d’un tenant. Une demande réussie rejouée utilise son résultat validé sans nouvel appel ; une demande échouée ou en cours n’est jamais réémise silencieusement.

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
