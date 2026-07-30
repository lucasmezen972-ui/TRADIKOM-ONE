# Drift report

- Date : 2026-07-30
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Travail effectué : verticale web/test verte et ouverture du plan structuré avec catalogue mock, validation pure et persistance immuable tenant-scoped.

## Impact north star

La tranche crée le premier langage, le stockage, le service et l'écran canonique de la conversation continue : un membre autorisé peut écrire depuis le web, projeter une réponse depuis le canal de test et relire le même fil borné sans dépendre d'un fournisseur.

## Alignement prompt maître

- Pages consultées : pages 3-7, 11-18, 22, 24, 31-33, 46, 48, 64-71.
- Exigence servie : après la verticale OS-1 verte, ouvrir OS-2 par un contrat ChannelAdapter sans logique métier, des entrées bornées, des signatures explicites et des états fournisseurs vrais.
- Preuve actuelle : contrat, registre, provider et vérificateur Svix verts; migrations de correspondance livraison/tenant et événements `svix-id` sans PII, avec contraintes composées, index tenant-leading et RLS.
- Écarts restants : les migrations attendent leur CI; le service est local mais non publié; aucune route, activation, credential, consentement ou livraison réelle n'existe.

## Modules touchés

- `src/modules/conversation-hub/schemas.ts`;
- `tests/conversation-hub-schemas.test.ts`;
- `src/lib/db.ts` et les migrations `0061`/`0062`;
- `tests/conversation-hub-migrations.test.ts` et la couverture PostgreSQL RLS;
- `src/modules/conversation-hub/repository.ts`, `service.ts`, `errors.ts` et `index.ts`;
- `tests/conversation-hub-service.test.ts`;
- `src/modules/channels/test-channel.ts` et `tests/test-channel-adapter.test.ts`;
- `src/modules/channels/web-channel.ts`, `runtime.ts` et l'écran `/conversation`;
- `src/components/app-shell.tsx` pour l'entrée de navigation Conversation;
- `src/modules/orchestrator/` pour schémas, erreurs et catalogue des capacités;
- `src/modules/orchestrator/repository.ts`, `generator.ts` et `service.ts`;
- migrations runtime `069`/`070`, miroirs `0063`/`0064` et tests associés;
- les quatre fichiers de continuité.

## Risques

- le runtime Next.js local bloque avant ouverture du port; la preuve navigateur OS-1 vient de la CI verte;
- OS-2 n'a pas encore son inventaire consolidé des quatre canaux;
- la PR #10 reste large et orientée CRM; sa fusion en bloc diluerait le coeur conversationnel;
- le fournisseur `OpenAiProvider` ne réalise pas encore d'appel structuré réel;
- les fournisseurs externes restent mock, manuels ou désactivés sans credentials.

## Validations

- workflow Continuité de la PR #11 : run `30546098944` vert sur `2d30810`;
- PR #11 : runs `30514520472` et `30514520487` verts sur `e2a092b`;
- tests ciblés Conversation Hub : 5/5 verts;
- ESLint ciblé : vert;
- build Next.js local avec environnement CI factice : vert, TypeScript inclus.
- parité exacte entre migrations runtime `067`/`068` et miroirs SQL `0061`/`0062` : verte;
- `git diff --check` ciblé migrations/tests : vert.
- PR #11 : runs `30546099003` et `30546098944` verts, incluant PostgreSQL/RLS, migrations, lint, typecheck, tests, build et Playwright.

Le run `30549936954` est entièrement vert sur `e561f57`. Les échecs intermédiaires `30551054764`, `30552219390` et `30552994527` ont été corrigés dans les checkpoints suivants. Le run final `30554462472` sur `95da35e` valide migrations, backup/restore, lint, typecheck, 234 tests, build production et Playwright desktop/mobile en 10 min 37 s. Le run de continuité `30554462620` est vert en 22 s.

Le premier checkpoint OS-2 `d181a97` est entièrement vert dans la CI `30556603463` : migrations, backup/restore, lint, typecheck, tests, build production et Playwright. La continuité `30556603427` est également verte.

Le contrôle de continuité renforcé pour le prompt maître retourne localement `ready`, sans erreur ni avertissement, en vérifiant le PDF de 71 pages et son empreinte. La commande exacte `pnpm agent:continuity-check` termine désormais en environ six secondes grâce au runtime TypeScript natif de Node 22. L'automation native lit directement les pages cœur et exige une preuve paginée avant de choisir une tâche.

## Ce qui reste simulé

- OAuth `mock_business`;
- DNS et propagation `.test`;
- exécution connecteur lecture seule sans réseau;
- génération IA déterministe;
- gains de temps et financiers non mesurés.

## Prochaine action recommandée

Valider les migrations email provider en CI, puis publier le service tenant-aware de déduplication et d'ordre tardif sans route publique.
