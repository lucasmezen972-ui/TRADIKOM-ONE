import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  getConversationThread,
  ingestConversationMessage,
  listConversationThreads,
} from "../src/modules/conversation-hub/service";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-07-30T09:15:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("service du Conversation Hub", () => {
  it("ingère un message une seule fois et restitue un fil canonique", async () => {
    const context = await createTenantContext("conversation-owner@example.com");
    const input = ingressFixture(context.tenantId);

    const first = await ingestConversationMessage(
      context.db,
      context.userId,
      input,
    );
    const replay = await ingestConversationMessage(
      context.db,
      context.userId,
      input,
    );

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toMatchObject({
      idempotentReplay: true,
      messageId: first.messageId,
      threadId: first.threadId,
    });

    const counts = await context.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_messages
       where tenant_id = $1 and idempotency_key = $2`,
      [context.tenantId, input.idempotencyKey],
    );
    expect(counts.rows[0]?.count).toBe(1);

    const thread = await getConversationThread(
      context.db,
      context.userId,
      context.tenantId,
      first.threadId,
    );
    expect(thread).toMatchObject({
      id: first.threadId,
      tenantId: context.tenantId,
      status: "open",
      confidentialityLevel: "internal",
      visibilityScope: "tenant",
      createdAt: timestamp,
      lastMessageAt: timestamp,
    });
    expect(thread.identities).toHaveLength(1);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      id: first.messageId,
      text: "Bonjour, je souhaite un devis.",
      attachments: [
        {
          id: "attachment_service_1",
          fileName: "demande.pdf",
          sizeBytes: 1024,
        },
      ],
      provenance: {
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        routeTrace: input.routeTrace,
      },
    });

    const alteredText = "password=contenu-altéré-à-masquer";
    await context.db.query(
      `insert into conversation_message_attachments (
         id, tenant_id, message_id, kind, file_name, media_type, size_bytes,
         storage_reference, checksum_sha256, trust_boundary, extractor_mode,
         extractor_key, extracted_text, extracted_text_sha256, extracted_at,
         created_at
       ) values (
         'attachment_integrity_failed', $1, $2, 'document', 'altéré.pdf',
         'application/pdf', 32, 'mock:media/integrity-failed', $3,
         'external_untrusted_data', 'mock', 'mock_external_text_v1', $4, $5,
         $6, $6
       )`,
      [
        context.tenantId,
        first.messageId,
        "c".repeat(64),
        alteredText,
        "d".repeat(64),
        timestamp,
      ],
    );
    const integrityThread = await getConversationThread(
      context.db,
      context.userId,
      context.tenantId,
      first.threadId,
    );
    const alteredAttachment = integrityThread.messages[0]?.attachments.find(
      (attachment) => attachment.id === "attachment_integrity_failed",
    );
    expect(alteredAttachment?.extraction).toEqual({
      trustBoundary: "external_untrusted_data",
      integrity: "failed",
    });
    expect(JSON.stringify(alteredAttachment)).not.toContain(alteredText);

    await expect(
      listConversationThreads(
        context.db,
        context.userId,
        context.tenantId,
        500,
      ),
    ).rejects.toBeDefined();
    expect(
      await listConversationThreads(
        context.db,
        context.userId,
        context.tenantId,
      ),
    ).toMatchObject([{
      id: first.threadId,
      tenantId: context.tenantId,
      confidentialityLevel: "internal",
      visibilityScope: "tenant",
    }]);

    const audits = await context.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata
       from audit_logs
       where tenant_id = $1 and target_type = 'conversation_message'
       order by created_at asc`,
      [context.tenantId],
    );
    expect(audits.rows.map((row) => row.action).sort()).toEqual([
      "conversation.message_received",
      "conversation.message_replayed",
    ]);
    for (const audit of audits.rows) {
      expect(audit.safe_metadata).not.toContain("Bonjour");
      expect(audit.safe_metadata).not.toContain("visitor_service_1");
      expect(audit.safe_metadata).not.toContain("demande.pdf");
    }

    await expect(
      ingestConversationMessage(
        context.db,
        context.userId,
        ingressFixture(context.tenantId, {
          idempotencyKey: "ingress:canal-test:identity-conflict",
          externalMessageId: "external_identity_conflict",
          channelIdentityId: "identity_service_conflict",
        }),
      ),
    ).rejects.toMatchObject({ code: "conversation_identity_conflict" });

    await expect(
      ingestConversationMessage(
        context.db,
        context.userId,
        ingressFixture(context.tenantId, {
          text: "Ce contenu ne doit pas remplacer le message initial.",
        }),
      ),
    ).rejects.toMatchObject({ code: "conversation_idempotency_conflict" });

    await expect(
      ingestConversationMessage(
        context.db,
        context.userId,
        ingressFixture(context.tenantId, {
          idempotencyKey: "ingress:canal-test:identity-blocked",
          externalMessageId: "external_identity_blocked",
          channelIdentityId: "identity_service_blocked",
          participantId: "participant_service_blocked",
          externalSubjectId: "visitor_service_blocked",
          state: "blocked",
        }),
      ),
    ).rejects.toMatchObject({ code: "conversation_identity_unavailable" });
  });

  it("exige le membership, interdit l'écriture read-only et isole la lecture", async () => {
    const ownerA = await createTenantContext("conversation-a@example.com");
    const ownerB = await createSecondUserAndTenant(
      ownerA.db,
      "conversation-b@example.com",
    );
    const first = await ingestConversationMessage(
      ownerA.db,
      ownerA.userId,
      ingressFixture(ownerA.tenantId),
    );

    await expect(
      getConversationThread(
        ownerA.db,
        ownerB.userId,
        ownerA.tenantId,
        first.threadId,
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });

    await ownerA.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'read-only', $3)`,
      [ownerA.tenantId, ownerB.userId, timestamp],
    );
    await expect(
      ingestConversationMessage(
        ownerA.db,
        ownerB.userId,
        ingressFixture(ownerA.tenantId, {
          idempotencyKey: "ingress:canal-test:read-only",
          externalMessageId: "external_read_only",
        }),
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });

    await expect(
      getConversationThread(
        ownerA.db,
        ownerB.userId,
        ownerB.tenantId,
        first.threadId,
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });

    await expect(
      ingestConversationMessage(
        ownerA.db,
        ownerB.userId,
        ingressFixture(ownerB.tenantId, {
          threadId: first.threadId,
          idempotencyKey: "ingress:canal-test:cross-tenant-thread",
          externalMessageId: "external_cross_tenant_thread",
          channelIdentityId: "identity_service_tenant_b",
          participantId: "participant_service_tenant_b",
          externalSubjectId: "visitor_service_tenant_b",
        }),
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });

    await expect(
      ingestConversationMessage(
        ownerA.db,
        ownerA.userId,
        ingressFixture(ownerA.tenantId, {
          threadId: "conversation_thread_external_missing",
          idempotencyKey: "ingress:canal-test:missing-thread",
          externalMessageId: "external_missing_thread",
          channelIdentityId: "identity_service_missing_thread",
          participantId: "participant_service_missing_thread",
          externalSubjectId: "visitor_service_missing_thread",
        }),
      ),
    ).rejects.toMatchObject({ code: "conversation_thread_not_found" });
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createTenantContext(email: string) {
  const db = await createMemoryDb();
  opened.push(db);
  return createSecondUserAndTenant(db, email);
}

async function createSecondUserAndTenant(db: TestDb, email: string) {
  const services = createServices(db);
  const user = await services.registerUser({
    name: "Responsable conversation",
    email,
    password: "Password!1",
  });
  const tenant = await services.createTenant(user.id, {
    name: `Organisation ${email}`,
    category: "Services",
  });
  return { db, userId: user.id, tenantId: tenant.id };
}

function ingressFixture(
  tenantId: string,
  overrides: Partial<{
    threadId: string;
    idempotencyKey: string;
    externalMessageId: string;
    channelIdentityId: string;
    participantId: string;
    externalSubjectId: string;
    state: "active" | "unverified" | "blocked" | "revoked";
    text: string;
  }> = {},
) {
  const channelIdentityId =
    overrides.channelIdentityId ?? "identity_service_1";
  return {
    tenantId,
    ...(overrides.threadId ? { threadId: overrides.threadId } : {}),
    channelIdentity: {
      id: channelIdentityId,
      tenantId,
      participantId: overrides.participantId ?? "participant_service_1",
      channelKind: "test" as const,
      adapterKey: "canal-test",
      externalSubjectId:
        overrides.externalSubjectId ?? "visitor_service_1",
      displayName: "Cliente test",
      role: "customer" as const,
      state: overrides.state ?? ("active" as const),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    externalMessageId:
      overrides.externalMessageId ?? "external_message_service_1",
    idempotencyKey:
      overrides.idempotencyKey ?? "ingress:canal-test:external_message_service_1",
    correlationId: "correlation_conversation_service_1",
    routeTrace: [
      {
        adapterKey: "canal-test",
        channelIdentityId,
        externalMessageId: "external_message_service_1",
      },
    ],
    text: overrides.text ?? "Bonjour, je souhaite un devis.",
    attachments: [
      {
        id: "attachment_service_1",
        kind: "document" as const,
        fileName: "demande.pdf",
        mediaType: "application/pdf",
        sizeBytes: 1024,
        storageReference: `${tenantId}/conversations/attachment_service_1`,
        checksumSha256: "a".repeat(64),
      },
    ],
    occurredAt: timestamp,
  };
}
