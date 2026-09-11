import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { receivePreparedMetaWhatsAppDeliveryStatus } from "../src/modules/channels";

const appSecret = "meta_status_test_app_secret";
const fingerprintSecret = "meta_status_fingerprint_secret_32_bytes_minimum";
const wabaId = "200000000000000001";
const phoneNumberId = "7000000000000001";
const recipientId = "15550002222";
const providerMessageId =
  "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2Vfc3RhdHVzAA==";
const timestamp = "2026-09-01T01:30:00.000Z";
const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("notifications de statut WhatsApp Cloud Meta", () => {
  it("déduplique le replay signé sans second événement ni second audit", async () => {
    const setup = await createSetup();
    const input = signedStatus("sent");

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

  it("traite et rejoue atomiquement un lot borné de plusieurs statuts", async () => {
    const setup = await createSetup();
    const input = signedStatuses(["sent", "delivered"]);

    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      processed: 2,
      replayed: false,
      replayedCount: 0,
      stateUpdated: true,
      stateUpdatedCount: 1,
    });
    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      processed: 2,
      replayed: true,
      replayedCount: 2,
      stateUpdated: false,
      stateUpdatedCount: 0,
    });

    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(2);
    expect(
      await count(
        setup.db,
        "audit_logs",
        "action = 'channel.whatsapp_delivery_status_received'",
      ),
    ).toBe(2);
    expect(await deliveryState(setup.db)).toEqual({
      status: "delivered",
      safe_error_code: null,
    });
  });

  it("annule tout le lot quand une référence ultérieure est inconnue", async () => {
    const setup = await createSetup();
    const input = signedStatuses([
      "sent",
      {
        status: "delivered",
        providerMessageId:
          "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfbWlzc2luZw==",
      },
    ]);

    await expect(receive(setup.db, input)).resolves.toEqual({
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
    expect(await deliveryState(setup.db)).toEqual({
      status: "accepted",
      safe_error_code: null,
    });
  });

  it("refuse un tableau de statuts hors borne avant toute mutation", async () => {
    const setup = await createSetup();
    const input = signedStatuses(
      Array.from({ length: 11 }, () => "sent" as const),
    );

    await expect(receive(setup.db, input)).resolves.toEqual({
      accepted: false,
      code: "whatsapp_payload_invalid",
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

  it("reste monotone quand Meta livre les statuts hors ordre", async () => {
    const setup = await createSetup();

    await expect(receive(setup.db, signedStatus("delivered"))).resolves.toMatchObject({
      accepted: true,
      stateUpdated: true,
      status: "delivered",
    });
    await expect(receive(setup.db, signedStatus("sent"))).resolves.toMatchObject({
      accepted: true,
      stateUpdated: false,
      status: "delivered",
    });
    await expect(receive(setup.db, signedStatus("failed"))).resolves.toMatchObject({
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
  });

  it("fait converger failed puis read sans stocker le payload sensible", async () => {
    const setup = await createSetup();

    await expect(receive(setup.db, signedStatus("failed"))).resolves.toMatchObject({
      accepted: true,
      stateUpdated: true,
      status: "failed",
    });
    await expect(receive(setup.db, signedStatus("read"))).resolves.toMatchObject({
      accepted: true,
      stateUpdated: true,
      status: "delivered",
    });

    const persisted = JSON.stringify({
      delivery: await deliveryState(setup.db),
      message: await messageState(setup.db),
      events: (await setup.db.query("select * from channel_provider_delivery_events")).rows,
      audits: (
        await setup.db.query(
          `select safe_metadata from audit_logs
           where action = 'channel.whatsapp_delivery_status_received'`,
        )
      ).rows,
    });
    expect(persisted).not.toContain(providerMessageId);
    expect(persisted).not.toContain(phoneNumberId);
    expect(persisted).not.toContain(recipientId);
    expect(persisted).not.toContain("1760000000");
    expect(persisted).not.toContain("Détail fournisseur privé");
  });

  it("refuse signature, endpoint et référence inconnue avant mutation", async () => {
    const setup = await createSetup();
    const invalidSignature = { ...signedStatus("sent"), signature: "sha256=invalide" };
    const wrongEndpoint = signedStatus("sent", { phoneNumberId: "8000000000000002" });
    const missingReference = signedStatus("sent", {
      providerMessageId:
        "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfbWlzc2luZw==",
    });

    await expect(receive(setup.db, invalidSignature)).resolves.toEqual({
      accepted: false,
      code: "invalid_signature",
    });
    await expect(receive(setup.db, wrongEndpoint)).resolves.toEqual({
      accepted: false,
      code: "channel_provider_endpoint_not_found",
    });
    await expect(receive(setup.db, missingReference)).resolves.toEqual({
      accepted: false,
      code: "channel_provider_delivery_not_found",
    });
    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(0);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ('user_meta_status', 'Statut Meta', 'meta-status@example.test', 'hash', $1)`,
    [timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ('tenant_meta_status', 'Statut Meta', 'tenant-meta-status', 'Services', $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ('participant_meta_status', 'tenant_meta_status', 'customer', null, $1, $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       'identity_meta_status', 'tenant_meta_status', 'participant_meta_status',
       'messaging', 'whatsapp-meta', 'meta_subject_status', null, 'customer',
       'active', $1, $1
     )`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ('thread_meta_status', 'tenant_meta_status', 'open', null, $1, $1, $1)`,
    [timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       'message_meta_status', 'tenant_meta_status', 'thread_meta_status',
       'identity_meta_status', 'outbound', 'result', 'sent',
       'Contenu confidentiel', 'whatsapp-meta', null,
       'message-meta-status-idempotency', 'correlation-meta-status', null, null,
       $1, $1
     )`,
    [timestamp],
  );
  const destinationFingerprint = createHmac("sha256", fingerprintSecret)
    .update(`v1:whatsapp_meta:${wabaId}:${phoneNumberId}`)
    .digest("hex");
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id, destination_fingerprint,
       status, created_by, created_at, updated_at
     ) values (
       'endpoint_meta_status', 'tenant_meta_status', 'whatsapp_meta', $1, $2,
       'active', 'user_meta_status', $3, $3
     )`,
    [wabaId, destinationFingerprint, timestamp],
  );
  await db.query(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, created_by, created_at, updated_at
     ) values (
       'delivery_meta_status', 'tenant_meta_status', 'whatsapp_meta',
       'endpoint_meta_status', 'message_meta_status', 'identity_meta_status',
       'delivery-meta-status-idempotency', $1, 'accepted', $2, null, null,
       false, 1, 3, $3, $3, null, null, 'user_meta_status', $3, $3
     )`,
    ["e".repeat(64), providerMessageId, timestamp],
  );
  return { db };
}

function signedStatus(
  status: "sent" | "delivered" | "read" | "failed",
  overrides: { phoneNumberId?: string; providerMessageId?: string } = {},
) {
  return signedStatuses(
    [
      {
        status,
        providerMessageId: overrides.providerMessageId,
      },
    ],
    overrides,
  );
}

type StatusInput =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | {
      status: "sent" | "delivered" | "read" | "failed";
      providerMessageId?: string;
    };

function signedStatuses(
  inputs: StatusInput[],
  overrides: { phoneNumberId?: string } = {},
) {
  const rawBody = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: overrides.phoneNumberId ?? phoneNumberId,
              },
              statuses: inputs.map((input) => {
                const item =
                  typeof input === "string" ? { status: input } : input;
                return {
                  id: item.providerMessageId ?? providerMessageId,
                  status: item.status,
                  timestamp: "1760000000",
                  recipient_id: recipientId,
                  ...(item.status === "failed"
                    ? {
                        errors: [
                          {
                            code: 131000,
                            title: "Échec fournisseur",
                            error_data: { details: "Détail fournisseur privé" },
                          },
                        ],
                      }
                    : {}),
                };
              }),
            },
            field: "messages",
          },
        ],
      },
    ],
  });
  return {
    rawBody,
    signature: `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`,
  };
}

function receive(db: TestDb, input: ReturnType<typeof signedStatus>) {
  return receivePreparedMetaWhatsAppDeliveryStatus(db, input, {
    appSecret,
    fingerprintSecret,
  });
}

async function count(db: TestDb, table: string, where = "true") {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from ${table} where ${where}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function deliveryState(db: TestDb) {
  const result = await db.query<{ status: string; safe_error_code: string | null }>(
    `select status, safe_error_code from channel_provider_deliveries
     where id = 'delivery_meta_status'`,
  );
  return result.rows[0];
}

async function messageState(db: TestDb) {
  const result = await db.query<{ status: string; safe_error_code: string | null }>(
    `select status, safe_error_code from conversation_messages
     where id = 'message_meta_status'`,
  );
  return result.rows[0];
}
