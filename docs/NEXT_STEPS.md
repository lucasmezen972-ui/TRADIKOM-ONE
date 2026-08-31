# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; tous les changements suivis et non suivis sont à préserver. `tmp/` reste strictement exclu de tout commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement le 30 août 2026.
- La branche locale a été réconciliée sans perte par fast-forward strict de `787d54b` vers le head distant `33777bf`; le lot Meta sale n'avait aucun chemin en conflit avec le commit OS-6 distant et reste intégralement préservé.
- Le lot `eec609b` et les handoffs documentaires jusqu'à `39002dd` ont été poussés sans force; la branche locale et distante sont synchronisées avant le présent checkpoint et `tmp/` reste exclusivement local.
- La réconciliation autorisée avec `main` est résolue localement : les 16 conflits sont fermés sans perdre les évolutions tenant, le lot Meta ni les historiques Git.
- Les migrations déjà publiées sur `main` conservent les identifiants runtime 067-078 et SQL 0061-0072. Les migrations OS sont décalées en runtime 079-102 et SQL 0073-0096 afin qu'une base déjà migrée puisse être mise à niveau sans collision.

## Dernière tranche livrée localement : flux sortant WhatsApp Cloud Meta, sans activation

- Les migrations runtime 100-102 et leurs miroirs SQL 0094-0096 autorisent les livraisons `whatsapp_meta`, ajoutent une liaison opaque endpoint-identité, une contrainte d'écriture protectrice et les politiques RLS tenant-aware.
- L'ingress réserve cette liaison par tenant et endpoint. Un contact rattaché à un numéro Meta ne peut donc pas être envoyé depuis un autre endpoint du même tenant.
- L'adaptateur sortant est fail-closed et ne contient aucun client Graph. Seul un transport injecté de test peut simuler un résultat `mock`.
- Le service réserve durablement avant effet, applique la policy, respecte l'idempotence, gère claim/lease/retry/backoff et audite sans contenu sensible.
- Le worker ne prend que les livraisons Meta dues, avec appartenance tenant vérifiée et limite bornée.
- Aucun compte, application, WABA, numéro Meta, token, endpoint public, client Graph, message externe, dépense, fusion ou déploiement n'a été créé.

## Référence prompt maître

Les pages 13-18, 22, 26-33, 35-38, 46, 48, 64-69 imposent cette tranche : parcours conversation-first, action durable, réservation avant effet, tenant/RLS, idempotence, audit sans contenu sensible, provider honnête et tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 restent incomplètes tant que PostgreSQL/RLS et la CI publiée du lot ne sont pas verts.

## Prochaine action concrète

1. Enregistrer le commit de fusion local et le pousser sans force sur `codex/tradikom-one-os`.
2. Laisser démarrer la CI `pull_request` et obtenir la preuve PostgreSQL/RLS de `channel_provider_identity_bindings` et des migrations renumérotées.
3. Corriger immédiatement un défaut prouvé de réconciliation ou d'OS-5 Meta; distinguer l'échec historique OS-6 `conversation_messages_check` s'il réapparaît.
4. Ne pas fusionner la PR #11, activer Meta, déployer ou dépenser sans autorisation humaine distincte.

### Inventaire de réconciliation préparé en lecture seule

- Configuration/workflow : `.env.example`, `.github/workflows/tradikom-continuity.yml`.
- Continuité : `docs/AGENT_STATE.json`, `docs/AUDIT_TRADIKOM_ONE_OS_ENTRY.md`, `docs/DRIFT_REPORT.md`, `docs/NEXT_STEPS.md`, `docs/RESUME_PROMPT.md`, `docs/ROADMAP_TRADIKOM_ONE_OS.md`, `docs/WORKLOG.md`, `scripts/agent/continuity-check.ts`.
- Dépendances : `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; le lockfile comporte 14 hunks et doit être régénéré après résolution des manifestes.
- Application : `src/lib/db.ts`, `src/lib/environment.ts`, `src/modules/tenants/service.ts`; préserver à la fois les migrations/runtime Meta de la branche et les évolutions tenant de `main`.

## Validation disponible

- Lot Meta : 12 fichiers verts, 65 tests verts et 1 test PostgreSQL/RLS ignoré faute de `DATABASE_URL`.
- Régression sortante Twilio : 5 fichiers et 38 tests verts.
- Suite exhaustive de réconciliation : 132 fichiers et 604 tests verts, 18 tests PostgreSQL ignorés; un test de migration a dépassé l'ancien délai de 5 s de 256 ms sans assertion en échec. Le `testTimeout` global prévu est maintenant de 60 s et le fichier concerné repasse avec 3/3 tests verts.
- Verts : ESLint complet, TypeScript sans cache incrémental, 30 tests de fusion ciblés, build Next.js production, `git diff --check` et contrôle de continuité.
- La preuve PostgreSQL réelle, backup/restauration, RLS et Playwright relève encore de la CI; aucun `DATABASE_URL`, binaire PostgreSQL, Docker, Podman ou Colima n'est disponible localement.

## État de vérité

- Livré localement : flux Meta entrant et sortant durable, tenant-aware, idempotent et fail-closed, avec preuves unitaires/intégration PGlite.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement dans les tests; aucun effet réseau.
- Bloqué humain : toute activation Meta exige compte/app/WABA/numéro autorisé, endpoint HTTPS, secrets en gestionnaire et autorisation explicite.
- Bloqué technique externe : preuve PostgreSQL/RLS complète attendue de la CI après publication du commit de réconciliation.
- Hors périmètre : CRM, Kanban, dashboard secondaire, activation réelle, production, fusion, déploiement et dépense.

## Bloc de reprise exact

```text
1. Se placer uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, y compris tmp/ non suivi.
2. Lire AGENT_STATE, MASTER_PROMPT_REFERENCE, WORKLOG, NEXT_STEPS, DRIFT_REPORT et la mémoire de l'automation.
3. Vérifier PDF, SHA-256, 71 pages et pnpm agent:continuity-check; relire les pages cœur et OS-5 requises.
4. Vérifier branche, head, PR #11 et CI sans reset, clean, stash, changement de branche ou fusion.
5. Le lot Meta est publié sur eec609b et ses handoffs documentaires atteignent 39002dd avant le présent checkpoint; conserver tmp/ hors index.
6. Le commit de réconciliation est prêt localement; le pousser sans force, puis surveiller la CI PostgreSQL/RLS et corriger immédiatement tout défaut attribuable à la fusion ou à OS-5 Meta.
7. Garder Meta disabled/not_configured/mock : aucune clé, client Graph, app, WABA, endpoint public ou message réel.
8. Maintenir tenant/RLS, idempotence, actions durables, audit sans PII et interfaces visibles en français.
9. Mettre à jour les quatre documents avant arrêt. Ne pas fusionner, déployer, dépenser ni demander de secret.
```
