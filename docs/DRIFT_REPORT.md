# Rapport de dérive — TRADIKOM ONE OS

- Date : 19 août 2026, 15:58 UTC
- Branche : `codex/tradikom-one-os`
- PR : #11, brouillon
- Head de départ : `394ebc871217a3db73a2dfef20c901039d2e040b`
- Provider examiné : WhatsApp Cloud API directe de Meta, **non activé**

## Impact north star

La tranche conserve le résultat métier prioritaire : une conversation entrante vérifiée peut être rattachée au bon tenant, rejouée sans doublon et auditée sans contenu sensible. Aucun CRM, Kanban, dashboard secondaire ou fournisseur alternatif n'a été sélectionné à la place de ce parcours conversation-first.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écart restant |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, pas de tâche CRM/Kanban secondaire, continuité documentée | La tranche relie un webhook entrant au Conversation Hub et laisse un bloc de reprise exact | Le flux sortant durable Meta reste à préparer |
| 13-18, 22, 31-33 | Adapteurs bornés, tenant/RLS, action durable, Definition of Done | Mapping endpoint par HMAC, migration additive, transactions système et identité pseudonymisée par tenant | Preuve PostgreSQL/RLS du nouveau lot requiert une base et la CI |
| 35-38 | Entrée non fiable, pas de contenu sensible dans l'audit, pas de secret dans le dépôt | Signature HMAC sur corps brut avant parsing/base, JSON borné, audit sans numéro, WABA, Phone Number ID ni corps brut | Aucun secret Meta réel n'est configuré ni validé |
| 64-68 | Runtime provider uniforme, webhook signé, provider fail-closed | Registre `whatsapp_meta`, route GET/POST, challenge à jeton comparé en temps constant, POST 512 Kio, 503 hors `ready` | Le runtime reste volontairement `disabled`/`not_configured` hors tests |
| 69 | Tests provider, sécurité, intégration, isolation | 32 tests ciblés verts : signature, normalisation, migration neuve/mise à niveau, replay, deuxième message, endpoint absent/désactivé, isolation de deux tenants, HTTP | Playwright et CI PostgreSQL du lot n'ont pas encore été relancés |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`. Les pages 3-7, 31-33, 46, 48, 64-68 et 69-71 ont été consultées directement; les pages runtime/provider sont 64-68.

## Travail livré

- Provider Meta fail-closed avec huit prérequis déclaratifs et aucun transport actif.
- Vérification `X-Hub-Signature-256` HMAC SHA-256 en temps constant, sur corps brut UTF-8 borné.
- Normalisation d'un seul message texte déterministe uniquement après signature.
- Endpoint WABA + Phone Number ID résolu par empreinte HMAC tenant-aware, sans valeurs de destination en clair.
- Ingestion Conversation Hub idempotente, auditée et pseudonymisée; le même expéditeur génère des fils/identités distincts entre tenants.
- Migration additive `087_os2_whatsapp_meta_endpoint_provider`, prouvée sur base neuve et sur mise à niveau PGlite.
- Route `/api/webhooks/meta/whatsapp` avec GET challenge et POST JSON; le handler n'appelle ni base ni consommateur lorsque le provider n'est pas `ready`.

## Validation honnête

- Verts : 32 tests ciblés Meta, `pnpm lint`, `pnpm exec tsc --noEmit --incremental false`, `pnpm agent:continuity-check`, `git diff --check` et build de production avec l'environnement CI simulé.
- CI connue : PR #11 au head publié `cc0335f`, CI `32262537881` et Continuité `32262537861` vertes. Elles précèdent ce lot local Meta.
- Limite locale : `pnpm db:verify` exige une `DATABASE_URL` PostgreSQL absente. La migration est testée en PGlite, mais la vérification PostgreSQL/RLS reste à exécuter en CI ou avec une base autorisée.
- Limite locale : `pnpm test` complet a été interrompu après des dépassements du délai de 5 s dans des suites historiques non Meta (`workflow-worker`, sortant Twilio), sans assertion métier en échec. Ce résultat n'est pas présenté comme vert.

## Classification des états

- Livré : préparation inbound Meta jusqu'à la route HTTP fail-closed, avec migration et preuves locales.
- Réel : aucun compte, app Meta, WABA, sender, token, URL publique ou message fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : uniquement les secrets/états synthétiques de test; aucun transport réseau.
- Bloqué humain : activation réelle, endpoint HTTPS temporaire, gestionnaire de secrets et autorisation distincte sans paiement.
- Hors périmètre : production, dépense, fusion, déploiement, CRM, Kanban, dashboard secondaire et OS-6+.

## Prochaine tranche non bloquée

Préparer le flux sortant durable Meta : réservation, policy, idempotence, audit sûr, statut provider et worker, sans client Meta, credential réel, activation ou appel réseau. Avant tout code, actualiser `masterPrompt.alignment` et relire les pages provider pertinentes.
