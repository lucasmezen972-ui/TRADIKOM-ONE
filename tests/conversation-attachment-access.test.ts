import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { createConversationChannelServices } from "../src/modules/channels/runtime";
import {
  createMockAttachmentAccessTicketCodec,
  createUnavailableAttachmentAccessDependencies,
  prepareConversationAttachmentAccess,
  readConversationAttachment,
  type AttachmentAccessDependencies,
  type AttachmentAccessPolicyEvaluator,
  type AttachmentStorageAccessAdapter,
} from "../src/modules/conversation-hub";
import { ingestConversationMessage } from "../src/modules/conversation-hub/service";

const opened: Array<{ close: () => Promise<void> }> = [];
const now = new Date("2026-09-04T17:30:00.000Z");
const mediaBytes = Buffer.from("preuve-pdf-fiable", "utf8");
const attachmentId = "attachment_access_1";
const ticketKeyMaterial = "cle-mock-locale-de-test-attachment-access-2026";
type StorageRead = Extract<
  AttachmentStorageAccessAdapter,
  { state: "mock" }
>["read"];
type StorageReadInput = Parameters<StorageRead>[0];
type PolicyInput = Parameters<AttachmentAccessPolicyEvaluator>[0];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("accès sécurisé aux pièces jointes de conversation", () => {
  it("émet un ticket opaque borné et sert le contenu vérifié de façon idempotente", async () => {
    const context = await setup("attachment-access@example.com");
    const read = vi.fn(async (input: StorageReadInput) => {
      void input;
      return {
        status: "succeeded" as const,
        bytes: mediaBytes,
      };
    });
    const evaluatePolicy = vi.fn(async (input: PolicyInput) => {
      void input;
      return { allowed: true as const };
    });
    const dependencies = mockDependencies({ read, evaluatePolicy });
    const services = createConversationChannelServices(context.db, {
      attachmentAccess: dependencies,
    });

    expect(services.attachmentAccessState).toBe("mock");
    const prepared = await prepareConversationAttachmentAccess(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId, ttlSeconds: 90 },
      dependencies,
      { now },
    );
    expect(prepared).toMatchObject({
      status: "ready",
      storageMode: "mock",
      expiresAt: "2026-09-04T17:31:30.000Z",
    });
    if (prepared.status !== "ready") throw new Error("Ticket attendu.");
    expect(prepared.ticket).not.toContain(context.tenantId);
    expect(prepared.ticket).not.toContain(context.userId);
    expect(prepared.ticket).not.toContain(attachmentId);
    expect(prepared.ticket).not.toContain("mock:media");

    const first = await readConversationAttachment(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId, ticket: prepared.ticket },
      dependencies,
      { now: new Date("2026-09-04T17:30:10.000Z") },
    );
    const replay = await readConversationAttachment(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId, ticket: prepared.ticket },
      dependencies,
      { now: new Date("2026-09-04T17:30:20.000Z") },
    );
    expect(first).toMatchObject({
      status: "succeeded",
      storageMode: "mock",
      contentType: "application/pdf",
      fileName: "preuve_fiable.pdf",
    });
    expect(first.status === "succeeded" && first.content.equals(mediaBytes)).toBe(
      true,
    );
    expect(replay.status).toBe("succeeded");
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0]?.[0].idempotencyKey).toBe(
      read.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(read.mock.calls[0]?.[0].idempotencyKey).toMatch(
      /^attachment-access:[a-f0-9]{64}$/,
    );
    expect(evaluatePolicy.mock.calls.map(([input]) => input.operation)).toEqual([
      "prepare",
      "read",
      "read",
    ]);
    expect(evaluatePolicy.mock.calls.map(([input]) => ({
      threadId: input.threadId,
      confidentialityLevel: input.confidentialityLevel,
      visibilityScope: input.visibilityScope,
    }))).toEqual([
      expect.objectContaining({
        threadId: expect.stringMatching(/^conversation_thread_/),
        confidentialityLevel: "internal",
        visibilityScope: "tenant",
      }),
      expect.objectContaining({
        threadId: expect.stringMatching(/^conversation_thread_/),
        confidentialityLevel: "internal",
        visibilityScope: "tenant",
      }),
      expect.objectContaining({
        threadId: expect.stringMatching(/^conversation_thread_/),
        confidentialityLevel: "internal",
        visibilityScope: "tenant",
      }),
    ]);

    const audits = await context.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1 and target_id = $2 order by created_at asc`,
      [context.tenantId, attachmentId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual([
      "conversation.attachment_access_prepared",
      "conversation.attachment_access_served",
      "conversation.attachment_access_served",
    ]);
    const serializedAudits = JSON.stringify(audits.rows);
    expect(serializedAudits).not.toContain(prepared.ticket);
    expect(serializedAudits).not.toContain("preuve_fiable.pdf");
    expect(serializedAudits).not.toContain("preuve-pdf-fiable");
    expect(serializedAudits).not.toContain("mock:media");
    expect(serializedAudits).not.toContain(checksum(mediaBytes));
  });

  it("expose explicitement disabled et not_configured sans appeler de fournisseur", async () => {
    const context = await setup("attachment-unavailable@example.com");
    for (const state of ["disabled", "not_configured"] as const) {
      const dependencies = createUnavailableAttachmentAccessDependencies(state);
      await expect(
        prepareConversationAttachmentAccess(
          context.db,
          context.userId,
          context.tenantId,
          { attachmentId },
          dependencies,
          { now },
        ),
      ).resolves.toEqual({ status: state });
      await expect(
        readConversationAttachment(
          context.db,
          context.userId,
          context.tenantId,
          { attachmentId, ticket: "a".repeat(80) },
          dependencies,
          { now },
        ),
      ).resolves.toEqual({ status: state });
    }
    const defaults = createConversationChannelServices(context.db);
    expect(defaults.attachmentAccessState).toBe("not_configured");
  });

  it("refuse la préparation ou la lecture si la politique ne l'autorise pas", async () => {
    const context = await setup("attachment-policy@example.com");
    const storageRead = vi.fn();
    const deniedPrepare = mockDependencies({
      read: storageRead,
      evaluatePolicy: async () => ({
        allowed: false as const,
        code: "attachment_access_role_denied",
      }),
    });
    await expect(
      prepareConversationAttachmentAccess(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId },
        deniedPrepare,
        { now },
      ),
    ).resolves.toEqual({
      status: "denied",
      safeErrorCode: "attachment_access_role_denied",
    });

    const allowPrepare = mockDependencies({ read: storageRead });
    const prepared = await prepareConversationAttachmentAccess(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId },
      allowPrepare,
      { now },
    );
    if (prepared.status !== "ready") throw new Error("Ticket attendu.");
    const deniedRead = mockDependencies({
      read: storageRead,
      codec: allowPrepare.ticketCodec,
      evaluatePolicy: async ({ operation }) =>
        operation === "read"
          ? {
              allowed: false as const,
              code: "attachment_access_read_denied",
            }
          : { allowed: true as const },
    });
    await expect(
      readConversationAttachment(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId, ticket: prepared.ticket },
        deniedRead,
        { now },
      ),
    ).resolves.toEqual({
      status: "denied",
      safeErrorCode: "attachment_access_read_denied",
    });
    expect(storageRead).not.toHaveBeenCalled();
  });

  it("transmet la confidentialité et la visibilité durables à chaque évaluation", async () => {
    const context = await setup("attachment-classification@example.com");
    await context.db.query(
      `update conversation_threads
       set confidentiality_level = 'restricted', visibility_scope = 'team'
       where tenant_id = $1`,
      [context.tenantId],
    );
    const evaluatePolicy = vi.fn(async (input: PolicyInput) => {
      if (
        input.confidentialityLevel !== "restricted" ||
        input.visibilityScope !== "team"
      ) {
        return {
          allowed: false as const,
          code: "attachment_access_classification_denied",
        };
      }
      return { allowed: true as const };
    });
    const dependencies = mockDependencies({
      read: async () => ({ status: "succeeded" as const, bytes: mediaBytes }),
      evaluatePolicy,
    });
    const prepared = await prepareConversationAttachmentAccess(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId },
      dependencies,
      { now },
    );
    if (prepared.status !== "ready") throw new Error("Ticket attendu.");
    await expect(
      readConversationAttachment(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId, ticket: prepared.ticket },
        dependencies,
        { now },
      ),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(evaluatePolicy).toHaveBeenCalledTimes(2);
    expect(evaluatePolicy.mock.calls.map(([input]) => input.operation)).toEqual([
      "prepare",
      "read",
    ]);
    expect(evaluatePolicy.mock.calls[0]?.[0]).toMatchObject({
      confidentialityLevel: "restricted",
      visibilityScope: "team",
    });
  });

  it("rejette un ticket altéré, expiré, lié à un autre acteur ou à une autre pièce", async () => {
    const context = await setup("attachment-ticket@example.com");
    const second = await addMember(context, "attachment-second@example.com");
    const read = vi.fn();
    const dependencies = mockDependencies({ read });
    const prepared = await prepareConversationAttachmentAccess(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId, ttlSeconds: 30 },
      dependencies,
      { now },
    );
    if (prepared.status !== "ready") throw new Error("Ticket attendu.");

    const cases = [
      {
        userId: context.userId,
        attachment: attachmentId,
        ticket: `${prepared.ticket.slice(0, -1)}${prepared.ticket.endsWith("a") ? "b" : "a"}`,
        at: now,
        code: "attachment_access_ticket_invalid",
      },
      {
        userId: context.userId,
        attachment: attachmentId,
        ticket: prepared.ticket,
        at: new Date("2026-09-04T17:30:30.000Z"),
        code: "attachment_access_ticket_expired",
      },
      {
        userId: second.userId,
        attachment: attachmentId,
        ticket: prepared.ticket,
        at: now,
        code: "attachment_access_ticket_invalid",
      },
      {
        userId: context.userId,
        attachment: "attachment_access_2",
        ticket: prepared.ticket,
        at: now,
        code: "attachment_access_ticket_invalid",
      },
    ];
    for (const item of cases) {
      await expect(
        readConversationAttachment(
          context.db,
          item.userId,
          context.tenantId,
          { attachmentId: item.attachment, ticket: item.ticket },
          dependencies,
          { now: item.at },
        ),
      ).rejects.toMatchObject({
        code: item.code,
        message: "Cette pièce jointe n'est pas disponible.",
      });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("isole les organisations avant tout accès au stockage", async () => {
    const context = await setup("attachment-tenant-a@example.com");
    const other = await createTenant(
      context.db,
      "attachment-tenant-b@example.com",
    );
    const read = vi.fn();
    const dependencies = mockDependencies({ read });

    await expect(
      prepareConversationAttachmentAccess(
        context.db,
        other.userId,
        context.tenantId,
        { attachmentId },
        dependencies,
        { now },
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    await expect(
      prepareConversationAttachmentAccess(
        context.db,
        other.userId,
        other.tenantId,
        { attachmentId },
        dependencies,
        { now },
      ),
    ).rejects.toMatchObject({
      code: "attachment_access_not_found",
      message: "Cette pièce jointe n'est pas disponible.",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("ferme l'accès si la taille ou l'empreinte du contenu diffère", async () => {
    const context = await setup("attachment-integrity@example.com");
    for (const [bytes, safeErrorCode] of [
      [Buffer.from("trop-court"), "attachment_access_size_mismatch"],
      [Buffer.alloc(mediaBytes.byteLength, 0), "attachment_access_checksum_mismatch"],
    ] as const) {
      const dependencies = mockDependencies({
        read: async () => ({ status: "succeeded" as const, bytes }),
      });
      const prepared = await prepareConversationAttachmentAccess(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId },
        dependencies,
        { now },
      );
      if (prepared.status !== "ready") throw new Error("Ticket attendu.");
      await expect(
        readConversationAttachment(
          context.db,
          context.userId,
          context.tenantId,
          { attachmentId, ticket: prepared.ticket },
          dependencies,
          { now },
        ),
      ).resolves.toEqual({
        status: "failed",
        classification: "permanent",
        safeErrorCode,
        retryable: false,
      });
    }
  });

  it("revérifie les métadonnées après la lecture et audite une modification concurrente", async () => {
    const context = await setup("attachment-race@example.com");
    const dependencies = mockDependencies({
      read: async () => {
        await context.db.query(
          `update conversation_message_attachments
           set storage_reference = $1 where tenant_id = $2 and id = $3`,
          [
            "mock:media/attachment-access-remplace",
            context.tenantId,
            attachmentId,
          ],
        );
        return { status: "succeeded" as const, bytes: mediaBytes };
      },
    });
    const prepared = await prepareConversationAttachmentAccess(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId },
      dependencies,
      { now },
    );
    if (prepared.status !== "ready") throw new Error("Ticket attendu.");

    await expect(
      readConversationAttachment(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId, ticket: prepared.ticket },
        dependencies,
        { now },
      ),
    ).rejects.toMatchObject({
      code: "attachment_access_metadata_invalid",
      message: "Cette pièce jointe n'est pas disponible.",
    });
    const audit = await context.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and target_id = $2
         and action = 'conversation.attachment_access_failed'`,
      [context.tenantId, attachmentId],
    );
    expect(audit.rows[0]?.safe_metadata).toContain(
      "attachment_access_metadata_invalid",
    );
    expect(audit.rows[0]?.safe_metadata).not.toContain(
      "attachment-access-remplace",
    );
  });

  it("ferme la lecture si les droits du fil changent pendant l'accès au stockage", async () => {
    const context = await setup("attachment-access-race@example.com");
    const dependencies = mockDependencies({
      read: async () => {
        await context.db.query(
          `update conversation_threads
           set confidentiality_level = 'secret', visibility_scope = 'personal'
           where tenant_id = $1`,
          [context.tenantId],
        );
        return { status: "succeeded" as const, bytes: mediaBytes };
      },
    });
    const prepared = await prepareConversationAttachmentAccess(
      context.db,
      context.userId,
      context.tenantId,
      { attachmentId },
      dependencies,
      { now },
    );
    if (prepared.status !== "ready") throw new Error("Ticket attendu.");

    await expect(
      readConversationAttachment(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId, ticket: prepared.ticket },
        dependencies,
        { now },
      ),
    ).rejects.toMatchObject({
      code: "attachment_access_metadata_invalid",
      message: "Cette pièce jointe n'est pas disponible.",
    });
  });

  it("classe les erreurs fournisseur sans laisser le fournisseur injecter l'audit", async () => {
    const context = await setup("attachment-provider-error@example.com");
    for (const [classification, providerCode, expectedCode] of [
      ["temporary", "attachment_storage_throttled", "attachment_storage_throttled"],
      ["permanent", "secret_client_filename", "attachment_storage_failed"],
    ] as const) {
      const dependencies = mockDependencies({
        read: async () => ({
          status: "failed" as const,
          classification,
          safeErrorCode: providerCode,
        }),
      });
      const prepared = await prepareConversationAttachmentAccess(
        context.db,
        context.userId,
        context.tenantId,
        { attachmentId },
        dependencies,
        { now },
      );
      if (prepared.status !== "ready") throw new Error("Ticket attendu.");
      await expect(
        readConversationAttachment(
          context.db,
          context.userId,
          context.tenantId,
          { attachmentId, ticket: prepared.ticket },
          dependencies,
          { now },
        ),
      ).resolves.toEqual({
        status: "failed",
        classification,
        safeErrorCode: expectedCode,
        retryable: classification === "temporary",
      });
    }
    const audits = await context.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and target_id = $2`,
      [context.tenantId, attachmentId],
    );
    expect(JSON.stringify(audits.rows)).not.toContain("secret_client_filename");
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function setup(email: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const tenant = await createTenant(db, email);
  await insertMessageWithAttachments(db, tenant.userId, tenant.tenantId);
  return { db, ...tenant };
}

async function createTenant(db: TestDb, email: string) {
  const services = createServices(db);
  const user = await services.registerUser({
    name: "Responsable pièces jointes",
    email,
    password: "Password!1",
  });
  const tenant = await services.createTenant(user.id, {
    name: `Organisation ${email}`,
    category: "Services",
  });
  return { userId: user.id, tenantId: tenant.id };
}

async function addMember(
  context: { db: TestDb; tenantId: string },
  email: string,
) {
  const services = createServices(context.db);
  const user = await services.registerUser({
    name: "Lecteur pièces jointes",
    email,
    password: "Password!1",
  });
  await context.db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, 'collaborator', $3)`,
    [context.tenantId, user.id, now.toISOString()],
  );
  return { userId: user.id };
}

async function insertMessageWithAttachments(
  db: TestDb,
  userId: string,
  tenantId: string,
) {
  await ingestConversationMessage(db, userId, {
    tenantId,
    channelIdentity: {
      id: "identity_attachment_access",
      tenantId,
      participantId: "participant_attachment_access",
      channelKind: "test",
      adapterKey: "canal-test",
      externalSubjectId: "external_attachment_access",
      displayName: "Cliente test",
      role: "customer",
      state: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    externalMessageId: "external_message_attachment_access",
    idempotencyKey: "ingress:attachment-access:message-1",
    correlationId: "correlation_attachment_access",
    routeTrace: [],
    text: "Voici les pièces demandées.",
    attachments: [
      {
        id: attachmentId,
        kind: "document",
        fileName: "preuve/fiable.pdf",
        mediaType: "application/pdf",
        sizeBytes: mediaBytes.byteLength,
        storageReference: "mock:media/attachment-access-1",
        checksumSha256: checksum(mediaBytes),
      },
      {
        id: "attachment_access_2",
        kind: "document",
        fileName: "seconde.pdf",
        mediaType: "application/pdf",
        sizeBytes: mediaBytes.byteLength,
        storageReference: "mock:media/attachment-access-2",
        checksumSha256: checksum(mediaBytes),
      },
    ],
    occurredAt: now.toISOString(),
  });
}

function mockDependencies(input: {
  read: (
    input: {
      tenantId: string;
      attachmentId: string;
      storageReference: string;
      idempotencyKey: string;
      maxBytes: number;
    },
  ) => Promise<
    | { status: "succeeded"; bytes: Uint8Array }
    | {
        status: "failed";
        classification: "temporary" | "permanent";
        safeErrorCode: string;
      }
  >;
  evaluatePolicy?: AttachmentAccessDependencies["evaluatePolicy"];
  codec?: AttachmentAccessDependencies["ticketCodec"];
}): AttachmentAccessDependencies {
  return {
    storage: { state: "mock", read: input.read },
    ticketCodec:
      input.codec ??
      createMockAttachmentAccessTicketCodec({
        keyMaterial: ticketKeyMaterial,
        keyVersion: "attachment-access-test-v1",
      }),
    evaluatePolicy:
      input.evaluatePolicy ?? (async () => ({ allowed: true as const })),
  };
}

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
