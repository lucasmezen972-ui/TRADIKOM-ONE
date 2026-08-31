# Rapport de dérive — TRADIKOM ONE OS

- Date : 31 août 2026, 03:20 UTC
- Branche : `codex/tradikom-one-os`
- PR : #11, ouverte en brouillon et en conflit avec `main`
- Head distant avant publication du lot : `33777bfc01ab08982671aa10b7e3487bdc82eb16`
- Head publié observé avant le présent checkpoint : `b3642e32b3212c63474ad93186d8c0e7e6bed6fe`
- Commit local du lot OS-5 Meta : `eec609b75364a2ded1afa14ecdd71e47c75327b4`
- Provider examiné : WhatsApp Cloud API directe de Meta, **non activé**

## Impact north star

La tranche complète localement le chemin prioritaire conversation → action durable : un message Meta vérifié est rattaché au bon tenant et au bon endpoint, puis une réponse sortante peut être réservée, gouvernée, rejouée et auditée sans doublon ni contenu sensible. Aucun CRM, Kanban ou dashboard secondaire n'a été choisi à la place de ce parcours.

## Alignement prompt maître

| Pages relues | Exigence | Preuve obtenue | Écart restant |
| --- | --- | --- | --- |
| 3-7, 46, 48, 70-71 | Priorité conversation-first, ordre d'exécution strict et continuité documentée | Flux Meta entrant puis sortant traité comme tranche OS-5; documents de reprise actualisés; aucune nouvelle tâche CRM/Kanban/dashboard sélectionnée | Le commit OS-6 distant préexistant reste hors de cette tranche et sa CI rouge n'est pas traité comme prochaine priorité |
| 13-18, 22, 26-30 | Adaptateurs bornés, runtime provider, action durable, policy, idempotence et gouvernance | Adaptateur Meta sans client Graph; réservation durable avant effet; policy, claim/lease, retry/backoff et clé d'idempotence testés; lot publié | Provider réel volontairement non configuré; CI bloquée par le conflit de PR |
| 31-33 | Definition of Done stricte : migrations neuves/mise à niveau, PostgreSQL/RLS, tests, build et preuve utilisable | Migrations runtime/SQL additives, tests PGlite de base neuve et upgrade, 65 tests Meta, régression Twilio, suite complète, lint, typecheck et build verts | Test PostgreSQL/RLS ignoré sans moteur local; aucun run n'est créé sur le head publié tant que la PR est en conflit |
| 35-38 | Entrées non fiables, données sensibles protégées, audit sans contenu ni secret | Signature avant base côté ingress; liaisons par empreintes opaques; audit sans numéro, identité, corps ou credential; aucune clé dans le dépôt | Gestion réelle de secrets et endpoint HTTPS relèvent d'une autorisation humaine ultérieure |
| 64-68 | Runtime fournisseur uniforme, endpoint tenant-aware, états honnêtes et webhook signé | `whatsapp_meta` est `disabled`/`not_configured` hors test; liaison endpoint-identité empêche le routage par un autre numéro; transport uniquement injecté en mock | Aucun client Graph ni appel réel; activation humaine non autorisée |
| 69 | Matrice de tests provider, sécurité, intégration et isolation | 12 fichiers/65 tests Meta verts, 5 fichiers/38 tests Twilio verts, 121 fichiers/523 tests complets verts; cas d'isolation, rejeu, refus avant transport et persistance couverts | 1 test Meta PostgreSQL/RLS et 18 tests PostgreSQL globaux ignorés localement faute de base |

Le PDF canonique est conforme : 71 pages, SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`. Les pages cœur 3-7, 31-33, 46, 48 et 69-71 ainsi que les pages OS-5 13-18, 22, 26-30, 35-38 et 64-68 ont été relues directement; les pages 32, 48, 64 et 69 ont également été contrôlées visuellement.

## Travail livré localement

- Migration de livraison autorisant `whatsapp_meta`, sans réécriture de l'historique appliqué.
- Table tenant-aware de liaisons opaques endpoint-identité, unicité, immutabilité et RLS.
- Réservation de la liaison à l'ingress afin d'empêcher un envoi depuis un autre endpoint Meta du tenant.
- Adaptateur sortant Meta fail-closed, sans SDK ni client Graph; transport mock uniquement injecté par les tests.
- Service sortant tenant-aware : membership, contexte endpoint-identité, réservation, policy, idempotence, statut, lease, reprise et audit sûr.
- Worker borné ne réclamant que les livraisons Meta dues.
- Régression du repository sortant partagé avec Twilio.

## Validation honnête

- Verts localement sur le head réconcilié et le lot Meta : 12 fichiers/65 tests Meta, 5 fichiers/38 tests Twilio, 121 fichiers/523 tests complets, ESLint, TypeScript sans cache, build Next.js production, `git diff --check` et continuity-check.
- Ignorés faute d'infrastructure locale : 1 test Meta PostgreSQL/RLS; au total 7 fichiers et 18 tests PostgreSQL. Aucun `DATABASE_URL`, binaire PostgreSQL, Docker, Podman, Colima ou formule PostgreSQL Homebrew n'est disponible.
- État distant avant publication : continuité `32374109126` verte; CI `32374109077` rouge uniquement sur `goal-watch-service` avec la contrainte `conversation_messages_check`, donc sur le commit OS-6 distant et non sur le lot Meta encore local.
- Réconciliation Git : le head local `787d54b` était l'ancêtre direct du head distant `33777bf`. Un fast-forward strict d'un commit, sans chemin commun avec les modifications Meta, a préservé le worktree sale; aucun reset, clean, stash, changement de branche ou commit de fusion.
- Publication effectuée sans force : `eec609b` contient les 22 fichiers contrôlés du lot et de continuité, puis `545c402` actualise le handoff; `tmp/` est exclu et reste non suivi localement.
- État CI reconfirmé au heartbeat de 03:18 UTC : PR #11 au head `b3642e3`, brouillon et `CONFLICTING/DIRTY`; aucun contrôle ni run n'a été créé pour ce head. La dernière CI rouge `32374109077` concerne `33777bf` et son seul échec observé reste OS-6 `conversation_messages_check`.

## Classification des états

- Livré localement : ingress et sortant Meta durables, fail-closed et testés.
- Réel : aucun compte, app Meta, WABA, numéro, token, client Graph, endpoint public ou message fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : transport synthétique uniquement dans les tests, sans réseau.
- Bloqué humain : compte/app/WABA/numéro de test, endpoint HTTPS, secrets en gestionnaire et autorisation explicite avant activation ou preuve externe.
- Bloqué humain/technique externe : autorisation de réconcilier le conflit de PR, puis CI PostgreSQL/RLS du head Meta.
- Hors périmètre : dépense, fusion, déploiement, DNS, CRM, Kanban, dashboard secondaire et correction fonctionnelle OS-6 non liée.

## Écarts restants et reprise

Le lot Meta est publié. Le heartbeat a reconfirmé le PDF exact, les pages requises, le dépôt synchronisé avant checkpoint et l'absence de nouveau contrôle GitHub. Une intervention humaine est indispensable pour autoriser la réconciliation du conflit entre la PR #11 et `main`; aucune fusion de PR ni réécriture d'historique n'a été tentée. Après réconciliation, surveiller la CI PostgreSQL et attribuer chaque erreur : corriger uniquement un défaut OS-5 Meta; documenter séparément l'échec préexistant OS-6 `conversation_messages_check`. Ne pas activer Meta ni demander de secret sans autorisation distincte.
