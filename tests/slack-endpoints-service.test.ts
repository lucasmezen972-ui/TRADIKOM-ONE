import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  ChannelProviderEndpointError,
  registerAuthorizedSlackEndpoint,
  resolveActiveSlackEndpoint,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const appId = "A123ABC456";
const workspaceId = "T123ABC456";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("endpoints Slack tenant-aware", () => {
  it("réserve, rejoue et résout sans stocker le workspace brut", async () => {
    const setup = await createSetup();
    const input = {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      externalAccountId: appId,
      workspaceId,
    };
    const first = await registerAuthorizedSlackEndpoint(
      setup.db,
      input,
      fingerprintSecret,
    );
    const replay = await registerAuthorizedSlackEndpoint(
      setup.db,
      input,
      fingerprintSecret,
    );
    const resolved = await resolveActiveSlackEndpoint(
      setup.db,
      { externalAccountId: appId, workspaceId },
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
    expect(persisted).not.toContain(workspaceId);
    expect(persisted).toContain(appId);
  });

  it("interdit la réattribution du même workspace Slack", async () => {
    const setup = await createSetup();
    await registerAuthorizedSlackEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: appId,
        workspaceId,
      },
      fingerprintSecret,
    );

    await expect(
      registerAuthorizedSlackEndpoint(
        setup.db,
        {
          tenantId: setup.tenantB.id,
          actorId: setup.ownerB.id,
          externalAccountId: appId,
          workspaceId,
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
    name: "Propriétaire Slack A",
    email: `slack-owner-a-${opened.length}@example.test`,
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Propriétaire Slack B",
    email: `slack-owner-b-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation Slack A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation Slack B",
    category: "Services",
  });
  return { db, services, ownerA, ownerB, tenantA, tenantB };
}

