import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  getConnectors,
  importCsvContacts,
  receiveWebhook,
  syncMockConnector,
} from "../src/modules/connectors";
import { getCrm } from "../src/modules/crm";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("connectors module", () => {
  it("imports contacts, syncs the mock connector, and receives webhook leads", async () => {
    const { db, services } = await setup();
    const demo = await services.seedDemo();

    const report = await importCsvContacts(
      db,
      demo.user.id,
      demo.tenant.id,
      "nom,email,telephone\nModule Contact,module-contact@example.com,+596 696 55 66 77",
    );
    expect(report.imported).toBe(1);

    await syncMockConnector(db, demo.user.id, demo.tenant.id);
    const connectors = await getConnectors(db, demo.user.id, demo.tenant.id);
    expect(
      connectors.find((connector) => connector.key === "mock_business")?.health,
    ).toBe("healthy");

    const endpoint = await db.query<{ token: string }>(
      "select token from webhook_endpoints where tenant_id = $1 limit 1",
      [demo.tenant.id],
    );
    await receiveWebhook(db, endpoint.rows[0]!.token, {
      name: "Module Webhook",
      email: "module-webhook@example.com",
      phone: "+596 696 10 11 12",
      message: "Demande module",
    });

    const crm = await getCrm(db, demo.user.id, demo.tenant.id);
    expect(
      crm.contacts.some((contact) => contact.email === "module-contact@example.com"),
    ).toBe(true);
    expect(
      crm.contacts.some((contact) => contact.email === "module-webhook@example.com"),
    ).toBe(true);
  });
});
