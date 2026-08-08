import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { hashToken, id } from "../src/lib/security";
import {
  channelAdapterManifestSchema,
  createWhatsAppTwilioOutboundAdapter,
  getPreparedChannelProvider,
  processWhatsAppOutboundDeliveryWorker,
  registerAuthorizedWhatsAppEndpoint,
  reserveWhatsAppOutboundDelivery,
  sendPreparedWhatsAppOutbound,
  WhatsAppTwilioTransportError,
  type WhatsAppOutboundPolicyEvaluator,
  type WhatsAppTwilioOutboundTransport,
} from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-worker-fingerprint-secret-32-bytes";
const accountSid = `AC${"a".repeat(32)}`;
const providerMessageSid = `SM${"b".repeat(32)}`;
const destinationAddress = "whatsapp:+596696000000";
const messageText = "Votre résultat métier durable est prêt.";
const start = new Date("2026-08-08T08:00:00.000Z");

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("worker durable WhatsApp/Twilio", () => {
  it("reprend une réservation interrompue et ne rejoue jamais le succès", async () => {
    const setup = await createSetup();
    const deliveryId = await seedReservedDelivery(setup, "worker-reserved");
    const sendMessage = vi.fn().mockResolvedValue(acceptedResult());
    const dependencies = dependenciesFor(sendMessage);

    const first = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: start },
    );
    const second = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: new Date(start.getTime() + 60_000) },
    );

    expect(first).toEqual({
      selected: 1,
      processed: 1,
      succeeded: 1,
      retried: 0,
      failed: 0,
      skipped: 0,
    });
    expect(second.selected).toBe(0);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "worker-reserved",
        text: messageText,
      }),
    );
    const delivery = await readDelivery(setup.db, deliveryId);
    expect(delivery).toMatchObject({
      status: "accepted",
      attempts: 1,
      max_attempts: 3,
      lease_id: null,
      lease_expires_at: null,
    });
  });

  it("exclut une lease concurrente puis récupère une lease expirée", async () => {
    const setup = await createSetup();
    await seedReservedDelivery(setup, "worker-lease");
    let releaseTransport!: () => void;
    let transportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      transportStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseTransport = resolve;
    });
    const sendMessage = vi.fn().mockImplementation(async () => {
      transportStarted();
      await gate;
      return acceptedResult();
    });
    const dependencies = dependenciesFor(sendMessage);

    const running = processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: start, leaseMs: 5_000 },
    );
    await started;
    const concurrent = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: start, leaseMs: 5_000 },
    );
    expect(concurrent.selected).toBe(0);
    expect(sendMessage).toHaveBeenCalledOnce();
    releaseTransport();
    await running;

    const secondSetup = await createSetup();
    const expiredId = await seedReservedDelivery(secondSetup, "worker-expired");
    await secondSetup.db.query(
      `update channel_provider_deliveries
       set attempts = 1, last_attempted_at = $1, lease_id = 'expired-lease',
           lease_expires_at = $2, updated_at = $1
       where tenant_id = $3 and id = $4`,
      [
        start.toISOString(),
        new Date(start.getTime() + 1_000).toISOString(),
        secondSetup.tenant.id,
        expiredId,
      ],
    );
    const expiredSend = vi.fn().mockResolvedValue(acceptedResult());
    const beforeExpiry = await processWhatsAppOutboundDeliveryWorker(
      secondSetup.db,
      secondSetup.owner.id,
      secondSetup.tenant.id,
      dependenciesFor(expiredSend),
      { now: new Date(start.getTime() + 999) },
    );
    const afterExpiry = await processWhatsAppOutboundDeliveryWorker(
      secondSetup.db,
      secondSetup.owner.id,
      secondSetup.tenant.id,
      dependenciesFor(expiredSend),
      { now: new Date(start.getTime() + 1_000) },
    );
    expect(beforeExpiry.selected).toBe(0);
    expect(afterExpiry.succeeded).toBe(1);
    expect((await readDelivery(secondSetup.db, expiredId)).attempts).toBe(2);
  });

  it.each(["temporary", "rate_limit"] as const)(
    "reprend %s au backoff avec la même idempotence et un seul effet",
    async (classification) => {
      const setup = await createSetup();
      const effects = new Set<string>();
      let effectCount = 0;
      const sendMessage = vi.fn().mockImplementation(async (request) => {
        if (!effects.has(request.idempotencyKey)) {
          effects.add(request.idempotencyKey);
          effectCount += 1;
          throw new WhatsAppTwilioTransportError(classification);
        }
        return acceptedResult();
      });
      const evaluatePolicy = vi.fn().mockReturnValue({ allowed: true });
      const dependencies = dependenciesFor(sendMessage, evaluatePolicy);
      const key = `worker-${classification}-resume`;

      const initial = await sendPreparedWhatsAppOutbound(
        setup.db,
        setup.owner.id,
        deliveryInput(setup, key),
        dependencies,
        { now: start, baseBackoffMs: 1_000 },
      );
      const tooSoon = await processWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(start.getTime() + 999), baseBackoffMs: 1_000 },
      );
      const resumed = await processWhatsAppOutboundDeliveryWorker(
        setup.db,
        setup.owner.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(start.getTime() + 1_000), baseBackoffMs: 1_000 },
      );

      expect(initial).toMatchObject({
        status: "failed",
        classification,
        retryable: true,
        attempts: 1,
      });
      expect(tooSoon.selected).toBe(0);
      expect(resumed.succeeded).toBe(1);
      expect(effectCount).toBe(1);
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(
        sendMessage.mock.calls.map(([request]) => request.idempotencyKey),
      ).toEqual([key, key]);
      expect(evaluatePolicy).toHaveBeenCalledTimes(2);
      expect(await readMessageStatus(setup)).toEqual({
        status: "sent",
        safe_error_code: null,
      });
      await expectSafeAudits(setup);
    },
  );

  it("arrête les retries au maximum et laisse le message en échec terminal", async () => {
    const setup = await createSetup();
    const sendMessage = vi.fn().mockRejectedValue(
      new WhatsAppTwilioTransportError("temporary"),
    );
    const dependencies = dependenciesFor(sendMessage);
    const initial = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "worker-max-attempts"),
      dependencies,
      { now: start, maxAttempts: 2, baseBackoffMs: 1_000 },
    );
    const terminal = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: new Date(start.getTime() + 1_000), baseBackoffMs: 1_000 },
    );
    const ignored = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: new Date(start.getTime() + 60_000), baseBackoffMs: 1_000 },
    );

    expect(initial.retryable).toBe(true);
    expect(terminal.failed).toBe(1);
    expect(ignored.selected).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const delivery = await readDelivery(setup.db, initial.deliveryId);
    expect(delivery).toMatchObject({
      status: "failed",
      attempts: 2,
      max_attempts: 2,
      retryable: false,
      safe_error_code: "max_attempts_exceeded",
    });
    expect(await readMessageStatus(setup)).toEqual({
      status: "failed",
      safe_error_code: "max_attempts_exceeded",
    });
  });

  it("réévalue membership et policy avant chaque reprise", async () => {
    const setup = await createSetup();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new WhatsAppTwilioTransportError("temporary"));
    const evaluatePolicy = vi
      .fn()
      .mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ allowed: false, code: "approval_revoked" });
    const dependencies = dependenciesFor(sendMessage, evaluatePolicy);
    await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "worker-policy-recheck"),
      dependencies,
      { now: start, baseBackoffMs: 1_000 },
    );
    const resumed = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: new Date(start.getTime() + 1_000), baseBackoffMs: 1_000 },
    );
    expect(resumed.failed).toBe(1);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(evaluatePolicy).toHaveBeenCalledTimes(2);

    const membershipSetup = await createSetup();
    const membershipSend = vi
      .fn()
      .mockRejectedValueOnce(new WhatsAppTwilioTransportError("temporary"));
    const membershipDependencies = dependenciesFor(membershipSend);
    await sendPreparedWhatsAppOutbound(
      membershipSetup.db,
      membershipSetup.owner.id,
      deliveryInput(membershipSetup, "worker-membership-recheck"),
      membershipDependencies,
      { now: start, baseBackoffMs: 1_000 },
    );
    await membershipSetup.db.query(
      `update memberships set role = 'read-only'
       where tenant_id = $1 and user_id = $2`,
      [membershipSetup.tenant.id, membershipSetup.owner.id],
    );
    await expect(
      processWhatsAppOutboundDeliveryWorker(
        membershipSetup.db,
        membershipSetup.owner.id,
        membershipSetup.tenant.id,
        membershipDependencies,
        { now: new Date(start.getTime() + 1_000) },
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    expect(membershipSend).toHaveBeenCalledOnce();

    const outsider = await setup.services.registerUser({
      name: "Personne externe worker",
      email: "worker-outsider@example.test",
      password: "Password!1",
    });
    await expect(
      processWhatsAppOutboundDeliveryWorker(
        setup.db,
        outsider.id,
        setup.tenant.id,
        dependencies,
        { now: new Date(start.getTime() + 1_000) },
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
  });

  it("ne sélectionne jamais un échec permanent", async () => {
    const setup = await createSetup();
    const sendMessage = vi.fn().mockRejectedValue(
      new WhatsAppTwilioTransportError("permanent"),
    );
    const dependencies = dependenciesFor(sendMessage);
    const initial = await sendPreparedWhatsAppOutbound(
      setup.db,
      setup.owner.id,
      deliveryInput(setup, "worker-permanent"),
      dependencies,
      { now: start },
    );
    const worker = await processWhatsAppOutboundDeliveryWorker(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      dependencies,
      { now: new Date(start.getTime() + 60_000) },
    );
    expect(initial).toMatchObject({
      classification: "permanent",
      retryable: false,
    });
    expect(worker.selected).toBe(0);
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const suffix = opened.length;
  const owner = await services.registerUser({
    name: "Propriétaire worker WhatsApp",
    email: `worker-owner-${suffix}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation worker WhatsApp ${suffix}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: accountSid,
      destinationAddress,
    },
    fingerprintSecret,
  );
  const threadId = `thread_whatsapp_worker_${suffix}`;
  const customerParticipantId = `participant_whatsapp_worker_customer_${suffix}`;
  const customerIdentityId = `identity_whatsapp_worker_customer_${suffix}`;
  const systemParticipantId = `participant_whatsapp_worker_system_${suffix}`;
  const systemIdentityId = `identity_whatsapp_worker_system_${suffix}`;
  const messageId = `message_whatsapp_worker_${suffix}`;
  const timestamp = start.toISOString();
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', 'Contact WhatsApp', $3, $3),
       ($4, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
    [customerParticipantId, tenant.id, timestamp, systemParticipantId],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', 'whatsapp-twilio', $4,
        'Contact WhatsApp', 'customer', 'active', $5, $5),
       ($6, $2, $7, 'web', 'web-chat', $8,
        'TRADIKOM ONE', 'system', 'active', $5, $5)`,
    [
      customerIdentityId,
      tenant.id,
      customerParticipantId,
      `whatsapp_subject_opaque_${suffix}`,
      timestamp,
      systemIdentityId,
      systemParticipantId,
      `system_subject_opaque_${suffix}`,
    ],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, tenant.id, timestamp],
  );
  await db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $3, $4), ($1, $2, $5, $4)`,
    [tenant.id, threadId, customerIdentityId, timestamp, systemIdentityId],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'outbound', 'result', 'pending', $5, 'web-chat', null,
       $6, $7, null, null, $8, $8
     )`,
    [
      messageId,
      tenant.id,
      threadId,
      systemIdentityId,
      messageText,
      `canonical:${messageId}`,
      `correlation:${messageId}`,
      timestamp,
    ],
  );
  return {
    db,
    services,
    owner,
    tenant,
    endpointId: endpoint.endpointId,
    customerIdentityId,
    messageId,
  };
}

async function seedReservedDelivery(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey: string,
) {
  const deliveryId = id("channel_delivery");
  const fingerprint = hashToken(
    JSON.stringify([
      "whatsapp_twilio",
      setup.endpointId,
      setup.messageId,
      setup.customerIdentityId,
    ]),
  );
  const reservation = await reserveWhatsAppOutboundDelivery(setup.db, {
    id: deliveryId,
    tenantId: setup.tenant.id,
    endpointId: setup.endpointId,
    messageId: setup.messageId,
    channelIdentityId: setup.customerIdentityId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    actorId: setup.owner.id,
    occurredAt: start.toISOString(),
    maxAttempts: 3,
  });
  expect(reservation.replayed).toBe(false);
  return deliveryId;
}

function deliveryInput(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey: string,
) {
  return {
    tenantId: setup.tenant.id,
    endpointId: setup.endpointId,
    messageId: setup.messageId,
    channelIdentityId: setup.customerIdentityId,
    idempotencyKey,
  };
}

function dependenciesFor(
  sendMessage: ReturnType<typeof vi.fn>,
  evaluatePolicy: WhatsAppOutboundPolicyEvaluator = () => ({ allowed: true }),
) {
  const base = getPreparedChannelProvider("whatsapp_twilio", {});
  const manifest = channelAdapterManifestSchema.parse({
    ...base,
    state: "mock",
    missingEnvironment: [],
    transportEnabled: true,
  });
  return {
    adapter: createWhatsAppTwilioOutboundAdapter({
      manifest,
      transport: {
        sendMessage:
          sendMessage as WhatsAppTwilioOutboundTransport["sendMessage"],
      },
    }),
    evaluatePolicy,
  };
}

function acceptedResult() {
  return {
    status: "accepted" as const,
    provider: "whatsapp_twilio" as const,
    externalMessageId: providerMessageSid,
    retryable: false,
  };
}

async function readDelivery(db: TestDb, deliveryId: string) {
  const result = await db.query<Record<string, unknown>>(
    "select * from channel_provider_deliveries where id = $1",
    [deliveryId],
  );
  return result.rows[0] as Record<string, unknown> & { attempts: number };
}

async function readMessageStatus(
  setup: Awaited<ReturnType<typeof createSetup>>,
) {
  const result = await setup.db.query<{
    status: string;
    safe_error_code: string | null;
  }>(
    `select status, safe_error_code from conversation_messages
     where tenant_id = $1 and id = $2`,
    [setup.tenant.id, setup.messageId],
  );
  return result.rows[0];
}

async function expectSafeAudits(
  setup: Awaited<ReturnType<typeof createSetup>>,
) {
  const audits = await setup.db.query<{ safe_metadata: string }>(
    `select safe_metadata from audit_logs
     where tenant_id = $1 and target_type = 'channel_provider_delivery'`,
    [setup.tenant.id],
  );
  const serialized = JSON.stringify(audits.rows);
  expect(serialized).not.toContain(messageText);
  expect(serialized).not.toContain(destinationAddress);
  expect(serialized).not.toContain(providerMessageSid);
  expect(serialized).not.toContain(accountSid);
}
