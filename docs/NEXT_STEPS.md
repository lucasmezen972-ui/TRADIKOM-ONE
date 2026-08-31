# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements suivis et non suivis. `tmp/` reste strictement exclu de tout commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement le 31 août 2026.
- La réconciliation autorisée avec `main` est publiée par `64192145e13f4fb0e61fe3e6bea7eb95548b4ede`. Les migrations `main` 067-078 / SQL 0061-0072 sont préservées et les migrations OS sont renumérotées 079-102 / SQL 0073-0096.
- Le head fonctionnel local et distant publié est `02584ba0712c8593db40145fb73424d729ddd0fe`. La PR #11 est ouverte, brouillon et `MERGEABLE/CLEAN`.
- La CI `33414636126` et la continuité `33414636345` sont vertes sur ce head, y compris PostgreSQL/RLS, suite complète, build production et Playwright.

## Tranche livrée : flux WhatsApp Cloud Meta, sans activation

- Les migrations runtime 100-102 et leurs miroirs SQL 0094-0096 autorisent les livraisons `whatsapp_meta`, ajoutent une liaison opaque endpoint-identité, une contrainte d'écriture protectrice et les politiques RLS tenant-aware.
- L'ingress réserve cette liaison par tenant et endpoint; un contact rattaché à un numéro Meta ne peut pas être envoyé depuis un autre endpoint du même tenant.
- L'adaptateur sortant est fail-closed. La frontière HTTP Graph est implémentée avec `fetch` injecté, résolveurs éphémères tenant/endpoint-scoped, URL et réponse bornées; aucune composition réseau réelle n'existe.
- Le registre préparé reste `disabled`/`not_configured`/`awaiting_human_auth` et `transportEnabled: false`. Un état `ready` synthétique exige aussi un transport explicite, sinon l'adaptateur retourne `not_configured`.
- Le service réserve durablement avant effet, applique la policy, respecte l'idempotence, gère claim/lease/retry/backoff et audite sans contenu sensible.
- Le worker ne prend que les livraisons Meta dues, avec appartenance tenant vérifiée et limite bornée.
- Aucun compte, application, WABA, numéro Meta, token, endpoint public, client Graph, message externe, dépense, fusion de PR ou déploiement n'a été créé.

## Référence prompt maître

Les pages 13-18, 22, 26-33, 35-38, 46, 48 et 64-69 du prompt maître imposent le parcours conversation-first, l'action durable, la réservation avant effet, tenant/RLS, l'idempotence, l'audit sans contenu sensible, un état fournisseur honnête et les tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 sont satisfaites pour la tranche logicielle et CI; elles imposent comme prochaine action d'attendre l'autorisation humaine avant toute preuve fournisseur externe.

## Prochaine action concrète

1. Ajouter la migration runtime 103 et son miroir SQL 0097 pour autoriser `whatsapp_meta` dans `channel_provider_secret_versions` sans modifier les migrations déjà appliquées ni affaiblir les clés composites/RLS.
2. Généraliser les repositories et le service de secrets actuellement figés sur `whatsapp_twilio` avec un provider explicite, tout en conservant les contrats Twilio existants.
3. Ajouter les schémas Meta endpoint/identité et les résolveurs tenant/endpoint-scoped, testés exclusivement avec keyring et données factices; aucune lecture d'environnement ni requête Graph dans ces tests.
4. Prouver base neuve et mise à niveau, refus cross-tenant, rotation idempotente, révocation, corruption de ciphertext et audit sans secret; publier puis attendre la CI complète.
5. Attendre une autorisation humaine distincte avant tout compte/app/WABA, numéro de test, endpoint HTTPS, credential réel, activation ou message Meta. Ne pas fusionner, déployer, changer le DNS ou dépenser.

## Validation disponible

- Tranche Graph : 3 fichiers/37 tests transport-adaptateur-registre verts. Régression Meta : 7 fichiers/55 tests verts; 1 fichier/1 test PostgreSQL/RLS ignoré faute de `DATABASE_URL` local.
- Lint et typecheck complets verts. La limite locale de suite/build est levée par la CI autoritative `33414636126` : 141 fichiers/646 tests, build production et 20 Playwright verts.
- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement localement. La clé de script `tsx` dupliquée qui provoquait `EPERM` a été supprimée; la commande native Node est désormais l'unique lanceur et un test empêche sa régression. L'environnement distant avertit seulement que le PDF local est absent.
- Validation locale du correctif : lint et typecheck complets verts; 140 fichiers Vitest, 606 tests réussis, 18 ignorés et zéro échec; build production vert avec les variables factices de la CI.
- CI `33402359544` : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, tests unitaires/intégration, build production et Playwright verts sur `c08be1b`.
- Continuité `33402359545` : verte sur `c08be1b`.
- `git diff --check`, séquence des migrations 0065-0096 et absence de marqueurs de conflit : verts.

## État de vérité

- Livré : flux Meta entrant et sortant durable, tenant-aware, idempotent et fail-closed, avec preuve locale et CI.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport injecté uniquement dans les tests; aucun effet réseau.
- Bloqué humain : compte/app/WABA/numéro de test, endpoint HTTPS, secrets en gestionnaire et autorisation explicite avant activation ou preuve externe.
- Hors périmètre : CRM, Kanban, dashboard secondaire, OS-6, activation réelle non autorisée, production, fusion, déploiement, DNS et dépense.

## Bloc de reprise exact

```text
1. Se placer uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE et préserver tout le worktree, y compris tmp/ non suivi.
2. Lire AGENT_STATE, MASTER_PROMPT_REFERENCE, WORKLOG, NEXT_STEPS, DRIFT_REPORT et la mémoire de l'automation.
3. Vérifier PDF, SHA-256, 71 pages et pnpm agent:continuity-check; relire les pages cœur et OS-5 requises.
4. Vérifier branche, head, PR #11 et CI sans reset, clean, stash, changement de branche ou fusion.
5. La réconciliation est publiée par 64192145; la frontière Graph est publiée au head 02584ba avec CI 33414636126 et continuité 33414636345 vertes.
6. Conserver tmp/ hors index et maintenir Meta disabled/not_configured/mock : frontière Graph injectée mais aucune composition réelle, clé, app, WABA, endpoint public ou message réel.
7. Reprendre par la migration runtime 103 / SQL 0097 et la généralisation provider-scoped du coffre chiffré; la preuve fournisseur externe exige toujours une autorisation humaine distincte.
8. Maintenir tenant/RLS, idempotence, actions durables, audit sans PII et interfaces visibles en français.
9. Mettre à jour les quatre documents avant arrêt. Ne pas fusionner, déployer, dépenser ni demander de secret.
```
