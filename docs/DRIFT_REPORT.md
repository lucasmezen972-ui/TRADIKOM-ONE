# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 1er septembre 2026, 05:21 UTC

- Branche : `codex/tradikom-one-os`.
- Head local et distant publié : `159dc13c36ff1c203aae03fe023ba1819709b537`.
- PR #11 : ouverte, brouillon et `MERGEABLE/CLEAN` sur ce head.
- CI `33463499865` et continuité `33463499881` entièrement vertes : les lots de statuts Meta sont prouvés PostgreSQL/RLS, suite complète, build et Playwright.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche en cours empêche la perte silencieuse de messages entrants lorsque l'enveloppe Meta contient plusieurs éléments : le lot signé est borné, tous ses endpoints sont prévalidés, puis chaque message est ingéré durablement et atomiquement dans le Conversation Hub. Cela renforce directement le canal conversationnel WhatsApp sans ajouter d'interface métier. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 10-18, 22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint; les pages 48 et 69 ont aussi été inspectées visuellement pendant ce heartbeat.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | Head `159dc13` et reprise revérifiés; aucun CRM/Kanban/dashboard/OS-6 sélectionné | CI de la tranche entrante, puis checkpoint humain Meta |
| 10-14 | Conversation Hub canonique, normalisation de tous les messages et identité omnicanale sans fusion faible | `entry`/`changes`/`messages` parcourus dans l'ordre; provenance et idempotence propres; sujets HMAC-scopés par tenant/endpoint | Les payloads mixtes messages + statuts dans une même requête restent à traiter séparément |
| 14, 30-33, 35-38 | Signature avant parsing, entrée non fiable bornée, action atomique et audit sans contenu sensible | HMAC avant JSON; dix éléments par niveau, cent messages globalement; prévalidation complète avant mutation; zéro écriture sur endpoint ultérieur inconnu | Preuve fournisseur externe réelle |
| 17-22, 26-30 | PostgreSQL, RLS, runtime fournisseur et isolation tenant | Deux tenants dans une même enveloppe restent isolés; aucun changement de schéma ou de politique RLS | PostgreSQL/RLS CI du futur head pour la régression entrante |
| 31-33 | Definition of Done : tests sans clé, états honnêtes, preuve utilisable | 2 fichiers/13 tests ciblés et régression Meta 96 tests verts; lint, typecheck, build et continuity-check verts | Suite exhaustive locale non concluante; CI/PostgreSQL/RLS/Playwright requis; fournisseur actif bloqué par SMS |
| 64-68 | Runtime provider uniforme, webhook Meta et fournisseur fail-closed | Ingestion durable sans client Graph réel; provider toujours non activé | Meta for Developers attend le code SMS |
| 69 | Matrice provider, intégration, sécurité et isolation | Matrice relue en rendu; lot multiple, replay, bornes, multi-tenant, prévalidation et absence de PII testés | CI complète du futur head |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Travail livré localement

- Traitement de tous les messages texte d'une enveloppe Meta au lieu du seul premier élément.
- Bornes strictes : dix `entry`, dix `changes` par entrée, dix `messages` par changement et cent messages maximum par requête.
- Prévalidation de tous les couples WABA/Phone Number ID avant mutation; un endpoint ultérieur inconnu laisse zéro message, zéro binding et zéro audit conversationnel.
- Résultats par message avec provenance, idempotence SHA-256 et rejeu indépendant; une enveloppe multi-tenant conserve deux identités et fils distincts.
- Traitement de plusieurs statuts Meta dans une même enveloppe après une seule vérification HMAC du corps brut.
- Bornes strictes : dix `entry`, dix `changes` par entrée, dix `statuses` par changement et cent statuts maximum par requête.
- Prévalidation de toutes les références endpoint/livraison avant mutation; une référence ultérieure inconnue laisse zéro événement et zéro audit.
- Résumé sûr du lot avec compte traité/rejoué/mis à jour, sans exposer WABA, Phone Number ID, `wamid`, destinataire, timestamp ou erreur fournisseur dans la réponse HTTP.
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

- Head `159dc13` : CI `33463499865` et continuité `33463499881` vertes, incluant migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, suite exhaustive, build production et Playwright pour les lots de statuts.
- Tranche entrante locale : 2 fichiers/13 tests ciblés verts; régression Meta 13 fichiers réussis, 3 fichiers PostgreSQL ignorés, 96 tests réussis et 3 ignorés sans `DATABASE_URL`; ESLint ciblé et complet, TypeScript, build production, continuity-check et `git diff --check` verts.
- La suite exhaustive locale est restée silencieuse plus de trois minutes et a été interrompue sans assertion en échec; elle n'est pas présentée comme verte. La CI PostgreSQL/RLS, suite exhaustive et Playwright du futur head ne sont pas encore revendiqués.
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
- Livré et prouvé CI : notifications de statut Meta signées, immuables, idempotentes et monotones.
- Livré et prouvé CI : lots de statuts Meta bornés, prévalidés et atomiques.
- Livré localement, CI en attente : lots de messages entrants Meta bornés, prévalidés, atomiques, idempotents et multi-tenant.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement en test, sans réseau fournisseur.
- Bloqué humain : code SMS Meta saisi directement dans Chrome, puis confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le coffre Meta, l'enveloppe officielle, les statuts et leurs lots sont publiés et prouvés avec PostgreSQL/RLS. La tranche de lots entrants doit être publiée en fast-forward puis validée par CI complète. Un écart logiciel explicite subsiste : une enveloppe qui mélangerait changements de messages entrants et de statuts est encore refusée par les parseurs spécialisés et devra être dispatchée sans parsing non vérifié dans une tranche ultérieure. Le premier écart fournisseur demeure Meta for Developers : l'utilisateur saisit le code SMS directement dans Chrome sans le transmettre au chat. Une fois l'inscription validée, inventorier app/WABA/Phone Number ID, puis demander une confirmation immédiatement avant toute création de token persistant. Aucune requête Graph, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
