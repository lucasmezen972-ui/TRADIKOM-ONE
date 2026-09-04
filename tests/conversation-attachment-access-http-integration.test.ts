import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createMockAttachmentAccessTicketCodec,
  handleConversationAttachmentAccessRequest,
  ingestConversationMessage,
  prepareConversationAttachmentAccess,
  readConversationAttachment,
  type AttachmentAccessDependencies,
} from "../src/modules/conversation-hub";

const opened: Array<{ close: () => Promise<void> }> = [];
const now = new Date("2026-09-04T18:00:00.000Z");
const appOrigin = "https://app.example.test";
const attachmentId = "attachment_http_integration_1";
const content = Buffer.from("preuve-http-service-storage", "utf8");

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("intégration HTTP vers le service de pièce jointe", () => {
  it("prépare puis consomme le ticket jusqu'au stockage mock et à l'audit", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable accès HTTP",
      email: "attachment-http-integration@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation accès HTTP",
      category: "Services",
    });
    await ingestConversationMessage(db, user.id, {
      tenantId: tenant.id,
      channelIdentity: {
        id: "identity_http_integration",
        tenantId: tenant.id,
        participantId: "participant_http_integration",
        channelKind: "test",
        adapterKey: "canal-test",
        externalSubjectId: "external_http_integration",
        displayName: "Cliente test",
        role: "customer",
        state: "active",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      externalMessageId: "external_message_http_integration",
      idempotencyKey: "ingress:attachment-http-integration:1",
      correlationId: "correlation_http_integration",
      routeTrace: [],
      text: "Voici la preuve demandée.",
      attachments: [
        {
          id: attachmentId,
          kind: "document",
          fileName: "preuve-http.pdf",
          mediaType: "application/pdf",
          sizeBytes: content.byteLength,
          storageReference: "mock:media/http-integration",
          checksumSha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
      occurredAt: now.toISOString(),
    });
    const storageRead = vi.fn(
      async (input: {
        tenantId: string;
        attachmentId: string;
        storageReference: string;
        idempotencyKey: string;
        maxBytes: number;
      }) => {
        void input;
        return {
          status: "succeeded" as const,
          bytes: content,
        };
      },
    );
    const attachmentAccess: AttachmentAccessDependencies = {
      storage: { state: "mock", read: storageRead },
      ticketCodec: createMockAttachmentAccessTicketCodec({
        keyMaterial: "cle-locale-integration-http-piece-jointe-2026",
        keyVersion: "attachment-http-integration-v1",
      }),
      evaluatePolicy: async () => ({ allowed: true }),
    };
    const dependencies = {
      expectedOrigin: appOrigin,
      correlationId: "corr_http_integration",
      resolveContext: async () => ({
        status: "authenticated" as const,
        userId: user.id,
        tenantId: tenant.id,
      }),
      prepare: ({ userId, tenantId, attachmentId: requestedId }: {
        userId: string;
        tenantId: string;
        attachmentId: string;
      }) =>
        prepareConversationAttachmentAccess(
          db,
          userId,
          tenantId,
          { attachmentId: requestedId },
          attachmentAccess,
          { now },
        ),
      read: ({
        userId,
        tenantId,
        attachmentId: requestedId,
        ticket,
      }: {
        userId: string;
        tenantId: string;
        attachmentId: string;
        ticket: string;
      }) =>
        readConversationAttachment(
          db,
          userId,
          tenantId,
          { attachmentId: requestedId, ticket },
          attachmentAccess,
          { now: new Date("2026-09-04T18:00:10.000Z") },
        ),
    };
    const url = `${appOrigin}/api/conversation/attachments/${attachmentId}`;

    const preparedResponse = await handleConversationAttachmentAccessRequest(
      new Request(url, { method: "POST", headers: { origin: appOrigin } }),
      { attachmentId },
      dependencies,
    );
    const prepared = (await preparedResponse.json()) as {
      ticket: string;
      expiresAt: string;
    };
    expect(preparedResponse.status).toBe(200);
    expect(prepared.expiresAt).toBe("2026-09-04T18:01:00.000Z");
    expect(url).not.toContain(prepared.ticket);

    const downloadResponse = await handleConversationAttachmentAccessRequest(
      new Request(url, {
        method: "PUT",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ ticket: prepared.ticket }),
      }),
      { attachmentId },
      dependencies,
    );
    expect(downloadResponse.status).toBe(200);
    expect(Buffer.from(await downloadResponse.arrayBuffer())).toEqual(content);
    expect(storageRead).toHaveBeenCalledOnce();
    expect(storageRead.mock.calls[0]?.[0]).toMatchObject({
      tenantId: tenant.id,
      attachmentId,
      storageReference: "mock:media/http-integration",
      maxBytes: 25 * 1024 * 1024,
    });

    const audits = await db.query<{ action: string; safe_metadata: string }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1 and target_id = $2 order by created_at asc`,
      [tenant.id, attachmentId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      "conversation.attachment_access_prepared",
      "conversation.attachment_access_served",
    ]);
    const serialized = JSON.stringify(audits.rows);
    expect(serialized).not.toContain(prepared.ticket);
    expect(serialized).not.toContain("preuve-http.pdf");
    expect(serialized).not.toContain("preuve-http-service-storage");
    expect(serialized).not.toContain("mock:media/http-integration");
  });
});
