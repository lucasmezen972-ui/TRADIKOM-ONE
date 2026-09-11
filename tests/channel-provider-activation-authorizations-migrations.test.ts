import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds, migrate } from "../src/lib/db";
import { hashToken } from "../src/lib/security";
import { reserveWhatsAppOutboundDelivery } from "../src/modules/channels";

const opened: Array<{ close: () => Promise<void> }> = [];
const authorizedAt = "2026-08-08T16:00:00.000Z";
const expiresAt = "2026-08-08T17:00:00.000Z";
const revokedAt = "2026-08-08T16:30:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des autorisations d'activation OS-5", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    for (const [constant, path] of [
      [
        "os5ChannelProviderActivationAuthorizationsMigrationSql",
        "../src/db/migrations/0089_os5_channel_provider_activation_authorizations.sql",
      ],
      [
        "os5ChannelProviderActivationAuthorizationsRlsMigrationSql",
        "../src/db/migrations/0090_os5_channel_provider_activation_authorizations_rls.sql",
      ],
      [
        "os5WhatsAppMetaTrialAuthorizationMigrationSql",
        "../src/db/migrations/0109_os5_whatsapp_meta_trial_authorization.sql",
      ],
    ] as const) {
      const mirror = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(extractSqlTemplate(runtime, constant).trim()).toBe(mirror.trim());
    }
    expect(getMigrationIds()).toContain(
      "095_os5_channel_provider_activation_authorizations",
    );
    expect(getMigrationIds(true)).toContain(
      "096_os5_channel_provider_activation_authorizations_rls",
    );
    expect(getMigrationIds()).toContain(
      "115_os5_whatsapp_meta_trial_authorization",
    );
  });

  it("met à niveau une base existante et borne Meta à un message", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, {
      targetMigrationId: "112_os5_conversation_thread_access_grants",
    });
    await seedMetaAuthorizationContext(db, "upgrade");
    const legacyDeliveryContext = await seedMetaDeliveryContext(db, "upgrade");
    await insertLegacyMetaDelivery(db, {
      id: "delivery_meta_legacy_reserved",
      tenantId: "tenant_upgrade",
      endpointId: "endpoint_meta_upgrade",
      messageId: legacyDeliveryContext.messageId,
      channelIdentityId: legacyDeliveryContext.customerIdentityId,
      status: "reserved",
    });
    await insertLegacyMetaDelivery(db, {
      id: "delivery_meta_legacy_retryable",
      tenantId: "tenant_upgrade",
      endpointId: "endpoint_meta_upgrade",
      messageId: legacyDeliveryContext.messageId,
      channelIdentityId: legacyDeliveryContext.customerIdentityId,
      status: "failed",
    });
    await insertLegacyMetaDelivery(db, {
      id: "delivery_meta_legacy_accepted",
      tenantId: "tenant_upgrade",
      endpointId: "endpoint_meta_upgrade",
      messageId: legacyDeliveryContext.messageId,
      channelIdentityId: legacyDeliveryContext.customerIdentityId,
      status: "accepted",
    });

    await expect(
      insertMetaAuthorization(db, {
        id: "authorization_meta_before_upgrade",
        tenantId: "tenant_upgrade",
        endpointId: "endpoint_meta_upgrade",
        maxMessages: 1,
        idempotencyHash: "d".repeat(64),
      }),
    ).rejects.toThrow(/check|violates/i);

    await migrate(db);
    const terminalizedDeliveries = await db.query<{
      id: string;
      status: string;
      failure_classification: string | null;
      safe_error_code: string | null;
      retryable: boolean | number | null;
      activation_authorization_id: string | null;
    }>(
      `select id, status, failure_classification, safe_error_code, retryable,
              activation_authorization_id
         from channel_provider_deliveries
        where id in ('delivery_meta_legacy_reserved', 'delivery_meta_legacy_retryable')
        order by id`,
    );
    expect(terminalizedDeliveries.rows).toEqual([
      {
        id: "delivery_meta_legacy_reserved",
        status: "denied",
        failure_classification: "policy",
        safe_error_code: "meta_trial_authorization_required",
        retryable: false,
        activation_authorization_id: null,
      },
      {
        id: "delivery_meta_legacy_retryable",
        status: "denied",
        failure_classification: "policy",
        safe_error_code: "meta_trial_authorization_required",
        retryable: false,
        activation_authorization_id: null,
      },
    ]);
    expect(
      (
        await db.query<{
          status: string;
          external_message_id: string | null;
          request_fingerprint: string;
          activation_authorization_id: string | null;
        }>(
          `select status, external_message_id, request_fingerprint,
                  activation_authorization_id
             from channel_provider_deliveries
            where id = 'delivery_meta_legacy_accepted'`,
        )
      ).rows,
    ).toEqual([
      {
        status: "accepted",
        external_message_id: "wamid.delivery_meta_legacy_accepted",
        request_fingerprint: hashToken("legacy-delivery_meta_legacy_accepted"),
        activation_authorization_id: null,
      },
    ]);
    expect(
      (
        await db.query<{ status: string; safe_error_code: string | null }>(
          `select status, safe_error_code
             from conversation_messages
            where id = $1`,
          [legacyDeliveryContext.messageId],
        )
      ).rows,
    ).toEqual([
      {
        status: "failed",
        safe_error_code: "meta_trial_authorization_required",
      },
    ]);
    await insertMetaAuthorization(db, {
      id: "authorization_meta_after_upgrade",
      tenantId: "tenant_upgrade",
      endpointId: "endpoint_meta_upgrade",
      maxMessages: 1,
      idempotencyHash: "e".repeat(64),
    });
    expect(
      (
        await db.query<{ provider: string; max_messages: number }>(
          `select provider, max_messages
           from channel_provider_activation_authorizations
           where id = 'authorization_meta_after_upgrade'`,
        )
      ).rows,
    ).toEqual([{ provider: "whatsapp_meta", max_messages: 1 }]);
    const deliveryColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_deliveries'
         and column_name = 'activation_authorization_id'`,
    );
    expect(deliveryColumns.rows).toEqual([
      { column_name: "activation_authorization_id" },
    ]);
  });

  it("préserve la contrainte historique si une liaison legacy incohérente bloque la mise à niveau", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, {
      targetMigrationId: "112_os5_conversation_thread_access_grants",
    });
    await seedMetaAuthorizationContext(db, "legacy");
    await insertAuthorization(db, {
      id: "authorization_twilio_on_meta_legacy",
      tenantId: "tenant_legacy",
      endpointId: "endpoint_meta_legacy",
      maxMessages: 1,
      idempotencyHash: "9".repeat(64),
    });

    await expect(migrate(db)).rejects.toThrow(/foreign key|violates/i);
    const constraintsAfterFailure = await db.query<{ conname: string }>(
      `select conname from pg_constraint
       where conrelid = 'channel_provider_activation_authorizations'::regclass`,
    );
    expect(constraintsAfterFailure.rows.map((row) => row.conname)).toContain(
      "channel_provider_activation_authoriz_tenant_id_endpoint_id_fkey",
    );
    expect(
      (
        await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public'
             and table_name = 'channel_provider_deliveries'
             and column_name = 'activation_authorization_id'`,
        )
      ).rows,
    ).toEqual([]);
    await expect(
      insertMetaAuthorization(db, {
        id: "authorization_meta_during_failed_upgrade",
        tenantId: "tenant_legacy",
        endpointId: "endpoint_meta_legacy",
        maxMessages: 1,
        idempotencyHash: "8".repeat(64),
      }),
    ).rejects.toThrow(/check|violates/i);

    await db.query(
      `delete from channel_provider_activation_authorizations
       where id = 'authorization_twilio_on_meta_legacy'`,
    );
    await migrate(db);
    const constraintsAfterRecovery = await db.query<{ conname: string }>(
      `select conname from pg_constraint
       where conrelid = 'channel_provider_activation_authorizations'::regclass`,
    );
    expect(constraintsAfterRecovery.rows.map((row) => row.conname)).toContain(
      "channel_activation_auth_endpoint_fkey",
    );
    expect(constraintsAfterRecovery.rows.map((row) => row.conname)).not.toContain(
      "channel_provider_activation_authoriz_tenant_id_endpoint_id_fkey",
    );
  });

  it("couple strictement fournisseur, endpoint, portée et plafond Meta", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedAuthorizationContext(db, "a");
    await seedMetaAuthorizationContext(db, "meta");

    await insertMetaAuthorization(db, {
      id: "authorization_meta_valid",
      tenantId: "tenant_meta",
      endpointId: "endpoint_meta_meta",
      maxMessages: 1,
      idempotencyHash: "f".repeat(64),
    });
    await insertMetaAuthorization(db, {
      id: "authorization_meta_same_endpoint_other",
      tenantId: "tenant_meta",
      endpointId: "endpoint_meta_meta",
      maxMessages: 1,
      idempotencyHash: "7".repeat(64),
    });
    await insertAuthorization(db, {
      id: "authorization_twilio_other_tenant",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      maxMessages: 1,
      idempotencyHash: "4".repeat(64),
    });
    const deliveryContext = await seedMetaDeliveryContext(db, "meta");
    const reservation = await reserveWhatsAppOutboundDelivery(db, {
      id: "delivery_meta_authorized",
      tenantId: "tenant_meta",
      endpointId: "endpoint_meta_meta",
      messageId: deliveryContext.messageId,
      channelIdentityId: deliveryContext.customerIdentityId,
      idempotencyKey: "delivery-meta-authorized",
      requestFingerprint: hashToken("delivery-meta-authorized"),
      actorId: "user_meta",
      occurredAt: authorizedAt,
      maxAttempts: 1,
      activationAuthorizationId: "authorization_meta_valid",
      provider: "whatsapp_meta",
    });
    expect(reservation.row).toMatchObject({
      activation_authorization_id: "authorization_meta_valid",
    });
    await expect(
      db.query(
        `insert into channel_provider_activation_consumptions (
           id, tenant_id, provider, endpoint_id, authorization_id,
           delivery_id, consumed_by, consumed_at
         ) values (
           'consumption_meta_wrong_binding', 'tenant_meta', 'whatsapp_meta',
           'endpoint_meta_meta', 'authorization_meta_same_endpoint_other',
           'delivery_meta_authorized', 'user_meta', $1
         )`,
        [authorizedAt],
      ),
    ).rejects.toThrow(/channel_provider_activation_budget_invalid/i);
    await expect(
      db.query(
        `update channel_provider_deliveries
         set activation_authorization_id = null
         where id = 'delivery_meta_authorized'`,
      ),
    ).rejects.toThrow(/activation_authorization_immutable/i);
    await expect(
      reserveWhatsAppOutboundDelivery(db, {
        id: "delivery_meta_cross_authorization",
        tenantId: "tenant_meta",
        endpointId: "endpoint_meta_meta",
        messageId: deliveryContext.messageId,
        channelIdentityId: deliveryContext.customerIdentityId,
        idempotencyKey: "delivery-meta-cross-authorization",
        requestFingerprint: hashToken("delivery-meta-cross-authorization"),
        actorId: "user_meta",
        occurredAt: authorizedAt,
        maxAttempts: 1,
        activationAuthorizationId: "authorization_twilio_other_tenant",
        provider: "whatsapp_meta",
      }),
    ).rejects.toThrow(/foreign key|violates/i);
    const deliveryAuthorizationConstraint = await db.query<{
      definition: string;
    }>(
      `select pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conname = 'channel_delivery_activation_auth_fkey'`,
    );
    expect(deliveryAuthorizationConstraint.rows[0]?.definition).toMatch(
      /FOREIGN KEY \(tenant_id, activation_authorization_id, provider, endpoint_id\)/i,
    );
    await expect(
      insertMetaAuthorization(db, {
        id: "authorization_meta_over_limit",
        tenantId: "tenant_meta",
        endpointId: "endpoint_meta_meta",
        maxMessages: 2,
        idempotencyHash: "1".repeat(64),
      }),
    ).rejects.toThrow(/check|violates/i);
    await expect(
      insertMetaAuthorization(db, {
        id: "authorization_meta_twilio_endpoint",
        tenantId: "tenant_a",
        endpointId: "endpoint_a",
        maxMessages: 1,
        idempotencyHash: "2".repeat(64),
      }),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      db.query(
        `insert into channel_provider_activation_authorizations (
           id, tenant_id, provider, endpoint_id, authorization_scope,
           max_messages, free_units_confirmed, idempotency_key_hash,
           authorized_by, authorized_at, expires_at, revoked_at, revoked_by
         ) values (
           'authorization_meta_wrong_scope', 'tenant_meta', 'whatsapp_meta',
           'endpoint_meta_meta', 'twilio_whatsapp_sandbox', 1, true, $1,
           'user_meta', $2, $3, null, null
         )`,
        ["3".repeat(64), authorizedAt, expiresAt],
      ),
    ).rejects.toThrow(/check|violates/i);
  });

  it("crée une preuve tenant-scoped sans colonne sensible et supporte une base déjà migrée", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'channel_provider_activation_authorizations'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "tenant_id",
      "provider",
      "endpoint_id",
      "authorization_scope",
      "max_messages",
      "free_units_confirmed",
      "idempotency_key_hash",
      "authorized_by",
      "authorized_at",
      "expires_at",
      "revoked_at",
      "revoked_by",
    ]);
    expect(JSON.stringify(columns.rows)).not.toMatch(
      /secret|token|account_sid|phone|number|address|url|body|content|ciphertext/i,
    );

    await seedAuthorizationContext(db, "a");
    await insertAuthorization(db, {
      id: "authorization_a",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      maxMessages: 2,
      idempotencyHash: "a".repeat(64),
    });
    await migrate(db);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from channel_provider_activation_authorizations",
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it("impose relations composées, portée Sandbox et plafond de deux messages", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedAuthorizationContext(db, "a");
    await seedAuthorizationContext(db, "b");

    await expect(
      insertAuthorization(db, {
        id: "authorization_cross",
        tenantId: "tenant_a",
        endpointId: "endpoint_b",
        maxMessages: 1,
        idempotencyHash: "a".repeat(64),
      }),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      insertAuthorization(db, {
        id: "authorization_over_limit",
        tenantId: "tenant_a",
        endpointId: "endpoint_a",
        maxMessages: 3,
        idempotencyHash: "b".repeat(64),
      }),
    ).rejects.toThrow(/check|violates/i);
    await expect(
      db.query(
        `insert into channel_provider_activation_authorizations (
           id, tenant_id, provider, endpoint_id, authorization_scope,
           max_messages, free_units_confirmed, idempotency_key_hash,
           authorized_by, authorized_at, expires_at, revoked_at, revoked_by
         ) values (
           'authorization_wrong_scope', 'tenant_a', 'whatsapp_twilio',
           'endpoint_a', 'production', 1, true, $1, 'user_a', $2, $3,
           null, null
         )`,
        ["c".repeat(64), authorizedAt, expiresAt],
      ),
    ).rejects.toThrow(/check|violates/i);
  });

  it("rend la preuve immuable, la révocation monotone et la suppression tenant transactionnelle", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedAuthorizationContext(db, "a");
    await insertAuthorization(db, {
      id: "authorization_a",
      tenantId: "tenant_a",
      endpointId: "endpoint_a",
      maxMessages: 2,
      idempotencyHash: "a".repeat(64),
    });

    await expect(
      db.query(
        `update channel_provider_activation_authorizations
         set max_messages = 1 where id = 'authorization_a'`,
      ),
    ).rejects.toThrow(/immutable/i);
    await db.query(
      `update channel_provider_activation_authorizations
       set revoked_at = $1, revoked_by = 'user_a'
       where id = 'authorization_a'`,
      [revokedAt],
    );
    await expect(
      db.query(
        `update channel_provider_activation_authorizations
         set revoked_at = null, revoked_by = null
         where id = 'authorization_a'`,
      ),
    ).rejects.toThrow(/immutable/i);

    await db.query("delete from tenants where id = 'tenant_a'");
    expect(
      (
        await db.query(
          "select id from channel_provider_activation_authorizations where id = 'authorization_a'",
        )
      ).rows,
    ).toEqual([]);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedAuthorizationContext(db: TestDb, suffix: "a" | "b") {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [
      `user_${suffix}`,
      `Utilisateur ${suffix}`,
      `activation-${suffix}@example.test`,
      authorizedAt,
    ],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [`tenant_${suffix}`, `Organisation ${suffix}`, authorizedAt],
  );
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_twilio', $3, $4, 'active', $5, $6, $6)`,
    [
      `endpoint_${suffix}`,
      `tenant_${suffix}`,
      `AC${suffix.repeat(32)}`,
      suffix.repeat(64),
      `user_${suffix}`,
      authorizedAt,
    ],
  );
}

async function seedMetaAuthorizationContext(db: TestDb, suffix: string) {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [
      `user_${suffix}`,
      `Utilisateur Meta ${suffix}`,
      `activation-meta-${suffix}@example.test`,
      authorizedAt,
    ],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [`tenant_${suffix}`, `Organisation Meta ${suffix}`, authorizedAt],
  );
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_meta', $3, $4, 'active', $5, $6, $6)`,
    [
      `endpoint_meta_${suffix}`,
      `tenant_${suffix}`,
      `waba_${suffix}`,
      "4".repeat(64),
      `user_${suffix}`,
      authorizedAt,
    ],
  );
}

async function seedMetaDeliveryContext(db: TestDb, suffix: string) {
  const tenantId = `tenant_${suffix}`;
  const customerParticipantId = `participant_meta_delivery_customer_${suffix}`;
  const systemParticipantId = `participant_meta_delivery_system_${suffix}`;
  const customerIdentityId = `identity_meta_delivery_customer_${suffix}`;
  const systemIdentityId = `identity_meta_delivery_system_${suffix}`;
  const threadId = `thread_meta_delivery_${suffix}`;
  const messageId = `message_meta_delivery_${suffix}`;
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values
       ($1, $2, 'customer', null, $3, $3),
       ($4, $2, 'system', null, $3, $3)`,
    [customerParticipantId, tenantId, authorizedAt, systemParticipantId],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values
       ($1, $2, $3, 'messaging', 'whatsapp-meta', $4, null,
        'customer', 'active', $5, $5),
       ($6, $2, $7, 'web', 'web-chat', $8, null,
        'system', 'active', $5, $5)`,
    [
      customerIdentityId,
      tenantId,
      customerParticipantId,
      `meta_delivery_customer_${suffix}`,
      authorizedAt,
      systemIdentityId,
      systemParticipantId,
      `meta_delivery_system_${suffix}`,
    ],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, tenantId, authorizedAt],
  );
  await db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $3, $4), ($1, $2, $5, $4)`,
    [tenantId, threadId, customerIdentityId, authorizedAt, systemIdentityId],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'outbound', 'result', 'pending', 'Preuve migration',
       'web-chat', null, $5, $6, null, null, $7, $7
     )`,
    [
      messageId,
      tenantId,
      threadId,
      systemIdentityId,
      `canonical:${messageId}`,
      `correlation:${messageId}`,
      authorizedAt,
    ],
  );
  return { messageId, customerIdentityId };
}

async function insertAuthorization(
  db: TestDb,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    maxMessages: number;
    idempotencyHash: string;
  },
) {
  return db.query(
    `insert into channel_provider_activation_authorizations (
       id, tenant_id, provider, endpoint_id, authorization_scope,
       max_messages, free_units_confirmed, idempotency_key_hash,
       authorized_by, authorized_at, expires_at, revoked_at, revoked_by
     ) values (
       $1, $2, 'whatsapp_twilio', $3, 'twilio_whatsapp_sandbox',
       $4, true, $5, $6, $7, $8, null, null
     )`,
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.maxMessages,
      input.idempotencyHash,
      `user_${input.tenantId.slice("tenant_".length)}`,
      authorizedAt,
      expiresAt,
    ],
  );
}

async function insertMetaAuthorization(
  db: TestDb,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    maxMessages: number;
    idempotencyHash: string;
  },
) {
  return db.query(
    `insert into channel_provider_activation_authorizations (
       id, tenant_id, provider, endpoint_id, authorization_scope,
       max_messages, free_units_confirmed, idempotency_key_hash,
       authorized_by, authorized_at, expires_at, revoked_at, revoked_by
     ) values (
       $1, $2, 'whatsapp_meta', $3, 'meta_whatsapp_trial',
       $4, true, $5, $6, $7, $8, null, null
     )`,
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.maxMessages,
      input.idempotencyHash,
      `user_${input.tenantId.slice("tenant_".length)}`,
      authorizedAt,
      expiresAt,
    ],
  );
}

async function insertLegacyMetaDelivery(
  db: TestDb,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    messageId: string;
    channelIdentityId: string;
    status: "reserved" | "accepted" | "failed";
  },
) {
  const failed = input.status === "failed";
  const accepted = input.status === "accepted";
  await db.query(
    `insert into channel_provider_deliveries (
       id, tenant_id, provider, endpoint_id, message_id, channel_identity_id,
       idempotency_key, request_fingerprint, status, external_message_id,
       failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, created_by, created_at, updated_at
     ) values (
       $1, $2, 'whatsapp_meta', $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, 3, $14, $15, null, null, $16, $14, $14
     )`,
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.messageId,
      input.channelIdentityId,
      `legacy-${input.id}`,
      hashToken(`legacy-${input.id}`),
      input.status,
      accepted ? `wamid.${input.id}` : null,
      failed ? "temporary" : null,
      failed ? "provider_temporarily_unavailable" : null,
      failed ? true : accepted ? false : null,
      failed || accepted ? 1 : 0,
      authorizedAt,
      failed || accepted ? authorizedAt : null,
      `user_${input.tenantId.slice("tenant_".length)}`,
    ],
  );
}

function extractSqlTemplate(source: string, constantName: string) {
  const start = source.indexOf(`const ${constantName} = \``);
  if (start < 0) throw new Error(`Constante absente: ${constantName}`);
  const bodyStart = source.indexOf("`", start) + 1;
  const bodyEnd = source.indexOf("`;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}
