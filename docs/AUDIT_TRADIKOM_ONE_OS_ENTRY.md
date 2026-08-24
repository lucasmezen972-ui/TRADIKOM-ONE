# Audit d'entrée — TRADIKOM ONE OS (OS-0)

> Point d'entrée de la phase « OS ». Ce document n'évalue pas des intentions : il
> rapporte ce que le dépôt contient réellement au commit `d002e07`, vérifié
> commande par commande. Les affirmations des documents existants ne sont pas
> reprises comme preuves — plusieurs sont contredites plus bas.

**Date** : 3 août 2026
**Branche** : `claude/projet-doxqd8` — **Commit** : `d002e07`
**Base** : `origin/main` = `aa46bb1`, 0 commit d'écart en amont, 22 en aval.

---

## 1. Méthode et preuves

| Vérification | Commande / source | Résultat |
| --- | --- | --- |
| État de la PR #10 | API GitHub `pulls/10` | `open`, `draft`, `mergeable_state: clean`, 122 fichiers, +10 136 / −306 |
| CI sur `d002e07` | API GitHub `check-runs` | 1 check — « Lint, test, build, and E2E » — **success**, 12 min 22 s |
| Divergence avec `main` | `git rev-list --left-right --count origin/main...HEAD` | `0 22` — aucun rebase nécessaire |
| Tables | inspection PostgreSQL | **83** |
| Migrations runtime | registre `src/lib/db.ts` | **78** |
| Miroirs SQL | `src/db/migrations/` | 72 fichiers |
| Fichiers de test | `tests/*.test.ts` | **77** |
| Spécifications Playwright | `e2e/` | 2 (`api-intelligence`, `vertical`) |
| Modules | `src/modules/` | **46** |

`pnpm db:verify` n'a pas été rejoué localement : le conteneur de cette session
n'a pas de PostgreSQL en écoute (`pg_isready` → `no response`). La couverture RLS
et les index tenant-leading sont donc attestés par la CI verte sur `d002e07`, qui
exécute `expectTenantRlsCoverage` et `expectTenantIndexes` sur PostgreSQL 17,
sur base vide **et** sur base déjà migrée depuis la Phase 2. C'est une preuve, pas
une supposition, mais elle vient de la CI et non de cette machine.

---

## 2. Le constat central

**Aucune primitive conversationnelle n'existe dans le dépôt.**

Recherche sur `conversation`, `message`, `thread`, `channel adapter`,
`identity` dans les 83 tables et les 46 modules : **zéro** table de conversation,
zéro message canonique, zéro identité omnicanale, zéro adaptateur de canal, zéro
règle d'idempotence ou d'anti-boucle.

Le produit construit à ce jour est un CRM web multi-tenant avec des moteurs de
règles déterministes. Le cœur différenciant décrit par le prompt maître — une
conversation unique, tous canaux, qui déclenche des actions prouvées — n'est pas
commencé. Ce n'est pas une critique du travail livré, qui est cohérent et testé ;
c'est le point de départ factuel de la phase OS.

**Second constat, plus grave, parce qu'il enfreint une règle explicite.**

`src/modules/ai/provider.ts` définit `OpenAiProvider`. Cette classe construit un
client OpenAI dans son constructeur, puis **ne l'utilise jamais** : chacune de ses
trois méthodes délègue intégralement à `DeterministicAiProvider`, et
`enrichBusinessTwin` étiquette le résultat `provider: "openai"` avec le modèle lu
dans `OPENAI_MODEL`. Un consommateur qui lit ce champ conclut qu'un appel au
modèle a eu lieu. Aucun appel n'a lieu.

Le champ `usage: { fallback: true }` est le seul indice, et il n'est ni contrôlé
ni affiché nulle part. Le code date de la Phase 2 (`860f071`), il est présent sur
`main`, il ne vient pas de la PR #10.

Circonstance atténuante technique et aggravante produit : `getAiProvider` n'est
**importé par aucun fichier** de `src/` ni de `tests/`. Le module entier est du
code mort. Il ne trompe donc personne aujourd'hui — mais il attend d'être branché,
et le jour où il le sera, il mentira.

---

## 3. Existant réutilisable

Ce socle est solide et doit être conservé tel quel. Il porte la sécurité et la
discipline dont la phase OS a besoin.

| Élément | Pourquoi il tient |
| --- | --- |
| **Isolation multi-tenant RLS** | `app_current_tenant_id()` / `app_is_system()`, vérifiée en CI table par table, avec index tenant-leading contrôlés. Le Conversation Hub s'y branche sans rien inventer. |
| **Discipline de migration** | Registre runtime `src/lib/db.ts` + miroirs SQL, idempotence testée par double application, chemin de mise à niveau depuis la Phase 2 avec données préexistantes. |
| **Structure de module** | `errors` / `schemas` (zod) / `repository` / `service` / `index`. 46 fois la même forme : un nouveau module n'a pas de décision d'architecture à prendre. |
| **`withTenantDbTransaction` + `assertTenantAccess` + `recordAuditLog`** | Le triptyque garde/transaction/audit est déjà systématique. Les actions de la phase OS doivent y passer, pas le contourner. |
| **Façade `createServices`** | Point d'injection unique des dépendances (base, stockage, email, horloge). Les adaptateurs de canal s'y injectent de la même façon. |
| **Fournisseur email Resend** | Origine figée dans le code (pas de surface SSRF), redirections refusées, délai 10 s, corps borné à 8 Kio, classification `retryable` / `permanent`, `fetchImpl` injectable pour les tests. C'est le modèle à copier pour tout futur adaptateur sortant. |
| **Liste de suppression email** | Le refus d'envoyer à une adresse morte est déjà tenant-scopé et audité. Réutilisable directement par le canal email du hub. |
| **Centre d'approbation** | Lecture seule, chaque décision déléguée à la server action du module d'origine. C'est exactement la forme que doit prendre la « validation unique » du prompt maître : une file, zéro route générique d'approbation. |
| **Union discriminée `ApprovalRevision`** | L'aiguillage exhaustif casse la compilation quand une famille est ajoutée sans son formulaire. À généraliser aux types de canal et de capacité. |
| **Normalisation des numéros antillais** | `src/modules/whatsapp/phone.ts` — `0696…`, `+596 696…`, `00596…`. Directement réutilisable par l'identité omnicanale. |

---

## 4. À refactorer

| Élément | Ce qui manque | Direction |
| --- | --- | --- |
| **Façade `createServices`** | Elle agrège 46 modules et grossit à chaque lot. | La segmenter par domaine avant d'y ajouter le hub, sinon chaque nouveau canal la fait enfler. Pas urgent, mais à ne pas différer indéfiniment. |
| **`src/modules/whatsapp`** | Ne produit qu'une URL `wa.me`. Aucun état, aucun message conservé. | Devient l'**adaptateur** WhatsApp du hub. Le click-to-chat reste le mode dégradé explicite tant qu'aucun compte Business n'est vérifié — c'est un `not_configured` honnête, pas un mensonge. |
| **`src/modules/email`** | Sortant seulement, pas de notion de fil ni d'entrant. | Devient l'adaptateur email : la sortie est déjà là, il manque l'entrant et le rattachement à un fil. |
| **`src/modules/audit`** | Journalise des actions, pas des preuves attachées à un message. | Étendre pour lier `audit_logs` à `canonical_message_id` — sinon « quelle action ce message a déclenchée » restera sans réponse. |
| **Délai vitest** | Les 77 fichiers de test s'appuient sur le défaut de 5 s et deviennent fragiles sous charge (observé : 57 dépassements, zéro `AssertionError`, sur une machine dégradée). | `testTimeout` global dans `vitest.config.ts`. Changement transverse, à faire **avant** d'ajouter les suites conversationnelles, pas après. |
| **Scripts `package.json`** | Ni `agent:continuity-check`, ni `test:rls`, ni `test:conversation`, ni `verify:all`. | `agent:continuity-check` est ajouté par ce lot. Les autres suivront quand les suites correspondantes existeront — déclarer un script qui ne cible rien serait une promesse vide. |

---

## 5. À remplacer

| Élément | Verdict |
| --- | --- |
| **`src/modules/ai/provider.ts`** | **À remplacer entièrement.** `OpenAiProvider` doit soit appeler réellement le modèle, soit ne pas exister. Un provider qui renvoie du déterministe sous l'étiquette `openai` viole la règle « ne pas prétendre qu'une intégration est réelle lorsqu'elle est simulée ». Correctif minimal immédiat, sans clé d'API : renommer l'étiquette en `deterministic` et poser un état `not_configured` explicite. Correctif cible : un port `ModelPort` avec adaptateurs `deterministic` (défaut) et `openai` (feature-flag + clé), sorties validées par zod, jamais exécutées directement. |
| **`src/modules/connectors/registry.ts` + `catalog.ts`** | 4 entrées de catalogue (`generic_webhook`, `csv_contacts`, `mock_business`, `google_business_profile`), 3 définitions dont les `testConnection` renvoient des réponses écrites en dur. À remplacer par le Connector Fabric : Capability Manifest, exécution passant par le Policy Engine, statut réel par connecteur. |
| **Stockage de fichiers** | `src/modules/assets/storage.ts` écrit sur le système de fichiers local (`node:fs/promises`). Fonctionnel en développement, inadapté à un déploiement sans disque persistant. À remplacer par un port de stockage objet quand la phase multimodale arrivera. |

---

## 6. À supprimer plus tard

À ne pas toucher maintenant — supprimer du code testé sans le remplacer est une
régression, pas un nettoyage.

- **8 branches obsolètes sur `origin`** : `codex/phase-2-production-foundation`,
  `codex/phase-3-5-stabilization`, `codex/phase-3-api-intelligence`,
  `codex/phase-3b-continuous-api-scout`, `codex/phase-4-autonomous-platform`,
  `codex/phase-5-provider-readiness`, `codex/phase-5-real-connectivity`,
  `feature/command-center-v2`. Toutes fusionnées ou abandonnées. À supprimer après
  la fusion de la PR #10.
- **`docs/PHASE_*.md` (8 fichiers)** : historiques, partiellement contredits par
  l'état réel. À archiver sous `docs/archive/` plutôt qu'à supprimer — ils
  expliquent pourquoi certaines décisions ont été prises.
- **`docs/NIGHT_SHIFT_*.md`, `docs/RESUME_STATE.md`** : remplacés par les
  fichiers de continuité de ce lot. À retirer une fois la nouvelle boucle
  éprouvée sur quelques cycles.
- **Modules sans consommateur réel** : à réévaluer un par un après OS-1, quand on
  saura lesquels le hub absorbe. Aucun ne part avant.

---

## 7. Bloqué par des clés

Rien de tout cela n'empêche d'avancer : chaque fournisseur doit être préparé,
feature-flaggé et testable en mock strict. La liste dit ce qui restera
`not_configured` tant qu'une clé n'existe pas.

| Fournisseur | Variable | État |
| --- | --- | --- |
| Resend (email sortant) | `RESEND_API_KEY`, `EMAIL_FROM` | **Code réel et complet.** Inactif tant que `EMAIL_PROVIDER=resend` n'est pas posé. Le seul appel HTTP sortant de tout `src/`. |
| OpenAI | `OPENAI_API_KEY`, `FEATURE_AI_GENERATION` | Placeholders présents. Le code derrière le drapeau ne fait **aucun** appel (voir §2). |
| WhatsApp Business | — | Aucune variable. Exige un compte vérifié, des modèles pré-approuvés, une facturation par conversation. |
| Microsoft Teams / Slack | — | Aucune variable, aucun code. |
| Voix | — | Aucune variable, aucun code. |
| Temporal | — | Aucune variable, aucun code. Les workflows actuels sont un worker maison à sondage (`src/modules/workflows/worker.ts`). |
| OAuth connecteurs | `CONNECTOR_ENCRYPTION_KEY` | Le chiffrement est là ; aucun échange de jeton réel n'existe. |

---

## 8. Risque de dérive

C'est la section que le prompt maître impose et c'est la plus utile.

**Dérive constatée.** La PR #10 livre 20 lots. Chacun est correct, testé, documenté
et sécurisé. **Aucun ne sert le cœur conversationnel.** KPI cliquables, kanban,
réordonnancement de cartes, seuils réglables, révision de propositions : ce sont
des fonctionnalités CRM. La règle §0 du prompt maître dit « ne pas coder une
nouvelle fonctionnalité CRM si elle ne sert pas le cœur conversationnel ». Ces
lots ont été écrits avant ce cadrage, donc ils ne l'enfreignent pas
rétroactivement — mais ils décrivent exactement la pente à ne plus descendre.

**Mécanisme de la dérive.** Le backlog `docs/BACKLOG.md` était alimenté par les
manques du CRM. Chaque lot terminé en révélait un suivant, tout aussi légitime et
tout aussi latéral. Une boucle « ne reste jamais improductif » branchée sur un
backlog CRM produit indéfiniment du CRM. Le problème n'est pas la boucle, c'est ce
sur quoi elle est branchée.

**Trois risques ouverts.**

1. **Simulation présentée comme réelle.** Le cas `OpenAiProvider` existe déjà. Le
   Connector Fabric multipliera ces occasions. Chaque adaptateur doit exposer un
   état vérifiable — `real`, `sandbox`, `mock`, `not_configured` — lisible par
   l'utilisateur, pas seulement par le code.
2. **Étalement horizontal.** 46 modules, 83 tables, et pas une conversation. La
   roadmap doit livrer des tranches verticales de bout en bout, même avec des
   fournisseurs mockés explicites.
3. **Documentation en avance sur le code.** `docs/AI_PROVIDER.md` liste bien
   « implement real structured OpenAI calls instead of fallback-wrapped output »
   dans son travail restant — c'est honnête. Mais il faut relire les 47 documents
   avec cette grille, pas seulement celui-là. Vérification à faire lot par lot,
   pas en une passe cosmétique.

**Garde-fou posé par ce lot.** `scripts/agent/continuity-check.ts` échoue si
`docs/AGENT_STATE.json` ne porte pas une north star conversationnelle, si un
fichier de continuité manque, ou si l'état déclaré ne correspond plus au `HEAD`
réel. Ce n'est pas suffisant, mais c'est vérifiable et exécuté en CI.

---

## 9. Modules IA — exécutent-ils vraiment ?

Vérification : recherche de `openai`, `OpenAI`, `anthropic`, `getAiProvider` et de
tout appel HTTP dans chaque module.

| Module | Appel modèle | Appel externe | Verdict |
| --- | --- | --- | --- |
| `ai` | — | non | Code mort, étiquette mensongère (§2) |
| `reputation-ai` | non | non | Règles déterministes, planning-only |
| `website-ai` | non | non | Règles déterministes, planning-only |
| `financial-ai` | non | non | Règles déterministes, planning-only |
| `sales-ai` | non | non | Règles déterministes, planning-only |
| `autonomous-marketing` | non | non | Règles déterministes, planning-only |
| `business-twin` | non | non | Règles déterministes, planning-only |
| `opportunity-radar` | non | non | Règles déterministes, planning-only |
| `competitor-intelligence` | non | non | Règles déterministes, planning-only |
| `strategic-advisor` | non | non | Règles déterministes, planning-only |
| `self-improvement` | non | non | Règles déterministes, planning-only |
| `api-intelligence` | non | non | Règles déterministes, planning-only |
| `connector-copilot` | non | non | Règles déterministes, planning-only |
| `ai-employees` | non | non | Gabarits de rôles, aucune exécution |

**Aucun module « IA » n'appelle un modèle.** Ils produisent des propositions par
règles, avec preuves attachées, et n'exécutent rien : l'approbation valide une
orientation. C'est défendable — et c'est même une bonne base pour le Policy
Engine — mais il faut que les documents le disent aussi clairement que ce tableau.

---

## 10. Connecteurs — mock, read-only, disabled, real ?

Le seul `fetch` sortant de tout `src/` est celui de `http-provider.ts` (Resend),
injecté via `fetchImpl`. Tout le reste est en mémoire ou en base.

| Connecteur | Où | État |
| --- | --- | --- |
| `generic_webhook` | `connectors/registry.ts` | **mock** — `testConnection` renvoie `healthy` en dur, sans rien tester |
| `csv_contacts` | `connectors/registry.ts` | **real (local)** — l'analyse CSV fonctionne vraiment ; aucun service tiers |
| `mock_business` | `connectors/registry.ts` | **mock** — assumé par son nom |
| `google_business_profile` | `connectors/catalog.ts` | **disabled** — carte de catalogue sans définition exécutable |
| `universal-connectors` | module | **planning-only** — deux fonctions : lire un espace de travail, préparer un plan d'installation. N'installe rien |
| `connector-execution` | module | **mock strict** — politique et journalisation réelles, exécution simulée |
| `oauth` | module | **mock** — aucun échange de jeton réseau |
| `domain-connections` | module | **mock** — providers simulés |
| `software-connections` / `software-directory` | modules | **catalogue** — descriptif, non exécutable |
| `whatsapp` | module | **real (hors-produit)** — lien `wa.me`, l'envoi a lieu dans l'application du dirigeant |
| `email` (Resend) | module | **real, disabled par défaut** — le seul vrai adaptateur sortant |
| Stockage fichiers | `assets/storage.ts` | **real (disque local)** |

**Zéro connecteur production-ready** au sens du prompt maître (exécution réelle,
idempotente, auditée, sous politique). L'email s'en approche : il a l'idempotence,
la classification d'échec et l'audit, mais il n'est pas exposé comme capacité.

---

## 11. Plan pour la PR #10

**Recommandation : fusionner telle quelle, sans y ajouter la phase OS.**

Justification factuelle :

- `mergeable_state: clean`, 0 commit de retard sur `main` — aucun rebase requis.
- CI verte sur `d002e07` : lint, typecheck, build, 77 fichiers de test, migrations
  PostgreSQL 17 sur base vide et base migrée, couverture RLS, index
  tenant-leading, Playwright.
- 122 fichiers pour 20 lots indépendants. Chaque lot est un commit distinct avec
  son message. La revue par commit est praticable ; la revue en bloc ne l'est pas.

Ce qu'il **ne faut pas** faire :

- *Découper rétroactivement en 20 PR.* Les lots partagent des migrations
  séquentielles (`068` → `078`) et des types communs. Les séparer maintenant crée
  20 conflits pour zéro gain de revue.
- *Empiler la phase OS dessus.* La PR grossirait sans fin et la fusion
  reculerait d'autant. Le prompt maître demande des tranches verticales, pas une
  PR fleuve.

**Séquence proposée :**

1. Sortir la PR #10 du mode brouillon, la faire fusionner. Ce lot OS-0 y est
   ajouté parce qu'il est purement documentaire et outillant : il ne touche aucun
   code produit, ne crée aucune migration, et donne au relecteur le cadre de la
   suite.
2. Supprimer les 8 branches obsolètes.
3. Ouvrir OS-1 (Conversation Hub) sur une branche neuve partant de `main` à jour.
4. Poser le `testTimeout` global en premier commit d'OS-1, avant les nouvelles
   suites.

Si le dirigeant préfère fusionner la PR #10 **sans** OS-0, ce lot se détache
proprement : il n'a aucune dépendance de code sur les 20 autres.

---

## 12. Prochaine verticale — OS-1, Conversation Hub

Critère de succès imposé : *un fil canonique visible en web et sur un canal de
test*.

Périmètre minimal, de bout en bout :

- Tables `conversation_threads` et `canonical_messages`, tenant-scopées, **avec
  leur migration RLS dédiée** — la RLS générique ne couvre que les tables
  existant au moment où elle s'exécute (leçon des lots 5, 8 et 15).
- Identité omnicanale : une personne, plusieurs adresses de canal, réutilisant la
  normalisation de numéros existante.
- Idempotence par `idempotency_key` sur le message entrant, et anti-boucle : un
  message issu d'un miroir ne redéclenche pas d'écriture.
- Adaptateur `web` (réel) + adaptateur `test` (mock explicite, statut affiché).
- Une page de fil qui montre qui a envoyé quoi, depuis quel canal, à quel moment,
  et l'état de livraison de chaque réplication.
- Tests : unitaires, intégration, isolation RLS entre deux organisations,
  idempotence, anti-boucle, et un parcours Playwright web → fil → réplication.

Ce que OS-1 ne fait **pas** : ni orchestrateur, ni exécution de capacité, ni
politique. Ils viennent en OS-2 et OS-3, sur un hub qui existe.

---

## 13. Ce que cet audit ne couvre pas

- `pnpm db:verify` n'a pas tourné sur cette machine (pas de PostgreSQL). Preuve
  déléguée à la CI verte sur `d002e07`.
- Les 47 documents de `docs/` n'ont pas été relus un par un contre le code. Seuls
  `AI_PROVIDER.md` et les documents des 20 lots l'ont été. La relecture complète
  est portée dans `docs/NEXT_STEPS.md`.
- Aucune mesure de performance ni de coût. Hors périmètre d'un audit d'entrée.
