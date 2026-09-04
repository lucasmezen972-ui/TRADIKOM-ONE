# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements. `tmp/` reste non suivi et strictement hors commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages candidates 10-18, 22-24, 35-38 et 64-65 ont été relues directement le 4 septembre 2026.
- Le head distant publié reste `28efa750935b2766de3410b8d9c0d5e3c4e2dbe8`; les autorisations durables des fils sont conservées localement dans `8d6e329b363cac96b5cfb793f82abab7e9aee273`, sans push. Après le présent handoff, la branche sera en avance de vingt-et-un commits. La continuité `33826756891` est verte. La CI `33826756939` s'est arrêtée deux fois avant migrations/tests uniquement sur un timeout de l'API d'audit npm; aucune relance ni publication indirecte n'a été déclenchée sans approbation explicite.
- L'utilisateur autorise la configuration des clés Meta, mais pas leur passage dans le chat, les logs, Git ou le modèle. L'inscription Meta for Developers est ouverte dans Chrome et attend le code SMS à six chiffres saisi directement par l'utilisateur; le bouton Continuer est encore désactivé.

## Tranche applicative locale terminée : autorisations durables des fils

- Les migrations runtime `112/113` et miroirs SQL `0106/0107` ajoutent les droits utilisateur des fils et leurs opérations idempotentes, avec relations composées vers le fil et le membership du même tenant, contraintes de portée, unicité, index tenant-leading et RLS.
- `personal` exige exactement une personne autorisée; `team` et `case` au moins une; `tenant` aucune liste et reste compatible pour tous les membres. Seuls propriétaire et administrateur configurent; le rejeu identique est stable et une même clé avec une autre demande est refusée.
- Listes, lecture du fil et ingestion humaine exigent désormais le droit exact pour `personal`/`team`/`case`. Le chemin système reste borné aux entrées déjà authentifiées par les adaptateurs et ne transforme jamais un canal en droit d'accès.
- Les pièces jointes sont refusées avant toute policy ou lecture stockage sans droit. Le droit est relu après l'IO; une révocation ou mutation concurrente échoue fermé et produit seulement une classification d'audit sûre.
- L'interface Conversation affiche en français si le fil est ouvert à l'organisation ou soumis à autorisation explicite. Aucun écran CRM, Kanban ou dashboard secondaire n'est ajouté.
- Preuves finales après durcissement RLS : 6 fichiers ciblés verts et 1 PostgreSQL ignoré, 27 tests verts et 1 ignoré faute de `DATABASE_URL`; ESLint ciblé et TypeScript verts. Avant le dernier changement SQL, la régression Conversation/Meta/média comptait 158 tests verts et 5 ignorés; la suite exhaustive 722 tests verts et 23 ignorés; lint complet et build production verts.
- État honnête : livré localement au commit `8d6e329b363cac96b5cfb793f82abab7e9aee273`; PostgreSQL/RLS réel et Playwright attendent la CI. Aucun Graph, stockage réel, secret, message externe, activation ou déploiement.

## Tranche locale terminée : coffre chiffré WhatsApp Meta

- La migration additive runtime `103_os5_channel_provider_secret_versions_meta` et son miroir SQL `0097_os5_channel_provider_secret_versions_meta.sql` autorisent uniquement `whatsapp_twilio` et `whatsapp_meta`.
- Une clé étrangère composée `(tenant_id, endpoint_id, provider)` empêche d'attacher une version de secret Meta à un endpoint Twilio, et inversement. Les politiques RLS existantes restent inchangées; aucun grant Data API public n'est ajouté.
- Le repository et le service sont explicitement provider-scoped. Le chemin Twilio reste compatible.
- Les payloads endpoint Meta — WABA, token d'accès, Phone Number ID, version Graph, secret d'application et jeton de vérification — et la destination sont chiffrés en AES-256-GCM avec contexte tenant/provider/endpoint/identité/portée/version.
- Rotation, rejeu, collision d'idempotence, révocation monotone, endpoint actif, identité Meta liée, membership administrateur et refus cross-tenant sont contrôlés.
- Les résolveurs ne rendent les credentials et la destination qu'en mémoire serveur. Les audits n'enregistrent ni token, secret, numéro, contenu ni ciphertext.
- Le branchement au transport Meta est prouvé uniquement avec un `fetch` factice et l'état `mock`; aucune requête Graph réelle ni message externe n'a été produit.

## Tranche locale terminée : enveloppe webhook officielle

- Le validateur accepte explicitement les champs Meta `messaging_product`, `display_phone_number`, `contacts` et `timestamp`, tous bornés et strictement typés.
- Un `wamid` opaque avec padding base64 est conservé comme provenance fournisseur, mais n'est plus incorporé dans les clés internes : idempotence et corrélation sont dérivées d'une empreinte SHA-256 hexadécimale stable.
- Une fixture entièrement anonymisée prouve signature, endpoint à 16 chiffres, ingestion, rejeu idempotent et non-fuite du nom, des numéros, du timestamp et du `wamid` dans les audits, identités et liaisons fournisseur. La CI complète confirme cette tranche.
- Les données et identifiants fournis par l'utilisateur n'ont pas été persistés, documentés ou rejoués; aucun appel Graph n'a été effectué.

## Tranche publiée et prouvée : notifications de statut Meta

- Le webhook signé accepte les notifications `statuses` officielles et sépare leur traitement des messages entrants sans parser avant vérification HMAC.
- WABA et Phone Number ID doivent résoudre un endpoint Meta actif; le `wamid` doit référencer une livraison du même endpoint et du même provider.
- La migration runtime `104_os5_whatsapp_meta_delivery_events` et le miroir SQL `0098_os5_whatsapp_meta_delivery_events.sql` étendent les événements immuables à Meta et verrouillent la relation tenant/livraison/provider.
- `sent`, `delivered`, `read`, `failed` et `deleted` convergent vers les états internes sans régression malgré les callbacks tardifs. Les replays ne créent ni événement ni audit supplémentaires.
- Aucun timestamp, destinataire, WABA, Phone Number ID, `wamid`, détail d'erreur ou payload brut n'est persisté dans l'événement ou l'audit.

## Tranche publiée et prouvée : lots de statuts Meta

- Les tableaux `entry`, `changes` et `statuses` restent stricts mais acceptent plusieurs événements dans des bornes explicites : dix éléments par niveau et cent statuts par requête.
- La signature HMAC est vérifiée une seule fois avant parsing. Chaque statut est ensuite normalisé et corrélé au même provider et au bon endpoint tenant-aware.
- Toutes les références endpoint/livraison sont prévalidées avant la première écriture. Une référence inconnue dans le lot refuse l'ensemble sans événement ni audit partiel.
- Le replay du lot ne crée aucun doublon; les projections restent monotones et chaque événement conserve sa clé durable propre.

## Tranche publiée et prouvée : lots de messages entrants Meta

- Les tableaux `entry`, `changes` et `messages` acceptent maintenant plusieurs messages texte avec dix éléments maximum par niveau et cent messages maximum par requête.
- La signature HMAC du corps brut est vérifiée avant parsing. Tous les couples WABA/Phone Number ID sont prévalidés avant la première mutation; un endpoint ultérieur inconnu refuse le lot entier.
- Chaque message conserve sa provenance `wamid`, une clé d'idempotence SHA-256 propre et l'ordre de l'enveloppe. Le rejeu complet ne crée aucun message ou binding supplémentaire.
- Une même enveloppe peut résoudre plusieurs endpoints et tenants sans fusion d'identité. Les sujets restent HMAC-scopés par tenant et endpoint, et les audits ne contiennent ni numéro, contenu, timestamp ni référence fournisseur.
- La documentation officielle Meta décrit `entry`, `changes` et `messages` comme des tableaux. Le support de lots est une mesure de robustesse déduite de ce contrat; il ne prétend pas que Meta regroupera systématiquement plusieurs messages dans une requête.

## Tranche publiée et prouvée : enveloppe mixte messages + statuts Meta

- La route Meta n'essaie plus de traiter toute la requête comme un lot de statuts puis comme un lot de messages. Elle vérifie désormais le HMAC du corps brut une seule fois et distribue chaque `change` vers son schéma strict.
- Les tableaux `entry` et `changes` conservent leurs bornes de dix éléments et le total combiné messages + statuts est limité à cent événements par requête. Un changement contenant les deux familles ou aucune est refusé.
- Tous les endpoints et toutes les livraisons des deux familles sont résolus avant la première écriture. Messages entrants, bindings, événements de livraison et projections sont ensuite persistés dans une transaction système unique.
- Le rejeu complet est idempotent. Une signature altérée ne touche pas la base et une livraison inconnue annule aussi le message entrant valide du même lot.
- La réponse HTTP reste réduite à `{ ok: true }`; les audits testés ne contiennent ni contenu, numéro, Phone Number ID, `wamid` entrant ou sortant.
- Le support d'une enveloppe mixte est une mesure de robustesse fondée sur l'enveloppe générique Meta et ses tableaux; il ne prétend pas que Meta regroupera systématiquement les deux familles dans une requête.

## Tranche publiée et prouvée : médias entrants Meta sans téléchargement

- Les messages signés `image`, `audio`, `document`, `video` et `sticker` sont maintenant reconnus par des schémas stricts et bornés conformes aux objets média documentés par Meta.
- L'adaptateur ne propage après normalisation que le type média et la légende utile éventuelle. Media ID, checksum, nom de fichier, type MIME, numéro et URL fournisseur ne sont ni journalisés ni persistés.
- Le Conversation Hub conserve une notice française explicite — par exemple « Document WhatsApp en attente d’import sécurisé. » — et aucune ligne `conversation_message_attachments` tant que le média n'a pas été téléchargé de façon autorisée, contrôlé, hashé et stocké immuablement.
- Un lot signé texte + média + statut est prévalidé puis persisté atomiquement et se rejoue sans doublon. Les tests prouvent zéro appel `fetch`, zéro pièce jointe fictive et zéro métadonnée média dans les audits ou tables conversationnelles.
- Cette tranche ne prétend pas avoir importé ou analysé le fichier. Le téléchargement Graph, les contrôles effectifs de taille/type, le stockage Supabase avec ACL/checksum, l'antivirus, la transcription et l'OCR restent à réaliser avant toute activation réelle.

## Tranche publiée, CI externe bloquée : réservation durable des imports média Meta

- Chaque média signé conserve sa référence fournisseur uniquement dans une structure éphémère non sérialisable jusqu'à l'ingestion. Le message canonique et sa notice française restent inchangés.
- Les migrations runtime 105/106 et les miroirs SQL 0099/0100 ajoutent une réservation tenant-scoped liée au même endpoint Meta et au même message par relations composées, avec index tenant-leading, contraintes d'état et RLS.
- La référence fournisseur est chiffrée en AES-256-GCM avec AAD tenant/provider/endpoint/message et version de clé. Aucune colonne ne conserve en clair Media ID, MIME, checksum, nom, URL, payload ou contenu.
- `pending`, `not_configured` et `failed` sont distingués sans ambiguïté. Le rejeu exact est idempotent; une référence différente pour le même message est refusée. L'audit ne contient que provider, type média, état et indicateurs de non-contenu.
- La réservation est atomique avec le message et le binding. Aucun `fetch`, Graph, stockage, binaire ou `conversation_message_attachments` n'est ajouté.
- Les tests locaux ciblés et d'ingestion sont verts; PostgreSQL/RLS reste ignoré localement faute de `DATABASE_URL`. La tranche est publiée mais ne sera classée prouvée CI qu'après une exécution complète incluant migrations PostgreSQL, RLS, suite exhaustive et Playwright.

## Tranche applicative locale terminée : import média durable en mock

- Les migrations runtime `107/108` et miroirs SQL `0101/0102` ajoutent une exécution tenant-scoped liée par relation composée à la réservation, avec RLS, index tenant-leading, identité immuable, bail, compteur de tentatives et reprise après échec temporaire.
- Le worker vérifie le membership, l'endpoint actif et la policy avant de déchiffrer. Il ne peut appeler que des adaptateurs déclarés `mock`; `disabled` et `not_configured` terminent sans lecture ni stockage.
- Le provider mock reçoit une limite d'octets. Le cœur contrôle ensuite taille réelle, cohérence type média/type métier, signature binaire et SHA-256 avant tout stockage.
- Le stockage mock reçoit une clé d'idempotence stable. Une réussite crée dans la même transaction exactement une pièce jointe canonique; le rejeu ne refait ni fetch, ni stockage, ni insertion.
- L'écran Conversation affiche la provenance « WhatsApp », le nom et la taille du fichier et le badge « Stockage mock ». Ni checksum ni référence de stockage ne sont affichés.
- Les audits conservent seulement modes, état, classification et compteur; Media ID, nom, MIME, checksum, contenu, ciphertext et référence de stockage restent absents.
- Preuves locales : 24 tests média/migrations verts; deux tests PostgreSQL/RLS ajoutés mais ignorés sans `DATABASE_URL`; régression exhaustive 139 fichiers/672 tests verts, 8 fichiers/20 tests PostgreSQL ignorés; ESLint complet, TypeScript et build production verts. Un scénario Playwright couvre le rendu, mais son exécution attend la CI PostgreSQL partagée.
- État honnête : livré localement et mock uniquement. Aucun client Graph, stockage Supabase, antivirus, OCR/transcription, secret, message externe ou activation réelle n'est composé.

## Tranche applicative locale terminée : file média dans le worker générique

- `src/worker/runtime.ts` exécute désormais la file média après les événements durables et les rechecks, puis inclut son résumé dans le résultat et les logs structurés du batch.
- Sans dépendances injectées, l'état est `not_configured` et aucune réservation n'est sélectionnée. Si un côté est `disabled`, l'état est `disabled`; aucun fetch, stockage, journal d'exécution ou pièce jointe n'est créé.
- Seuls un provider, un stockage et un coffre tous prêts en mode `mock` autorisent la sélection. Sur PostgreSQL, la sélection globale exige explicitement le contexte système; chaque ligne conserve ensuite son `tenant_id` et est auditée sous `system_whatsapp_meta`.
- Le créateur réel de l'endpoint reste le responsable durable de l'exécution, donc la clé étrangère utilisateur existante n'est ni contournée ni affaiblie. La policy reçoit l'identité système et s'exécute avant déchiffrement ou IO.
- Le test vertical part d'un webhook Meta signé, laisse l'ingestion réserver le média, lance le worker générique, vérifie une seule pièce jointe canonique, puis relance le batch sans second fetch, stockage ou ajout.
- Preuves locales : 43 tests ciblés verts et 2 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`; suite exhaustive 139 fichiers/675 tests verts et 8 fichiers/20 tests PostgreSQL ignorés; ESLint, TypeScript, build production, continuity-check direct et `git diff --check` verts.
- État honnête : livré localement au commit `9af546df640a555c76da755bd3139ce541a1196f`, mock uniquement. Aucun bootstrap de coffre depuis l'environnement, client Graph, stockage Supabase, antivirus, OCR/transcription, secret ou effet externe.

## Tranche applicative locale terminée : scan de sécurité obligatoire avant stockage

- Le worker impose désormais la séquence provider mock → validation taille/type/signature/SHA-256 → scanner mock → stockage mock. Le scanner reçoit la même clé d'idempotence que l'activité durable et s'exécute exactement avant le stockage.
- La migration additive runtime `109_os5_channel_provider_media_security_scan` et son miroir `0103_os5_channel_provider_media_security_scan.sql` ajoutent `scanner_mode` sans réécrire la migration d'exécution. Les lignes historiques sont marquées `not_configured`; le mode devient obligatoire et immuable, et la base interdit une nouvelle transition vers `succeeded` sans scanner `mock`.
- `disabled` ou `not_configured` ferme le worker générique avant sélection et avant tout IO. Un verdict `unsafe` produit un échec de validation non rejouable sans stockage ni pièce jointe. Une panne temporaire du scanner est classée, replanifiée puis reprise avec la même idempotence; le stockage ne s'exécute qu'une fois après verdict propre.
- L'audit ne conserve que les modes et la classification sûre. Il ne contient ni octets, Media ID, checksum, nom, référence de stockage, signature de malware ou détail antivirus.
- Preuves locales finales : 30 tests ciblés verts et 2 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`; régression exhaustive 139 fichiers/678 tests verts et 8 fichiers/20 tests PostgreSQL ignorés; ESLint complet, TypeScript, build production, continuity-check direct et `git diff --check` verts. Le scénario Playwright a été adapté mais son exécution attend la CI PostgreSQL partagée.
- État honnête : livré localement au commit `ca08001929a438f94cf13c889a9f99a0425b67b8`, scanner uniquement mock. Aucun antivirus réel, Graph, stockage Supabase, OCR/transcription, secret ou effet externe n'est composé.

## Tranche applicative locale terminée : extraction `external_untrusted_data`

- Après un scan propre, le worker appelle un extracteur injecté avant le stockage. Les quatre frontières provider/scanner/extracteur/stockage doivent être `mock`; tout état `disabled` ou `not_configured` laisse la file fermée sans sélection ni IO.
- L'adaptateur d'extraction reçoit seulement les octets et métadonnées bornées. Il n'obtient aucun LLM, outil, callback de policy ou instruction système; une panne temporaire est replanifiée avec la même idempotence et aucun stockage prématuré.
- La migration runtime `110_os5_media_untrusted_extraction` et le miroir SQL `0104` rendent `extractor_mode` durable et immuable. La pièce jointe conserve une enveloppe atomique `external_untrusted_data`, la clé de l'extracteur, le texte borné, son SHA-256 et sa date; la base refuse une nouvelle réussite sans enveloppe mock complète.
- Le contenu extrait reste dans `conversation_message_attachments`, donc sous son `tenant_id` et sa politique RLS existante. Un message entrant ne peut pas fournir lui-même ces champs; seul le worker les ajoute dans la transaction finale.
- L'écran Conversation affiche le texte avec l'avertissement français « Contenu externe non fiable · extraction mock » et indique qu'il ne peut fournir ni règle ni action. Le texte adversarial testé reste absent de l'audit; hash et référence technique restent masqués.
- Preuves locales : 3 fichiers/38 tests verts et 1 fichier/3 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`; régression exhaustive 139 fichiers/681 tests verts et 8 fichiers/21 tests PostgreSQL ignorés; ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. Le scénario Playwright est prêt mais attend la CI PostgreSQL.
- État honnête : livré localement au commit `4cb9f4220cdd6e0d0b17ad3a4239e37d40c512ed`, extraction mock uniquement. Aucun extracteur/OCR/transcription, LLM, outil, Graph, stockage réel, secret ou effet externe n'est composé.

## Tranche applicative locale terminée : intégrité à la lecture et vue `data-only`

- Toute lecture canonique recalcule le SHA-256 du texte extrait. Un hash incohérent, un format invalide ou un enregistrement partiel retourne seulement `integrity: failed`; le texte et son empreinte ne quittent pas le service.
- Le contrat de sortie distingue strictement `verified` et `failed`. Conversation affiche « Extraction mock · intégrité vérifiée » pour une preuve valide et « Extraction masquée — intégrité non vérifiée. » en échec fermé.
- Une fonction séparée prépare une future vue `data-only` uniquement à partir d'une extraction vérifiée. Elle borne le contenu à 8 000 caractères, masque liens publics, adresses privées, jetons Bearer, affectations de secrets et blocs PEM, puis fixe `instructionsAllowed: false`, `toolAccess: forbidden` et `policyMutation: forbidden`.
- Cette vue n'est appelée par aucun code de production : aucun planificateur, orchestrateur, LLM ou outil n'y est raccordé. L'isolation tenant/RLS et l'immutabilité restent portées par la pièce jointe existante; aucun audit ne reçoit le texte.
- Preuves locales : 4 fichiers/40 tests ciblés verts; régression exhaustive 140 fichiers/685 tests verts et 8 fichiers/21 tests PostgreSQL ignorés sans `DATABASE_URL`; ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. Le scénario Playwright couvre contenu vérifié et altéré, mais attend la CI PostgreSQL.
- État honnête : livré localement dans `3df4f7c5f642bfca473820a4efe1f42838c3a5c5` et `15b2af7949e937b2f59a5cdd6db9728489fb1478`; mock uniquement, sans effet externe.

## Tranche applicative locale terminée : accès court aux pièces jointes

- Un ticket opaque AES-256-GCM ne contient que version, nonce et dates chiffrées; tenant, utilisateur et pièce jointe sont liés comme données associées et ne figurent pas dans le ticket. Sa durée est bornée entre 30 et 300 secondes.
- Le service revalide membership, pièce, policy et métadonnées avant toute lecture puis après l'IO. Taille et SHA-256 des octets sont recalculés avant restitution; une mutation concurrente, une expiration, une altération ou un autre acteur/tenant échoue fermé.
- La même capacité produit la même clé d'idempotence à partir du ticket. Les erreurs fournisseur sont réduites à un vocabulaire sûr; l'audit ne reçoit ni ticket, contenu, nom, checksum ni référence de stockage.
- Le stockage annonce obligatoirement `disabled`, `not_configured` ou `mock`. Le runtime de l'application reste `not_configured` et l'écran Conversation affiche « Téléchargement non configuré »; aucun bouton ou lien trompeur n'est exposé.
- Preuves locales : 5 fichiers ciblés, 50 tests verts et 1 fichier/3 tests PostgreSQL-RLS ignorés sans `DATABASE_URL`; régression exhaustive 141 fichiers/693 tests verts et 8 fichiers/21 tests PostgreSQL ignorés. ESLint complet, TypeScript, build production, continuity-check direct et diff check sont verts.
- Le scénario Playwright est adapté. Son exécution locale lance l'application mais s'arrête à l'authentification parce que serveur et test ne partagent pas PGlite; aucune assertion Conversation n'est revendiquée avant CI PostgreSQL.
- État honnête : livré localement au commit `734c8402de5183b840901bd978777d3fb9d16a84`, mock uniquement par injection de test. Aucun stockage réel, URL durable, Graph, secret ou effet externe.

## Tranche applicative locale terminée : frontière HTTP/session des pièces jointes

- Une route Conversation same-origin expose `POST` pour préparer un ticket court puis `PUT` pour le consommer. La session et le tenant sont résolus avant le service; l'origine, l'identifiant de chemin et la méthode sont refusés en amont lorsqu'ils sont invalides.
- Le ticket transite uniquement dans un JSON UTF-8 strict borné à 4 Kio, jamais dans l'URL. Les réponses françaises distinguent accès prêt, refusé, désactivé, non configuré et indisponibilité sans exposer de code interne.
- Toutes les réponses sont privées et non mises en cache, avec `no-referrer`, `nosniff` et corrélation. Le téléchargement binaire fixe type, taille et nom assaini en variantes ASCII et UTF-8.
- La route de production délègue au service canonique avec runtime `not_configured` par défaut. Aucun client Graph, stockage réel, clé, URL durable ou message externe n'est ajouté.
- Preuves : 17 tests HTTP adversariaux et 1 intégration réelle handler → service → stockage mock → audit; ciblés finaux 3 fichiers/26 tests; régression ciblée 5 fichiers/61 tests avec 1 fichier/3 tests PostgreSQL ignorés; suite exhaustive source 142 fichiers/710 tests verts avec 8 fichiers/21 tests PostgreSQL ignorés. ESLint, TypeScript, build production, continuity-check et diff check sont verts.
- État honnête : livré localement aux commits `e24356f951a46abaf8cd5f95a37362463f778c0f` et `422317e8452b3cecea9c0514b8306787e65c6bee`, uniquement avec doubles mock en test et zéro IO externe.

## Tranche applicative locale terminée : confidentialité et visibilité héritées

- La migration additive runtime `111_os5_conversation_thread_access_classification` et son miroir SQL `0105` ajoutent au fil canonique une confidentialité `public`/`internal`/`restricted`/`secret` et une portée `personal`/`team`/`case`/`tenant`, non nulles, contraintes et indexées avec le tenant.
- Les fils historiques sont mis à niveau vers les valeurs sûres `internal` et `tenant`. Les créations du service les écrivent explicitement; lectures unitaires et listes les restituent.
- L'écran Conversation affiche en français « Confidentialité : Interne » et « Visibilité : Organisation ». Le scénario Playwright couvre ces états mais attend PostgreSQL partagé pour être exécuté.
- L'accès à une pièce jointe joint désormais pièce, message et fil par clés tenant. La policy reçoit obligatoirement identifiant du fil, confidentialité et visibilité à la préparation puis à la lecture; toute modification pendant l'IO invalide le résultat avant restitution.
- Le test PostgreSQL restreint couvre lecture propre, invisibilité et mutation cross-tenant, et insertion dans un autre tenant; il est prêt mais ignoré localement faute de `DATABASE_URL`. La RLS existante de `conversation_threads` demeure fail-closed.
- Preuves : ciblés 5 fichiers/21 tests verts et 1 fichier/1 test PostgreSQL ignoré; régression Conversation/Meta/média 19 fichiers/151 tests verts et 2 fichiers/4 tests PostgreSQL ignorés; suite exhaustive 144 fichiers/715 tests verts et 9 fichiers/22 tests PostgreSQL ignorés. ESLint, TypeScript, build production et diff check sont verts.
- État honnête : livré localement au commit `8900ac5836c504c970d32ee88f8f87bdb515a591`. Les providers restent `not_configured`/mock; aucun stockage réel, Graph, secret ou effet externe.

## Correctif de sécurité CI publié et prouvé

- La CI `33628923602` du head média s'est arrêtée au contrôle des dépendances, avant migrations, tests ou build, sur deux avis élevés affectant `browserslist <= 4.28.6`.
- Une surcharge locale et bornée verrouille la dépendance transitive à `browserslist 4.28.7`, version corrigée indiquée par l'avis. Le lockfile ne modifie aucune API applicative.
- `pnpm audit --prod --audit-level high` retourne « No known vulnerabilities found ». La CI complète `33661150567` confirme audit, migrations, backup/restauration, RLS, lint, typecheck, 144 fichiers/674 tests, build et 20 Playwright.

## Référence prompt maître

Les pages 10-24, 26-33, 34-38, 46, 48 et 64-69 imposent Conversation Hub canonique, signature avant parsing, schémas d'entrée bornés, médias externes non fiables, identité opaque tenant-aware, action durable, idempotence, audit sans contenu sensible et tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 exigent encore la CI complète de la tranche puis le checkpoint fournisseur avant de classer OS-5 terminé.

## Prochaine action concrète

1. Obtenir l'ordre explicite « publie et lance la CI » pour publier les vingt-et-un commits locaux après le handoff et déclencher une nouvelle CI sans supprimer, ignorer ni affaiblir `pnpm audit`.
2. Vérifier que le head distant est encore exactement `28efa750935b2766de3410b8d9c0d5e3c4e2dbe8`, puis pousser uniquement en fast-forward les fichiers contrôlés; conserver `tmp/` hors index.
3. Exiger une CI verte incluant migrations PostgreSQL, RLS et le nouveau scénario Playwright avant de classer l'import média prouvé CI.
4. Sans publication, prochaine tranche locale non bloquée : propager les autorisations du fil aux plans Conversation — création, lecture, liste, décision, exécution et reprise — afin que les workflows OS-1/OS-4 refusent `personal`/`team`/`case` sans droit actif, avec tests de révocation et sans démarrer OS-6.
5. Le checkpoint fournisseur reste la saisie du code SMS directement dans Meta par l'utilisateur, qui indique ensuite seulement que l'étape est terminée; ne jamais transmettre le code dans le chat.
6. Dans la console officielle, inventorier l'application, le WABA et le Phone Number ID. Demander une confirmation au moment exact avant toute création d'un token persistant.
7. Une requête Graph réelle, un stockage Supabase réel, un webhook public, un message de preuve, une activation, un déploiement ou une dépense nécessitent une autorisation distincte.

## Validation disponible

- Autorisations durables des fils : migrations 112/113 et miroirs 0106/0107, configuration idempotente propriétaire/administrateur, filtrage des fils/messages et pièce jointe fermée sur révocation. Après le dernier durcissement RLS, 6 fichiers ciblés verts et 1 PostgreSQL ignoré, 27 tests verts et 1 ignoré sans `DATABASE_URL`; ESLint ciblé et TypeScript verts. Avant ce changement SQL final, régression Conversation/Meta/média 21 fichiers/158 tests verts avec 3 fichiers/5 tests ignorés; suite exhaustive 146 fichiers/722 tests verts avec 10 fichiers/23 tests ignorés; lint complet et build production verts. PostgreSQL/RLS et Playwright doivent être confirmés par CI.
- Classification des fils locale : ciblés 5 fichiers/21 tests verts et 1 fichier/1 test PostgreSQL ignoré; régression Conversation/Meta/média 19 fichiers/151 tests verts et 2 fichiers/4 tests PostgreSQL ignorés. La suite exhaustive termine à 144 fichiers/715 tests verts et 9 fichiers/22 tests PostgreSQL ignorés; ESLint, TypeScript, build production, continuity-check et diff check sont verts. Le scénario Playwright des badges français est adapté mais attend la CI PostgreSQL partagée.
- Frontière HTTP/session locale : 17 tests adversariaux et 1 intégration verticale; ciblés finaux 3 fichiers/26 tests verts; régression ciblée 5 fichiers/61 tests verts avec 1 fichier/3 tests PostgreSQL ignorés. La suite exhaustive source termine à 142 fichiers/710 tests verts et 8 fichiers/21 tests PostgreSQL ignorés; ESLint, TypeScript, build production avec route inventoriée, continuity-check et diff check sont verts. PostgreSQL/RLS et Playwright attendent la CI partagée.
- Accès pièce jointe local : 5 fichiers conversation/média réussis, 1 fichier PostgreSQL/RLS ignoré, 50 tests réussis et 3 ignorés faute de `DATABASE_URL`; régression exhaustive 141 fichiers/693 tests verts et 8 fichiers/21 tests PostgreSQL ignorés. ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. Playwright est bloqué avant Conversation par l'absence de PostgreSQL partagé entre ses processus locaux.
- Intégrité d'extraction locale : 4 fichiers/40 tests ciblés verts; régression exhaustive 140 fichiers/685 tests verts et 8 fichiers/21 tests PostgreSQL ignorés sans `DATABASE_URL`; ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. Le scénario Playwright positif/négatif est adapté et attend la CI.
- Extraction non fiable locale : 3 fichiers/38 tests ciblés verts, 1 fichier/3 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`; régression exhaustive 139 fichiers/681 tests verts et 8 fichiers/21 tests PostgreSQL ignorés; ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. PostgreSQL/RLS et Playwright attendent la publication explicitement ordonnée puis la CI.
- Scanner média local : 2 fichiers/30 tests ciblés verts, 1 fichier/2 tests PostgreSQL/RLS ignorés sans `DATABASE_URL`; régression exhaustive 139 fichiers/678 tests verts et 8 fichiers/20 tests PostgreSQL ignorés; ESLint complet, TypeScript, build production, continuity-check direct et diff check verts. PostgreSQL/RLS et Playwright attendent la publication explicitement ordonnée puis la CI.
- Régression coffre/Meta : 14 fichiers réussis, 2 fichiers PostgreSQL ignorés, 91 tests réussis et 2 ignorés faute de `DATABASE_URL`.
- Migrations PGlite : base neuve et mise à niveau depuis runtime 101 validées; mauvais couple endpoint/provider refusé.
- ESLint complet, TypeScript et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour charger les polices Google requises.
- La régression exhaustive locale la plus récente est verte : 141 fichiers et 693 tests réussis; 8 fichiers/21 tests PostgreSQL sont ignorés faute de `DATABASE_URL`. `pnpm db:verify` refuse correctement sans cette variable.
- La CI `33422211572` lève ces limites : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/651 tests, build production et 20 Playwright verts. La continuité `33422211485` est verte.
- Correctif enveloppe : 4 fichiers/24 tests ciblés puis 17 fichiers/108 tests de régression verts localement; ESLint complet, TypeScript, build production, continuity-check et `git diff --check` verts.
- La CI `33425435804` est verte : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/653 tests, build production et 20 Playwright. La continuité `33425435724` est verte.
- Le head documentaire final `cb3e50b` est également entièrement prouvé par la CI `33427555175` et la continuité `33427555275`; la PR est revenue à `CLEAN`.
- Le checkpoint publié `b5a0fe3` est entièrement prouvé par la CI `33430233674` et la continuité `33430233673`.
- Tranche statut locale : 4 fichiers/27 tests statut-migrations-HTTP puis 15 fichiers/97 tests Meta verts; ESLint ciblé et complet, TypeScript, build production, continuity-check et `git diff --check` verts. PostgreSQL/RLS et la suite exhaustive restent à confirmer par CI sur le futur head.
- La tranche statut publiée est prouvée par CI `33460999183` : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, suite exhaustive, build production et Playwright verts; continuité `33460999408` verte.
- La tranche de lots de statuts publiée est prouvée par CI `33463499865` : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, suite exhaustive, build production et Playwright verts; continuité `33463499881` verte.
- Tranche entrante locale : 2 fichiers/13 tests ciblés verts; régression Meta 13 fichiers réussis, 3 fichiers PostgreSQL ignorés, 96 tests réussis et 3 ignorés faute de `DATABASE_URL`. ESLint ciblé et complet, TypeScript, build production, continuity-check et `git diff --check` sont verts.
- La tranche entrante publiée est prouvée par CI `33473526862` : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, suite exhaustive, build production et Playwright verts; continuité `33473526866` verte.
- Tranche mixte locale : test dédié 5/5 vert; régression ingress/webhook 6 fichiers/41 tests verts; régression Meta/coffre 18 fichiers/120 tests verts et 2 fichiers/2 tests PostgreSQL ignorés faute de `DATABASE_URL`. ESLint complet, TypeScript, build production, continuity-check et `git diff --check` sont verts.
- La tranche mixte publiée est prouvée par la CI `33523760105` : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 144 fichiers/670 tests, build production et 20 Playwright verts; continuité `33523760887` verte.
- Tranche média locale : les nouveaux tests des cinq types, du média invalide, du non-téléchargement, de l'absence de pièce jointe et du lot texte+média+statut passent. La régression élargie compte 122 tests réussis et 2 PostgreSQL ignorés; deux timeouts dus aux sauts d'horloge locaux ont été relancés isolément et passent. ESLint complet, TypeScript, build production, continuity-check direct et `git diff --check` sont verts.
- Publication média `41c2fc8` : continuité `33628923623` verte; CI `33628923602` rouge uniquement au contrôle préalable des dépendances sur `browserslist 4.28.5`. Correctif local `4.28.7` et audit production sans vulnérabilité connue; nouvelle CI requise.
- Correctif publié `44350ec` : CI `33661150567` entièrement verte avec audit, migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 144 fichiers/674 tests, build et 20 Playwright; continuité `33661150706` verte.
- Parent publié `232f60a` : CI `33674098147` et continuité `33674098123` vertes; PR #11 ouverte, brouillon et `MERGEABLE/CLEAN` avant la tranche locale.
- Réservation média locale : 4 fichiers ciblés réussis, 1 fichier PostgreSQL/RLS ignoré, 17 tests réussis et 1 ignoré; ingestion complète 13/13 verte. La régression Meta élargie compte 19 fichiers et 135 tests réussis; deux timeouts d'horloge locale ont chacun repassé isolément. ESLint complet, TypeScript, build production et `git diff --check` sont verts.
- `pnpm agent:continuity-check` a été tenté mais le lanceur pnpm a voulu réinstaller sans réseau/TTY; le script versionné direct est `ready`, zéro erreur et zéro avertissement. PostgreSQL/RLS, suite exhaustive et Playwright restent à prouver par CI sur le futur head.
- Publication `28efa75` : continuité `33826756891` verte. La CI `33826756939`, tentatives 1 et 2, a expiré au POST vers l'API npm advisories après retries, avant migrations/tests; la reproduction locale rencontre le même timeout. Aucun avis de vulnérabilité ou échec applicatif n'est déduit de cette panne externe.
- Troisième relance non exécutée : le contrôleur d'autorisation a échoué sur une erreur réseau et exige une approbation utilisateur explicite; aucun contournement ou déclenchement indirect n'est autorisé.
- La suite exhaustive locale la plus récente a terminé en 566 secondes avec 141 fichiers/693 tests verts. La CI du futur head doit encore apporter la preuve PostgreSQL/RLS et Playwright.
- `git diff --check` est vert.

## État de vérité

- Livré et prouvé CI : coffre chiffré Meta provider-scoped, migrations, rotation/révocation, résolveurs, audit sûr et tests.
- Livré et prouvé CI : compatibilité de l'enveloppe webhook officielle et clés internes hashées.
- Livré et prouvé CI : notifications de statut Meta signées, idempotentes, monotones et sans PII.
- Livré et prouvé CI : traitement borné et atomique des lots `statuses` Meta.
- Livré et prouvé CI : traitement borné, prévalidé, atomique et multi-tenant des lots de messages entrants Meta.
- Livré et prouvé CI : dispatch mixte messages/statuts après un seul HMAC, borne globale, prévalidation commune et transaction unique.
- Livré et prouvé CI : notices françaises pour cinq types média signés, sans téléchargement Graph, pièce jointe fictive ni métadonnée média persistée.
- Livré et publié, CI externe bloquée : réservation d'import média tenant/RLS, référence fournisseur chiffrée, états explicites, rejeu/collision et audit sans contenu.
- Livré localement, CI non déclenchée : worker média, scan obligatoire, extraction `external_untrusted_data` persistée/immuable, contrôle SHA-256 à la lecture, vue `data-only` non raccordée, accès court chiffré, frontière HTTP/session et classification durable confidentialité/visibilité héritée par la policy; états français et doubles mock uniquement.
- Réel connecté : aucun fournisseur; aucune clé réelle enregistrée.
- Sandbox : aucune configurée ou appelée.
- Mock : transport Meta injecté uniquement dans les tests, sans réseau.
- Bloqué humain : code SMS Meta, puis création/inventaire app-WABA-numéro et stockage direct des secrets.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, dont tmp/ non suivi.
2. Vérifier PDF/SHA-256/71 pages, les pages cœur et OS-5, puis pnpm agent:continuity-check.
3. Le head 28efa75 est publié et sa continuité 33826756891 est verte. Le commit local 8d6e329 ajoute les autorisations durables personal/team/case, leur RLS et leur application aux fils/messages/pièces jointes; la branche sera en avance de vingt-et-un commits après le handoff. La CI 33826756939 a expiré deux fois sur l'API d'audit npm avant migrations/tests; demander l'approbation explicite pour publier et relancer, sans contourner l'audit.
4. L'onglet Meta for Developers attend le code SMS saisi directement par l'utilisateur; ne demander ni afficher le code.
5. Après validation Meta, demander une confirmation au moment exact avant la création d'un token persistant et stocker les valeurs uniquement via références serveur.
6. Ne déclencher ni Graph, message, endpoint public, déploiement, fusion ou dépense sans autorisation distincte.
7. Sans publication, propager les droits de fil aux plans Conversation OS-1/OS-4 : création, lecture, liste, décision, exécution et reprise doivent échouer sans droit actif; ne pas démarrer goal-watch/OS-6.
8. Maintenir français visible, tenant/RLS, idempotence, actions durables, audit sans PII et états disabled/not_configured/mock honnêtes.
```
