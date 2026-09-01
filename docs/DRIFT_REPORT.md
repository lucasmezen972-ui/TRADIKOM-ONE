# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 1er septembre 2026, 02:00 UTC

- Branche : `codex/tradikom-one-os`.
- Parent local et distant publié : `b5a0fe3ec870f34969b60750987481a159755cab`.
- PR #11 : ouverte, brouillon et `MERGEABLE/CLEAN` sur ce parent.
- CI `33430233674` et continuité `33430233673` entièrement vertes sur le parent; la tranche statut locale attend publication et CI.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche ajoute la boucle de preuve après l'envoi : un statut Meta signé réconcilie durablement la livraison et le message conversationnel, sans doublon, sans régression en cas d'arrivée hors ordre et sans conserver les identifiants ou détails fournisseur dans l'audit. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 13-22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint; les pages 48 et 69 ont aussi été inspectées visuellement pendant ce heartbeat.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | Parent `b5a0fe3` et reprise revérifiés; aucun CRM/Kanban/dashboard/OS-6 sélectionné | Publication et CI de la tranche, puis checkpoint humain Meta |
| 13-18, 30-34 | Signature avant parsing, entrée non fiable bornée et action durable idempotente | Notification `statuses` vérifiée sur corps brut, schéma strict et borné, référence fournisseur corrélée au même endpoint/provider | Preuve fournisseur externe réelle |
| 17-22, 26-30 | PostgreSQL, RLS, runtime fournisseur et isolation tenant | Migration 104/mirror 0098 additifs; FK composée tenant/livraison/provider; PGlite frais et upgrade couverts; RLS existante inchangée | PostgreSQL/RLS CI du futur head |
| 31-33 | Definition of Done : tests sans clé, états honnêtes, preuve utilisable | 15 fichiers/97 tests Meta, lint, typecheck, build et continuity-check verts localement | Suite exhaustive, PostgreSQL/RLS et Playwright en CI; fournisseur actif bloqué par SMS |
| 35-38 | Données sensibles protégées et audit sans contenu | Timestamp, destinataire, WABA, Phone Number ID, `wamid`, erreur et payload absents des événements/audits; code interne générique | Gestionnaire de secrets réel non configuré |
| 64-68 | Runtime provider uniforme, webhook Meta et fournisseur fail-closed | Statuts réconciliés via repository/service durable; aucun client Graph réel; provider toujours non activé | Meta for Developers attend le code SMS |
| 69 | Matrice provider, intégration, sécurité et isolation | Matrice relue en rendu; signature, replay, ordre tardif, endpoint invalide, référence inconnue, provider mismatch et non-fuite testés | CI complète du futur head |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Travail livré localement

- Notifications Meta `sent`, `delivered`, `read`, `failed` et `deleted` normalisées vers les états internes.
- Dispatch du même webhook signé entre message entrant et statut sortant, sans parsing avant signature.
- Résolution WABA/Phone Number ID vers un endpoint Meta actif avant corrélation du `wamid` à une livraison du même endpoint.
- Migration runtime 104 et miroir SQL 0098 : événements immuables Meta, FK tenant/livraison/provider et `wamid` sortant opaque avec padding.
- Déduplication des callbacks, projection monotone et convergence `failed` puis `read`, avec audit sans PII ni référence fournisseur.
- Compatibilité additive avec `messaging_product`, `display_phone_number`, `contacts` et `timestamp`, sans relâcher les objets stricts ni les bornes.
- Acceptation de `wamid` avec padding base64 jusqu'à 256 caractères; dérivation SHA-256 des clés d'idempotence et de corrélation au lieu d'y incorporer l'identifiant brut.
- Fixture officielle entièrement anonymisée et test d'intégration signé avec Phone Number ID à 16 chiffres.
- Preuve que le message et sa provenance utiles sont conservés une seule fois, tandis que les champs d'identité fournisseur restent hors audits, identités et liaisons.
- Migration additive autorisant `whatsapp_meta` dans `channel_provider_secret_versions` sans réécrire l'historique appliqué.
- Contrainte composée empêchant tout mélange de provider entre secret et endpoint.
- Repository général tenant/provider-scoped, avec identité Meta active et liaison endpoint-identité obligatoire.
- Service de rotation/révocation Meta endpoint et identité, idempotent et réservé aux rôles administrateurs du tenant.
- Schémas bornés pour WABA, token, Phone Number ID, version Graph, secret d'application, jeton webhook et destination.
- Résolveurs serveur séparés pour credentials, destination et vérification webhook; aucune lecture globale de secret.
- Preuve d'intégration au transport Graph avec `fetch` factice uniquement.
- Tests de non-fuite en base et audit, rotation de clé, révocation monotone, mauvais WABA, cross-tenant et identité non liée.
- Test PostgreSQL/RLS adapté pour couvrir un tenant Twilio et un tenant Meta; il reste ignoré localement sans `DATABASE_URL`.
- Aucun grant `anon`/`authenticated` ni exposition Data API n'a été ajouté, conformément à la séparation grants/RLS.

## Validation honnête

- Tranche statut locale : 4 fichiers/27 tests statut-migrations-HTTP verts, puis régression Meta 15 fichiers/97 tests verts.
- ESLint ciblé et complet, TypeScript, `git diff --check`, continuity-check et build Next.js production verts. La tentative de build sandbox a recréé `node_modules`; le dossier incomplet a été déplacé dans `/private/tmp` et les 601 dépendances exactes restaurées depuis le store et le lockfile avant le build final.
- La suite exhaustive, PostgreSQL/RLS et Playwright du nouveau head ne sont pas revendiqués avant la CI.
- Correctif enveloppe : 4 fichiers/24 tests ingress-webhook verts, puis 17 fichiers/108 tests Meta et coffre verts.
- ESLint complet, TypeScript, `git diff --check`, continuity-check (`ready`, zéro erreur/avertissement) et build Next.js production verts.
- La CI `33425435804` est entièrement verte en 19 min 22 s : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/653 tests, build production et 20/20 Playwright. La continuité `33425435724` est verte.
- Le handoff final `cb3e50b` est lui aussi prouvé : CI `33427555175` verte en 20 min 32 s et continuité `33427555275` verte; PR #11 `MERGEABLE/CLEAN`.
- Tests ciblés : 14 fichiers réussis et 2 ignorés; 91 tests réussis et 2 PostgreSQL ignorés.
- Migrations : miroir runtime/SQL, base neuve, upgrade depuis runtime 101 et refus du mauvais couple provider/endpoint validés sous PGlite.
- ESLint complet, TypeScript, `git diff --check` et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour les polices Google requises.
- La suite `pnpm test` exhaustive locale est restée silencieuse et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte localement.
- `pnpm db:verify` local refuse sans `DATABASE_URL`; aucune clé ou URL PostgreSQL n'a été demandée.
- La CI publiée `33422211572` lève ces limites : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/651 tests, build production et 20 Playwright verts en 19 min 15 s. La continuité `33422211485` est verte.

## Classification des états

- Livré et prouvé CI : coffre Meta chiffré, provider-scoped, versionné, révocable et audité sans secret.
- Livré et prouvé CI : enveloppe webhook officielle, `wamid` opaque et clés internes hashées.
- Livré localement, CI en attente : notifications de statut Meta signées, immuables, idempotentes et monotones.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement en test, sans réseau fournisseur.
- Bloqué humain : code SMS Meta saisi directement dans Chrome, puis confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le coffre Meta et l'enveloppe officielle sont publiés et prouvés avec PostgreSQL/RLS. La tranche de statuts doit maintenant être publiée en fast-forward puis validée par CI complète. Après cette preuve, le premier écart fournisseur redevient Meta for Developers : l'utilisateur saisit le code SMS directement dans Chrome sans le transmettre au chat. Une fois l'inscription validée, inventorier app/WABA/Phone Number ID, puis demander une confirmation immédiatement avant toute création de token persistant. Aucune requête Graph, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
