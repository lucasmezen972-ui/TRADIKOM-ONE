# Drift report

- Date : 11 août 2026
- Branche : `codex/tradikom-one-os`
- PR : brouillon #11
- Head initial audité : `8463c25`
- Commit fonctionnel : `f0acdfb`
- Travail effectué : reconfirmation probante du checkpoint humain OS-5 et de la CI du head courant, sans mutation applicative ni activation externe.

## Impact north star

Le chemin Conversation -> WhatsApp conserve toutes ses gardes prouvées jusqu'à la frontière I/O. Le checkpoint respecte la north star en refusant une nouvelle tranche secondaire lorsque le seul résultat métier manquant est la preuve Sandbox réelle. Aucun CRM, Kanban, dashboard ou OS-6 n'a été ouvert pour contourner l'intervention humaine.

## Alignement prompt maître

- Pages consultées : pages 3-7, 13-18, 22, 26-33, 35-38, 46, 48 et 64-71, relues directement dans le PDF canonique en texte; toutes les pages cœur et les pages techniques 14, 18, 22, 26, 28-29, 35-37, 64 et 66 ont aussi été inspectées en rendu.
- Exigence servie : pages 3, 6, 14, 29, 31-32, 36-37, 66 et 69 : arrêter l'autonomie uniquement à l'étape humaine indispensable, conserver secrets et credentials hors chat/dépôt, ne pas présenter un mock comme réel, laisser les providers fail-closed sans clés, et ne déclarer OS-5 terminé qu'après un outil externe actif en sandbox ou vrai avec preuves provider, sécurité, RLS et Playwright.
- Preuve obtenue : PDF de 71 pages au SHA-256 `bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5`; pages cœur et OS-5 relues directement en texte, toutes les pages cœur et les pages techniques déterminantes inspectées visuellement; `pnpm agent:continuity-check` local `ready` sans erreur ni avertissement; fichiers suivis propres et synchronisés au head `8463c25`; PR #11 brouillon, fusionnable et `CLEAN`; continuité `31354943077` verte; CI PostgreSQL `31354943080` verte avec audit sans vulnérabilité connue, migrations, backup/restauration, RLS, lint, typecheck, 118 fichiers/488 tests, build et 20/20 Playwright. Le répertoire non suivi `tmp/pdfs/`, antérieur au run, est signalé et préservé hors des rendus temporaires de ce run. Aucun code ni effet externe n'a été produit pendant cette confirmation.
- Écarts restants : aucun gestionnaire de secrets concret, compte Twilio, téléphone vérifié, Sandbox, endpoint HTTPS public ou message fournisseur n'est connecté. La preuve réelle web + WhatsApp, la désactivation post-preuve et le succès OS-5 page 31 restent bloqués par l'autorisation humaine exacte; il n'existe aucune autre tranche locale non bloquée alignée.

## Classification honnête

- Livré : outbound durable, worker, callbacks, coffre, résolveurs éphémères, bootstrap keyring, fabrique SDK, readiness, autorisation persistée, consommation atomique et garde outbound obligatoire du plafond, runbook.
- Réel préparé : inbound signé/tenant-mappé et chaîne outbound jusqu'au client officiel, sans transport actif ni appel réseau.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée ou appelée.
- Mock : références, clés, résolveurs, clients, réponses Twilio et manifeste `ready` synthétique de test; consommations en base de test prouvant l'ordre policy -> budget -> transport, canal test et `tradikom_mock`.
- Bloqué humain : compte Twilio, téléphone vérifié, conditions Sandbox, credentials dans un gestionnaire, endpoint HTTPS temporaire et autorisation externe d'au plus deux messages gratuits.
- Hors périmètre : sender WhatsApp production, WABA, paiement, Meta direct, activation Resend/Teams/Slack, OS-6 à OS-8, fusion et déploiement.

## Documents concernés

- `docs/AGENT_STATE.json` : alignement, preuve attendue, head et validation courante;
- `docs/WORKLOG.md` : checkpoint append-only et blocage humain exact;
- `docs/NEXT_STEPS.md` : head et runs autoritatifs de reprise;
- `docs/DRIFT_REPORT.md` : alignement prompt maître, preuve, classification et écarts restants.

## Risques

- Le budget est imposé pour `ready`, mais ce statut n'existe que dans les tests tant que le checkpoint humain n'est pas autorisé.
- Aucun gestionnaire de secrets concret n'est choisi ou connecté; toutes les valeurs de preuve restent factices.
- L'état `ready` est prouvé uniquement avec un manifeste synthétique de test; le registre réel n'émet que `disabled`, `not_configured` ou `awaiting_human_auth` et aboutit au plus à `degraded`.
- Un message externe déjà remis ne serait pas annulable; le runbook ne promet que l'arrêt des effets futurs.
- GitHub Actions avertit que `pnpm/action-setup@v4` et `actions/upload-artifact@v4` reposent encore sur le runtime d'action Node 20 forcé vers Node 24; le run reste vert, mais la maintenance du workflow devra suivre l'évolution officielle de ces actions.

## Validations

- `pnpm agent:continuity-check` initial et final : `ready`, zéro erreur et zéro avertissement;
- prompt maître : empreinte exacte, 71 pages, inspection textuelle et visuelle des pages cœur et OS-5;
- GitHub : PR #11 ouverte, brouillon, fusionnable et `CLEAN` au head `8463c25`; CI `31354943080` et continuité `31354943077` vertes;
- local ciblé : 2 fichiers/16 tests verts, avec ordre policy -> consommation -> transport et reprise worker;
- local canaux : 41 fichiers/192 tests verts, 5 suites PostgreSQL ignorées sans `DATABASE_URL`;
- local exhaustif : 118 fichiers/471 tests verts en six lots mono-worker, 6 fichiers et 17 tests PostgreSQL ignorés faute de base locale;
- statique : audit production sans vulnérabilité connue, lint, typecheck, build production et diff check verts;
- navigateur local : aucune interface visible modifiée; la preuve Playwright PostgreSQL du nouveau head est confiée à la CI distante, le runtime local PGlite ne partageant pas les fixtures entre Playwright et le serveur;
- distant fonctionnel : commit fonctionnel `f0acdfb` et handoffs documentaires jusqu'à `8463c25` poussés; continuité `31354943077` verte; CI PostgreSQL `31354943080` verte en 15 min 53 s avec audit, migrations, backup/restauration, RLS, lint, typecheck, 118 fichiers/488 tests, build production et 20/20 Playwright; PR #11 `CLEAN`. L'avertissement distant sur l'absence du PDF est attendu dans GitHub Actions et n'annule pas la vérification locale exacte.

## Prochaine action recommandée

Attendre le checkpoint humain exact de `docs/OS5_PROVIDER_SELECTION.md` et `docs/OS5_TWILIO_ACTIVATION_RUNBOOK.md`. Après autorisation seulement : configurer l'essai/Sandbox et le gestionnaire de secrets, émettre au plus deux unités gratuites, exécuter la preuve bidirectionnelle réelle, puis désactiver et révoquer. Ne sélectionner aucune tâche CRM, Kanban, dashboard ou OS-6 pendant ce blocage.
