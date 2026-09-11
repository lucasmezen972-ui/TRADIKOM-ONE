# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint applicatif — 11 septembre 2026, 07:06 UTC

- Branche `codex/tradikom-one-os`; commit applicatif local `9879cae7e8bd0c9e598cd1c35ac55089f7a29b21`. Seule la copie stable `/Users/TRADIKOM/Developer/TRADIKOM-ONE` a été utilisée; `tmp/` est intact, non suivi et hors index.
- Le reçu de policy serveur est append-only, immuable et versionné. Il lie exactement tenant, plan/fingerprint, validation, catalogue/empreinte, capacités, unique fournisseur `tradikom_mock`, scopes, rôle, principal et risque. Il est émis atomiquement avec l'approbation, ou avec la création pour `approval:none`; aucun reçu n'est créé au rejet.
- Trois migrations additives et leurs miroirs runtime ajoutent le reçu, ses relations tenant-first, sa RLS et dix-huit politiques restrictives d'écriture pour les plans, étapes, validations, missions et événements Conversation. Les écritures directes utilisateur sont fermées, les suppressions indirectes ne peuvent pas effacer une preuve active et la suppression explicite du tenant reste possible.
- La policy est recalculée avant exécution, appel direct du moteur, reprise durable, relance manuelle et finalisation. Une dérive du plan, des étapes, de la validation, du catalogue, du fournisseur, du rôle, du membership, des scopes, de l'événement, de la mission ou du résultat échoue avant provider et nouvel effet métier. Les anciens plans approuvés sans reçu ne sont pas régularisés silencieusement.
- L'enqueue concurrent d'un événement accorde l'ownership à une seule insertion. Le worker rend atomiques les effets du handler et le succès de l'événement. Après épuisement d'une reprise, la mission `failed`, une preuve terminale contenant le curseur sûr et la lettre morte sont persistées ensemble; la relance manuelle reprend ensuite l'action exacte.
- Preuves locales : 15 fichiers ciblés, 86 tests verts et 7 tests PostgreSQL ignorés faute de `DATABASE_URL`; suite exhaustive de 159 fichiers/874 tests verts et 13 fichiers/31 tests ignorés, soit 905 tests sans échec. ESLint, TypeScript, build production factice, continuity-check et diff check sont verts. Audit : trois avis modérés (`qs`, `csv-parse`), zéro high/critical. Trois revues indépendantes ne trouvent plus de défaut P1/P2.
- La publication fast-forward et la CI autoritative PostgreSQL/RLS, build et 20 Playwright restent nécessaires avant de classer cette tranche « prouvée CI ». Aucun secret, token, fournisseur réel, Graph, message externe, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 43-44, 46, 48, 69-71 | Continuer le parcours Conversation par des actions durables, des validations simples et une preuve policy utilisable, selon la Definition of Done et la matrice | Reçu déterministe émis avec la décision, parcours `tradikom_mock` valide, rejeu idempotent et récupération terminale prouvés; 905 tests locaux sans échec | CI PostgreSQL/RLS et 20 Playwright du futur head encore requis |
| 10-12, 15-18, 22, 35-38 | Préserver tenant/RLS, minimiser les données, fermer les capacités et fournisseurs, auditer sans contenu sensible et refuser toute dérive avant effet | Reçu tenant-first append-only; 18 policies restrictives; catalogue canonique; fournisseur unique; revalidation plan/validation/rôle/scope/mission; tests de falsification, cross-tenant et appels directs | Sept tests PostgreSQL ignorés localement faute de `DATABASE_URL`; la CI doit les exécuter avec rôles non propriétaires |
| 64-68, 69-71 | Garder un runtime provider explicite, idempotent et honnête, puis distinguer livré, réel, sandbox, mock, bloqué humain et hors périmètre | Provider `tradikom_mock` profondément figé; aucun `fetch`; états et limites documentés; lint, typecheck, build, audit et continuity-check verts | Réel = aucun; sandbox = aucune; Meta reste bloqué par le SMS et exige une autorisation distincte avant token ou Graph |

Le PDF canonique reste conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification de la tranche courante

- Livré et prouvé localement : reçu de policy, enforcement, RLS d'écriture, atomicité worker et récupération terminale.
- Réel connecté : aucun fournisseur ou modèle; aucune clé réelle enregistrée et aucun appel Graph.
- Sandbox : aucune configurée ou appelée.
- Mock : générateur déterministe serveur et capacités `tradikom_mock`, sans réseau fournisseur.
- Bloqué humain : saisie directe du SMS Meta, inventaire officiel en lecture seule puis confirmation immédiate avant tout token persistant ou effet Graph.
- Hors périmètre : fournisseur réel, Graph, message externe, endpoint public, fusion, déploiement, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.
- Écarts non bloquants : trois avis modérés de dépendances; publication et preuve CI encore en attente.

## Checkpoint applicatif — 11 septembre 2026, 03:27 UTC

- Branche `codex/tradikom-one-os`; commit applicatif `dc9cf0c641bab56ac66d451aac5b18368ef8c12a` publié strictement en fast-forward depuis `897c5a0fa61ad03a00bc10fc3e6cc5aee0c9add7`, puis correctif de preuve `84a52a2bebf51c546e1f9f27dbf98dcb79dade20`. Seule la copie stable `/Users/TRADIKOM/Developer/TRADIKOM-ONE` a été utilisée; `tmp/` est intact, non suivi et hors index.
- La décision Conversation est maintenant parsée par une enum fermée `approved|rejected` dans la frontière d'erreur publique. Une valeur malformée échoue en français avant l'appel au service, sans revalidation, redirection, audit ou message de décision; elle ne devient plus un refus implicite.
- Toutes les redirections de plan utilisent le fil et l'identifiant retournés par le service. Une confirmation visuelle exige l'identifiant exact d'un plan accessible dans le fil tenant et un état durable cohérent. Créé, approuvé et refusé exigent l'absence de mission; exécuté exige une mission réussie. Si un autre plan est créé entre-temps, le reçu cohérent reste attaché au plan demandé et le repli sans reçu montre le dernier plan.
- Cette confirmation est une attestation de l'état courant, pas une preuve causale ou non répudiable de la navigation; elle est rejouable par URL et n'autorise aucune mutation.
- Le refus initial est visible et causalement testé : validation rejetée, deux étapes annulées, tentative d'exécution refusée, zéro workflow, événement d'exécution, résultat ou tâche, et canaris provider/`fetch` non appelés. L'audit `conversation.plan_rejected` est comparé à l'allowlist exacte `threadId`, `approvalId`, `decision`, `planFingerprint`; le motif métier n'y est jamais inscrit.
- Le parcours vertical desktop et mobile utilise le vrai formulaire, affiche « Refusé » et deux « Annulée », retire Exécuter/Reprendre, refuse un faux reçu `executed`, masque les codes internes derrière des libellés français et exige zéro débordement horizontal. Aucun réseau Meta n'est observé.
- Preuves locales : 3 fichiers/27 tests ciblés verts; suite exhaustive 165 fichiers, 849 tests verts et 29 ignorés sans PostgreSQL local sur 878; canari provider ciblé vert après le dernier durcissement. ESLint, TypeScript, build production factice, audit high, continuity-check et diff check verts; trois avis modérés, zéro high/critical.
- La continuité distante `34558477110` est verte sur `dc9cf0c`. La CI `34558477111` a validé audit, migrations, sauvegarde/restauration, lint, TypeScript, les 165 fichiers/878 tests PostgreSQL et le build, puis a échoué uniquement parce qu'un sélecteur Playwright recherchait « Rechercher le contact » exactement alors que le texte visible complet est « 1. Rechercher le contact ». Le correctif `84a52a2` utilise les deux libellés numérotés complets. La continuité `34560151763` est verte et la CI `34560151750` est entièrement verte sur ce même head : audit, migrations, `db:verify`, sauvegarde/restauration, lint, TypeScript, 165 fichiers/878 tests PostgreSQL, build production et 20/20 Playwright. Aucun secret, Graph, message externe, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 43-44, 46, 48, 69-71 | Continuer l'ordre page 48 par une validation unique, visible, durable, honnête et démontrable dans Conversation | Parse stricte avant service; IDs autoritatifs; confirmation corroborée par l'état durable; refus desktop/mobile avec zéro mission durable et provider non engagé; CI `34560151750` verte avec 165 fichiers/878 tests et 20/20 Playwright | La confirmation URL atteste l'état courant mais pas la causalité et ne sert jamais d'autorisation |
| 15-18, 32, 35-38, 64-69 | Préserver tenant/RLS, refuser fermé, auditer sans contenu sensible et prouver l'absence d'effet au refus | Plan résolu uniquement parmi les fils accessibles; service revérifie membership et tenant; audit comparé à quatre clés sûres; zéro workflow, événement, résultat, tâche, provider ou `fetch` au refus | Ajouter un reçu de policy serveur append-only/versionné et le revalider avant exécution, appel direct, reprise et finalisation |
| 15-18, 35-38, 46, 69-71 | Maintenir capacités et fournisseurs sous policy explicite, runtime honnête et matrice adversariale | Runtime `deterministic_mock`/`tradikom_mock`, libellés français et aucun fournisseur réel; URL incohérente, décision malformée et mission contradictoire refusées | Fermer `providerPreference`, figer le provider mock et tester falsification, plan A/B, cross-tenant, fournisseur multiple, scope/rôle/membership/catalogue modifiés et ancien plan sans reçu |

Le PDF canonique reste conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification de la tranche courante

- Livré, publié et prouvé CI : validation stricte, confirmation d'état durable, refus initial et interface française.
- Réel connecté : aucun fournisseur ou modèle; aucune clé réelle enregistrée et aucun appel Graph.
- Sandbox : aucune configurée ou appelée.
- Mock : générateur déterministe serveur et capacités `tradikom_mock`; fixtures et canaris de test sans réseau fournisseur.
- Bloqué humain : saisie directe du SMS Meta, inventaire officiel puis confirmation immédiate avant token persistant ou effet Graph.
- Hors périmètre : fournisseur réel, Graph, message externe, endpoint public, fusion, déploiement, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.
- Écart d'infrastructure non bloquant : `pnpm/action-setup@v4` cible encore Node.js 20 et GitHub l'exécute désormais sous Node.js 24; trois avis de dépendances modérés restent suivis, sans high/critical.

## Checkpoint applicatif — 11 septembre 2026, 01:51 UTC

- Branche `codex/tradikom-one-os`; garde publiée dans `a994b3a1836c0a7b2b74284a986975e58539dd1f`, instantané JSON profond détaché ajouté dans `0967ff15e53a0bd0a3fb3c50e9fe03f97b89eb8f`, puis prévalidation profonde publiée dans `69b667fdc9502e44a6144d8046c343b5dd000fa0`. Local et distant sont synchronisés; la copie stable seule a été utilisée et `tmp/` reste intact, non suivi et hors index.
- `69b667f` projette l'enveloppe du générateur, puis le plan et ses entrées, depuis leurs descripteurs de données vers des copies JSON profondes détachées avant Zod. Aucun getter ordinaire, trap `get` ou `toJSON` n'est invoqué. Les traps de réflexion d'un `Proxy` peuvent nécessairement s'exécuter; leurs défaillances sont refusées sans propagation, et ce contrôle n'est pas présenté comme une sandbox JavaScript.
- Les graphes acycliques sérialisables en JSON avec références partagées sont acceptés. Cycles, accesseurs, prototypes personnalisés, symboles, clé `__proto__` normalisée, tableaux troués ou à index incohérents, nombres non finis et profondeurs excessives sont refusés. La projection est bornée à 200 000 propriétés et à 512 000 caractères cumulés de clés et chaînes pour le plan ou son enveloppe; chaque entrée d'étape est aussi bornée à 16 000 caractères de clés et chaînes ainsi qu'à 16 000 caractères une fois sérialisée.
- La garde inspecte champs métier, preuves, référence modèle, clés et valeurs imbriquées. Unicode, casse, accents, ponctuation et séparateurs sont normalisés; copies complètes à partir de 32 caractères normalisés, séquences substantielles de 48 caractères normalisés, jetons denses et fragments cumulés sont refusés sans journaliser le contenu. Les métadonnées de provenance et les valeurs structurelles fixes sont exclues du cumul afin de préserver les plans légitimes.
- Le correctif `0967ff1` garantit que réponse et persistance utilisent le même instantané JSON profond détaché, même si un générateur conserve puis modifie une référence imbriquée. Le refus public est français et ne crée aucun nouvel artefact lié au plan : plan, étape, validation, message de type plan, ligne `workflow_runs` associée, événement `conversation.plan.execute` ou audit `conversation.plan_created`.
- Le parcours vertical conserve la canary visible dans l'extraction de la pièce jointe pour l'utilisateur autorisé. Il prouve seulement son absence du panneau Plan et des sorties de plan inspectées : `plan_json`, `input_json`, messages plan/résultat et métadonnées d'audit. Cette preuve de non-régression du chemin déterministe complète les tests causaux de refus; elle n'est pas présentée comme un rejet provoqué par le template fixe.
- Preuve locale finale sur `69b667f` : 4 fichiers/49 tests ciblés et 152 fichiers/842 tests exhaustifs verts; 11 fichiers/29 tests PostgreSQL ignorés faute de `DATABASE_URL`, soit 163 fichiers/871 tests au total. Lint, TypeScript, build production avec valeurs factices, audit high, continuity-check et diff check verts; trois avis modérés, zéro high/critical.
- La CI autoritative `34550617800` est entièrement verte sur `69b667f` : audit, migrations, `db:verify`, sauvegarde/restauration, lint, TypeScript, 163 fichiers/871 tests PostgreSQL inclus, build production Next.js 16.3.4 et 20/20 Playwright. La continuité `34550617974` est également verte; la PR #11 reste ouverte, brouillon, fusionnable et `CLEAN`.
- Le runtime utilise le générateur déterministe serveur et des capacités de workflow mock; les transports et doubles de modèle sont injectés dans les tests, sans réseau fournisseur. Aucun modèle ou fournisseur réel n'est raccordé. La garde lexicale ne prétend pas détecter une paraphrase sémantique, une obfuscation ou un encodage arbitraire, ni une PII ou un secret court sous les seuils.
- Aucun secret, Graph, fournisseur réel, message externe, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 43-44, 46, 48, 69-71 | Continuer l'étape plan par une tranche Conversation verticale, durable, honnête et démontrable | Garde publiée dans `a994b3a`; instantané JSON profond détaché dans `0967ff1`; prévalidation avant Zod dans `69b667f`; parcours canary, CI `34550617800` et continuité `34550617974` entièrement verts | Checkpoint SMS Meta ensuite |
| 17, 23, 32, 38, 43-44 | Traiter aussi la sortie du générateur comme non fiable et refuser sa recopie du contexte externe avant effet durable | Projection bornée de l'enveloppe, du plan et des entrées; inspection récursive; seuils 32/48 sur texte normalisé; détection cumulative; erreur française sûre et aucun nouvel artefact de plan au refus | Paraphrase, obfuscation/encodage arbitraire, PII/secrets courts sous les seuils et traps de réflexion Proxy hors garantie passive |
| 10-18, 22-24, 64-71 | Minimiser les données, préserver tenant/RLS, ne pas journaliser le contenu, garder les actions durables et décrire honnêtement le runtime | Provenance seule exclue; source tenant relue/fingerprintée avant écriture; plan détaché avant garde; aucun contenu comparé dans l'audit; générateur déterministe et capacités workflow mock sans réseau fournisseur | Aucun fournisseur IA réel; avant raccordement, ajouter squelette de capacités/policy côté serveur, garde d'egress/DLP et évaluations adversariales |

Le PDF canonique reste conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification de la tranche courante

- Livré, publié et prouvé CI : garde anti-recopie, projection JSON profonde détachée et instantané avant persistance.
- Réel connecté : aucun fournisseur ou modèle; aucune clé réelle enregistrée et aucun appel Graph.
- Sandbox : aucune configurée ou appelée.
- Mock : générateur déterministe serveur et capacités de workflow mock au runtime; transports et doubles de modèle injectés dans les tests, sans réseau fournisseur.
- Bloqué humain : saisie directe du SMS Meta, inventaire officiel puis confirmation immédiate avant token persistant.
- Hors périmètre : fournisseur IA réel, Graph, stockage média/objet réel, antivirus, OCR/transcription, message réel, endpoint public, fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Checkpoint applicatif — 10 septembre 2026, 08:32 UTC

- Branche : `codex/tradikom-one-os`; commit applicatif `bf54862aee344accd23af9c7a5fba3d856484cd1`, correctif E2E `06137acf59e8d87f0deadd9d5da66aaa8b9c597c` puis correctif de nettoyage PostgreSQL `f692057e284870527d7b162bae6cfa5312d9893c` publiés strictement en fast-forward. La copie stable seule a été utilisée et `tmp/` demeure intact, non suivi et hors index.
- Travail applicatif : le plan Conversation reçoit maintenant, uniquement en mémoire, le texte filtré et borné des extractions média `external_untrusted_data` encore vérifiées. Le contexte refuse plus de dix sources ou 16 000 caractères et ne transforme jamais ces données en instruction, accès outil ou mutation de policy.
- Persistance minimale : le plan conserve seulement une provenance sûre (`sourceIntegrity=verified`, interdictions immuables et indicateur de troncature), sans contenu, extracteur, empreinte ni identifiant visible. Les plans historiques sans source gardent leur sérialisation et leur fingerprint.
- Fermeture des courses : droits, message, pièces jointes et extractions sont relus après génération. Le message est verrouillé `FOR UPDATE`, les pièces existantes `FOR SHARE`, puis le fingerprint du contexte est comparé; suppression, insertion, altération ou révocation concurrente échoue avant plan, validation, message et audit.
- Parcours visible : Conversation annonce en français « Source externe à intégrité vérifiée » et précise qu'elle est traitée comme donnée non fiable, sans instruction ni accès outil. Le scénario vertical approuve puis exécute le plan en mock et prouve zéro réseau Meta ainsi que le masquage des échecs.
- Preuves locales : ciblés 26 tests verts et 4 PostgreSQL ignorés; suite exhaustive 152 fichiers/815 tests verts et 11 fichiers/28 tests ignorés sans `DATABASE_URL`; lint, TypeScript, build production avec valeurs factices, audit high, continuity-check et diff check verts. Trois avis modérés subsistent, aucun high/critical.
- Première passe : continuité `34430720259` verte. La CI `34430720247` a validé audit, migrations, `db:verify`, sauvegarde/restauration, lint, TypeScript, 163 fichiers/844 tests PostgreSQL et le build, puis 19 Playwright sur 20. Son seul échec était une attente de quatre projections au lieu des trois produites : deux sur le fil web/test et une sur le fil média WhatsApp.
- Seconde passe : continuité `34432424276` verte; la CI `34432424191` a échoué avant lint/tests/build sur une course de fermeture de base temporaire (`57P01`). `pg-pool` avait retiré un client de son inventaire avant la fin de sa fermeture TCP, puis `DROP DATABASE ... WITH (FORCE)` terminait cette connexion. Le vérificateur attend maintenant de façon bornée zéro session dans `pg_stat_activity`, supprime sans `FORCE` et échoue explicitement si une session subsiste.
- Preuve finale : CI `34433025988` entièrement verte sur `f692057` avec audit, migrations et nettoyage sans `57P01`, `db:verify`, sauvegarde/restauration, lint, TypeScript, 163 fichiers/844 tests PostgreSQL, build et 20/20 Playwright. Continuité `34433025991` verte. La PR #11 est ouverte, brouillon, fusionnable et `CLEAN`.
- Aucun fournisseur réel, secret, token, Graph, message externe, stockage réel, OCR/transcription, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 43-44, 46, 48, 69-71 | Continuer l'ordre page 48 par une tranche verticale Conversation, durable, honnête et démontrable | Contexte vérifié raccordé au plan, provenance française, validation unique et exécution mock dans le parcours vertical; CI `34433025988` et continuité `34433025991` entièrement vertes sur `f692057` | Checkpoint humain Meta ensuite |
| 10-18, 22-24, 26-30, 35-38, 64-68 | Traiter toute entrée externe comme donnée non fiable, borner, filtrer, isoler le tenant, minimiser la persistance et auditer sans contenu | Intégrité `verified` obligatoire; dix sources/16 000 caractères; marqueurs data-only; aucun contenu/extracteur/hash durable ou audit; erreurs publiques sûres | Stockage réel, antivirus, OCR/transcription et fournisseur IA réel restent absents |
| 16-18, 22, 32, 38, 69 | Refuser fermé les changements concurrents et prouver sécurité, idempotence, RLS et parcours complet | Double relecture, verrous parent/enfant, fingerprint, tests altération/révocation/cross-tenant/zéro effet; 163 fichiers/844 tests PostgreSQL, build et 20/20 Playwright verts | Avant un modèle réel, ajouter une politique anti-recopie verbatim; envisager un schéma v2 avant API publique ou déploiement mixte |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification de la tranche courante

- Livré, publié et prouvé CI : contexte média vérifié vers plan Conversation, fermeture concurrente, provenance française et parcours mock.
- Réel connecté : aucun; aucune clé réelle enregistrée et aucun appel Graph.
- Sandbox : aucune configurée ou appelée.
- Mock : générateur déterministe, workflow et doubles média uniquement en tests, sans réseau.
- Bloqué humain : saisie du SMS directement dans Meta, inventaire officiel puis confirmation immédiate avant tout token persistant.
- Hors périmètre : fournisseur IA réel, Graph, stockage réel, antivirus, OCR/transcription, message externe, endpoint public, fusion, déploiement, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Checkpoint applicatif — 10 septembre 2026, 00:35 UTC

- Branche : `codex/tradikom-one-os`; base locale et distante synchronisée sur `ed5a571d258542df8980095fb5326376c26a8072` avant le lot. Le commit applicatif `cc0bb2b7ff906bba145f26817f43a3ed55b4dd88` a ensuite été publié strictement en fast-forward; `tmp/` demeure intact, non suivi et hors index.
- Travail applicatif : la rotation d'un secret WhatsApp Meta doit désormais prouver que le WABA et le Phone Number ID correspondent à l'endpoint tenant verrouillé. L'empreinte HMAC est mutualisée entre enregistrement et rotation et comparée en temps constant avant toute mutation ou ligne d'audit.
- Parcours Conversation : propriétaire et administrateur peuvent autoriser ou révoquer un unique essai d'un message depuis l'interface française, avec confirmation explicite. Tenant, acteur et endpoint viennent exclusivement de la session et de la résolution serveur; zéro ou plusieurs endpoints configurés échouent fermé.
- Cohérence durable : l'émission rejoue la même opération sans doublon, refuse une seconde clé tant que la preuve est valide et interdit toute nouvelle autorisation après consommation historique. La révocation verrouille tous les endpoints Meta et annule toutes les preuves valides du tenant, même après retrait du secret ou désactivation de l'endpoint.
- Concurrence : l'émission et la révocation verrouillent les endpoints avant de relire les secrets et autorisations; le budget respecte l'ordre endpoint → livraison → autorisation. Deux tests PostgreSQL synchronisent une consommation non validée, prouvent le blocage réel via `pg_blocking_pids`, puis vérifient l'absence de nouvelle autorisation et de révocation incohérente.
- Vérité visible : les bannières sont calculées depuis l'état durable et non depuis des paramètres d'action. Les états requis, valide, épuisé et configuration ambiguë sont français, annoncés aux technologies d'assistance et sans identifiant, empreinte, secret ou promesse d'envoi.
- Preuves locales : 62 tests ciblés verts; suite exhaustive 152 fichiers/809 tests verts et 11 fichiers/27 tests PostgreSQL ignorés sans `DATABASE_URL`; ESLint, TypeScript, audit production high et diff check verts. Le build refuse correctement l'environnement de production absent et Playwright local ne partage pas PGlite; ces limites sont levées par la preuve CI partagée.
- Preuve autoritative : continuité `34422242320` verte; CI `34422242316` entièrement verte en 22 min 42 s avec audit, migrations concurrentes/fresh/upgrade, `db:verify`, sauvegarde/restauration, lint, TypeScript, 163 fichiers/836 tests PostgreSQL inclus, build Next.js 16.3.4 et 20/20 Playwright. La PR #11 est ouverte, brouillon, fusionnable et `CLEAN` sur `cc0bb2b`.
- Aucun Graph, secret, token, message externe, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître — cohérence endpoint-secret et autorisation d'essai pilotable

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 46, 48, 70-71 | Continuer OS-5 par une tranche verticale conversation-first, durable, honnête et reprenable | Formulaires réels Autoriser/Révoquer dans Conversation, état relu en base, commit `cc0bb2b` publié et prouvé CI; aucune interface CRM/Kanban/dashboard/OS-6 | Checkpoint humain Meta avant la prochaine frontière réelle |
| 10-18, 22-24, 29-30, 64-68 | Fournisseur fail-closed, secrets protégés, authentification humaine explicite, actions sensibles idempotentes et auditées | Invariant WABA+destination HMAC avant mutation; session serveur; un seul endpoint; émission/révocation verrouillées; audits sans secret/contenu; aucun Graph | Validation SMS, inventaire officiel, token de coffre, endpoint HTTPS et toute requête Graph restent bloqués humainement |
| 16-18, 22, 32, 69 | Isolation tenant/RLS, sécurité adversariale, concurrence réelle et preuves unitaires/intégration/PostgreSQL/Playwright | Cross-tenant/rôles/rejeux/collisions couverts; CI `34422242316` valide 163 fichiers/836 tests dont les verrous restricted-role, le build et 20 Playwright sans Graph | Aucun écart de preuve identifié pour cette tranche; trois avis transitifs modérés restent à suivre |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification de la tranche courante

- Livré, publié et prouvé CI : invariant endpoint-secret, émission/révocation administrative, états readiness et interface Conversation.
- Réel connecté : aucun; aucun secret réel ni appel Graph.
- Sandbox : aucune appelée.
- Mock : uniquement fixtures, base locale et doubles injectés; aucun réseau fournisseur.
- Bloqué humain : validation SMS Meta, inventaire officiel puis confirmation immédiate avant token persistant ou effet Graph.
- Hors périmètre : message réel, endpoint public, fusion, déploiement, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Checkpoint applicatif — 9 septembre 2026, 22:19 UTC

- Branche : `codex/tradikom-one-os`; commit applicatif `dde51f5b338e099d5d9f5ffab2f76b0f5e9e1a8f` publié strictement en fast-forward; PR #11 ouverte, brouillon, fusionnable et `CLEAN`. `tmp/` demeure intact, non suivi et hors index.
- Travail applicatif poursuivi : la consommation d'essai Meta est désormais une barrière stricte d'émission au plus une fois. Après consommation, un worker ferme toute reprise en résultat de transport incertain, permanent et non rejouable avant même credentials, destination ou HTTP, y compris après expiration ou révocation. Avant consommation, les autorisations invalides restent refusées sans I/O.
- Renforcement RLS : le contrôle global audite toutes les policies permissives, y compris celles affectées à un rôle spécifique; les formes ouvertes et les fonctions génériques sont refusées. Seuls les cinq helpers `app_actor_can_access_*` réellement définis et approuvés sont admis, avec un premier argument tenant explicite.
- Renforcement chaîne logicielle : Next.js et `eslint-config-next` passent à 16.3.4; la résolution `sharp` est bornée à `>=0.35.4`. L'audit production au seuil high ne contient plus de vulnérabilité high/critical et conserve trois avis modérés.
- Preuves locales : matrice Meta/RLS/migrations 12 fichiers/109 tests verts; suite exhaustive 152 fichiers/784 tests verts et 11 fichiers/25 tests PostgreSQL ignorés faute de base locale; sous-matrice des derniers changements 3 fichiers/33 tests verts; historique PGlite chargé avec toutes les migrations RLS et zéro écart de couverture; ESLint, TypeScript et `git diff --check` verts. Le PDF canonique a été relu directement et reste à 71 pages avec le SHA-256 exact.
- Preuve autoritative : CI `34409452423` verte en 23 min 30 s avec audit, migrations concurrentes/fresh/upgrade, `db:verify`, sauvegarde/restauration, lint, TypeScript, 163 fichiers/809 tests PostgreSQL inclus, build Next.js 16.3.4 et 20/20 Playwright. Continuité `34409452521` verte. Aucun Graph, secret, token, message externe, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître — émission Meta au plus une fois et garde RLS fermé

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 46, 48, 70-71 | Continuer OS-5 par une tranche conversation-first durable, vérifiable et reprenable | Reprise worker fermée sans deuxième émission; commit `dde51f5` publié et prouvé CI; aucun CRM, Kanban, dashboard ou OS-6 | Checkpoint humain Meta avant la prochaine frontière réelle |
| 10-18, 22-24, 29-30, 64-68 | Fournisseur fail-closed, effet externe idempotent, secrets protégés, interface française et blocage humain explicite | Budget consommé avant transport; relecture terminale incertaine avant toute I/O; mock/HTTP incompatibles; états français sans ID/date/secret | Validation SMS, inventaire officiel, token coffre, Graph et endpoint public restent bloqués humainement |
| 16-18, 22, 32, 69 | Isolation tenant/RLS, contraintes fresh/upgrade, sécurité adversariale et preuves unit/intégration/PostgreSQL/Playwright | Toutes les policies permissives sont vérifiées contre une allowlist fermée; CI `34409452423` valide 163 fichiers/809 tests PostgreSQL, build et 20 Playwright | Aucun écart de preuve identifié pour cette tranche; trois avis transitifs modérés restent à suivre |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Checkpoint applicatif — 8 septembre 2026, 13:14 UTC

- Branche : `codex/tradikom-one-os`; base locale et distante réconciliée sur `19c5c10cbabd82c14ed08e401f627e932b28172a`; PR #11 ouverte, brouillon, fusionnable et `CLEAN`. Le nouveau lot reste local avant publication; `tmp/` est intact, non suivi et hors index.
- Travail effectué : autorisation d'essai WhatsApp Meta durable, tenant/endpoint-scoped, révocable, expirante et plafonnée en SQL à exactement un message; consommation atomique avant tout résolveur ou transport; lien immuable sur la livraison pour la reprise worker; séparation structurelle des transports mock et HTTP; état agrégé visible en français dans Conversation.
- Renforcement transversal : migrations PostgreSQL sérialisées dans une transaction sous verrou advisory; upgrades 0097/0109 incapables de supprimer une ancienne FK avant de valider la relation composite; contrôle global RLS refusant une policy permissive publique non bornée même si une policy sûre coexiste.
- Impact north star : l'autorisation, sa consommation et son état sont pilotables depuis le parcours conversationnel durable. Aucun module CRM, Kanban ou dashboard secondaire n'a été ajouté.
- Risques contenus : membership et rôles vérifiés, filtres tenant/provider/endpoint, RLS conservée, audit sans contenu/secret/identifiant fournisseur, idempotence et concurrence testées, anciennes livraisons sans lien durable terminalisées avec message canonique cohérent, mock incapable d'atteindre HTTP.
- Preuves locales fiables : TypeScript, ESLint, `git diff --check` et audit high verts; migrations ciblées 7 + 3 + 4 tests verts; checkpoint/RLS/transport 60 tests verts; worker/readiness/transport 57 tests verts; scénarios Meta expirés pendant suspension tous rejoués isolément avec succès. La suite exhaustive locale est non concluante car l'horloge suspendue fait expirer aléatoirement des tests historiques inchangés; le build refuse correctement l'absence de `DATABASE_URL` en production. PostgreSQL/RLS, `db:verify`, build et Playwright restent à prouver en CI.
- Aucun Graph, client Meta réel, token, message externe, endpoint public, fusion, déploiement ou dépense n'a été déclenché.

## Alignement prompt maître — autorisation d'essai WhatsApp Meta

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 46, 48, 70-71 | Continuer par tranche verticale conversation-first, durable et reprise exacte | Autorisation et consommation intégrées au flux Conversation/worker; documents de continuité actualisés; aucun CRM, Kanban, dashboard ou OS-6 | Publication et CI autoritative encore requises |
| 10-18, 22-24, 29-30, 64-68 | Adaptateur sans logique métier, provider fail-closed, secret protégé, interface française simple et authentification humaine explicite | Budget avant transport, mock/HTTP incompatibles, états `required`/`valid`/`exhausted` sans ID/date/secret ni bouton d'envoi; aucun Graph | Validation SMS, inventaire officiel, token coffre et endpoint public toujours bloqués humainement |
| 16-18, 22, 32, 69 | Isolation tenant/RLS, action sensible auditée et idempotente; fresh/upgrade, restricted-role, retry et Playwright obligatoires | Tests locaux migrations, idempotence, concurrence, révocation, expiration, cross-tenant, zéro résolveur/fetch, reprise worker et UI; lint/typecheck/audit/diff verts | PostgreSQL restricted-role, migrations concurrentes réelles, build et Playwright attendent la CI avec `DATABASE_URL` |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification de la tranche d'autorisation Meta

- Livré localement : schéma, services, budget, reprise worker, readiness et carte Conversation.
- Réel connecté : aucun; aucune requête Graph et aucun transport externe.
- Sandbox : aucune appelée.
- Mock : doubles inject/zéro réseau uniquement; le mode mock ne peut pas atteindre la frontière HTTP.
- Bloqué humain : validation SMS Meta, inventaire officiel puis confirmation immédiate avant tout token persistant.
- Hors périmètre : Graph, message réel, endpoint public, fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Checkpoint applicatif — 5 septembre 2026, 04:49 UTC

- Branche : `codex/tradikom-one-os`; tranche applicative `461156ae3ad7f44920fe64dc182780957cd2aaa2` puis correctif Playwright `82586e89045538fddf61fdb56fc563eabd6ed688` publiés strictement en fast-forward; `tmp/` reste non suivi et hors index.
- Travail effectué : Conversation lit maintenant sous contexte tenant+acteur si l'organisation possède une configuration WhatsApp Meta, si elle est active et si ses accès chiffrés ne sont pas révoqués. Seuls des indicateurs booléens quittent le repository.
- Impact north star : l'écran conversationnel dit désormais si le serveur et l'organisation sont réellement prêts, sans obliger l'utilisateur à comprendre une console fournisseur ni ouvrir un module secondaire.
- Risques contenus : membership vérifié, filtre tenant explicite et RLS, aucune valeur ou référence fournisseur rendue, révocation reflétée, effet externe bloqué tant que serveur et organisation ne sont pas prêts. Aucun Graph, message, bouton d'activation, stockage réel, fusion, déploiement ou dépense.
- Preuves locales : 161 fichiers/749 tests verts et 11 fichiers/24 tests PostgreSQL ignorés sans `DATABASE_URL`; tests ciblés, ESLint, TypeScript, build production, audit high, continuity-check et diff check verts.
- Première CI `33945539636` : audit, migrations, `db:verify`, sauvegarde/restauration, lint, TypeScript, 161 fichiers/773 tests PostgreSQL inclus et build verts; 19 Playwright sur 20 verts. Le seul échec était un sélecteur strict ambigu sur deux libellés « Désactivé », corrigé sans changement fonctionnel dans `82586e8`.
- Preuve autoritative : continuité `33946531695` verte; CI `33946531702` entièrement verte en 18 min 1 s avec audit, migrations, `db:verify`, sauvegarde/restauration, lint, TypeScript, 161 fichiers/773 tests PostgreSQL inclus, build et 20/20 Playwright. PR #11 ouverte, brouillon, fusionnable et `CLEAN` au head `82586e8`.

## Alignement prompt maître — préparation Meta tenant-scoped

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 46, 48, 70-71 | Continuer le produit par tranche Conversation utile, conserver la reprise exacte et les états honnêtes | Tranche visible livrée, publiée et prouvée CI sans CRM, Kanban, dashboard ni OS-6; documents de continuité actualisés | Validation SMS Meta toujours humaine |
| 10-14, 24, 29-30, 64-68 | Conversation Hub comme vérité, adaptateur sans logique métier, fournisseur explicite et interface française simple | État serveur et état organisation séparés; quatre états tenant lisibles; serveur `mock`/`ready` sans tenant prêt bloqué; aucun appel fournisseur | Aucun provider réel, sandbox, Graph ou endpoint public |
| 16-18, 22, 35-38 | Tenant, RLS, secrets protégés, action durable et refus fermé | Transaction tenant+acteur, membership, filtre tenant, RLS existante, agrégat booléen seulement, révocation reflétée et refus cross-tenant; restricted-role vert sur PostgreSQL 17 | Aucun écart identifié dans la frontière tenant de cette tranche |
| 32, 69 | DoD unit/intégration/RLS/provider/sécurité/Playwright/a11y | Local : 161 fichiers/749 tests, lint, TypeScript, build, audit high, continuity-check et diff check verts; CI `33946531702` : 161 fichiers/773 tests PostgreSQL inclus, build et 20/20 Playwright verts | Aucun écart de preuve identifié pour cette tranche; deux avis transitifs `qs` modérés restent à suivre |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification du checkpoint tenant Meta

- Livré, publié et prouvé CI : lecture tenant-scoped, classification sûre et rendu Conversation.
- Réel connecté : aucun; aucun appel Graph ni transport activé.
- Sandbox : aucune appelée.
- Mock : secrets factices et états construits uniquement dans les tests; aucun réseau.
- Bloqué humain : validation SMS Meta et confirmation distincte avant token persistant ou effet externe.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Checkpoint applicatif — 5 septembre 2026, 03:32 UTC

- Branche : `codex/tradikom-one-os`; checkpoint applicatif `c038df459e8e883bb5c77c6932b7a577a8f56f85` publié avec son handoff au head `d899d95e7d3c590b5fe603d8269fdf1fe9203807`; `tmp/` reste non suivi et hors index. Le push `ed4aeea..d899d95` a été strictement fast-forward après fetch et contrôle d'ancêtre.
- Travail effectué : un modèle déterministe transforme le manifeste WhatsApp Meta en un état français sûr, une prochaine action et une classification de l'effet externe. L'écran Conversation rend ce point de contrôle après authentification, sans API intermédiaire ni appel fournisseur.
- Impact north star : l'utilisateur voit depuis la conversation principale pourquoi le canal réel ne peut pas encore agir et quelle étape débloque la suite, sans basculer vers CRM, Kanban ou dashboard secondaire.
- Risques contenus : aucun nom de variable, valeur sensible ou `missingEnvironment` n'est projeté. Aucun bouton d'activation/envoi n'est ajouté. `disabled`, `not_configured` et `awaiting_human_auth` restent bloqués; `mock` reste simulé; `ready` n'est qu'une disponibilité technique soumise à l'endpoint tenant et à une autorisation distincte.
- Preuves locales : 3 fichiers/33 tests ciblés; 160 fichiers/740 tests exhaustifs verts avec 11 fichiers/24 tests PostgreSQL ignorés sans `DATABASE_URL`; ESLint, TypeScript, build Next.js production, audit high, continuity-check et diff check verts. L'audit signale deux avis transitifs `qs` modérés, zéro high/critical.
- Preuve autoritative : CI `33942266316` verte en 22 min 56 s avec audit, migrations, `db:verify`, sauvegarde/restauration, lint, TypeScript, 160 fichiers/764 tests sur PostgreSQL 17, build et 20 Playwright dont Conversation desktop/mobile. Continuité `33942266310` verte. Aucun Graph, token, message, endpoint public, fusion, déploiement ou dépense.

## Alignement prompt maître — checkpoint Conversation/Meta

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 46, 48, 70-71 | Conversation-first, tranche verticale utile, ordre OS-5, états honnêtes et reprise exacte | Point de contrôle ajouté à Conversation au commit `c038df4`, publié et prouvé sans module secondaire ni effet externe | Checkpoint humain Meta avant fournisseur réel |
| 10-18, 24, 26-31, 43-44, 64-68 | Connecteur fail-closed; blocage humain explicite; interface française; preuve visible et fournisseur identifiable | Cinq états traduits, prochaine action, effet externe bloqué/mock/possible; aucun bouton d'activation ou d'envoi; aucun appel réseau | Validation SMS Meta non prouvée; inventaire officiel app/WABA/Phone Number ID non effectué |
| 16-18, 22-23, 35-38 | Ne pas exposer les secrets ou entrées sensibles; conserver les frontières tenant et provider | La présentation ne retourne ni configuration manquante, ni nom de variable, ni valeur sensible; le registre est lu côté serveur après session | Token persistant, endpoint public, stockage réel et Graph toujours absents |
| 32, 69 | DoD et matrice unit/intégration/provider/sécurité/Playwright | CI `33942266316` : audit, migrations, `db:verify`, backup/restauration, lint, TypeScript, 160 fichiers/764 tests PostgreSQL inclus, build et 20 Playwright verts; continuité `33942266310` verte | Aucun écart de preuve identifié pour cette tranche; deux avis transitifs modérés `qs` restent à suivre |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification du checkpoint Conversation/Meta

- Livré, publié et prouvé CI : modèle de présentation et carte Conversation avec état, action suivante et effet externe.
- Réel connecté : aucun; le registre par défaut reste `disabled` et aucun endpoint tenant réel n'est composé.
- Sandbox : aucune appelée.
- Mock : état pris en charge par la présentation et testé sans réseau; aucun mock activé dans le runtime de la page.
- Bloqué humain : validation SMS Meta non prouvée; confirmation au moment exact avant token persistant; autorisation distincte avant Graph ou message.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Checkpoint applicatif — 5 septembre 2026, 02:06 UTC

- Branche : `codex/tradikom-one-os`; head applicatif publié et prouvé `25cafcdaa9031cf7835068cc2487d921c0ff6d51`; `tmp/` reste non suivi et hors index. Les publications ont été précédées de comparaisons d'ancêtre et sont restées strictement fast-forward.
- Travail effectué : migration runtime `114` et miroir SQL `0108`, six helpers `SECURITY INVOKER` et politiques séparées par opération sur onze tables. Les objets liés à un plan, une mission ou un événement héritent du droit du fil; les objets génériques restent tenant-scoped.
- Correctif de preuve : le contrôle de couverture RLS partage désormais une requête unique entre le vérificateur des migrations et les tests PostgreSQL. Il accepte une policy `ALL` ou les quatre opérations complètes et refuse RLS désactivée ou une opération manquante. Les fixtures PostgreSQL ont aussi été rendues uniques, sans paramètres clairsemés, avec membership et contexte acteur explicites.
- Impact north star : la base PostgreSQL applique désormais la même confidentialité que le service Conversation aux fils, messages, pièces jointes, plans, validations, missions et événements, y compris contre une lecture directe par rôle restreint.
- Risques contenus : membership et `app.actor_id` sont obligatoires, les mises à jour contrôlent ancienne et nouvelle ligne, les payloads invalides échouent fermé et un acteur restreint ne peut pas forger le bypass système. Le contexte serveur privilégié est limité à la configuration propriétaire/administrateur déjà contrôlée.
- GitHub : PR #11 ouverte, brouillon et `MERGEABLE`; continuité `33936955672` verte et CI `33936955678` entièrement verte en 22 min 49 s, incluant PostgreSQL/RLS, 159 fichiers/757 tests, build et 20 Playwright. Aucun Graph, stockage réel, secret, message, fusion, déploiement ou dépense.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 31-33, 46, 48, 70-71 | Conversation-first, tranche verticale utile, ordre strict et reprise exacte | Frontière RLS du Conversation Hub livrée, publiée et prouvée sans CRM, Kanban, dashboard ni OS-6 | Checkpoint humain/fournisseur OS-5 avant tout fournisseur réel |
| 10-12, 16-18, 22, 28, 35-38, 43-44 | Les droits du fil doivent se propager aux objets dérivés avec isolation tenant, RLS et actions durables | Six helpers invoker, politiques par opération sur onze tables, héritage plan/run/event, objets génériques compatibles; restricted-role exécuté sur PostgreSQL 17 | Aucun écart RLS identifié dans cette tranche |
| 32, 69 | DoD et matrice unit/intégration/RLS/provider/workflow/Playwright/sécurité | CI `33936955678` : audit, migrations, `db:verify`, backup/restauration, lint, TypeScript, 159 fichiers/757 tests, build et 20 Playwright verts; continuité `33936955672` verte | Stockage/ACL réel, antivirus, OCR/transcription et Graph restent non implémentés/réels |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Classification actuelle

- Livré, publié et prouvé CI : worker média, migrations, rendu Conversation, composition générique, scan mock, extraction `external_untrusted_data`, contrôle d'intégrité, vue `data-only` non raccordée, accès court, frontière HTTP/session, classification confidentialité/visibilité et autorisations durables personal/team/case appliquées dans le service et la RLS PostgreSQL aux fils, messages, pièces jointes, plans, validations, missions et événements.
- Réel connecté : aucun nouveau fournisseur; Graph et stockage réel non composés.
- Sandbox : aucune appelée.
- Mock : fetch, scanner propre/dangereux/temporaire, extracteur, stockage média, codec et lecture HTTP uniquement via doubles injectés; classification et autorisations du fil sont réelles en base locale mais aucun fournisseur n'en dépend.
- Bloqué humain : code SMS Meta saisi directement par l'utilisateur; confirmation distincte au moment exact avant token persistant.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Checkpoint — 4 septembre 2026, 09:45 UTC

- Branche : `codex/tradikom-one-os`.
- Head local et distant publié : `28efa750935b2766de3410b8d9c0d5e3c4e2dbe8`.
- PR #11 : ouverte, brouillon et fusionnable sur ce head; la continuité `33826756891` est verte.
- CI `33826756939` : deux tentatives arrêtées avant migrations/tests par un timeout de l'API d'audit npm, sans avis de vulnérabilité ni échec applicatif.
- Troisième relance non exécutée : le contrôleur d'autorisation a échoué sur une erreur réseau et exige une approbation utilisateur explicite; aucun contournement n'est tenté.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche locale rend l'attente d'un média actionnable et durable sans prétendre que son binaire a été importé : le message signé reste visible dans la conversation et une réservation protégée peut être traitée ultérieurement. Cela renforce directement le canal conversationnel sans ajouter d'interface métier. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 11, 14, 22-23, 31-33, 46, 48, 64-65 et 69-71 du prompt maître ont été relues directement pour ce checkpoint; les pages 48 et 69 ont aussi été inspectées visuellement pendant ce heartbeat.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | Head `28efa75` publié; continuité verte; aucun CRM/Kanban/dashboard/OS-6 sélectionné | Approbation explicite pour relancer, puis CI complète après rétablissement du registre npm |
| 11, 14 | Conversation Hub canonique, adaptateur sans logique métier et déduplication | Notice française conservée; référence fournisseur éphémère hors objet sérialisable; rejeu exact et collision testés | Import binaire différé |
| 22-23 | Média externe non fiable, stockage avec ACL/checksum, minimisation et injection | Référence AES-256-GCM avec contexte tenant/provider/endpoint/message; aucune valeur média en clair, aucun binaire ou fausse pièce jointe | Contrôles réels taille/type, stockage immuable, antivirus, transcription/OCR |
| 31-33 | Definition of Done : action durable, états honnêtes et preuve utilisable | Réservation tenant/RLS, relations composées, `pending`/`not_configured`/`failed`, audit sans contenu; tests locaux, lint, typecheck et build verts; continuité distante verte | CI bloquée avant tests par timeout npm; PostgreSQL/RLS, suite exhaustive et Playwright restent requis; fournisseur actif bloqué par SMS |
| 64-65 | Runtime provider uniforme, webhook signé et fournisseur fail-closed | Ingestion et réservation atomiques; zéro Graph; provider réel toujours non activé | Meta for Developers attend le code SMS |
| 69 | Matrice provider, intégration, sécurité et isolation | Matrice relue en rendu; chiffrement/AAD, migrations miroir, non-fuite, atomicité, RLS et collision couverts | Test RLS local ignoré sans `DATABASE_URL`; CI complète requise après panne npm |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Historique : travail alors publié avant sa preuve CI finale

- Migrations runtime 105/106 et miroirs SQL 0099/0100 pour `channel_provider_media_imports`, avec relations composées tenant/endpoint/provider et tenant/message, index tenant-leading, contraintes d'état et politique RLS.
- Référence fournisseur conservée de manière éphémère jusqu'au service d'ingestion, puis chiffrée en AES-256-GCM avec AAD tenant/provider/endpoint/message et version de clé.
- Aucun Media ID, MIME, checksum, nom de fichier, URL, contenu ou payload en clair dans la réservation ou l'audit.
- États durables `pending`, `not_configured` et `failed`; rejeu identique sans doublon et collision de référence refusée.
- Réservation et audit dans la même transaction que le message canonique; aucun `fetch`, Graph, stockage, binaire ou pièce jointe canonique.
- Cette limite historique est levée par la CI `33936955678` du head `25cafcd`; elle ne décrit plus l'état courant.

## Travail livré, publié et prouvé CI

- Normalisation stricte des messages Meta `image`, `audio`, `document`, `video` et `sticker`, avec MIME autorisés par type et champs média bornés.
- Conservation de la légende utile et ajout d'une notice française explicite indiquant que l'import sécurisé reste en attente.
- Suppression des métadonnées média à la frontière de normalisation : Media ID, checksum, nom de fichier et MIME ne sont pas propagés vers le Conversation Hub.
- Zéro appel réseau et zéro ligne `conversation_message_attachments`; la tranche ne simule ni téléchargement, ni stockage, ni analyse du média.
- Lot texte+média+statut atomique et idempotent, avec prévalidation commune, audit sans PII et replay complet sans doublon.
- Dispatch unifié de chaque changement Meta signé vers messages entrants ou statuts de livraison après une seule vérification HMAC du corps brut.
- Borne combinée de cent événements et refus strict d'un changement ambigu contenant `messages` et `statuses`, ou aucune famille reconnue.
- Prévalidation de tous les endpoints et livraisons des deux familles avant toute mutation, puis transaction unique pour messages, bindings, événements et projections.
- Rejeu mixte idempotent, signature invalide sans accès base et livraison inconnue annulant aussi le message valide du même lot.
- Réponse HTTP réduite à `{ ok: true }` et audits prouvés sans contenu, numéros, Phone Number ID ni identifiants `wamid`.
- Traitement de tous les messages texte d'une enveloppe Meta au lieu du seul premier élément.
- Bornes strictes : dix `entry`, dix `changes` par entrée, dix `messages` par changement et cent messages maximum par requête.
- Prévalidation de tous les couples WABA/Phone Number ID avant mutation; un endpoint ultérieur inconnu laisse zéro message, zéro binding et zéro audit conversationnel.
- Résultats par message avec provenance, idempotence SHA-256 et rejeu indépendant; une enveloppe multi-tenant conserve deux identités et fils distincts.
- Traitement de plusieurs statuts Meta dans une même enveloppe après une seule vérification HMAC du corps brut.
- Bornes strictes : dix `entry`, dix `changes` par entrée, dix `statuses` par changement et cent statuts maximum par requête.
- Prévalidation de toutes les références endpoint/livraison avant mutation; une référence ultérieure inconnue laisse zéro événement et zéro audit.
- Résumé sûr du lot avec compte traité/rejoué/mis à jour, sans exposer WABA, Phone Number ID, `wamid`, destinataire, timestamp ou erreur fournisseur dans la réponse HTTP.
- Notifications Meta `sent`, `delivered`, `read`, `failed` et `deleted` normalisées vers les états internes.
- Dispatch du même webhook signé entre message entrant et statut sortant, sans parsing avant signature.
- Résolution WABA/Phone Number ID vers un endpoint Meta actif avant corrélation du `wamid` à une livraison du même endpoint.
- Migration runtime 104 et miroir SQL 0098 : événements immuables Meta, FK tenant/livraison/provider et `wamid` sortant opaque avec padding.
- Déduplication des callbacks, projection monotone et convergence `failed` puis `read`, avec audit sans PII ni référence fournisseur.
- Compatibilité additive avec `messaging_product`, `display_phone_number`, `contacts` et `timestamp`, sans relâcher les objets stricts ni les bornes.
- Acceptation de `wamid` avec padding base64 jusqu'à 256 caractères; dérivation SHA-256 des clés d'idempotence et de corrélation au lieu d'y incorporer l'identifiant brut.
- Fixture officielle entièrement anonymisée et test d'intégration signé avec Phone Number ID à 16 chiffres.
- Preuve que le message et sa provenance utiles sont conservés une seule fois, tandis que les champs d'identité fournisseur restent hors audits, identités et liaisons.
- Migration additive autorisant `whatsapp_meta` dans `channel_provider_secret_versions` sans réécrire l'historique appliqué.
- Contrainte composée empêchant tout mélange de provider entre secret et endpoint.
- Repository général tenant/provider-scoped, avec identité Meta active et liaison endpoint-identité obligatoire.
- Service de rotation/révocation Meta endpoint et identité, idempotent et réservé aux rôles administrateurs du tenant.
- Schémas bornés pour WABA, token, Phone Number ID, version Graph, secret d'application, jeton webhook et destination.
- Résolveurs serveur séparés pour credentials, destination et vérification webhook; aucune lecture globale de secret.
- Preuve d'intégration au transport Graph avec `fetch` factice uniquement.
- Tests de non-fuite en base et audit, rotation de clé, révocation monotone, mauvais WABA, cross-tenant et identité non liée.
- Test PostgreSQL/RLS adapté pour couvrir un tenant Twilio et un tenant Meta; il reste ignoré localement sans `DATABASE_URL`.
- Aucun grant `anon`/`authenticated` ni exposition Data API n'a été ajouté, conformément à la séparation grants/RLS.

## Validation honnête

- Commits locaux `3df4f7c5f642bfca473820a4efe1f42838c3a5c5` et `15b2af7949e937b2f59a5cdd6db9728489fb1478` : SHA-256 revérifié à chaque lecture, suppression du contenu altéré, contrat `verified`/`failed`, vue `data-only` filtrée et bornée, rendu français et scénario Playwright positif/négatif. Tests ciblés 4 fichiers/40 tests verts; régression exhaustive 140 fichiers/685 tests verts et 8 fichiers/21 tests PostgreSQL ignorés. ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. Playwright attend la CI PostgreSQL.
- Commit local `4cb9f4220cdd6e0d0b17ad3a4239e37d40c512ed` : extraction obligatoire sous enveloppe `external_untrusted_data`, migration additive 110/0104, mode et contenu immuables, texte borné/hashé, contrat d'entrée non usurpable, audit sûr et rendu français. Tests ciblés : 3 fichiers/38 tests verts; 1 fichier/3 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`. Régression exhaustive : 139 fichiers/681 tests verts; 8 fichiers/21 tests PostgreSQL ignorés. ESLint, TypeScript, build production, continuity-check direct et diff check sont verts. Le scénario Playwright est adapté mais non exécuté localement faute de PostgreSQL partagé.
- Commit local `ca08001929a438f94cf13c889a9f99a0425b67b8` : scan de sécurité obligatoire avant stockage, migration additive 109/0103, modes durables et audit sûr. Tests finaux ciblés : 2 fichiers/30 tests verts; 1 fichier/2 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`. Régression exhaustive : 139 fichiers/678 tests verts; 8 fichiers/20 tests PostgreSQL ignorés. ESLint, TypeScript, build production, continuity-check direct et diff check sont verts. Le scénario Playwright est adapté mais non exécuté localement faute de PostgreSQL partagé.
- Head `28efa75` : publication confirmée par fetch exact; continuité `33826756891` verte.
- CI `33826756939` tentatives 1 et 2 : rouges uniquement parce que `pnpm audit` n'a pas reçu de réponse de `registry.npmjs.org/-/npm/v1/security/advisories/bulk` après retries. L'arrêt précède migrations, RLS, tests, build et Playwright; aucune de ces preuves n'est revendiquée sur ce head.
- Troisième relance : non exécutée, car le contrôleur d'autorisation a échoué sur une erreur réseau et demande une approbation utilisateur explicite. Aucun autre mécanisme n'est utilisé pour déclencher indirectement la même action.
- Reproduction locale de l'audit hors sandbox : même timeout du registre. Le contrôle n'est ni supprimé, ni ignoré, ni rendu permissif.
- Parent `232f60a` : CI `33674098147` et continuité `33674098123` vertes; PR #11 ouverte, brouillon et `MERGEABLE/CLEAN` avant publication locale.
- Réservation média locale : 4 fichiers ciblés réussis, 1 fichier PostgreSQL/RLS ignoré, 17 tests réussis et 1 ignoré; ingestion complète 13/13 verte. La régression Meta élargie a 19 fichiers et 135 tests réussis; deux scénarios ont uniquement dépassé le délai lors de sauts d'horloge locale puis ont repassé isolément en quelques secondes.
- ESLint complet, TypeScript, build Next.js production et `git diff --check` sont verts. Le build a utilisé le réseau uniquement pour les polices Google déjà déclarées.
- `pnpm agent:continuity-check` a été tenté mais son lanceur local a voulu réinstaller sans réseau ni TTY; le script versionné direct retourne `ready`, zéro erreur et zéro avertissement. La CI du futur head doit encore prouver migrations PostgreSQL, RLS, suite exhaustive et Playwright.
- Head `0e92f38` : CI `33523760105` et continuité `33523760887` vertes, incluant migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 144 fichiers/670 tests, build production et 20 Playwright pour l'enveloppe mixte.
- Tranche média locale : nouveaux scénarios des cinq types, rejet d'entrée invalide, zéro réseau, zéro pièce jointe et lot mixte passent. La régression élargie compte 122 tests réussis et 2 PostgreSQL ignorés; deux timeouts liés aux sauts d'horloge locaux ont été relancés isolément et passent. ESLint complet, TypeScript, build production, continuity-check direct et `git diff --check` sont verts.
- Head média `41c2fc8` : continuité `33628923623` verte; CI `33628923602` rouge uniquement sur l'audit préalable `browserslist 4.28.5`, avant migrations ou tests. La surcharge `4.28.7` met à jour le lockfile et `pnpm audit --prod --audit-level high` ne trouve plus de vulnérabilité connue; la nouvelle CI reste requise.
- Head final `44350ec` : CI `33661150567` entièrement verte sur audit, migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 144 fichiers/674 tests, build et 20 Playwright; continuité `33661150706` verte.
- Tranche mixte locale : test dédié 5/5 vert; régression ingress/webhook 6 fichiers/41 tests; régression Meta/coffre 18 fichiers/120 tests verts et 2 fichiers/2 tests PostgreSQL ignorés sans `DATABASE_URL`; ESLint complet, TypeScript, build production, continuity-check et `git diff --check` verts. La CI exhaustive du futur head n'est pas encore revendiquée.
- Tranche entrante locale : 2 fichiers/13 tests ciblés verts; régression Meta 13 fichiers réussis, 3 fichiers PostgreSQL ignorés, 96 tests réussis et 3 ignorés sans `DATABASE_URL`; ESLint ciblé et complet, TypeScript, build production, continuity-check et `git diff --check` verts.
- La suite exhaustive locale est restée silencieuse plus de trois minutes et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte. La CI PostgreSQL/RLS, suite exhaustive et Playwright du futur head ne sont pas encore revendiqués.
- Tranche statut locale : 4 fichiers/27 tests statut-migrations-HTTP verts, puis régression Meta 15 fichiers/97 tests verts.
- ESLint ciblé et complet, TypeScript, `git diff --check`, continuity-check et build Next.js production verts. La tentative de build sandbox a recréé `node_modules`; le dossier incomplet a été déplacé dans `/private/tmp` et les 601 dépendances exactes restaurées depuis le store et le lockfile avant le build final.
- La suite exhaustive, PostgreSQL/RLS et Playwright du nouveau head ne sont pas revendiqués avant la CI.
- Correctif enveloppe : 4 fichiers/24 tests ingress-webhook verts, puis 17 fichiers/108 tests Meta et coffre verts.
- ESLint complet, TypeScript, `git diff --check`, continuity-check (`ready`, zéro erreur/avertissement) et build Next.js production verts.
- La CI `33425435804` est entièrement verte en 19 min 22 s : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/653 tests, build production et 20/20 Playwright. La continuité `33425435724` est verte.
- Le handoff final `cb3e50b` est lui aussi prouvé : CI `33427555175` verte en 20 min 32 s et continuité `33427555275` verte; PR #11 `MERGEABLE/CLEAN`.
- Tests ciblés : 14 fichiers réussis et 2 ignorés; 91 tests réussis et 2 PostgreSQL ignorés.
- Migrations : miroir runtime/SQL, base neuve, upgrade depuis runtime 101 et refus du mauvais couple provider/endpoint validés sous PGlite.
- ESLint complet, TypeScript, `git diff --check` et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour les polices Google requises.
- La suite `pnpm test` exhaustive locale est restée silencieuse et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte localement.
- `pnpm db:verify` local refuse sans `DATABASE_URL`; aucune clé ou URL PostgreSQL n'a été demandée.
- La CI publiée `33422211572` lève ces limites : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/651 tests, build production et 20 Playwright verts en 19 min 15 s. La continuité `33422211485` est verte.

## Classification des états

- Livré et prouvé CI : coffre Meta chiffré, provider-scoped, versionné, révocable et audité sans secret.
- Livré et prouvé CI : enveloppe webhook officielle, `wamid` opaque et clés internes hashées.
- Livré et prouvé CI : notifications de statut Meta signées, immuables, idempotentes et monotones.
- Livré et prouvé CI : lots de statuts Meta bornés, prévalidés et atomiques.
- Livré et prouvé CI : lots de messages entrants Meta bornés, prévalidés, atomiques, idempotents et multi-tenant.
- Livré et prouvé CI : enveloppe mixte messages/statuts authentifiée une fois, bornée, prévalidée et atomique.
- Livré et prouvé CI : représentation conversationnelle française de cinq types média signés, sans téléchargement Graph ni stockage fictif.
- Livré, publié et prouvé CI : réservation et worker média durables, composition générique, validation binaire/hachage, scanner puis extraction `external_untrusted_data` obligatoires, vérification SHA-256 à la lecture, vue `data-only` non raccordée, stockage/pièce jointe mock idempotents, accès court et frontière HTTP/session, classification durable et autorisations utilisateur personal/team/case appliquées dans le service et la RLS PostgreSQL aux fils, messages, pièces jointes, plans, validations, missions, événements actifs et incidents, avec interface visible en français.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : fetch, scanner, extracteur et stockage injectés uniquement en test, sans réseau fournisseur, antivirus, OCR, LLM ni outil réel.
- Bloqué humain : code SMS Meta saisi directement dans Meta for Developers; confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le coffre Meta, l'enveloppe officielle, les statuts, leurs lots, les messages entrants, l'enveloppe mixte, la représentation et la réservation média, le worker mock, le scan/extraction, l'accès court, la classification des fils, les droits durables et leur héritage RLS jusqu'aux validations, missions et événements sont publiés et prouvés par la CI `33936955678` sur PostgreSQL 17. Le vérificateur accepte sans dérive une policy `ALL` ou les quatre opérations complètes; la suite compte 159 fichiers/757 tests et 20 Playwright verts. Les écarts réels restent stockage Supabase/ACL, antivirus, OCR/transcription et Graph. Le prochain checkpoint demeure Meta for Developers : l'utilisateur saisit le code SMS directement sans le transmettre au chat, puis indique seulement que l'étape est terminée. Après validation, inventorier l'app/WABA/Phone Number ID en lecture seule et demander une confirmation immédiatement avant toute création de token persistant. `goal-watch`/OS-6, CRM, Kanban et dashboard secondaire restent hors périmètre. Aucune requête Graph, stockage réel, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
