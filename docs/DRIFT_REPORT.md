# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `eaa1c44`
- Commit fonctionnel : `1bdc5c4`
- Travail effectué : readiness WhatsApp/Twilio, composition d'activation fail-closed et runbook opérateur, sans activation externe.

## Impact north star

Le chemin Conversation -> WhatsApp dispose désormais d'un verdict de santé explicite avant toute résolution sensible : configuration absente, référence invalide, intervention humaine attendue ou transport volontairement dégradé. La complexité d'activation reste derrière la frontière provider; aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 35-37, 64, 66 et 69 : adaptateur sans logique métier, endpoint tenant-aware, provider désactivé sans clés, secrets référencés et non exposés, autorisation humaine bornée, zéro réseau avant les gardes, procédure réversible et preuves unit/provider/sécurité.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; readiness stricte sur manifeste, références versionnées, endpoint/tenant, URLs HTTPS et autorisation Sandbox expirante/plafonnée; sorties françaises sans valeur sensible; états préparés refusés avant secret manager, keyring, résolveurs, client et fetch; registre toujours `transportEnabled: false`; runbook activation/rotation/révocation/désactivation/rollback; 5 fichiers/45 tests ciblés, 19 fichiers/133 tests de régression et suite locale complète mono-worker 108 fichiers/447 tests, audit, lint, typecheck, build, continuité et diff check verts.
- Écarts restants : autorisation durable tenant/RLS/audit, gestionnaire de secrets concret, promotion runtime explicitement autorisée, Sandbox, endpoint public et preuve réelle web + WhatsApp. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker, callbacks, coffre, résolveurs éphémères, bootstrap keyring, fabrique SDK, readiness, composition fail-closed et runbook.
- Réel préparé : inbound signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel réseau.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique de test; canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire, endpoint HTTPS temporaire et autorisation d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/modules/channels/whatsapp-twilio-readiness.ts` : verdict sûr et composition seulement après un futur manifeste explicitement `ready`;
- `src/modules/channels/channel-provider-secrets-bootstrap.ts` : inspection déclarative des références sans résolution;
- `docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md` : procédure humaine et technique réversible;
- tests readiness, bootstrap, registre, client et transport.

## Risques

- L'autorisation est encore une structure d'entrée typée et n'est pas persistée; elle ne peut pas activer le registre actuel, mais doit devenir une preuve interne tenant-aware et auditée avant toute promotion future.
- Aucun gestionnaire de secrets concret n'est choisi ou connecté; toutes les valeurs de preuve restent factices.
- L'état `ready` est prouvé uniquement avec un manifeste synthétique de test; le registre réel n'émet que `disabled`, `not_configured` ou `awaiting_human_auth` et aboutit au plus à `degraded`.
- Un message externe déjà remis ne serait pas annulable; le runbook ne promet que l'arrêt des effets futurs.

## Validations

- `pnpm agent:continuity-check` initial/final : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31260509720` et continuité `31260509739` vertes sur `eaa1c44`;
- local ciblé : 5 fichiers/45 tests verts; régression canaux/WhatsApp 19 fichiers/133 tests, 2 PostgreSQL ignorés sans `DATABASE_URL`;
- local exhaustif : 108 fichiers/447 tests verts en mono-worker, 4 fichiers et 15 tests ignorés sans PostgreSQL; le mode parallèle reproduit le silence PGlite connu sans assertion en échec;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production, continuity-check et diff check verts;
- distant fonctionnel : continuité `31279987339` verte; CI PostgreSQL `31279987333` verte en 14 min 25 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 112 fichiers/463 tests, build production et 20/20 Playwright; PR #11 brouillon, fusionnable et `CLEAN`.
- navigateur : aucune interface visible modifiée; les 20 scénarios Playwright PostgreSQL du commit fonctionnel sont verts.

## Prochaine action recommandée

Persister l'autorisation d'activation comme preuve tenant-aware, expirante, révocable et auditée, puis la faire charger par la readiness. Ne promouvoir aucun provider vers `ready` et ne créer ni Sandbox, credential réel, endpoint public ni message réel avant le checkpoint humain de `docs/OS5_PROVIDER_SELECTION.md`.
