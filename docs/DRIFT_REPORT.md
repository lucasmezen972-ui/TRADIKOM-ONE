# Drift report

- Date : 2026-07-30
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Travail effectué : verticale web/test verte et ouverture du plan structuré avec catalogue mock, validation pure et persistance immuable tenant-scoped.

## Impact north star

La tranche crée le premier langage, le stockage, le service et l'écran canonique de la conversation continue : un membre autorisé peut écrire depuis le web, projeter une réponse depuis le canal de test et relire le même fil borné sans dépendre d'un fournisseur.

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
- migrations runtime `069`/`070`, miroirs `0063`/`0064` et tests associés;
- les quatre fichiers de continuité.

## Risques

- le parcours web n'a pas encore sa preuve Playwright Conversation mobile/desktop dédiée;
- le service de création et décision des plans n'est pas encore implémenté;
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

Le run `30549936954` est entièrement vert sur `e561f57` : migrations, lint, typecheck, 223 tests, build et Playwright. Il valide le correctif de chronologie, les adaptateurs web/test et l'écran Conversation. La parité des nouvelles migrations de plan runtime/SQL est verte; leur exécution CI reste à lancer.

## Ce qui reste simulé

- OAuth `mock_business`;
- DNS et propagation `.test`;
- exécution connecteur lecture seule sans réseau;
- génération IA déterministe;
- gains de temps et financiers non mesurés.

## Prochaine action recommandée

Faire valider les contrats, capacités et migrations de plan, puis implémenter la création tenant-aware, l'approbation unique et l'audit du plan exact.
