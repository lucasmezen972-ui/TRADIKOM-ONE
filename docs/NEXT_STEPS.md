# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements. `tmp/` reste non suivi et strictement hors commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 13-22, 26-38 et 64-68 ont été relues directement le 1er septembre 2026; les pages 48 et 69 ont été contrôlées visuellement.
- Le head local et distant publié est `9551f608203db2671fdc5d853a8c2c11231efd2a`. La PR #11 est ouverte, brouillon et `MERGEABLE/CLEAN`; la CI `33460999183` et la continuité `33460999408` sont vertes sur ce head.
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

## Tranche locale en validation : lots de statuts Meta

- Les tableaux `entry`, `changes` et `statuses` restent stricts mais acceptent plusieurs événements dans des bornes explicites : dix éléments par niveau et cent statuts par requête.
- La signature HMAC est vérifiée une seule fois avant parsing. Chaque statut est ensuite normalisé et corrélé au même provider et au bon endpoint tenant-aware.
- Toutes les références endpoint/livraison sont prévalidées avant la première écriture. Une référence inconnue dans le lot refuse l'ensemble sans événement ni audit partiel.
- Le replay du lot ne crée aucun doublon; les projections restent monotones et chaque événement conserve sa clé durable propre.

## Référence prompt maître

Les pages 13-22, 26-33, 35-38, 46, 48 et 64-69 imposent signature avant parsing, schémas d'entrée bornés, identité opaque tenant-aware, chiffrement des credentials, action durable, idempotence, audit sans contenu sensible et tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 exigent encore le checkpoint fournisseur avant de classer OS-5 terminé.

## Prochaine action concrète

1. Réconcilier le head distant `9551f60`, commiter uniquement les fichiers contrôlés de la tranche de lots Meta et pousser en fast-forward sans `tmp/`.
2. Attendre la CI PostgreSQL/RLS, la suite complète, le build et Playwright du nouveau head; ne pas déclarer la tranche prouvée CI avant ces résultats.
3. Le checkpoint fournisseur reste la saisie du code SMS directement dans Chrome par l'utilisateur, qui indique ensuite seulement que l'étape est terminée; ne jamais transmettre le code dans le chat.
4. Dans la console officielle, inventorier l'application, le WABA et le Phone Number ID. Demander une confirmation au moment exact avant toute création d'un token persistant.
5. Une requête Graph réelle, un webhook public, un message de preuve, une activation, un déploiement ou une dépense nécessitent une autorisation distincte.

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
- Tranche lots locale : 2 fichiers/20 tests ciblés puis 14 fichiers/96 tests Meta verts, 1 test PostgreSQL ignoré sans `DATABASE_URL`; ESLint ciblé et complet, TypeScript, build production, continuity-check et `git diff --check` verts. La CI du futur head reste à obtenir.
- `git diff --check` est vert.

## État de vérité

- Livré et prouvé CI : coffre chiffré Meta provider-scoped, migrations, rotation/révocation, résolveurs, audit sûr et tests.
- Livré et prouvé CI : compatibilité de l'enveloppe webhook officielle et clés internes hashées.
- Livré et prouvé CI : notifications de statut Meta signées, idempotentes, monotones et sans PII.
- Livré localement, preuve CI en attente : traitement borné et atomique des lots `statuses` Meta.
- Réel connecté : aucun fournisseur; aucune clé réelle enregistrée.
- Sandbox : aucune configurée ou appelée.
- Mock : transport Meta injecté uniquement dans les tests, sans réseau.
- Bloqué humain : code SMS Meta, puis création/inventaire app-WABA-numéro et stockage direct des secrets.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, dont tmp/ non suivi.
2. Vérifier PDF/SHA-256/71 pages, les pages cœur et OS-5, puis pnpm agent:continuity-check.
3. Le head publié 9551f60 est vert (CI 33460999183, continuité 33460999408). La tranche locale de lots Meta doit finir ses validations, être publiée en fast-forward sans tmp/, puis être prouvée en CI PostgreSQL/RLS.
4. L'onglet Meta for Developers attend le code SMS saisi directement par l'utilisateur; ne demander ni afficher le code.
5. Après validation Meta, demander une confirmation au moment exact avant la création d'un token persistant et stocker les valeurs uniquement via références serveur.
6. Ne déclencher ni Graph, message, endpoint public, déploiement, fusion ou dépense sans autorisation distincte.
7. Maintenir français visible, tenant/RLS, idempotence, actions durables, audit sans PII et états disabled/not_configured/mock honnêtes.
```
