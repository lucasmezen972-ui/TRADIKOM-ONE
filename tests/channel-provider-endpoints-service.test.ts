import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  ChannelProviderEndpointError,
  registerAuthorizedWhatsAppEndpoint,
  resolveActiveWhatsAppEndpoint,
  setAuthorizedWhatsAppEndpointStatus,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const accountSid = `AC${"a".repeat(32)}`;
const destinationAddress = "whatsapp:+596696000000";
const timestamp = "2026-07-30T17:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("service des endpoints fournisseur tenant-aware", () => {
  it("réserve, rejoue et résout un endpoint sans stocker l'adresse", async () => {
    const setup = await createSetup();
    const input = {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      externalAccountId: accountSid,
      destinationAddress,
      occurredAt: timestamp,
    };

    const first = await registerAuthorizedWhatsAppEndpoint(
      setup.db,
      input,
      fingerprintSecret,
    );
    const replay = await registerAuthorizedWhatsAppEndpoint(
      setup.db,
      input,
      fingerprintSecret,
    );
    const resolved = await resolveActiveWhatsAppEndpoint(
      setup.db,
      { externalAccountId: accountSid, destinationAddress },
      fingerprintSecret,
    );

    expect(first).toMatchObject({ status: "active", replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(resolved).toEqual({
      endpointId: first.endpointId,
      tenantId: setup.tenantA.id,
    });

    const rows = await setup.db.query<{
      destination_fingerprint: string;
    }>("select destination_fingerprint from channel_provider_endpoints");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.destination_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows.rows)).not.toContain(destinationAddress);

    const audits = await setup.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1 and target_type = 'channel_provider_endpoint'`,
      [setup.tenantA.id],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.action).toBe("channel.provider_endpoint_registered");
    expect(audits.rows[0]?.safe_metadata).not.toContain(destinationAddress);
    expect(audits.rows[0]?.safe_metadata).not.toContain(accountSid);
  });

  it("refuse la même destination pour un autre tenant", async () => {
    const setup = await createSetup();
    await registerAuthorizedWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: accountSid,
        destinationAddress,
      },
      fingerprintSecret,
    );

    await expect(
      registerAuthorizedWhatsAppEndpoint(
        setup.db,
        {
          tenantId: setup.tenantB.id,
          actorId: setup.ownerB.id,
          externalAccountId: accountSid,
          destinationAddress,
        },
        fingerprintSecret,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_endpoint_conflict",
    } satisfies Partial<ChannelProviderEndpointError>);
  });

  it("exige un propriétaire ou administrateur du même tenant", async () => {
    const setup = await createSetup();
    const outsider = await setup.services.registerUser({
      name: "Personne externe",
      email: "endpoint-outsider@example.test",
      password: "Password!1",
    });

    await expect(
      registerAuthorizedWhatsAppEndpoint(
        setup.db,
        {
          tenantId: setup.tenantA.id,
          actorId: outsider.id,
          externalAccountId: accountSid,
          destinationAddress,
        },
        fingerprintSecret,
      ),
    ).rejects.toMatchObject({
      code: "channel_provider_endpoint_access_denied",
    } satisfies Partial<ChannelProviderEndpointError>);
  });

  it("désactive de façon auditée et empêche ensuite la résolution", async () => {
    const setup = await createSetup();
    const registered = await registerAuthorizedWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenantA.id,
        actorId: setup.ownerA.id,
        externalAccountId: accountSid,
        destinationAddress,
      },
      fingerprintSecret,
    );
    const disabled = await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: registered.endpointId,
      status: "disabled",
      occurredAt: timestamp,
    });
    const replay = await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenantA.id,
      actorId: setup.ownerA.id,
      endpointId: registered.endpointId,
      status: "disabled",
      occurredAt: timestamp,
    });

    expect(disabled).toMatchObject({ status: "disabled", replayed: false });
    expect(replay).toMatchObject({ status: "disabled", replayed: true });
    await expect(
      resolveActiveWhatsAppEndpoint(
        setup.db,
        { externalAccountId: accountSid, destinationAddress },
        fingerprintSecret,
      ),
    ).resolves.toBeNull();

    const audits = await setup.db.query<{ action: string }>(
      `select action from audit_logs
       where tenant_id = $1 and target_id = $2
       order by created_at, action`,
      [setup.tenantA.id, registered.endpointId],
    );
    expect(audits.rows.map((row) => row.action).sort()).toEqual([
      "channel.provider_endpoint_registered",
      "channel.provider_endpoint_status_changed",
    ]);
  });
});

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const ownerA = await services.registerUser({
    name: "Propriétaire endpoint A",
    email: "endpoint-owner-a@example.test",
    password: "Password!1",
  });
  const ownerB = await services.registerUser({
    name: "Propriétaire endpoint B",
    email: "endpoint-owner-b@example.test",
    password: "Password!1",
  });
  const tenantA = await services.createTenant(ownerA.id, {
    name: "Organisation endpoint A",
    category: "Services",
  });
  const tenantB = await services.createTenant(ownerB.id, {
    name: "Organisation endpoint B",
    category: "Services",
  });
  return { db, services, ownerA, ownerB, tenantA, tenantB };
}
