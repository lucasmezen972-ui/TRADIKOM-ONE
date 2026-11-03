# Rapport de validation OS-1 — Conversation Hub canonique

- Date : 30 juillet 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head validé : `95da35e0da89bed9c60ea5b8b0d94a6c7c14d8ac`
- CI : run `30554462472`, vert en 10 min 37 s
- Continuité : run `30554462620`, vert en 22 s
- Source normative : prompt maître PDF, pages 10-18, 22, 24, 31-33, 46, 48 et 69-71

## Résultat démontrable

Un propriétaire de tenant peut ouvrir un fil depuis le web, recevoir une réponse du canal de test, préparer un plan immuable de deux capacités mock, le valider une seule fois, exécuter ses étapes dans le moteur durable existant et relire un résultat canonique routé vers les deux canaux.

Le parcours ne nécessite aucune clé, ne déclenche aucun transport réseau, ne crée aucune tâche CRM réelle et conserve tenant, provenance, fingerprint, approbation, run, étapes, routes et audit.

## Definition of Done — page 32

| Exigence | Preuve | État |
| --- | --- | --- |
| État du dépôt audité et enregistré | `AUDIT_TRADIKOM_ONE_OS_ENTRY.md`, état, worklog et drift report versionnés | Conforme |
| Migrations additives, tenant-scoped et RLS | migrations runtime 067-070, miroirs SQL 0061-0064, relations tenant-composées et index tenant-leading | Conforme |
| Base vide et base déjà migrée | étapes CI `Verify migrations` et `Verify backup and restore` vertes | Conforme |
| Tests unitaires, intégration, PostgreSQL/RLS et Playwright | 234 tests verts, build vert et Playwright vert dans `30554462472` | Conforme |
| Fournisseurs sans clé désactivés et explicites | web/test/orchestrateur en `mock`, aucun appel fournisseur, `fetch` interdit par test | Conforme |
| Aucun comportement production fictif | badges « Aucun fournisseur externe », « Mock local » et « Aucun effet externe » | Conforme |
| Idempotence, audit et classification | ingestion, plan, décision et exécution rejouables; audits sûrs; échec classé `mock_workflow_failed` | Conforme |
| Policy et validation des actions sensibles | catalogue borné, scopes/roles vérifiés, validation unique avant exécution | Conforme |
| Continuité web + adaptateur de test | même fil canonique, deux identités et routes persistées | Conforme |
| Pas d'interface mobile coupée | parcours Playwright en 1440×900 et 390×844 | Conforme |
| État de reprise à jour | `AGENT_STATE.json`, `WORKLOG.md`, `NEXT_STEPS.md`, `DRIFT_REPORT.md` | Conforme |

## Matrice de tests — page 69

| Couche | Fichiers ou preuve | État |
| --- | --- | --- |
| Unit : schémas, policies, catalogue | `orchestrator-schemas`, `orchestrator-capabilities`, `conversation-hub-schemas` | Vert |
| Intégration : message → plan → décision → exécution | `orchestrator-service.test.ts`, `conversation-hub-service.test.ts` | Vert |
| RLS : lecture/écriture inter-tenant refusée | `postgres-rls.test.ts` et cas tenant du service | Vert |
| Workflow : reprise, annulation, retry, idempotence | suite workflows existante et replay du run Conversation | Vert |
| Provider mock : non configuré, temporaire, permanent | aucun provider requis en OS-1; suites connecteurs/email existantes restent vertes | Vert, sans provider réel |
| Sécurité : injection, secret, replay | test d'injection comme donnée, rejet des clés sensibles, HMAC/replay et audits redacted | Vert |
| Playwright : chat web mobile/desktop | parcours Conversation dédié sur deux viewports | Vert |
| Accessibilité : clavier et labels | labels explicites; préparation, approbation et exécution activées par Entrée | Vert |

## Preuves d'idempotence et d'absence d'effet externe

- un plan, deux étapes et une approbation par fingerprint;
- une décision unique, replay identique accepté et décision opposée refusée;
- un événement, un workflow run, deux workflow steps et un résultat malgré le replay;
- deux routes de résultat : `web-chat` et `test-channel`;
- zéro appel `fetch` et zéro ligne `tasks` créée par l'exécution mock;
- audits sans texte client, motif de décision, credential ni secret.

## Limites conservées

- aucun fournisseur réel n'est activé; cette activation reste soumise aux clés, consentements et environnements autorisés;
- aucun merge, déploiement de production, changement DNS ou dépense n'a été effectué;
- le serveur Next.js local reste bloqué avant ouverture du port sur cette machine; la preuve navigateur exécutable vient de la CI avec traces/captures retenues uniquement en cas d'échec;
- les canaux WhatsApp, Teams, Slack et email feature-flaggés appartiennent à OS-2.

## Décision de passage

OS-1 satisfait le critère de sortie de la roadmap et la Definition of Done de la page 32. OS-2 peut être ouvert, sans relâcher les contraintes de simulation explicite, de RLS, d'audit, d'idempotence et d'absence de fournisseur sans configuration.
