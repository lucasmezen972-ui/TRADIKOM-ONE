# Roadmap TRADIKOM ONE OS

Par tranches verticales. Chaque tranche fonctionne de bout en bout, même avec des
fournisseurs mockés — à condition que le mock se présente comme un mock. Pas de
tranche horizontale sans expérience utilisable.

## État

| Phase | Objectif | Critère de succès | État |
| --- | --- | --- | --- |
| **OS-0** | Audit et recadrage | Documents d'entrée, drift report, décisions | **En cours** |
| OS-1 | Conversation Hub | Un fil canonique visible en web + canal de test | À faire |
| OS-2 | Omnicanal préparé | Adaptateurs WhatsApp / Teams / Slack feature-flaggés | À faire |
| OS-3 | Connector Runtime | Deux capacités génériques exécutables en mock strict | À faire |
| OS-4 | Mission durable | Plan confirmé, exécution multi-étapes, reprise, idempotence | À faire |
| OS-5 | Premier provider réel | Un outil externe activé en sandbox ou en réel avec clés | À faire |
| OS-6 | Goal Engine | Un objectif permanent surveillé et rapporté | À faire |
| OS-7 | Mobile Expo | Chat, vocal, document, décisions fortes | À faire |
| OS-8 | Marketplace SDK | Un connecteur tiers minimal installé et testé | À faire |

## OS-0 — Audit et recadrage

Livre : `docs/AUDIT_TRADIKOM_ONE_OS_ENTRY.md`, les fichiers de continuité,
`scripts/agent/continuity-check.ts`, `.github/workflows/tradikom-continuity.yml`,
le plan de fusion de la PR #10.

Ne touche aucun code produit, ne crée aucune migration.

## OS-1 — Conversation Hub canonique

Le hub est la source de vérité ; les canaux externes n'hébergent que des
projections.

Livre : `conversation_threads`, `canonical_messages`, `channel_identities`,
`message_deliveries` — tenant-scopées, **avec migration RLS dédiée**. Identité
omnicanale. Idempotence portée par une contrainte d'unicité, pas par une
vérification applicative. Anti-boucle. Adaptateur `web` réel, adaptateur `test`
mock explicite. Une page de fil qui répond à : qui, quel canal, quand, quel
statut de livraison.

Hors périmètre : orchestrateur, exécution de capacité, politique.

Prérequis technique : `testTimeout` global dans `vitest.config.ts`, en premier
commit.

## OS-2 — Omnicanal réel préparé

Adaptateurs WhatsApp, Teams, Slack, email entrant, derrière feature flags, avec
état `not_configured` visible tant qu'aucune clé n'existe. Le click-to-chat
WhatsApp actuel devient le mode dégradé explicite de l'adaptateur WhatsApp.

Rien ne doit se présenter comme connecté sans l'être. C'est la règle qui décide de
l'acceptation de cette tranche.

## OS-3 — Connector Runtime

Capability Manifest, catalogue d'actions, exécution passant par le Policy Engine.
Deux capacités génériques exécutables en mock strict, avec idempotence,
classification d'échec et audit. Remplace `connectors/registry.ts` et
`connectors/catalog.ts`.

## OS-4 — Mission durable

Plan structuré confirmé par le dirigeant, exécution multi-étapes, reprise après
interruption, idempotence de chaque étape. Le worker maison à sondage
(`src/modules/workflows/worker.ts`) est la base ; Temporal n'est pas un prérequis
de la tranche.

## OS-5 — Premier provider réel

Un outil externe réellement appelé, en sandbox ou avec des clés. L'email Resend
est le candidat naturel : le transport existe déjà et il a l'idempotence, la
classification d'échec et l'audit. Il lui manque d'être exposé comme capacité.

## OS-6 — Goal Engine

Un objectif permanent — pas une tâche — surveillé en continu et rapporté dans la
conversation. Les moteurs de règles déterministes existants (conseiller
stratégique, radar d'opportunités) fournissent les signaux.

## OS-7 — Mobile Expo

Chat, vocal, document, décisions fortes. Rien de tronqué sur mobile.

## OS-8 — Marketplace SDK

Un connecteur tiers minimal, installé et testé, sans accès au cœur.

## Règles qui traversent toutes les tranches

- Migrations additives, tenant-scopées, avec RLS dédiée.
- Chaque action externe : idempotence, audit, classification d'échec, politique.
- Aucun fournisseur non configuré ne se présente comme actif.
- Aucun arrêt sans mise à jour de `AGENT_STATE.json` et `WORKLOG.md`.
- Le drift report doit confirmer que le travail sert encore la north star
  conversationnelle.
