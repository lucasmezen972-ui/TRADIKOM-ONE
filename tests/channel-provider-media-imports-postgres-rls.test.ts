import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const timestamp = "2026-09-02T20:30:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des réservations média fournisseur", () => {
  it("isole lecture, insertion, mise à jour et suppression par tenant", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const fixtureA = await seedReservation(ownerDb, "a");
    const fixtureB = await seedReservation(ownerDb, "b");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    expect(
      (await restrictedPool.query("select id from channel_provider_media_imports"))
        .rows,
    ).toEqual([]);
    const ownRows = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_media_imports order by id",
        ),
    );
    expect(ownRows.rows).toEqual([{ id: fixtureA.reservationId }]);
    const crossRows = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          "select id from channel_provider_media_imports where id = $1",
          [fixtureB.reservationId],
        ),
    );
    expect(crossRows.rows).toEqual([]);
    const crossUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `update channel_provider_media_imports
           set reservation_status = 'failed',
               encrypted_provider_reference = null,
               key_version = null,
               safe_error_code = 'media_reference_encryption_failed'
           where tenant_id = $1 and id = $2 returning id`,
          [fixtureB.tenantId, fixtureB.reservationId],
        ),
    );
    expect(crossUpdate.rows).toEqual([]);
    const crossDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) =>
        client.query<{ id: string }>(
          `delete from channel_provider_media_imports
           where tenant_id = $1 and id = $2 returning id`,
          [fixtureB.tenantId, fixtureB.reservationId],
        ),
    );
    expect(crossDelete.rows).toEqual([]);
    await expect(
      withTenantContext(restrictedPool, fixtureA.tenantId, (client) =>
        client.query(
          `insert into channel_provider_media_imports (
             id, tenant_id, provider, endpoint_id, message_id, media_kind,
             reservation_status, encrypted_provider_reference, key_version,
             request_fingerprint, safe_error_code, created_at, updated_at
           ) values (
             'reservation_rls_cross', $1, 'whatsapp_meta', $2, $3,
             'document', 'pending', $4, 'media-test-v1', $5, null, $6, $6
           )`,
          [
            fixtureB.tenantId,
            fixtureB.endpointId,
            fixtureB.messageId,
            `encrypted-${"z".repeat(80)}`,
            "f".repeat(64),
            timestamp,
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("isole aussi le journal durable des exécutions média", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const fixtureA = await seedReservation(ownerDb, "a");
    const fixtureB = await seedReservation(ownerDb, "b");
    await seedExecution(ownerDb, fixtureA, "a");
    await seedExecution(ownerDb, fixtureB, "b");

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    const ownRows = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) => client.query<{ id: string }>(
        "select id from channel_provider_media_import_executions order by id",
      ),
    );
    expect(ownRows.rows).toEqual([{ id: `execution_media_rls_a_${fixtureA.unique}` }]);
    const crossUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) => client.query(
        `update channel_provider_media_import_executions
         set updated_at = $1
         where tenant_id = $2 and media_import_id = $3 returning id`,
        [timestamp, fixtureB.tenantId, fixtureB.reservationId],
      ),
    );
    expect(crossUpdate.rows).toEqual([]);
    const crossDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      (client) => client.query(
        `delete from channel_provider_media_import_executions
         where tenant_id = $1 and media_import_id = $2 returning id`,
        [fixtureB.tenantId, fixtureB.reservationId],
      ),
    );
    expect(crossDelete.rows).toEqual([]);
    await expect(
      withTenantContext(restrictedPool, fixtureA.tenantId, (client) =>
        client.query(
          `insert into channel_provider_media_import_executions (
             id, tenant_id, media_import_id, provider, provider_mode,
             scanner_mode, storage_mode, status, failure_classification, safe_error_code,
             retryable, attempts, max_attempts, next_attempt_at,
             last_attempted_at, lease_id, lease_expires_at, attachment_id,
             created_by, created_at, updated_at
           ) values (
             'execution_media_rls_cross', $1, $2, 'whatsapp_meta', 'mock',
             'mock', 'mock', 'reserved', null, null, null, 0, 3, $3, null, null,
             null, null, $4, $3, $3
           )`,
          [fixtureB.tenantId, fixtureB.reservationId, timestamp, fixtureB.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});

type OwnerDb = ReturnType<typeof pgPoolAsSqlClient>;

async function seedReservation(db: OwnerDb, suffix: "a" | "b") {
  const unique = randomUUID().replaceAll("-", "");
  const userId = `user_media_rls_${suffix}_${unique}`;
  const tenantId = `tenant_media_rls_${suffix}_${unique}`;
  const participantId = `participant_media_rls_${suffix}_${unique}`;
  const identityId = `identity_media_rls_${suffix}_${unique}`;
  const threadId = `thread_media_rls_${suffix}_${unique}`;
  const messageId = `message_media_rls_${suffix}_${unique}`;
  const endpointId = `endpoint_media_rls_${suffix}_${unique}`;
  const reservationId = `reservation_media_rls_${suffix}_${unique}`;
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [userId, `Utilisateur ${suffix}`, `${userId}@example.test`, timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $3, 'Services', $4)`,
    [tenantId, `Organisation ${suffix}`, tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'customer', null, $3, $3)`,
    [participantId, tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'messaging', 'whatsapp-meta', $4, null,
       'customer', 'active', $5, $5
     )`,
    [identityId, tenantId, participantId, `meta_subject_${unique}`, timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', null, $3, $3, $3)`,
    [threadId, tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'inbound', 'text', 'received', 'Média en attente',
       'whatsapp-meta', $5, $6, $7, null, null, $8, $8
     )`,
    [
      messageId,
      tenantId,
      threadId,
      identityId,
      `wamid.media_rls_${unique}`,
      `media-rls-idempotency-${unique}`,
      `media-rls-correlation-${unique}`,
      timestamp,
    ],
  );
  await db.query(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, 'whatsapp_meta', $3, $4, 'active', $5, $6, $6)`,
    [
      endpointId,
      tenantId,
      suffix === "a" ? "123456789" : "987654321",
      suffix.repeat(64),
      userId,
      timestamp,
    ],
  );
  await db.query(
    `insert into channel_provider_media_imports (
       id, tenant_id, provider, endpoint_id, message_id, media_kind,
       reservation_status, encrypted_provider_reference, key_version,
       request_fingerprint, safe_error_code, created_at, updated_at
     ) values (
       $1, $2, 'whatsapp_meta', $3, $4, 'document', 'pending', $5,
       'media-test-v1', $6, null, $7, $7
     )`,
    [
      reservationId,
      tenantId,
      endpointId,
      messageId,
      `encrypted-${"x".repeat(80)}`,
      suffix.repeat(64),
      timestamp,
    ],
  );
  return { endpointId, messageId, reservationId, tenantId, unique, userId };
}

async function seedExecution(
  db: OwnerDb,
  fixture: Awaited<ReturnType<typeof seedReservation>>,
  suffix: "a" | "b",
) {
  await db.query(
    `insert into channel_provider_media_import_executions (
       id, tenant_id, media_import_id, provider, provider_mode, scanner_mode,
       storage_mode,
       status, failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, attachment_id, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, 'whatsapp_meta', 'mock', 'mock', 'mock', 'reserved', null, null,
       null, 0, 3, $4, null, null, null, null, $5, $4, $4
     )`,
    [
      `execution_media_rls_${suffix}_${fixture.unique}`,
      fixture.tenantId,
      fixture.reservationId,
      timestamp,
      fixture.userId,
    ],
  );
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_media_import_rls_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(
    `create role ${roleIdentifier} login password ${quoteLiteral(password)}`,
  );
  await ownerPool.query(`grant usage on schema public to ${roleIdentifier}`);
  await ownerPool.query(
    `grant select, insert, update, delete on all tables in schema public to ${roleIdentifier}`,
  );
  const restrictedUrl = new URL(databaseUrl);
  restrictedUrl.username = roleName;
  restrictedUrl.password = password;
  return { roleName, databaseUrl: restrictedUrl.toString() };
}

async function dropRestrictedRole(ownerPool: Pool, roleName: string) {
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(`drop owned by ${roleIdentifier}`);
  await ownerPool.query(`drop role if exists ${roleIdentifier}`);
}

async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
