import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
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

describe("crm duplicate detection and merge", () => {
  it("detects exact email and normalized telephone duplicates without crossing tenants", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Malia Duplicates A",
      email: "malia.duplicates.a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Malia Duplicates B",
      email: "malia.duplicates.b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Garage Doublons A",
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Garage Doublons B",
      category: "Garage automobile",
    });

    await publishTenantWebsite(services, ownerA.id, tenantA.id);
    await publishTenantWebsite(services, ownerB.id, tenantB.id);
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Email",
      email: "client.email.duplicate@example.com",
      phone: "+596 696 10 00 00",
      message: "Premier contact",
    });
    await insertHistoricalContact(
      db,
      tenantA.id,
      "contact_email_duplicate_upper",
      "Client Email Historique",
      "CLIENT.EMAIL.DUPLICATE@example.com",
      "+596 696 10 00 01",
      ownerA.id,
    );
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Telephone A",
      email: "phone.duplicate.a@example.com",
      phone: "+596 696 22 33 44",
      message: "Premier contact telephone",
    });
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Telephone B",
      email: "phone.duplicate.b@example.com",
      phone: "0596 696 22 33 44",
      message: "Second contact telephone",
    });
    await insertHistoricalContact(
      db,
      tenantB.id,
      "contact_email_duplicate_other_tenant",
      "Client Email B",
      "CLIENT.EMAIL.DUPLICATE@example.com",
      "+596 696 10 00 00",
      ownerB.id,
    );

    const candidates = await services.getContactDuplicateCandidates(
      ownerA.id,
      tenantA.id,
    );
    expect(
      candidates.some((candidate) =>
        candidate.reasons.some((reason) => reason.key === "email"),
      ),
    ).toBe(true);
    expect(
      candidates.some((candidate) =>
        candidate.reasons.some((reason) => reason.key === "phone"),
      ),
    ).toBe(true);
    expect(candidates.every((candidate) => candidate.tenantId === tenantA.id)).toBe(
      true,
    );
  });

  it("merges contacts transactionally with field choices, reassigned records, audit, and idempotency", async () => {
    const { db, services } = await setup();
    const { owner, tenant } = await createPublishedTenant(
      services,
      "merge-success",
    );
    await services.submitPublicLead(tenant.slug, {
      name: "Survivant Initial",
      email: "survivor.merge@example.com",
      phone: "+596 696 30 00 00",
      message: "Demande survivante",
    });
    await services.submitPublicLead(tenant.slug, {
      name: "Valeur Doublon",
      email: "merged.merge@example.com",
      phone: "0696 30 00 00",
      message: "Demande doublon",
    });

    const crm = await services.getCrm(owner.id, tenant.id);
    const survivor = crm.contacts.find(
      (contact) => contact.email === "survivor.merge@example.com",
    )!;
    const merged = crm.contacts.find(
      (contact) => contact.email === "merged.merge@example.com",
    )!;
    await services.updateContact(owner.id, tenant.id, merged.id, {
      name: "Valeur Doublon Qualifiee",
      phone: "0696 30 00 00",
      status: "A qualifier",
      tags: ["doublon", "site"],
      assignedUserId: owner.id,
    });
    const loserTaskId = await services.createContactTask(
      owner.id,
      tenant.id,
      merged.id,
      {
        title: "Verifier le doublon avant fusion",
        dueAt: "2026-07-20",
        assignedUserId: owner.id,
      },
    );

    const mergeRecord = await services.mergeContacts(owner.id, tenant.id, {
      survivorContactId: survivor.id,
      mergedContactId: merged.id,
      reason: "Meme client confirme pendant la qualification.",
      confirm: true,
      fieldSources: {
        name: "merged",
        email: "survivor",
        phone: "merged",
        status: "merged",
        source: "survivor",
        assignedUserId: "merged",
      },
    });
    const duplicateMergeRecord = await services.mergeContacts(owner.id, tenant.id, {
      survivorContactId: survivor.id,
      mergedContactId: merged.id,
      reason: "Nouvelle tentative ignoree.",
      confirm: true,
      fieldSources: {},
    });

    expect(duplicateMergeRecord.id).toBe(mergeRecord.id);
    const detail = await services.getContactDetail(owner.id, tenant.id, survivor.id);
    expect(detail?.contact.name).toBe("Valeur Doublon Qualifiee");
    expect(detail?.contact.email).toBe("survivor.merge@example.com");
    expect(detail?.contact.phone).toBe("0696 30 00 00");
    expect(detail?.contact.status).toBe("A qualifier");
    expect(detail?.contact.tags).toEqual(expect.arrayContaining(["doublon", "site"]));
    expect(detail?.tasks.some((task) => task.id === loserTaskId)).toBe(true);
    expect(detail?.opportunities.length).toBeGreaterThanOrEqual(2);
    await expect(
      services.findContactForTenant(owner.id, tenant.id, merged.id),
    ).resolves.toBeNull();

    const dangling = await db.query<{ count: number }>(
      `select count(*)::int as count
       from leads
       where tenant_id = $1 and contact_id = $2`,
      [tenant.id, merged.id],
    );
    expect(dangling.rows[0]?.count).toBe(0);
    const formSubmissions = await db.query<{ count: number }>(
      `select count(*)::int as count
       from form_submissions
       where tenant_id = $1 and created_contact_id = $2`,
      [tenant.id, merged.id],
    );
    expect(formSubmissions.rows[0]?.count).toBe(0);
    const audit = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_logs where tenant_id = $1",
      [tenant.id],
    );
    expect(audit.rows).toContainEqual({
      action: "contact.merged",
      target_id: mergeRecord.id,
    });
  });

  it("rejects read-only merge attempts", async () => {
    const { db, services } = await setup();
    const { owner, tenant } = await createPublishedTenant(
      services,
      "merge-readonly",
    );
    const readOnlyUser = await services.registerUser({
      name: "Lecture Seule",
      email: "readonly.merge@example.com",
      password: "Password!1",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
      [tenant.id, readOnlyUser.id, "read-only", new Date().toISOString()],
    );
    const { survivor, merged } = await createPhoneDuplicate(
      services,
      owner.id,
      tenant.id,
      tenant.slug,
      "readonly",
    );

    await expect(
      services.mergeContacts(readOnlyUser.id, tenant.id, {
        survivorContactId: survivor.id,
        mergedContactId: merged.id,
        reason: "Tentative non autorisee.",
        confirm: true,
        fieldSources: {},
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back reassignment when a merge step fails", async () => {
    const { db, services } = await setup();
    const { owner, tenant } = await createPublishedTenant(
      services,
      "merge-rollback",
    );
    const { survivor, merged } = await createPhoneDuplicate(
      services,
      owner.id,
      tenant.id,
      tenant.slug,
      "rollback",
    );
    const failingServices = createServices(createFailingDeleteDb(db));

    await expect(
      failingServices.mergeContacts(owner.id, tenant.id, {
        survivorContactId: survivor.id,
        mergedContactId: merged.id,
        reason: "Simulation d'echec transactionnel.",
        confirm: true,
        fieldSources: {},
      }),
    ).rejects.toThrow("forced rollback");

    await expect(
      services.findContactForTenant(owner.id, tenant.id, merged.id),
    ).resolves.not.toBeNull();
    const loserLeads = await db.query<{ count: number }>(
      "select count(*)::int as count from leads where tenant_id = $1 and contact_id = $2",
      [tenant.id, merged.id],
    );
    expect(loserLeads.rows[0]?.count).toBeGreaterThan(0);
  });
});

async function createPublishedTenant(
  services: ReturnType<typeof createServices>,
  label: string,
) {
  const owner = await services.registerUser({
    name: `Malia ${label}`,
    email: `malia.${label}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage ${label}`,
    category: "Garage automobile",
  });
  await publishTenantWebsite(services, owner.id, tenant.id);

  return { owner, tenant };
}

async function insertHistoricalContact(
  db: DbClient,
  tenantId: string,
  contactId: string,
  name: string,
  email: string,
  phone: string,
  assignedUserId: string,
) {
  const now = new Date().toISOString();
  await db.query(
    `insert into contacts
       (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      contactId,
      tenantId,
      name,
      email,
      phone,
      "Nouveau",
      "historique",
      "[]",
      assignedUserId,
      now,
      now,
    ],
  );
}

async function publishTenantWebsite(
  services: ReturnType<typeof createServices>,
  ownerId: string,
  tenantId: string,
) {
  await services.saveOnboarding(ownerId, tenantId, defaultGarageOnboarding());
  await services.publishWebsite(ownerId, tenantId);
}

async function createPhoneDuplicate(
  services: ReturnType<typeof createServices>,
  ownerId: string,
  tenantId: string,
  tenantSlug: string,
  label: string,
) {
  await services.submitPublicLead(tenantSlug, {
    name: `Client ${label} A`,
    email: `${label}.a@example.com`,
    phone: "+596 696 40 50 60",
    message: "Demande A",
  });
  await services.submitPublicLead(tenantSlug, {
    name: `Client ${label} B`,
    email: `${label}.b@example.com`,
    phone: "0696 40 50 60",
    message: "Demande B",
  });
  const crm = await services.getCrm(ownerId, tenantId);
  const survivor = crm.contacts.find(
    (contact) => contact.email === `${label}.a@example.com`,
  )!;
  const merged = crm.contacts.find(
    (contact) => contact.email === `${label}.b@example.com`,
  )!;

  return { survivor, merged };
}

function createFailingDeleteDb(db: DbClient): DbClient {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (sql.trim().toLowerCase().startsWith("delete from contacts")) {
        throw new Error("forced rollback");
      }

      return db.query<T>(sql, params);
    },
  };
}
