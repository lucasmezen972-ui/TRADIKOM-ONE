import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { prepareVerifiedMetaWhatsAppDeliveryStatus } from "@/modules/channels/whatsapp-meta-delivery-status";
import { resolveActiveMetaWhatsAppEndpoint } from "@/modules/channels/provider-endpoints-service";
import { persistVerifiedWhatsAppDeliveryStatus } from "@/modules/channels/whatsapp-twilio-delivery-status-service";
import {
  findWhatsAppOutboundDeliveryForStatusUpdate,
} from "@/modules/channels/whatsapp-twilio-outbound-repository";

type AcceptedDeliveryStatusOutcome = Extract<
  Awaited<ReturnType<typeof persistVerifiedWhatsAppDeliveryStatus>>,
  { accepted: true }
>;

export async function receivePreparedMetaWhatsAppDeliveryStatus(
  db: DbClient,
  input: unknown,
  configuration: {
    appSecret: string | undefined;
    fingerprintSecret: string | undefined;
  },
) {
  const prepared = prepareVerifiedMetaWhatsAppDeliveryStatus(
    input,
    configuration.appSecret,
  );
  if (!prepared.ok) return { accepted: false as const, code: prepared.code };

  try {
    return await withAtomicSystemTransaction(db, async (transaction) => {
      const outcomes: AcceptedDeliveryStatusOutcome[] = [];
      const resolved = [];
      for (const event of prepared.events) {
        const endpoint = await resolveActiveMetaWhatsAppEndpoint(
          transaction,
          {
            externalAccountId: event.safeAccountReference,
            phoneNumberId: event.phoneNumberId,
          },
          configuration.fingerprintSecret,
        );
        if (!endpoint) {
          throw new MetaDeliveryStatusBatchRejection(
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
          throw new MetaDeliveryStatusBatchRejection(
            "channel_provider_delivery_not_found",
          );
        }
        resolved.push({ event, endpointId: endpoint.endpointId });
      }

      for (const { event, endpointId } of resolved) {
        const outcome = await persistVerifiedWhatsAppDeliveryStatus(
          transaction,
          event,
          {
            provider: "whatsapp_meta",
            endpointId,
          },
        );
        if (!outcome.accepted) {
          throw new MetaDeliveryStatusBatchRejection(outcome.code);
        }
        outcomes.push(outcome);
      }

      const single = outcomes.length === 1 ? outcomes[0] : null;
      return {
        accepted: true as const,
        processed: outcomes.length,
        replayed: outcomes.every((outcome) => outcome.replayed),
        replayedCount: outcomes.filter((outcome) => outcome.replayed).length,
        stateUpdated: outcomes.some((outcome) => outcome.stateUpdated),
        stateUpdatedCount: outcomes.filter((outcome) => outcome.stateUpdated)
          .length,
        ...(single
          ? { deliveryId: single.deliveryId, status: single.status }
          : {}),
      };
    });
  } catch (error) {
    if (error instanceof MetaDeliveryStatusBatchRejection) {
      return { accepted: false as const, code: error.code };
    }
    throw error;
  }
}

class MetaDeliveryStatusBatchRejection extends Error {
  constructor(readonly code: string) {
    super("Le lot de statuts WhatsApp Meta est refusé.");
    this.name = "MetaDeliveryStatusBatchRejection";
  }
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
