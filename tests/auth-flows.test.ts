import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createTestEmailProvider,
  type EmailKind,
  type TestEmailProvider,
} from "../src/modules/email";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  const emailProvider = createTestEmailProvider();
  return {
    db,
    emailProvider,
    services: createServices(db, {
      emailProvider,
      appUrl: "https://app.tradikom.test",
    }),
  };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("auth flows", () => {
  it("resets a password with a hashed single-use token and revokes sessions", async () => {
    const { db, emailProvider, services } = await setup();
    const user = await services.registerUser({
      name: "Malia Reset",
      email: "malia.reset@example.com",
      password: "Password!1",
    });
    const session = await services.createSession(user.id);
    const reset = await services.requestPasswordReset({
      email: "MALIA.RESET@example.com",
    });
    const resetToken = emailToken(emailProvider, "password_reset");

    expect(reset).toEqual({ accepted: true });

    const rows = await db.query<{ token_hash: string; used_at: string | null }>(
      "select token_hash, used_at from password_reset_tokens where user_id = $1",
      [user.id],
    );
    expect(rows.rows[0]?.token_hash).not.toBe(resetToken);
    expect(rows.rows[0]?.used_at).toBeNull();

    await services.resetPassword({
      token: resetToken,
      password: "NewPassword!2",
    });

    await expect(
      services.loginUser({
        email: "malia.reset@example.com",
        password: "Password!1",
      }),
    ).rejects.toThrow("Email ou mot de passe incorrect.");
    await expect(
      services.loginUser({
        email: "malia.reset@example.com",
        password: "NewPassword!2",
      }),
    ).resolves.toMatchObject({ id: user.id });
    expect(await services.getSessionUser(session.sessionToken)).toBeNull();
    await expect(
      services.resetPassword({
        token: resetToken,
        password: "AnotherPassword!3",
      }),
    ).rejects.toThrow("Lien de réinitialisation invalide ou expiré.");
  });

  it("does not reveal whether a password reset email exists", async () => {
    const { emailProvider, services } = await setup();
    const reset = await services.requestPasswordReset({
      email: "absent@example.com",
    });

    expect(reset).toEqual({ accepted: true });
    expect(emailProvider.messages).toHaveLength(0);
  });

  it("accepts an invitation once and creates the expected membership", async () => {
    const { db, emailProvider, services } = await setup();
    const owner = await services.registerUser({
      name: "Malia Owner",
      email: "owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Garage Invitation",
      category: "Garage automobile",
    });
    const invitation = await services.createInvitation(owner.id, tenant.id, {
      email: "invitee@example.com",
      role: "manager",
    });

    const invitationToken = emailToken(emailProvider, "team_invitation");
    expect(invitation).not.toHaveProperty("invitationToken");
    const rows = await db.query<{ token_hash: string; status: string }>(
      "select token_hash, status from invitations where id = $1",
      [invitation.id],
    );
    expect(rows.rows[0]?.token_hash).not.toBe(invitationToken);
    expect(rows.rows[0]?.status).toBe("pending");

    const accepted = await services.acceptInvitation({
      token: invitationToken,
      name: "Nouveau Membre",
      password: "Password!2",
    });
    const tenants = await services.getUserTenants(accepted.user.id);

    expect(accepted.tenant.id).toBe(tenant.id);
    expect(accepted.membership.role).toBe("manager");
    expect(tenants[0]?.membership.role).toBe("manager");
    await expect(
      services.acceptInvitation({
        token: invitationToken,
        name: "Nouveau Membre",
        password: "Password!2",
      }),
    ).rejects.toThrow("Invitation invalide ou expirée.");
  });

  it("lets owners update non-owner member roles", async () => {
    const { emailProvider, services } = await setup();
    const owner = await services.registerUser({
      name: "Owner Role",
      email: "owner-role@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Garage Role",
      category: "Garage automobile",
    });
    await services.createInvitation(owner.id, tenant.id, {
      email: "role-member@example.com",
      role: "collaborator",
    });
    const invitationToken = emailToken(emailProvider, "team_invitation");
    const accepted = await services.acceptInvitation({
      token: invitationToken,
      name: "Role Member",
      password: "Password!2",
    });

    await services.updateMemberRole(owner.id, tenant.id, {
      targetUserId: accepted.user.id,
      role: "read-only",
    });

    const tenants = await services.getUserTenants(accepted.user.id);
    expect(tenants[0]?.membership.role).toBe("read-only");
  });
});

function emailToken(provider: TestEmailProvider, kind: EmailKind) {
  const message = [...provider.messages]
    .reverse()
    .find((item) => item.kind === kind);
  const link = message?.text.match(/https?:\/\/\S+/)?.[0];
  const token = link ? new URL(link).searchParams.get("token") : null;

  if (!token) {
    throw new Error(`Expected a token in ${kind} test email.`);
  }

  return token;
}
