# Drift report

- Date : 3 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head fonctionnel : `232bbb4`
- Travail effectué : audit puis clôture probante d'OS-3 par un manifeste et un runtime de deux capacités génériques strictement mock.

## Impact north star

Un plan confirmé dans la conversation exécute désormais réellement ses deux capacités génériques via le même runtime versionné, au lieu de handlers qui renvoyaient seulement des chaînes fixes. Le résultat reste visible sur web et canal test, durable, idempotent et explicitement mock, sans demander à l'utilisateur de connaître un fournisseur.

## Alignement prompt maître

- Pages consultées : pages 3-7, 15-18, 26-33, 35-38, 46, 48 et 69-71.
- Exigence servie : clore OS-3 au critère de la page 31, soit deux capacités génériques exécutables en mock strict, avec manifeste page 16, plan validé page 17, exécution durable page 18, Definition of Done page 32 et matrice page 69.
- Preuve obtenue : PDF canonique vérifié à 71 pages avec SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; `crm.contacts.search` et `project.task.create` résolues par `tradikom_mock`; tests de validation, sortie, retry, erreurs, compensation, idempotence, absence de réseau et métadonnées sûres; CI `30782705428` et continuité `30782705423` entièrement vertes sur `232bbb4`.
- Écarts restants : le retry du runtime mock est borné mais OS-4 doit encore prouver une reprise de mission après panne ou signal humain sans rejouer une étape réussie. Aucun provider réel ou sandbox n'est connecté; cet écart est explicite et ne bloque pas le critère OS-3 de la page 31.

## Classification honnête

- Livré : OS-1, OS-2 et le runtime OS-3 avec manifeste versionné, deux capacités, preuves workflow, tests et documentation de reprise.
- Réel préparé : frontières protocolaires officielles et sécurité exécutable sans activation.
- Réel connecté : aucun canal ni outil fournisseur.
- Sandbox : aucune configurée, appelée ou revendiquée.
- Mock : `tradikom_mock`, deux capacités génériques, compensation de tâche, canal test et événements/signatures de test.
- Bloqué humain : comptes, credentials, consentements, MFA, endpoints publics, quotas et dépenses.
- Hors périmètre OS-3 : fournisseur externe actif, Temporal réel, OS-5 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/connector-execution/capabilities.ts` et `runtime.ts` pour le manifeste, le provider mock et les erreurs normalisées;
- `src/modules/orchestrator/` pour la validation unique et le passage des entrées bornées au workflow;
- `src/modules/workflows/` pour l'exécution, la persistance de preuve et l'omission des entrées métier dans les métadonnées;
- `tests/capability-runtime.test.ts`, `tests/orchestrator-service.test.ts` et le parcours Conversation Playwright;
- les quatre fichiers de continuité. Aucune migration ni nouvelle table n'a été nécessaire.

## Risques

- la copie iCloud reste un secours instable; la copie active demeure `/Users/TRADIKOM/Developer/TRADIKOM-ONE`;
- `connector-execution/service.ts` conserve le chemin historique d'installation mock en lecture seule; le manifeste OS-3 est la source des capacités conversationnelles et toute convergence future doit éviter une rupture de compatibilité;
- le runtime retente en mémoire mais la reprise durable après panne reste le sujet OS-4;
- l'activation prématurée d'un fournisseur pourrait contourner validation, secrets ou policy; aucun chemin OS-3 ne l'autorise.

## Validations

- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte et 71 pages, pages cœur et OS-3 relues visuellement et textuellement;
- tests ciblés : 12 tests verts sur manifeste, deux capacités, retry temporaire, échec permanent, policy, provider désactivé, compensation, absence de réseau et preuve sûre;
- local : lint, typecheck, build et 95 fichiers/357 tests verts, 13 ignores explicites;
- CI `30782705428` : audit production, migrations PostgreSQL, sauvegarde/restauration, RLS, lint, typecheck, 357 tests, build et Playwright desktop/mobile verts;
- continuité `30782705423` : verte sur `232bbb4`;
- Playwright local : bloqué avant login par deux processus PGlite non partagés; la preuve PostgreSQL CI est passée et fait autorité.

## Prochaine action recommandée

Ouvrir OS-4 par l'audit de la reprise, des signaux, de l'annulation et de l'idempotence dans le moteur et le worker existants, puis choisir une seule lacune durable à prouver sur le plan conversationnel. Aucun fournisseur réel ne doit être branché.
