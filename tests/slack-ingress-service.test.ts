import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  ingestPreparedSlackMessage,
  registerAuthorizedSlackEndpoint,
  setAuthorizedSlackEndpointStatus,
  verifyAndPrepareSlackWebhook,
} from "../src/modules/channels";
import { getConversationThread } from "../src/modules/conversation-hub";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const signingSecret = "slack-test-signing-secret-32-bytes";
const appId = "A123ABC456";
const workspaceId = "T123ABC456";
const senderSubject = "U123ABC456";
const conversationSubject = "D123ABC456";
const requestTimestamp = String(
  Math.floor(Date.parse("2026-07-30T17:30:00.000Z") / 1000),
);

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("ingestion Slack préparée", () => {
  it("résout le tenant, rejoue event_id et conserve la conversation directe", async () => {
    const setup = await createSetup();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const firstMessage = preparedMessage("Ev123ABC456", "Bonjour Slack");
    const secondMessage = preparedMessage(
      "Ev789XYZ123",
      "Deuxième message Slack",
      "1753896661.000000",
    );

    const first = await ingestPreparedSlackMessage(
      setup.db,
      firstMessage,
      fingerprintSecret,
    );
    const replay = await ingestPreparedSlackMessage(
      setup.db,
      firstMessage,
      fingerprintSecret,
    );
    const second = await ingestPreparedSlackMessage(
      setup.db,
      secondMessage,
      fingerprintSecret,
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
    });
    expect(second).toMatchObject({
      accepted: true,
      replayed: false,
      threadId: first.accepted ? first.threadId : "",
    });
    expect(networkCall).not.toHaveBeenCalled();

    if (!first.accepted) throw new Error("Événement Slack attendu comme accepté.");
    const thread = await getConversationThread(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      first.threadId,
    );
    expect(thread.messages.map((message) => message.text)).toEqual([
      "Bonjour Slack",
      "Deuxième message Slack",
    ]);
    expect(thread.identities[0]).toMatchObject({
      channelKind: "collaboration",
      adapterKey: "slack",
      displayName: "Contact Slack",
    });

    const persisted = JSON.stringify(
      await Promise.all([
        setup.db.query("select * from conversation_threads"),
        setup.db.query("select * from conversation_channel_identities"),
        setup.db.query("select * from audit_logs"),
      ]),
    );
    expect(persisted).not.toContain(senderSubject);
    expect(persisted).not.toContain(conversationSubject);
    expect(persisted).not.toContain(workspaceId);
  });

  it("refuse un mapping absent ou désactivé sans créer de message", async () => {
    const setup = await createSetup();
    const unassigned = await ingestPreparedSlackMessage(
      setup.db,
      preparedMessage("EvUNASSIGNED1", "Absent", undefined, {
        team_id: "T999XYZ999",
      }),
      fingerprintSecret,
    );
    await setAuthorizedSlackEndpointStatus(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      endpointId: setup.endpointId,
      status: "disabled",
    });
    const disabled = await ingestPreparedSlackMessage(
      setup.db,
      preparedMessage("EvDISABLED1", "Désactivé"),
      fingerprintSecret,
    );

    expect(unassigned).toEqual({
      accepted: false,
      code: "channel_provider_endpoint_not_found",
    });
    expect(disabled).toEqual(unassigned);
    expect((await setup.db.query("select id from conversation_messages")).rows).toEqual(
      [],
    );
  });

  it("représente les fichiers sans URL, contenu ni téléchargement", async () => {
    const setup = await createSetup();
    const privateUrl = "https://files.slack.com/files-pri/private-document";
    const message = preparedMessage("EvFILE12345", "", undefined, {
      event: {
        type: "message",
        user: senderSubject,
        channel: conversationSubject,
        channel_type: "im",
        text: "",
        ts: "1753896600.000000",
        files: [{ url_private: privateUrl, content: "contenu privé" }],
      },
    });
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const result = await ingestPreparedSlackMessage(
      setup.db,
      message,
      fingerprintSecret,
    );

    expect(result).toMatchObject({ accepted: true, replayed: false });
    expect(networkCall).not.toHaveBeenCalled();
    const stored = await setup.db.query<{ text_content: string }>(
      "select text_content from conversation_messages",
    );
    expect(stored.rows).toEqual([
      { text_content: "1 fichier Slack en attente d’import." },
    ]);
    expect(JSON.stringify(stored.rows)).not.toContain(privateUrl);
  });
});

function preparedMessage(
  eventId: string,
  text: string,
  eventTimestamp = "1753896600.000000",
  overrides: Record<string, unknown> = {},
) {
  const rawBody = JSON.stringify({
    type: "event_callback",
    team_id: workspaceId,
    api_app_id: appId,
    event_id: eventId,
    event_time: Number(requestTimestamp),
    event: {
      type: "message",
      user: senderSubject,
      channel: conversationSubject,
      channel_type: "im",
      text,
      ts: eventTimestamp,
    },
    ...overrides,
  });
  const verified = verifyAndPrepareSlackWebhook(
    {
      rawBody,
      requestTimestamp,
      signature: `v0=${createHmac("sha256", signingSecret)
        .update(`v0:${requestTimestamp}:${rawBody}`)
        .digest("hex")}`,
    },
    { signingSecret, nowEpochSeconds: Number(requestTimestamp) },
  );
  if (!verified.ok || verified.kind !== "event") {
    throw new Error(
      `Préparation Slack refusée : ${verified.ok ? verified.kind : verified.code}`,
    );
  }
  return verified.message;
}

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire Slack",
    email: `owner-slack-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation Slack ${opened.length}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedSlackEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: appId,
      workspaceId,
    },
    fingerprintSecret,
  );
  return {
    db,
    services,
    owner,
    tenant,
    endpointId: endpoint.endpointId,
  };
}

