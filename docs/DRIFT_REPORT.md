# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `fa9a0e5`
- Commit fonctionnel : `f0acdfb`
- Travail effectué : garde outbound qui impose la consommation durable du budget d'autorisation avant tout futur transport WhatsApp `ready`, sans activation externe.

## Impact north star

Le chemin Conversation -> WhatsApp applique désormais réellement le plafond humain : policy d'abord, consommation durable ensuite, transport enfin. Le professionnel n'a pas à retransmettre l'autorisation lors d'une reprise; le worker la retrouve par la livraison, sans double unité ni double audit. Une autorisation absente, expirée ou révoquée arrête l'action avant toute I/O. Aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues directement dans le PDF canonique en texte et en rendu.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 35-37, 64, 66 et 69 : provider borné sans logique métier, policy avant action, effet durable/idempotent, tenant/RLS, quota humain, erreurs classifiées, audit sans PII, états honnêtes et preuve provider/sécurité/Playwright.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; le manifeste `ready` synthétique consomme après policy et avant `adapter.sendMessage`; l'`authorization_id` initial reste interne puis est retrouvé par `delivery_id`; retry worker sans seconde unité ni second audit; absence, expiration et révocation finalisées en refus policy avant transport; mock inchangé et registre réel incapable de produire `ready`. Les tests ciblés passent 2 fichiers/16 tests, la régression canaux 41 fichiers/192 tests, et l'exhaustif local en lots 118 fichiers/471 tests avec 17 tests PostgreSQL ignorés sans base locale. Audit, lint, typecheck, build, continuity-check et diff check sont verts. La continuité `31289096474` et la CI PostgreSQL `31289096477` sont vertes; la CI valide 118 fichiers/488 tests et 20/20 Playwright.
- Écarts restants : aucun gestionnaire de secrets concret, compte Twilio, téléphone vérifié, Sandbox, endpoint HTTPS public ou message fournisseur n'est connecté. La preuve réelle web + WhatsApp, la désactivation post-preuve et le succès OS-5 page 31 restent bloqués par autorisation humaine.

## Classification honnête

- Livré : outbound durable, worker, callbacks, coffre, résolveurs éphémères, bootstrap keyring, fabrique SDK, readiness, autorisation persistée, consommation atomique et garde outbound obligatoire du plafond, runbook.
- Réel préparé : inbound signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel réseau.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique de test; consommations en base de test prouvant l'ordre policy -> budget -> transport, canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire, endpoint HTTPS temporaire et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/channels/whatsapp-twilio-outbound-service.ts` : garde `ready`, finalisation sûre et contrat interne du premier `authorization_id`;
- `src/modules/channels/whatsapp-twilio-activation-budget-service.ts` : récupération de l'autorisation existante par `delivery_id`, validation temporelle et replay sans nouvel effet;
- `tests/whatsapp-twilio-outbound-service.test.ts` : ordre policy/budget/transport, retry worker, absence, expiration, révocation et audit unique;
- migrations/runtime et tests PostgreSQL/RLS existants inchangés, réutilisés par la garde.

## Risques

- Le budget est imposé pour `ready`, mais ce statut n'existe que dans les tests tant que le checkpoint humain n'est pas autorisé.
- Aucun gestionnaire de secrets concret n'est choisi ou connecté; toutes les valeurs de preuve restent factices.
- L'état `ready` est prouvé uniquement avec un manifeste synthétique de test; le registre réel n'émet que `disabled`, `not_configured` ou `awaiting_human_auth` et aboutit au plus à `degraded`.
- Un message externe déjà remis ne serait pas annulable; le runbook ne promet que l'arrêt des effets futurs.
- GitHub Actions avertit que `pnpm/action-setup@v4` repose encore sur le runtime d'action Node 20 forcé vers Node 24; le run reste vert, mais la maintenance du workflow devra suivre l'évolution officielle de l'action.

## Validations

- `pnpm agent:continuity-check` initial et final : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31287278806` et continuité `31287278798` vertes sur `fa9a0e5`;
- local ciblé : 2 fichiers/16 tests verts, avec ordre policy -> consommation -> transport et reprise worker;
- local canaux : 41 fichiers/192 tests verts, 5 suites PostgreSQL ignorées sans `DATABASE_URL`;
- local exhaustif : 118 fichiers/471 tests verts en six lots mono-worker, 6 fichiers et 17 tests PostgreSQL ignorés faute de base locale;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production et diff check verts;
- navigateur local : aucune interface visible modifiée; la preuve Playwright PostgreSQL du nouveau head est confiée à la CI distante, le runtime local PGlite ne partageant pas les fixtures entre Playwright et le serveur;
- distant fonctionnel : commit `f0acdfb` poussé; continuité `31289096474` verte; CI PostgreSQL `31289096477` verte en 15 min 25 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 118 fichiers/488 tests, build production et 20/20 Playwright; PR #11 `CLEAN`.

## Prochaine action recommandée

Attendre le checkpoint humain exact de `docs/OS5_PROVIDER_SELECTION.md` et `docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md`. Après autorisation seulement : configurer l'essai/Sandbox et le gestionnaire de secrets, émettre au plus deux unités gratuites, exécuter la preuve bidirectionnelle réelle, puis désactiver et révoquer. Ne sélectionner aucune tâche CRM, Kanban, dashboard ou OS-6 pendant ce blocage.
