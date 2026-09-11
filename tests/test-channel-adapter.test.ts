import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createTestChannelAdapter,
  createWebChannelAdapter,
} from "../src/modules/channels";
import { getConversationThread } from "../src/modules/conversation-hub";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-07-30T09:30:00.000Z";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("adaptateur du canal de test", () => {
  it("projette un message sans réseau dans le même fil canonique", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable canal test",
      email: "canal-test@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation canal test",
      category: "Services",
    });
    const webAdapter = createWebChannelAdapter(db);
    const webMessage = await webAdapter.ingest(user.id, {
      tenantId: tenant.id,
      displayName: user.name,
      externalMessageId: "web_message_test_channel_1",
      idempotencyKey: "ingress:web-chat:test-channel-1",
      correlationId: "correlation_test_channel_1",
      text: "Prépare le fil de démonstration.",
      occurredAt: timestamp,
    });

    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const adapter = createTestChannelAdapter(db);
    const input = {
      tenantId: tenant.id,
      threadId: webMessage.threadId,
      externalSubjectId: "cliente-canal-test",
      displayName: "Cliente canal test",
      externalMessageId: "test_channel_message_1",
      idempotencyKey: "ingress:canal-test:message-1",
      correlationId: "correlation_test_channel_1",
      text: "Je confirme depuis le canal de test.",
      occurredAt: timestamp,
    };
    const first = await adapter.ingest(user.id, input);
    const replay = await adapter.ingest(user.id, input);

    expect(adapter).toMatchObject({ key: "canal-test", kind: "test" });
    expect(first).toMatchObject({
      threadId: webMessage.threadId,
      idempotentReplay: false,
    });
    expect(replay).toMatchObject({
      messageId: first.messageId,
      idempotentReplay: true,
    });
    expect(networkCall).not.toHaveBeenCalled();

    const thread = await getConversationThread(
      db,
      user.id,
      tenant.id,
      webMessage.threadId,
    );
    expect(
      thread.identities.map((identity) => identity.channelKind).sort(),
    ).toEqual(["test", "web"]);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({
      id: first.messageId,
      text: input.text,
      provenance: {
        adapterKey: "canal-test",
        externalMessageId: input.externalMessageId,
      },
    });
  });
});
