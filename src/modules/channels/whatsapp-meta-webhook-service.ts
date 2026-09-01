import { createHmac } from "node:crypto";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { nowIso } from "@/lib/security";
import { resolveActiveMetaWhatsAppEndpoint } from "@/modules/channels/provider-endpoints-service";
import { persistPreparedMetaWhatsAppMessage } from "@/modules/channels/whatsapp-meta-ingress-service";
import { prepareVerifiedMetaWhatsAppWebhookBatch } from "@/modules/channels/whatsapp-meta-webhook-batch";
import { persistVerifiedWhatsAppDeliveryStatus } from "@/modules/channels/whatsapp-twilio-delivery-status-service";
import { findWhatsAppOutboundDeliveryForStatusUpdate } from "@/modules/channels/whatsapp-twilio-outbound-repository";

type AcceptedDeliveryStatusOutcome = Extract<
  Awaited<ReturnType<typeof persistVerifiedWhatsAppDeliveryStatus>>,
  { accepted: true }
>;

export async function receivePreparedMetaWhatsAppWebhookBatch(
  db: DbClient,
  input: unknown,
  configuration: {
    appSecret: string | undefined;
    fingerprintSecret: string | undefined;
    receivedAt?: string;
  },
) {
  const prepared = prepareVerifiedMetaWhatsAppWebhookBatch(
    input,
    configuration.appSecret,
    configuration.receivedAt ?? nowIso(),
  );
  if (!prepared.ok) return { accepted: false as const, code: prepared.code };

  try {
    return await withAtomicSystemTransaction(db, async (transaction) => {
      const resolvedMessages = [];
      for (const message of prepared.messages) {
        const endpoint = await resolveActiveMetaWhatsAppEndpoint(
          transaction,
          {
            externalAccountId: message.safeAccountReference,
            phoneNumberId: message.recipientAddress.replace("whatsapp:+", ""),
          },
          configuration.fingerprintSecret,
        );
        if (!endpoint) {
          throw new MetaWebhookBatchRejection(
            "channel_provider_endpoint_not_found",
          );
        }
        const subject = fingerprintSubject(
          endpoint.tenantId,
          endpoint.endpointId,
          message.senderAddress,
          configuration.fingerprintSecret,
        );
        resolvedMessages.push({
          endpoint,
          identityId: `meta_identity_${subject.slice(0, 32)}`,
          message,
          subject,
        });
      }

      const resolvedStatuses = [];
      for (const event of prepared.statuses) {
        const endpoint = await resolveActiveMetaWhatsAppEndpoint(
          transaction,
          {
            externalAccountId: event.safeAccountReference,
            phoneNumberId: event.phoneNumberId,
          },
          configuration.fingerprintSecret,
        );
        if (!endpoint) {
          throw new MetaWebhookBatchRejection(
            "channel_provider_endpoint_not_found",
          );
        }
        const delivery = await findWhatsAppOutboundDeliveryForStatusUpdate(
          transaction,
          {
            externalMessageId: event.providerMessageId,
            provider: "whatsapp_meta",
            endpointId: endpoint.endpointId,
          },
        );
        if (!delivery) {
          throw new MetaWebhookBatchRejection(
            "channel_provider_delivery_not_found",
          );
        }
        resolvedStatuses.push({ event, endpointId: endpoint.endpointId });
      }

      const messageOutcomes = [];
      for (const resolved of resolvedMessages) {
        messageOutcomes.push(
          await persistPreparedMetaWhatsAppMessage(transaction, resolved),
        );
      }

      const statusOutcomes: AcceptedDeliveryStatusOutcome[] = [];
      for (const { event, endpointId } of resolvedStatuses) {
        const outcome = await persistVerifiedWhatsAppDeliveryStatus(
          transaction,
          event,
          { provider: "whatsapp_meta", endpointId },
        );
        if (!outcome.accepted) {
          throw new MetaWebhookBatchRejection(outcome.code);
        }
        statusOutcomes.push(outcome);
      }

      const outcomes = [...messageOutcomes, ...statusOutcomes];
      return {
        accepted: true as const,
        processed: outcomes.length,
        processedMessages: messageOutcomes.length,
        processedStatuses: statusOutcomes.length,
        replayed: outcomes.every((outcome) => outcome.replayed),
        replayedCount: outcomes.filter((outcome) => outcome.replayed).length,
        stateUpdated: statusOutcomes.some((outcome) => outcome.stateUpdated),
        stateUpdatedCount: statusOutcomes.filter(
          (outcome) => outcome.stateUpdated,
        ).length,
        messages: messageOutcomes,
      };
    });
  } catch (error) {
    if (error instanceof MetaWebhookBatchRejection) {
      return { accepted: false as const, code: error.code };
    }
    throw error;
  }
}

class MetaWebhookBatchRejection extends Error {
  constructor(readonly code: string) {
    super("Le lot webhook WhatsApp Meta est refusé.");
    this.name = "MetaWebhookBatchRejection";
  }
}

function fingerprintSubject(
  tenantId: string,
  endpointId: string,
  senderAddress: string,
  fingerprintSecret: string | undefined,
) {
  if (!fingerprintSecret || fingerprintSecret.length < 32) {
    throw new Error("Channel fingerprinting is not configured.");
  }
  return createHmac("sha256", fingerprintSecret)
    .update(`v2:whatsapp_meta_subject:${tenantId}:${endpointId}:${senderAddress}`)
    .digest("hex");
}

function withAtomicSystemTransaction<T>(
  db: DbClient,
  callback: (transaction: DbClient) => Promise<T>,
) {
  const pglite = db as DbClient & {
    transaction?: <Result>(
      transactionCallback: (transaction: DbClient) => Promise<Result>,
    ) => Promise<Result>;
  };
  if (typeof pglite.transaction === "function") {
    return pglite.transaction(callback);
  }
  return withSystemDbTransaction(db, callback);
}
