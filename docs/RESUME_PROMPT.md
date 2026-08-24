# Prompt de reprise

À coller tel quel dans une nouvelle session Claude Code. Il évite de refaire tout
le raisonnement après une interruption ou une limite d'usage.

```
Tu reprends le travail sur TRADIKOM ONE OS.

Commence par lire, dans cet ordre :
  docs/AGENT_STATE.json
  docs/NEXT_STEPS.md
  docs/DRIFT_REPORT.md
  docs/WORKLOG.md
  docs/AUDIT_TRADIKOM_ONE_OS_ENTRY.md

Puis verifie l etat reel :
  git status --short && git branch --show-current
  git rev-list --left-right --count origin/main...HEAD
  pnpm agent:continuity-check
  l etat et la CI de la PR en cours (docs/AGENT_STATE.json donne son numero)

Ne recommence pas depuis zero. Ne re-audite pas ce qui est deja dans
AUDIT_TRADIKOM_ONE_OS_ENTRY.md. Continue la premiere tache incomplete de
NEXT_STEPS.md.

North star : une seule conversation omnicanale, des connecteurs universels, des
actions durables et prouvees, des objectifs permanents, des validations simples.
Si la tache suivante ne rapproche pas de cette north star, dis-le avant de la
faire.

Regles non negociables :
  - Ne commite jamais du code non verifie. La CI GitHub est l autorite finale.
  - Ne pretends jamais qu une integration est reelle lorsqu elle est simulee.
  - Aucune table sans RLS dediee : la migration RLS generique ne couvre que les
    tables existant au moment ou elle s execute.
  - Aucun secret en clair, jamais.
  - Avant de t arreter, mets a jour docs/AGENT_STATE.json, docs/WORKLOG.md,
    docs/NEXT_STEPS.md et relance pnpm agent:continuity-check.
```

## Avant chaque arrêt

Que l'arrêt soit volontaire, dû à une limite d'usage ou à un échec :

1. Mettre à jour `docs/AGENT_STATE.json` — `lastCommit`, `nextTask`,
   `nextFileToTouch`, `commandsRun`, `updatedAt`.
2. Ajouter une entrée dans `docs/WORKLOG.md` (ajout seul, on ne réécrit pas).
3. Réécrire l'action immédiate de `docs/NEXT_STEPS.md`.
4. Lancer `pnpm agent:continuity-check` et committer le `DRIFT_REPORT.md` produit.

Un arrêt sans ces quatre gestes coûte, à la reprise, plus que le temps qu'il
aurait fallu pour les faire.
