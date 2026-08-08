# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `4a6a908`
- Commit fonctionnel : `9c7e4db`
- Travail effectué : coffre fournisseur chiffré, versionné, rotatif et révocable derrière les résolveurs Twilio, sans activation externe.

## Impact north star

Une réponse approuvée dans la conversation peut désormais résoudre éphémèrement credentials, sender et destination depuis des références tenant-scoped, puis atteindre le transport durable sans exposer ces valeurs au cœur. La tranche reste strictement Conversation -> WhatsApp -> preuve; aucun CRM, Kanban ou dashboard secondaire n'a été ajouté.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 14, 18, 22, 26, 28-29, 31-32, 37, 64, 66 et 69 : adaptateur sans logique métier, exécution durable après membership/policy, credentials chiffrés et rotatifs, références tenant/RLS, résolution éphémère, idempotence, révocation, audit sans PII et provider fail-closed sans clés.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; migrations runtime `081`/`082` et miroirs SQL `0075`/`0076`; coffre AES-256-GCM avec AAD tenant/provider/endpoint/identité/scope/version; clé active injectable de 256 bits; une seule version active; rotation idempotente avec conflit de payload refusé; révocation monotone; relations composées et RLS; suppression tenant en cascade; résolveurs actifs uniquement pour endpoint/identité valides; intégration au transport `mock`; audits et sorties sans valeur sensible.
- Écarts restants : fabrique du client Twilio officiel, bootstrap serveur du keyring depuis le gestionnaire de secrets, procédure de santé/activation, Sandbox, endpoint public et preuve réelle web + WhatsApp. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker lease/backoff, callbacks monotones, frontière client/résolveurs et coffre chiffré/rotatif tenant-aware.
- Réel préparé : inbound WhatsApp signé/tenant-mappé et chaîne outbound jusqu'au contrat client avec secrets chiffrés, sans fabrique officielle branchée.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : keyring, résolveurs, client et réponses Twilio injectés; canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS temporaire et autorisation d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/db/migrations/0075_os5_channel_provider_secret_versions.sql` et `0076...rls.sql` : versions de secrets, relations composées, index tenant-leading, contraintes, immutabilité et RLS;
- `src/modules/channels/channel-provider-secrets-crypto.ts` : keyring injecté et chiffrement authentifié lié au contexte;
- `src/modules/channels/channel-provider-secrets-repository.ts` : rotations, révocations et lectures actives tenant-scoped;
- `src/modules/channels/channel-provider-secrets-service.ts` : gardes administrateur, idempotence, audits sûrs et résolveurs Twilio éphémères;
- tests crypto, migrations, service, intégration transport et PostgreSQL/RLS.

## Risques

- Les valeurs claires existent nécessairement en mémoire pendant la construction de la requête; JavaScript ne permet pas de garantir leur effacement immédiat. Elles ne sont ni persistées ailleurs, ni auditées, ni retournées.
- Le keyring est injecté et testé avec des clés factices; aucun bootstrap de production depuis un gestionnaire de secrets n'est encore branché.
- Le client reste une interface injectée. Le package officiel Twilio est présent pour les vérifications de signature mais aucune fabrique d'envoi réelle n'est sélectionnée.
- La suite Vitest monolithique locale subit les timeouts PGlite déjà connus sous forte concurrence. Les lots ciblés passent; le test worker concerné passe avec un délai local élargi et la CI Linux/PostgreSQL reste l'autorité exhaustive.

## Validations

- `pnpm agent:continuity-check` initial/final : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31251342770` et continuité `31251342758` vertes sur `4a6a908`;
- local ciblé : 3 fichiers/11 tests coffre verts; 6 fichiers/37 tests provider verts avec 1 PostgreSQL/RLS ignoré sans `DATABASE_URL`;
- régression canaux/conversation : 20 fichiers/120 tests verts et 2 PostgreSQL/RLS ignorés sans `DATABASE_URL`;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production, continuité et diff check verts;
- exhaustif local : timeouts sans assertion métier sur le worker WhatsApp et trois tests email sous forte concurrence; les tests email ciblés passent et le test worker passe seul avec `--testTimeout=15000`;
- GitHub fonctionnel : continuité `31257937592` verte; CI PostgreSQL `31257937598` verte en 14 min 22 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 109 fichiers/439 tests, build et 20/20 Playwright. La PR #11 est brouillon, fusionnable et `CLEAN`.

## Prochaine action recommandée

Ajouter une fabrique bornée du client officiel Twilio et un bootstrap serveur du keyring versionné depuis des références de secret manager. Conserver le registre réel fail-closed et ne créer ni Sandbox, credential réel, endpoint public ni message réel avant l'autorisation humaine de `docs/OS5_PROVIDER_SELECTION.md`.
