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

  const nextSteps = readFileSync(
    resolve(root, "docs/NEXT_STEPS.md"),
    "utf8",
  );
  if (!/prochaine action concrète/i.test(nextSteps)) {
    errors.push("NEXT_STEPS.md ne désigne pas la prochaine action concrète.");
  }

  return {
    checkedAt: now.toISOString(),
    status: errors.length === 0 ? "ready" : "blocked",
    missing: [],
    errors,
    warnings,
    nextInstruction:
      errors.length === 0
        ? "Lire AGENT_STATE.json puis reprendre la première tâche non terminée."
        : "Corriger l'état de continuité avant de poursuivre le code.",
  };
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
