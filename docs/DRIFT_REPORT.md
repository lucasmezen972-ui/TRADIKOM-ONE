# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 31 août 2026, 16:53 UTC

- Branche : `codex/tradikom-one-os`.
- PR #11 : ouverte, brouillon et `MERGEABLE/CLEAN`; le head fonctionnel local et distant publié est `02584ba0712c8593db40145fb73424d729ddd0fe`.
- Réconciliation publiée : `64192145e13f4fb0e61fe3e6bea7eb95548b4ede`; le commit documentaire distant observé est `7b9d4f34abc8fe6c79734f97ca7f227b22351015`.
- Migrations `main` préservées : runtime 067-078 / SQL 0061-0072. Migrations OS renumérotées : runtime 079-102 / SQL 0073-0096.
- CI `33414636126` et continuité `33414636345` entièrement vertes sur `02584ba`, y compris migrations/backup/RLS, 141 fichiers et 646 tests, build et 20 Playwright.
- Provider examiné : WhatsApp Cloud API directe de Meta, **non activé**.

## Impact north star

La tranche complète le chemin prioritaire conversation → action durable : un message Meta vérifié est rattaché au bon tenant et au bon endpoint, puis une réponse sortante peut être réservée, gouvernée, rejouée et auditée sans doublon ni contenu sensible. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a été choisi à la place de ce parcours.

## Alignement prompt maître

Les pages 3-7, 13-18, 22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre d'exécution strict et continuité documentée | Tranche OS-5 Meta maintenue; réconciliation publiée; quatre documents actualisés; aucune tâche CRM/Kanban/dashboard/OS-6 sélectionnée | La prochaine preuve fournisseur est un checkpoint humain, pas une nouvelle tranche autonome |
| 13-18, 22, 26-30 | Adaptateurs bornés, runtime provider, action durable, policy, idempotence et gouvernance | Frontière Graph injectée sans logique métier; réservation durable avant effet; policy, claim/lease, retry/backoff et clé d'idempotence conservés | Provider réel volontairement non configuré et non activé |
| 31-33 | Definition of Done stricte : tests sans clé, états honnêtes, docs activation, PostgreSQL/RLS, build et preuve utilisable | Placeholders et procédure Meta ajoutés; CI `33414636126` verte avec PostgreSQL/RLS, 646 tests, build et 20 Playwright | Activation réelle toujours soumise au checkpoint humain distinct |
| 35-38 | Entrées non fiables, données sensibles protégées, audit sans contenu ni secret | Signature avant base côté ingress; liaisons par empreintes opaques; audit sans numéro, identité, corps ou credential; aucune clé dans le dépôt | Gestion réelle des secrets et endpoint HTTPS relèvent d'une intervention humaine ultérieure |
| 64-68 | Runtime fournisseur uniforme, endpoint tenant-aware, états honnêtes et webhook signé | `whatsapp_meta` reste fail-closed; transport Graph à base HTTPS fixe, résolveurs tenant-aware injectés, timeout, réponse bornée et erreurs normalisées | Aucun `fetch` global composé, credential résolu ou appel réel; activation humaine non autorisée |
| 69 | Matrice de tests provider, sécurité, intégration et isolation | 3 fichiers/37 tests transport-adaptateur-registre puis 7 fichiers/55 tests Meta locaux; CI : 141 fichiers/646 tests et 20 Playwright verts | 1 test PostgreSQL/RLS ignoré localement sans `DATABASE_URL`, exécuté dans la CI autoritative |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`. Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement.

## Travail livré

- Migration de livraison autorisant `whatsapp_meta`, sans réécriture de l'historique appliqué.
- Table tenant-aware de liaisons opaques endpoint-identité, unicité, immutabilité et RLS.
- Réservation de la liaison à l'ingress afin d'empêcher un envoi depuis un autre endpoint Meta du tenant.
- Adaptateur sortant Meta fail-closed et frontière HTTP Graph injectée : base HTTPS fixe, version/identifiants bornés, timeout, réponse limitée à 64 Kio et conservation du seul identifiant message sûr.
- Résolution éphémère et séparée des credentials et de la destination par tenant, endpoint et identité; aucun secret global ni détail fournisseur dans les résultats.
- Placeholders Meta complets et procédure d'activation documentant états, permissions, webhooks, retries, rate limits, preuve et rollback.
- Service sortant tenant-aware : membership, contexte endpoint-identité, réservation, policy, idempotence, statut, lease, reprise et audit sûr.
- Worker borné ne réclamant que les livraisons Meta dues.
- Réconciliation avec `main` publiée sans collision de migrations ni perte de l'historique de continuité.
- Lanceur de continuité corrigé : la clé `package.json` dupliquée qui réactivait `tsx` a été supprimée, la commande Node native fonctionne dans l'environnement restreint et un test de contrat empêche la régression.
- Roadmap remise en cohérence avec les clôtures probantes OS-3/OS-4; l'ancien choix Twilio est explicitement classé comme historique au profit de la trajectoire Meta actuelle.

## Validation honnête

- Le dépôt stable a été vérifié courant, lisible et inscriptible au head local et distant publié `234f7ee`; aucun reset, clean, stash, changement de branche ou fusion n'a été effectué. `tmp/` reste non suivi et préservé.
- Local : 3 fichiers/37 tests transport-adaptateur-registre puis 7 fichiers/55 tests Meta verts; 1 test PostgreSQL/RLS ignoré faute de `DATABASE_URL`. `git diff --check`, lint et typecheck sont verts.
- La suite exhaustive locale est restée silencieuse et le build a rencontré une recréation de dépendances bloquée par le réseau sandbox; aucun succès local n'est revendiqué. Les dépendances ont été restaurées depuis le lockfile et la CI autoritative a ensuite validé ces deux étapes.
- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement localement via l'unique commande Node native; l'avertissement distant sur l'absence du PDF local est attendu.
- Test ciblé du contrôle de continuité : 1 fichier, 4 tests verts; ESLint ciblé et `git diff --check` verts.
- Validation locale exhaustive du correctif : lint et typecheck verts; 140 fichiers Vitest, 606 tests réussis, 18 ignorés et zéro échec; build production vert avec la configuration factice de la CI.
- CI `33414636126` : succès sur migrations, backup/restauration, RLS, lint, typecheck, 141 fichiers/646 tests, build et 20 Playwright. Continuité `33414636345` : succès. PR #11 : `OPEN`, `DRAFT`, `MERGEABLE/CLEAN`.

## Classification des états

- Livré et prouvé CI : ingress et sortant Meta durables, plus frontière Graph fail-closed testée sans réseau.
- Réel : aucun compte, app Meta, WABA, numéro, token résolu, transport composé, endpoint public ou message fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport synthétique uniquement dans les tests, sans réseau.
- Bloqué humain : compte/app/WABA/numéro de test, endpoint HTTPS, secrets en gestionnaire et autorisation explicite avant activation ou preuve externe.
- Hors périmètre : dépense, fusion de PR, déploiement, DNS, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

La frontière Graph est prouvée localement et en CI. Le prochain écart logiciel non bloqué est le coffre chiffré encore figé sur `whatsapp_twilio` : l'étendre additivement à `whatsapp_meta`, avec migration runtime 103 / SQL 0097, repositories provider-scoped, rotation/révocation, tenant/RLS et tests sans secret réel. L'activation externe reste un écart humain distinct : ne demander ni afficher aucun secret et ne déclencher ni compte, endpoint, message, dépense, fusion ou déploiement sans autorisation.
