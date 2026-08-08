import { z } from "zod";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import type {
  ChannelDeliveryResult,
  ChannelProviderFailureClassification,
} from "@/modules/channels/contracts";
import {
  claimWhatsAppOutboundDeliveryAttempt,
  finalizeClaimedWhatsAppOutboundDelivery,
  findWhatsAppOutboundContext,
  findWhatsAppOutboundDeliveryById,
  findWhatsAppOutboundDeliveryByIdempotency,
  reserveWhatsAppOutboundDelivery,
  updateWhatsAppOutboundMessageState,
  type ChannelProviderDeliveryRow,
  type WhatsAppOutboundContextRow,
} from "@/modules/channels/whatsapp-twilio-outbound-repository";
import type { WhatsAppTwilioOutboundAdapter } from "@/modules/channels/whatsapp-twilio-outbound";
import { assertTenantAccess } from "@/modules/tenants";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const whatsappOutboundRequestSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    messageId: boundedIdentifierSchema,
    channelIdentityId: boundedIdentifierSchema,
    idempotencyKey: boundedIdentifierSchema.min(8),
  })
  .strict();

const whatsappOutboundAttemptSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    deliveryId: boundedIdentifierSchema,
  })
  .strict();

const policyDecisionSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }).strict(),
  z
    .object({
      allowed: z.literal(false),
      code: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[a-z][a-z0-9_]*$/),
    })
    .strict(),
]);

const outboundRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const defaultMaxAttempts = 3;
const defaultLeaseMs = 60_000;
const defaultBaseBackoffMs = 1_000;

export type WhatsAppOutboundPolicyContext = {
  tenantId: string;
  actorId: string;
  endpointId: string;
  messageId: string;
  channelIdentityId: string;
  messageKind: WhatsAppOutboundContextRow["message_kind"];
  providerState: WhatsAppTwilioOutboundAdapter["manifest"]["state"];
};

export type WhatsAppOutboundPolicyEvaluator = (
  context: WhatsAppOutboundPolicyContext,
) =>
  | { allowed: true }
  | { allowed: false; code: string }
  | Promise<{ allowed: true } | { allowed: false; code: string }>;

export type WhatsAppOutboundDependencies = {
  adapter: WhatsAppTwilioOutboundAdapter;
  evaluatePolicy: WhatsAppOutboundPolicyEvaluator;
};

export type WhatsAppOutboundAttemptOptions = {
  now?: Date;
  leaseMs?: number;
  baseBackoffMs?: number;
  maxAttempts?: number;
};

export class WhatsAppOutboundError extends Error {
  constructor(
    public readonly code:
      | "whatsapp_outbound_context_not_found"
      | "whatsapp_outbound_context_invalid"
      | "whatsapp_outbound_idempotency_conflict"
      | "whatsapp_outbound_delivery_not_found",
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppOutboundError";
  }
}

export async function sendPreparedWhatsAppOutbound(
  db: DbClient,
  actorId: string,
  input: z.input<typeof whatsappOutboundRequestSchema>,
  dependencies: WhatsAppOutboundDependencies,
  options: WhatsAppOutboundAttemptOptions = {},
) {
  const parsed = whatsappOutboundRequestSchema.parse(input);
  const occurredAt = (options.now ?? new Date(nowIso())).toISOString();
  const maxAttempts = boundedPositiveInteger(
    options.maxAttempts,
    defaultMaxAttempts,
    10,
  );
  const prepared = await withTenantDbTransaction(
    db,
    parsed.tenantId,
    actorId,
    async (transaction) => {
      await assertOutboundAccess(transaction, actorId, parsed.tenantId);
      const requestFingerprint = hashToken(
        JSON.stringify([
          "whatsapp_twilio",
          parsed.endpointId,
          parsed.messageId,
          parsed.channelIdentityId,
        ]),
      );
      const existing = await findWhatsAppOutboundDeliveryByIdempotency(
        transaction,
        {
          tenantId: parsed.tenantId,
          idempotencyKey: parsed.idempotencyKey,
        },
      );
      if (existing) {
        assertMatchingFingerprint(existing, requestFingerprint);
        return existing;
      }

      const context = await findWhatsAppOutboundContext(transaction, parsed);
      assertValidContext(context, false);
      const reservation = await reserveWhatsAppOutboundDelivery(transaction, {
        id: id("channel_delivery"),
        tenantId: parsed.tenantId,
        endpointId: parsed.endpointId,
        messageId: parsed.messageId,
        channelIdentityId: parsed.channelIdentityId,
        idempotencyKey: parsed.idempotencyKey,
        requestFingerprint,
        actorId,
        occurredAt,
        maxAttempts,
      });
      if (!reservation.row) throw deliveryNotFound();
      assertMatchingFingerprint(reservation.row, requestFingerprint);
      if (!reservation.replayed) {
        await recordAuditLog(transaction, {
          tenantId: parsed.tenantId,
          actorId,
          action: "channel.whatsapp_outbound_reserved",
          targetType: "channel_provider_delivery",
          targetId: reservation.row.id,
          metadata: {
            provider: "whatsapp_twilio",
            messageId: parsed.messageId,
            transportState: dependencies.adapter.manifest.state,
            contentStoredInAudit: false,
          },
        });
      }
      return reservation.row;
    },
  );

  return attemptPreparedWhatsAppOutboundDelivery(
    db,
    actorId,
    { tenantId: parsed.tenantId, deliveryId: prepared.id },
    dependencies,
    options,
  );
}

export async function attemptPreparedWhatsAppOutboundDelivery(
  db: DbClient,
  actorId: string,
  input: z.input<typeof whatsappOutboundAttemptSchema>,
  dependencies: WhatsAppOutboundDependencies,
  options: WhatsAppOutboundAttemptOptions = {},
) {
  const parsed = whatsappOutboundAttemptSchema.parse(input);
  const attemptedAt = options.now ?? new Date(nowIso());
  const attemptedAtIso = attemptedAt.toISOString();
  const leaseMs = boundedPositiveInteger(options.leaseMs, defaultLeaseMs, 600_000);
  const leaseId = id("channel_delivery_lease");
  const leaseExpiresAt = new Date(attemptedAt.getTime() + leaseMs).toISOString();

  const prepared = await withTenantDbTransaction(
    db,
    parsed.tenantId,
    actorId,
    async (transaction) => {
      await assertOutboundAccess(transaction, actorId, parsed.tenantId);
      const beforeClaim = await findWhatsAppOutboundDeliveryById(transaction, {
        tenantId: parsed.tenantId,
        deliveryId: parsed.deliveryId,
      });
      if (!beforeClaim) throw deliveryNotFound();
      const claimed = await claimWhatsAppOutboundDeliveryAttempt(transaction, {
        tenantId: parsed.tenantId,
        deliveryId: parsed.deliveryId,
        leaseId,
        attemptedAt: attemptedAtIso,
        leaseExpiresAt,
      });
      if (!claimed) {
        return { row: beforeClaim, replayed: true as const, request: null };
      }

      await recordAttemptAudit(
        transaction,
        actorId,
        claimed,
        dependencies.adapter.manifest.state,
      );
      const context = await findWhatsAppOutboundContext(transaction, {
        tenantId: claimed.tenant_id,
        endpointId: claimed.endpoint_id,
        messageId: claimed.message_id,
        channelIdentityId: claimed.channel_identity_id,
      });
      if (!isValidContext(context, claimed.status === "failed")) {
        const invalid = await finalizeClaimedWhatsAppOutboundDelivery(
          transaction,
          terminalOutcome(claimed, leaseId, attemptedAtIso, "validation"),
        );
        if (!invalid) throw deliveryNotFound();
        await updateWhatsAppOutboundMessageState(transaction, {
          tenantId: invalid.tenant_id,
          messageId: invalid.message_id,
          status: "failed",
          safeErrorCode: invalid.safe_error_code,
        });
        await recordCompletionAudit(transaction, actorId, invalid);
        return { row: invalid, replayed: false as const, request: null };
      }

      const policy = await evaluatePolicySafely(dependencies.evaluatePolicy, {
        tenantId: claimed.tenant_id,
        actorId,
        endpointId: claimed.endpoint_id,
        messageId: claimed.message_id,
        channelIdentityId: claimed.channel_identity_id,
        messageKind: context.message_kind,
        providerState: dependencies.adapter.manifest.state,
      });
      if (!policy.allowed) {
        const denied = await finalizeClaimedWhatsAppOutboundDelivery(
          transaction,
          terminalOutcome(claimed, leaseId, attemptedAtIso, "policy"),
        );
        if (!denied) throw deliveryNotFound();
        await requireMessageStateUpdate(transaction, denied, "failed");
        await recordCompletionAudit(transaction, actorId, denied, policy.code);
        return { row: denied, replayed: false as const, request: null };
      }

      return {
        row: claimed,
        replayed: false as const,
        request: {
          tenantId: claimed.tenant_id,
          endpointId: claimed.endpoint_id,
          channelIdentityId: claimed.channel_identity_id,
          messageId: claimed.message_id,
          idempotencyKey: claimed.idempotency_key,
          text: context.text_content,
        },
      };
    },
  );

  if (prepared.replayed || !prepared.request) {
    return mapDelivery(prepared.row, prepared.replayed);
  }

  const outcome = normalizeDeliveryOutcome(
    await dependencies.adapter.sendMessage(prepared.request),
  );
  const baseBackoffMs = boundedPositiveInteger(
    options.baseBackoffMs,
    defaultBaseBackoffMs,
    60_000,
  );
  const completedAt = options.now ?? new Date(nowIso());
  const completedAtIso = completedAt.toISOString();
  const retryScheduled =
    outcome.retryable && prepared.row.attempts < prepared.row.max_attempts;
  const nextAttemptAt = retryScheduled
    ? new Date(
        completedAt.getTime() +
          baseBackoffMs * 2 ** Math.max(0, prepared.row.attempts - 1),
      ).toISOString()
    : completedAtIso;
  const finalOutcome = retryScheduled
    ? outcome
    : outcome.retryable
      ? {
          ...outcome,
          retryable: false,
          safeErrorCode: "max_attempts_exceeded",
        }
      : outcome;

  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    actorId,
    async (transaction) => {
      await assertOutboundAccess(transaction, actorId, parsed.tenantId);
      const finalized = await finalizeClaimedWhatsAppOutboundDelivery(
        transaction,
        {
          tenantId: parsed.tenantId,
          deliveryId: prepared.row.id,
          ...finalOutcome,
          nextAttemptAt,
          leaseId,
          updatedAt: completedAtIso,
        },
      );
      if (!finalized) {
        const replay = await findWhatsAppOutboundDeliveryById(transaction, {
          tenantId: parsed.tenantId,
          deliveryId: prepared.row.id,
        });
        if (!replay) throw deliveryNotFound();
        return mapDelivery(replay, true);
      }

      const messageStatus = retryScheduled
        ? "pending"
        : finalized.status === "accepted"
          ? "sent"
          : finalized.status === "delivered"
            ? "delivered"
            : "failed";
      await requireMessageStateUpdate(transaction, finalized, messageStatus);
      await recordCompletionAudit(transaction, actorId, finalized);
      return mapDelivery(finalized, false);
    },
  );
}

async function assertOutboundAccess(
  db: DbClient,
  actorId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, actorId, tenantId, outboundRoles);
}

async function evaluatePolicySafely(
  evaluator: WhatsAppOutboundPolicyEvaluator,
  context: WhatsAppOutboundPolicyContext,
) {
  try {
    return policyDecisionSchema.parse(await evaluator(context));
  } catch {
    return { allowed: false as const, code: "policy_evaluation_failed" };
  }
}

function assertValidContext(
  context: WhatsAppOutboundContextRow | null,
  allowFailedMessage: boolean,
): asserts context is WhatsAppOutboundContextRow & { text_content: string } {
  if (!context) {
    throw new WhatsAppOutboundError(
      "whatsapp_outbound_context_not_found",
      "Le contexte de livraison WhatsApp est introuvable.",
    );
  }
  if (!isValidContext(context, allowFailedMessage)) {
    throw new WhatsAppOutboundError(
      "whatsapp_outbound_context_invalid",
      "Le contexte de livraison WhatsApp n'est pas autorisé.",
    );
  }
}

function isValidContext(
  context: WhatsAppOutboundContextRow | null,
  allowFailedMessage: boolean,
): context is WhatsAppOutboundContextRow & { text_content: string } {
  return Boolean(
    context &&
      context.endpoint_status === "active" &&
      context.message_direction === "outbound" &&
      (context.message_status === "pending" ||
        (allowFailedMessage && context.message_status === "failed")) &&
      context.text_content &&
      context.identity_adapter_key === "whatsapp-twilio" &&
      context.identity_state === "active" &&
      context.identity_role === "customer" &&
      context.target_in_thread,
  );
}

function normalizeDeliveryOutcome(outcome: ChannelDeliveryResult): {
  status: Exclude<ChannelProviderDeliveryRow["status"], "reserved">;
  externalMessageId: string | null;
  failureClassification: ChannelProviderFailureClassification | null;
  safeErrorCode: string | null;
  retryable: boolean;
} {
  if (
    (outcome.status === "accepted" || outcome.status === "delivered") &&
    outcome.externalMessageId
  ) {
    return {
      status: outcome.status,
      externalMessageId: outcome.externalMessageId,
      failureClassification: null,
      safeErrorCode: null,
      retryable: false,
    };
  }

  const classification = outcome.classification ?? "validation";
  return {
    status:
      classification === "policy" || classification === "not_configured"
        ? "denied"
        : "failed",
    externalMessageId: null,
    failureClassification: classification,
    safeErrorCode: outcome.errorCode ?? "validation_failed",
    retryable: outcome.retryable,
  };
}

function terminalOutcome(
  delivery: ChannelProviderDeliveryRow,
  leaseId: string,
  updatedAt: string,
  classification: "policy" | "validation",
) {
  return {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    status: classification === "policy" ? ("denied" as const) : ("failed" as const),
    externalMessageId: null,
    failureClassification: classification,
    safeErrorCode:
      classification === "policy" ? "policy_denied" : "validation_failed",
    retryable: false,
    nextAttemptAt: updatedAt,
    leaseId,
    updatedAt,
  };
}

async function recordAttemptAudit(
  db: DbClient,
  actorId: string,
  delivery: ChannelProviderDeliveryRow,
  transportState: WhatsAppTwilioOutboundAdapter["manifest"]["state"],
) {
  await recordAuditLog(db, {
    tenantId: delivery.tenant_id,
    actorId,
    action: "channel.whatsapp_outbound_attempted",
    targetType: "channel_provider_delivery",
    targetId: delivery.id,
    metadata: {
      provider: delivery.provider,
      attempt: delivery.attempts,
      maxAttempts: delivery.max_attempts,
      transportState,
      contentStoredInAudit: false,
      providerReferenceStoredInAudit: false,
    },
  });
}

async function recordCompletionAudit(
  db: DbClient,
  actorId: string,
  delivery: ChannelProviderDeliveryRow,
  policyCode?: string,
) {
  const action =
    delivery.status === "accepted" || delivery.status === "delivered"
      ? "channel.whatsapp_outbound_succeeded"
      : delivery.retryable
        ? "channel.whatsapp_outbound_retry_scheduled"
        : delivery.status === "denied"
          ? "channel.whatsapp_outbound_denied"
          : "channel.whatsapp_outbound_failed";
  await recordAuditLog(db, {
    tenantId: delivery.tenant_id,
    actorId,
    action,
    targetType: "channel_provider_delivery",
    targetId: delivery.id,
    metadata: {
      provider: delivery.provider,
      status: delivery.status,
      classification: delivery.failure_classification,
      retryable: Boolean(delivery.retryable),
      attempt: delivery.attempts,
      maxAttempts: delivery.max_attempts,
      ...(policyCode ? { policyCode } : {}),
      contentStoredInAudit: false,
      providerReferenceStoredInAudit: false,
    },
  });
}

function mapDelivery(row: ChannelProviderDeliveryRow, replayed: boolean) {
  return {
    deliveryId: row.id,
    status: row.status,
    classification: row.failure_classification,
    safeErrorCode: row.safe_error_code,
    retryable: row.retryable === null ? null : Boolean(row.retryable),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    idempotentReplay: replayed,
  };
}

function assertMatchingFingerprint(
  delivery: ChannelProviderDeliveryRow,
  requestFingerprint: string,
) {
  if (delivery.request_fingerprint !== requestFingerprint) {
    throw new WhatsAppOutboundError(
      "whatsapp_outbound_idempotency_conflict",
      "La clé d'idempotence correspond à un autre envoi WhatsApp.",
    );
  }
}

async function requireMessageStateUpdate(
  db: DbClient,
  delivery: ChannelProviderDeliveryRow,
  status: "pending" | "sent" | "delivered" | "failed",
) {
  const updated = await updateWhatsAppOutboundMessageState(db, {
    tenantId: delivery.tenant_id,
    messageId: delivery.message_id,
    status,
    safeErrorCode: delivery.safe_error_code,
  });
  if (!updated) {
    throw new WhatsAppOutboundError(
      "whatsapp_outbound_context_invalid",
      "Le message WhatsApp ne peut pas être réconcilié.",
    );
  }
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  return Number.isInteger(value) && value !== undefined && value > 0 && value <= maximum
    ? value
    : fallback;
}

function deliveryNotFound() {
  return new WhatsAppOutboundError(
    "whatsapp_outbound_delivery_not_found",
    "La livraison WhatsApp est introuvable.",
  );
}
