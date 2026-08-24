# Prochaines étapes

Une seule action concrète en tête de liste. Pas de liste vague : ce fichier
répond à « qu'est-ce que j'ouvre maintenant, et dans quel fichier ».

## Action immédiate

**Ouvrir OS-1 — Conversation Hub canonique.**

Premier commit : `vitest.config.ts`, poser un `testTimeout` global (60 s).
Les 77 fichiers de test existants s'appuient sur le défaut de 5 s et deviennent
fragiles sous charge — observé une fois, 57 dépassements sans une seule
`AssertionError`. Il faut régler ça **avant** d'ajouter des suites, pas après :
sinon chaque échec de la nouvelle suite sera ambigu.

Deuxième commit : le hub lui-même.

1. `src/lib/db.ts` — migration `079_conversation_hub` :
   - `conversation_threads` (tenant_id, id, title, kind ∈ personal/team/case/mission,
     confidentiality_level, created_by, created_at, updated_at, unique (tenant_id, id))
   - `canonical_messages` (tenant_id, conversation_id, id, origin_channel,
     origin_external_message_id, mirror_of_message_id, sender_identity_id,
     reply_to_message_id, body jsonb, confidentiality_level, visibility_scope,
     received_at, idempotency_key)
   - `channel_identities` (tenant_id, id, user_id nullable, channel, external_ref)
   - `message_deliveries` (tenant_id, canonical_message_id, delivery_id,
     target_channel, target_external_thread_id, status, failure_class)
   - Index tenant-leading sur chaque table.
   - Contrainte d'unicité `(tenant_id, idempotency_key)` sur `canonical_messages` —
     c'est elle qui porte l'idempotence, pas une vérification applicative.
2. `src/lib/db.ts` — migration `080_conversation_hub_rls`, **séparée**.
   La RLS générique ne couvre que les tables présentes quand elle s'exécute.
   Trois lots l'ont déjà appris (5, 8, 15). Ne pas le réapprendre.
3. Miroirs SQL dans `src/db/migrations/`.
4. `src/modules/conversation-hub/` — forme habituelle : `errors.ts`, `schemas.ts`,
   `repository.ts`, `service.ts`, `index.ts`.
5. Adaptateurs : `web` (réel) et `test` (mock explicite, statut affiché dans
   l'interface — jamais présenté comme un vrai canal).
6. Page du fil : qui, depuis quel canal, quand, avec quel statut de réplication.
7. Tests : unitaires, intégration, isolation RLS entre deux organisations,
   idempotence (même `idempotency_key` deux fois → un seul message),
   anti-boucle (un message miroir ne redéclenche pas d'écriture), et un parcours
   Playwright web → fil → réplication vers le canal de test.

Hors périmètre d'OS-1, explicitement : orchestrateur, exécution de capacité,
moteur de politique. Ils viennent en OS-2 et OS-3, sur un hub qui existe.

## Ensuite

- Corriger `src/modules/ai/provider.ts` : `OpenAiProvider` étiquette `openai` une
  sortie 100 % déterministe. Correctif minimal sans clé : étiquette
  `deterministic` + état `not_configured` explicite.
- Relire les 47 documents de `docs/` contre le code, un par un, pour retirer
  toute capacité promise et absente. Seuls `AI_PROVIDER.md` et les documents des
  20 lots ont été vérifiés.
- Supprimer les 8 branches obsolètes sur `origin` après la fusion de la PR #10.
- Archiver `docs/PHASE_*.md` sous `docs/archive/`.

## Décisions en attente du dirigeant

1. Fusionner la PR #10 telle quelle (recommandé) ou en détacher OS-0.
2. Étendre ou non la révision aux recommandations stratégiques et à la veille
   concurrentielle. Position actuelle : non — ce sont des analyses, pas du
   contenu ; réécrire une recommandation ferait mentir le journal d'audit.
