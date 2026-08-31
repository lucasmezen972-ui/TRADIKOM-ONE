# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements suivis et non suivis. `tmp/` reste strictement exclu de tout commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement le 31 août 2026.
- La réconciliation autorisée avec `main` est publiée par `64192145e13f4fb0e61fe3e6bea7eb95548b4ede`. Les migrations `main` 067-078 / SQL 0061-0072 sont préservées et les migrations OS sont renumérotées 079-102 / SQL 0073-0096.
- Le head local et distant publié de départ est `234f7ee4b600f339b7a42f91ce7617f8688d1b07`. La PR #11 est ouverte, brouillon et `MERGEABLE/CLEAN`; la CI `33408166764` et la continuité `33408166738` sont vertes sur ce head.
- Une tranche Graph Meta est prête dans le worktree et doit être publiée sans inclure `tmp/`, puis validée par la CI du nouveau head.

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

1. Vérifier que `origin/codex/tradikom-one-os` est toujours le head `234f7ee`, sans modifier le worktree ni `tmp/`.
2. Committer uniquement la frontière Graph, ses tests, les placeholders, la procédure d'activation et les quatre documents; pousser sans force.
3. Attendre la CI PostgreSQL/RLS, suite complète, build, Playwright et continuité sur le nouveau head; corriger tout échec de la tranche.
4. Après preuve verte, poursuivre le prochain travail OS-5 non bloqué. Attendre une autorisation humaine distincte avant tout compte/app/WABA, numéro de test, endpoint HTTPS, secret, activation ou message Meta.
5. Ne pas fusionner la PR #11, déployer, changer le DNS, dépenser ni envoyer de message externe sans autorisation explicite.

## Validation disponible

- Tranche Graph : 3 fichiers/37 tests transport-adaptateur-registre verts. Régression Meta : 7 fichiers/55 tests verts; 1 fichier/1 test PostgreSQL/RLS ignoré faute de `DATABASE_URL` local.
- Lint et typecheck complets verts. La suite exhaustive et le build locaux sont non conclusifs à cause du runtime local; la CI du nouveau head doit faire foi.
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
5. La réconciliation est publiée par 64192145; le head publié de départ 234f7ee a sa CI 33408166764 et sa continuité 33408166738 vertes. La tranche Graph locale doit être publiée puis validée sur son propre head.
6. Conserver tmp/ hors index et maintenir Meta disabled/not_configured/mock : frontière Graph injectée mais aucune composition réelle, clé, app, WABA, endpoint public ou message réel.
7. Après CI verte, continuer le prochain travail OS-5 non bloqué; la preuve fournisseur externe exige toujours une autorisation humaine distincte.
8. Maintenir tenant/RLS, idempotence, actions durables, audit sans PII et interfaces visibles en français.
9. Mettre à jour les quatre documents avant arrêt. Ne pas fusionner, déployer, dépenser ni demander de secret.
```
