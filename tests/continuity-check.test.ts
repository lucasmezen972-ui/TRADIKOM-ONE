import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContinuity } from "../scripts/agent/continuity-check";

const now = new Date("2026-07-30T03:51:02.000Z");

describe("contrôle de continuité", () => {
  it("bloque quand les fichiers obligatoires manquent", () => {
    const root = mkdtempSync(join(tmpdir(), "tradikom-continuity-missing-"));
    const result = checkContinuity(root, now);

    expect(result.status).toBe("blocked");
    expect(result.missing).toContain("docs/AGENT_STATE.json");
  });

  it("accepte un état complet et conversation-first", () => {
    const root = mkdtempSync(join(tmpdir(), "tradikom-continuity-ready-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, "docs/AGENT_STATE.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-07-30T03:51:02.000Z",
        northStar: "Conversation continue et actions durables",
        branch: "codex/tradikom-one-os",
        status: "in_progress",
        currentPhase: "OS-0",
        nextAction: "Créer le schéma canonique de conversation.",
        nextFile: "src/modules/conversation-hub/schemas.ts",
        lastValidation: [],
      }),
    );
    for (const file of [
      "WORKLOG.md",
      "ROADMAP_TRADIKOM_ONE_OS.md",
      "AUDIT_TRADIKOM_ONE_OS_ENTRY.md",
      "RESUME_PROMPT.md",
    ]) {
      writeFileSync(join(root, "docs", file), "Présent\n");
    }
    writeFileSync(
      join(root, "docs/DRIFT_REPORT.md"),
      "# Drift report\n\n## Impact north star\nConversation.\n",
    );
    writeFileSync(
      join(root, "docs/NEXT_STEPS.md"),
      "# Étapes suivantes\n\n## Prochaine action concrète\nCréer le schéma.\n",
    );

    const result = checkContinuity(root, now);

    expect(result.status).toBe("ready");
    expect(result.errors).toEqual([]);
  });

  it("détecte un état ancien ou en dérive", () => {
    const root = mkdtempSync(join(tmpdir(), "tradikom-continuity-drift-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, "docs/AGENT_STATE.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-06-01T00:00:00.000Z",
        northStar: "Enrichir le CRM",
        branch: "codex/test",
        status: "in_progress",
        currentPhase: "OS-0",
        nextAction: "Action trop courte",
        nextFile: "src/test.ts",
        lastValidation: [],
      }),
    );
    for (const file of [
      "WORKLOG.md",
      "ROADMAP_TRADIKOM_ONE_OS.md",
      "AUDIT_TRADIKOM_ONE_OS_ENTRY.md",
      "RESUME_PROMPT.md",
    ]) {
      writeFileSync(join(root, "docs", file), "Présent\n");
    }
    writeFileSync(join(root, "docs/DRIFT_REPORT.md"), "# Drift report\n");
    writeFileSync(join(root, "docs/NEXT_STEPS.md"), "# Étapes suivantes\n");

    const result = checkContinuity(root, now);

    expect(result.status).toBe("blocked");
    expect(result.errors).toContain(
      "La north star conversation-first est absente de l'état agent.",
    );
    expect(result.errors).toContain("L'état de reprise a plus de quatorze jours.");
  });
});
