import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-07-30T16:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des événements email OS-2", () => {
  it("crée les deux tables minimales et enregistre leurs migrations RLS", async () => {
    expect(getMigrationIds()).toContain("071_os2_email_provider_events");
    expect(getMigrationIds(true)).toEqual(
      expect.arrayContaining([
        "071_os2_email_provider_events",
        "072_os2_email_provider_events_rls",
      ]),
    );

    const db = await createMemoryDb();
    opened.push(db);
    const tables = await db.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name like 'email_provider_%'
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "email_provider_deliveries",
      "email_provider_events",
    ]);

    const unsafeColumns = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name like 'email_provider_%'
         and column_name in (
           'raw_body', 'raw_payload', 'payload', 'recipient_email', 'subject',
           'bounce_message'
         )`,
    );
    expect(unsafeColumns.rows).toEqual([]);
  });

  it("impose tenant, email fournisseur et événement externe sans doublon", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedTenantAndInvitation(db, "tenant_a", "invitation_a");
    await seedTenantAndInvitation(db, "tenant_b", "invitation_b");
    await seedDelivery(db, "tenant_a", "delivery_a", "invitation_a", "email_a");
    await seedDelivery(db, "tenant_b", "delivery_b", "invitation_b", "email_b");

    await expect(
      seedDelivery(
        db,
        "tenant_a",
        "delivery_cross",
        "invitation_b",
        "email_cross",
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      seedDelivery(
        db,
        "tenant_b",
        "delivery_duplicate_provider",
        "invitation_b",
        "email_a",
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    await seedEvent(
      db,
      "tenant_a",
      "event_a",
      "delivery_a",
      "svix_event_shared",
      "email_a",
    );
    await expect(
      seedEvent(
        db,
        "tenant_b",
        "event_duplicate",
        "delivery_b",
        "svix_event_shared",
        "email_b",
      ),
    ).rejects.toThrow(/unique|duplicate/i);
    await expect(
      seedEvent(
        db,
        "tenant_a",
        "event_cross",
        "delivery_b",
        "svix_event_cross",
        "email_b",
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      seedEvent(
        db,
        "tenant_a",
        "event_wrong_email",
        "delivery_a",
        "svix_event_wrong_email",
        "email_b",
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("refuse les références fournisseur non bornées", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedTenantAndInvitation(db, "tenant_a", "invitation_a");

    await expect(
      db.query(
        `insert into email_provider_deliveries (
           id, tenant_id, source_type, source_id, provider,
           provider_message_id, recipient_hash, status, last_event_at,
           created_at, updated_at
         ) values ($1, $2, 'invitation', $3, 'resend', $4, $5, 'sent',
           '2026-07-30T15:59:00.000Z', $6, $6)`,
        [
          "delivery_invalid",
          "tenant_a",
          "invitation_a",
          "x".repeat(257),
          "not-a-hash",
          timestamp,
        ],
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedTenantAndInvitation(
  db: TestDb,
  tenantId: string,
  invitationId: string,
) {
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [tenantId, `Organisation ${tenantId}`, timestamp],
  );
  await db.query(
    `insert into invitations (
       id, tenant_id, email, role, status, token_hash, expires_at, created_at
     ) values ($1, $2, $3, 'manager', 'pending', $4,
       '2026-08-06T16:00:00.000Z', $5)`,
    [
      invitationId,
      tenantId,
      `${tenantId}@example.test`,
      "a".repeat(64),
      timestamp,
    ],
  );
}

async function seedDelivery(
  db: TestDb,
  tenantId: string,
  deliveryId: string,
  invitationId: string,
  providerMessageId: string,
) {
  await db.query(
    `insert into email_provider_deliveries (
       id, tenant_id, source_type, source_id, provider, provider_message_id,
       recipient_hash, status, last_event_at, created_at, updated_at
     ) values ($1, $2, 'invitation', $3, 'resend', $4, $5, 'sent', $6, $6, $6)`,
    [
      deliveryId,
      tenantId,
      invitationId,
      providerMessageId,
      "b".repeat(64),
      timestamp,
    ],
  );
}

async function seedEvent(
  db: TestDb,
  tenantId: string,
  eventId: string,
  deliveryId: string,
  externalEventId: string,
  providerMessageId: string,
) {
  await db.query(
    `insert into email_provider_events (
       id, tenant_id, delivery_id, provider, external_event_id,
       provider_message_id, event_type, delivery_status, occurred_at, received_at
     ) values ($1, $2, $3, 'resend', $4, $5, 'email.delivered',
       'delivered', $6, $6)`,
    [
      eventId,
      tenantId,
      deliveryId,
      externalEventId,
      providerMessageId,
      timestamp,
    ],
  );
}
