import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { createTestEmailProvider } from "../src/modules/email";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setupOrganisation(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const emailProvider = createTestEmailProvider();
  const services = createServices(db, {
    emailProvider,
    appUrl: "https://app.tradikom.test",
    revealAuthLinks: false,
  });
  const owner = await services.registerUser({
    name: `Owner Blocage ${suffix}`,
    email: `owner.blocage.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Blocage ${suffix}`,
    category: "Garage automobile",
  });
  return { db, services, emailProvider, owner, tenant };
}

describe("email suppression", () => {
  it("blocks an address after a permanent delivery failure", async () => {
    const { services, emailProvider, owner, tenant } =
      await setupOrganisation("definitif");

    emailProvider.queueOutcome({
      status: "permanent_failure",
      errorCode: "invalid_recipient",
    });
    const invitation = await services.createInvitation(owner.id, tenant.id, {
      email: "adresse.morte@example.com",
      role: "manager",
    });
    expect(invitation.email).toBe("adresse.morte@example.com");

    const suppressions = await services.getEmailSuppressions(
      owner.id,
      tenant.id,
    );
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]).toMatchObject({
      email: "adresse.morte@example.com",
      reason: "permanent_failure",
      errorCode: "invalid_recipient",
    });

    // Réinviter la même adresse est refusé, sans nouvel envoi.
    const sentBefore = emailProvider.messages.length;
    await expect(
      services.createInvitation(owner.id, tenant.id, {
        email: "adresse.morte@example.com",
        role: "manager",
      }),
    ).rejects.toMatchObject({ code: "email_suppressed" });
    expect(emailProvider.messages).toHaveLength(sentBefore);
  }, 60_000);

  it("leaves the address usable after a retryable failure", async () => {
    const { services, emailProvider, owner, tenant } =
      await setupOrganisation("temporaire");

    // Un 429 ou un 5xx dit que le fournisseur est indisponible, pas que
    // l'adresse est mauvaise : la bloquer priverait d'un destinataire valide.
    emailProvider.queueOutcome({
      status: "retryable_failure",
      errorCode: "provider_unavailable",
      retryAfterSeconds: 60,
    });
    await services.createInvitation(owner.id, tenant.id, {
      email: "adresse.valide@example.com",
      role: "manager",
    });

    expect(await services.getEmailSuppressions(owner.id, tenant.id)).toHaveLength(
      0,
    );

    const invitations = await services.getPendingInvitations(
      owner.id,
      tenant.id,
    );
    const pending = invitations.find(
      (item) => item.email === "adresse.valide@example.com",
    )!;
    // Le renvoi reste possible et aboutit.
    await services.resendInvitation(owner.id, tenant.id, pending.id);
    expect(await services.getEmailSuppressions(owner.id, tenant.id)).toHaveLength(
      0,
    );
  }, 60_000);

  it("blocks a resend and records the address once", async () => {
    const { services, emailProvider, owner, tenant } =
      await setupOrganisation("renvoi");

    await services.createInvitation(owner.id, tenant.id, {
      email: "renvoi.bloque@example.com",
      role: "manager",
    });
    const invitations = await services.getPendingInvitations(
      owner.id,
      tenant.id,
    );
    const pending = invitations.find(
      (item) => item.email === "renvoi.bloque@example.com",
    )!;

    emailProvider.queueOutcome({
      status: "permanent_failure",
      errorCode: "mailbox_unavailable",
    });
    await services.resendInvitation(owner.id, tenant.id, pending.id);
    expect(await services.getEmailSuppressions(owner.id, tenant.id)).toHaveLength(
      1,
    );

    await expect(
      services.resendInvitation(owner.id, tenant.id, pending.id),
    ).rejects.toMatchObject({ code: "email_suppressed" });

    // Un second échec n'ajoute pas de doublon ni ne réécrit la cause d'origine.
    const suppressions = await services.getEmailSuppressions(
      owner.id,
      tenant.id,
    );
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]?.errorCode).toBe("mailbox_unavailable");
  }, 60_000);

  it("releases an address on demand and refuses a release twice", async () => {
    const { services, emailProvider, owner, tenant } =
      await setupOrganisation("reautorisation");

    emailProvider.queueOutcome({
      status: "permanent_failure",
      errorCode: "invalid_recipient",
    });
    await services.createInvitation(owner.id, tenant.id, {
      email: "adresse.corrigee@example.com",
      role: "manager",
    });

    await services.releaseEmailSuppression(owner.id, tenant.id, {
      email: "ADRESSE.CORRIGEE@example.com",
    });
    expect(await services.getEmailSuppressions(owner.id, tenant.id)).toHaveLength(
      0,
    );

    // L'invitation redevient possible.
    await services.createInvitation(owner.id, tenant.id, {
      email: "adresse.corrigee@example.com",
      role: "manager",
    });

    await expect(
      services.releaseEmailSuppression(owner.id, tenant.id, {
        email: "adresse.corrigee@example.com",
      }),
    ).rejects.toMatchObject({ code: "email_suppression_not_found" });
  }, 60_000);

  it("keeps suppressions scoped to their organisation", async () => {
    const first = await setupOrganisation("org-a");
    const second = await setupOrganisation("org-b");

    first.emailProvider.queueOutcome({
      status: "permanent_failure",
      errorCode: "invalid_recipient",
    });
    await first.services.createInvitation(first.owner.id, first.tenant.id, {
      email: "partagee@example.com",
      role: "manager",
    });

    expect(
      await second.services.getEmailSuppressions(
        second.owner.id,
        second.tenant.id,
      ),
    ).toHaveLength(0);

    // La seconde organisation peut toujours écrire à cette adresse : le blocage
    // enregistre l'échec vécu par une organisation, pas un verdict partagé.
    await second.services.createInvitation(second.owner.id, second.tenant.id, {
      email: "partagee@example.com",
      role: "manager",
    });

    await expect(
      second.services.releaseEmailSuppression(
        second.owner.id,
        second.tenant.id,
        { email: "partagee@example.com" },
      ),
    ).rejects.toMatchObject({ code: "email_suppression_not_found" });
  }, 60_000);
});
