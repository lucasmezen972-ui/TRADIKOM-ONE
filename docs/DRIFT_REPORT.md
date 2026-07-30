# Drift report

- Date : 2026-07-30
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Travail effectué : contrats et persistance test-first, bornés et provider-agnostic du Conversation Hub canonique.

## Impact north star

La tranche crée le premier langage et le stockage canonique de la conversation continue : un même tenant peut représenter des participants, identités de canal, fils, messages, pièces jointes et routes sans dépendre d'un fournisseur. Elle n'ajoute encore ni écran ni exécution externe.

## Modules touchés

- `src/modules/conversation-hub/schemas.ts`;
- `tests/conversation-hub-schemas.test.ts`;
- `src/lib/db.ts` et les migrations `0061`/`0062`;
- `tests/conversation-hub-migrations.test.ts` et la couverture PostgreSQL RLS;
- les quatre fichiers de continuité.

## Risques

- le repository et le service devront vérifier membership et tenant en plus des contraintes composites de base;
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

Les nouvelles tentatives Vitest et ESLint restent silencieuses localement et ont été bornées. La CI Linux/PostgreSQL de la PR doit maintenant valider la migration, le RLS et les tests ajoutés.

## Ce qui reste simulé

- OAuth `mock_business`;
- DNS et propagation `.test`;
- exécution connecteur lecture seule sans réseau;
- génération IA déterministe;
- gains de temps et financiers non mesurés.

## Prochaine action recommandée

Faire valider la migration par la CI, puis ajouter `src/modules/conversation-hub/repository.ts` et le service tenant-aware avec vérification de membership, transaction d'ingress idempotente et audit sans contenu client.
