# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `fe46bf5`
- Commit fonctionnel audité : `9241b88`
- Travail effectué : worker durable des livraisons WhatsApp sortantes, avec doubles uniquement et sans activation externe.

## Impact north star

Une réponse issue de la conversation peut maintenant survivre à une interruption ou une erreur temporaire sans perdre son identité, sa policy ni sa preuve. La reprise reste derrière le service borné et `ChannelAdapter`; aucune interface CRM, Kanban ou dashboard secondaire n'a été ajoutée.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 18, 22, 28-29, 31-32, 64, 66 et 69 : action externe durable, idempotence stable, retry borné, lease, tenant/RLS, policy et membership réévalués, erreurs normalisées, fournisseur honnêtement désactivé et audit sans secret ni PII.
- Preuve obtenue : PDF de 71 pages au SHA-256 exact; migration runtime `078` et miroir SQL `0072`; maximum immuable, lease concurrente et expirée, backoff exponentiel borné; sélection exclusive `reserved`/`temporary`/`rate_limit`; même clé d'idempotence et un seul effet mock après réponse perdue; non-rejeu terminal; message canonique réconcilié; audits sûrs; 26 tests ciblés puis 15 fichiers/83 tests canaux-conversation verts; audit, lint, typecheck et build locaux verts; continuité `31247035021` et CI PostgreSQL `31247035022` vertes avec migrations, backup/restauration, RLS, 103 fichiers/401 tests, build et 20 Playwright.
- Écarts restants : le callback de statut Twilio, le secret manager, la résolution chiffrée du destinataire, la sandbox, l'endpoint public et la preuve réelle web + WhatsApp restent absents. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : réservation outbound, worker avec lease/backoff/tentatives, policy/membership, audit sûr, réconciliation et tests mock.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound durable prêt à recevoir un transport réel après les garde-fous restants.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport outbound injecté, réponses perdues et retries simulés, canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS temporaire et autorisation d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/db/migrations/0072_os5_channel_provider_delivery_retries.sql` et `src/lib/db.ts` : lease, tentatives, échéance, contraintes et index tenant-leading;
- `src/modules/channels/whatsapp-twilio-outbound-repository.ts` : sélection due, claim atomique et finalisation sous lease;
- `src/modules/channels/whatsapp-twilio-outbound-service.ts` : tentative durable, policy, backoff, audit et réconciliation;
- `src/modules/channels/whatsapp-twilio-outbound-worker.ts` : boucle tenant-aware bornée;
- tests migration, PostgreSQL/RLS, service et worker, plus les quatre fichiers de continuité.

## Risques

- La garantie d'un seul effet après une réponse fournisseur ambiguë est prouvée avec un double idempotent. Une activation Twilio réelle devra borner le timeout sous la lease et documenter la stratégie de réconciliation, car le provider ne doit jamais être présenté comme exactement-once sans preuve officielle.
- Les callbacks de livraison ne sont pas encore ingérés; `delivered` ne peut donc pas être confirmé par Twilio.
- La destination n'est volontairement pas stockée en clair; l'activation exigera une résolution chiffrée et révocable dans un gestionnaire de secrets.
- La suite Vitest complète bloque silencieusement localement. Playwright local sans PostgreSQL partagé ne partage pas les fixtures avec le serveur; la CI Linux/PostgreSQL reste l'autorité exhaustive.

## Validations

- `pnpm agent:continuity-check` initial : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31245459338` et continuité `31245459354` vertes sur `fe46bf5`;
- local ciblé : 26 tests, puis 15 fichiers/83 tests verts et 1 test PostgreSQL/RLS ignoré sans `DATABASE_URL`;
- local statique : audit production sans vulnérabilité connue, lint, typecheck, build production et diff check verts;
- local exhaustif : Vitest complet bloqué silencieusement et Playwright non probant sans base PostgreSQL partagée; cette limite locale est compensée par la CI PostgreSQL `31247035022`, verte sur 103 fichiers/401 tests, build production et 20/20 scénarios Playwright;
- GitHub final du commit fonctionnel : continuité `31247035021` verte et CI `31247035022` verte en 10 min 41 s sur `9241b88`.

## Prochaine action recommandée

Implémenter les callbacks de statut Twilio signés, dédupliqués et monotones vers la livraison et le message canoniques avec doubles uniquement. Ne créer ni sandbox, credential, endpoint public ni message réel avant l'autorisation humaine de `docs/OS5_PROVIDER_SELECTION.md`.
