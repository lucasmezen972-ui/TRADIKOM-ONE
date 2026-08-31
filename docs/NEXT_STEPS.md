# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; tous les changements suivis et non suivis sont à préserver. `tmp/` reste strictement exclu de tout commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement le 30 août 2026.
- La branche locale a été réconciliée sans perte par fast-forward strict de `787d54b` vers le head distant `33777bf`; le lot Meta sale n'avait aucun chemin en conflit avec le commit OS-6 distant et reste intégralement préservé.
- La PR #11 est ouverte et en brouillon, mais en conflit avec `main`. Avant publication du lot Meta, la CI distante `32374109077` est rouge uniquement sur `goal-watch-service / conversation_messages_check`; la continuité `32374109126` est verte.

## Dernière tranche livrée localement : flux sortant WhatsApp Cloud Meta, sans activation

- Les migrations runtime 088-090 et leurs miroirs SQL 0082-0084 autorisent les livraisons `whatsapp_meta`, ajoutent une liaison opaque endpoint-identité, une contrainte d'écriture protectrice et les politiques RLS tenant-aware.
- L'ingress réserve cette liaison par tenant et endpoint. Un contact rattaché à un numéro Meta ne peut donc pas être envoyé depuis un autre endpoint du même tenant.
- L'adaptateur sortant est fail-closed et ne contient aucun client Graph. Seul un transport injecté de test peut simuler un résultat `mock`.
- Le service réserve durablement avant effet, applique la policy, respecte l'idempotence, gère claim/lease/retry/backoff et audite sans contenu sensible.
- Le worker ne prend que les livraisons Meta dues, avec appartenance tenant vérifiée et limite bornée.
- Aucun compte, application, WABA, numéro Meta, token, endpoint public, client Graph, message externe, dépense, fusion ou déploiement n'a été créé.

## Référence prompt maître

Les pages 13-18, 22, 26-33, 35-38, 46, 48, 64-69 imposent cette tranche : parcours conversation-first, action durable, réservation avant effet, tenant/RLS, idempotence, audit sans contenu sensible, provider honnête et tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 restent incomplètes tant que PostgreSQL/RLS et la CI publiée du lot ne sont pas verts.

## Prochaine action concrète

1. Publier uniquement les fichiers contrôlés du lot OS-5 Meta et les quatre documents de continuité sur `codex/tradikom-one-os`, après contrôle explicite de la liste d'index; exclure `tmp/`.
2. Surveiller la CI du nouveau head. Distinguer l'échec historique OS-6 `conversation_messages_check` d'un éventuel défaut directement causé par le lot Meta.
3. Obtenir la preuve PostgreSQL/RLS de `channel_provider_identity_bindings` via la CI. Corriger uniquement un défaut Meta prouvé, puis relancer les validations.
4. Ne pas reprendre CRM, Kanban, dashboard secondaire ni Goal and Watch Engine : ils ne remplacent pas la première étape OS-5 non terminée de la page 48.

## Validation disponible

- Lot Meta : 12 fichiers verts, 65 tests verts et 1 test PostgreSQL/RLS ignoré faute de `DATABASE_URL`.
- Régression sortante Twilio : 5 fichiers et 38 tests verts.
- Suite exhaustive locale : 121 fichiers et 523 tests verts; 7 fichiers et 18 tests PostgreSQL ignorés faute de `DATABASE_URL`.
- Verts : ESLint complet, TypeScript sans cache incrémental, build Next.js de production, `git diff --check` et contrôle de continuité.
- La preuve PostgreSQL réelle, backup/restauration, RLS et Playwright relève encore de la CI publiée; aucun Docker ni `DATABASE_URL` n'est disponible localement.

## État de vérité

- Livré localement : flux Meta entrant et sortant durable, tenant-aware, idempotent et fail-closed, avec preuves unitaires/intégration PGlite.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement dans les tests; aucun effet réseau.
- Bloqué humain : toute activation Meta exige compte/app/WABA/numéro autorisé, endpoint HTTPS, secrets en gestionnaire et autorisation explicite.
- Bloqué technique externe : preuve PostgreSQL/RLS et CI du head publié.
- Hors périmètre : CRM, Kanban, dashboard secondaire, activation réelle, production, fusion, déploiement et dépense.

## Bloc de reprise exact

```text
1. Se placer uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, y compris tmp/ non suivi.
2. Lire AGENT_STATE, MASTER_PROMPT_REFERENCE, WORKLOG, NEXT_STEPS, DRIFT_REPORT et la mémoire de l'automation.
3. Vérifier PDF, SHA-256, 71 pages et pnpm agent:continuity-check; relire les pages cœur et OS-5 requises.
4. Vérifier branche, head, PR #11 et CI sans reset, clean, stash, changement de branche ou fusion.
5. Si le lot Meta n'est pas encore publié, contrôler l'index fichier par fichier et exclure tmp/ avant commit/push.
6. Si le lot est publié, surveiller la CI et obtenir la preuve PostgreSQL/RLS; ne corriger qu'un défaut attribuable à OS-5 Meta.
7. Garder Meta disabled/not_configured/mock : aucune clé, client Graph, app, WABA, endpoint public ou message réel.
8. Maintenir tenant/RLS, idempotence, actions durables, audit sans PII et interfaces visibles en français.
9. Mettre à jour les quatre documents avant arrêt. Ne pas fusionner, déployer, dépenser ni demander de secret.
```
