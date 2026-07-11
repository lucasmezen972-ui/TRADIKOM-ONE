import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("connectors", () => {
  it("imports CSV contacts and receives webhook leads", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();

    const report = await services.importCsvContacts(
      demo.user.id,
      demo.tenant.id,
      "nom,email,telephone\nAlicia Nilor,alicia@example.com,+596 696 44 55 66\nSans Email,,+596 696 00 00 00",
    );
    expect(report.imported).toBe(1);
    expect(report.invalid).toBe(1);

    const endpoint = await db.query<{ token: string }>(
      "select token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    await services.receiveWebhook(endpoint.rows[0].token, {
      name: "Client Webhook",
      email: "webhook@example.com",
      phone: "+596 696 77 88 99",
      message: "Demande API",
    });

    const crm = await services.getCrm(demo.user.id, demo.tenant.id);
    expect(crm.contacts.some((contact) => contact.email === "webhook@example.com")).toBe(
      true,
    );
    expect(crm.leads.length).toBeGreaterThanOrEqual(2);
  });

  it("parses quoted CSV values with embedded commas", async () => {
    const { services } = await setup();
    const demo = await services.seedDemo();

    const report = await services.importCsvContacts(
      demo.user.id,
      demo.tenant.id,
      'nom,email,telephone\n"Cabinet Conseil, Martinique",cabinet@example.com,+596 696 01 02 03',
    );

    expect(report.imported).toBe(1);
    const crm = await services.getCrm(demo.user.id, demo.tenant.id);
    expect(
      crm.contacts.some((contact) => contact.name === "Cabinet Conseil, Martinique"),
    ).toBe(true);
  });
});
