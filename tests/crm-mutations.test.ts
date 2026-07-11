import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
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

describe("crm mutations", () => {
  it("updates contact details, consent, notes, tasks, and audit logs tenant-safely", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Malia Mutations A",
      email: "malia.crm.mutations.a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Malia Mutations B",
      email: "malia.crm.mutations.b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Garage Mutations A",
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Garage Mutations B",
      category: "Garage automobile",
    });

    await services.saveOnboarding(ownerA.id, tenantA.id, defaultGarageOnboarding());
    await services.publishWebsite(ownerA.id, tenantA.id);
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Mutation",
      email: "client.mutation@example.com",
      phone: "+596 696 44 55 77",
      message: "Demande mutation CRM",
    });

    const crm = await services.getCrm(ownerA.id, tenantA.id);
    const contact = crm.contacts[0]!;

    const updated = await services.updateContact(ownerA.id, tenantA.id, contact.id, {
      name: "Client Mutation Qualifie",
      phone: "+596 696 00 00 00",
      status: "A qualifier",
      tags: ["site", "urgent", "site"],
      assignedUserId: ownerA.id,
    });
    expect(updated.name).toBe("Client Mutation Qualifie");
    expect(updated.tags).toEqual(["site", "urgent"]);

    await services.updateContactConsent(ownerA.id, tenantA.id, contact.id, {
      marketingOptIn: true,
      privacyNoticeAccepted: true,
      dataRetentionUntil: "2027-07-11",
    });
    await services.addContactNote(ownerA.id, tenantA.id, contact.id, {
      body: "Client a rappeler avant midi.",
    });
    const taskId = await services.createContactTask(ownerA.id, tenantA.id, contact.id, {
      title: "Rappeler le contact qualifie",
      dueAt: "2026-07-12",
      assignedUserId: ownerA.id,
    });
    await services.completeContactTask(ownerA.id, tenantA.id, contact.id, taskId);

    const detail = await services.getContactDetail(ownerA.id, tenantA.id, contact.id);
    expect(detail?.contact.status).toBe("A qualifier");
    expect(detail?.consent?.marketingOptIn).toBe(true);
    expect(detail?.notes[0]?.body).toContain("rappeler");
    expect(detail?.tasks.some((task) => task.id === taskId && task.status === "done")).toBe(
      true,
    );
    expect(detail?.activities.some((activity) => activity.type === "task.completed")).toBe(
      true,
    );

    await expect(
      services.updateContact(ownerB.id, tenantA.id, contact.id, {
        name: "Intrusion",
        phone: "",
        status: "Perdu",
        tags: [],
        assignedUserId: ownerB.id,
      }),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.createContactTask(ownerA.id, tenantA.id, contact.id, {
        title: "Assigner hors tenant",
        dueAt: "2026-07-12",
        assignedUserId: ownerB.id,
      }),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.getContactDetail(ownerB.id, tenantA.id, contact.id),
    ).rejects.toThrow("Acces refuse");

    const audit = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_logs where tenant_id = $1 order by created_at asc",
      [tenantA.id],
    );
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        { action: "contact.updated", target_id: contact.id },
        { action: "contact.consent_updated", target_id: contact.id },
        { action: "task.created", target_id: taskId },
        { action: "task.completed", target_id: taskId },
      ]),
    );

    await expect(services.getCrm(ownerA.id, tenantB.id)).rejects.toThrow(
      "Acces refuse",
    );
  });
});
