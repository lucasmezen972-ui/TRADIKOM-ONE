# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 31 août 2026, 18:15 UTC

- Branche : `codex/tradikom-one-os`.
- Head fonctionnel local et distant publié : `f99b5f39e4dd1dfe116df60c7969f815513a8084`.
- PR #11 : ouverte, brouillon et `MERGEABLE/CLEAN`.
- CI `33422211572` et continuité `33422211485` entièrement vertes sur ce head.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche rapproche le parcours conversation → action durable d'une preuve fournisseur exploitable : les credentials Meta peuvent désormais être versionnés, chiffrés, révoqués et résolus uniquement au moment serveur de l'effet, sous le même tenant et le bon endpoint. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 17-22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint; les pages 29, 32, 37, 48, 64 et 69 ont aussi été inspectées visuellement.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | OS-5 Meta publié; quatre documents actualisés; aucun CRM/Kanban/dashboard/OS-6 sélectionné | Checkpoint humain Meta encore requis |
| 17-22, 26-30 | PostgreSQL, RLS, chiffrement, runtime fournisseur, action durable et idempotence | Migration 103 / SQL 0097; provider fermé à Twilio/Meta; clé étrangère tenant-endpoint-provider; rotation/révocation et rejeu idempotent; CI PostgreSQL verte | Gestionnaire de secrets réel non configuré |
| 31-33 | Definition of Done : tests sans clé, états honnêtes, preuve utilisable | CI : migrations/backup/RLS, lint, typecheck, 142 fichiers/651 tests, build et 20 Playwright verts | Preuve fournisseur externe toujours soumise au checkpoint humain |
| 35-38 | Données sensibles protégées et audit sans contenu | AES-256-GCM avec AAD tenant/provider/endpoint/identité/portée/version; résolveurs éphémères; audit sans token, secret, numéro, contenu ou ciphertext | Gestionnaire de secrets réel non configuré |
| 64-68 | Runtime provider uniforme, endpoint tenant-aware et fournisseur fail-closed | Repositories/services provider-scoped, liaison Meta exigée pour l'identité, transport branché seulement en `mock` | Meta for Developers attend le code SMS; aucun token ni transport réel |
| 69 | Matrice provider, intégration, sécurité et isolation | Local : 91 tests ciblés verts; CI : 142 fichiers/651 tests et 20 Playwright verts, avec PostgreSQL/RLS | Aucun écart logiciel sur cette tranche; reste la configuration fournisseur humaine |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Travail livré localement

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

- Tests ciblés : 14 fichiers réussis et 2 ignorés; 91 tests réussis et 2 PostgreSQL ignorés.
- Migrations : miroir runtime/SQL, base neuve, upgrade depuis runtime 101 et refus du mauvais couple provider/endpoint validés sous PGlite.
- ESLint complet, TypeScript, `git diff --check` et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour les polices Google requises.
- La suite `pnpm test` exhaustive locale est restée silencieuse et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte localement.
- `pnpm db:verify` local refuse sans `DATABASE_URL`; aucune clé ou URL PostgreSQL n'a été demandée.
- La CI publiée `33422211572` lève ces limites : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/651 tests, build production et 20 Playwright verts en 19 min 15 s. La continuité `33422211485` est verte.

## Classification des états

- Livré et prouvé CI : coffre Meta chiffré, provider-scoped, versionné, révocable et audité sans secret.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement en test, sans réseau fournisseur.
- Bloqué humain : code SMS Meta saisi directement dans Chrome, puis confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le coffre Meta est publié et sa CI PostgreSQL/RLS est verte. Le premier écart restant est donc Meta for Developers : l'utilisateur saisit le code SMS directement dans Chrome et ne le transmet pas au chat. Une fois l'inscription validée, inventorier app/WABA/Phone Number ID, puis demander une confirmation immédiatement avant toute création de token persistant. Les secrets doivent être injectés par références serveur sans être lus, affichés, journalisés ou commis. Aucune requête Graph, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
