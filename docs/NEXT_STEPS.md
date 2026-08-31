# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; préserver tous les changements suivis et non suivis. `tmp/` reste strictement exclu de tout commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement le 31 août 2026.
- La réconciliation autorisée avec `main` est publiée par `64192145e13f4fb0e61fe3e6bea7eb95548b4ede`. Les migrations `main` 067-078 / SQL 0061-0072 sont préservées et les migrations OS sont renumérotées 079-102 / SQL 0073-0096.
- Le head local et distant de reprise est `27c26f06562d700b784f0ec305f50743f036e9f2`. La PR #11 est ouverte, brouillon et `MERGEABLE/CLEAN`.
- La CI `33368600491` et la continuité `33368600481` sont entièrement vertes sur `27c26f0`, y compris migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, tests, build et Playwright.

## Tranche livrée : flux WhatsApp Cloud Meta, sans activation

- Les migrations runtime 100-102 et leurs miroirs SQL 0094-0096 autorisent les livraisons `whatsapp_meta`, ajoutent une liaison opaque endpoint-identité, une contrainte d'écriture protectrice et les politiques RLS tenant-aware.
- L'ingress réserve cette liaison par tenant et endpoint; un contact rattaché à un numéro Meta ne peut pas être envoyé depuis un autre endpoint du même tenant.
- L'adaptateur sortant est fail-closed et ne contient aucun client Graph. Seul un transport injecté de test peut simuler un résultat `mock`.
- Le service réserve durablement avant effet, applique la policy, respecte l'idempotence, gère claim/lease/retry/backoff et audite sans contenu sensible.
- Le worker ne prend que les livraisons Meta dues, avec appartenance tenant vérifiée et limite bornée.
- Aucun compte, application, WABA, numéro Meta, token, endpoint public, client Graph, message externe, dépense, fusion de PR ou déploiement n'a été créé.

## Référence prompt maître

Les pages 13-18, 22, 26-33, 35-38, 46, 48 et 64-69 du prompt maître imposent le parcours conversation-first, l'action durable, la réservation avant effet, tenant/RLS, l'idempotence, l'audit sans contenu sensible, un état fournisseur honnête et les tests provider/sécurité. La Definition of Done de la page 32 et la matrice de la page 69 sont satisfaites pour la tranche logicielle et CI; elles imposent comme prochaine action d'attendre l'autorisation humaine avant toute preuve fournisseur externe.

## Prochaine action concrète

1. Maintenir le checkpoint OS-5 et contrôler la continuité; ne sélectionner aucune tâche OS-6, CRM, Kanban ou dashboard secondaire.
2. Attendre une autorisation humaine distincte avant toute création ou utilisation de compte/app/WABA, numéro de test, endpoint HTTPS ou secret Meta.
3. Après cette autorisation seulement, obtenir une preuve externe bornée et explicitement classée sandbox ou réelle, sans dépense implicite et avec provider toujours fail-closed en l'absence de configuration.
4. Ne pas fusionner la PR #11, déployer, changer le DNS, dépenser ni envoyer de message externe sans autorisation explicite.

## Validation disponible

- Post-réconciliation local : 12 fichiers/65 tests Meta verts; 2 fichiers PostgreSQL/RLS ignorés faute de `DATABASE_URL` local.
- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement localement. La clé de script `tsx` dupliquée qui provoquait `EPERM` a été supprimée; la commande native Node est désormais l'unique lanceur et un test empêche sa régression. L'environnement distant avertit seulement que le PDF local est absent.
- Validation locale du correctif : lint et typecheck complets verts; 140 fichiers Vitest, 606 tests réussis, 18 ignorés et zéro échec; build production vert avec les variables factices de la CI.
- CI `33368600491` : migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, tests unitaires/intégration, build production et Playwright verts sur `27c26f0`.
- Continuité `33368600481` : verte sur `27c26f0`.
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
5. La réconciliation est publiée par 64192145; le head de reprise 27c26f0 est synchronisé et sa CI 33368600491 ainsi que sa continuité 33368600481 sont entièrement vertes.
6. Conserver tmp/ hors index et maintenir Meta disabled/not_configured/mock : aucune clé, client Graph, app, WABA, endpoint public ou message réel.
7. La prochaine preuve fournisseur exige une autorisation humaine distincte; ne pas sélectionner OS-6, CRM, Kanban ou dashboard entre-temps.
8. Maintenir tenant/RLS, idempotence, actions durables, audit sans PII et interfaces visibles en français.
9. Mettre à jour les quatre documents avant arrêt. Ne pas fusionner, déployer, dépenser ni demander de secret.
```
