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
- `src/modules/orchestrator/repository.ts`, `generator.ts` et `service.ts`;
- migrations runtime `069`/`070`, miroirs `0063`/`0064` et tests associés;
- les quatre fichiers de continuité.

## Risques

- le parcours web n'a pas encore sa preuve Playwright Conversation mobile/desktop dédiée;
- le service de plan est local et attend sa première validation CI complète;
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

Le run `30549936954` est entièrement vert sur `e561f57`. Le run `30551054764` sur `8288791` valide migrations PostgreSQL, backup/restore et lint, puis s'arrête au typecheck sur un fixture de test trop étroit. Le correctif et le service tenant-aware ont été publiés dans `1dca742`; le run `30552219390` a déjà validé migrations, backup/restore, lint et typecheck et poursuit les tests complets. Le workflow de continuité `30552219213` est vert.

## Ce qui reste simulé

- OAuth `mock_business`;
- DNS et propagation `.test`;
- exécution connecteur lecture seule sans réseau;
- génération IA déterministe;
- gains de temps et financiers non mesurés.

## Prochaine action recommandée

Faire valider l'affichage exact du plan et les commandes françaises Approuver/Refuser, puis implémenter l'exécution durable mock et la projection multicanale de son résultat.
