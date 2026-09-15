import { z } from "zod";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { WhatsAppMetaActivationBudgetError } from "@/modules/channels/whatsapp-meta-activation-budget-errors";
import {
  countMetaWhatsAppActivationConsumptions,
  findMetaWhatsAppConsumptionByDelivery,
  insertMetaWhatsAppActivationConsumption,
  lockActiveMetaWhatsAppEndpointForActivationBudget,
  lockMetaWhatsAppActivationBudgetContext,
  lockMetaWhatsAppDeliveryForActivationBudget,
  type WhatsAppMetaActivationConsumptionRow,
} from "@/modules/channels/whatsapp-meta-activation-budget-repository";
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

export async function reserveWhatsAppMetaTrialBudget(
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
      if (
        !(await lockActiveMetaWhatsAppEndpointForActivationBudget(transaction, {
          tenantId: parsed.tenantId,
          endpointId: parsed.endpointId,
        }))
      ) {
        throw invalidBudget();
      }
      const delivery = await lockMetaWhatsAppDeliveryForActivationBudget(
        transaction,
        {
          tenantId: parsed.tenantId,
          endpointId: parsed.endpointId,
          deliveryId: parsed.deliveryId,
        },
      );
      if (!delivery?.activation_authorization_id) throw invalidBudget();
      const authorizationId = delivery.activation_authorization_id;
      if (
        parsed.authorizationId !== undefined &&
        parsed.authorizationId !== authorizationId
      ) {
        throw invalidBudget();
      }
      const existingConsumption =
        await findMetaWhatsAppConsumptionByDelivery(transaction, {
          tenantId: parsed.tenantId,
          deliveryId: parsed.deliveryId,
        });
      const context = await lockMetaWhatsAppActivationBudgetContext(
        transaction,
        {
          tenantId: parsed.tenantId,
          endpointId: parsed.endpointId,
          authorizationId,
          deliveryId: parsed.deliveryId,
        },
      );
      if (!context) throw invalidBudget();

      if (existingConsumption) {
        assertMatchingConsumption(existingConsumption, {
          ...parsed,
          authorizationId,
        });
        const usedMessages = await countMetaWhatsAppActivationConsumptions(
          transaction,
          { tenantId: parsed.tenantId, authorizationId },
        );
        return consumptionResult(existingConsumption, usedMessages, true);
      }

      if (
        context.revoked_at ||
        Date.parse(consumedAt) < Date.parse(context.authorized_at) ||
        Date.parse(consumedAt) >= Date.parse(context.expires_at)
      ) {
        throw invalidBudget();
      }

      if (!isConsumableDelivery(context)) throw invalidBudget();
      const usedMessages = await countMetaWhatsAppActivationConsumptions(
        transaction,
        { tenantId: parsed.tenantId, authorizationId },
      );
      if (usedMessages >= 1) throw exhaustedBudget();

      const row = await insertMetaWhatsAppActivationConsumption(transaction, {
        id: id("channel_activation_consumption"),
        tenant_id: parsed.tenantId,
        provider: "whatsapp_meta",
        endpoint_id: parsed.endpointId,
        authorization_id: authorizationId,
        delivery_id: parsed.deliveryId,
        consumed_by: actorId,
        consumed_at: consumedAt,
      });
      if (!row) throw invalidBudget();
      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId,
        action: "channel.provider_activation_budget_consumed",
        targetType: "channel_provider_activation_consumption",
        targetId: row.id,
        metadata: {
          provider: "whatsapp_meta",
          scope: "meta_whatsapp_trial",
          consumedUnits: 1,
          remainingMessages: 0,
          sensitiveValueRecorded: false,
        },
      });
      return consumptionResult(row, 1, false);
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
    throw new WhatsAppMetaActivationBudgetError(
      "channel_provider_activation_budget_access_denied",
      "Accès refusé à la consommation de l'autorisation d'essai Meta.",
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
  row: WhatsAppMetaActivationConsumptionRow,
  input: z.output<typeof reservationSchema>,
) {
  if (
    row.endpoint_id !== input.endpointId ||
    row.authorization_id !== input.authorizationId ||
    row.delivery_id !== input.deliveryId
  ) {
    throw invalidBudget();
  }
}

function consumptionResult(
  row: WhatsAppMetaActivationConsumptionRow,
  usedMessages: number,
  replayed: boolean,
) {
  return {
    consumptionId: row.id,
    authorizationId: row.authorization_id,
    deliveryId: row.delivery_id,
    consumedAt: row.consumed_at,
    usedMessages,
    remainingMessages: Math.max(0, 1 - usedMessages),
    replayed,
  };
}

function invalidBudget() {
  return new WhatsAppMetaActivationBudgetError(
    "channel_provider_activation_budget_invalid",
    "L'autorisation d'essai Meta est invalide pour cette livraison.",
  );
}

function exhaustedBudget() {
  return new WhatsAppMetaActivationBudgetError(
    "channel_provider_activation_budget_exhausted",
    "L'autorisation d'essai Meta est épuisée.",
  );
}
