import { z } from "zod";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { WhatsAppTwilioActivationBudgetError } from "@/modules/channels/whatsapp-twilio-activation-budget-errors";
import {
  countWhatsAppActivationConsumptions,
  findWhatsAppActivationConsumptionByDelivery,
  insertWhatsAppActivationConsumption,
  lockWhatsAppActivationBudgetContext,
  type WhatsAppTwilioActivationConsumptionRow,
} from "@/modules/channels/whatsapp-twilio-activation-budget-repository";
import { assertTenantAccess } from "@/modules/tenants";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const reservationSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    authorizationId: boundedIdentifierSchema.optional(),
    deliveryId: boundedIdentifierSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const consumptionRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];

export async function reserveWhatsAppTwilioActivationBudget(
  db: DbClient,
  actorId: string,
  input: z.input<typeof reservationSchema>,
) {
  const parsed = reservationSchema.parse(input);
  const consumedAt = new Date(parsed.occurredAt ?? nowIso()).toISOString();
  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    actorId,
    async (transaction) => {
      await assertConsumptionAccess(transaction, actorId, parsed.tenantId);
      const existingConsumption =
        await findWhatsAppActivationConsumptionByDelivery(transaction, {
          tenantId: parsed.tenantId,
          deliveryId: parsed.deliveryId,
        });
      const authorizationId =
        parsed.authorizationId ?? existingConsumption?.authorization_id;
      if (!authorizationId) throw invalidBudget();
      const context = await lockWhatsAppActivationBudgetContext(transaction, {
        tenantId: parsed.tenantId,
        endpointId: parsed.endpointId,
        authorizationId,
        deliveryId: parsed.deliveryId,
      });
      if (!context || context.delivery_created_by !== actorId) {
        throw invalidBudget();
      }
      if (
        context.revoked_at ||
        Date.parse(consumedAt) < Date.parse(context.authorized_at) ||
        Date.parse(consumedAt) >= Date.parse(context.expires_at)
      ) {
        throw invalidBudget();
      }

      const replay = existingConsumption;
      if (replay) {
        assertMatchingConsumption(
          replay,
          { ...parsed, authorizationId },
          actorId,
        );
        const usedMessages = await countWhatsAppActivationConsumptions(
          transaction,
          {
            tenantId: parsed.tenantId,
            authorizationId,
          },
        );
        return consumptionResult(
          replay,
          usedMessages,
          context.max_messages,
          true,
        );
      }

      if (!isConsumableDelivery(context)) throw invalidBudget();
      const usedMessages = await countWhatsAppActivationConsumptions(
        transaction,
        {
          tenantId: parsed.tenantId,
          authorizationId,
        },
      );
      if (usedMessages >= context.max_messages) throw exhaustedBudget();

      const row = await insertWhatsAppActivationConsumption(transaction, {
        id: id("channel_activation_consumption"),
        tenant_id: parsed.tenantId,
        provider: "whatsapp_twilio",
        endpoint_id: parsed.endpointId,
        authorization_id: authorizationId,
        delivery_id: parsed.deliveryId,
        consumed_by: actorId,
        consumed_at: consumedAt,
      });
      if (!row) throw invalidBudget();
      const nextUsedMessages = usedMessages + 1;
      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId,
        action: "channel.provider_activation_budget_consumed",
        targetType: "channel_provider_activation_consumption",
        targetId: row.id,
        metadata: {
          provider: "whatsapp_twilio",
          scope: "twilio_whatsapp_sandbox",
          consumedUnits: 1,
          remainingMessages: context.max_messages - nextUsedMessages,
          sensitiveValueRecorded: false,
        },
      });
      return consumptionResult(
        row,
        nextUsedMessages,
        context.max_messages,
        false,
      );
    },
  );
}

async function assertConsumptionAccess(
  db: DbClient,
  actorId: string,
  tenantId: string,
) {
  try {
    await assertTenantAccess(db, actorId, tenantId, consumptionRoles);
  } catch {
    throw new WhatsAppTwilioActivationBudgetError(
      "channel_provider_activation_budget_access_denied",
      "Accès refusé à la consommation du budget d'activation.",
    );
  }
}

function isConsumableDelivery(context: {
  delivery_status: string;
  delivery_retryable: boolean | number | null;
  delivery_failure_classification: string | null;
}) {
  return (
    context.delivery_status === "reserved" ||
    (context.delivery_status === "failed" &&
      Boolean(context.delivery_retryable) &&
      ["temporary", "rate_limit"].includes(
        context.delivery_failure_classification ?? "",
      ))
  );
}

function assertMatchingConsumption(
  row: WhatsAppTwilioActivationConsumptionRow,
  input: z.output<typeof reservationSchema>,
  actorId: string,
) {
  if (
    row.endpoint_id !== input.endpointId ||
    row.authorization_id !== input.authorizationId ||
    row.delivery_id !== input.deliveryId ||
    row.consumed_by !== actorId
  ) {
    throw invalidBudget();
  }
}

function consumptionResult(
  row: WhatsAppTwilioActivationConsumptionRow,
  usedMessages: number,
  maxMessages: number,
  replayed: boolean,
) {
  return {
    consumptionId: row.id,
    authorizationId: row.authorization_id,
    deliveryId: row.delivery_id,
    consumedAt: row.consumed_at,
    usedMessages,
    remainingMessages: maxMessages - usedMessages,
    replayed,
  };
}

function invalidBudget() {
  return new WhatsAppTwilioActivationBudgetError(
    "channel_provider_activation_budget_invalid",
    "Le budget d'activation est invalide pour cette livraison.",
  );
}

function exhaustedBudget() {
  return new WhatsAppTwilioActivationBudgetError(
    "channel_provider_activation_budget_exhausted",
    "Le budget d'activation est épuisé.",
  );
}
