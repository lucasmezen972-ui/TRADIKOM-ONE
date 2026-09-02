import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  receivePreparedMetaWhatsAppWebhook,
  registerAuthorizedMetaWhatsAppEndpoint,
  setAuthorizedMetaWhatsAppEndpointStatus,
} from "../src/modules/channels";
import { getConversationThread } from "../src/modules/conversation-hub";

const opened: Array<{ close: () => Promise<void> }> = [];
const appSecret = "meta_app_secret_for_ingress_tests_123456";
const fingerprintSecret = "meta-fingerprint-secret-32-bytes-minimum";
const wabaId = "123456789";
const phoneNumberId = "987654321";
const wabaIdB = "222333444";
const phoneNumberIdB = "555666777";
const sender = "596696000000";
const messageId = "wamid.HBgMNTk2Njk2MDAwMDA";
const secondMessageId = "wamid.HBgMNTk2Njk2MDAwMDBfMg";
const thirdMessageId = "wamid.HBgMNTk2Njk2MDAwMDBfMw";
const receivedAt = "2026-07-30T16:20:00.000Z";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("ingestion WhatsApp Cloud Meta", () => {
  it("résout le tenant et rejoue sans dupliquer ni conserver les adresses", async () => {
    const setup = await createSetup();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const first = await receivePreparedMetaWhatsAppWebhook(setup.db, webhook(), {
      appSecret,
      fingerprintSecret,
      receivedAt,
    });
    const replay = await receivePreparedMetaWhatsAppWebhook(setup.db, webhook(), {
      appSecret,
      fingerprintSecret,
      receivedAt,
    });
    const second = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      webhook({
        messageId: secondMessageId,
        text: "Deuxième message depuis Meta",
      }),
      {
        appSecret,
        fingerprintSecret,
        receivedAt: "2026-07-30T16:21:00.000Z",
      },
    );

    expect(first).toMatchObject({
      accepted: true,
      replayed: false,
      tenantId: setup.tenant.id,
    });
    expect(replay).toMatchObject({
      accepted: true,
      replayed: true,
      messageId: first.accepted ? first.messageId : "",
      threadId: first.accepted ? first.threadId : "",
    });
    expect(second).toMatchObject({
      accepted: true,
      replayed: false,
      threadId: first.accepted ? first.threadId : "",
    });
    expect(networkCall).not.toHaveBeenCalled();
    if (!first.accepted) throw new Error("Webhook Meta attendu comme accepté.");
    const thread = await getConversationThread(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      first.threadId,
    );
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages.map((message) => message.text)).toEqual([
      "Bonjour depuis Meta",
      "Deuxième message depuis Meta",
    ]);
    expect(thread.messages[0]).toMatchObject({
      provenance: {
        adapterKey: "whatsapp-meta",
        externalMessageId: messageId,
      },
    });
    expect(thread.messages[1]).toMatchObject({
      provenance: {
        adapterKey: "whatsapp-meta",
        externalMessageId: secondMessageId,
      },
    });
    expect(thread.identities[0]).toMatchObject({
      channelKind: "messaging",
      adapterKey: "whatsapp-meta",
      displayName: "Contact WhatsApp",
    });
    const persisted = JSON.stringify(
      await Promise.all([
        setup.db.query("select * from conversation_channel_identities"),
        setup.db.query("select * from audit_logs"),
        setup.db.query("select * from channel_provider_endpoints"),
        setup.db.query("select * from channel_provider_identity_bindings"),
      ]),
    );
    expect(persisted).not.toContain(sender);
    expect(persisted).not.toContain(phoneNumberId);
    expect(persisted).not.toContain("whatsapp:+");
    const audits = await setup.db.query<{
      action: string;
      actor_id: string;
      safe_metadata: string;
    }>(
      `select action, actor_id, safe_metadata from audit_logs
       where tenant_id = $1 and action like 'conversation.message_%'`,
      [setup.tenant.id],
    );
    expect(audits.rows).toHaveLength(3);
    expect(audits.rows.every((audit) => audit.actor_id === "system_whatsapp_meta")).toBe(
      true,
    );
    expect(JSON.stringify(audits.rows)).not.toContain(sender);
    expect(JSON.stringify(audits.rows)).not.toContain(phoneNumberId);
    const bindings = await setup.db.query<{
      endpoint_id: string;
      channel_identity_id: string;
    }>(
      `select endpoint_id, channel_identity_id
       from channel_provider_identity_bindings
       where tenant_id = $1`,
      [setup.tenant.id],
    );
    expect(bindings.rows).toEqual([
      expect.objectContaining({ endpoint_id: setup.endpointId }),
    ]);
  }, 20_000);

  it("ingère et rejoue chaque message d'un lot signé dans l'ordre", async () => {
    const setup = await createSetup();
    const batch = payload();
    batch.entry[0].changes[0].value.messages.push(
      {
        ...batch.entry[0].changes[0].value.messages[0],
        id: secondMessageId,
        text: { body: "Deuxième message du lot" },
      },
      {
        ...batch.entry[0].changes[0].value.messages[0],
        id: thirdMessageId,
        text: { body: "Troisième message du lot" },
      },
    );
    const input = signedPayload(batch);

    await expect(
      receivePreparedMetaWhatsAppWebhook(setup.db, input, {
        appSecret,
        fingerprintSecret,
        receivedAt,
      }),
    ).resolves.toMatchObject({
      accepted: true,
      processed: 3,
      replayed: false,
      replayedCount: 0,
    });
    const replay = await receivePreparedMetaWhatsAppWebhook(setup.db, input, {
      appSecret,
      fingerprintSecret,
      receivedAt,
    });
    expect(replay).toMatchObject({
      accepted: true,
      processed: 3,
      replayed: true,
      replayedCount: 3,
    });
    if (!replay.accepted) throw new Error("Le rejeu du lot doit être accepté.");
    const thread = await getConversationThread(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      replay.messages[0].threadId,
    );
    expect(thread.messages.map((message) => message.text)).toEqual([
      "Bonjour depuis Meta",
      "Deuxième message du lot",
      "Troisième message du lot",
    ]);
    expect((await setup.db.query("select id from conversation_messages")).rows).toHaveLength(3);
    expect(
      (await setup.db.query("select id from channel_provider_identity_bindings")).rows,
    ).toHaveLength(1);
  }, 20_000);

  it("représente un média signé sans téléchargement ni fausse pièce jointe", async () => {
    const setup = await createSetup();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const mediaId = "2754859441498128";
    const checksum = "b".repeat(64);
    const fileName = "preuve-confidentielle.pdf";
    const mediaMessageId = "wamid.meta_document_inbound";
    const value = payload();
    const messages = value.entry[0].changes[0].value.messages as unknown as Array<
      Record<string, unknown>
    >;
    messages[0] = {
      id: mediaMessageId,
      from: sender,
      timestamp: "1760000000",
      type: "document",
      document: {
        id: mediaId,
        mime_type: "application/pdf",
        sha256: checksum,
        filename: fileName,
        caption: "Document demandé",
      },
    };

    const first = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      signedPayload(value),
      { appSecret, fingerprintSecret, receivedAt },
    );
    const replay = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      signedPayload(value),
      { appSecret, fingerprintSecret, receivedAt },
    );

    expect(first).toMatchObject({ accepted: true, replayed: false });
    expect(replay).toMatchObject({ accepted: true, replayed: true });
    expect(networkCall).not.toHaveBeenCalled();
    expect(
      (await setup.db.query("select text_content from conversation_messages")).rows,
    ).toEqual([
      {
        text_content:
          "Document demandé\n\nDocument WhatsApp en attente d’import sécurisé.",
      },
    ]);
    expect(
      (await setup.db.query("select id from conversation_message_attachments")).rows,
    ).toEqual([]);
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

  it("prévalide tout le lot et n'écrit rien si un endpoint ultérieur est inconnu", async () => {
    const setup = await createSetup();
    const batch = payload();
    const unknownEntry = structuredClone(batch.entry[0]);
    unknownEntry.id = wabaIdB;
    unknownEntry.changes[0].value.metadata.phone_number_id = phoneNumberIdB;
    unknownEntry.changes[0].value.messages[0].id = secondMessageId;
    batch.entry.push(unknownEntry);

    await expect(
      receivePreparedMetaWhatsAppWebhook(setup.db, signedPayload(batch), {
        appSecret,
        fingerprintSecret,
        receivedAt,
      }),
    ).resolves.toEqual({
      accepted: false,
      code: "channel_provider_endpoint_not_found",
    });
    expect((await setup.db.query("select id from conversation_messages")).rows).toEqual([]);
    expect(
      (await setup.db.query("select id from channel_provider_identity_bindings")).rows,
    ).toEqual([]);
    expect(
      (
        await setup.db.query(
          "select id from audit_logs where action like 'conversation.message_%'",
        )
      ).rows,
    ).toEqual([]);
  }, 20_000);

  it("isole deux tenants même lorsqu'ils partagent la même enveloppe Meta", async () => {
    const setup = await createSetup();
    const ownerB = await setup.services.registerUser({
      name: "Propriétaire Meta lot B",
      email: "owner-meta-batch-b@example.test",
      password: "Password!1",
    });
    const tenantB = await setup.services.createTenant(ownerB.id, {
      name: "Organisation Meta lot B",
      category: "Services",
    });
    await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: tenantB.id,
        actorId: ownerB.id,
        externalAccountId: wabaIdB,
        phoneNumberId: phoneNumberIdB,
      },
      fingerprintSecret,
    );
    const batch = payload();
    const tenantBEntry = structuredClone(batch.entry[0]);
    tenantBEntry.id = wabaIdB;
    tenantBEntry.changes[0].value.metadata.phone_number_id = phoneNumberIdB;
    tenantBEntry.changes[0].value.messages[0].id = secondMessageId;
    tenantBEntry.changes[0].value.messages[0].text.body = "Message tenant B";
    batch.entry.push(tenantBEntry);

    const result = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      signedPayload(batch),
      { appSecret, fingerprintSecret, receivedAt },
    );
    expect(result).toMatchObject({
      accepted: true,
      processed: 2,
      replayedCount: 0,
    });
    if (!result.accepted) throw new Error("Le lot multi-tenant doit être accepté.");
    expect(result.messages.map((message) => message.tenantId)).toEqual([
      setup.tenant.id,
      tenantB.id,
    ]);
    await expect(
      getConversationThread(
        setup.db,
        ownerB.id,
        tenantB.id,
        result.messages[0].threadId,
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });
    expect(
      await getConversationThread(
        setup.db,
        ownerB.id,
        tenantB.id,
        result.messages[1].threadId,
      ),
    ).toMatchObject({
      messages: [expect.objectContaining({ text: "Message tenant B" })],
    });
  }, 20_000);

  it("ingère l'enveloppe officielle complète sans diffuser ses données fournisseur", async () => {
    const officialPhoneNumberId = "7000000000000001";
    const officialDisplayPhoneNumber = "15550001111";
    const officialSender = "15550002222";
    const officialContactName = "Contact Exemple";
    const officialTimestamp = "1760000000";
    const officialMessageId =
      "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfZXhhbXBsZQA=";
    const setup = await createSetup({ phoneNumberId: officialPhoneNumberId });
    const signedWebhook = webhook({
      contactName: officialContactName,
      displayPhoneNumber: officialDisplayPhoneNumber,
      messageId: officialMessageId,
      officialEnvelope: true,
      phoneNumberId: officialPhoneNumberId,
      sender: officialSender,
      timestamp: officialTimestamp,
    });

    const first = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      signedWebhook,
      { appSecret, fingerprintSecret, receivedAt },
    );
    const replay = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      signedWebhook,
      { appSecret, fingerprintSecret, receivedAt },
    );

    expect(first).toMatchObject({
      accepted: true,
      replayed: false,
      tenantId: setup.tenant.id,
    });
    expect(replay).toMatchObject({
      accepted: true,
      replayed: true,
      messageId: first.accepted ? first.messageId : "",
      threadId: first.accepted ? first.threadId : "",
    });
    if (!first.accepted) throw new Error("Webhook Meta officiel attendu comme accepté.");
    const thread = await getConversationThread(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      first.threadId,
    );
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      text: "Bonjour depuis Meta",
      provenance: {
        adapterKey: "whatsapp-meta",
        externalMessageId: officialMessageId,
      },
    });

    const safePersistence = JSON.stringify(
      await Promise.all([
        setup.db.query("select * from audit_logs"),
        setup.db.query("select * from conversation_channel_identities"),
        setup.db.query("select * from channel_provider_identity_bindings"),
      ]),
    );
    for (const providerValue of [
      officialContactName,
      officialDisplayPhoneNumber,
      officialSender,
      officialPhoneNumberId,
      officialTimestamp,
      officialMessageId,
    ]) {
      expect(safePersistence).not.toContain(providerValue);
    }
  }, 20_000);

  it("refuse un endpoint absent ou désactivé sans conversation", async () => {
    const setup = await createSetup();
    const absent = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      webhook({ phoneNumberId: "111222333" }),
      { appSecret, fingerprintSecret, receivedAt },
    );
    await setAuthorizedMetaWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      endpointId: setup.endpointId,
      status: "disabled",
    });
    const disabled = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      webhook(),
      { appSecret, fingerprintSecret, receivedAt },
    );
    expect(absent).toEqual({
      accepted: false,
      code: "channel_provider_endpoint_not_found",
    });
    expect(disabled).toEqual(absent);
    expect((await setup.db.query("select id from conversation_messages")).rows).toEqual([]);
  }, 20_000);

  it("refuse une signature altérée avant toute base", async () => {
    const setup = await createSetup();
    const query = vi.spyOn(setup.db, "query");
    const count = query.mock.calls.length;
    const signed = webhook();
    const result = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      { ...signed, rawBody: `${signed.rawBody} ` },
      { appSecret, fingerprintSecret, receivedAt },
    );
    expect(result).toEqual({ accepted: false, code: "invalid_signature" });
    expect(query.mock.calls).toHaveLength(count);
  }, 20_000);

  it("isole les identités et fils lorsque le même contact écrit à deux tenants", async () => {
    const setup = await createSetup();
    const ownerB = await setup.services.registerUser({
      name: "Propriétaire Meta B",
      email: "owner-meta-b@example.test",
      password: "Password!1",
    });
    const tenantB = await setup.services.createTenant(ownerB.id, {
      name: "Organisation Meta B",
      category: "Services",
    });
    await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: tenantB.id,
        actorId: ownerB.id,
        externalAccountId: wabaIdB,
        phoneNumberId: phoneNumberIdB,
      },
      fingerprintSecret,
    );

    const first = await receivePreparedMetaWhatsAppWebhook(setup.db, webhook(), {
      appSecret,
      fingerprintSecret,
      receivedAt,
    });
    const second = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      webhook({
        wabaId: wabaIdB,
        phoneNumberId: phoneNumberIdB,
        messageId: thirdMessageId,
      }),
      {
        appSecret,
        fingerprintSecret,
        receivedAt: "2026-07-30T16:21:00.000Z",
      },
    );
    const mixedEndpoint = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      webhook({ phoneNumberId: phoneNumberIdB, messageId: secondMessageId }),
      { appSecret, fingerprintSecret, receivedAt },
    );

    expect(first).toMatchObject({ accepted: true, tenantId: setup.tenant.id });
    expect(second).toMatchObject({ accepted: true, tenantId: tenantB.id });
    if (!first.accepted || !second.accepted) {
      throw new Error("Les deux endpoints Meta doivent être résolus.");
    }
    expect(first.threadId).not.toBe(second.threadId);
    expect(mixedEndpoint).toEqual({
      accepted: false,
      code: "channel_provider_endpoint_not_found",
    });
    await expect(
      getConversationThread(setup.db, ownerB.id, tenantB.id, first.threadId),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });

    const identities = await setup.db.query<{
      tenant_id: string;
      external_subject_id: string;
    }>(
      `select tenant_id, external_subject_id
       from conversation_channel_identities
       where tenant_id in ($1, $2)
       order by tenant_id`,
      [setup.tenant.id, tenantB.id],
    );
    expect(identities.rows).toHaveLength(2);
    expect(identities.rows[0]?.external_subject_id).not.toBe(
      identities.rows[1]?.external_subject_id,
    );
    expect(JSON.stringify(identities.rows)).not.toContain(sender);
  }, 20_000);

  it("sépare le même contact entre deux endpoints du même tenant", async () => {
    const setup = await createSetup();
    const secondEndpoint = await registerAuthorizedMetaWhatsAppEndpoint(
      setup.db,
      {
        tenantId: setup.tenant.id,
        actorId: setup.owner.id,
        externalAccountId: wabaIdB,
        phoneNumberId: phoneNumberIdB,
      },
      fingerprintSecret,
    );

    const first = await receivePreparedMetaWhatsAppWebhook(setup.db, webhook(), {
      appSecret,
      fingerprintSecret,
      receivedAt,
    });
    const second = await receivePreparedMetaWhatsAppWebhook(
      setup.db,
      webhook({
        wabaId: wabaIdB,
        phoneNumberId: phoneNumberIdB,
        messageId: thirdMessageId,
      }),
      {
        appSecret,
        fingerprintSecret,
        receivedAt: "2026-07-30T16:21:00.000Z",
      },
    );

    if (!first.accepted || !second.accepted) {
      throw new Error("Les deux endpoints Meta doivent être résolus.");
    }
    expect(first.threadId).not.toBe(second.threadId);
    const bindings = await setup.db.query<{
      endpoint_id: string;
      channel_identity_id: string;
    }>(
      `select endpoint_id, channel_identity_id
       from channel_provider_identity_bindings
       where tenant_id = $1
       order by endpoint_id`,
      [setup.tenant.id],
    );
    expect(bindings.rows).toHaveLength(2);
    expect(bindings.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpoint_id: setup.endpointId }),
        expect.objectContaining({ endpoint_id: secondEndpoint.endpointId }),
      ]),
    );
    expect(bindings.rows[0]?.channel_identity_id).not.toBe(
      bindings.rows[1]?.channel_identity_id,
    );
  }, 20_000);
});

type PayloadOverrides = {
  contactName?: string;
  displayPhoneNumber?: string;
  messageId?: string;
  officialEnvelope?: boolean;
  phoneNumberId?: string;
  sender?: string;
  text?: string;
  timestamp?: string;
  wabaId?: string;
};

function payload(overrides: PayloadOverrides = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: overrides.wabaId ?? wabaId,
        changes: [
          {
            field: "messages",
            value: {
              ...(overrides.officialEnvelope
                ? {
                    messaging_product: "whatsapp",
                    contacts: [
                      {
                        profile: {
                          name: overrides.contactName ?? "Contact Exemple",
                        },
                        wa_id: overrides.sender ?? sender,
                      },
                    ],
                  }
                : {}),
              metadata: {
                ...(overrides.officialEnvelope
                  ? {
                      display_phone_number:
                        overrides.displayPhoneNumber ?? "15550001111",
                    }
                  : {}),
                phone_number_id: overrides.phoneNumberId ?? phoneNumberId,
              },
              messages: [
                {
                  id: overrides.messageId ?? messageId,
                  from: overrides.sender ?? sender,
                  ...(overrides.officialEnvelope
                    ? { timestamp: overrides.timestamp ?? "1760000000" }
                    : {}),
                  type: "text",
                  text: { body: overrides.text ?? "Bonjour depuis Meta" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function webhook(overrides: PayloadOverrides = {}) {
  return signedPayload(payload(overrides));
}

function signedPayload(value: unknown) {
  const rawBody = JSON.stringify(value);
  return {
    rawBody,
    signature: `sha256=${createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex")}`,
  };
}

async function createSetup(options: { phoneNumberId?: string } = {}) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire Meta",
    email: `owner-meta-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation Meta ${opened.length}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedMetaWhatsAppEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: wabaId,
      phoneNumberId: options.phoneNumberId ?? phoneNumberId,
    },
    fingerprintSecret,
  );
  return { db, services, owner, tenant, endpointId: endpoint.endpointId };
}
