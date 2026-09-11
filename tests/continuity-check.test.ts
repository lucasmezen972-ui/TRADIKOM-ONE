import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContinuity } from "../scripts/agent/continuity-check";

const now = new Date("2026-07-30T03:51:02.000Z");

describe("contrôle de continuité", () => {
  it("utilise l'exécution TypeScript native sans socket tsx", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["agent:continuity-check"]).toBe(
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/agent/continuity-check.ts",
    );
  });

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
        masterPrompt: {
          source: "/prompt-maitre-indisponible-en-ci.pdf",
          sha256:
            "bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5",
          pageCount: 71,
          mandatoryPages: [3, 4, 5, 6, 7, 31, 32, 33, 46, 48, 69, 70, 71],
          alignment: {
            pagesConsulted: [3, 4, 31, 48, 71],
            sections: ["Instructions", "Roadmap", "Ordre exact"],
            requirement: "Construire la première verticale conversationnelle.",
            evidenceExpected: "Schéma canonique validé par les tests unitaires.",
          },
        },
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
      join(root, "docs/MASTER_PROMPT_REFERENCE.md"),
      "# Référence\n\n- nombre de pages : `71`;\n- bb838fb02c23247b1bcda8981539eebe73264a5334bfaf565aafa5bc26c50fe5\n\n## Boucle obligatoire de chaque automation\n\n## Carte des pages\n\n## Contrat de preuve\n",
    );
    writeFileSync(
      join(root, "docs/DRIFT_REPORT.md"),
      "# Drift report\n\n## Impact north star\nConversation.\n\n## Alignement prompt maître\nPages 3, 31 et 48.\n",
    );
    writeFileSync(
      join(root, "docs/NEXT_STEPS.md"),
      "# Étapes suivantes\n\n## Prochaine action concrète\nCréer le schéma.\n\n## Référence prompt maître\nPages 31 et 48.\n",
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
      "MASTER_PROMPT_REFERENCE.md",
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
