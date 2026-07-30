import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_FILES = [
  "docs/AGENT_STATE.json",
  "docs/WORKLOG.md",
  "docs/NEXT_STEPS.md",
  "docs/DRIFT_REPORT.md",
  "docs/ROADMAP_TRADIKOM_ONE_OS.md",
  "docs/AUDIT_TRADIKOM_ONE_OS_ENTRY.md",
  "docs/RESUME_PROMPT.md",
  "docs/MASTER_PROMPT_REFERENCE.md",
] as const;

const MASTER_PROMPT_SHA256 =
  "bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5";
const MASTER_PROMPT_PAGE_COUNT = 71;
const MASTER_PROMPT_CORE_PAGES = [
  3, 4, 5, 6, 7, 31, 32, 33, 46, 48, 69, 70, 71,
] as const;

type AgentState = {
  version?: number;
  updatedAt?: string;
  northStar?: string;
  branch?: string;
  status?: string;
  currentPhase?: string;
  nextAction?: string;
  nextFile?: string;
  lastValidation?: Array<{ command?: string; status?: string }>;
  masterPrompt?: {
    source?: string;
    sha256?: string;
    pageCount?: number;
    mandatoryPages?: number[];
    alignment?: {
      pagesConsulted?: number[];
      sections?: string[];
      requirement?: string;
      evidenceExpected?: string;
    };
  };
};

export type ContinuityResult = {
  checkedAt: string;
  status: "ready" | "blocked";
  missing: string[];
  errors: string[];
  warnings: string[];
  nextInstruction: string;
};

export function checkContinuity(
  root = process.cwd(),
  now = new Date(),
): ContinuityResult {
  const missing = REQUIRED_FILES.filter(
    (file) => !existsSync(resolve(root, file)),
  );
  const errors: string[] = [];
  const warnings: string[] = [];

  if (missing.length > 0) {
    return {
      checkedAt: now.toISOString(),
      status: "blocked",
      missing: [...missing],
      errors: ["Les fichiers de continuité obligatoires sont incomplets."],
      warnings,
      nextInstruction: "Créer les fichiers manquants avant de poursuivre le code.",
    };
  }

  const state = parseState(root, errors);
  if (state) {
    if (state.version !== 1) {
      errors.push("AGENT_STATE.json doit utiliser la version 1 du contrat.");
    }
    if (!state.northStar?.toLowerCase().includes("conversation")) {
      errors.push("La north star conversation-first est absente de l'état agent.");
    }
    if (!state.branch?.trim()) {
      errors.push("La branche active n'est pas renseignée.");
    }
    if (!state.currentPhase?.trim()) {
      errors.push("La phase active n'est pas renseignée.");
    }
    if (!state.nextAction || state.nextAction.trim().length < 20) {
      errors.push("La prochaine action doit être concrète et exploitable.");
    }
    if (!state.nextFile?.trim()) {
      errors.push("Le prochain fichier à modifier n'est pas renseigné.");
    }
    if (!Array.isArray(state.lastValidation)) {
      errors.push("Les validations déjà exécutées doivent être listées.");
    }
    validateMasterPromptState(state, errors, warnings);

    const updatedAt = state.updatedAt ? new Date(state.updatedAt) : null;
    if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
      errors.push("La date de mise à jour de l'état est invalide.");
    } else {
      const ageDays = (now.getTime() - updatedAt.getTime()) / 86_400_000;
      if (ageDays > 14) {
        errors.push("L'état de reprise a plus de quatorze jours.");
      } else if (ageDays > 7) {
        warnings.push("L'état de reprise a plus de sept jours.");
      }
    }

    const ciBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
    if (ciBranch && state.branch && ciBranch !== state.branch) {
      warnings.push(
        `La branche CI (${ciBranch}) diffère de la branche d'état (${state.branch}).`,
      );
    }
  }

  const driftReport = readFileSync(
    resolve(root, "docs/DRIFT_REPORT.md"),
    "utf8",
  );
  if (!/impact north star/i.test(driftReport)) {
    errors.push("DRIFT_REPORT.md doit contenir une section Impact north star.");
  }
  if (!/## Alignement prompt maître/i.test(driftReport)) {
    errors.push(
      "DRIFT_REPORT.md doit contenir une section Alignement prompt maître.",
    );
  } else if (!/pages?\s+\d+/i.test(driftReport)) {
    errors.push("DRIFT_REPORT.md doit citer les pages du prompt maître.");
  }

  const nextSteps = readFileSync(
    resolve(root, "docs/NEXT_STEPS.md"),
    "utf8",
  );
  if (!/prochaine action concrète/i.test(nextSteps)) {
    errors.push("NEXT_STEPS.md ne désigne pas la prochaine action concrète.");
  }
  if (!/## Référence prompt maître/i.test(nextSteps)) {
    errors.push(
      "NEXT_STEPS.md doit relier la prochaine action au prompt maître.",
    );
  } else if (!/pages?\s+\d+/i.test(nextSteps)) {
    errors.push("NEXT_STEPS.md doit citer les pages qui imposent la suite.");
  }

  const masterPromptReference = readFileSync(
    resolve(root, "docs/MASTER_PROMPT_REFERENCE.md"),
    "utf8",
  );
  if (
    !masterPromptReference.includes(MASTER_PROMPT_SHA256) ||
    !masterPromptReference.includes(`nombre de pages : \`${MASTER_PROMPT_PAGE_COUNT}\``)
  ) {
    errors.push(
      "La référence du prompt maître ne correspond pas au PDF canonique de 71 pages.",
    );
  }
  for (const requiredSection of [
    "## Boucle obligatoire de chaque automation",
    "## Carte des pages",
    "## Contrat de preuve",
  ]) {
    if (!masterPromptReference.includes(requiredSection)) {
      errors.push(`MASTER_PROMPT_REFERENCE.md doit contenir ${requiredSection}.`);
    }
  }

  return {
    checkedAt: now.toISOString(),
    status: errors.length === 0 ? "ready" : "blocked",
    missing: [],
    errors,
    warnings,
    nextInstruction:
      errors.length === 0
        ? "Relire les pages obligatoires du prompt maître puis reprendre la première tâche non terminée de la page 48."
        : "Corriger l'état de continuité avant de poursuivre le code.",
  };
}

function validateMasterPromptState(
  state: AgentState,
  errors: string[],
  warnings: string[],
) {
  const masterPrompt = state.masterPrompt;
  if (!masterPrompt) {
    errors.push("AGENT_STATE.json doit référencer le prompt maître canonique.");
    return;
  }
  if (masterPrompt.sha256 !== MASTER_PROMPT_SHA256) {
    errors.push("L'empreinte du prompt maître dans AGENT_STATE.json est invalide.");
  }
  if (masterPrompt.pageCount !== MASTER_PROMPT_PAGE_COUNT) {
    errors.push("AGENT_STATE.json doit déclarer les 71 pages du prompt maître.");
  }
  const mandatoryPages = new Set(masterPrompt.mandatoryPages ?? []);
  if (MASTER_PROMPT_CORE_PAGES.some((page) => !mandatoryPages.has(page))) {
    errors.push("Les pages cœur du prompt maître ne sont pas toutes obligatoires.");
  }

  const alignment = masterPrompt.alignment;
  if (!alignment?.pagesConsulted?.length) {
    errors.push("L'état doit lister les pages du prompt maître consultées.");
  } else if (
    alignment.pagesConsulted.some(
      (page) => !Number.isInteger(page) || page < 1 || page > 71,
    )
  ) {
    errors.push("Les pages consultées du prompt maître sont invalides.");
  }
  if (!alignment?.sections?.length) {
    errors.push("L'état doit lister les sections du prompt maître appliquées.");
  }
  if (!alignment?.requirement || alignment.requirement.trim().length < 20) {
    errors.push("L'exigence active du prompt maître doit être explicite.");
  }
  if (
    !alignment?.evidenceExpected ||
    alignment.evidenceExpected.trim().length < 20
  ) {
    errors.push("La preuve attendue pour l'exigence active doit être explicite.");
  }

  const source = process.env.TRADIKOM_MASTER_PROMPT_PATH || masterPrompt.source;
  if (!source?.trim()) {
    errors.push("Le chemin du PDF canonique n'est pas renseigné.");
    return;
  }
  if (!existsSync(source)) {
    warnings.push(
      "Le PDF canonique n'est pas disponible dans cet environnement; l'automation locale doit bloquer toute nouvelle sélection de tâche.",
    );
    return;
  }
  const sourceHash = createHash("sha256")
    .update(readFileSync(source))
    .digest("hex");
  if (sourceHash !== MASTER_PROMPT_SHA256) {
    errors.push("Le PDF canonique a changé ou son empreinte est invalide.");
  }
}

function parseState(root: string, errors: string[]) {
  try {
    return JSON.parse(
      readFileSync(resolve(root, "docs/AGENT_STATE.json"), "utf8"),
    ) as AgentState;
  } catch {
    errors.push("AGENT_STATE.json n'est pas un JSON valide.");
    return null;
  }
}

function run() {
  const result = checkContinuity();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "blocked") process.exitCode = 1;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entrypoint === import.meta.url) run();
