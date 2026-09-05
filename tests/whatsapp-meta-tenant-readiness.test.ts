import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  ChannelProviderEndpointError,
  createChannelProviderSecretKeyring,
  inspectMetaWhatsAppTenantReadiness,
  registerAuthorizedMetaWhatsAppEndpoint,
  revokeMetaWhatsAppEndpointSecret,
  rotateMetaWhatsAppEndpointSecret,
  setAuthorizedMetaWhatsAppEndpointStatus,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "meta-readiness-fingerprint-secret-32-bytes";
const timestamp = "2026-09-05T04:30:00.000Z";
const later = "2026-09-05T04:31:00.000Z";
const wabaId = "315589313241560883";
const phoneNumberId = "8794189252778687";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("préparation tenant WhatsApp Meta", () => {
  it("distingue canal absent, suspendu, accès manquant et organisation prête", async () => {
    const setup = await createSetup();

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toEqual({
      provider: "whatsapp_meta",
      state: "not_registered",
      checks: { endpoint: "missing", credentials: "not_checked" },
    });

    const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: wabaId,
        phoneNumberId,
        occurredAt: timestamp,
      },
      fingerprintSecret,
    );
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toMatchObject({
      state: "credentials_missing",
      checks: { endpoint: "active", credentials: "missing" },
    });

    await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      status: "disabled",
      occurredAt: timestamp,
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toMatchObject({
      state: "disabled",
      checks: { endpoint: "disabled", credentials: "not_checked" },
    });

    await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      status: "active",
      occurredAt: later,
    });
    await rotateMetaWhatsAppEndpointSecret(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        endpointId: endpoint.endpointId,
        rotationKey: "meta-readiness-endpoint-v1",
        secret: {
          wabaId,
          accessToken: "meta-readiness-test-token-never-real",
          phoneNumberId,
          graphApiVersion: "v23.0",
          appSecret: "meta-readiness-app-secret-never-real",
          webhookVerifyToken: "meta-readiness-webhook-token-never-real",
        },
        occurredAt: later,
      },
      createChannelProviderSecretKeyring({
        activeKeyVersion: "test-v1",
        keys: { "test-v1": Buffer.alloc(32, 41) },
      }),
    );
    const ready = await inspectMetaWhatsAppTenantReadiness(
      setup.db,
      setup.ownerA.id,
      setup.tenantA.id,
    );
    expect(ready).toEqual({
      provider: "whatsapp_meta",
      state: "ready",
      checks: { endpoint: "active", credentials: "active" },
    });
    expect(JSON.stringify(ready)).not.toMatch(
      /token|secret|waba|phone|endpointId|externalAccountId/i,
    );

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerB.id,
        setup.tenantB.id,
      ),
    ).resolves.toMatchObject({ state: "not_registered" });

    await revokeMetaWhatsAppEndpointSecret(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: endpoint.endpointId,
      occurredAt: later,
    });
    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantA.id,
      ),
    ).resolves.toMatchObject({ state: "credentials_missing" });
  });

  it("refuse un acteur qui n’est pas membre de l’organisation", async () => {
    const setup = await createSetup();

    await expect(
      inspectMetaWhatsAppTenantReadiness(
        setup.db,
        setup.ownerA.id,
        setup.tenantB.id,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_endpoint_access_denied",
    } satisfies Partial<ChannelProviderEndpointError>);
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Responsable préparation Meta A",
    email: `meta-readiness-a-${opened.length}@example.test`,
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Responsable préparation Meta B",
    email: `meta-readiness-b-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation préparation Meta A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation préparation Meta B",
    category: "Services",
  });
  return { db, ownerA, ownerB, tenantA, tenantB };
}
