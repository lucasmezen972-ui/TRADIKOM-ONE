import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { hashToken, id, nowIso } from "../src/lib/security";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  return { db, services };
}

describe("suppression de compte RGPD", () => {
  it("supprime le compte : sessions révoquées, données anonymisées, audit créé", async () => {
    const { db, services } = await setup();
    const owner = await services.registerUser({
      name: "Owner Principal",
      email: "owner-suppression@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Atelier Suppression",
      category: "Services",
    });
    const member = await services.registerUser({
      name: "Membre Sortant",
      email: "membre-sortant@example.com",
      password: "Password!2",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'collaborator', $3)",
      [tenant.id, member.id, nowIso()],
    );
    const session = await services.createSession(member.id);
    await db.query(
      "insert into password_reset_tokens (id, user_id, token_hash, expires_at, used_at) values ($1, $2, $3, $4, null)",
      [id("reset"), member.id, hashToken("jeton-test"), "2099-01-01T00:00:00.000Z"],
    );

    const result = await services.deleteAccount(member.id, {
      password: "Password!2",
      confirmation: "SUPPRIMER",
    });
    expect(result).toMatchObject({
      deleted: true,
      sessionsRevoked: 1,
      membershipsRemoved: 1,
    });

    const activeSessions = await db.query<{ count: number | string }>(
      "select count(*)::int as count from sessions where user_id = $1 and revoked_at is null",
      [member.id],
    );
    expect(Number(activeSessions.rows[0]?.count)).toBe(0);
    expect(await services.getSessionUser(session.sessionToken)).toBeNull();

    const userRow = await db.query<{
      name: string;
      email: string;
      password_hash: string;
      deleted_at: string | null;
    }>("select name, email, password_hash, deleted_at from users where id = $1", [
      member.id,
    ]);
    expect(userRow.rows[0]?.name).toBe("Compte supprimé");
    expect(userRow.rows[0]?.email).not.toContain("membre-sortant");
    expect(userRow.rows[0]?.email).toContain("@anonymise.tradikom.invalid");
    expect(userRow.rows[0]?.password_hash).not.toContain("scrypt");
    expect(userRow.rows[0]?.deleted_at).toBeTruthy();

    const memberships = await db.query(
      "select tenant_id from memberships where user_id = $1",
      [member.id],
    );
    expect(memberships.rows).toHaveLength(0);
    const resetTokens = await db.query(
      "select id from password_reset_tokens where user_id = $1",
      [member.id],
    );
    expect(resetTokens.rows).toHaveLength(0);

    const auditRows = await db.query<{
      action: string;
      target_id: string;
      safe_metadata: string;
    }>(
      `select action, target_id, safe_metadata from audit_logs
       where tenant_id = $1 and action like 'account.%' order by action asc`,
      [tenant.id],
    );
    expect(auditRows.rows.map((row) => row.action)).toEqual([
      "account.deletion_executed",
      "account.deletion_requested",
    ]);
    for (const row of auditRows.rows) {
      expect(row.target_id).toBe(member.id);
      expect(row.safe_metadata).not.toContain("membre-sortant@example.com");
      expect(row.safe_metadata).not.toContain("Membre Sortant");
      expect(row.safe_metadata).not.toContain("Password!2");
    }

    await expect(
      services.loginUser({
        email: "membre-sortant@example.com",
        password: "Password!2",
      }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("refuse la suppression si le mot de passe est incorrect", async () => {
    const { db, services } = await setup();
    const owner = await services.registerUser({
      name: "Owner Refus",
      email: "owner-refus@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Atelier Refus",
      category: "Services",
    });
    const member = await services.registerUser({
      name: "Membre Protégé",
      email: "membre-protege@example.com",
      password: "Password!2",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'collaborator', $3)",
      [tenant.id, member.id, nowIso()],
    );
    const session = await services.createSession(member.id);

    await expect(
      services.deleteAccount(member.id, {
        password: "MauvaisMotDePasse!",
        confirmation: "SUPPRIMER",
      }),
    ).rejects.toMatchObject({ code: "invalid_password" });

    const userRow = await db.query<{ email: string; deleted_at: string | null }>(
      "select email, deleted_at from users where id = $1",
      [member.id],
    );
    expect(userRow.rows[0]?.email).toBe("membre-protege@example.com");
    expect(userRow.rows[0]?.deleted_at).toBeNull();
    expect(await services.getSessionUser(session.sessionToken)).not.toBeNull();
    const memberships = await db.query(
      "select tenant_id from memberships where user_id = $1",
      [member.id],
    );
    expect(memberships.rows).toHaveLength(1);
    const auditRows = await db.query(
      "select id from audit_logs where tenant_id = $1 and action like 'account.%'",
      [tenant.id],
    );
    expect(auditRows.rows).toHaveLength(0);
  });

  it("refuse la suppression tant que l'utilisateur est le seul owner d'une organisation", async () => {
    const { db, services } = await setup();
    const owner = await services.registerUser({
      name: "Owner Unique",
      email: "owner-unique@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Organisation Unique",
      category: "Commerce",
    });

    await expect(
      services.deleteAccount(owner.id, {
        password: "Password!1",
        confirmation: "SUPPRIMER",
      }),
    ).rejects.toMatchObject({
      code: "sole_owner_conflict",
      message: expect.stringContaining("Organisation Unique"),
    });
    const ownerRow = await db.query<{ email: string }>(
      "select email from users where id = $1",
      [owner.id],
    );
    expect(ownerRow.rows[0]?.email).toBe("owner-unique@example.com");

    const coOwner = await services.registerUser({
      name: "Co Owner",
      email: "co-owner@example.com",
      password: "Password!3",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'owner', $3)",
      [tenant.id, coOwner.id, nowIso()],
    );

    const result = await services.deleteAccount(owner.id, {
      password: "Password!1",
      confirmation: "SUPPRIMER",
    });
    expect(result.deleted).toBe(true);
  });

  it("préserve les données des autres tenants et utilisateurs", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Owner A",
      email: "owner-a-isolation@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Isolation A",
      category: "Services",
    });
    const ownerB = await services.registerUser({
      name: "Owner B",
      email: "owner-b-isolation@example.com",
      password: "Password!2",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Isolation B",
      category: "Commerce",
    });
    const leaver = await services.registerUser({
      name: "Membre Multi",
      email: "membre-multi@example.com",
      password: "Password!4",
    });
    const now = nowIso();
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'collaborator', $3)",
      [tenantA.id, leaver.id, now],
    );
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'manager', $3)",
      [tenantB.id, leaver.id, now],
    );
    await db.query(
      `insert into contacts (
         id, tenant_id, name, email, phone, status, source, tags,
         assigned_user_id, created_at, updated_at
       ) values ($1, $2, 'Contact conservé', 'contact-b@example.com', '',
         'Nouveau', 'test', '[]', $3, $4, $4)`,
      [id("contact"), tenantB.id, ownerB.id, now],
    );
    const sessionA = await services.createSession(ownerA.id);
    const sessionB = await services.createSession(ownerB.id);

    const result = await services.deleteAccount(leaver.id, {
      password: "Password!4",
      confirmation: "SUPPRIMER",
    });
    expect(result.membershipsRemoved).toBe(2);

    const otherUsers = await db.query<{ id: string; email: string }>(
      "select id, email from users where id in ($1, $2) order by email asc",
      [ownerA.id, ownerB.id],
    );
    expect(otherUsers.rows.map((row) => row.email)).toEqual([
      "owner-a-isolation@example.com",
      "owner-b-isolation@example.com",
    ]);
    expect(await services.getSessionUser(sessionA.sessionToken)).not.toBeNull();
    expect(await services.getSessionUser(sessionB.sessionToken)).not.toBeNull();

    const remainingMemberships = await db.query<{ user_id: string }>(
      "select user_id from memberships where tenant_id in ($1, $2)",
      [tenantA.id, tenantB.id],
    );
    expect(remainingMemberships.rows.map((row) => row.user_id).sort()).toEqual(
      [ownerA.id, ownerB.id].sort(),
    );

    const contacts = await db.query(
      "select id from contacts where tenant_id = $1",
      [tenantB.id],
    );
    expect(contacts.rows).toHaveLength(1);

    for (const tenantId of [tenantA.id, tenantB.id]) {
      const auditRows = await db.query<{ action: string }>(
        "select action from audit_logs where tenant_id = $1 and action like 'account.%'",
        [tenantId],
      );
      expect(auditRows.rows.map((row) => row.action).sort()).toEqual([
        "account.deletion_executed",
        "account.deletion_requested",
      ]);
    }
  });
});
