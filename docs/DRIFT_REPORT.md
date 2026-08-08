# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `d9afa82`
- Commit fonctionnel : `720db0e`
- Travail effectué : autorisation d'activation WhatsApp/Twilio durable, tenant-aware et auditée, sans activation externe.

## Impact north star

Le chemin Conversation -> WhatsApp ne dépend plus d'un objet d'autorisation fourni librement : il exige une preuve interne, durable et révocable avant toute future composition réelle. La validation humaine devient vérifiable et reprise après panne, sans exposer la complexité au professionnel. Aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 35-37, 64, 66 et 69 : provider sans logique métier, preuve humaine durable, endpoint tenant-aware, relations composites/RLS, idempotence, audit sans PII, expiration/révocation, états honnêtes et zéro réseau avant les gardes.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; migrations runtime `083`/`084` identiques aux miroirs SQL `0077`/`0078`; table sans secret avec RLS et révocation monotone; service owner/administrator, replay et collision; loader tenant/endpoint-scoped; readiness par `authorizationId` uniquement; état maximal `degraded`; 3 fichiers/21 tests ciblés, 24 fichiers/145 tests canaux et suite complète mono-worker 110 fichiers/459 tests; audit, lint, typecheck, build et diff check verts.
- Écarts restants : consommation atomique du plafond par livraison, gestionnaire de secrets concret, promotion runtime explicitement autorisée, Sandbox, endpoint public et preuve réelle web + WhatsApp. Les tests PostgreSQL/RLS et Playwright locaux restent non exécutables sans PostgreSQL partagé; la CI du commit publié doit les confirmer. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker, callbacks, coffre, résolveurs éphémères, bootstrap keyring, fabrique SDK, readiness, autorisation persistée et runbook.
- Réel préparé : inbound signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel réseau.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique de test; canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire, endpoint HTTPS temporaire et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/channels/whatsapp-twilio-activation-authorization-service.ts` : émission, replay, révocation, audit et loader tenant-aware;
- `src/modules/channels/whatsapp-twilio-activation-authorization-repository.ts` : requêtes tenant/endpoint-scoped;
- `src/modules/channels/whatsapp-twilio-readiness.ts` : chargement par référence interne et états fail-closed;
- migrations `083`/`084`, miroirs SQL `0077`/`0078`, tests migration/service/RLS/readiness et runbook opérateur.

## Risques

- `max_messages` est persisté mais pas encore consommé atomiquement par une livraison; le registre désactivé empêche tout effet réel dans cet intervalle.
- Aucun gestionnaire de secrets concret n'est choisi ou connecté; toutes les valeurs de preuve restent factices.
- L'état `ready` est prouvé uniquement avec un manifeste synthétique de test; le registre réel n'émet que `disabled`, `not_configured` ou `awaiting_human_auth` et aboutit au plus à `degraded`.
- Un message externe déjà remis ne serait pas annulable; le runbook ne promet que l'arrêt des effets futurs.

## Validations

- `pnpm agent:continuity-check` initial : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31280628366` et continuité `31280628367` vertes sur `d9afa82`;
- local ciblé : 3 fichiers/21 tests verts; régression canaux/WhatsApp 24 fichiers/145 tests, 3 tests PostgreSQL ignorés sans `DATABASE_URL`;
- local exhaustif : 110 fichiers/459 tests verts en mono-worker, 5 fichiers et 16 tests PostgreSQL ignorés; le mode parallèle reproduit le silence PGlite connu sans assertion en échec;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production et diff check verts;
- navigateur local : non probant, abort PGlite pendant la migration du serveur de développement; aucune interface visible modifiée et Playwright PostgreSQL CI requis;
- distant fonctionnel : en attente de publication et de CI pour `720db0e`.

## Prochaine action recommandée

Rendre le plafond d'autorisation consommable atomiquement par livraison et idempotent sous retry, sans promouvoir le provider vers `ready`. Ne créer ni Sandbox, credential réel, endpoint public ni message réel avant le checkpoint humain de `docs/OS5_PROVIDER_SELECTION.md`.
