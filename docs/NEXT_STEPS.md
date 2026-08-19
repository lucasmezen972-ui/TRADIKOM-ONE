# Étapes suivantes TRADIKOM ONE OS

## Situation actuelle

- Travailler uniquement dans `/Users/TRADIKOM/Developer/TRADIKOM-ONE`; `tmp/` est non suivi et doit rester exclu de tout commit.
- Le PDF maître canonique est valide : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`.
- Les pages cœur 3-7, 31-33, 46, 48, 64-68 et 69-71 ont été relues directement; les pages runtime/provider sont bien 64-68.
- La PR #11 est ouverte en brouillon. Au head publié `cc0335f`, CI `32262537881` et Continuité `32262537861` sont vertes. Le lot Meta courant est local et doit être revalidé par CI seulement après publication.

## Dernière tranche livrée : inbound WhatsApp Cloud API Meta, sans activation

- Le provider `whatsapp_meta` est fail-closed : `disabled`, `not_configured` ou `awaiting_human_auth`, avec `transportEnabled: false`.
- Le corps brut est borné à 512 Kio, signé par `X-Hub-Signature-256`, puis seulement normalisé en un événement texte strict.
- Le WABA et le Phone Number ID sont mappés par empreinte HMAC tenant-aware; le Conversation Hub reçoit une identité pseudonymisée et une clé d'idempotence stable.
- La migration additive `087_os2_whatsapp_meta_endpoint_provider` autorise Meta sur les bases existantes sans réécrire les migrations historiques.
- La route `/api/webhooks/meta/whatsapp` n'est atteignable qu'en état `ready` de test : GET vérifie le challenge à jeton constant-time, POST transmet le JSON brut signé. En état réel actuel, elle retourne 503 et n'ouvre aucune base ni transport.

## Référence prompt maître

Les pages 14, 22, 31-33, 35-38, 46, 48, 64-68 et 69 imposent la suite : conserver l'adaptateur borné, le tenant/RLS, l'idempotence, l'audit sans contenu sensible, les états fournisseur honnêtes et les tests provider/sécurité avant toute activation.

## Prochaine action concrète

Reprendre la première tranche OS-5 restante : préparer le **flux sortant durable WhatsApp Cloud Meta**. Commencer par comparer les réservations, policy, idempotence et audits du flux WhatsApp existant, puis ajouter uniquement les briques Meta nécessaires avec tests. Le provider doit rester sans clé, sans client réseau et sans état `ready` hors tests.

Ne pas créer d'application Meta, token, webhook public, sender, WABA, message fournisseur, paiement ou déploiement pendant cette tranche.

## Validation disponible

- 32 tests ciblés Meta verts : registre, signature, adaptateur, migration neuve/mise à niveau, ingress/replay/deuxième message, endpoint absent/désactivé, signature avant base, isolation tenant et frontière HTTP.
- `pnpm lint`, `pnpm exec tsc --noEmit --incremental false`, `pnpm agent:continuity-check` et `git diff --check` sont verts.
- Build de production vert avec l'environnement CI local simulé; la route Meta est inventoriée par Next.js.
- `pnpm db:verify` est non exécutable ici faute de `DATABASE_URL` PostgreSQL. La migration PGlite de mise à niveau est néanmoins couverte par test.
- `pnpm test` complet a été interrompu : des tests historiques du worker et du sortant Twilio dépassent le délai local de 5 s (5–12 s) sans assertion métier échouée. Ne pas présenter cette exécution comme une suite complète verte; revalider via CI PostgreSQL après publication.

## État de vérité

- Livré : préparation Meta inbound complète jusqu'à la route HTTP fail-closed, avec migration, audit, idempotence et preuves locales.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : seuls les états `ready` et les secrets factices des tests; aucun message externe.
- Bloqué humain : toute activation Meta réelle demande un compte, les conditions de test, un endpoint HTTPS temporaire, un gestionnaire de secrets et une autorisation distincte sans paiement.
- Hors périmètre immédiat : CRM, Kanban, dashboard secondaire, production, fusion, déploiement et dépense.

## Bloc de reprise exact

```text
1. Vérifier le PDF maître, SHA-256, 71 pages et pnpm agent:continuity-check.
2. Lire docs/AGENT_STATE.json, docs/WORKLOG.md et docs/DRIFT_REPORT.md.
3. Repartir de la branche codex/tradikom-one-os, sans inclure tmp/.
4. Auditer la réservation durable et le worker sortant existants avant toute nouvelle écriture.
5. Mettre à jour masterPrompt.alignment avant de coder le flux sortant Meta.
6. Garder Meta disabled/not_configured/mock : aucune clé, aucun client, aucun appel réseau ou message réel.
7. Ajouter les preuves provider, tenant, idempotence, audit, policy et migration nécessaires.
8. Relancer les tests ciblés, lint, typecheck, build, continuity-check et documenter les limites PostgreSQL/CI.
9. Ne fusionner, ne déployer, ne dépenser et ne demander aucun secret sans autorisation séparée.
```
