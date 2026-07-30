# Drift report

- Date : 2026-07-30
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Travail effectué : contrats, persistance et service tenant-aware, bornés et provider-agnostic du Conversation Hub canonique.

## Impact north star

La tranche crée le premier langage, le stockage et le service canonique de la conversation continue : un membre autorisé peut ingérer un message de façon transactionnelle et idempotente, puis relire le fil borné sans dépendre d'un fournisseur. Elle n'ajoute encore ni écran ni exécution externe.

## Modules touchés

- `src/modules/conversation-hub/schemas.ts`;
- `tests/conversation-hub-schemas.test.ts`;
- `src/lib/db.ts` et les migrations `0061`/`0062`;
- `tests/conversation-hub-migrations.test.ts` et la couverture PostgreSQL RLS;
- `src/modules/conversation-hub/repository.ts`, `service.ts`, `errors.ts` et `index.ts`;
- `tests/conversation-hub-service.test.ts`;
- les quatre fichiers de continuité.

## Risques

- la persistance n'est pas encore consommée par un parcours utilisateur;
- la PR #10 reste large et orientée CRM; sa fusion en bloc diluerait le coeur conversationnel;
- le fournisseur `OpenAiProvider` ne réalise pas encore d'appel structuré réel;
- les fournisseurs externes restent mock, manuels ou désactivés sans credentials.

## Tests passés

- `agent:continuity-check` : vert;
- PR #11 : runs `30514520472` et `30514520487` verts sur `e2a092b`;
- tests ciblés Conversation Hub : 5/5 verts;
- ESLint ciblé : vert;
- build Next.js local avec environnement CI factice : vert, TypeScript inclus.
- parité exacte entre migrations runtime `067`/`068` et miroirs SQL `0061`/`0062` : verte;
- `git diff --check` ciblé migrations/tests : vert.
- PR #11 : runs `30546099003` et `30546098944` verts, incluant PostgreSQL/RLS, migrations, lint, typecheck, tests, build et Playwright.

La tentative ESLint ciblée du service reste silencieuse localement et a été bornée. La CI Linux/PostgreSQL de la PR doit maintenant valider le nouveau checkpoint service.

## Ce qui reste simulé

- OAuth `mock_business`;
- DNS et propagation `.test`;
- exécution connecteur lecture seule sans réseau;
- génération IA déterministe;
- gains de temps et financiers non mesurés.

## Prochaine action recommandée

Faire valider le repository et le service par la CI, puis ajouter le canal de test sans réseau et le web chat minimal français sur le fil canonique.
