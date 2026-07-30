import { Webhook } from "svix";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import {
  receivePreparedResendWebhook,
  recordAuthorizedResendDelivery,
} from "../src/modules/email";

const signingSecret = "whsec_dHJhZGlrb20tb25lLXdlYmhvb2stdGVzdA==";
const sentAt = "2026-07-30T16:00:00.000Z";
const recipientA = "destinataire.prive@example.test";
const recipientB = "destinataire.b@example.test";
const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("persistance préparée des événements Resend", () => {
  it("réserve une livraison tenant-aware sans conserver le destinataire", async () => {
    const db = await setup();
    const input = {
      tenantId: "tenant_email_a",
      actorId: "user_email_a",
      invitationId: "invitation_email_a",
      recipient: "Destinataire.Prive@Example.Test",
      providerMessageId: "provider_email_a",
      occurredAt: sentAt,
    };

    const created = await recordAuthorizedResendDelivery(db, input);
    const replayed = await recordAuthorizedResendDelivery(db, input);

    expect(created).toMatchObject({ status: "sent", replayed: false });
    expect(replayed).toEqual({ ...created, replayed: true });

    const rows = await db.query<Record<string, unknown>>(
      "select * from email_provider_deliveries where tenant_id = $1",
      [input.tenantId],
    );
    expect(rows.rows).toHaveLength(1);
    const serialized = JSON.stringify(rows.rows);
    expect(serialized).not.toContain(input.recipient);
    expect(serialized).not.toContain(input.recipient.toLowerCase());
    expect(serialized).toContain("recipient_hash");

    const audits = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'email.provider_delivery_recorded'`,
      [input.tenantId],
    );
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows)).not.toContain(input.recipient);
  });

  it("refuse un rôle insuffisant et une référence fournisseur inter-tenant", async () => {
    const db = await setup();
    await expect(
      recordAuthorizedResendDelivery(db, {
        tenantId: "tenant_email_a",
        actorId: "user_email_read_only",
        invitationId: "invitation_email_a",
        recipient: recipientA,
        providerMessageId: "provider_denied",
        occurredAt: sentAt,
      }),
    ).rejects.toMatchObject({
      code: "email_provider_access_denied",
    });
    await expect(
      recordAuthorizedResendDelivery(db, {
        tenantId: "tenant_email_a",
        actorId: "user_email_a",
        invitationId: "invitation_email_a",
        recipient: "autre-destinataire@example.test",
        providerMessageId: "provider_wrong_recipient",
        occurredAt: sentAt,
      }),
    ).rejects.toMatchObject({
      code: "email_provider_delivery_conflict",
    });

    await recordAuthorizedResendDelivery(db, {
      tenantId: "tenant_email_a",
      actorId: "user_email_a",
      invitationId: "invitation_email_a",
      recipient: recipientA,
      providerMessageId: "provider_shared",
      occurredAt: sentAt,
    });
    await expect(
      recordAuthorizedResendDelivery(db, {
        tenantId: "tenant_email_b",
        actorId: "user_email_b",
        invitationId: "invitation_email_b",
        recipient: recipientB,
        providerMessageId: "provider_shared",
        occurredAt: sentAt,
      }),
    ).rejects.toMatchObject({
      code: "email_provider_delivery_conflict",
    });
  });

  it("vérifie, persiste et rejoue un événement sans dupliquer l'audit", async () => {
    const db = await setup();
    const delivery = await recordAuthorizedResendDelivery(db, {
      tenantId: "tenant_email_a",
      actorId: "user_email_a",
      invitationId: "invitation_email_a",
      recipient: recipientA,
      providerMessageId: "provider_delivery_webhook",
      occurredAt: sentAt,
    });
    const input = signedWebhook({
      id: "svix_delivery_webhook",
      tenantId: "tenant_email_a",
      providerMessageId: "provider_delivery_webhook",
      eventType: "email.delivered",
      occurredAt: "2026-07-30T16:05:00.000Z",
    });

    const accepted = await receivePreparedResendWebhook(
      db,
      input,
      signingSecret,
    );
    const replayed = await receivePreparedResendWebhook(
      db,
      input,
      signingSecret,
    );

    expect(accepted).toEqual({
      accepted: true,
      replayed: false,
      stateUpdated: true,
      deliveryId: delivery.deliveryId,
      status: "delivered",
    });
    expect(replayed).toEqual({
      accepted: true,
      replayed: true,
      stateUpdated: false,
      deliveryId: delivery.deliveryId,
      status: "delivered",
    });

    expect(await count(db, "email_provider_events", "tenant_email_a")).toBe(1);
    const audits = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'email.provider_event_received'`,
      ["tenant_email_a"],
    );
    expect(audits.rows).toHaveLength(1);
    expect(JSON.stringify(audits.rows)).not.toContain("destinataire");
  });

  it("persiste un événement tardif sans faire régresser l'état", async () => {
    const db = await setup();
    const delivery = await recordAuthorizedResendDelivery(db, {
      tenantId: "tenant_email_a",
      actorId: "user_email_a",
      invitationId: "invitation_email_a",
      recipient: recipientA,
      providerMessageId: "provider_late",
      occurredAt: sentAt,
    });
    await receivePreparedResendWebhook(
      db,
      signedWebhook({
        id: "svix_delivered_first",
        tenantId: "tenant_email_a",
        providerMessageId: "provider_late",
        eventType: "email.delivered",
        occurredAt: "2026-07-30T16:10:00.000Z",
      }),
      signingSecret,
    );

    const late = await receivePreparedResendWebhook(
      db,
      signedWebhook({
        id: "svix_sent_late",
        tenantId: "tenant_email_a",
        providerMessageId: "provider_late",
        eventType: "email.sent",
        occurredAt: "2026-07-30T16:01:00.000Z",
      }),
      signingSecret,
    );

    expect(late).toEqual({
      accepted: true,
      replayed: false,
      stateUpdated: false,
      deliveryId: delivery.deliveryId,
      status: "delivered",
    });
    expect(await count(db, "email_provider_events", "tenant_email_a")).toBe(2);
  });

  it("refuse un mapping tenant absent et un svix-id réutilisé autrement", async () => {
    const db = await setup();
    await recordAuthorizedResendDelivery(db, {
      tenantId: "tenant_email_a",
      actorId: "user_email_a",
      invitationId: "invitation_email_a",
      recipient: recipientA,
      providerMessageId: "provider_conflict",
      occurredAt: sentAt,
    });

    const wrongTenant = await receivePreparedResendWebhook(
      db,
      signedWebhook({
        id: "svix_wrong_tenant",
        tenantId: "tenant_email_b",
        providerMessageId: "provider_conflict",
        eventType: "email.delivered",
        occurredAt: "2026-07-30T16:05:00.000Z",
      }),
      signingSecret,
    );
    expect(wrongTenant).toEqual({
      accepted: false,
      code: "email_provider_delivery_not_found",
    });

    const first = signedWebhook({
      id: "svix_reused_differently",
      tenantId: "tenant_email_a",
      providerMessageId: "provider_conflict",
      eventType: "email.delivered",
      occurredAt: "2026-07-30T16:05:00.000Z",
    });
    await receivePreparedResendWebhook(db, first, signingSecret);
    const conflict = await receivePreparedResendWebhook(
      db,
      signedWebhook({
        id: "svix_reused_differently",
        tenantId: "tenant_email_a",
        providerMessageId: "provider_conflict",
        eventType: "email.failed",
        occurredAt: "2026-07-30T16:06:00.000Z",
      }),
      signingSecret,
    );
    expect(conflict).toEqual({
      accepted: false,
      code: "email_provider_event_conflict",
    });
    expect(await count(db, "email_provider_events", "tenant_email_a")).toBe(1);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  await seedTenant(db, "tenant_email_a", "user_email_a", "invitation_email_a");
  await seedTenant(db, "tenant_email_b", "user_email_b", "invitation_email_b");
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, 'Lecture seule', 'lecture@example.test', 'hash', $2)`,
    ["user_email_read_only", sentAt],
  );
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ('tenant_email_a', $1, 'read-only', $2)`,
    ["user_email_read_only", sentAt],
  );
  return db;
}

async function seedTenant(
  db: TestDb,
  tenantId: string,
  userId: string,
  invitationId: string,
) {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [userId, `Propriétaire ${tenantId}`, `${userId}@example.test`, sentAt],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [tenantId, `Organisation ${tenantId}`, sentAt],
  );
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, 'owner', $3)`,
    [tenantId, userId, sentAt],
  );
  await db.query(
    `insert into invitations (
       id, tenant_id, email, role, status, token_hash, expires_at, created_at
     ) values ($1, $2, $3, 'manager', 'pending', $4,
       '2026-08-06T16:00:00.000Z', $5)`,
    [
      invitationId,
      tenantId,
      tenantId === "tenant_email_a" ? recipientA : recipientB,
      "a".repeat(64),
      sentAt,
    ],
  );
}

function signedWebhook(input: {
  id: string;
  tenantId: string;
  providerMessageId: string;
  eventType: string;
  occurredAt: string;
}) {
  const rawBody = JSON.stringify({
    type: input.eventType,
    created_at: input.occurredAt,
    data: {
      email_id: input.providerMessageId,
      to: ["donnee-privee@example.test"],
      subject: "Sujet privé",
      tags: {
        tradikom_tenant: input.tenantId,
        tradikom_kind: "team_invitation",
      },
    },
  });
  const timestamp = new Date();
  return {
    rawBody,
    headers: {
      id: input.id,
      timestamp: String(Math.floor(timestamp.getTime() / 1_000)),
      signature: new Webhook(signingSecret).sign(
        input.id,
        timestamp,
        rawBody,
      ),
    },
  };
}

async function count(db: TestDb, table: string, tenantId: string) {
  const allowedTables = new Set([
    "email_provider_deliveries",
    "email_provider_events",
  ]);
  if (!allowedTables.has(table)) throw new Error("Table de test invalide.");
  const result = await db.query<{ count: number | string }>(
    `select count(*)::int as count from ${table} where tenant_id = $1`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
