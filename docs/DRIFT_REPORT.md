# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 31 août 2026, 17:50 UTC

- Branche : `codex/tradikom-one-os`.
- Parent local et distant observé : `9288aa767d758c25fd7383a101a8881405f1668a`.
- PR #11 : ouverte, brouillon et `MERGEABLE/CLEAN` avant publication de la tranche locale.
- CI `33416889004` et continuité `33416888927` vertes sur le parent publié.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche rapproche le parcours conversation → action durable d'une preuve fournisseur exploitable : les credentials Meta peuvent désormais être versionnés, chiffrés, révoqués et résolus uniquement au moment serveur de l'effet, sous le même tenant et le bon endpoint. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 17-22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint; les pages 29, 32, 37, 48, 64 et 69 ont aussi été inspectées visuellement.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | OS-5 Meta poursuivi; quatre documents actualisés; aucun CRM/Kanban/dashboard/OS-6 sélectionné | Publication et CI du nouveau head encore à produire |
| 17-22, 26-30 | PostgreSQL, RLS, chiffrement, runtime fournisseur, action durable et idempotence | Migration 103 / SQL 0097; provider fermé à Twilio/Meta; clé étrangère tenant-endpoint-provider; rotation/révocation et rejeu idempotent | PostgreSQL/RLS réel non disponible localement, CI requise |
| 31-33 | Definition of Done : tests sans clé, états honnêtes, preuve utilisable | 91 tests ciblés verts, lint, typecheck et build production verts; aucun secret réel utilisé | Suite exhaustive locale silencieuse; preuve CI complète requise |
| 35-38 | Données sensibles protégées et audit sans contenu | AES-256-GCM avec AAD tenant/provider/endpoint/identité/portée/version; résolveurs éphémères; audit sans token, secret, numéro, contenu ou ciphertext | Gestionnaire de secrets réel non configuré |
| 64-68 | Runtime provider uniforme, endpoint tenant-aware et fournisseur fail-closed | Repositories/services provider-scoped, liaison Meta exigée pour l'identité, transport branché seulement en `mock` | Meta for Developers attend le code SMS; aucun token ni transport réel |
| 69 | Matrice provider, intégration, sécurité et isolation | 14 fichiers réussis, 2 PostgreSQL ignorés; 91 tests réussis, 2 ignorés; base neuve et upgrade PGlite prouvées | Migrations/backup/RLS, suite complète et Playwright à confirmer en CI |

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
- La suite `pnpm test` exhaustive est restée silencieuse et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte.
- `pnpm db:verify` refuse sans `DATABASE_URL`; aucune clé ou URL PostgreSQL n'a été demandée. La CI doit vérifier migrations, backup/restauration et RLS.
- La CI publiée `33416889004` est verte mais précède la tranche locale; elle ne prouve donc pas encore runtime 103 / SQL 0097.

## Classification des états

- Livré localement : coffre Meta chiffré, provider-scoped, versionné, révocable et audité sans secret.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement en test, sans réseau fournisseur.
- Bloqué humain : code SMS Meta saisi directement dans Chrome, puis confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le premier écart est de publier le coffre Meta et d'obtenir sa CI PostgreSQL/RLS complète. Le checkpoint externe reste ensuite Meta for Developers : l'utilisateur saisit le code SMS directement dans Chrome et ne le transmet pas au chat. Une fois l'inscription validée, inventorier app/WABA/Phone Number ID, puis demander une confirmation immédiatement avant toute création de token persistant. Les secrets doivent être injectés par références serveur sans être lus, affichés, journalisés ou commis. Aucune requête Graph, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
