/**
 * Vérifie que l'état de reprise de l'agent est présent, cohérent et frais,
 * puis écrit `docs/DRIFT_REPORT.md`.
 *
 * Le rapport est écrit **dans tous les cas**, y compris en échec : un contrôle
 * qui ne laisse aucune trace quand il échoue n'aide personne à la reprise.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const requiredFiles = [
  "docs/AGENT_STATE.json",
  "docs/WORKLOG.md",
  "docs/NEXT_STEPS.md",
  "docs/RESUME_PROMPT.md",
  "docs/ROADMAP_TRADIKOM_ONE_OS.md",
  "docs/AUDIT_TRADIKOM_ONE_OS_ENTRY.md",
];

/**
 * Au-delà de cette fenêtre, l'état déclaré n'est plus une source fiable pour
 * reprendre : il décrit un dépôt qui a probablement bougé depuis.
 */
const stalenessDays = 30;

const driftReportPath = "docs/DRIFT_REPORT.md";

type Report = {
  checkedAt: string;
  status: "ready" | "blocked";
  missing: string[];
  problems: string[];
  state: {
    phase?: string;
    branch?: string;
    lastCommit?: string;
    updatedAt?: string;
    ageDays?: number;
    nextTask?: string;
  };
  nextInstruction: string;
};

function main() {
  const missing = requiredFiles.filter((file) => !existsSync(file));
  const problems: string[] = [];
  const state: Report["state"] = {};

  if (!missing.includes("docs/AGENT_STATE.json")) {
    inspectAgentState(problems, state);
  }

  if (!missing.includes("docs/NEXT_STEPS.md")) {
    const nextSteps = readFileSync("docs/NEXT_STEPS.md", "utf8");
    if (!nextSteps.includes("## Action immédiate")) {
      problems.push(
        "docs/NEXT_STEPS.md ne contient pas de section « Action immédiate » : une liste sans première action n'est pas un point de reprise.",
      );
    }
  }

  const blocked = missing.length > 0 || problems.length > 0;
  const report: Report = {
    checkedAt: new Date().toISOString(),
    status: blocked ? "blocked" : "ready",
    missing,
    problems,
    state,
    nextInstruction: blocked
      ? "Corriger les points ci-dessus avant d'écrire du code : l'état de reprise n'est pas exploitable."
      : "Lire docs/AGENT_STATE.json puis reprendre la première tâche incomplète de docs/NEXT_STEPS.md.",
  };

  writeReport(report);

  for (const file of missing) {
    process.stderr.write(`Fichier de continuité manquant : ${file}\n`);
  }
  for (const problem of problems) {
    process.stderr.write(`${problem}\n`);
  }

  if (blocked) {
    process.exit(1);
  }

  process.stdout.write(
    `Continuité vérifiée — phase ${state.phase ?? "inconnue"}, état à jour depuis ${state.ageDays ?? "?"} jour(s).\n`,
  );
}

function inspectAgentState(problems: string[], state: Report["state"]) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync("docs/AGENT_STATE.json", "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    problems.push(
      `docs/AGENT_STATE.json illisible : ${error instanceof Error ? error.message : "JSON invalide"}.`,
    );
    return;
  }

  state.phase = asString(parsed.phase);
  state.branch = asString(parsed.branch);
  state.lastCommit = asString(parsed.lastCommit);
  state.updatedAt = asString(parsed.updatedAt);
  state.nextTask = asString(parsed.nextTask);

  // La dérive qui compte : un état de reprise qui ne parle plus de conversation
  // décrit un projet qui a quitté sa north star sans le dire.
  const northStar = asString(parsed.northStar);
  if (!northStar || !northStar.toLowerCase().includes("conversation")) {
    problems.push(
      "Dérive de north star : l'objectif conversationnel a disparu de docs/AGENT_STATE.json.",
    );
  }

  if (!state.nextTask) {
    problems.push(
      "docs/AGENT_STATE.json ne déclare aucune `nextTask` : rien à reprendre.",
    );
  }

  const ageDays = computeAgeDays(state.updatedAt);
  if (ageDays === null) {
    problems.push(
      "docs/AGENT_STATE.json ne porte pas d'`updatedAt` exploitable : impossible de juger si l'état est obsolète.",
    );
    return;
  }

  state.ageDays = ageDays;
  if (ageDays > stalenessDays) {
    problems.push(
      `État obsolète : docs/AGENT_STATE.json n'a pas bougé depuis ${ageDays} jours (seuil ${stalenessDays}).`,
    );
  }
}

function computeAgeDays(updatedAt: string | undefined): number | null {
  if (!updatedAt) return null;
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return null;
  const elapsed = Date.now() - timestamp;
  // Un état daté du futur n'est pas obsolète, il est faux — mais le signaler
  // comme tel relève de la revue humaine, pas de ce contrôle.
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function writeReport(report: Report) {
  mkdirSync(path.dirname(driftReportPath), { recursive: true });
  const body = [
    "# Drift report",
    "",
    "Généré par `pnpm agent:continuity-check`. Ne pas éditer à la main.",
    "",
    "```json",
    JSON.stringify(report, null, 2),
    "```",
    "",
  ].join("\n");
  writeFileSync(driftReportPath, body);
}

main();
