# Drift report

- Date : 8 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `6dae5db`
- Travail effectué : transport WhatsApp sortant fail-closed, durable et tenant-aware avec doubles uniquement, sans activation externe.

## Impact north star

Une réponse conversationnelle canonique peut maintenant traverser une policy, être réservée durablement, passer par `ChannelAdapter.sendMessage`, converger vers un statut métier et être rejouée sans second envoi. La complexité fournisseur reste derrière l'adaptateur et le service borné; aucune interface CRM, Kanban ou dashboard secondaire n'a été ajoutée.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues textuellement et dans les rendus directs du PDF canonique.
- Exigence servie : poursuivre OS-5 page 31 avec WhatsApp/Twilio comme candidat unique, conformément aux pages 14, 18, 22, 28-29, 32, 64, 66 et 69 : adaptateur sans logique métier, policy obligatoire, action durable, tenant/RLS, idempotence, états fournisseur honnêtes, erreurs normalisées et audit sans secret ni PII.
- Preuve obtenue : PDF de 71 pages au SHA-256 exact; PR/CI du head initial vertes; état `mock` explicite distinct de `ready`; adapter fail-closed avant le client; migrations runtime `076`/`077` et miroirs SQL `0070`/`0071`; réservation et fingerprint tenant-aware; double envoi dédupliqué; rôles et acteur inter-tenant refusés; classifications `temporary`, `permanent`, `auth`, `rate_limit`, `policy`, `validation`, `not_configured`; message canonique réconcilié; audits sans corps, numéro ou SID; 19 nouveaux tests puis 66 tests canaux verts; lint, typecheck, audit production, build et continuité verts.
- Écarts restants : le worker de reprise `reserved`/`temporary`/`rate_limit`, le callback de livraison Twilio, le secret manager, la résolution réversible et chiffrée du destinataire, la sandbox, l'endpoint public et la preuve web + WhatsApp réelle restent absents. La suite Vitest complète locale bloque silencieusement malgré les suites ciblées vertes; la CI PostgreSQL du commit publié doit confirmer migrations, RLS, suite complète, build et Playwright. OS-5 reste `in_progress` et ne satisfait pas encore le critère de succès page 31.

## Classification honnête

- Livré : contrat outbound, adapter fail-closed, policy obligatoire, persistance tenant/RLS, audit sûr, réconciliation canonique et tests avec doubles.
- Réel préparé : inbound WhatsApp signé et tenant-mappé; outbound prêt à recevoir un transport réel après les garde-fous durables restants.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : client outbound injecté, canal test, `tradikom_mock` et événements provider de tests.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials stockés uniquement dans un gestionnaire de secrets, endpoint HTTPS temporaire et autorisation d'au plus deux messages si les unités gratuites sont visibles.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Modules et documents concernés

- `src/modules/channels/contracts.ts` : état `mock` explicite et classifications d'échec;
- `src/modules/channels/whatsapp-twilio-outbound.ts` : frontière `ChannelAdapter.sendMessage` et normalisation sûre;
- `src/modules/channels/whatsapp-twilio-outbound-service.ts` : membership, policy, réservation, replay, audit et réconciliation;
- `src/modules/channels/whatsapp-twilio-outbound-repository.ts` : requêtes tenant-scoped et transitions durables;
- `src/lib/db.ts` et `src/db/migrations/0070*`/`0071*` : table, contraintes, immutabilité et RLS;
- les tests migration, adapter et service, puis les quatre fichiers de continuité.

## Risques

- Une réservation peut rester `reserved` après interruption entre le transport et la finalisation; le prochain worker doit la reprendre avec lease sans double effet.
- Les erreurs `temporary` et `rate_limit` sont classées et persistées mais pas encore réessayées automatiquement.
- La destination WhatsApp n'est volontairement pas stockée en clair; une activation réelle exigera une résolution chiffrée/révocable dans un gestionnaire de secrets, jamais une colonne téléphone.
- Les unités d'essai Twilio ne sont pas une gratuité illimitée; tout envoi réel doit être refusé si le solde gratuit n'est pas explicitement visible.
- Aucun SID, token, numéro, texte métier ou payload brut ne doit entrer dans les audits ou logs; le SID technique reste limité à la ligne de livraison.

## Validations

- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5` et 71 pages;
- inspection textuelle et visuelle : pages cœur et OS-5 attendues;
- GitHub initial : PR #11 ouverte, brouillon et `CLEAN`; CI `31242530450` et continuité `31242530461` vertes sur `6dae5db`;
- local ciblé : 3 fichiers / 19 tests nouveaux, puis 10 fichiers / 66 tests WhatsApp/canaux verts;
- local statique : audit production sans vulnérabilité connue, lint, typecheck, build production, continuity-check et diff check verts;
- local exhaustif : deux tentatives Vitest complètes interrompues après blocage silencieux sans assertion en échec; CI du commit à publier requise comme arbitre.

## Prochaine action recommandée

Implémenter le worker durable des livraisons `reserved`, `temporary` et `rate_limit` avec lease tenant-aware, backoff et tentatives bornées, même clé d'idempotence et doubles uniquement. Ne créer ni sandbox, credential, endpoint public ni message réel avant l'autorisation humaine définie dans `docs/OS5_PROVIDER_SELECTION.md`.
