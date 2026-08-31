# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements. `tmp/` reste non suivi et strictement hors commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 et les pages OS-5 17-22, 26-30, 35-38 et 64-68 ont été relues directement le 31 août 2026; les pages 29, 32, 37, 48, 64 et 69 ont été contrôlées visuellement.
- Le head fonctionnel local et distant publié est `f99b5f39e4dd1dfe116df60c7969f815513a8084`. La PR #11 est ouverte, brouillon et `MERGEABLE/CLEAN`; la CI `33422211572` et la continuité `33422211485` sont vertes sur ce head.
- L'utilisateur autorise la configuration des clés Meta, mais pas leur passage dans le chat, les logs, Git ou le modèle. L'inscription Meta for Developers est ouverte dans Chrome et attend le code SMS à six chiffres saisi directement par l'utilisateur; le bouton Continuer est encore désactivé.

## Tranche locale terminée : coffre chiffré WhatsApp Meta

- La migration additive runtime `103_os5_channel_provider_secret_versions_meta` et son miroir SQL `0097_os5_channel_provider_secret_versions_meta.sql` autorisent uniquement `whatsapp_twilio` et `whatsapp_meta`.
- Une clé étrangère composée `(tenant_id, endpoint_id, provider)` empêche d'attacher une version de secret Meta à un endpoint Twilio, et inversement. Les politiques RLS existantes restent inchangées; aucun grant Data API public n'est ajouté.
- Le repository et le service sont explicitement provider-scoped. Le chemin Twilio reste compatible.
- Les payloads endpoint Meta — WABA, token d'accès, Phone Number ID, version Graph, secret d'application et jeton de vérification — et la destination sont chiffrés en AES-256-GCM avec contexte tenant/provider/endpoint/identité/portée/version.
- Rotation, rejeu, collision d'idempotence, révocation monotone, endpoint actif, identité Meta liée, membership administrateur et refus cross-tenant sont contrôlés.
- Les résolveurs ne rendent les credentials et la destination qu'en mémoire serveur. Les audits n'enregistrent ni token, secret, numéro, contenu ni ciphertext.
- Le branchement au transport Meta est prouvé uniquement avec un `fetch` factice et l'état `mock`; aucune requête Graph réelle ni message externe n'a été produit.

## Référence prompt maître

Les pages 17-22, 26-33, 35-38, 46, 48 et 64-69 imposent le chiffrement des credentials, tenant/RLS, rotation/révocation, action durable, états fournisseur honnêtes, audit sans contenu sensible et tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 exigent encore la preuve PostgreSQL/RLS de CI et le checkpoint fournisseur avant de classer OS-5 terminé.

## Prochaine action concrète

1. L'utilisateur saisit le code SMS directement dans Chrome puis indique seulement que l'étape est terminée; ne jamais transmettre le code dans le chat.
2. Dans la console officielle, inventorier l'application, le WABA et le Phone Number ID. Demander une confirmation au moment exact avant toute création d'un token persistant.
3. Injecter les valeurs réelles par références de gestionnaire de secrets côté serveur, sans les lire, afficher, journaliser ou commiter. Conserver le provider `not_configured`/`awaiting_human_auth` tant que la composition n'est pas complète.
4. Une requête Graph réelle, un webhook public, un message de preuve, une activation, un déploiement ou une dépense nécessitent une autorisation distincte; aucune de ces actions n'est couverte par l'autorisation de stocker les clés.

## Validation disponible

- Régression coffre/Meta : 14 fichiers réussis, 2 fichiers PostgreSQL ignorés, 91 tests réussis et 2 ignorés faute de `DATABASE_URL`.
- Migrations PGlite : base neuve et mise à niveau depuis runtime 101 validées; mauvais couple endpoint/provider refusé.
- ESLint complet, TypeScript et build Next.js production verts. Le build a été relancé hors sandbox uniquement pour charger les polices Google requises.
- `pnpm test` exhaustif local est resté silencieux et a été interrompu sans assertion en échec; `pnpm db:verify` refuse correctement sans `DATABASE_URL`.
- La CI `33422211572` lève ces limites : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, 142 fichiers/651 tests, build production et 20 Playwright verts. La continuité `33422211485` est verte.
- `git diff --check` est vert.

## État de vérité

- Livré et prouvé CI : coffre chiffré Meta provider-scoped, migrations, rotation/révocation, résolveurs, audit sûr et tests.
- Réel connecté : aucun fournisseur; aucune clé réelle enregistrée.
- Sandbox : aucune configurée ou appelée.
- Mock : transport Meta injecté uniquement dans les tests, sans réseau.
- Bloqué humain : code SMS Meta, puis création/inventaire app-WABA-numéro et stockage direct des secrets.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, fusion, production, DNS et dépense.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, dont tmp/ non suivi.
2. Vérifier PDF/SHA-256/71 pages, les pages cœur et OS-5, puis pnpm agent:continuity-check.
3. Le coffre Meta est publié au head f99b5f3; CI 33422211572 et continuité 33422211485 sont vertes.
4. L'onglet Meta for Developers attend le code SMS saisi directement par l'utilisateur; ne demander ni afficher le code.
5. Après validation Meta, demander une confirmation au moment exact avant la création d'un token persistant et stocker les valeurs uniquement via références serveur.
6. Ne déclencher ni Graph, message, endpoint public, déploiement, fusion ou dépense sans autorisation distincte.
7. Maintenir français visible, tenant/RLS, idempotence, actions durables, audit sans PII et états disabled/not_configured/mock honnêtes.
```
