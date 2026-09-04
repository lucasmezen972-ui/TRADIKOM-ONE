# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements. `tmp/` reste non suivi et strictement hors commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 10-14, 22-24, 26-29, 34-38 et 64-68 ont été relues directement le 2 septembre 2026; les pages 48 et 69 ont été contrôlées visuellement.
- Le parent local et distant publié est `232f60a4530b2a54dd1aee3ce7be75ecc7d6f45a`. La PR #11 est ouverte, brouillon et `MERGEABLE/CLEAN`; la CI `33674098147` et la continuité `33674098123` sont entièrement vertes. La réservation média est terminée localement et sa CI reste à obtenir sur le futur head.
- L'utilisateur autorise la configuration des clés Meta, mais pas leur passage dans le chat, les logs, Git ou le modèle. L'inscription Meta for Developers est ouverte dans Chrome et attend le code SMS à six chiffres saisi directement par l'utilisateur; le bouton Continuer est encore désactivé.

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

## Tranche locale terminée : réservation durable des imports média Meta

- Chaque média signé conserve sa référence fournisseur uniquement dans une structure éphémère non sérialisable jusqu'à l'ingestion. Le message canonique et sa notice française restent inchangés.
- Les migrations runtime 105/106 et les miroirs SQL 0099/0100 ajoutent une réservation tenant-scoped liée au même endpoint Meta et au même message par relations composées, avec index tenant-leading, contraintes d'état et RLS.
- La référence fournisseur est chiffrée en AES-256-GCM avec AAD tenant/provider/endpoint/message et version de clé. Aucune colonne ne conserve en clair Media ID, MIME, checksum, nom, URL, payload ou contenu.
- `pending`, `not_configured` et `failed` sont distingués sans ambiguïté. Le rejeu exact est idempotent; une référence différente pour le même message est refusée. L'audit ne contient que provider, type média, état et indicateurs de non-contenu.
- La réservation est atomique avec le message et le binding. Aucun `fetch`, Graph, stockage, binaire ou `conversation_message_attachments` n'est ajouté.
- Les tests locaux ciblés et d'ingestion sont verts; PostgreSQL/RLS reste ignoré localement faute de `DATABASE_URL`. La CI du futur head doit confirmer migrations PostgreSQL, RLS, suite exhaustive et Playwright avant de classer cette tranche prouvée CI.

## Correctif de sécurité CI publié et prouvé

- La CI `33628923602` du head média s'est arrêtée au contrôle des dépendances, avant migrations, tests ou build, sur deux avis élevés affectant `browserslist <= 4.28.6`.
- Une surcharge locale et bornée verrouille la dépendance transitive à `browserslist 4.28.7`, version corrigée indiquée par l'avis. Le lockfile ne modifie aucune API applicative.
- `pnpm audit --prod --audit-level high` retourne « No known vulnerabilities found ». La CI complète `33661150567` confirme audit, migrations, backup/restauration, RLS, lint, typecheck, 144 fichiers/674 tests, build et 20 Playwright.

## Référence prompt maître

Les pages 10-24, 26-33, 34-38, 46, 48 et 64-69 imposent Conversation Hub canonique, signature avant parsing, schémas d'entrée bornés, médias externes non fiables, identité opaque tenant-aware, action durable, idempotence, audit sans contenu sensible et tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 exigent encore la CI complète de la tranche puis le checkpoint fournisseur avant de classer OS-5 terminé.

## Prochaine action concrète

1. Publier la réservation média seulement après une ultime réconciliation fast-forward, puis exiger une CI verte incluant PostgreSQL/RLS avant de la classer prouvée.
2. Avant la tranche suivante, relire les pages 11, 14, 22-23, 32, 48, 64-65 et 69 et actualiser `masterPrompt.alignment` pour le traitement différé des réservations.
3. Préparer sans réseau réel le contrat provider/storage et un journal durable des tentatives : déchiffrement tenant-scoped, limites taille/type, checksum, états explicites, compensation et doubles mock. Ne créer une pièce jointe canonique qu'après une preuve de stockage contrôlé.
4. Le checkpoint fournisseur reste la saisie du code SMS directement dans Meta par l'utilisateur, qui indique ensuite seulement que l'étape est terminée; ne jamais transmettre le code dans le chat.
5. Dans la console officielle, inventorier l'application, le WABA et le Phone Number ID. Demander une confirmation au moment exact avant toute création d'un token persistant.
6. Une requête Graph réelle, un stockage Supabase réel, un webhook public, un message de preuve, une activation, un déploiement ou une dépense nécessitent une autorisation distincte.

## Validation disponible

- Régression coffre/Meta : 14 fichiers réussis, 2 fichiers PostgreSQL ignorés, 91 tests réussis et 2 ignorés faute de `DATABASE_URL`.
- Migrations PGlite : base neuve et mise à niveau depuis runtime 101 validées; mauvais couple endpoint/provider refusé.
- ESLint complet, TypeScript et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour charger les polices Google requises.
- `pnpm test` exhaustif local est resté silencieux et a été interrompu sans assertion en échec; `pnpm db:verify` refuse correctement sans `DATABASE_URL`.
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
- `pnpm test` exhaustif local est resté silencieux plus de trois minutes et a été interrompu sans assertion en échec; il n'est pas présenté comme vert. La CI du futur head doit apporter la preuve exhaustive, PostgreSQL/RLS et Playwright.
- `git diff --check` est vert.

## État de vérité

- Livré et prouvé CI : coffre chiffré Meta provider-scoped, migrations, rotation/révocation, résolveurs, audit sûr et tests.
- Livré et prouvé CI : compatibilité de l'enveloppe webhook officielle et clés internes hashées.
- Livré et prouvé CI : notifications de statut Meta signées, idempotentes, monotones et sans PII.
- Livré et prouvé CI : traitement borné et atomique des lots `statuses` Meta.
- Livré et prouvé CI : traitement borné, prévalidé, atomique et multi-tenant des lots de messages entrants Meta.
- Livré et prouvé CI : dispatch mixte messages/statuts après un seul HMAC, borne globale, prévalidation commune et transaction unique.
- Livré et prouvé CI : notices françaises pour cinq types média signés, sans téléchargement Graph, pièce jointe fictive ni métadonnée média persistée.
- Livré localement, CI en attente : réservation d'import média tenant/RLS, référence fournisseur chiffrée, états explicites, rejeu/collision et audit sans contenu.
- Réel connecté : aucun fournisseur; aucune clé réelle enregistrée.
- Sandbox : aucune configurée ou appelée.
- Mock : transport Meta injecté uniquement dans les tests, sans réseau.
- Bloqué humain : code SMS Meta, puis création/inventaire app-WABA-numéro et stockage direct des secrets.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, dont tmp/ non suivi.
2. Vérifier PDF/SHA-256/71 pages, les pages cœur et OS-5, puis pnpm agent:continuity-check.
3. Le parent 232f60a est vert en CI 33674098147 et continuité 33674098123. La réservation durable tenant/RLS et chiffrée est prête localement; sa CI complète reste requise.
4. L'onglet Meta for Developers attend le code SMS saisi directement par l'utilisateur; ne demander ni afficher le code.
5. Après validation Meta, demander une confirmation au moment exact avant la création d'un token persistant et stocker les valeurs uniquement via références serveur.
6. Ne déclencher ni Graph, message, endpoint public, déploiement, fusion ou dépense sans autorisation distincte.
7. Après CI verte, reprendre le contrat provider/storage et le journal durable des tentatives avec doubles mock, sans Graph ni stockage réel avant autorisation distincte.
8. Maintenir français visible, tenant/RLS, idempotence, actions durables, audit sans PII et états disabled/not_configured/mock honnêtes.
```
