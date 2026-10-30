import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  ingestPreparedTeamsMessage,
  registerAuthorizedTeamsEndpoint,
  setAuthorizedTeamsEndpointStatus,
  verifyAndPrepareTeamsActivity,
} from "../src/modules/channels";
import { getConversationThread } from "../src/modules/conversation-hub";

const opened: Array<{ close: () => Promise<void> }> = [];
const fingerprintSecret = "test-fingerprint-secret-32-bytes-minimum";
const clientId = "11111111-1111-4111-8111-111111111111";
const microsoftTenantId = "22222222-2222-4222-8222-222222222222";
const senderSubject = "29:sender-private-reference";
const conversationSubject = "19:conversation-private-reference@thread.v2";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("ingestion Microsoft Teams préparée", () => {
  it("résout le tenant, rejoue l'activité et conserve le fil externe", async () => {
    const setup = await createSetup();
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const firstMessage = await preparedMessage("activity-teams-1", "Bonjour Teams");
    const secondMessage = await preparedMessage(
      "activity-teams-2",
      "Deuxième message Teams",
      "2026-07-30T17:31:00.000Z",
    );

    const first = await ingestPreparedTeamsMessage(setup.db, firstMessage, {
      clientId,
      fingerprintSecret,
    });
    const replay = await ingestPreparedTeamsMessage(setup.db, firstMessage, {
      clientId,
      fingerprintSecret,
    });
    const second = await ingestPreparedTeamsMessage(setup.db, secondMessage, {
      clientId,
      fingerprintSecret,
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
    expect(second).toMatchObject({
      accepted: true,
      replayed: false,
      threadId: first.accepted ? first.threadId : "",
    });
    expect(networkCall).not.toHaveBeenCalled();

    if (!first.accepted) throw new Error("Activité Teams attendue comme acceptée.");
    const thread = await getConversationThread(
      setup.db,
      setup.owner.id,
      setup.tenant.id,
      first.threadId,
    );
    expect(thread.messages.map((message) => message.text)).toEqual([
      "Bonjour Teams",
      "Deuxième message Teams",
    ]);
    expect(thread.identities[0]).toMatchObject({
      channelKind: "collaboration",
      adapterKey: "teams-microsoft",
      displayName: "Contact Microsoft Teams",
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
    expect(persisted).not.toContain(microsoftTenantId);
  });

  it("refuse un mapping absent ou désactivé sans créer de message", async () => {
    const setup = await createSetup();
    const unassignedMessage = await preparedMessage(
      "activity-unassigned",
      "Absent",
      undefined,
      {
        channelData: {
          tenant: { id: "33333333-3333-4333-8333-333333333333" },
        },
      },
    );
    const unassigned = await ingestPreparedTeamsMessage(
      setup.db,
      unassignedMessage,
      { clientId, fingerprintSecret },
    );
    await setAuthorizedTeamsEndpointStatus(setup.db, {
      tenantId: setup.tenant.id,
      actorId: setup.owner.id,
      endpointId: setup.endpointId,
      status: "disabled",
    });
    const disabled = await ingestPreparedTeamsMessage(
      setup.db,
      await preparedMessage("activity-disabled", "Désactivé"),
      { clientId, fingerprintSecret },
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

  it("représente les pièces jointes sans URL, contenu ni téléchargement", async () => {
    const setup = await createSetup();
    const privateUrl = "https://files.example.test/private-document";
    const message = await preparedMessage("activity-attachment", "", undefined, {
      attachments: [
        {
          contentType: "application/pdf",
          contentUrl: privateUrl,
          content: { secret: "contenu privé" },
        },
      ],
    });
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const result = await ingestPreparedTeamsMessage(setup.db, message, {
      clientId,
      fingerprintSecret,
    });

    expect(result).toMatchObject({ accepted: true, replayed: false });
    expect(networkCall).not.toHaveBeenCalled();
    const stored = await setup.db.query<{ text_content: string }>(
      "select text_content from conversation_messages",
    );
    expect(stored.rows).toEqual([
      { text_content: "1 pièce jointe Teams en attente d’import." },
    ]);
    expect(JSON.stringify(stored.rows)).not.toContain(privateUrl);
  });
});

async function preparedMessage(
  activityId: string,
  text: string,
  timestamp = "2026-07-30T17:30:00.000Z",
  overrides: Record<string, unknown> = {},
) {
  const verified = await verifyAndPrepareTeamsActivity(
    {
      authorization: "Bearer header.payload.signature",
      rawBody: JSON.stringify({
        type: "message",
        id: activityId,
        timestamp,
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        channelId: "msteams",
        from: { id: senderSubject },
        recipient: { id: "28:bot" },
        conversation: { id: conversationSubject },
        channelData: { tenant: { id: microsoftTenantId } },
        text,
        ...overrides,
      }),
    },
    {
      clientId,
      tenantId: microsoftTenantId,
      createValidator: () => ({ check: vi.fn().mockResolvedValue({}) }),
    },
  );
  if (!verified.ok) {
    throw new Error(`Préparation Teams refusée : ${verified.code}`);
  }
  return verified.message;
}

async function createSetup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire Teams",
    email: `owner-teams-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation Teams ${opened.length}`,
    category: "Services",
  });
  const endpoint = await registerAuthorizedTeamsEndpoint(
    db,
    {
      tenantId: tenant.id,
      actorId: owner.id,
      externalAccountId: clientId,
      microsoftTenantId,
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
