# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `45a912d`
- Commit fonctionnel audité : `65176fb`
- Travail effectué : callbacks de statut Twilio signés, dédupliqués et monotones, avec doubles uniquement et sans activation externe.

## Impact north star

Une réponse envoyée depuis la conversation peut désormais recevoir une preuve de livraison tardive et faire converger le message canonique sans doublon ni régression. Le travail reste dans la verticale Conversation -> WhatsApp -> preuve; aucune interface CRM, Kanban ou dashboard secondaire n'a été ajoutée.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : pages 14, 18, 22, 28-29, 31-32, 37, 64-66 et 69 : vérification de signature avant parsing métier, payload borné, action et preuve durables, tenant/RLS, déduplication, ordre non garanti, audit sans secret/PII et fournisseur honnêtement désactivé.
- Preuve obtenue : PDF de 71 pages au SHA-256 exact; migrations runtime `079`/`080` et miroirs SQL `0073`/`0074`; référence fournisseur unique; journal d'événements immuable sans SID, numéro, corps, payload, credential ni ErrorCode brut; normalisation `queued/sent` -> `accepted`, `delivered/read` -> `delivered`, `failed/undelivered` -> `failed`; replay sans second événement/audit; `delivered` terminal face aux événements tardifs; `failed` puis `delivered` convergent; message canonique réconcilié; route fail-closed et URL de callback dédiée.
- Écarts restants : client Twilio réel, résolution éphémère/chiffrée des credentials et de la destination, secret manager, Sandbox, endpoint public et preuve réelle web + WhatsApp. OS-5 reste `in_progress` et ne satisfait pas encore le succès page 31.

## Classification honnête

- Livré : outbound durable, worker lease/backoff et callbacks signés/dédupliqués/monotones avec audit sûr.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound et callbacks prêts derrière les gardes, sans client réel.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport outbound injecté, callbacks signés de test, canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire de secrets, endpoint HTTPS temporaire et autorisation d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules concernés

- `src/db/migrations/0073_os5_channel_provider_delivery_events.sql`, `0074_os5_channel_provider_delivery_events_rls.sql` et `src/lib/db.ts` : événements immuables, unicité de référence, contraintes tenant et RLS;
- `src/modules/channels/whatsapp-twilio-delivery-status.ts` : vérification officielle puis normalisation bornée des statuts;
- `src/modules/channels/whatsapp-twilio-delivery-status-service.ts` : résolution système bornée, replay, progression monotone, réconciliation et audit sûr;
- `src/modules/channels/whatsapp-twilio-outbound-repository.ts` : mutations tenant-scoped de la livraison, de l'événement et du message;
- `src/app/api/webhooks/twilio/whatsapp/status/route.ts` : route dédiée, HTTPS configuré et fail-closed;
- tests migration, PostgreSQL/RLS, service, HTTP et registre provider.

## Risques

- Twilio avertit que les callbacks peuvent arriver hors ordre et ajouter des paramètres. La signature porte donc le formulaire complet, tandis que la normalisation ne conserve que les champs bornés nécessaires; les statuts inconnus sont refusés.
- `delivered` est terminal localement. Un échec tardif reste journalisé mais ne régresse ni la livraison ni le message; un `delivered/read` postérieur peut corriger un `failed` reçu plus tôt.
- Le SID technique reste dans la ligne de livraison existante pour la corrélation provider; il n'est pas copié dans le journal d'événements, les audits, les réponses ou les logs applicatifs de cette tranche.
- La destination et les credentials ne sont volontairement pas résolus par ce lot. L'activation exigera une résolution éphémère, révocable et testée avant construction du client Twilio.
- La suite Vitest complète bloque silencieusement localement. Le test PostgreSQL/RLS est ignoré sans `DATABASE_URL`; la CI Linux/PostgreSQL reste l'autorité exhaustive.

## Validations

- `pnpm agent:continuity-check` initial et final local : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub initial : PR #11 ouverte, brouillon, fusionnable et `CLEAN`; CI `31247502526` et continuité `31247502516` vertes sur `45a912d`;
- local ciblé/régression : 92 tests verts; test PostgreSQL/RLS dédié compilé et ignoré sans `DATABASE_URL`;
- local statique : audit production sans vulnérabilité connue, lint, typecheck, build production, continuité et diff check verts; build inventorie `/api/webhooks/twilio/whatsapp/status`;
- local exhaustif : Vitest complet bloqué silencieusement sans assertion en échec; la CI PostgreSQL `31248824059` compense cette limite avec 104 fichiers/408 tests verts;
- GitHub du commit fonctionnel : continuité `31248824055` verte; CI `31248824059` verte en 10 min 57 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 104 fichiers/408 tests, build et 20/20 Playwright sur `65176fb`.

## Prochaine action recommandée

Préparer la frontière de transport Twilio réelle avec client injecté, résolution éphémère des credentials/destination et URL de callback configurée, toujours fail-closed et avec doubles uniquement. Ne créer ni Sandbox, credential, endpoint public ni message réel avant l'autorisation humaine de `docs/OS5_PROVIDER_SELECTION.md`.
