import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  ChannelProviderEndpointError,
  registerAuthorizedTeamsEndpoint,
  resolveActiveTeamsEndpoint,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const clientId = "11111111-1111-4111-8111-111111111111";
const microsoftTenantId = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("endpoints Microsoft Teams tenant-aware", () => {
  it("réserve, rejoue et résout sans stocker le tenant Microsoft brut", async () => {
    const setup = await createSetup();
    const input = {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      externalAccountId: clientId,
      microsoftTenantId,
    };
    const first = await registerAuthorizedTeamsEndpoint(
      setup.db,
      input,
      fingerprintSecret,
    );
    const replay = await registerAuthorizedTeamsEndpoint(
      setup.db,
      input,
      fingerprintSecret,
    );
    const resolved = await resolveActiveTeamsEndpoint(
      setup.db,
      { externalAccountId: clientId, microsoftTenantId },
      fingerprintSecret,
    );

    expect(first).toMatchObject({ status: "active", replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(resolved).toEqual({
      endpointId: first.endpointId,
      tenantId: setup.tenantA.id,
    });
    const persisted = JSON.stringify(
      await setup.db.query("select * from channel_provider_endpoints"),
    );
    expect(persisted).not.toContain(microsoftTenantId);
    expect(persisted).toContain(clientId);
  });

  it("interdit la réattribution du même tenant Microsoft", async () => {
    const setup = await createSetup();
    await registerAuthorizedTeamsEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: clientId,
        microsoftTenantId,
      },
      fingerprintSecret,
    );

    await expect(
      registerAuthorizedTeamsEndpoint(
        setup.db,
        {
          tenantId: setup.tenantB.id,
          actorId: setup.ownerB.id,
          externalAccountId: clientId,
          microsoftTenantId,
        },
        fingerprintSecret,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_endpoint_conflict",
    } satisfies Partial<ChannelProviderEndpointError>);
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Propriétaire Teams A",
    email: `teams-owner-a-${opened.length}@example.test`,
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Propriétaire Teams B",
    email: `teams-owner-b-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation Teams A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation Teams B",
    category: "Services",
  });
  return { db, services, ownerA, ownerB, tenantA, tenantB };
}

