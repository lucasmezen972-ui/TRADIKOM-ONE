import { getExpectedTwilioSignature } from "twilio";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { receivePreparedWhatsAppDeliveryStatus } from "../src/modules/channels";

const authToken = "twilio_status_test_auth_token";
const callbackUrl =
  "https://app.example.test/api/webhooks/twilio/whatsapp/status";
const providerMessageId = `SM${"a".repeat(32)}`;
const timestamp = "2026-08-08T08:30:00.000Z";
const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("callbacks de statut WhatsApp/Twilio", () => {
  it("déduplique un replay signé sans second événement ni second audit", async () => {
    const setup = await createSetup();
    const input = signedCallback("sent");

    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      replayed: false,
      stateUpdated: false,
      status: "accepted",
    });
    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      replayed: true,
      stateUpdated: false,
      status: "accepted",
    });

    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(1);
    expect(
      await count(
        setup.db,
        "audit_logs",
        "action = 'channel.whatsapp_delivery_status_received'",
      ),
    ).toBe(1);
  });

  it("ne régresse jamais après delivered malgré des callbacks tardifs", async () => {
    const setup = await createSetup();

    await expect(
      receive(setup.db, signedCallback("delivered")),
    ).resolves.toMatchObject({
      accepted: true,
      stateUpdated: true,
      status: "delivered",
    });
    await expect(
      receive(setup.db, signedCallback("sent")),
    ).resolves.toMatchObject({
      accepted: true,
      stateUpdated: false,
      status: "delivered",
    });
    await expect(
      receive(setup.db, signedCallback("undelivered", "63016")),
    ).resolves.toMatchObject({
      accepted: true,
      stateUpdated: false,
      status: "delivered",
    });

    expect(await deliveryState(setup.db)).toEqual({
      status: "delivered",
      safe_error_code: null,
    });
    expect(await messageState(setup.db)).toEqual({
      status: "delivered",
      safe_error_code: null,
    });
    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(3);
  });

  it("fait converger failed puis delivered sans conserver le code fournisseur", async () => {
    const setup = await createSetup();

    await expect(
      receive(setup.db, signedCallback("failed", "63016")),
    ).resolves.toMatchObject({
      accepted: true,
      stateUpdated: true,
      status: "failed",
    });
    expect(await deliveryState(setup.db)).toEqual({
      status: "failed",
      safe_error_code: "provider_delivery_failed",
    });
    expect(await messageState(setup.db)).toEqual({
      status: "failed",
      safe_error_code: "provider_delivery_failed",
    });

    await expect(
      receive(setup.db, signedCallback("read")),
    ).resolves.toMatchObject({
      accepted: true,
      stateUpdated: true,
      status: "delivered",
    });
    const stored = JSON.stringify({
      delivery: await deliveryState(setup.db),
      message: await messageState(setup.db),
      events: (
        await setup.db.query(
          "select status, safe_error_code from channel_provider_delivery_events",
        )
      ).rows,
      audits: (
        await setup.db.query(
          `select safe_metadata from audit_logs
           where action = 'channel.whatsapp_delivery_status_received'`,
        )
      ).rows,
    });
    expect(stored).not.toContain(providerMessageId);
    expect(stored).not.toContain("63016");
    expect(stored).not.toContain("whatsapp:+");
    expect(await deliveryState(setup.db)).toEqual({
      status: "delivered",
      safe_error_code: null,
    });
  });

  it("refuse signature, statut ou référence invalides avant toute mutation", async () => {
    const setup = await createSetup();
    const invalidSignature = {
      ...signedCallback("sent"),
      signature: "signature-invalide",
    };
    const unknownStatus = signedCallback("mystery");
    const missingReference = signedCallback(
      "sent",
      undefined,
      `SM${"b".repeat(32)}`,
    );

    await expect(receive(setup.db, invalidSignature)).resolves.toEqual({
      accepted: false,
      code: "invalid_signature",
    });
    await expect(receive(setup.db, unknownStatus)).resolves.toEqual({
      accepted: false,
      code: "payload_invalid",
    });
    await expect(receive(setup.db, missingReference)).resolves.toEqual({
      accepted: false,
      code: "channel_provider_delivery_not_found",
    });
    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(0);
    expect(
      await count(
        setup.db,
        "audit_logs",
        "action = 'channel.whatsapp_delivery_status_received'",
      ),
    ).toBe(0);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ('user_status', 'Statut WhatsApp', 'status@example.test', 'hash', $1)`,
    [timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ('tenant_status', 'Statut WhatsApp', 'tenant-status', 'Services', $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ('participant_status', 'tenant_status', 'customer', null, $1, $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       'identity_status', 'tenant_status', 'participant_status', 'messaging',
       'whatsapp-twilio', 'subject_status', null, 'customer', 'active', $1, $1
     )`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ('thread_status', 'tenant_status', 'open', null, $1, $1, $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       'message_status', 'tenant_status', 'thread_status', 'identity_status',
       'outbound', 'result', 'sent', 'Contenu confidentiel', 'whatsapp-twilio',
       null, 'message-status-idempotency', 'correlation-status', null, null,
       $1, $1
     )`,
    [timestamp],
  );
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id, destination_fingerprint,
       status, created_by, created_at, updated_at
     ) values (
       'endpoint_status', 'tenant_status', 'whatsapp_twilio', $1, $2, 'active',
       'user_status', $3, $3
     )`,
    [`AC${"c".repeat(32)}`, "d".repeat(64), timestamp],
  );
  await db.query(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, created_by, created_at, updated_at
     ) values (
       'delivery_status', 'tenant_status', 'whatsapp_twilio', 'endpoint_status',
       'message_status', 'identity_status', 'delivery-status-idempotency', $1,
       'accepted', $2, null, null, false, 1, 3, $3, $3, null, null,
       'user_status', $3, $3
     )`,
    ["e".repeat(64), providerMessageId, timestamp],
  );
  return { db };
}

function signedCallback(
  messageStatus: string,
  errorCode?: string,
  messageSid = providerMessageId,
) {
  const parameters: Record<string, string> = {
    AccountSid: `AC${"c".repeat(32)}`,
    MessageSid: messageSid,
    MessageStatus: messageStatus,
    From: "whatsapp:+15005550006",
    To: "whatsapp:+596696000001",
  };
  if (errorCode) parameters.ErrorCode = errorCode;
  const rawBody = new URLSearchParams(parameters).toString();
  return {
    url: callbackUrl,
    contentType: "application/x-www-form-urlencoded",
    rawBody,
    signature: getExpectedTwilioSignature(authToken, callbackUrl, parameters),
  };
}

function receive(db: TestDb, input: ReturnType<typeof signedCallback>) {
  return receivePreparedWhatsAppDeliveryStatus(db, input, { authToken });
}

async function count(db: TestDb, table: string, where = "true") {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from ${table} where ${where}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function deliveryState(db: TestDb) {
  const result = await db.query<{
    status: string;
    safe_error_code: string | null;
  }>(
    `select status, safe_error_code from channel_provider_deliveries
     where id = 'delivery_status'`,
  );
  return result.rows[0];
}

async function messageState(db: TestDb) {
  const result = await db.query<{
    status: string;
    safe_error_code: string | null;
  }>(
    `select status, safe_error_code from conversation_messages
     where id = 'message_status'`,
  );
  return result.rows[0];
}
