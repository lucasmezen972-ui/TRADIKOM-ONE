# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `08abdbd`
- Commit fonctionnel : `b561ac0`
- Travail effectué : consommation atomique et idempotente du budget d'autorisation WhatsApp/Twilio par livraison, sans activation externe.

## Impact north star

Le chemin Conversation -> WhatsApp possède désormais une garde durable qui transforme le plafond humain d'un ou deux messages en unités réellement réservables par livraison. Le professionnel n'a pas à gérer le comptage, les retries ou la concurrence : le système rejoue la même preuve sans double consommation et refuse tout dépassement avant un futur transport. Aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues directement dans le PDF canonique en texte; pages cœur et pages techniques 14, 17-18, 22, 26, 28-29, 35-37, 64 et 66 inspectées aussi dans leurs rendus.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 35-37, 64, 66 et 69 : action durable avant I/O, idempotence de retry, quota et policy, relations composites/RLS, provider sans logique métier, audit sans PII, expiration/révocation, états honnêtes et tests PostgreSQL/provider/sécurité.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; migrations runtime `085`/`086` identiques aux miroirs SQL `0079`/`0080`; table de consommation sans donnée provider sensible, relations composites, verrou atomique, immutabilité, index tenant-leading et RLS; service tenant-aware avec endpoint actif, budget 1/2, replay par `delivery_id`, expiration/révocation et audit unique; 4 fichiers/15 tests ciblés, régression canaux 34 fichiers/198 tests et suite complète mono-worker 112 fichiers/467 tests; audit, lint, typecheck, build, continuity-check et diff check verts. La continuité distante `31286816855` et la CI PostgreSQL `31286816871` sont vertes; cette dernière valide 118 fichiers/484 tests et 20/20 Playwright.
- Écarts restants : la consommation n'est pas encore imposée par le chemin outbound juste avant le transport futur `ready`; aucun gestionnaire de secrets concret n'est connecté; la promotion runtime, la Sandbox, l'endpoint public et la preuve réelle web + WhatsApp restent absents. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker, callbacks, coffre, résolveurs éphémères, bootstrap keyring, fabrique SDK, readiness, autorisation persistée, consommation atomique du plafond et runbook.
- Réel préparé : inbound signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel réseau.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique de test; consommations en base de test, canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire, endpoint HTTPS temporaire et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/channels/whatsapp-twilio-activation-budget-service.ts` : membership, validation, plafond, replay et audit sûr;
- `src/modules/channels/whatsapp-twilio-activation-budget-repository.ts` : verrou de l'autorisation, contexte livraison/endpoint et comptage tenant-scoped;
- migrations runtime `085`/`086` et miroirs SQL `0079`/`0080` : relations composites, trigger atomique, immutabilité et RLS;
- tests migration vide/upgrade/parité, service, régression autorisation et PostgreSQL concurrence/RLS.

## Risques

- Le budget est atomique mais son service n'est pas encore appelé automatiquement par le chemin outbound; le registre désactivé empêche tout effet réel dans cet intervalle.
- Aucun gestionnaire de secrets concret n'est choisi ou connecté; toutes les valeurs de preuve restent factices.
- L'état `ready` est prouvé uniquement avec un manifeste synthétique de test; le registre réel n'émet que `disabled`, `not_configured` ou `awaiting_human_auth` et aboutit au plus à `degraded`.
- Un message externe déjà remis ne serait pas annulable; le runbook ne promet que l'arrêt des effets futurs.
- GitHub Actions avertit que `pnpm/action-setup@v4` repose encore sur le runtime d'action Node 20 forcé vers Node 24; le run reste vert, mais la maintenance du workflow devra suivre l'évolution officielle de l'action.

## Validations

- `pnpm agent:continuity-check` initial : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon et fusionnable; CI `31285823091` et continuité `31285823086` vertes sur `08abdbd`;
- local ciblé : 4 fichiers/15 tests verts; le test PostgreSQL de concurrence/RLS est compilé et ignoré sans `DATABASE_URL`;
- local canaux : 34 fichiers/198 tests verts, 4 suites PostgreSQL ignorées sans `DATABASE_URL`;
- local exhaustif : 112 fichiers/467 tests verts en mono-worker, 6 fichiers et 17 tests PostgreSQL ignorés faute de base locale;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production et diff check verts;
- navigateur local : aucune interface visible modifiée; la preuve Playwright reste portée par la CI PostgreSQL;
- distant fonctionnel : commit `b561ac0` poussé; continuité `31286816855` verte; CI PostgreSQL `31286816871` verte en 11 min 33 s avec audit, migrations, backup/restauration, RLS et concurrence, lint, typecheck, 118 fichiers/484 tests, build production et 20/20 Playwright.

## Prochaine action recommandée

Imposer la réservation de budget dans le chemin outbound après membership/contexte/policy et juste avant tout futur transport `ready`, puis retrouver la même consommation lors des retries worker. Conserver le registre réel désactivé et ne créer ni Sandbox, credential réel, endpoint public ni message réel avant le checkpoint humain de `docs/OS5_PROVIDER_SELECTION.md`.
