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
  finalizeWhatsAppOutboundDelivery,
  findWhatsAppOutboundContext,
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
  dependencies: {
    adapter: WhatsAppTwilioOutboundAdapter;
    evaluatePolicy: WhatsAppOutboundPolicyEvaluator;
  },
) {
  const parsed = whatsappOutboundRequestSchema.parse(input);
  const prepared = await withTenantDbTransaction(
    db,
    parsed.tenantId,
    actorId,
    async (transaction) => {
      await assertTenantAccess(
        transaction,
        actorId,
        parsed.tenantId,
        outboundRoles,
      );
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
        return { row: existing, replayed: true as const, request: null };
      }

      const context = await findWhatsAppOutboundContext(transaction, parsed);
      assertValidContext(context);
      const reservation = await reserveWhatsAppOutboundDelivery(transaction, {
        id: id("channel_delivery"),
        tenantId: parsed.tenantId,
        endpointId: parsed.endpointId,
        messageId: parsed.messageId,
        channelIdentityId: parsed.channelIdentityId,
        idempotencyKey: parsed.idempotencyKey,
        requestFingerprint,
        actorId,
        occurredAt: nowIso(),
      });
      if (!reservation.row) throw deliveryNotFound();
      assertMatchingFingerprint(reservation.row, requestFingerprint);
      if (reservation.replayed) {
        return { row: reservation.row, replayed: true as const, request: null };
      }

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

      const policy = await evaluatePolicySafely(dependencies.evaluatePolicy, {
        tenantId: parsed.tenantId,
        actorId,
        endpointId: parsed.endpointId,
        messageId: parsed.messageId,
        channelIdentityId: parsed.channelIdentityId,
        messageKind: context.message_kind,
        providerState: dependencies.adapter.manifest.state,
      });
      if (!policy.allowed) {
        const denied = await finalizeWhatsAppOutboundDelivery(transaction, {
          tenantId: parsed.tenantId,
          deliveryId: reservation.row.id,
          status: "denied",
          externalMessageId: null,
          failureClassification: "policy",
          safeErrorCode: "policy_denied",
          retryable: false,
          updatedAt: nowIso(),
        });
        if (!denied) throw deliveryNotFound();
        await requireMessageStateUpdate(transaction, denied);
        await recordCompletionAudit(transaction, actorId, denied, policy.code);
        return { row: denied, replayed: false as const, request: null };
      }

      return {
        row: reservation.row,
        replayed: false as const,
        request: {
          tenantId: parsed.tenantId,
          channelIdentityId: parsed.channelIdentityId,
          messageId: parsed.messageId,
          idempotencyKey: parsed.idempotencyKey,
          text: context.text_content!,
        },
      };
    },
  );

  if (prepared.replayed || !prepared.request) {
    return mapDelivery(prepared.row, prepared.replayed);
  }

  const outcome = await dependencies.adapter.sendMessage(prepared.request);
  const normalized = normalizeDeliveryOutcome(outcome);

  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    actorId,
    async (transaction) => {
      await assertTenantAccess(
        transaction,
        actorId,
        parsed.tenantId,
        outboundRoles,
      );
      const finalized = await finalizeWhatsAppOutboundDelivery(transaction, {
        tenantId: parsed.tenantId,
        deliveryId: prepared.row.id,
        ...normalized,
        updatedAt: nowIso(),
      });
      if (!finalized) {
        const replay = await findWhatsAppOutboundDeliveryByIdempotency(
          transaction,
          {
            tenantId: parsed.tenantId,
            idempotencyKey: parsed.idempotencyKey,
          },
        );
        if (!replay) throw deliveryNotFound();
        return mapDelivery(replay, true);
      }
      await requireMessageStateUpdate(transaction, finalized);
      await recordCompletionAudit(transaction, actorId, finalized);
      return mapDelivery(finalized, false);
    },
  );
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
): asserts context is WhatsAppOutboundContextRow & { text_content: string } {
  if (!context) {
    throw new WhatsAppOutboundError(
      "whatsapp_outbound_context_not_found",
      "Le contexte de livraison WhatsApp est introuvable.",
    );
  }
  if (
    context.endpoint_status !== "active" ||
    context.message_direction !== "outbound" ||
    context.message_status !== "pending" ||
    !context.text_content ||
    context.identity_adapter_key !== "whatsapp-twilio" ||
    context.identity_state !== "active" ||
    context.identity_role !== "customer" ||
    !Boolean(context.target_in_thread)
  ) {
    throw new WhatsAppOutboundError(
      "whatsapp_outbound_context_invalid",
      "Le contexte de livraison WhatsApp n'est pas autorisé.",
    );
  }
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

async function recordCompletionAudit(
  db: DbClient,
  actorId: string,
  delivery: ChannelProviderDeliveryRow,
  policyCode?: string,
) {
  const action =
    delivery.status === "accepted" || delivery.status === "delivered"
      ? "channel.whatsapp_outbound_succeeded"
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
) {
  const status =
    delivery.status === "accepted"
      ? "sent"
      : delivery.status === "delivered"
        ? "delivered"
        : "failed";
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

function deliveryNotFound() {
  return new WhatsAppOutboundError(
    "whatsapp_outbound_delivery_not_found",
    "La livraison WhatsApp est introuvable.",
  );
}
