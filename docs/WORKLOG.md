# Worklog TRADIKOM ONE OS

Journal en ajout seul. Une entrée par session ou par arrêt. On n'y réécrit rien :
une entrée fausse se corrige par une entrée suivante qui le dit.

Format : `## AAAA-MM-JJ — phase — commit` puis fait, preuve, suite.

---

## 2026-08-03 — OS-0 — `d002e07` → lot d'audit

**Fait.** Audit factuel d'entrée du dépôt et de la PR #10. Création des fichiers
de continuité, du script `continuity-check` et du workflow associé.

**Vérifié, pas supposé.**
- PR #10 : `open`, `draft`, `mergeable_state: clean`, 122 fichiers, +10 136 / −306,
  0 commit de retard sur `main`.
- CI verte sur `d002e07` (« Lint, test, build, and E2E », 12 min 22 s).
- 83 tables, 78 migrations runtime, 72 miroirs SQL, 46 modules, 77 fichiers de
  test, 2 spécifications Playwright.
- **0 primitive conversationnelle** : ni table, ni message canonique, ni identité
  omnicanale, ni adaptateur de canal.
- **0 module « IA » n'appelle un modèle.** Les 14 modules concernés sont des
  moteurs de règles déterministes.
- **1 seul appel HTTP sortant dans tout `src/`** : Resend, via `fetchImpl`
  injectable.

**Défaut trouvé.** `src/modules/ai/provider.ts` : `OpenAiProvider` construit un
client OpenAI puis délègue 100 % à `DeterministicAiProvider`, en étiquetant la
sortie `provider: "openai"`. Antérieur à la PR #10 (Phase 2, `860f071`), présent
sur `main`. Atténuation : `getAiProvider` n'est importé nulle part, le module est
du code mort. Il ne trompe personne aujourd'hui ; il mentira le jour où il sera
branché. Correctif porté dans `NEXT_STEPS`.

**Non vérifié sur cette machine.** `pnpm db:verify` — aucun PostgreSQL en écoute
dans le conteneur (`pg_isready` → `no response`). La couverture RLS et les index
tenant-leading restent attestés par la CI verte, qui exécute
`expectTenantRlsCoverage` et `expectTenantIndexes` sur PostgreSQL 17.

**Dérive nommée.** 20 lots livrés, tous corrects et testés, aucun au service du
cœur conversationnel. Le mécanisme est identifié : une boucle « ne reste jamais
improductif » branchée sur un backlog CRM produit indéfiniment du CRM.

**Suite.** OS-1, Conversation Hub. Détail dans `docs/NEXT_STEPS.md`.

---

## Avant le 2026-08-03

Les 20 lots de la PR #10 sont journalisés dans le corps de la PR et dans
`docs/BACKLOG.md`. Ils ne sont pas recopiés ici : ce journal commence avec la
phase OS.
