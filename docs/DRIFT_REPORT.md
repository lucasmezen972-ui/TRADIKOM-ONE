# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11, état `CLEAN`
- Head fonctionnel : `d2f920e`
- Travail effectué : clôture OS-4 avec convergence automatique de la reprise worker dans la conversation et correction des advisories transitifs bloquant la CI.

## Impact north star

Une mission interrompue peut désormais être reprise depuis la Conversation par un signal humain idempotent. Le worker repart du snapshot exact, ne rejoue pas la capacité déjà réussie, réconcilie le plan avec les preuves durables puis publie le résultat une seule fois dans le fil web et canal test. L'utilisateur n'a ni second clic d'exécution, ni écran workflow séparé à comprendre.

## Alignement prompt maître

- Pages consultées : pages 3-7, 17-18, 28, 31-33, 35-36, 46, 48 et 69-71, relues textuellement et dans le rendu direct du PDF.
- Exigence servie : clôturer OS-4 selon la page 31 (« plan confirmé, exécution multi-step, reprise, idempotence »), rendre l'état et le signal humain visibles dans la conversation selon la page 18, satisfaire la Definition of Done page 32, le parcours démontrable page 46 et la matrice workflow/Playwright page 69.
- Preuve obtenue : PDF canonique de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; finalisation atomique commune au chemin synchrone et au worker; test vertical sur vrai plan Conversation avec interruption de la seconde capacité, double retry dédupliqué, reprise à la tentative 2, première capacité exécutée une fois, deux étapes réconciliées, un résultat, deux routes, audits uniques sans contenu métier et aucun réseau; parcours Chromium mobile sans débordement; CI PostgreSQL `31240188121` et continuité `31240188120` vertes.
- Écarts restants : les anciennes exécutions antérieures au snapshot gardent leur fallback compatible; aucun provider réel ou sandbox n'est encore connecté; Temporal réel n'est pas déployé. Ces écarts relèvent d'OS-5 ou d'une évolution ultérieure, pas du critère OS-4 prouvé.

## Classification honnête

- Livré : OS-4 complet, incluant snapshot immuable, reprise worker, signal de retry conversationnel, réconciliation, résultat miroir et audit idempotent.
- Réel préparé : moteur PostgreSQL/PGlite et frontières Resend, WhatsApp/Twilio, Teams et Slack, toutes fail-closed.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée, appelée ou revendiquée.
- Mock : `tradikom_mock`, deux capacités, compensation, canal test et interruption/reprise simulée.
- Bloqué humain : comptes fournisseurs, credentials, MFA, consentements OAuth, domaines/endpoints publics, quotas et dépenses.
- Hors périmètre : OS-6 à OS-8, fusion, déploiement et tout effet externe irréversible.

## Modules concernés

- `src/modules/orchestrator/service.ts` et `repository.ts` : finalisation atomique, réconciliation et retry tenant-aware;
- `src/modules/workflows/worker.ts` : convergence après `workflow.resume`;
- `src/modules/channels/runtime.ts` et `src/app/(app)/conversation/*` : signal et états visibles en français;
- `tests/orchestrator-service.test.ts` et `tests/e2e/vertical.spec.ts` : preuve verticale et visibilité mobile;
- `pnpm-workspace.yaml` et `pnpm-lock.yaml` : versions transitives corrigées;
- les quatre fichiers de continuité.

## Risques

- le worker et la finalisation utilisent deux transactions successives; si la seconde échoue, le retry de l'événement terminal relance uniquement la finalisation idempotente, comportement couvert par la sélection du `runId` dans le payload;
- l'interface de retry n'est visible que pour une mission réellement `failed`; elle ne fabrique aucun état d'échec et le parcours navigateur heureux ne simule pas une panne;
- `exceljs` conserve des sous-dépendances historiques dépréciées, mais les versions vulnérables de `brace-expansion` sont remplacées par des backports compatibles et l'audit actif est propre;
- aucun provider ne doit passer à `ready` tant qu'OS-5 n'a pas prouvé sandbox/réel, clés, consentement, webhook, santé et désactivation.

## Validations

- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, pages cœur et OS-4 relues textuellement et visuellement;
- ciblé : 10 tests orchestrateur/reprise verts, ESLint ciblé et typecheck;
- local complet : lint, 96 fichiers / 361 tests verts / 13 ignores, build production;
- sécurité : `pnpm audit --prod --audit-level high` retourne « No known vulnerabilities found » après les overrides exacts;
- navigateur local : parcours compte → organisation → web → canal test → plan → validation → résultat mock à 390x844, deux étapes « Réussie », zéro débordement horizontal;
- CI `31240188121` : audit, migrations PostgreSQL, upgrade, backup/restauration, RLS, lint, typecheck, 361 tests, build et Playwright verts;
- continuité `31240188120` verte sur `d2f920e`; PR #11 propre.

## Prochaine action recommandée

Ouvrir OS-5 par un audit sans activation des quatre frontières préparées et sélectionner un seul provider sandbox à coût nul. Produire le bloc humain exact si compte, MFA, consentement, clé, domaine ou endpoint public est requis; ne jamais présenter `mock` ou `not_configured` comme réel.
