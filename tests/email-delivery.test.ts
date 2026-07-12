import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createConsoleEmailProvider,
  createTestEmailProvider,
  type EmailKind,
  type TestEmailProvider,
} from "../src/modules/email";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  const emailProvider = createTestEmailProvider();
  opened.push(db);
  return {
    db,
    emailProvider,
    services: createServices(db, {
      emailProvider,
      appUrl: "https://app.tradikom.test",
      revealAuthLinks: false,
    }),
  };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("auth and invitation email delivery", () => {
  it("returns the same reset response and only emails existing accounts", async () => {
    const { db, emailProvider, services } = await setup();
    const user = await services.registerUser({
      name: "Reset Email",
      email: "reset-email@example.com",
      password: "Password!1",
    });

    const existing = await services.requestPasswordReset({
      email: "RESET-EMAIL@example.com",
    });
    const unknown = await services.requestPasswordReset({
      email: "unknown@example.com",
    });

    expect(existing).toEqual({ accepted: true });
    expect(unknown).toEqual(existing);
    expect(existing).not.toHaveProperty("resetToken");
    expect(existing).not.toHaveProperty("developmentLink");
    expect(emailProvider.messages).toHaveLength(1);

    const message = emailProvider.messages[0];
    const token = emailToken(emailProvider, "password_reset");
    expect(message?.to).toBe("reset-email@example.com");
    expect(message?.subject).toContain("Réinitialisez");
    expect(message?.text).toContain("expire le");
    expect(message?.html).toContain("Réinitialiser mon mot de passe");
    expect(message?.text).toContain(
      `https://app.tradikom.test/reinitialiser-mot-de-passe?token=${token}`,
    );

    const stored = await db.query<{ token_hash: string }>(
      "select token_hash from password_reset_tokens where user_id = $1",
      [user.id],
    );
    expect(stored.rows[0]?.token_hash).not.toBe(token);
  });

  it("keeps raw links and recipient addresses out of console logs", async () => {
    const logs: Array<{ event: string; metadata: Record<string, unknown> }> = [];
    const provider = createConsoleEmailProvider((event, metadata) => {
      logs.push({ event, metadata });
    });
    const rawToken = "raw-token-that-must-never-be-logged";

    await provider.send({
      kind: "password_reset",
      to: "private@example.com",
      subject: "Réinitialisation",
      text: `https://app.tradikom.test/reinitialiser?token=${rawToken}`,
      html: `<a href="https://app.tradikom.test/reinitialiser?token=${rawToken}">Lien</a>`,
      metadata: { expiresAt: "2026-07-12T15:00:00.000Z" },
    });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).toContain("recipientHash");
  });

  it("delivers invitations and persists safe delivery status", async () => {
    const { db, emailProvider, services } = await setup();
    const { owner, tenant } = await createTenantFixture(services);

    const invitation = await services.createInvitation(owner.id, tenant.id, {
      email: "invite-delivery@example.com",
      role: "manager",
    });
    const token = emailToken(emailProvider, "team_invitation");

    expect(invitation).toMatchObject({ deliveryStatus: "sent" });
    expect(invitation).not.toHaveProperty("invitationToken");
    expect(emailProvider.messages[0]?.text).toContain("Garage Email");
    expect(emailProvider.messages[0]?.text).toContain("rôle manager");

    const row = await db.query<{
      token_hash: string;
      delivery_status: string;
      delivery_provider: string;
      delivery_attempts: number;
    }>("select * from invitations where id = $1", [invitation.id]);
    expect(row.rows[0]).toMatchObject({
      delivery_status: "sent",
      delivery_provider: "test",
      delivery_attempts: 1,
    });
    expect(row.rows[0]?.token_hash).not.toBe(token);
  });

  it("resends with a replacement token and invalidates the previous link", async () => {
    const { db, emailProvider, services } = await setup();
    const { owner, tenant } = await createTenantFixture(services);
    const invitation = await services.createInvitation(owner.id, tenant.id, {
      email: "resend@example.com",
      role: "collaborator",
    });
    const oldToken = emailToken(emailProvider, "team_invitation");

    const resent = await services.resendInvitation(
      owner.id,
      tenant.id,
      invitation.id,
    );
    const newToken = emailToken(emailProvider, "team_invitation");

    expect(resent).toMatchObject({ deliveryStatus: "sent" });
    expect(newToken).not.toBe(oldToken);
    await expect(
      services.acceptInvitation({
        token: oldToken,
        name: "Ancien Lien",
        password: "Password!2",
      }),
    ).rejects.toThrow("Invitation invalide ou expirée.");
    await expect(
      services.acceptInvitation({
        token: newToken,
        name: "Nouveau Lien",
        password: "Password!2",
      }),
    ).resolves.toMatchObject({ tenant: { id: tenant.id } });

    const delivery = await db.query<{ delivery_attempts: number }>(
      "select delivery_attempts from invitations where id = $1",
      [invitation.id],
    );
    expect(delivery.rows[0]?.delivery_attempts).toBe(2);
  });

  it("records retryable failures without putting tokens in audit metadata", async () => {
    const { db, emailProvider, services } = await setup();
    const { owner, tenant } = await createTenantFixture(services);
    emailProvider.queueOutcome({
      status: "retryable_failure",
      errorCode: "temporary_provider_failure",
      retryAfterSeconds: 60,
    });

    const invitation = await services.createInvitation(owner.id, tenant.id, {
      email: "failure@example.com",
      role: "read-only",
    });
    const token = emailToken(emailProvider, "team_invitation");

    expect(invitation).toMatchObject({ deliveryStatus: "retryable_failure" });
    const row = await db.query<{
      delivery_status: string;
      delivery_error_code: string;
    }>("select delivery_status, delivery_error_code from invitations where id = $1", [
      invitation.id,
    ]);
    expect(row.rows[0]).toEqual({
      delivery_status: "retryable_failure",
      delivery_error_code: "temporary_provider_failure",
    });

    const logs = await db.query<{ safe_metadata: string }>(
      "select safe_metadata from audit_logs where tenant_id = $1 and target_id = $2",
      [tenant.id, invitation.id],
    );
    expect(JSON.stringify(logs.rows)).not.toContain(token);
    expect(JSON.stringify(logs.rows)).toContain("temporary_provider_failure");
  });

  it("rejects expired invitations and cross-tenant resend attempts", async () => {
    const { db, emailProvider, services } = await setup();
    const first = await createTenantFixture(services, "first");
    const secondOwner = await services.registerUser({
      name: "Second Owner",
      email: "second-owner@example.com",
      password: "Password!1",
    });
    const secondTenant = await services.createTenant(secondOwner.id, {
      name: "Second Garage",
      category: "Garage automobile",
    });
    const invitation = await services.createInvitation(
      first.owner.id,
      first.tenant.id,
      { email: "expired@example.com", role: "manager" },
    );
    const token = emailToken(emailProvider, "team_invitation");
    await db.query("update invitations set expires_at = $1 where id = $2", [
      "2020-01-01T00:00:00.000Z",
      invitation.id,
    ]);

    await expect(
      services.acceptInvitation({
        token,
        name: "Expiré",
        password: "Password!2",
      }),
    ).rejects.toThrow("Invitation invalide ou expirée.");
    await expect(
      services.resendInvitation(secondOwner.id, secondTenant.id, invitation.id),
    ).rejects.toThrow("Invitation introuvable ou déjà utilisée.");
    expect(emailProvider.messages).toHaveLength(1);
  });
});

async function createTenantFixture(
  services: ReturnType<typeof createServices>,
  suffix = "email",
) {
  const owner = await services.registerUser({
    name: `Owner ${suffix}`,
    email: `owner-${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: "Garage Email",
    category: "Garage automobile",
  });
  return { owner, tenant };
}

function emailToken(provider: TestEmailProvider, kind: EmailKind) {
  const message = [...provider.messages]
    .reverse()
    .find((item) => item.kind === kind);
  const link = message?.text.match(/https?:\/\/\S+/)?.[0];
  const token = link ? new URL(link).searchParams.get("token") : null;

  if (!token) throw new Error(`Expected a token in ${kind} test email.`);
  return token;
}
