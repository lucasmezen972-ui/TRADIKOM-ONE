import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import {
  prepareVerifiedMetaWhatsAppWebhookBatch,
  receivePreparedMetaWhatsAppWebhookBatch,
} from "../src/modules/channels";

const appSecret = "meta_mixed_webhook_app_secret";
const fingerprintSecret = "meta-mixed-fingerprint-secret-32-bytes-minimum";
const wabaId = "200000000000000001";
const phoneNumberId = "7000000000000001";
const sender = "15550003333";
const providerDeliveryId =
  "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfbWl4ZWRfc3RhdHVzAA==";
const inboundMessageId =
  "wamid.HBgLMTU1NTAwMDMzMzMVAGHAYWZha2VfbWl4ZWRfaW5ib3VuZAA=";
const receivedAt = "2026-09-01T05:45:00.000Z";
const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("enveloppe webhook WhatsApp Cloud Meta unifiée", () => {
  it("normalise messages et statuts après une signature unique", () => {
    const payload = mixedPayload();
    expect(prepare(payload)).toMatchObject({
      ok: true,
      messages: [
        expect.objectContaining({ externalMessageId: inboundMessageId }),
      ],
      statuses: [
        expect.objectContaining({ providerMessageId: providerDeliveryId }),
      ],
    });
    const messagesOnly = structuredClone(payload);
    messagesOnly.entry[0].changes.splice(1, 1);
    expect(prepare(messagesOnly)).toMatchObject({
      ok: true,
      messages: [expect.any(Object)],
      statuses: [],
    });
    const statusesOnly = structuredClone(payload);
    statusesOnly.entry[0].changes.splice(0, 1);
    expect(prepare(statusesOnly)).toMatchObject({
      ok: true,
      messages: [],
      statuses: [expect.any(Object)],
    });
  });

  it("refuse un changement ambigu ou un lot global supérieur à cent", () => {
    const ambiguous = mixedPayload();
    ambiguous.entry[0].changes[0].value.statuses =
      ambiguous.entry[0].changes[1].value.statuses;
    expect(
      prepareVerifiedMetaWhatsAppWebhookBatch(
        signedPayload(ambiguous),
        appSecret,
        receivedAt,
      ),
    ).toEqual({ ok: false, code: "whatsapp_payload_invalid" });

    const oversized = mixedPayload();
    oversized.entry = Array.from({ length: 10 }, (_, entryIndex) => ({
      id: wabaId,
      changes: Array.from({ length: 10 }, (_, changeIndex) => ({
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "15550001111",
            phone_number_id: phoneNumberId,
          },
          messages: Array.from(
            { length: entryIndex === 0 && changeIndex === 0 ? 2 : 1 },
            (_, messageIndex) => ({
              id: `wamid.batch_${entryIndex}_${changeIndex}_${messageIndex}`,
              from: sender,
              timestamp: "1760000000",
              type: "text",
              text: { body: "Message borné" },
            }),
          ),
        },
        field: "messages",
      })),
    }));
    expect(
      prepareVerifiedMetaWhatsAppWebhookBatch(
        signedPayload(oversized),
        appSecret,
        receivedAt,
      ),
    ).toEqual({ ok: false, code: "whatsapp_payload_invalid" });
  });

  it("persiste puis rejoue atomiquement les deux familles sans PII d'audit", async () => {
    const setup = await createSetup();
    const input = signedPayload(mixedPayload());

    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      processed: 2,
      processedMessages: 1,
      processedStatuses: 1,
      replayed: false,
      replayedCount: 0,
      stateUpdated: true,
    });
    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      processed: 2,
      processedMessages: 1,
      processedStatuses: 1,
      replayed: true,
      replayedCount: 2,
      stateUpdated: false,
    });

    expect(await count(setup.db, "conversation_messages", "direction = 'inbound'"))
      .toBe(1);
    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(1);
    const audits = JSON.stringify(
      (await setup.db.query("select action, safe_metadata from audit_logs")).rows,
    );
    for (const sensitive of [
      sender,
      phoneNumberId,
      providerDeliveryId,
      inboundMessageId,
      "Contenu conversationnel privé",
    ]) {
      expect(audits).not.toContain(sensitive);
    }
  }, 20_000);

  it("traite texte, média et statut atomiquement sans réseau ni stockage fictif", async () => {
    const setup = await createSetup();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const mediaId = "2754859441498128";
    const checksum = "c".repeat(64);
    const fileName = "piece-confidentielle.pdf";
    const input = signedPayload(mixedMediaPayload({ mediaId, checksum, fileName }));

    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      processed: 3,
      processedMessages: 2,
      processedStatuses: 1,
      replayed: false,
      replayedCount: 0,
    });
    await expect(receive(setup.db, input)).resolves.toMatchObject({
      accepted: true,
      processed: 3,
      processedMessages: 2,
      processedStatuses: 1,
      replayed: true,
      replayedCount: 3,
    });

    expect(networkCall).not.toHaveBeenCalled();
    expect(await count(setup.db, "conversation_messages", "direction = 'inbound'"))
      .toBe(2);
    expect(await count(setup.db, "conversation_message_attachments")).toBe(0);
    const storedTexts = (
      await setup.db.query<{ text_content: string }>(
        "select text_content from conversation_messages where direction = 'inbound'",
      )
    ).rows.map((row) => row.text_content);
    expect(storedTexts).toEqual(
      expect.arrayContaining([
        "Contenu conversationnel privé",
        "Pièce demandée\n\nDocument WhatsApp en attente d’import sécurisé.",
      ]),
    );
    const persisted = JSON.stringify(
      await Promise.all([
        setup.db.query("select * from conversation_messages"),
        setup.db.query("select * from conversation_message_attachments"),
        setup.db.query("select * from audit_logs"),
      ]),
    );
    for (const ephemeral of [mediaId, checksum, fileName, "application/pdf"]) {
      expect(persisted).not.toContain(ephemeral);
    }
  }, 20_000);

  it("n'écrit aucun message si une livraison du même lot est inconnue", async () => {
    const setup = await createSetup();
    const payload = mixedPayload();
    payload.entry[0].changes[1].value.statuses![0]!.id =
      "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfbWlzc2luZw==";

    await expect(receive(setup.db, signedPayload(payload))).resolves.toEqual({
      accepted: false,
      code: "channel_provider_delivery_not_found",
    });
    expect(await count(setup.db, "conversation_messages", "direction = 'inbound'"))
      .toBe(0);
    expect(await count(setup.db, "channel_provider_delivery_events")).toBe(0);
    expect(
      await count(
        setup.db,
        "audit_logs",
        "action like 'conversation.message_%' or action = 'channel.whatsapp_delivery_status_received'",
      ),
    ).toBe(0);
  }, 20_000);

  it("refuse une signature altérée avant tout accès à la base", async () => {
    const setup = await createSetup();
    const query = vi.spyOn(setup.db, "query");
    const initialCalls = query.mock.calls.length;
    const input = signedPayload(mixedPayload());

    await expect(
      receive(setup.db, { ...input, rawBody: `${input.rawBody} ` }),
    ).resolves.toEqual({ accepted: false, code: "invalid_signature" });
    expect(query.mock.calls).toHaveLength(initialCalls);
  }, 20_000);
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ('user_meta_mixed', 'Webhook Meta mixte', 'meta-mixed@example.test', 'hash', $1)`,
    [receivedAt],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ('tenant_meta_mixed', 'Webhook Meta mixte', 'tenant-meta-mixed', 'Services', $1)`,
    [receivedAt],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ('participant_meta_mixed', 'tenant_meta_mixed', 'customer', null, $1, $1)`,
    [receivedAt],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       'identity_meta_mixed', 'tenant_meta_mixed', 'participant_meta_mixed',
       'messaging', 'whatsapp-meta', 'meta_subject_mixed', null, 'customer',
       'active', $1, $1
     )`,
    [receivedAt],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ('thread_meta_mixed', 'tenant_meta_mixed', 'open', null, $1, $1, $1)`,
    [receivedAt],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       'message_meta_mixed', 'tenant_meta_mixed', 'thread_meta_mixed',
       'identity_meta_mixed', 'outbound', 'result', 'sent',
       'Réponse privée', 'whatsapp-meta', null,
       'message-meta-mixed-idempotency', 'correlation-meta-mixed', null, null,
       $1, $1
     )`,
    [receivedAt],
  );
  const destinationFingerprint = createHmac("sha256", fingerprintSecret)
    .update(`v1:whatsapp_meta:${wabaId}:${phoneNumberId}`)
    .digest("hex");
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id, destination_fingerprint,
       status, created_by, created_at, updated_at
     ) values (
       'endpoint_meta_mixed', 'tenant_meta_mixed', 'whatsapp_meta', $1, $2,
       'active', 'user_meta_mixed', $3, $3
     )`,
    [wabaId, destinationFingerprint, receivedAt],
  );
  await db.query(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, created_by, created_at, updated_at
     ) values (
       'delivery_meta_mixed', 'tenant_meta_mixed', 'whatsapp_meta',
       'endpoint_meta_mixed', 'message_meta_mixed', 'identity_meta_mixed',
       'delivery-meta-mixed-idempotency', $1, 'accepted', $2, null, null,
       false, 1, 3, $3, $3, null, null, 'user_meta_mixed', $3, $3
     )`,
    ["f".repeat(64), providerDeliveryId, receivedAt],
  );
  return { db };
}

function mixedPayload() {
  return {
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
                phone_number_id: phoneNumberId,
              },
              messages: [
                {
                  id: inboundMessageId,
                  from: sender,
                  timestamp: "1760000000",
                  type: "text",
                  text: { body: "Contenu conversationnel privé" },
                },
              ],
            },
            field: "messages",
          },
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: phoneNumberId,
              },
              statuses: [
                {
                  id: providerDeliveryId,
                  status: "delivered",
                  timestamp: "1760000001",
                  recipient_id: "15550002222",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function mixedMediaPayload(input: {
  mediaId: string;
  checksum: string;
  fileName: string;
}) {
  const payload = mixedPayload();
  const messages = payload.entry[0].changes[0].value.messages as unknown as Array<
    Record<string, unknown>
  >;
  messages.push({
    id: "wamid.meta_mixed_document_inbound",
    from: sender,
    timestamp: "1760000000",
    type: "document",
    document: {
      id: input.mediaId,
      mime_type: "application/pdf",
      sha256: input.checksum,
      filename: input.fileName,
      caption: "Pièce demandée",
    },
  });
  return payload;
}

function signedPayload(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    signature: `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`,
  };
}

function prepare(payload: ReturnType<typeof mixedPayload>) {
  return prepareVerifiedMetaWhatsAppWebhookBatch(
    signedPayload(payload),
    appSecret,
    receivedAt,
  );
}

function receive(db: TestDb, input: ReturnType<typeof signedPayload>) {
  return receivePreparedMetaWhatsAppWebhookBatch(db, input, {
    appSecret,
    fingerprintSecret,
    receivedAt,
  });
}

async function count(db: TestDb, table: string, where = "true") {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count from ${table} where ${where}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
