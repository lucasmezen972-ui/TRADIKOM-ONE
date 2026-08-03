# Drift report

- Date : 3 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head fonctionnel : `dea0eab`
- Travail effectué : premier checkpoint OS-4 avec snapshot immuable de mission, reprise worker et signal de retry dédupliqué.

## Impact north star

Une mission issue de la conversation ne dépend plus d'une définition reconstruite en mémoire ou d'une version active devenue différente. Son exécution conserve la définition exacte validée; après interruption et signal humain, le worker reprend l'étape en échec sans rejouer la capacité déjà réussie. La preuve reste tenant-scoped, auditée et explicitement mock.

## Alignement prompt maître

- Pages consultées : pages 3-7, 17-18, 28, 31-33, 35-36, 46, 48 et 69-71.
- Exigence servie : ouvrir OS-4 au critère de la page 31 (« plan confirmé, exécution multi-step, reprise, idempotence »), avec définition déterministe et signaux humains page 18, Definition of Done page 32, parcours démontrable page 46 et couche workflow obligatoire page 69.
- Preuve obtenue : PDF canonique à 71 pages et SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; migration runtime `075` et miroir SQL `0069`; snapshot borné/immuable sur `workflow_runs`; test d'interruption après la première capacité, double retry humain dédupliqué, reprise worker de la seconde à la tentative 2, une seule première capacité et aucun contenu métier dans `safe_metadata`; parcours navigateur web + canal test + validation + résultat mock sur desktop et mobile.
- Écarts restants : après une reprise worker réussie, le plan conversationnel n'est pas encore automatiquement réconcilié et le message résultat n'est pas encore ajouté sans second appel d'exécution. L'interface Conversation n'expose pas encore ce retry de mission. OS-4 reste donc `in_progress`.

## Classification honnête

- Livré : stockage immuable de la définition pour chaque nouvelle exécution, reprise depuis ce snapshot et déduplication du signal manuel en file.
- Réel préparé : moteur, worker PostgreSQL/PGlite et frontières protocolaires sans activation fournisseur.
- Réel connecté : aucun canal ni outil fournisseur.
- Sandbox : aucune configurée, appelée ou revendiquée.
- Mock : `tradikom_mock`, deux capacités, interruption simulée, reprise worker, canal test et compensation de tâche.
- Bloqué humain : comptes, credentials, consentements, MFA, endpoints publics, quotas et dépenses.
- Hors périmètre du checkpoint : Temporal réel, activation fournisseur, OS-5 à OS-8, fusion et déploiement.

## Modules concernés

- `src/lib/db.ts`, `src/db/migrations/0069_os4_workflow_definition_snapshots.sql` et `src/db/schema/index.ts` pour la migration additive et le snapshot immuable;
- `src/modules/workflows/engine.ts` et `repository.ts` pour la persistance et la résolution de la définition exacte;
- `src/modules/workflows/service.ts` pour le replay idempotent du signal humain;
- `tests/workflow-definition-snapshots-migrations.test.ts` et `tests/workflow-resume.test.ts` pour migration, interruption, reprise et non-rejeu;
- les quatre fichiers de continuité.

## Risques

- les anciennes exécutions sans snapshot gardent le fallback compatible vers la définition active; seules les nouvelles exécutions ont la garantie forte OS-4;
- le snapshot contient les entrées validées de la mission dans la ligne tenant-scoped, mais elles ne sont pas recopiées dans les audits ni dans `safe_metadata`;
- l'état du workflow converge après reprise, mais la projection du plan et du fil doit encore être finalisée automatiquement;
- aucun provider réel ne doit être activé avant que cette convergence, les compensations et la classification des échecs soient prouvées.

## Validations

- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, pages cœur et OS-4 relues textuellement et visuellement;
- tests ciblés : 7 tests verts sur parité SQL, paire snapshot/version, immutabilité, reprise, double signal, non-rejeu et métadonnées sûres;
- local : ESLint ciblé, lint complet, typecheck, suite Vitest complète et build production verts;
- sécurité dépendances : deux alertes hautes préexistantes restent explicitement ignorées par la politique du lockfile; aucune nouvelle dépendance;
- navigateur local : parcours Conversation complet, résultat mock visible, mobile 390×844 sans débordement horizontal;
- CI `30784805475` : audit, migrations PostgreSQL, upgrade, backup/restore, RLS, lint, typecheck, 98 fichiers/373 tests, build et 20 scénarios Playwright verts; continuité `30784805450` verte sur `dea0eab`.

## Prochaine action recommandée

Rendre la finalisation de mission conversationnelle réutilisable depuis le worker, réconcilier les statuts du plan avec les étapes workflow et publier exactement un message résultat après reprise. Ne brancher aucun fournisseur réel.
