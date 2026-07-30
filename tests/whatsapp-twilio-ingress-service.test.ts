import { getExpectedTwilioSignature } from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  receivePreparedWhatsAppWebhook,
  registerAuthorizedWhatsAppEndpoint,
  setAuthorizedWhatsAppEndpointStatus,
} from "../src/modules/channels";
import { getConversationThread } from "../src/modules/conversation-hub";

const opened: Array<{ close: () => Promise<void> }> = [];
const authToken = "twilio_test_auth_token";
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const url = "https://app.example.test/api/webhooks/twilio/whatsapp";
const accountSid = `AC${"a".repeat(32)}`;
const messageSid = `SM${"b".repeat(32)}`;
const destinationAddress = "whatsapp:+596696000000";
const senderAddress = "whatsapp:+15005550006";
const receivedAt = "2026-07-30T16:40:00.000Z";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("ingestion WhatsApp/Twilio préparée", () => {
  it("résout le tenant, ingère et rejoue MessageSid sans PII d'identité", async () => {
    const setup = await createSetup();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const webhook = signedWebhook(baseParameters());

    const first = await receivePreparedWhatsAppWebhook(setup.db, webhook, {
      authToken,
      fingerprintSecret,
      receivedAt,
    });
    const replay = await receivePreparedWhatsAppWebhook(setup.db, webhook, {
      authToken,
      fingerprintSecret,
      receivedAt,
    });

    expect(first).toMatchObject({
      accepted: true,
      replayed: false,
      tenantId: setup.tenant.id,
    });
    expect(replay).toMatchObject({
      accepted: true,
      replayed: true,
      messageId: first.accepted ? first.messageId : "",
    });
    expect(networkCall).not.toHaveBeenCalled();

    if (!first.accepted) throw new Error("Webhook attendu comme accepté.");
    const thread = await getConversationThread(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      first.threadId,
    );
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      text: "Bonjour depuis WhatsApp",
      provenance: {
        adapterKey: "whatsapp-twilio",
        externalMessageId: messageSid,
      },
    });
    expect(thread.identities[0]).toMatchObject({
      channelKind: "messaging",
      adapterKey: "whatsapp-twilio",
      displayName: "Contact WhatsApp",
    });
    expect(JSON.stringify(thread.identities)).not.toContain(senderAddress);
    expect(JSON.stringify(thread.identities)).not.toContain(destinationAddress);

    const audits = await setup.db.query<{
      actor_id: string;
      safe_metadata: string;
    }>(
      `select actor_id, safe_metadata from audit_logs
       where tenant_id = $1 and action like 'conversation.message_%'`,
      [setup.tenant.id],
    );
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.every((row) => row.actor_id === "system_whatsapp_twilio")).toBe(
      true,
    );
    expect(JSON.stringify(audits.rows)).not.toContain(senderAddress);
  });

  it("refuse un mapping absent ou désactivé sans créer de conversation", async () => {
    const setup = await createSetup();
    const unassigned = await receivePreparedWhatsAppWebhook(
      setup.db,
      signedWebhook({
        ...baseParameters(),
        To: "whatsapp:+596696111111",
      }),
      { authToken, fingerprintSecret, receivedAt },
    );
    await setAuthorizedWhatsAppEndpointStatus(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      endpointId: setup.endpointId,
      status: "disabled",
    });
    const disabled = await receivePreparedWhatsAppWebhook(
      setup.db,
      signedWebhook(baseParameters()),
      { authToken, fingerprintSecret, receivedAt },
    );

    expect(unassigned).toEqual({
      accepted: false,
      code: "channel_provider_endpoint_not_found",
    });
    expect(disabled).toEqual(unassigned);
    const messages = await setup.db.query("select id from conversation_messages");
    expect(messages.rows).toEqual([]);
  });

  it("refuse une signature altérée avant tout accès base", async () => {
    const setup = await createSetup();
    const query = vi.spyOn(setup.db, "query");
    const queryCountBefore = query.mock.calls.length;
    const webhook = signedWebhook(baseParameters());
    const result = await receivePreparedWhatsAppWebhook(
      setup.db,
      { ...webhook, rawBody: `${webhook.rawBody}&Body=altéré` },
      { authToken, fingerprintSecret, receivedAt },
    );

    expect(result).toEqual({ accepted: false, code: "invalid_signature" });
    expect(query.mock.calls).toHaveLength(queryCountBefore);
  });

  it("représente un média sans URL persistée ni téléchargement", async () => {
    const setup = await createSetup();
    const mediaSid = `ME${"c".repeat(32)}`;
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const result = await receivePreparedWhatsAppWebhook(
      setup.db,
      signedWebhook({
        ...baseParameters(),
        Body: "",
        NumMedia: "1",
        MediaUrl0: mediaUrl,
        MediaContentType0: "image/jpeg",
      }),
      { authToken, fingerprintSecret, receivedAt },
    );

    expect(result).toMatchObject({ accepted: true, replayed: false });
    expect(networkCall).not.toHaveBeenCalled();
    const stored = await setup.db.query<{
      text_content: string;
    }>("select text_content from conversation_messages");
    expect(stored.rows).toEqual([
      { text_content: "1 média WhatsApp en attente d’import." },
    ]);
    const persisted = JSON.stringify(
      await Promise.all([
        setup.db.query("select * from conversation_messages"),
        setup.db.query("select * from conversation_message_attachments"),
        setup.db.query("select * from audit_logs"),
      ]),
    );
    expect(persisted).not.toContain(mediaUrl);
    expect(persisted).not.toContain(senderAddress);
    expect(persisted).not.toContain(destinationAddress);
  });
});

function baseParameters() {
  return {
    AccountSid: accountSid,
    MessageSid: messageSid,
    From: senderAddress,
    To: destinationAddress,
    Body: "Bonjour depuis WhatsApp",
    NumMedia: "0",
  };
}

function signedWebhook(parameters: Record<string, string>) {
  const rawBody = new URLSearchParams(parameters).toString();
  return {
    url,
    contentType: "application/x-www-form-urlencoded",
    rawBody,
    signature: getExpectedTwilioSignature(authToken, url, parameters),
  };
}

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire WhatsApp",
    email: `owner-whatsapp-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation WhatsApp ${opened.length}`,
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
  return { db, services, owner, tenant, endpointId: endpoint.endpointId };
}
