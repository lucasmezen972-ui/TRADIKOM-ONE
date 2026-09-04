# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 4 septembre 2026, 09:45 UTC

- Branche : `codex/tradikom-one-os`.
- Head local et distant publié : `28efa750935b2766de3410b8d9c0d5e3c4e2dbe8`.
- PR #11 : ouverte, brouillon et fusionnable sur ce head; la continuité `33826756891` est verte.
- CI `33826756939` : deux tentatives arrêtées avant migrations/tests par un timeout de l'API d'audit npm, sans avis de vulnérabilité ni échec applicatif.
- Troisième relance non exécutée : le contrôleur d'autorisation a échoué sur une erreur réseau et exige une approbation utilisateur explicite; aucun contournement n'est tenté.
- Provider examiné : WhatsApp Cloud API directe de Meta, non activé.
- Worktree préservé : `tmp/` reste non suivi et hors index.

## Impact north star

La tranche locale rend l'attente d'un média actionnable et durable sans prétendre que son binaire a été importé : le message signé reste visible dans la conversation et une réservation protégée peut être traitée ultérieurement. Cela renforce directement le canal conversationnel sans ajouter d'interface métier. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a remplacé cette priorité OS-5.

## Alignement prompt maître

Les pages 3-7, 11, 14, 22-23, 31-33, 46, 48, 64-65 et 69-71 du prompt maître ont été relues directement pour ce checkpoint; les pages 48 et 69 ont aussi été inspectées visuellement pendant ce heartbeat.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre strict et continuité | Head `28efa75` publié; continuité verte; aucun CRM/Kanban/dashboard/OS-6 sélectionné | Approbation explicite pour relancer, puis CI complète après rétablissement du registre npm |
| 11, 14 | Conversation Hub canonique, adaptateur sans logique métier et déduplication | Notice française conservée; référence fournisseur éphémère hors objet sérialisable; rejeu exact et collision testés | Import binaire différé |
| 22-23 | Média externe non fiable, stockage avec ACL/checksum, minimisation et injection | Référence AES-256-GCM avec contexte tenant/provider/endpoint/message; aucune valeur média en clair, aucun binaire ou fausse pièce jointe | Contrôles réels taille/type, stockage immuable, antivirus, transcription/OCR |
| 31-33 | Definition of Done : action durable, états honnêtes et preuve utilisable | Réservation tenant/RLS, relations composées, `pending`/`not_configured`/`failed`, audit sans contenu; tests locaux, lint, typecheck et build verts; continuité distante verte | CI bloquée avant tests par timeout npm; PostgreSQL/RLS, suite exhaustive et Playwright restent requis; fournisseur actif bloqué par SMS |
| 64-65 | Runtime provider uniforme, webhook signé et fournisseur fail-closed | Ingestion et réservation atomiques; zéro Graph; provider réel toujours non activé | Meta for Developers attend le code SMS |
| 69 | Matrice provider, intégration, sécurité et isolation | Matrice relue en rendu; chiffrement/AAD, migrations miroir, non-fuite, atomicité, RLS et collision couverts | Test RLS local ignoré sans `DATABASE_URL`; CI complète requise après panne npm |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.

## Travail livré et publié, CI externe bloquée

- Migrations runtime 105/106 et miroirs SQL 0099/0100 pour `channel_provider_media_imports`, avec relations composées tenant/endpoint/provider et tenant/message, index tenant-leading, contraintes d'état et politique RLS.
- Référence fournisseur conservée de manière éphémère jusqu'au service d'ingestion, puis chiffrée en AES-256-GCM avec AAD tenant/provider/endpoint/message et version de clé.
- Aucun Media ID, MIME, checksum, nom de fichier, URL, contenu ou payload en clair dans la réservation ou l'audit.
- États durables `pending`, `not_configured` et `failed`; rejeu identique sans doublon et collision de référence refusée.
- Réservation et audit dans la même transaction que le message canonique; aucun `fetch`, Graph, stockage, binaire ou pièce jointe canonique.

## Travail livré, publié et prouvé CI

- Normalisation stricte des messages Meta `image`, `audio`, `document`, `video` et `sticker`, avec MIME autorisés par type et champs média bornés.
- Conservation de la légende utile et ajout d'une notice française explicite indiquant que l'import sécurisé reste en attente.
- Suppression des métadonnées média à la frontière de normalisation : Media ID, checksum, nom de fichier et MIME ne sont pas propagés vers le Conversation Hub.
- Zéro appel réseau et zéro ligne `conversation_message_attachments`; la tranche ne simule ni téléchargement, ni stockage, ni analyse du média.
- Lot texte+média+statut atomique et idempotent, avec prévalidation commune, audit sans PII et replay complet sans doublon.
- Dispatch unifié de chaque changement Meta signé vers messages entrants ou statuts de livraison après une seule vérification HMAC du corps brut.
- Borne combinée de cent événements et refus strict d'un changement ambigu contenant `messages` et `statuses`, ou aucune famille reconnue.
- Prévalidation de tous les endpoints et livraisons des deux familles avant toute mutation, puis transaction unique pour messages, bindings, événements et projections.
- Rejeu mixte idempotent, signature invalide sans accès base et livraison inconnue annulant aussi le message valide du même lot.
- Réponse HTTP réduite à `{ ok: true }` et audits prouvés sans contenu, numéros, Phone Number ID ni identifiants `wamid`.
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

- Head `28efa75` : publication confirmée par fetch exact; continuité `33826756891` verte.
- CI `33826756939` tentatives 1 et 2 : rouges uniquement parce que `pnpm audit` n'a pas reçu de réponse de `registry.npmjs.org/-/npm/v1/security/advisories/bulk` après retries. L'arrêt précède migrations, RLS, tests, build et Playwright; aucune de ces preuves n'est revendiquée sur ce head.
- Troisième relance : non exécutée, car le contrôleur d'autorisation a échoué sur une erreur réseau et demande une approbation utilisateur explicite. Aucun autre mécanisme n'est utilisé pour déclencher indirectement la même action.
- Reproduction locale de l'audit hors sandbox : même timeout du registre. Le contrôle n'est ni supprimé, ni ignoré, ni rendu permissif.
- Parent `232f60a` : CI `33674098147` et continuité `33674098123` vertes; PR #11 ouverte, brouillon et `MERGEABLE/CLEAN` avant publication locale.
- Réservation média locale : 4 fichiers ciblés réussis, 1 fichier PostgreSQL/RLS ignoré, 17 tests réussis et 1 ignoré; ingestion complète 13/13 verte. La régression Meta élargie a 19 fichiers et 135 tests réussis; deux scénarios ont uniquement dépassé le délai lors de sauts d'horloge locale puis ont repassé isolément en quelques secondes.
- ESLint complet, TypeScript, build Next.js production et `git diff --check` sont verts. Le build a utilisé le réseau uniquement pour les polices Google déjà déclarées.
- `pnpm agent:continuity-check` a été tenté mais son lanceur local a voulu réinstaller sans réseau ni TTY; le script versionné direct retourne `ready`, zéro erreur et zéro avertissement. La CI du futur head doit encore prouver migrations PostgreSQL, RLS, suite exhaustive et Playwright.
- Head `0e92f38` : CI `33523760105` et continuité `33523760887` vertes, incluant migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 144 fichiers/670 tests, build production et 20 Playwright pour l'enveloppe mixte.
- Tranche média locale : nouveaux scénarios des cinq types, rejet d'entrée invalide, zéro réseau, zéro pièce jointe et lot mixte passent. La régression élargie compte 122 tests réussis et 2 PostgreSQL ignorés; deux timeouts liés aux sauts d'horloge locaux ont été relancés isolément et passent. ESLint complet, TypeScript, build production, continuity-check direct et `git diff --check` sont verts.
- Head média `41c2fc8` : continuité `33628923623` verte; CI `33628923602` rouge uniquement sur l'audit préalable `browserslist 4.28.5`, avant migrations ou tests. La surcharge `4.28.7` met à jour le lockfile et `pnpm audit --prod --audit-level high` ne trouve plus de vulnérabilité connue; la nouvelle CI reste requise.
- Head final `44350ec` : CI `33661150567` entièrement verte sur audit, migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 144 fichiers/674 tests, build et 20 Playwright; continuité `33661150706` verte.
- Tranche mixte locale : test dédié 5/5 vert; régression ingress/webhook 6 fichiers/41 tests; régression Meta/coffre 18 fichiers/120 tests verts et 2 fichiers/2 tests PostgreSQL ignorés sans `DATABASE_URL`; ESLint complet, TypeScript, build production, continuity-check et `git diff --check` verts. La CI exhaustive du futur head n'est pas encore revendiquée.
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
- Livré et prouvé CI : lots de messages entrants Meta bornés, prévalidés, atomiques, idempotents et multi-tenant.
- Livré et prouvé CI : enveloppe mixte messages/statuts authentifiée une fois, bornée, prévalidée et atomique.
- Livré et prouvé CI : représentation conversationnelle française de cinq types média signés, sans téléchargement Graph ni stockage fictif.
- Livré et publié, CI externe bloquée : réservation d'import média tenant/RLS, référence fournisseur chiffrée, états explicites, idempotence/collision et audit sans contenu.
- Réel : aucun compte développeur finalisé, app, WABA, numéro, token, endpoint public, requête Graph ou message.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement en test, sans réseau fournisseur.
- Bloqué humain : code SMS Meta saisi directement dans Chrome, puis confirmation au moment exact avant création d'un token persistant et injection via gestionnaire de secrets.
- Hors périmètre : fusion, production, DNS, dépense, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

Le coffre Meta, l'enveloppe officielle, les statuts, leurs lots, les lots entrants, l'enveloppe mixte et la représentation média sont publiés et prouvés avec PostgreSQL/RLS. La réservation durable est elle aussi publiée, mais sa CI complète reste bloquée par l'indisponibilité de l'API d'audit npm; l'audit ne doit pas être contourné. Une approbation utilisateur explicite est maintenant requise pour retenter la CI après l'échec réseau du contrôleur d'autorisation. Après une CI verte, l'écart technique suivant est le journal durable d'exécution et le contrat provider/storage avec doubles mock, puis seulement le stockage immuable avec contrôle type/taille, ACL, checksum et analyse de sécurité; aucun téléchargement ou stockage ne doit être présenté comme déjà livré. Le premier écart fournisseur demeure Meta for Developers : l'utilisateur saisit le code SMS directement sans le transmettre au chat. Une fois l'inscription validée, inventorier app/WABA/Phone Number ID, puis demander une confirmation immédiatement avant toute création de token persistant. Aucune requête Graph, stockage réel, message, activation, fusion, déploiement ou dépense n'est autorisée par ce checkpoint.
