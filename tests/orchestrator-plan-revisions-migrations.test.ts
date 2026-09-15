import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds, migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
} from "../src/modules/orchestrator";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migration des révisions de plans Conversation", () => {
  it("garde la migration runtime et son miroir SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0113_os5_conversation_action_plan_revisions.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationActionPlanRevisionsMigrationSql",
      ).trim(),
    ).toBe(mirror.trim());
    expect(getMigrationIds().at(-1)).toBe(
      "119_os5_conversation_action_plan_revisions",
    );
    expect(getMigrationIds(true).at(-1)).toBe(
      "121_os5_orchestrator_namespace_read_delivery_rls",
    );
  });

  it("garde les réservations RLS de l'orchestrateur dans un miroir exact", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0114_os5_orchestrator_internal_namespace_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const runtimeSql = extractSqlTemplate(
      runtime,
      "os5OrchestratorInternalNamespaceRlsMigrationSql",
    );

    expect(runtimeSql.trim()).toBe(mirror.trim());
    expect(mirror).toContain("as restrictive for insert");
    expect(mirror).toContain("as restrictive for update");
    expect(mirror).toContain("as restrictive for delete");
    expect(mirror).toContain("idempotency_key !~ '^orchestrator:'");
    expect(mirror).toContain("adapter_key <> 'orchestrator-mock'");
    expect(mirror).toContain("role <> 'system'");
    expect(mirror.match(/as restrictive/gi)).toHaveLength(30);
    expect(mirror.match(/security invoker/gi)).toHaveLength(3);
    expect(mirror).toContain(
      "raise exception 'conversation_message_identity_immutable'",
    );
    expect(mirror).toContain("channel_provider_deliveries");
    expect(mirror).toContain("channel_provider_secret_versions");
    expect(mirror).toContain("channel_provider_identity_bindings");
    expect(mirror).toContain("channel_provider_media_imports");
    expect(mirror).toContain(
      "message.external_message_id is not distinct from",
    );
    expect(mirror).toContain(
      "select not exists (\n    select 1 from conversation_messages message",
    );
    expect(mirror).not.toContain("or message.direction = 'internal'");
    expect(mirror).not.toContain(
      "or message.kind in ('plan', 'approval', 'result')",
    );
    expect(mirror).not.toMatch(/security\s+definer/i);
  });

  it("garde le correctif de lecture interne et de reprise provider dans un miroir exact", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0115_os5_orchestrator_namespace_read_delivery_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const runtimeSql = extractSqlTemplate(
      runtime,
      "os5OrchestratorNamespaceReadDeliveryRlsMigrationSql",
    );
    const deliveryUpdate = mirror.slice(
      mirror.indexOf(
        "create policy channel_provider_deliveries_internal_conversation_update",
      ),
      mirror.indexOf(
        "drop policy if exists channel_provider_deliveries_internal_conversation_delete",
      ),
    );

    expect(runtimeSql.trim()).toBe(mirror.trim());
    expect(mirror).toContain(
      "conversation_messages as restrictive for select to public",
    );
    expect(mirror).toContain("idempotency_key !~ '^orchestrator:'");
    expect(mirror).toContain("adapter_key <> 'orchestrator-mock'");
    expect(mirror).toContain(
      "channel_identity_id !~ '^orchestrator_identity_'",
    );
    expect(mirror).toContain(
      "add column if not exists internal_conversation_target boolean",
    );
    expect(mirror).toContain(
      "create or replace function classify_channel_provider_delivery_target()",
    );
    expect(mirror).toContain(
      "before insert on channel_provider_deliveries",
    );
    expect(mirror).toContain(
      "new.internal_conversation_target <>\n       old.internal_conversation_target",
    );
    expect(mirror).toContain(
      "channel_provider_deliveries as restrictive for select to public",
    );
    expect(deliveryUpdate).toContain("or not internal_conversation_target");
    expect(deliveryUpdate).not.toContain("is_internal_conversation_message");
    expect(mirror.match(/security invoker/gi)).toHaveLength(2);
    expect(mirror).not.toMatch(/security\s+definer/i);
  });

  it("accepte les projections internes canoniques lors d'une mise à niveau", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration canonique",
      email: "orchestrator-migration-canonical@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration canonique",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    const source = await ingestConversationMessage(db, user.id, {
      tenantId: tenant.id,
      channelIdentity: {
        id: "identity_migration_canonical",
        tenantId: tenant.id,
        participantId: "participant_migration_canonical",
        channelKind: "web",
        adapterKey: "web-chat",
        externalSubjectId: "member_migration_canonical",
        displayName: "Membre de démonstration",
        role: "member",
        state: "active",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      externalMessageId: "external_migration_canonical",
      idempotencyKey: "ingress:migration:canonical",
      correlationId: "correlation_migration_canonical",
      routeTrace: [],
      text: "Préparer une relance sans effet externe.",
      attachments: [],
      occurredAt,
    });
    const plan = await createConversationActionPlan(db, user.id, {
      tenantId: tenant.id,
      threadId: source.threadId,
      sourceMessageId: source.messageId,
    });

    await expect(
      migrate(db, {
        enableRls: true,
        targetMigrationId: "120_os5_orchestrator_internal_namespace_rls",
      }),
    ).resolves.toBeUndefined();
    const canonicalProjection = await db.query<{
      message_id: string;
      ordinary_identity_id: string;
    }>(
      `select proposal.id as message_id,
              source.channel_identity_id as ordinary_identity_id
         from conversation_messages proposal
         join conversation_messages source
           on source.tenant_id = proposal.tenant_id
          and source.id = $2
        where proposal.tenant_id = $1
          and proposal.idempotency_key = $3`,
      [tenant.id, source.messageId, `orchestrator:${plan.id}:proposal`],
    );
    expect(canonicalProjection.rows).toHaveLength(1);
    await db.query(
      `insert into channel_provider_endpoints (
         id, tenant_id, provider, external_account_id,
         destination_fingerprint, status, created_by, created_at, updated_at
       ) values (
         'endpoint_migration_internal_target', $1, 'whatsapp_twilio',
         'twilio_migration_internal_target', $2, 'active', $3, $4, $4
       )`,
      [tenant.id, "a".repeat(64), user.id, occurredAt],
    );
    await db.query(
      `insert into channel_provider_deliveries (
         id, tenant_id, provider, endpoint_id, message_id,
         channel_identity_id, idempotency_key, request_fingerprint,
         status, external_message_id, failure_classification,
         safe_error_code, retryable, attempts, max_attempts,
         next_attempt_at, last_attempted_at, lease_id, lease_expires_at,
         created_by, created_at, updated_at, activation_authorization_id
       ) values (
         'delivery_migration_internal_target', $1, 'whatsapp_twilio',
         'endpoint_migration_internal_target', $2, $3,
         'delivery:migration:internal-target', $4, 'reserved', null, null,
         null, null, 0, 3, $6, null, null, null, $5, $6, $6, null
       )`,
      [
        tenant.id,
        canonicalProjection.rows[0]!.message_id,
        canonicalProjection.rows[0]!.ordinary_identity_id,
        "b".repeat(64),
        user.id,
        occurredAt,
      ],
    );

    await expect(migrate(db, { enableRls: true })).resolves.toBeUndefined();
    const applied = await db.query<{ id: string }>(
      `select id from schema_migrations
       where id in (
         '120_os5_orchestrator_internal_namespace_rls',
         '121_os5_orchestrator_namespace_read_delivery_rls'
       )
       order by id`,
    );
    expect(applied.rows).toEqual([
      { id: "120_os5_orchestrator_internal_namespace_rls" },
      { id: "121_os5_orchestrator_namespace_read_delivery_rls" },
    ]);
    const classifiedDelivery = await db.query<{
      internal_conversation_target: boolean;
    }>(
      `select internal_conversation_target
         from channel_provider_deliveries
        where id = 'delivery_migration_internal_target'`,
    );
    expect(classifiedDelivery.rows).toEqual([
      { internal_conversation_target: true },
    ]);
  });

  it("accepte les livraisons WhatsApp historiques non réservées lors d'une mise à niveau", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration WhatsApp sortante",
      email: "orchestrator-migration-whatsapp-outbound@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration WhatsApp sortante",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    const source = await ingestConversationMessage(db, user.id, {
      tenantId: tenant.id,
      channelIdentity: {
        id: "identity_migration_outbound_source",
        tenantId: tenant.id,
        participantId: "participant_migration_outbound_source",
        channelKind: "web",
        adapterKey: "web-chat",
        externalSubjectId: "member_migration_outbound_source",
        displayName: "Membre de démonstration",
        role: "member",
        state: "active",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      externalMessageId: "external_migration_outbound_source",
      idempotencyKey: "ingress:migration:outbound-source",
      correlationId: "correlation_migration_outbound_source",
      routeTrace: [],
      text: "Préparer deux réponses WhatsApp sans marqueur réservé.",
      attachments: [],
      occurredAt,
    });

    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values
         ('participant_migration_outbound_system', $1, 'system',
          'Système de messagerie', $2, $2),
         ('participant_migration_outbound_twilio', $1, 'customer',
          'Cliente Twilio', $2, $2),
         ('participant_migration_outbound_meta', $1, 'customer',
          'Client Meta', $2, $2)`,
      [tenant.id, occurredAt],
    );
    await db.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values
         ('identity_migration_outbound_system', $1,
          'participant_migration_outbound_system', 'web', 'web-chat',
          'system_migration_outbound', 'Système de messagerie', 'system',
          'active', $2, $2),
         ('identity_migration_outbound_twilio', $1,
          'participant_migration_outbound_twilio', 'messaging',
          'whatsapp-twilio', 'customer_migration_outbound_twilio',
          'Cliente Twilio', 'customer', 'active', $2, $2),
         ('identity_migration_outbound_meta', $1,
          'participant_migration_outbound_meta', 'messaging',
          'whatsapp-meta', 'customer_migration_outbound_meta', 'Client Meta',
          'customer', 'active', $2, $2)`,
      [tenant.id, occurredAt],
    );
    await db.query(
      `insert into conversation_thread_participants (
         tenant_id, thread_id, channel_identity_id, joined_at
       ) values
         ($1, $2, 'identity_migration_outbound_system', $3),
         ($1, $2, 'identity_migration_outbound_twilio', $3),
         ($1, $2, 'identity_migration_outbound_meta', $3)`,
      [tenant.id, source.threadId, occurredAt],
    );
    await db.query(
      `insert into conversation_messages (
         id, tenant_id, thread_id, channel_identity_id, direction, kind,
         status, text_content, adapter_key, external_message_id,
         idempotency_key, correlation_id, causation_id, safe_error_code,
         occurred_at, created_at
       ) values
         ('message_migration_outbound_twilio', $1, $2,
          'identity_migration_outbound_system', 'outbound', 'result',
          'pending', 'Réponse sortante Twilio', 'web-chat', null,
          'canonical:migration:outbound:twilio',
          'correlation_migration_outbound_twilio', $3, null, $4, $4),
         ('message_migration_outbound_meta', $1, $2,
          'identity_migration_outbound_system', 'outbound', 'result',
          'pending', 'Réponse sortante Meta', 'web-chat', null,
          'canonical:migration:outbound:meta',
          'correlation_migration_outbound_meta', $3, null, $4, $4)`,
      [tenant.id, source.threadId, source.messageId, occurredAt],
    );
    await db.query(
      `insert into channel_provider_endpoints (
         id, tenant_id, provider, external_account_id,
         destination_fingerprint, status, created_by, created_at, updated_at
       ) values
         ('endpoint_migration_outbound_twilio', $1, 'whatsapp_twilio',
          'twilio_migration_outbound', $2, 'active', $4, $5, $5),
         ('endpoint_migration_outbound_meta', $1, 'whatsapp_meta',
          'meta_migration_outbound', $3, 'active', $4, $5, $5)`,
      [tenant.id, "a".repeat(64), "b".repeat(64), user.id, occurredAt],
    );
    await db.query(
      `insert into channel_provider_deliveries (
         id, tenant_id, provider, endpoint_id, message_id,
         channel_identity_id, idempotency_key, request_fingerprint, status,
         external_message_id, failure_classification, safe_error_code,
         retryable, attempts, max_attempts, next_attempt_at,
         last_attempted_at, lease_id, lease_expires_at, created_by, created_at,
         updated_at, activation_authorization_id
       ) values
         ('delivery_migration_outbound_twilio', $1, 'whatsapp_twilio',
          'endpoint_migration_outbound_twilio',
          'message_migration_outbound_twilio',
          'identity_migration_outbound_twilio',
          'delivery:migration:outbound:twilio', $2, 'reserved', null, null,
          null, null, 0, 3, $5, null, null, null, $4, $5, $5, null),
         ('delivery_migration_outbound_meta', $1, 'whatsapp_meta',
          'endpoint_migration_outbound_meta',
          'message_migration_outbound_meta',
          'identity_migration_outbound_meta',
          'delivery:migration:outbound:meta', $3, 'reserved', null, null,
          null, null, 0, 3, $5, null, null, null, $4, $5, $5, null)`,
      [tenant.id, "c".repeat(64), "d".repeat(64), user.id, occurredAt],
    );

    await expect(migrate(db, { enableRls: true })).resolves.toBeUndefined();
    const classifications = await db.query<{
      id: string;
      internal: boolean;
    }>(
      `select id, is_internal_conversation_message(tenant_id, id) as internal
       from conversation_messages
       where id in (
         'message_migration_outbound_twilio',
         'message_migration_outbound_meta'
       )
       order by id`,
    );
    expect(classifications.rows).toEqual([
      { id: "message_migration_outbound_meta", internal: false },
      { id: "message_migration_outbound_twilio", internal: false },
    ]);
    const updatedMessages = await db.query<{ id: string; status: string }>(
      `update conversation_messages
       set status = 'sent'
       where id in (
         'message_migration_outbound_twilio',
         'message_migration_outbound_meta'
       )
       returning id, status`,
    );
    expect(updatedMessages.rows).toEqual(
      expect.arrayContaining([
        { id: "message_migration_outbound_meta", status: "sent" },
        { id: "message_migration_outbound_twilio", status: "sent" },
      ]),
    );
    await expect(
      db.query(
        `update conversation_messages
         set channel_identity_id = 'identity_migration_outbound_meta'
         where id = 'message_migration_outbound_meta'`,
      ),
    ).rejects.toThrow(/conversation_message_identity_immutable/i);
    const deliveries = await db.query<{ provider: string }>(
      `select provider from channel_provider_deliveries
       where id in (
         'delivery_migration_outbound_twilio',
         'delivery_migration_outbound_meta'
       )
       order by provider`,
    );
    expect(deliveries.rows).toEqual([
      { provider: "whatsapp_meta" },
      { provider: "whatsapp_twilio" },
    ]);
  });

  it("accepte la projection historique d'un plan refusé", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration refus historique",
      email: "orchestrator-migration-legacy-rejection@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration refus historique",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    const source = await ingestConversationMessage(db, user.id, {
      tenantId: tenant.id,
      channelIdentity: {
        id: "identity_migration_legacy_rejection",
        tenantId: tenant.id,
        participantId: "participant_migration_legacy_rejection",
        channelKind: "web",
        adapterKey: "web-chat",
        externalSubjectId: "member_migration_legacy_rejection",
        displayName: "Membre de démonstration",
        role: "member",
        state: "active",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      externalMessageId: "external_migration_legacy_rejection",
      idempotencyKey: "ingress:migration:legacy-rejection",
      correlationId: "correlation_migration_legacy_rejection",
      routeTrace: [],
      text: "Préparer une relance client.",
      attachments: [],
      occurredAt,
    });
    const plan = await createConversationActionPlan(db, user.id, {
      tenantId: tenant.id,
      threadId: source.threadId,
      sourceMessageId: source.messageId,
    });
    await decideConversationActionPlan(db, user.id, tenant.id, {
      planId: plan.id,
      decision: "rejected",
      reason: "Refus historique vérifié.",
    });
    await db.query(
      `update conversation_messages set text_content = 'Plan refusé.'
       where tenant_id = $1 and idempotency_key = $2`,
      [tenant.id, `orchestrator:${plan.id}:rejected`],
    );

    await expect(migrate(db, { enableRls: true })).resolves.toBeUndefined();
  });

  it("bloque une mise à niveau si le namespace historique est incohérent", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration empoisonnée",
      email: "orchestrator-migration-poisoned@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration empoisonnée",
      category: "Services",
    });
    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values (
         'orchestrator_participant_invalide', $1, 'member', 'Usurpation',
         '2026-09-14T14:00:00.000Z', '2026-09-14T14:00:00.000Z'
       )`,
      [tenant.id],
    );

    await expect(migrate(db, { enableRls: true })).rejects.toThrow(
      /orchestrator_internal_namespace_conflict/i,
    );
    const applied = await db.query<{ id: string }>(
      `select id from schema_migrations
       where id = '120_os5_orchestrator_internal_namespace_rls'`,
    );
    expect(applied.rows).toHaveLength(0);
  });

  it("refuse un ancien message réservé privé de référence externe", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration message empoisonné",
      email: "orchestrator-migration-message-poisoned@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration message empoisonné",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    const source = await ingestConversationMessage(db, user.id, {
      tenantId: tenant.id,
      channelIdentity: {
        id: "identity_migration_message_poisoned",
        tenantId: tenant.id,
        participantId: "participant_migration_message_poisoned",
        channelKind: "web",
        adapterKey: "web-chat",
        externalSubjectId: "member_migration_message_poisoned",
        displayName: "Membre de démonstration",
        role: "member",
        state: "active",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      externalMessageId: "external_migration_message_poisoned",
      idempotencyKey: "ingress:migration:message-poisoned",
      correlationId: "correlation_migration_message_poisoned",
      routeTrace: [],
      text: "Message source de la preuve de migration.",
      attachments: [],
      occurredAt,
    });
    const suffix = createHash("sha256")
      .update(tenant.id)
      .digest("hex")
      .slice(0, 32);
    const participantId = `orchestrator_participant_${suffix}`;
    const identityId = `orchestrator_identity_${suffix}`;
    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values ($1, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
      [participantId, tenant.id, occurredAt],
    );
    await db.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values (
         $1, $2, $3, 'test', 'orchestrator-mock',
         'tradikom-one-orchestrator', 'TRADIKOM ONE', 'system', 'active',
         $4, $4
       )`,
      [identityId, tenant.id, participantId, occurredAt],
    );
    await db.query(
      `insert into conversation_messages (
         id, tenant_id, thread_id, channel_identity_id, direction, kind,
         status, text_content, adapter_key, external_message_id,
         idempotency_key, correlation_id, causation_id, safe_error_code,
         occurred_at, created_at
       ) values (
         'message_migration_reserved_without_external', $1, $2, $3,
         'internal', 'plan', 'received', 'Projection empoisonnée',
         'orchestrator-mock', null, $4, 'correlation_reserved_message', $5,
         null, $6, $6
       )`,
      [
        tenant.id,
        source.threadId,
        identityId,
        `orchestrator:conversation_action_plan_${suffix}:proposal`,
        source.messageId,
        occurredAt,
      ],
    );

    await expect(migrate(db, { enableRls: true })).rejects.toThrow(
      /orchestrator_internal_namespace_conflict/i,
    );
  });

  it("refuse un suffixe interne canonique qui ne dérive pas du tenant", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration namespace préempté",
      email: "orchestrator-migration-squatted@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration namespace préempté",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    const suffix = "a".repeat(32);
    expect(suffix).not.toBe(
      createHash("sha256").update(tenant.id).digest("hex").slice(0, 32),
    );
    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values ($1, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
      [`orchestrator_participant_${suffix}`, tenant.id, occurredAt],
    );
    await db.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values (
         $1, $2, $3, 'test', 'orchestrator-mock',
         'tradikom-one-orchestrator', 'TRADIKOM ONE', 'system', 'active',
         $4, $4
       )`,
      [
        `orchestrator_identity_${suffix}`,
        tenant.id,
        `orchestrator_participant_${suffix}`,
        occurredAt,
      ],
    );

    await expect(migrate(db, { enableRls: true })).rejects.toThrow(
      /orchestrator_internal_namespace_conflict/i,
    );
  });

  it("refuse un ancien message interne privé de plan durable", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration message non ancré",
      email: "orchestrator-migration-unbound-message@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration message non ancré",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    const source = await ingestConversationMessage(db, user.id, {
      tenantId: tenant.id,
      channelIdentity: {
        id: "identity_migration_unbound_message",
        tenantId: tenant.id,
        participantId: "participant_migration_unbound_message",
        channelKind: "web",
        adapterKey: "web-chat",
        externalSubjectId: "member_migration_unbound_message",
        displayName: "Membre de démonstration",
        role: "member",
        state: "active",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
      externalMessageId: "external_migration_unbound_message",
      idempotencyKey: "ingress:migration:unbound-message",
      correlationId: "correlation_migration_unbound_message",
      routeTrace: [],
      text: "Message source d'une projection non ancrée.",
      attachments: [],
      occurredAt,
    });
    const suffix = createHash("sha256")
      .update(tenant.id)
      .digest("hex")
      .slice(0, 32);
    const participantId = `orchestrator_participant_${suffix}`;
    const identityId = `orchestrator_identity_${suffix}`;
    const fakePlanId = `conversation_action_plan_${"b".repeat(32)}`;
    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values ($1, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
      [participantId, tenant.id, occurredAt],
    );
    await db.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values (
         $1, $2, $3, 'test', 'orchestrator-mock',
         'tradikom-one-orchestrator', 'TRADIKOM ONE', 'system', 'active',
         $4, $4
       )`,
      [identityId, tenant.id, participantId, occurredAt],
    );
    await db.query(
      `insert into conversation_messages (
         id, tenant_id, thread_id, channel_identity_id, direction, kind,
         status, text_content, adapter_key, external_message_id,
         idempotency_key, correlation_id, causation_id, safe_error_code,
         occurred_at, created_at
       ) values (
         'message_migration_unbound_internal', $1, $2, $3, 'internal',
         'approval', 'received', 'Plan approuvé.', 'orchestrator-mock', $4,
         $5, $6, $7, null, $8, $8
       )`,
      [
        tenant.id,
        source.threadId,
        identityId,
        `${fakePlanId}:approved`,
        `orchestrator:${fakePlanId}:approved`,
        fakePlanId,
        source.messageId,
        occurredAt,
      ],
    );

    await expect(migrate(db, { enableRls: true })).rejects.toThrow(
      /orchestrator_internal_namespace_conflict/i,
    );
  });

  it("refuse une identité historique qui masque un participant système", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Responsable migration alias système",
      email: "orchestrator-migration-system-alias@example.test",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Organisation migration alias système",
      category: "Services",
    });
    const occurredAt = "2026-09-14T14:00:00.000Z";
    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values ($1, $2, 'system', 'Système interne', $3, $3)`,
      ["participant_historical_system", tenant.id, occurredAt],
    );
    await db.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values (
         $1, $2, $3, 'test', 'public-test', $4, 'Alias historique',
         'member', 'active', $5, $5
       )`,
      [
        "identity_historical_system_alias",
        tenant.id,
        "participant_historical_system",
        "historical-system-alias",
        occurredAt,
      ],
    );

    await expect(migrate(db, { enableRls: true })).rejects.toThrow(
      /orchestrator_internal_namespace_conflict/i,
    );
  });

  it("ajoute un lignage borné, unique, tenant-scoped et immuable", async () => {
    const db = await createMemoryDb();
    opened.push(db);

    const columns = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'conversation_action_plans'
         and column_name in (
           'supersedes_plan_id', 'revision_request_fingerprint'
         )
       order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "revision_request_fingerprint", data_type: "text" },
      { column_name: "supersedes_plan_id", data_type: "text" },
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname = 'uq_conversation_action_plan_supersedes'
       order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "uq_conversation_action_plan_supersedes",
    ]);

    const functions = await db.query<{ proname: string }>(
      `select proname
       from pg_proc
       where proname in (
         'enforce_conversation_action_plan_immutability',
         'enforce_conversation_action_plan_revision_binding'
       )
       order by proname`,
    );
    expect(functions.rows.map((row) => row.proname)).toEqual([
      "enforce_conversation_action_plan_immutability",
      "enforce_conversation_action_plan_revision_binding",
    ]);

    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0113_os5_conversation_action_plan_revisions.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(mirror).toContain("foreign key (tenant_id, supersedes_plan_id)");
    expect(mirror).toContain("previous_plan.thread_id");
    expect(mirror).toContain("previous_plan.source_message_id");
    expect(mirror).toContain("conversation_action_plan_policy_receipts");
    expect(mirror).toContain("workflow_runs");
    expect(mirror).toContain("step.status <> 'cancelled'");
    expect(mirror).toContain("revision_request_fingerprint is not null");
    expect(mirror).toContain("tg_op <> 'INSERT'");
    expect(mirror).toContain("conversation_action_plan_immutable");
    expect(mirror).not.toMatch(/security\s+definer/i);
  });
});

function extractSqlTemplate(source: string, constant: string) {
  const prefix = `const ${constant} = \``;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Constante SQL introuvable : ${constant}`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  if (end < 0) throw new Error(`Fin SQL introuvable : ${constant}`);
  return source.slice(contentStart, end);
}
