# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 31 août 2026, 18:29 UTC

- Branche : `codex/tradikom-one-os`.
- Parent local et distant observé avant le correctif : `54755dec72a755f13c1b8602b9bb7c4120b91df1`.
- PR #11 : ouverte et brouillon au dernier contrôle publié; l'état GitHub exact doit être reconfirmé avant push.
- Le coffre reste prouvé par la CI `33422211572` et la continuité `33422211485` sur `f99b5f3`. Le correctif d'enveloppe officielle est prouvé localement et sa CI reste à obtenir.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche empêche qu'un webhook Meta réel soit rejeté ou casse l'idempotence à cause de champs officiels et du padding d'un `wamid`. L'enveloppe signée rejoint maintenant la conversation durable avec une provenance opaque et des clés internes sûres, sans diffuser les données d'identité fournisseur. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 13-22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint; les pages 29, 32, 37, 48, 64 et 69 ont aussi été inspectées visuellement.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | Compatibilité ingress OS-5 traitée avant tout module secondaire; quatre documents actualisés; aucun CRM/Kanban/dashboard/OS-6 sélectionné | Publication et CI du correctif, puis checkpoint humain Meta |
| 13-18, 30-33 | Signature avant parsing, entrée non fiable bornée, identité opaque et action durable idempotente | Signature HMAC vérifiée avant JSON; champs officiels explicitement typés; `wamid` opaque conservé; idempotence/corrélation dérivées par SHA-256; rejeu sans doublon | CI du futur head à obtenir |
| 17-22, 26-30 | PostgreSQL, RLS, runtime fournisseur et isolation tenant | Endpoint à 16 chiffres résolu sous le bon tenant; conversation, identité et liaison créées par services tenant-aware; aucun grant Data API ajouté | Test PostgreSQL/RLS déjà vert pour le coffre; CI complète du correctif attendue |
| 31-33 | Definition of Done : tests sans clé, états honnêtes, preuve utilisable | Fixture anonymisée; 17 fichiers/108 tests, lint, typecheck, build, continuity-check et diff check verts localement | Preuve CI puis preuve fournisseur externe |
| 35-38 | Données sensibles protégées et audit sans contenu | Nom, display number, sender, Phone Number ID, timestamp et `wamid` absents des audits, identités et liaisons; seule la provenance conversationnelle conserve l'identifiant externe requis | Gestionnaire de secrets réel non configuré |
| 64-68 | Runtime provider uniforme, webhook Meta et fournisseur fail-closed | Enveloppe officielle Meta normalisée vers le contrat commun; aucun client Graph ni transport réel; provider toujours non activé | Meta for Developers attend le code SMS; aucun token ni transport réel |
| 69 | Matrice provider, intégration, sécurité et isolation | Intégration signée avec endpoint 16 chiffres et replay; régression Meta/coffre 108 tests verts | CI du correctif, puis configuration fournisseur humaine |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Travail livré localement

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

- Correctif enveloppe : 4 fichiers/24 tests ingress-webhook verts, puis 17 fichiers/108 tests Meta et coffre verts.
- ESLint complet, TypeScript, `git diff --check`, continuity-check (`ready`, zéro erreur/avertissement) et build Next.js production verts.
- La CI du correctif n'est pas encore disponible et n'est pas présentée comme verte; la dernière preuve CI fonctionnelle demeure `33422211572` pour le coffre.
- Tests ciblés : 14 fichiers réussis et 2 ignorés; 91 tests réussis et 2 PostgreSQL ignorés.
- Migrations : miroir runtime/SQL, base neuve, upgrade depuis runtime 101 et refus du mauvais couple provider/endpoint validés sous PGlite.
- ESLint complet, TypeScript, `git diff --check` et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour les polices Google requises.
- La suite `pnpm test` exhaustive locale est restée silencieuse et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte localement.
- `pnpm db:verify` local refuse sans `DATABASE_URL`; aucune clé ou URL PostgreSQL n'a été demandée.
- La CI publiée `33422211572` lève ces limites : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/651 tests, build production et 20 Playwright verts en 19 min 15 s. La continuité `33422211485` est verte.

## Classification des états

- Livré et prouvé CI : coffre Meta chiffré, provider-scoped, versionné, révocable et audité sans secret.
- Livré localement, CI attendue : enveloppe webhook officielle, `wamid` opaque et clés internes hashées.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement en test, sans réseau fournisseur.
- Bloqué humain : code SMS Meta saisi directement dans Chrome, puis confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le coffre Meta est publié et sa CI PostgreSQL/RLS est verte. Le correctif d'enveloppe officielle doit maintenant être publié après réconciliation distante et obtenir CI + continuité vertes. Le premier écart fournisseur restera ensuite Meta for Developers : l'utilisateur saisit le code SMS directement dans Chrome et ne le transmet pas au chat. Une fois l'inscription validée, inventorier app/WABA/Phone Number ID, puis demander une confirmation immédiatement avant toute création de token persistant. Les secrets doivent être injectés par références serveur sans être lus, affichés, journalisés ou commis. Aucune requête Graph, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
