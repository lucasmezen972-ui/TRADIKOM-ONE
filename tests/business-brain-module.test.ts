import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import {
  createBusinessBrainEntry,
  getBusinessBrain,
} from "../src/modules/business-brain";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("business brain module", () => {
  it("builds tenant-scoped coverage and preserves immutable entry versions", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Business Brain Owner",
      email: "business-brain-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Business Brain Outsider",
      email: "business-brain-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Business Brain Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      owner.id,
      tenant.id,
      defaultGarageOnboarding(),
    );

    const firstId = await services.createBusinessBrainEntry(
      owner.id,
      tenant.id,
      {
        domain: "objectives",
        title: "Objectif trimestriel",
        summary: "Atteindre vingt nouveaux contrats ce trimestre.",
        details: "Priorité aux contrats d'entretien récurrents.",
        confidence: 90,
        sourceType: "manual",
        evidenceType: "document",
        evidenceSummary: "Objectif validé pendant la réunion de direction.",
        sourceRef: "compte-rendu-direction-2026-q3",
      },
    );

    const initial = await services.getBusinessBrain(owner.id, tenant.id);
    expect(initial.entries).toHaveLength(1);
    expect(initial.entries[0]).toMatchObject({
      id: firstId,
      domain: "objectives",
      version: 1,
      confidence: 90,
      evidence: [
        {
          type: "document",
          sourceRef: "compte-rendu-direction-2026-q3",
        },
      ],
    });
    expect(initial.signals).toMatchObject({
      members: 1,
      activeWorkflows: 1,
      websites: 1,
      contacts: 0,
    });
    expect(
      initial.coverage.find((item) => item.domain === "company"),
    ).toMatchObject({ status: "partial", connectedRecords: 1 });
    expect(
      initial.coverage.find((item) => item.domain === "objectives"),
    ).toMatchObject({
      status: "complete",
      connectedRecords: 1,
      managedEntries: 1,
    });

    const secondId = await services.reviseBusinessBrainEntry(
      owner.id,
      tenant.id,
      {
        entryId: firstId,
        domain: "objectives",
        title: "Objectif trimestriel révisé",
        summary: "Atteindre vingt-cinq nouveaux contrats ce trimestre.",
        details: "Le recrutement commercial augmente la capacité.",
        confidence: 85,
        sourceType: "manual",
        evidenceType: "observation",
        evidenceSummary: "Capacité réévaluée avec la responsable commerciale.",
      },
    );
    const revised = await services.getBusinessBrain(owner.id, tenant.id);
    expect(revised.entries).toHaveLength(1);
    expect(revised.entries[0]).toMatchObject({
      id: secondId,
      version: 2,
      supersedesId: firstId,
      title: "Objectif trimestriel révisé",
    });

    const history = await db.query<{
      id: string;
      status: string;
      version: number;
    }>(
      `select id, status, version
       from business_brain_entries
       where tenant_id = $1
       order by version asc`,
      [tenant.id],
    );
    expect(history.rows).toEqual([
      { id: firstId, status: "superseded", version: 1 },
      { id: secondId, status: "active", version: 2 },
    ]);
    const audit = await db.query<{ action: string }>(
      `select action from audit_logs
       where tenant_id = $1 and action like 'business_brain.%'
       order by created_at asc`,
      [tenant.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "business_brain.entry_created",
      "business_brain.entry_revised",
    ]);

    await expect(
      getBusinessBrain(db, outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.reviseBusinessBrainEntry(outsider.id, tenant.id, {
        entryId: secondId,
        domain: "objectives",
        title: "Modification interdite",
        summary: "Cette modification ne doit jamais être enregistrée.",
        details: "",
        confidence: 10,
        sourceType: "manual",
        evidenceType: "observation",
        evidenceSummary: "Aucune preuve tenant valide.",
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back the entry when its required evidence cannot be stored", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Rollback Owner",
      email: "business-brain-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Rollback Garage",
      category: "Garage automobile",
    });
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
      ) => {
        if (sql.includes("insert into business_brain_evidence")) {
          throw new Error("injected evidence failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      createBusinessBrainEntry(failingDb, owner.id, tenant.id, {
        domain: "pricing",
        title: "Tarif atelier",
        summary: "Le taux horaire de référence est validé.",
        details: "",
        confidence: 100,
        sourceType: "manual",
        evidenceType: "document",
        evidenceSummary: "Grille tarifaire signée par la direction.",
      }),
    ).rejects.toThrow("injected evidence failure");

    const records = await db.query<{ count: number | string }>(
      "select count(*)::int as count from business_brain_entries where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(records.rows[0]?.count)).toBe(0);
  });
});
