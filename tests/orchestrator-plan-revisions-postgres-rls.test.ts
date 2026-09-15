import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient, type SqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  reviseConversationActionPlan,
} from "../src/modules/orchestrator";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const createdFixtures: Array<{
  ownerPool: Pool;
  userId: string;
  tenantId?: string;
}> = [];
const occurredAt = "2026-09-14T14:00:00.000Z";

afterEach(async () => {
  const cleanupErrors: unknown[] = [];
  const restrictedPoolClosures = await Promise.allSettled(
    restrictedPools.splice(0).map((pool) => pool.end()),
  );
  for (const closure of restrictedPoolClosures) {
    if (closure.status === "rejected") cleanupErrors.push(closure.reason);
  }
  for (const role of restrictedRoles.splice(0)) {
    try {
      await dropRestrictedRole(role.ownerPool, role.roleName);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const fixture of createdFixtures.splice(0).reverse()) {
    if (fixture.tenantId) {
      try {
        await fixture.ownerPool.query("delete from tenants where id = $1", [
          fixture.tenantId,
        ]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await fixture.ownerPool.query("delete from users where id = $1", [
        fixture.userId,
      ]);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const ownerPoolClosures = await Promise.allSettled(
    ownerPools.splice(0).map((pool) => pool.end()),
  );
  for (const closure of ownerPoolClosures) {
    if (closure.status === "rejected") cleanupErrors.push(closure.reason);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Le nettoyage PostgreSQL du test de révision a échoué.",
    );
  }
});

describeIfPostgres("révisions de plans Conversation sur PostgreSQL", () => {
  it("classe une livraison interne créée entre les migrations 120 et 121", async () => {
    await withTemporaryPostgresDatabase(async (pool) => {
      const db = pgPoolAsSqlClient(pool);
      await migrate(db, {
        enableRls: true,
        targetMigrationId: "120_os5_orchestrator_internal_namespace_rls",
      });
      const services = createServices(db);
      const user = await services.registerUser({
        name: "Responsable upgrade namespace",
        email: `plan-revision-upgrade-${randomUUID()}@example.test`,
        password: "Password!1",
      });
      const tenant = await services.createTenant(user.id, {
        name: `Organisation upgrade namespace ${randomUUID()}`,
        category: "Services",
      });
      const source = await ingestConversationMessage(db, user.id, {
        tenantId: tenant.id,
        channelIdentity: {
          id: `identity_upgrade_${randomUUID().replaceAll("-", "")}`,
          tenantId: tenant.id,
          participantId: `participant_upgrade_${randomUUID().replaceAll("-", "")}`,
          channelKind: "web",
          adapterKey: "web-chat",
          externalSubjectId: `member_upgrade_${randomUUID().replaceAll("-", "")}`,
          displayName: "Membre de démonstration",
          role: "member",
          state: "active",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        externalMessageId: `external_upgrade_${randomUUID()}`,
        idempotencyKey: `ingress:upgrade:${randomUUID()}`,
        correlationId: `correlation_upgrade_${randomUUID()}`,
        routeTrace: [],
        text: "Préparer une relance sans effet externe.",
        attachments: [],
        occurredAt,
      });
      // Le service courant dépend de tables postérieures à la migration 120.
      // Cette fixture reste volontairement bornée au schéma historique testé.
      const planId = await seedHistoricalCanonicalPlanProjection(pool, {
        tenantId: tenant.id,
        userId: user.id,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      });
      const projection = await pool.query<{
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
        [tenant.id, source.messageId, `orchestrator:${planId}:proposal`],
      );
      expect(projection.rows).toHaveLength(1);
      await pool.query(
        `insert into channel_provider_endpoints (
           id, tenant_id, provider, external_account_id,
           destination_fingerprint, status, created_by, created_at, updated_at
         ) values ($1, $2, 'whatsapp_twilio', $3, $4, 'active', $5, $6, $6)`,
        [
          "endpoint_upgrade_internal_target",
          tenant.id,
          "twilio_upgrade_internal_target",
          "a".repeat(64),
          user.id,
          occurredAt,
        ],
      );
      await pool.query(
        `insert into channel_provider_deliveries (
           id, tenant_id, provider, endpoint_id, message_id,
           channel_identity_id, idempotency_key, request_fingerprint,
           status, external_message_id, failure_classification,
           safe_error_code, retryable, attempts, max_attempts,
           next_attempt_at, last_attempted_at, lease_id, lease_expires_at,
           created_by, created_at, updated_at, activation_authorization_id
         ) values (
           $1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7,
           'reserved', null, null, null, null, 0, 3, $9, null, null, null,
           $8, $9, $9, null
         )`,
        [
          "delivery_upgrade_internal_target",
          tenant.id,
          "endpoint_upgrade_internal_target",
          projection.rows[0]!.message_id,
          projection.rows[0]!.ordinary_identity_id,
          "delivery:upgrade:internal-target",
          "b".repeat(64),
          user.id,
          occurredAt,
        ],
      );

      await migrate(db, { enableRls: true });
      const classification = await pool.query<{
        internal_conversation_target: boolean;
      }>(
        `select internal_conversation_target
           from channel_provider_deliveries
          where id = 'delivery_upgrade_internal_target'`,
      );
      expect(classification.rows).toEqual([
        { internal_conversation_target: true },
      ]);
      await expect(
        pool.query(
          `update channel_provider_deliveries
              set internal_conversation_target = false
            where id = 'delivery_upgrade_internal_target'`,
        ),
      ).rejects.toThrow(/channel_provider_delivery_identity_immutable/i);
    });
  });

  it("sérialise deux connexions, borne le lignage au tenant et bloque les écritures directes", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const primaryPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const contenderPool = new Pool({ connectionString: databaseUrl, max: 1 });
    ownerPools.push(primaryPool, contenderPool);
    const primaryDb = pgPoolAsSqlClient(primaryPool);
    const contenderDb = pgPoolAsSqlClient(contenderPool);
    await migrate(primaryDb, { enableRls: true });

    const fixtureA = await createPlanFixture(primaryDb, primaryPool, "a");
    const fixtureB = await createPlanFixture(primaryDb, primaryPool, "b");
    const [primaryPid, contenderPid] = await Promise.all([
      readBackendPid(primaryPool),
      readBackendPid(contenderPool),
    ]);
    expect(primaryPid).not.toBe(contenderPid);

    const revisionInput = {
      planId: fixtureA.planId,
      taskTitle: "Rappeler le prospect lundi à 09 h",
    };
    const concurrentResults = await Promise.all([
      reviseConversationActionPlan(
        primaryDb,
        fixtureA.userId,
        fixtureA.tenantId,
        revisionInput,
      ),
      reviseConversationActionPlan(
        contenderDb,
        fixtureA.userId,
        fixtureA.tenantId,
        revisionInput,
      ),
    ]);

    expect(new Set(concurrentResults.map((result) => result.id)).size).toBe(1);
    expect(
      concurrentResults
        .map((result) => result.idempotentReplay)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    const revisionId = concurrentResults[0]!.id;
    expect(concurrentResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: revisionId,
          tenantId: fixtureA.tenantId,
          supersedesPlanId: fixtureA.planId,
          revisedFromPlanId: fixtureA.planId,
        }),
      ]),
    );

    const persisted = await primaryPool.query<{
      revisions: number;
      approvals: number;
      audits: number;
      revision_tenant_id: string;
      previous_tenant_id: string;
    }>(
      `select
         (select count(*)::int from conversation_action_plans
          where tenant_id = $1 and supersedes_plan_id = $2) as revisions,
         (select count(*)::int from approvals
          where tenant_id = $1 and target_type = 'conversation_action_plan'
            and target_id = $3) as approvals,
         (select count(*)::int from audit_logs
          where tenant_id = $1 and action = 'conversation.plan_revised'
            and target_id = $3) as audits,
         revision.tenant_id as revision_tenant_id,
         previous.tenant_id as previous_tenant_id
       from conversation_action_plans revision
       join conversation_action_plans previous
         on previous.tenant_id = revision.tenant_id
        and previous.id = revision.supersedes_plan_id
       where revision.tenant_id = $1 and revision.id = $3`,
      [fixtureA.tenantId, fixtureA.planId, revisionId],
    );
    expect(persisted.rows).toEqual([
      {
        revisions: 1,
        approvals: 1,
        audits: 1,
        revision_tenant_id: fixtureA.tenantId,
        previous_tenant_id: fixtureA.tenantId,
      },
    ]);

    await expect(
      primaryPool.query(
        `insert into conversation_action_plans (
           id, tenant_id, thread_id, source_message_id, schema_version,
           generation_source, model_reference, approval_status, intent,
           business_goal, confidence, risk_summary, estimated_cost_minor,
           estimated_cost_currency, plan_json, plan_fingerprint, created_by,
           created_at, updated_at, decided_by, decided_at, decision_reason,
           supersedes_plan_id, revision_request_fingerprint
         ) select
           $1, tenant_id, thread_id, source_message_id, schema_version,
           generation_source, model_reference, 'awaiting_approval', intent,
           business_goal, confidence, risk_summary, estimated_cost_minor,
           estimated_cost_currency, plan_json, $2, created_by, created_at,
           created_at, null, null, null, $3, $4
         from conversation_action_plans
         where tenant_id = $5 and id = $6`,
        [
          `plan_cross_tenant_revision_${fixtureA.unique}`,
          "e".repeat(64),
          fixtureA.planId,
          "f".repeat(64),
          fixtureB.tenantId,
          fixtureB.planId,
        ],
      ),
    ).rejects.toThrow(/conversation_action_plan_revision_binding_invalid/i);

    const raceFixture = await createPlanFixture(primaryDb, primaryPool, "c");
    const raceResults = await Promise.allSettled([
      reviseConversationActionPlan(
        primaryDb,
        raceFixture.userId,
        raceFixture.tenantId,
        {
          planId: raceFixture.planId,
          taskTitle: "Préparer la relance prioritaire de mardi",
        },
      ),
      decideConversationActionPlan(
        contenderDb,
        raceFixture.userId,
        raceFixture.tenantId,
        {
          planId: raceFixture.planId,
          decision: "approved",
          reason: "Validation concurrente contrôlée.",
        },
      ),
    ]);
    expect(raceResults.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejectedRace = raceResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejectedRace).toHaveLength(1);
    expect(rejectedRace[0]?.reason).toMatchObject({
      code: "orchestrator_decision_conflict",
    });

    const raceState = await primaryPool.query<{
      approval_status: string;
      revisions: number;
      receipts: number;
      revision_audits: number;
      approval_audits: number;
    }>(
      `select plan.approval_status,
         (select count(*)::int from conversation_action_plans
          where tenant_id = $1 and supersedes_plan_id = $2) as revisions,
         (select count(*)::int from conversation_action_plan_policy_receipts
          where tenant_id = $1 and plan_id = $2) as receipts,
         (select count(*)::int from audit_logs
          where tenant_id = $1 and action = 'conversation.plan_revised'
            and target_type = 'conversation_action_plan') as revision_audits,
         (select count(*)::int from audit_logs
          where tenant_id = $1 and action = 'conversation.plan_approved'
            and target_id = $2) as approval_audits
       from conversation_action_plans plan
       where plan.tenant_id = $1 and plan.id = $2`,
      [raceFixture.tenantId, raceFixture.planId],
    );
    if (raceResults[0]?.status === "fulfilled") {
      expect(raceResults[1]?.status).toBe("rejected");
      expect(raceState.rows).toEqual([
        {
          approval_status: "rejected",
          revisions: 1,
          receipts: 0,
          revision_audits: 1,
          approval_audits: 0,
        },
      ]);
    } else {
      expect(raceResults[1]?.status).toBe("fulfilled");
      expect(raceState.rows).toEqual([
        {
          approval_status: "approved",
          revisions: 0,
          receipts: 1,
          revision_audits: 0,
          approval_audits: 1,
        },
      ]);
    }

    const restricted = await createRestrictedRole(primaryPool);
    restrictedRoles.push({ ownerPool: primaryPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({
      connectionString: restricted.databaseUrl,
      max: 1,
    });
    restrictedPools.push(restrictedPool);
    const genericSystemParticipantId =
      `participant_system_${fixtureA.unique}`;
    const genericSystemIdentityId = `identity_system_${fixtureA.unique}`;
    const outboundSystemParticipantId =
      `participant_system_outbound_${fixtureA.unique}`;
    const outboundSystemIdentityId =
      `identity_system_outbound_${fixtureA.unique}`;
    await primaryPool.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values
         ($1, $3, 'system', 'Système de test', $4, $4),
         ($2, $3, 'system', 'Système sortant', $4, $4)`,
      [
        genericSystemParticipantId,
        outboundSystemParticipantId,
        fixtureA.tenantId,
        occurredAt,
      ],
    );
    await primaryPool.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values
         ($1, $3, $4, 'test', 'system-test', $5, 'Système de test',
          'system', 'active', $7, $7),
         ($2, $3, $6, 'test', 'system-test', $8, 'Système sortant',
          'system', 'active', $7, $7)`,
      [
        genericSystemIdentityId,
        outboundSystemIdentityId,
        fixtureA.tenantId,
        genericSystemParticipantId,
        `system_subject_${fixtureA.unique}`,
        outboundSystemParticipantId,
        occurredAt,
        `system_outbound_subject_${fixtureA.unique}`,
      ],
    );

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_channel_identities (
               id, tenant_id, participant_id, channel_kind, adapter_key,
               external_subject_id, display_name, role, state, created_at,
               updated_at
             ) values (
               $1, $2, $3, 'test', 'public-test', $4, 'Alias interdit',
               'member', 'active', $5, $5
             )`,
            [
              `identity_system_alias_${fixtureA.unique}`,
              fixtureA.tenantId,
              genericSystemParticipantId,
              `system_alias_subject_${fixtureA.unique}`,
              occurredAt,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const hiddenUser = await createServices(primaryDb).registerUser({
      name: "Membre sans accès au fil",
      email: `plan-revision-hidden-${fixtureA.unique}@example.test`,
      password: "Password!1",
    });
    createdFixtures.push({
      ownerPool: primaryPool,
      userId: hiddenUser.id,
    });
    await primaryPool.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'collaborator', $3)`,
      [fixtureA.tenantId, hiddenUser.id, occurredAt],
    );
    const protectedMessage = await primaryPool.query<{
      id: string;
      internal_channel_identity_id: string;
      ordinary_channel_identity_id: string;
    }>(
      `select proposal.id,
              proposal.channel_identity_id as internal_channel_identity_id,
              source.channel_identity_id as ordinary_channel_identity_id
         from conversation_action_plans plan
         join conversation_messages proposal
           on proposal.tenant_id = plan.tenant_id
          and proposal.idempotency_key =
            'orchestrator:' || plan.id || ':proposal'
         join conversation_messages source
           on source.tenant_id = plan.tenant_id
          and source.id = plan.source_message_id
        where plan.tenant_id = $1 and plan.id = $2`,
      [fixtureA.tenantId, revisionId],
    );
    expect(protectedMessage.rows).toHaveLength(1);
    const protectedMessageId = protectedMessage.rows[0]!.id;
    const internalIdentityId =
      protectedMessage.rows[0]!.internal_channel_identity_id;
    const ordinaryIdentityId =
      protectedMessage.rows[0]!.ordinary_channel_identity_id;
    const twilioEndpointId = `endpoint_twilio_${fixtureA.unique}`;
    const metaEndpointId = `endpoint_meta_${fixtureA.unique}`;
    await primaryPool.query(
      `insert into channel_provider_endpoints (
         id, tenant_id, provider, external_account_id,
         destination_fingerprint, status, created_by, created_at, updated_at
       ) values
         ($1, $3, 'whatsapp_twilio', $4, $6, 'active', $7, $8, $8),
         ($2, $3, 'whatsapp_meta', $5, $6, 'active', $7, $8, $8)`,
      [
        twilioEndpointId,
        metaEndpointId,
        fixtureA.tenantId,
        `twilio_account_${fixtureA.unique}`,
        `meta_account_${fixtureA.unique}`,
        "3".repeat(64),
        fixtureA.userId,
        occurredAt,
      ],
    );

    const hiddenInternalMessage = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      hiddenUser.id,
      (client) =>
        client.query<{ id: string }>(
          "select id from conversation_messages where id = $1",
          [protectedMessageId],
        ),
    );
    expect(hiddenInternalMessage.rows).toEqual([]);

    const hiddenProtection = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      hiddenUser.id,
      (client) =>
        client.query<{
          protected_message: boolean;
          protected_identity: boolean;
        }>(
          `select
             is_internal_conversation_message($1, $2) as protected_message,
             is_internal_conversation_identity($1, $3) as protected_identity`,
          [fixtureA.tenantId, protectedMessageId, ordinaryIdentityId],
        ),
    );
    expect(hiddenProtection.rows).toEqual([
      { protected_message: true, protected_identity: false },
    ]);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        hiddenUser.id,
        (client) =>
          client.query(
            `insert into channel_provider_deliveries (
               id, tenant_id, provider, endpoint_id, message_id,
               channel_identity_id, idempotency_key, request_fingerprint,
               status, created_by, created_at, updated_at
             ) values (
               $1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7,
               'reserved', $8, $9, $9
             )`,
            [
              `delivery_hidden_internal_${fixtureA.unique}`,
              fixtureA.tenantId,
              twilioEndpointId,
              protectedMessageId,
              ordinaryIdentityId,
              `hidden-internal:${fixtureA.unique}`,
              "4".repeat(64),
              hiddenUser.id,
              occurredAt,
            ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const twilioCustomerParticipantId =
      `participant_outbound_twilio_${fixtureA.unique}`;
    const metaCustomerParticipantId =
      `participant_outbound_meta_${fixtureA.unique}`;
    const twilioCustomerIdentityId =
      `identity_outbound_twilio_${fixtureA.unique}`;
    const metaCustomerIdentityId =
      `identity_outbound_meta_${fixtureA.unique}`;
    const twilioOutboundMessageId =
      `message_outbound_twilio_${fixtureA.unique}`;
    const metaOutboundMessageId = `message_outbound_meta_${fixtureA.unique}`;
    await primaryPool.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values
         ($1, $3, 'customer', 'Cliente WhatsApp Twilio', $4, $4),
         ($2, $3, 'customer', 'Client WhatsApp Meta', $4, $4)`,
      [
        twilioCustomerParticipantId,
        metaCustomerParticipantId,
        fixtureA.tenantId,
        occurredAt,
      ],
    );
    await primaryPool.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values
         ($1, $5, $2, 'messaging', 'whatsapp-twilio', $3,
          'Cliente WhatsApp Twilio', 'customer', 'active', $6, $6),
         ($4, $5, $7, 'messaging', 'whatsapp-meta', $8,
          'Client WhatsApp Meta', 'customer', 'active', $6, $6)`,
      [
        twilioCustomerIdentityId,
        twilioCustomerParticipantId,
        `customer_twilio_${fixtureA.unique}`,
        metaCustomerIdentityId,
        fixtureA.tenantId,
        occurredAt,
        metaCustomerParticipantId,
        `customer_meta_${fixtureA.unique}`,
      ],
    );
    await primaryPool.query(
      `insert into conversation_thread_participants (
         tenant_id, thread_id, channel_identity_id, joined_at
       ) select plan.tenant_id, plan.thread_id, participant.identity_id, $4
           from conversation_action_plans plan
           cross join (values ($1::text), ($2), ($3)) participant(identity_id)
          where plan.tenant_id = $5 and plan.id = $6`,
      [
        outboundSystemIdentityId,
        twilioCustomerIdentityId,
        metaCustomerIdentityId,
        occurredAt,
        fixtureA.tenantId,
        revisionId,
      ],
    );
    await primaryPool.query(
      `insert into conversation_messages (
         id, tenant_id, thread_id, channel_identity_id, direction, kind,
         status, text_content, adapter_key, external_message_id,
         idempotency_key, correlation_id, causation_id, safe_error_code,
         occurred_at, created_at
       ) select outbound.id, plan.tenant_id, plan.thread_id, $1, 'outbound',
           'result', 'pending', outbound.text_content, 'web-chat', null,
           outbound.idempotency_key, outbound.correlation_id,
           plan.source_message_id, null, $8, $8
           from conversation_action_plans plan
           cross join (values
             ($2::text, $3::text, $4::text, $5::text),
             ($6, $7, $9, $10)
           ) outbound(id, text_content, idempotency_key, correlation_id)
          where plan.tenant_id = $11 and plan.id = $12`,
      [
        outboundSystemIdentityId,
        twilioOutboundMessageId,
        "Réponse sortante WhatsApp Twilio",
        `canonical:outbound:twilio:${fixtureA.unique}`,
        `correlation_outbound_twilio_${fixtureA.unique}`,
        metaOutboundMessageId,
        "Réponse sortante WhatsApp Meta",
        occurredAt,
        `canonical:outbound:meta:${fixtureA.unique}`,
        `correlation_outbound_meta_${fixtureA.unique}`,
        fixtureA.tenantId,
        revisionId,
      ],
    );

    const internalMessageDeliveryId =
      `delivery_internal_message_${fixtureA.unique}`;
    const internalIdentityDeliveryId =
      `delivery_internal_identity_${fixtureA.unique}`;
    await primaryPool.query(
      `insert into channel_provider_deliveries (
         id, tenant_id, provider, endpoint_id, message_id,
         channel_identity_id, idempotency_key, request_fingerprint,
         status, external_message_id, failure_classification,
         safe_error_code, retryable, attempts, max_attempts,
         next_attempt_at, last_attempted_at, lease_id, lease_expires_at,
         created_by, created_at, updated_at, activation_authorization_id
       ) values
         ($1, $3, 'whatsapp_twilio', $4, $5, $6, $7, $8,
          'reserved', null, null, null, null, 0, 3, $10, null, null, null,
          $9, $10, $10, null),
         ($2, $3, 'whatsapp_meta', $11, $12, $13, $14, $15,
          'reserved', null, null, null, null, 0, 3, $10, null, null, null,
          $9, $10, $10, null)`,
      [
        internalMessageDeliveryId,
        internalIdentityDeliveryId,
        fixtureA.tenantId,
        twilioEndpointId,
        protectedMessageId,
        ordinaryIdentityId,
        `delivery:internal-message:${fixtureA.unique}`,
        "8".repeat(64),
        fixtureA.userId,
        occurredAt,
        metaEndpointId,
        metaOutboundMessageId,
        internalIdentityId,
        `delivery:internal-identity:${fixtureA.unique}`,
        "9".repeat(64),
      ],
    );
    const internalDeliveryClassifications = await primaryPool.query<{
      id: string;
      internal_conversation_target: boolean;
    }>(
      `select id, internal_conversation_target
         from channel_provider_deliveries
        where id in ($1, $2)
        order by id`,
      [internalMessageDeliveryId, internalIdentityDeliveryId],
    );
    expect(internalDeliveryClassifications.rows).toEqual(
      [
        {
          id: internalMessageDeliveryId,
          internal_conversation_target: true,
        },
        {
          id: internalIdentityDeliveryId,
          internal_conversation_target: true,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const hiddenInternalDeliveries = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      hiddenUser.id,
      (client) =>
        client.query<{ id: string }>(
          `select id from channel_provider_deliveries
            where id in ($1, $2) order by id`,
          [internalMessageDeliveryId, internalIdentityDeliveryId],
        ),
    );
    expect(hiddenInternalDeliveries.rows).toEqual([]);
    const blockedInternalDeliveryUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      hiddenUser.id,
      (client) =>
        client.query<{ id: string }>(
          `update channel_provider_deliveries
              set updated_at = updated_at
            where id in ($1, $2)
            returning id`,
          [internalMessageDeliveryId, internalIdentityDeliveryId],
        ),
    );
    expect(blockedInternalDeliveryUpdate.rows).toEqual([]);
    const blockedInternalDeliveryDelete = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      hiddenUser.id,
      (client) =>
        client.query<{ id: string }>(
          `delete from channel_provider_deliveries
            where id in ($1, $2)
            returning id`,
          [internalMessageDeliveryId, internalIdentityDeliveryId],
        ),
    );
    expect(blockedInternalDeliveryDelete.rows).toEqual([]);
    await expect(
      primaryPool.query(
        `update channel_provider_deliveries
            set internal_conversation_target = false
          where id = $1`,
        [internalMessageDeliveryId],
      ),
    ).rejects.toThrow(/channel_provider_delivery_identity_immutable/i);

    const outboundRlsWrites = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.userId,
      async (client) => {
        const classifications = await client.query<{
          id: string;
          internal: boolean;
        }>(
          `select id,
               is_internal_conversation_message(tenant_id, id) as internal
             from conversation_messages
            where id in ($1, $2)
            order by id`,
          [twilioOutboundMessageId, metaOutboundMessageId],
        );
        const insertedDeliveries = await client.query<{
          provider: string;
          status: string;
        }>(
          `insert into channel_provider_deliveries (
             id, tenant_id, provider, endpoint_id, message_id,
             channel_identity_id, idempotency_key, request_fingerprint,
             status, external_message_id, failure_classification,
             safe_error_code, retryable, attempts, max_attempts,
             next_attempt_at, last_attempted_at, lease_id, lease_expires_at,
             created_by, created_at, updated_at, activation_authorization_id
           ) values
             ($1, $3, 'whatsapp_twilio', $4, $5, $6, $7, $8, 'reserved',
              null, null, null, null, 0, 3, $13, null, null, null, $14, $13,
              $13, null),
             ($2, $3, 'whatsapp_meta', $9, $10, $11, $12, $15, 'reserved',
              null, null, null, null, 0, 3, $13, null, null, null, $14, $13,
              $13, null)
           returning provider, status`,
          [
            `delivery_outbound_twilio_${fixtureA.unique}`,
            `delivery_outbound_meta_${fixtureA.unique}`,
            fixtureA.tenantId,
            twilioEndpointId,
            twilioOutboundMessageId,
            twilioCustomerIdentityId,
            `delivery:outbound:twilio:${fixtureA.unique}`,
            "6".repeat(64),
            metaEndpointId,
            metaOutboundMessageId,
            metaCustomerIdentityId,
            `delivery:outbound:meta:${fixtureA.unique}`,
            occurredAt,
            fixtureA.userId,
            "7".repeat(64),
          ],
        );
        const updatedDeliveries = await client.query<{
          provider: string;
          status: string;
        }>(
          `update channel_provider_deliveries
              set status = 'accepted',
                  external_message_id = case provider
                    when 'whatsapp_meta' then $3
                    else $4
                  end,
                  retryable = false,
                  updated_at = $5
            where tenant_id = $1 and id in ($2, $6)
            returning provider, status`,
          [
            fixtureA.tenantId,
            `delivery_outbound_twilio_${fixtureA.unique}`,
            `wamid.${fixtureA.unique}`,
            `SM${fixtureA.unique}`,
            occurredAt,
            `delivery_outbound_meta_${fixtureA.unique}`,
          ],
        );
        const updatedMessages = await client.query<{
          id: string;
          status: string;
          channel_identity_id: string;
        }>(
          `update conversation_messages
              set status = 'sent'
            where tenant_id = $1 and id in ($2, $3)
            returning id, status, channel_identity_id`,
          [fixtureA.tenantId, twilioOutboundMessageId, metaOutboundMessageId],
        );
        return {
          classifications: classifications.rows,
          insertedDeliveries: insertedDeliveries.rows,
          updatedDeliveries: updatedDeliveries.rows,
          updatedMessages: updatedMessages.rows,
        };
      },
    );
    expect(outboundRlsWrites.classifications).toEqual([
      { id: metaOutboundMessageId, internal: false },
      { id: twilioOutboundMessageId, internal: false },
    ]);
    expect(
      outboundRlsWrites.insertedDeliveries.sort((left, right) =>
        left.provider.localeCompare(right.provider),
      ),
    ).toEqual([
      { provider: "whatsapp_meta", status: "reserved" },
      { provider: "whatsapp_twilio", status: "reserved" },
    ]);
    expect(
      outboundRlsWrites.updatedDeliveries.sort((left, right) =>
        left.provider.localeCompare(right.provider),
      ),
    ).toEqual([
      { provider: "whatsapp_meta", status: "accepted" },
      { provider: "whatsapp_twilio", status: "accepted" },
    ]);
    expect(
      outboundRlsWrites.updatedMessages.sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    ).toEqual([
      {
        id: metaOutboundMessageId,
        status: "sent",
        channel_identity_id: outboundSystemIdentityId,
      },
      {
        id: twilioOutboundMessageId,
        status: "sent",
        channel_identity_id: outboundSystemIdentityId,
      },
    ]);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `update conversation_messages message
                set channel_identity_id = $1
               from conversation_action_plans plan
              where plan.tenant_id = $2 and plan.id = $3
                and message.tenant_id = plan.tenant_id
                and message.id = plan.source_message_id`,
            [genericSystemIdentityId, fixtureA.tenantId, revisionId],
          ),
      ),
    ).rejects.toThrow(/conversation_message_identity_immutable/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        hiddenUser.id,
        (client) =>
          client.query(
            `insert into channel_provider_media_imports (
               id, tenant_id, provider, endpoint_id, message_id, media_kind,
               reservation_status, request_fingerprint, safe_error_code,
               created_at, updated_at
             ) values (
               $1, $2, 'whatsapp_meta', $3, $4, 'document',
               'not_configured', $5, 'media_reference_vault_not_configured',
               $6, $6
             )`,
            [
              `media_hidden_internal_${fixtureA.unique}`,
              fixtureA.tenantId,
              metaEndpointId,
              protectedMessageId,
              "5".repeat(64),
              occurredAt,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const visibleLineage = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.userId,
      (client) =>
        client.query<{ id: string; supersedes_plan_id: string | null }>(
          `select id, supersedes_plan_id from conversation_action_plans
           where id in ($1, $2) order by id`,
          [fixtureA.planId, revisionId],
        ),
    );
    expect(visibleLineage.rows).toEqual(
      [
        { id: fixtureA.planId, supersedes_plan_id: null },
        { id: revisionId, supersedes_plan_id: fixtureA.planId },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const hiddenOtherTenant = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.userId,
      (client) =>
        client.query<{ id: string }>(
          "select id from conversation_action_plans where tenant_id = $1",
          [fixtureB.tenantId],
        ),
    );
    expect(hiddenOtherTenant.rows).toEqual([]);

    const directRevisionUpdate = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.userId,
      (client) =>
        client.query<{ id: string }>(
          `update conversation_action_plans
           set revision_request_fingerprint = $1
           where id = $2 returning id`,
          ["0".repeat(64), revisionId],
        ),
    );
    expect(directRevisionUpdate.rows).toEqual([]);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_action_plans (
               id, tenant_id, thread_id, source_message_id, schema_version,
               generation_source, model_reference, approval_status, intent,
               business_goal, confidence, risk_summary, estimated_cost_minor,
               estimated_cost_currency, plan_json, plan_fingerprint,
               created_by, created_at, updated_at, decided_by, decided_at,
               decision_reason, supersedes_plan_id,
               revision_request_fingerprint
             ) select
               $1, tenant_id, thread_id, source_message_id, schema_version,
               generation_source, model_reference, approval_status, intent,
               business_goal, confidence, risk_summary, estimated_cost_minor,
               estimated_cost_currency, plan_json, $2, created_by, created_at,
               updated_at, null, null, null, null, null
             from conversation_action_plans
             where tenant_id = $3 and id = $4`,
            [
              `plan_direct_write_${fixtureA.unique}`,
              "1".repeat(64),
              fixtureA.tenantId,
              revisionId,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_thread_participants (
               tenant_id, thread_id, channel_identity_id, joined_at
             ) select plan.tenant_id, plan.thread_id, $1, plan.created_at
               from conversation_action_plans plan
               where plan.tenant_id = $2 and plan.id = $3`,
            [genericSystemIdentityId, fixtureA.tenantId, revisionId],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_messages (
               id, tenant_id, thread_id, channel_identity_id, direction, kind,
               status, text_content, adapter_key, external_message_id,
               idempotency_key, correlation_id, causation_id, safe_error_code,
               occurred_at, created_at
             ) select $1, plan.tenant_id, plan.thread_id, $2, 'inbound', 'text',
                 'received', 'Usurpation système', 'web-chat', $3, $4, $5,
                 plan.source_message_id, null, plan.created_at, plan.created_at
               from conversation_action_plans plan
               where plan.tenant_id = $6 and plan.id = $7`,
            [
              `message_generic_system_${fixtureA.unique}`,
              genericSystemIdentityId,
              `external_generic_system_${fixtureA.unique}`,
              `ingress:generic-system:${fixtureA.unique}`,
              `correlation_system_${fixtureA.unique}`,
              fixtureA.tenantId,
              revisionId,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_message_route_hops (
               tenant_id, message_id, position, adapter_key,
               channel_identity_id, external_message_id
             ) select message.tenant_id, message.id, 6, 'system-test', $1, $2
               from conversation_messages message
               join conversation_action_plans plan
                 on plan.tenant_id = message.tenant_id
                and plan.source_message_id = message.id
               where plan.tenant_id = $3 and plan.id = $4`,
            [
              genericSystemIdentityId,
              `route_generic_system_${fixtureA.unique}`,
              fixtureA.tenantId,
              revisionId,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_participants (
               id, tenant_id, role, display_name, created_at, updated_at
             ) values ($1, $2, 'member', 'Usurpation', $3, $3)`,
            [
              `orchestrator_participant_spoof_${fixtureA.unique}`,
              fixtureA.tenantId,
              occurredAt,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_channel_identities (
               id, tenant_id, participant_id, channel_kind, adapter_key,
               external_subject_id, display_name, role, state, created_at,
               updated_at
             ) select $1, identity.tenant_id, identity.participant_id, 'test',
                 'orchestrator-mock', $2, 'Usurpation', 'member', 'active',
                 $3, $3
               from conversation_channel_identities identity
               where identity.tenant_id = $4
                 and identity.adapter_key = 'web-chat'
               limit 1`,
            [
              `identity_spoof_${fixtureA.unique}`,
              `subject_spoof_${fixtureA.unique}`,
              occurredAt,
              fixtureA.tenantId,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_messages (
               id, tenant_id, thread_id, channel_identity_id, direction, kind,
               status, text_content, adapter_key, external_message_id,
               idempotency_key, correlation_id, causation_id, safe_error_code,
               occurred_at, created_at
             ) select $1, message.tenant_id, message.thread_id,
                 message.channel_identity_id, 'inbound', 'text', 'received',
                 'Usurpation', message.adapter_key, $2, $3, $4, message.id,
                 null, message.occurred_at, message.created_at
               from conversation_messages message
               join conversation_action_plans plan
                 on plan.tenant_id = message.tenant_id
                and plan.source_message_id = message.id
               where plan.tenant_id = $5 and plan.id = $6`,
            [
              `message_reserved_key_${fixtureA.unique}`,
              `external_reserved_key_${fixtureA.unique}`,
              `orchestrator:future_${fixtureA.unique}:approved`,
              `correlation_reserved_${fixtureA.unique}`,
              fixtureA.tenantId,
              revisionId,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.userId,
        (client) =>
          client.query(
            `insert into conversation_messages (
               id, tenant_id, thread_id, channel_identity_id, direction, kind,
               status, text_content, adapter_key, external_message_id,
               idempotency_key, correlation_id, causation_id, safe_error_code,
               occurred_at, created_at
             ) select $1, plan.tenant_id, plan.thread_id, identity.id,
                 'inbound', 'text', 'received', 'Usurpation', 'web-chat', $2,
                 $3, $4, plan.source_message_id, null, plan.created_at,
                 plan.created_at
               from conversation_action_plans plan
               join conversation_channel_identities identity
                 on identity.tenant_id = plan.tenant_id
                and identity.adapter_key = 'orchestrator-mock'
                and identity.external_subject_id =
                  'tradikom-one-orchestrator'
               where plan.tenant_id = $5 and plan.id = $6`,
            [
              `message_reserved_identity_${fixtureA.unique}`,
              `external_reserved_identity_${fixtureA.unique}`,
              `ingress:reserved-identity:${fixtureA.unique}`,
              `correlation_identity_${fixtureA.unique}`,
              fixtureA.tenantId,
              revisionId,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const reservedAttachmentId = `attachment_reserved_${fixtureA.unique}`;
    const hiddenAttachmentInsert = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.userId,
      (client) =>
        client.query(
          `insert into conversation_message_attachments (
             id, tenant_id, message_id, kind, file_name, media_type,
             size_bytes, storage_reference, checksum_sha256, created_at
           ) select $1, message.tenant_id, message.id, 'document',
               'usurpation.txt', 'text/plain', 12, $2, $3,
               message.created_at
             from conversation_messages message
             where message.tenant_id = $4
               and message.idempotency_key = $5`,
          [
            reservedAttachmentId,
            `mock:reserved/${fixtureA.unique}`,
            "2".repeat(64),
            fixtureA.tenantId,
            `orchestrator:${revisionId}:proposal`,
          ],
        ),
    );
    expect(hiddenAttachmentInsert.rowCount).toBe(0);

    const reservedRouteExternalId = `route_reserved_${fixtureA.unique}`;
    const hiddenRouteInsert = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.userId,
      (client) =>
        client.query(
          `insert into conversation_message_route_hops (
             tenant_id, message_id, position, adapter_key,
             channel_identity_id, external_message_id
           ) select message.tenant_id, message.id, 7, identity.adapter_key,
               identity.id, $1
             from conversation_messages message
             join conversation_channel_identities identity
               on identity.tenant_id = message.tenant_id
              and identity.adapter_key = 'web-chat'
             where message.tenant_id = $2
               and message.idempotency_key = $3
             limit 1`,
          [
            reservedRouteExternalId,
            fixtureA.tenantId,
            `orchestrator:${revisionId}:proposal`,
          ],
        ),
    );
    expect(hiddenRouteInsert.rowCount).toBe(0);

    const absentDerivedRows = await primaryPool.query<{
      attachment_count: number;
      route_count: number;
    }>(
      `select
         (select count(*)::int
            from conversation_message_attachments
           where tenant_id = $1 and id = $2) as attachment_count,
         (select count(*)::int
            from conversation_message_route_hops
           where tenant_id = $1 and external_message_id = $3) as route_count`,
      [fixtureA.tenantId, reservedAttachmentId, reservedRouteExternalId],
    );
    expect(absentDerivedRows.rows).toEqual([
      { attachment_count: 0, route_count: 0 },
    ]);
  });
});

async function createPlanFixture(
  db: SqlClient,
  ownerPool: Pool,
  label: "a" | "b" | "c",
) {
  const unique = randomUUID().replaceAll("-", "");
  const services = createServices(db);
  const user = await services.registerUser({
    name: `Responsable révision ${label}`,
    email: `plan-revision-postgres-${label}-${unique}@example.test`,
    password: "Password!1",
  });
  const cleanupFixture: (typeof createdFixtures)[number] = {
    ownerPool,
    userId: user.id,
  };
  createdFixtures.push(cleanupFixture);
  const tenant = await services.createTenant(user.id, {
    name: `Organisation révision ${label} ${unique}`,
    category: "Services",
  });
  cleanupFixture.tenantId = tenant.id;
  const source = await ingestConversationMessage(db, user.id, {
    tenantId: tenant.id,
    channelIdentity: {
      id: `identity_revision_${label}_${unique}`,
      tenantId: tenant.id,
      participantId: `participant_revision_${label}_${unique}`,
      channelKind: "web" as const,
      adapterKey: "web-chat",
      externalSubjectId: `member_revision_${label}_${unique}`,
      displayName: "Membre de démonstration",
      role: "member" as const,
      state: "active" as const,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    externalMessageId: `external_revision_${label}_${unique}`,
    idempotencyKey: `ingress:revision:${label}:${unique}`,
    correlationId: `correlation_revision_${label}_${unique}`,
    routeTrace: [],
    text: "Préparer une relance commerciale sans effet externe.",
    attachments: [],
    occurredAt,
  });
  const plan = await createConversationActionPlan(db, user.id, {
    tenantId: tenant.id,
    threadId: source.threadId,
    sourceMessageId: source.messageId,
  });
  return {
    unique,
    userId: user.id,
    tenantId: tenant.id,
    planId: plan.id,
  };
}

async function withTemporaryPostgresDatabase(
  run: (pool: Pool) => Promise<void>,
) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  const databaseName =
    `plan_revision_upgrade_${randomUUID().replaceAll("-", "")}`;
  const databaseIdentifier = quoteIdentifier(databaseName);
  await adminPool.query(`create database ${databaseIdentifier}`);
  const targetUrl = new URL(databaseUrl);
  targetUrl.pathname = `/${databaseName}`;
  const targetPool = new Pool({ connectionString: targetUrl.toString(), max: 2 });
  try {
    await run(targetPool);
  } finally {
    await targetPool.end();
    await adminPool.query(`drop database if exists ${databaseIdentifier}`);
    await adminPool.end();
  }
}

async function seedHistoricalCanonicalPlanProjection(
  pool: Pool,
  input: {
    tenantId: string;
    userId: string;
    threadId: string;
    sourceMessageId: string;
  },
) {
  const tenantFingerprint = createHash("sha256")
    .update(input.tenantId)
    .digest("hex")
    .slice(0, 32);
  const planId = `conversation_action_plan_${randomUUID().replaceAll("-", "")}`;
  const participantId = `orchestrator_participant_${tenantFingerprint}`;
  const identityId = `orchestrator_identity_${tenantFingerprint}`;
  const proposalText = "Préparer une relance commerciale sans effet externe.";
  const planJson = JSON.stringify({ finalUserMessageDraft: proposalText });

  await pool.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'system', 'TRADIKOM ONE', $3, $3)`,
    [participantId, input.tenantId, occurredAt],
  );
  await pool.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'test', 'orchestrator-mock',
       'tradikom-one-orchestrator', 'TRADIKOM ONE', 'system', 'active',
       $4, $4
     )`,
    [identityId, input.tenantId, participantId, occurredAt],
  );
  await pool.query(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, model_reference, approval_status, intent,
       business_goal, confidence, risk_summary, estimated_cost_minor,
       estimated_cost_currency, plan_json, plan_fingerprint, created_by,
       created_at, updated_at, decided_by, decided_at, decision_reason,
       supersedes_plan_id, revision_request_fingerprint
     ) values (
       $1, $2, $3, $4, 1, 'deterministic_mock', null, 'awaiting_approval',
       'Préparer une relance', 'Assurer un suivi durable', 0.95,
       'Aucun effet externe', 0, 'EUR', $5, $6, $7, $8, $8,
       null, null, null, null, null
     )`,
    [
      planId,
      input.tenantId,
      input.threadId,
      input.sourceMessageId,
      planJson,
      createHash("sha256").update(planJson).digest("hex"),
      input.userId,
      occurredAt,
    ],
  );
  await pool.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind,
       status, text_content, adapter_key, external_message_id,
       idempotency_key, correlation_id, causation_id, safe_error_code,
       occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'internal', 'plan', 'received', $5,
       'orchestrator-mock', $6, $7, $8, $9, null, $10, $10
     )`,
    [
      `conversation_message_${randomUUID().replaceAll("-", "")}`,
      input.tenantId,
      input.threadId,
      identityId,
      proposalText,
      `${planId}:proposal`,
      `orchestrator:${planId}:proposal`,
      `correlation_upgrade_${randomUUID().replaceAll("-", "")}`,
      input.sourceMessageId,
      occurredAt,
    ],
  );

  return planId;
}

async function readBackendPid(pool: Pool) {
  const result = await pool.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return result.rows[0]!.pid;
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_plan_revision_${randomUUID().replaceAll("-", "")}`;
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
  actorId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
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
