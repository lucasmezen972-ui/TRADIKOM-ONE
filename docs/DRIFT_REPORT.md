# Rapport de dérive — TRADIKOM ONE OS

## Checkpoint — 31 août 2026, 15:21 UTC

- Branche : `codex/tradikom-one-os`.
- PR #11 : ouverte, brouillon et `MERGEABLE/CLEAN`; le head local et distant de reprise est `c08be1b357e6ec9ecbcb96cacc98df2dacc34081`.
- Réconciliation publiée : `64192145e13f4fb0e61fe3e6bea7eb95548b4ede`; le commit documentaire distant observé est `7b9d4f34abc8fe6c79734f97ca7f227b22351015`.
- Migrations `main` préservées : runtime 067-078 / SQL 0061-0072. Migrations OS renumérotées : runtime 079-102 / SQL 0073-0096.
- CI `33402359544` et continuité `33402359545` entièrement vertes sur `c08be1b`, y compris migrations PostgreSQL, backup/restauration, RLS, lint, typecheck, tests, build et Playwright.
- Provider examiné : WhatsApp Cloud API directe de Meta, **non activé**.

## Impact north star

La tranche complète le chemin prioritaire conversation → action durable : un message Meta vérifié est rattaché au bon tenant et au bon endpoint, puis une réponse sortante peut être réservée, gouvernée, rejouée et auditée sans doublon ni contenu sensible. Aucun CRM, Kanban, dashboard secondaire ou travail OS-6 n'a été choisi à la place de ce parcours.

## Alignement prompt maître

Les pages 3-7, 13-18, 22, 26-38, 46, 48 et 64-71 du prompt maître ont été relues pour ce checkpoint.

| Pages relues | Exigence | Preuve obtenue | Écarts restants |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre d'exécution strict et continuité documentée | Tranche OS-5 Meta maintenue; réconciliation publiée; quatre documents actualisés; aucune tâche CRM/Kanban/dashboard/OS-6 sélectionnée | La prochaine preuve fournisseur est un checkpoint humain, pas une nouvelle tranche autonome |
| 13-18, 22, 26-30 | Adaptateurs bornés, runtime provider, action durable, policy, idempotence et gouvernance | Adaptateur Meta sans client Graph; réservation durable avant effet; policy, claim/lease, retry/backoff et clé d'idempotence testés | Provider réel volontairement non configuré et non activé |
| 31-33 | Definition of Done stricte : migrations neuves/mise à niveau, PostgreSQL/RLS, tests, build et preuve utilisable | CI `33402359544` verte sur `c08be1b` : migrations PostgreSQL, backup/restauration, RLS, tests unitaires/intégration, build production et Playwright | Aucun écart logiciel ou CI connu sur le head vérifié; preuve fournisseur réelle soumise à autorisation |
| 35-38 | Entrées non fiables, données sensibles protégées, audit sans contenu ni secret | Signature avant base côté ingress; liaisons par empreintes opaques; audit sans numéro, identité, corps ou credential; aucune clé dans le dépôt | Gestion réelle des secrets et endpoint HTTPS relèvent d'une intervention humaine ultérieure |
| 64-68 | Runtime fournisseur uniforme, endpoint tenant-aware, états honnêtes et webhook signé | `whatsapp_meta` est `disabled`/`not_configured` hors test; liaison endpoint-identité; transport injecté uniquement en mock | Aucun client Graph ni appel réel; activation humaine non autorisée |
| 69 | Matrice de tests provider, sécurité, intégration et isolation | Local post-réconciliation : 12 fichiers/65 tests Meta verts; CI `33402359544` apporte PostgreSQL/RLS et le parcours complet; continuité `33402359545` verte | Deux fichiers PostgreSQL/RLS restent ignorés localement faute de `DATABASE_URL`, couverts par la CI autoritative |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`. Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement.

## Travail livré

- Migration de livraison autorisant `whatsapp_meta`, sans réécriture de l'historique appliqué.
- Table tenant-aware de liaisons opaques endpoint-identité, unicité, immutabilité et RLS.
- Réservation de la liaison à l'ingress afin d'empêcher un envoi depuis un autre endpoint Meta du tenant.
- Adaptateur sortant Meta fail-closed, sans SDK ni client Graph; transport mock uniquement injecté par les tests.
- Service sortant tenant-aware : membership, contexte endpoint-identité, réservation, policy, idempotence, statut, lease, reprise et audit sûr.
- Worker borné ne réclamant que les livraisons Meta dues.
- Réconciliation avec `main` publiée sans collision de migrations ni perte de l'historique de continuité.
- Lanceur de continuité corrigé : la clé `package.json` dupliquée qui réactivait `tsx` a été supprimée, la commande Node native fonctionne dans l'environnement restreint et un test de contrat empêche la régression.
- Roadmap remise en cohérence avec les clôtures probantes OS-3/OS-4; l'ancien choix Twilio est explicitement classé comme historique au profit de la trajectoire Meta actuelle.

## Validation honnête

- Le dépôt stable a été vérifié courant, lisible et inscriptible au head local et distant `c08be1b`; aucun reset, clean, stash, changement de branche ou fusion n'a été effectué. `tmp/` reste non suivi et préservé.
- Local : 12 fichiers/65 tests Meta verts; 2 fichiers PostgreSQL/RLS ignorés faute de `DATABASE_URL`. `git diff --check`, séquence des migrations et absence de marqueurs de conflit sont verts.
- `pnpm agent:continuity-check` : `ready`, zéro erreur et zéro avertissement localement via l'unique commande Node native; l'avertissement distant sur l'absence du PDF local est attendu.
- Test ciblé du contrôle de continuité : 1 fichier, 4 tests verts; ESLint ciblé et `git diff --check` verts.
- Validation locale exhaustive du correctif : lint et typecheck verts; 140 fichiers Vitest, 606 tests réussis, 18 ignorés et zéro échec; build production vert avec la configuration factice de la CI.
- CI `33402359544` : succès sur migrations, backup/restauration, lint, typecheck, tests unitaires/intégration, build production et Playwright.
- Continuité `33402359545` : succès. PR #11 : `OPEN`, `DRAFT`, `MERGEABLE/CLEAN`.

## Classification des états

- Livré : ingress et sortant Meta durables, fail-closed, tenant-aware et testés localement/CI.
- Réel : aucun compte, app Meta, WABA, numéro, token, client Graph, endpoint public ou message fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport synthétique uniquement dans les tests, sans réseau.
- Bloqué humain : compte/app/WABA/numéro de test, endpoint HTTPS, secrets en gestionnaire et autorisation explicite avant activation ou preuve externe.
- Hors périmètre : dépense, fusion de PR, déploiement, DNS, CRM, Kanban, dashboard secondaire et OS-6.

## Écarts restants et reprise

La preuve logicielle et CI de la tranche OS-5 Meta est obtenue. Le seul écart utile restant est externe et humain : autoriser explicitement une configuration Meta bornée, fournir les ressources dans un gestionnaire de secrets et autoriser un message de preuve, en distinguant sandbox et réel. Sans cette autorisation, maintenir le checkpoint, ne demander ni afficher aucun secret et ne sélectionner aucune tâche OS-6, CRM, Kanban ou dashboard secondaire.
