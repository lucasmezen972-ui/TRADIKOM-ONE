import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { submitPublicLead } from "../src/modules/crm";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("public lead ingestion module", () => {
  it("keeps idempotent public submissions from creating duplicate leads", async () => {
    const { db, services } = await setup();
    const user = await services.registerUser({
      name: "Malia Lead",
      email: "malia.lead@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Garage Lead",
      category: "Garage automobile",
    });
    await services.saveOnboarding(user.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(user.id, tenant.id);

    const payload = {
      name: "Client Idempotent",
      email: "idempotent@example.com",
      phone: "+596 696 22 33 44",
      message: "Demande de devis",
      idempotencyKey: "lead-idempotency-key",
    };

    await submitPublicLead(db, tenant.slug, payload, {
      getPublishedSite: (_db, slug) => services.getPublishedSite(slug),
    });
    await submitPublicLead(db, tenant.slug, payload, {
      getPublishedSite: (_db, slug) => services.getPublishedSite(slug),
    });

    const leads = await db.query<{ count: number }>(
      "select count(*)::int as count from leads where tenant_id = $1 and source = $2",
      [tenant.id, "website"],
    );
    const submissions = await db.query<{ count: number }>(
      "select count(*)::int as count from form_submissions where tenant_id = $1 and idempotency_key = $2",
      [tenant.id, payload.idempotencyKey],
    );

    expect(leads.rows[0]?.count).toBe(1);
    expect(submissions.rows[0]?.count).toBe(1);
  });
});
