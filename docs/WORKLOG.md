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
