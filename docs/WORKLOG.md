# Journal de travail TRADIKOM ONE OS

Ce fichier est append-only. Chaque entrée conserve les faits, commandes, décisions et limites de la session.

## 2026-07-29 - Entrée OS-0

- Lecture textuelle et inspection visuelle des 71 pages du prompt maître.
- Audit du clone local, des branches, de `origin/main`, des migrations, des modules, des documents et de la CI.
- Constat : la PR #6 est fusionnée, l'ancien worktree local était resté sur `6c47c68`; son contenu a été sauvegardé dans le stash `8b7219f` avant création de `codex/tradikom-one-os` depuis `aa46bb1`.
- PR #10 : brouillon ouvert, fusionnable, 121 fichiers, pipeline `30483590061` vert. Décision : ne pas fusionner ses vingt lots en bloc; réutiliser seulement les briques alignées après découpage.
- CI de `main` : run `30127033174` arrêté par PostCSS 8.5.16 vulnérable. Reprise du pin `>=8.5.18` déjà validé par la PR #10.
- Automation native Codex créée : `continuit-tradikom-one-os`.
- Automation repo-native ajoutée avec contrôle TypeScript, tests, exécution manuelle, sur PR et toutes les six heures.
- Aucun push, aucune fusion, aucun déploiement, aucune dépense et aucun secret manipulé.

## 2026-07-30 - Validation et préparation de la PR OS-0

- `agent:continuity-check`, la lecture JSON, la lecture YAML et `git diff --check` passent.
- L'audit de production passe après mise à niveau de PostCSS et YAML; une exception documentée reste limitée à `brace-expansion` dans les chaînes statiques ESLint et ExcelJS.
- Lint, typecheck et Vitest ne terminent pas localement et ne produisent aucun diagnostic exploitable; la CI est la validation de référence.
- Après retrait du cache `.next` obsolète, l'erreur transitoire d'import du proxy disparaît. Le serveur et le build Turbopack restent toutefois bloqués pendant la compilation sans répondre à la requête HTTP.
- Les onglets de vérification du navigateur intégré ont été fermés et les processus locaux arrêtés proprement.
- Le commit `6bcb700` est publié sur `codex/tradikom-one-os` et la PR brouillon #11 est ouverte vers `main`; sa CI devient le checkpoint OS-0.
- Les runs `30513556848` et `30513556909` de la PR #11 sont verts. Le second valide PostgreSQL, migrations, backup/restore, lint, typecheck, tests, build et Playwright en 10 min 21 s.
- OS-0 est clos; la reprise passe à OS-1 sur les tests et contrats canoniques du Conversation Hub. La PR reste en brouillon et aucune fusion n'est effectuée.

## 2026-07-30 - Contrats test-first du Conversation Hub

- La mémoire de l'automatisation était absente : cette entrée constitue son premier checkpoint.
- `pnpm agent:continuity-check` passe. La PR brouillon #11 reste ouverte et fusionnable; les runs `30514520472` et `30514520487` sont verts sur `e2a092b`.
- Les tests ont d'abord été ajoutés et ont échoué sur l'absence attendue du module, puis `src/modules/conversation-hub/schemas.ts` a été créé.
- Le contrat canonique couvre les identités de canal, fils, messages, références de pièces jointes, clés d'idempotence et corrélation, ainsi qu'une trace bornée qui refuse les boucles. Les objets sont stricts et n'acceptent aucun payload brut.
- Les identifiants tenant sont obligatoires et l'entrée refuse une identité de canal d'un autre tenant. Les statuts, participants, texte, pièces jointes, tailles et traces sont bornés.
- Le test ciblé passe avec 5 tests; ESLint ciblé passe. Le build Next.js local avec les valeurs factices déjà publiques du workflow CI passe, y compris TypeScript.
- `pnpm typecheck`, `pnpm test` et `pnpm lint` complets reproduisent le blocage Node local silencieux déjà documenté et ont été interrompus sans diagnostic. Le build TypeScript vert et la CI distante verte restent les preuves disponibles.
- `.git/HEAD` a été observé brièvement vide puis restauré par un processus local concurrent; aucune écriture dans `.git`, aucune réinitialisation et aucune réparation n'ont été tentées.
- Aucun push, commit, merge, déploiement, dépense, secret ou fournisseur réel n'a été utilisé.

## 2026-07-30 - Persistance tenant-scoped du Conversation Hub

- Les tests de migration ont été écrits avant la persistance et couvrent les sept tables canoniques, l'absence de payload brut, les relations inter-tenant, l'idempotence, la taille des pièces jointes et l'anti-boucle.
- Les migrations runtime `067_os1_conversation_hub` et `068_os1_conversation_hub_rls` sont ajoutées avec les miroirs SQL `0061` et `0062` strictement identiques.
- Chaque table porte `tenant_id`, une clé ou un index tenant-leading, des relations tenant-composées et une politique RLS `ALL`. Les colonnes de clés étrangères utilisées par les parcours principaux sont indexées.
- Le test PostgreSQL RLS existant couvre désormais l'absence de contexte, la lecture limitée au tenant, l'écriture cross-tenant et la relation fil/identité inter-tenant.
- La parité runtime/SQL et `git diff --check` passent. Les nouvelles tentatives Vitest et ESLint restent bloquées sans diagnostic sur le runner Node local; la CI Linux/PostgreSQL devient l'arbitre.
- Aucun écran, fournisseur, secret, payload brut, exécution externe, fusion ou déploiement n'est ajouté.

## 2026-07-30 - Service tenant-aware du Conversation Hub

- La CI de la persistance est verte sur les runs `30546099003` et `30546098944`, avec PostgreSQL/RLS, migrations, lint, typecheck, tests, build et Playwright.
- Le repository impose `tenant_id` sur chaque lecture et mutation. Les listes de messages et données associées sont bornées et ordonnées de façon déterministe.
- Le service vérifie le membership et les rôles d'écriture côté serveur, encapsule l'ingress dans une transaction tenant, réserve la clé d'idempotence et rejoue sans doublon.
- Les identités externes sont stabilisées par tenant et adaptateur; une collision d'identité canonique est refusée. Les identités bloquées ou révoquées ne peuvent pas ingérer.
- Les audits de réception et de replay ne contiennent que l'identifiant du fil, la direction, le statut, le nombre de pièces jointes et l'état d'idempotence, jamais le texte, le visiteur, le nom de fichier ni le stockage.
- Les tests couvrent replay, restitution canonique, pièces jointes, provenance, membership absent, rôle lecture seule, isolation de lecture et conflit d'identité.
- ESLint ciblé reste bloqué sans sortie sur le runtime Node local connu; le checkpoint est préparé pour validation par la CI de la PR.

## 2026-07-30 - Durcissement du checkpoint service

- La lecture du fil s'exécute désormais dans une transaction portant le contexte tenant et acteur PostgreSQL avant toute requête sur les tables protégées par RLS.
- Un rejeu n'est accepté que si la clé d'idempotence correspond au même message sûr; une collision sur le contenu ou la provenance stable renvoie `conversation_idempotency_conflict` sans journaliser le contenu.
- Une nouvelle identité déjà marquée bloquée ou révoquée est refusée avant toute création. Les tests ajoutent aussi le refus d'une relation vers un fil d'un autre tenant.
- Les contrôles texte ne trouvent ni marqueur de conflit, ni espace terminal, ni fournisseur, credential ou payload brut dans le nouveau coeur. Toutes les requêtes du repository incluent le tenant dans leurs filtres ou valeurs.
- `pnpm agent:continuity-check`, Vitest ciblé, ESLint ciblé et TypeScript ont été tentés puis interrompus après blocage silencieux reproductible. La dernière CI verte `30546099003` valide la persistance, pas encore ce lot service local.
- Le lot ne peut pas être soumis à la CI sans publication; aucune autorisation de push n'étant donnée, aucun commit, push, merge ou déploiement n'a été effectué et aucun secret, fournisseur réel ou dépense n'a été utilisé.

Correction de continuité : le mandat utilisateur de poursuivre le chantier et l'autorisation de travail sur la branche avaient déjà conduit à publier ce lot sur `aee85da`; la CI `30548008916` est en cours. Aucune fusion ni aucun déploiement n'a été effectué.

## 2026-07-30 - Adaptateur canal de test

- `src/modules/channels/test-channel.ts` normalise un message de test vers l'ingress canonique sans transport, SDK, credential ni appel réseau.
- L'identité de test est stable par tenant et sujet externe grâce à une empreinte SHA-256 non secrète; elle ne peut donc ni collisionner entre tenants ni exposer le sujet dans un identifiant interne.
- L'adaptateur conserve clé d'idempotence, corrélation, message externe et trace de routage anti-boucle.
- Le test démarre un fil depuis le canal web, injecte puis rejoue le même message depuis `canal-test`, vérifie deux projections dans le même fil et prouve que `fetch` n'est jamais appelé.

## 2026-07-30 - Correctif CI et web chat minimal

- La CI `30548008916` valide migrations, lint et typecheck sur `aee85da`, puis échoue uniquement sur les deux tests du service Conversation : le fil créé à l'ingress refusait un message métier plus ancien que sa création technique.
- `updateConversationThreadLastMessage` conserve désormais la première occurrence métier comme création du fil et la dernière occurrence comme dernier message. Le test verrouille les deux dates sans retirer la contrainte SQL.
- L'adaptateur `web-chat` crée une identité membre stable par tenant et utilisateur, puis passe exclusivement par l'ingress canonique.
- Le facade borné `getConversationChannelServices` évite d'ajouter les nouveaux canaux au monolithe `src/lib/services.ts` tout en centralisant migration, lecture et mutation.
- L'écran protégé `/conversation` affiche les fils récents, leur provenance web/test et deux formulaires français. Le tenant vient uniquement de la session serveur; les clés d'idempotence, corrélation et dates sont conservées dans chaque soumission pour rendre le rejeu sûr.
- Le rôle `read-only` voit le fil mais ne peut pas envoyer. Le canal de test reste explicitement local et sans fournisseur externe.

## 2026-07-30 - Plan structuré et catalogue des capacités OS-1

- Le run `30549936954` est vert sur `e561f57` et valide migrations, lint, typecheck, 223 tests, build, Playwright, adaptateurs web/test et écran Conversation.
- `actionPlanSchema` borne intention, objectif, confiance, questions, risque, coût, douze étapes maximum, preuves, entrées et clés d'idempotence uniques. Les objets sont stricts et les clés sensibles sont refusées récursivement.
- Chaque proposition conserve tenant, fil, message source, version de schéma, source de génération, éventuelle référence modèle et état d'approbation; aucun champ d'exécution libre n'est accepté.
- Le catalogue OS-1 déclare `crm.contacts.search` et `project.task.create` comme capacités génériques en environnement mock, avec mode, risque, approbation, réversibilité, compensation, scopes, schémas, coût nul, batch et catégories de données.
- Le validateur refuse rôle lecture seule, contexte manquant, coût externe, capacité absente, scope manquant ou politique altérée, puis résume au maximum une validation pour le plan complet.
- Les migrations `069`/`070` et miroirs `0063`/`0064` ajoutent plans et étapes tenant-scoped, relations composées, index tenant-leading, RLS, fingerprint, unicité de l'approbation et triggers d'immuabilité.
- Les tests de migration couvrent source inter-tenant, étape et idempotence dupliquées, deuxième approbation et mutations du plan exact. La parité runtime/SQL est verte; l'exécution CI reste à lancer.

## 2026-07-30 - Service de plan et validation unique

- Le run `30551054764` valide les migrations et le lint de `8288791`, puis le typecheck trouve un seul fixture dont l'inférence interdisait la clé de sécurité testée. Le fixture est maintenant explicitement typé `ActionPlan`.
- Le générateur déterministe implémente l'abstraction de génération sans recopier le texte client, sans réseau, fournisseur, modèle ni coût; ses clés d'idempotence sont dérivées d'une empreinte bornée du message source.
- La création vérifie le rôle avant toute génération, relit le message source sous contexte RLS, refuse les messages internes, valide capacité/policy/scope, calcule le fingerprint et persiste plan, étapes et approbation dans une transaction.
- Un replay relit le même plan sans dupliquer étape, approbation, message ou audit. Le plan est projeté comme message canonique `plan` par l'identité système mock et place le fil en attente de validation.
- La décision est réservée aux propriétaires, administrateurs et managers. Elle met à jour l'unique approbation, le plan et ses étapes atomiquement, projette un message `approval`, rouvre le fil et audite fingerprint, identifiants et statut sans conserver la raison dans l'audit.
- Les tests couvrent absence de réseau, création/replay, deux capacités, fingerprint, projection, décision/replay/conflit, isolation tenant et refus du collaborateur.

## 2026-07-30 - Diagnostic CI et checkpoint local du service de plan

- `pnpm agent:continuity-check` a été exécuté sur le checkpoint local, puis interrompu après un blocage silencieux dans la chaîne Git/Node locale. La PR #11 reste ouverte, en brouillon et fusionnable; le workflow de continuité distant `30551055232` est vert sur le head publié.
- Le diagnostic spécialisé du run CI `30551054764` confirme un unique échec TypeScript dans le fixture de schéma; migrations PostgreSQL, backup/restore et lint sont verts. Le fixture local est maintenant explicitement typé `ActionPlan`.
- Le test d'intégration du service verrouille création et replay sans réseau, plan/étapes/approbation uniques, projection dans le fil, décision idempotente, conflit de décision, audit sans texte client ni raison, isolation tenant et contrôle des rôles.
- Vitest ciblé, ESLint ciblé, `tsc --noEmit`, `agent:continuity-check` et `git diff --check` restent silencieux sur le runtime local et ont été interrompus proprement après des fenêtres bornées. La lecture JSON, l'absence de marqueurs de conflit et d'espaces terminaux passent par des contrôles indépendants; la prochaine CI publiée reste l'arbitre exécutable.
- La revue statique confirme `tenant_id` dans chaque requête du repository, les transactions avec contexte tenant/acteur, les politiques RLS, le fingerprint audité, l'absence de transport fournisseur et le catalogue exclusivement mock à coût nul.
- Le checkpoint a ensuite été publié dans `1dca742` conformément au mandat explicite de poursuivre le chantier. Aucun merge, déploiement, dépense, secret ou fournisseur réel n'a été utilisé.

## 2026-07-30 - Interface de plan et validation unique

- L'écran Conversation charge les plans par fil sous contrôle tenant, affiche le plan immuable, ses deux capacités mock, le risque, la confiance et le coût externe nul.
- Les responsables, administrateurs et propriétaires disposent des commandes françaises Approuver/Refuser avec motif; les collaborateurs voient l'état mais ne peuvent pas décider.
- La création du plan cible le dernier message texte entrant et les actions serveur passent par le service tenant-aware. Les messages internes de plan et de décision sont identifiés comme TRADIKOM ONE dans la chronologie.
- Le listing de plans est testé pour l'isolation tenant. La prochaine tranche est l'exécution mock durable après validation CI de cette interface.

## 2026-07-30 - Prompt maître rendu exécutable par l'automation

- Le PDF canonique `Tradikom_One_OS_Prompt_Maitre_Codex_Acces_Ordinateur.pdf` est confirmé à 71 pages avec l'empreinte SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Le texte a été extrait sur 71/71 pages. Les pages 1, 5, 31, 46, 69 et 71 ont aussi été rendues et vérifiées visuellement pour confirmer mandat, doctrine anti-dérive, roadmap, parcours démontrable, matrice de tests et gouvernance finale.
- `docs/MASTER_PROMPT_REFERENCE.md` devient l'index versionné : pages cœur obligatoires à relire, carte des sections et contrat de preuve. Le PDF reste la source normative et son empreinte est contrôlée localement.
- `AGENT_STATE.json`, `NEXT_STEPS.md` et `DRIFT_REPORT.md` doivent désormais citer les pages réellement appliquées, l'exigence active, la preuve attendue et les écarts restants.
- Le contrôle de continuité bloque une référence, un état ou un drift report non relié au prompt maître. En CI, l'absence du PDF local est signalée; l'automation locale doit alors bloquer toute nouvelle sélection de tâche.
- L'automation native `continuit-tradikom-one-os` conserve son exécution horaire à la minute 17, son modèle et son niveau de raisonnement, mais impose maintenant lecture directe des pages cœur, routage par la carte paginée, ordre exact de la page 48 et preuve selon les pages 32 et 69.
- Le contrôle renforcé exécuté directement par Node 22 retourne `ready`, sans erreur ni avertissement, et valide l'empreinte du PDF local. Vitest ciblé reste bloqué silencieusement sur le runtime local connu et a été interrompu proprement.
- Le script `agent:continuity-check` n'utilise plus le chargeur `tsx` qui se bloquait localement; il passe désormais par le support TypeScript natif de Node 22. La commande exacte `pnpm agent:continuity-check` termine en environ six secondes avec zéro erreur et zéro avertissement.
- Aucun push, merge, déploiement, dépense, secret ou fournisseur réel n'a été utilisé pour ce renforcement.

## 2026-07-30 - Exécution mock durable et résultat multicanal

- Le plan approuvé est traduit en définition bornée du moteur de workflows existant : un événement idempotent, un run persistant et exactement deux actions `mock_search_contact` puis `mock_create_task`.
- Les handlers mock ne font aucun appel réseau et ne créent ni tâche CRM ni effet externe. Ils ne persistent que des références de plan, une preuve sûre et l'environnement `mock`.
- Les étapes de plan passent par `running` puis `succeeded`; le plan devient `executed`, un message canonique `result` est créé et ses routes web/test sont persistées.
- Le replay retrouve le même workflow run sans dupliquer événement, étapes, message, audit ou résultat. L'audit conserve fingerprint, run et classification sûre sans motif ni contenu client.
- Le test d'intégration couvre refus avant approbation, contrôle de rôle, deux canaux, absence de `fetch`, absence de tâche réelle, durabilité, replay et audit. Le test de migration Conversation inclut désormais les deux tables de plan observées par la CI.

## 2026-07-30 - Parcours Playwright Conversation desktop et mobile

- Un scénario isolé crée un tenant dédié puis rejoue la verticale complète en `1440x900` et `390x844` : message web, réponse canal de test, plan, validation unique, exécution mock et résultat.
- Les trois commandes critiques de plan sont focalisées puis activées avec la touche Entrée pour prouver le parcours clavier.
- Après chaque parcours, une requête SQL vérifie exactement un workflow run, deux étapes mock, deux routes de résultat, un audit d'exécution et zéro tâche CRM réelle.
- Le scénario est prêt à être publié; la CI de `84d064c` a déjà validé migrations, backup/restore, lint et typecheck du moteur durable et poursuit les tests complets.

## 2026-07-30 - OS-1 validé et clôturé

- Le run CI `30554462472` est entièrement vert sur `95da35e` : migrations, backup/restore, lint, typecheck, 234 tests, build production et Playwright en 10 min 37 s.
- Le run de continuité `30554462620` est vert en 22 s. Les deux checks de la PR #11 sont réussis, sans job en attente.
- Le parcours Conversation passe en desktop et mobile, au clavier, avec exactement un run durable, deux étapes mock, deux routes de résultat, un audit et aucune tâche CRM réelle.
- `OS1_VALIDATION_REPORT.md` confronte la tranche à la Definition of Done de la page 32 et à chaque couche de la matrice page 69.
- OS-1 passe à Terminé et OS-2 à En cours. Aucun merge, déploiement, fournisseur réel, secret ou dépense n'est engagé par ce passage.

## 2026-07-30 - Audit et contrat transversal OS-2

- Les pages 13 à 15 et 64 à 68 du prompt maître ont été relues pour l'identité volontaire, le contrat ChannelAdapter, le provider runtime et les quatre canaux demandés.
- L'inventaire classe WhatsApp/Twilio, Teams et Slack comme absents du runtime; l'email possède un mode console/test sûr et un provider Resend HTTP extractible de la PR #10. Le lien `wa.me` de cette PR ne constitue pas un adaptateur entrant.
- Le contrat commun borne manifeste, capacités, webhook brut, pièces jointes autorisées, envoi, résultat et erreurs normalisées. Il impose la vérification avant normalisation canonique.
- Le registre des quatre fournisseurs n'effectue aucun appel réseau. Flag absent : `disabled`; configuration incomplète : `not_configured`; noms de variables présents : `awaiting_human_auth`. Il ne produit jamais `ready` et maintient tous les transports désactivés.
- Les variables sont documentées sans valeur dans `.env.example`; aucun secret réel n'est manipulé. Les plugins externes Slack/Teams et les consoles fournisseurs ne sont pas ouverts.
- Les tests couvrent l'absence de réseau, les quatre états désactivés, la configuration manquante, l'attente humaine, l'interdiction d'un faux état prêt et la limite du payload brut.
- Le contrôle de continuité et `git diff --check` passent. Vitest et ESLint ciblés reproduisent le blocage Node local silencieux et sont interrompus proprement; la CI de la PR reste l'arbitre exécutable.

## 2026-07-30 - Provider Email/Resend préparé sans activation

- Le checkpoint transversal précédent `d181a97` est entièrement vert : CI `30556603463` et continuité `30556603427`.
- Le provider HTTP de la PR #10 est extrait séparément, sans reprendre les suppressions, écrans CRM ou mutations sans rapport de cette branche.
- La documentation officielle Resend a été vérifiée pour l'API d'envoi, la limite d'idempotence de 256 caractères/24 heures, les erreurs `409`, `429` et `5xx`, et la future signature Svix sur corps brut.
- L'origine API est constante, les redirections sont refusées, le timeout est borné et aucun texte d'erreur fournisseur n'est propagé. Le message est limité à 2 Mio et la réponse lue en flux à 8 Kio maximum.
- La clé d'idempotence est l'empreinte du payload exact : un replay identique garde sa clé, une modification en change, et ni destinataire ni token ne sont placés dans l'en-tête.
- `createRuntimeEmailProvider` n'active pas Resend, même si des noms de variables sont présents. Il renvoie `unavailable`; le provider console est désormais impossible en production, conformément à la page 67.
- Les tests couvrent origine, absence de redirection, idempotence, quota, indisponibilité, conflits concurrents/permanents, clé invalide, domaine refusé, payload/réponse bornés, timeout, échec réseau, absence de fuite et sélection runtime sûre.
- Vitest ciblé reproduit le blocage Node local silencieux; ce lot attend lint, typecheck et tests exécutables dans la CI de la PR.

## 2026-07-30 - Vérificateur webhook Resend officiel

- Le provider préparé `f716b16` est entièrement vert dans la CI `30557617612`; la continuité `30557617778` est également verte.
- La dépendance officielle `svix@1.99.1` est épinglée. L'audit de production passe avec l'unique exception haute déjà ignorée et sans advisory actif supplémentaire.
- Le client d'envoi ajoute deux tags bornés : type métier et tenant. Aucun destinataire, sujet ou token n'est placé dans ces tags.
- `verifyResendWebhook` borne le corps à 512 Kio, exige les trois en-têtes Svix et vérifie le corps brut avant parsing. Le SDK officiel applique aussi sa fenêtre anti-rejeu de cinq minutes.
- Seuls sept événements opérationnels sont acceptés; ouvertures et clics sont exclus. La sortie sûre omet destinataire, sujet, contenu et détail de bounce.
- Les tests signent avec Svix et couvrent altération du corps, timestamp expiré, secret/en-têtes absents, Unicode surdimensionné, événement non nécessaire, mapping tenant absent et normalisation des statuts.
- Aucune route publique, table, mise à jour métier, console fournisseur, credential ou activation n'est ajoutée dans ce checkpoint.
- Vitest local déclenche l'installation de dépendances puis reproduit le blocage Node local connu; la CI sera l'arbitre exécutable.

## 2026-07-30 - Persistance minimale des événements email

- Le vérificateur `860a14d` est entièrement vert dans la CI `30559230976`; la continuité `30559230886` est verte.
- Les migrations runtime `071`/`072` et miroirs `0065`/`0066` créent `email_provider_deliveries` et `email_provider_events`.
- Aucune colonne ne peut conserver corps, payload, adresse, sujet ou message de bounce. Seuls identifiants bornés, hash destinataire, statut et dates opérationnelles sont présents.
- Livraison et événement portent `tenant_id`, relations composées, index tenant-leading et RLS `ALL`. L'email fournisseur et `svix-id` sont uniques globalement pour empêcher une réattribution inter-tenant.
- La relation événement vérifie simultanément tenant, livraison et email fournisseur. Les tests refusent source inter-tenant, mauvais email, doublon provider, doublon `svix-id` et références non bornées.
- La parité exacte runtime/SQL et `git diff --check` passent. Le checkpoint attend la CI PostgreSQL avant publication du service déjà préparé localement.

## 2026-07-30 - Service tenant-aware des événements Resend

- La CI `30560346248` valide migrations, backup/restore, lint, typecheck et PostgreSQL RLS. Elle termine avec 265 tests verts et deux échecs de fixtures : un token d'invitation dupliqué dans le nouveau test et une assertion OS-1 qui supposait encore que sa migration restait la dernière. Les deux fixtures sont corrigées.
- Le service réserve une livraison Resend uniquement pour un propriétaire ou administrateur, une invitation en attente du même tenant et le même destinataire normalisé. Seul un hash du destinataire est stocké.
- L'ingestion appelle d'abord le vérificateur Svix officiel, puis résout la livraison avec tenant et email fournisseur sous verrou. Le `svix-id` est globalement dédupliqué; une collision différente est refusée.
- Les événements sont immuables en SQL. Un événement tardif reste dans le journal sans faire régresser l'état courant; à date égale, le rang opérationnel tranche de façon déterministe.
- Les audits ne contiennent ni adresse, sujet, corps, token ni détail de bounce. L'intégration invitation n'enregistre une correspondance que pour un résultat Resend `sent` doté d'un identifiant.
- Une réponse Resend 2xx sans identifiant sûr devient `retryable_failure/provider_response_invalid`; elle n'est plus présentée comme envoyée.
- Vitest et ESLint ciblés reproduisent le blocage Node local silencieux connu. `git diff --check` passe; la prochaine CI est l'arbitre exécutable.

## 2026-07-30 - Route HTTP Resend refusée par défaut

- Le checkpoint service `199482a` est publié. Sa continuité `30561347436` est verte; sa CI `30561347444` a déjà validé migrations, backup/restore, lint et typecheck avant les tests.
- Les tests de ce run confirment 268 cas verts et révèlent deux causes de fixture : le trigger n'avait été ajouté qu'au miroir SQL, et le second tenant du setup service réutilisait le même token. La migration runtime et le token sont corrigés; un test compare désormais automatiquement runtime et miroirs `0065`/`0066`.
- La route `/api/webhooks/resend` reste fine et délègue au service OS-2. Elle refuse immédiatement les états `disabled`, `not_configured` et `awaiting_human_auth`; le registre actuel ne sait pas produire `ready`.
- Aucun corps ni accès base n'a lieu avant l'état prêt. Le chemin futur impose `application/json`, lit au plus 512 Kio en flux, refuse l'UTF-8 invalide et transmet exactement corps brut et en-têtes Svix.
- Les réponses n'exposent ni tenant, livraison, email fournisseur, `svix-id`, PII ni code interne. Les événements volontairement ignorés sont acquittés; un mapping encore absent reçoit 503 avec retry borné.
- Les tests couvrent les trois états non prêts, corps brut, taille déclarée et effective, type de contenu, événement ignoré, mapping retardé et normalisation sûre des erreurs.
- La syntaxe TypeScript ciblée des trois nouveaux fichiers est valide. La validation exécutable complète attend le prochain checkpoint CI; aucune variable, clé, connexion ou route réelle n'est activée.

## 2026-07-30 - Vérificateur WhatsApp/Twilio officiel sans activation

- Le checkpoint HTTP Resend `6dd61b5` est entièrement vert : CI `30562294162`, continuité `30562294361`, migrations, backup/restore, lint, typecheck, 268 tests, build et Playwright.
- La copie iCloud ayant été évacuée localement par macOS, une copie de travail intacte a été clonée dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`. L'original n'a pas été supprimé et l'automation horaire cible explicitement la copie stable.
- La dépendance officielle `twilio@6.0.2` est épinglée. L'audit de production ne rapporte aucun advisory actif supplémentaire; l'unique niveau haut reste l'exception historique documentée.
- `verifyTwilioWebhook` transmet l'URL reçue directement au SDK officiel, refuse HTTP, credentials et fragments, et borne le corps à 512 Kio réels avant toute normalisation.
- Les formulaires conservent tous les paramètres, y compris les clés dupliquées sous forme de tableaux attendus par le SDK. Les corps JSON utilisent `validateRequestWithBody` et le `bodySHA256` de l'URL exacte.
- La sortie vérifiée ne contient ni corps, texte, numéro de téléphone ni paramètre libre. Seuls les SID Twilio syntaxiquement sûrs et le nombre de paramètres peuvent être exposés.
- Les six tests couvrent absence de token, signature valide, doublons, altération corps/URL, JSON signé, limites et absence de réseau. Vitest ciblé, ESLint ciblé et typecheck complet passent localement.
- La route `/api/webhooks/twilio/whatsapp` refuse avant lecture dans les trois états actuels et si l'URL publique HTTPS configurée est absente ou invalide. Elle ne reconstruit pas l'URL à partir d'en-têtes proxy.
- Le corps est lu en flux à 512 Kio maximum, décodé en UTF-8 strict et transmis exactement avec `X-Twilio-Signature`. Les erreurs sont françaises, `no-store` et n'exposent ni code interne ni contenu.
- Les 23 tests ciblés registre/vérificateur/HTTP, ESLint, typecheck complet et build production local passent. Le build inventorie bien la nouvelle route dynamique.
- `consumeVerifiedTwilioFormWebhook` ne remet les paramètres à son consommateur qu'après signature valide. Une charge JSON, une signature altérée ou un formulaire hors limites ne peuvent pas atteindre la préparation WhatsApp.
- L'enveloppe entrante exige SID, adresses `whatsapp:+E164`, nombre de médias et horodatage bornés. Les doublons sur champs sensibles, messages vides et plus de dix médias sont refusés.
- Les URLs média doivent être HTTPS sur `api.twilio.com` avec un SID final sûr; elles sont seulement préparées en mémoire et jamais téléchargées. Les clés d'idempotence et corrélation dérivent de `MessageSid`.
- Les 34 tests ciblés registre/vérificateur/HTTP/adaptateur, ESLint et typecheck complet passent.
- Aucun credential, appel réseau, accès base, mapping tenant, ingestion canonique, envoi WhatsApp ou état `ready` n'est ajouté dans ce checkpoint.

## 2026-07-30 - Mapping tenant des endpoints fournisseur sans PII

- Le vérificateur Twilio `7609ad8` est entièrement vert : CI `30563781762`, continuité `30563781851`, migrations, backup/restore, lint, typecheck, tests, build et Playwright.
- Les migrations runtime `073`/`074` et miroirs `0067`/`0068` créent `channel_provider_endpoints`, son trigger d'identité immuable et sa policy RLS tenant/système.
- La conception suit les règles PostgreSQL/Supabase : contrainte unique globale pour le lookup exact, index composite tenant/provider/statut, index de la clé étrangère `created_by` et index tenant-leading pour la RLS.
- Aucune adresse, destination, numéro, payload, credential ou token n'est stocké. Le lookup utilise une empreinte HMAC-SHA256 versionnée avec le secret de chiffrement connecteur, le SID de compte et l'adresse canonique.
- Seuls propriétaire et administrateur peuvent réserver, activer ou désactiver un endpoint. La même destination ne peut pas être attribuée à deux tenants; un replay dans le même tenant ne duplique ni ligne ni audit.
- La résolution entrante globale s'exécute uniquement sous transaction système, retourne seulement `endpointId` et `tenantId`, et ignore immédiatement un endpoint désactivé.
- Les audits omettent SID, adresse et empreinte. Les 8 tests ciblés couvrent parité SQL, colonnes interdites, contraintes, immutabilité, conflit inter-tenant, rôle, replay, résolution et désactivation.
- Aucun endpoint réel n'est configuré, aucun secret n'est créé, aucune ingestion de message ou activation de transport n'est encore branchée.

## 2026-07-30 - Ingestion WhatsApp canonique préparée et désactivée

- Le lot route/enveloppe `f4e4816` est entièrement vert : CI `30564535609`, continuité `30564535551`, migrations, backup/restore, lint, typecheck, tests, build et Playwright.
- Le service entrant vérifie et prépare le webhook avant tout accès base. Une signature altérée ne déclenche aucune requête, ce que le test d'intégration vérifie directement.
- Résolution de l'endpoint et ingestion Conversation Hub s'exécutent dans la même transaction système. Un mapping absent ou désactivé retourne un échec temporaire sans créer de fil ni message.
- L'identité client ne stocke jamais le numéro WhatsApp : son sujet externe, son participant et son identité utilisent une empreinte HMAC tenant-scoped. Le destinataire et l'URL média restent éphémères.
- `MessageSid` alimente l'identifiant externe, l'idempotence et la corrélation. Un replay conserve le même message et le même fil; seul un audit de replay sûr est ajouté.
- Les médias ne sont pas téléchargés ni persistés. Un message média-only devient une indication française bornée « média WhatsApp en attente d’import » sans URL fournisseur ni pièce jointe fictive.
- Le Conversation Hub possède désormais une entrée système explicite, réutilisant exactement les contrôles d'identité, de replay, de route et d'audit sans attribuer le webhook à un humain.
- La route ne peut toujours pas atteindre `ready`; aucun credential, endpoint réel, appel Twilio sortant ou média distant n'est activé.

## 2026-07-30 - Frontière Microsoft Teams officielle et fail-closed

- Le mapping et l'ingestion WhatsApp `19ff401` sont entièrement verts : CI `30565079771`, continuité `30565079790`, migrations, backup/restore, lint, typecheck, tests, build et Playwright.
- La documentation Microsoft actuelle confirme que la frontière HTTP Teams doit valider signature JWKS, émetteur, audience, expiration et algorithme RS256 avant tout handler. Le SDK Teams TypeScript v2 officiel `@microsoft/teams.apps@2.0.14` est épinglé; aucun nouvel advisory actif n'est ajouté.
- Le vérificateur utilise `ServiceTokenValidator` du SDK officiel avec un logger silencieux : aucun token, payload, nom ou détail d'erreur Microsoft n'est journalisé. Un Bearer mal formé est refusé avant création du validateur.
- L'activité JSON est bornée à 1 Mio, UTF-8 stricte et projetée sur les seuls identifiants nécessaires. Noms, payload inconnu, contenu et URL de pièce jointe ne quittent jamais la frontière; les URL de service doivent être HTTPS sans credentials ni fragment.
- La route `/api/webhooks/microsoft/teams` refuse avant lecture dans les trois états actuels. Le registre reste incapable de produire `ready`; même le chemin futur vérifié retourne 503 tant qu'aucun endpoint n'est attribué à un tenant.
- Les 12 tests ciblés couvrent refus avant lecture, validation avant consommation, rejet JWT, activité ignorée, taille réelle/déclarée, URL sûre et absence de propagation du payload. ESLint, typecheck, 328 tests complets et build de production passent; Next.js inventorie la route Teams.
- Aucun tenant Microsoft, application Entra, consentement administrateur, secret, endpoint réel, transport sortant ou appel fournisseur n'est créé.

## 2026-07-30 - Mapping et ingestion Microsoft Teams sans activation

- Le repository endpoint devient générique par provider sans élargir la table : toutes les lectures et mutations portent explicitement `provider`, `tenant_id`, compte externe et empreinte. Le comportement WhatsApp existant reste couvert.
- Un propriétaire ou administrateur peut réserver logiquement un couple application/tenant Microsoft. Seule l'application publique et une empreinte HMAC du tenant Microsoft sont stockées; l'unicité globale refuse sa réattribution à un autre tenant TRADIKOM.
- La route ne remet à la base que l'enveloppe déjà validée par le SDK. La résolution endpoint, l'identité Teams et le fil externe utilisent des HMAC tenant-scoped différents; les références Microsoft brutes ne sont ni stockées dans les identités, ni auditées.
- Le Conversation Hub permet désormais aux seules ingestions système de créer un identifiant de fil externe déterministe. Les mutations humaines conservent le refus d'un fil absent. Deux messages WhatsApp ou Teams d'une même conversation retrouvent donc le même fil canonique.
- L'Activity ID est rejoué sans doublon; idempotence et corrélation utilisent une empreinte SHA-256 bornée. Les pièces jointes deviennent une notice française et restent sans contenu, URL, faux asset ni téléchargement.
- Les 27 tests ciblés canaux/Conversation Hub, le typecheck, 333 tests complets et le build de production passent. Ils couvrent replay, continuité multi-message, mapping absent/désactivé, conflit inter-tenant, HMAC, absence de PII et absence de `fetch`.
- La frontière Teams précédente `4ecda6f` est entièrement verte : CI migrations/backup/lint/typecheck/tests/build/Playwright et continuité réussies.
- Aucun tenant Entra, application, consentement, credential, endpoint réel ou transport Microsoft n'est activé.

## 2026-07-30 - Frontière Slack v0 fail-closed

- La documentation Slack officielle actuelle confirme la vérification sur corps brut avec base `v0:timestamp:body`, HMAC-SHA256, comparaison constante et refus au-delà de cinq minutes. Les verification tokens historiques ne sont pas utilisés.
- Le vérificateur borne le corps à 1 Mio réel avant HMAC, vérifie signature et horodatage avant tout parsing JSON, puis projette seulement application, workspace, événement, utilisateur, conversation, texte et compteur de fichiers.
- Les fichiers, URLs, noms et champs inconnus sont écartés. Un message de bot ou tout sous-type est volontairement ignoré après signature pour empêcher les boucles; un message direct conserve un fil stable et un fil public utilise `thread_ts` ou le message racine.
- Le challenge de configuration n'est retourné qu'après signature valide. La route `/api/webhooks/slack` refuse avant lecture dans les trois états actuels; aucun chemin ne peut produire `ready` sans décision humaine future.
- Les 14 tests ciblés couvrent corps brut, altération, anti-rejeu, événement futur, bot, challenge, UTF-8 surdimensionné, refus avant lecture, remise après vérification et taille déclarée. ESLint, typecheck, 346 tests complets et build de production passent; Next.js inventorie la route Slack.
- Aucun package obsolète Events API n'est ajouté, aucun workspace, application, OAuth, token, secret réel, endpoint ou transport Slack n'est créé.

## 2026-07-30 - Mapping et ingestion Slack sans activation

- La verticale Teams `9a4c659` est entièrement verte : CI `30568361952`, continuité `30568361182`, migrations, backup/restore, lint, typecheck, tests, build et Playwright.
- Un propriétaire ou administrateur peut réserver logiquement une application publique et un workspace Slack. Seule l'application et une empreinte HMAC du workspace sont stockées; l'unicité globale refuse sa réattribution inter-tenant.
- La route ne remet à la base qu'un événement déjà signé et dans la fenêtre anti-rejeu. Résolution workspace, identité utilisateur et conversation utilisent des HMAC tenant-scoped distincts; les identifiants Slack bruts ne sont ni stockés dans les identités, ni audités.
- Un message direct conserve le fil du canal; un message de canal conserve le fil Slack racine. `event_id` porte le replay, l'idempotence et la corrélation sans créer de doublon.
- Les fichiers deviennent une notice française bornée. URL privée, nom, contenu et payload inconnu restent hors base; aucun `fetch` n'est effectué.
- Les 30 tests ciblés couvrent vérification, mapping, conflit inter-tenant, replay, continuité, mapping absent/désactivé, HMAC, absence de PII et absence de téléchargement. ESLint et typecheck complet passent.
- La suite exhaustive locale passe 94 fichiers, 352 tests et en ignore explicitement 13; le build production inventorie la route Slack. Le contrôle de continuité retourne `ready` sans erreur ni avertissement.
- Aucun workspace, application, consentement OAuth, token, credential, endpoint réel ou transport Slack n'est activé.

## 2026-08-01 - Clôture probante OS-2

- Le prompt maître canonique est présent, conserve l'empreinte SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5` et compte exactement 71 pages.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71, ainsi que les pages OS-2 13-15 et 64-68, ont été relues directement depuis les rendus du PDF.
- La PR brouillon #11 pointe sur `6c0c204` avec un état de fusion propre. La CI `30570073983` et la continuité `30570074023` sont entièrement vertes.
- La CI valide l'audit production, les migrations, la sauvegarde/restauration, lint, typecheck, les tests unitaires et d'intégration, le build de production et Playwright.
- `docs/OS2_VALIDATION_REPORT.md` confronte les quatre canaux à la Definition of Done page 32 et à la matrice page 69, en distinguant explicitement livré, réel préparé, sandbox, mock, bloqué humain et hors périmètre.
- OS-2 est clos au sens « omnicanal réel préparé ». Aucun fournisseur n'est réellement connecté, aucune sandbox n'est configurée et aucun secret, consentement, transport, média distant, dépense, fusion ou déploiement n'a été déclenché.
- La prochaine phase candidate est OS-3 Connector Runtime : auditer l'existant puis prouver deux capacités génériques exécutables en mock strict, conformément à la roadmap page 31.

## 2026-08-02 - Confirmation de clôture OS-2

- Le contrôle local retrouve le PDF maître canonique avec son SHA-256 exact et ses 71 pages; `pnpm agent:continuity-check` retourne `ready`, sans erreur ni avertissement.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-2 13-15, 22 et 64-68 ont été relues depuis leurs rendus directs.
- La PR brouillon #11 reste ouverte et fusionnable sur le head fonctionnel `6c0c204`; la CI `30570073983` et la continuité `30570074023` restent vertes.
- Le rapport OS-2 et les quatre fichiers de reprise sont synchronisés. Aucune nouvelle tâche OS-3, mutation métier, connexion fournisseur, fusion, dépense ou mise en production n'a été engagée pendant cette confirmation.
