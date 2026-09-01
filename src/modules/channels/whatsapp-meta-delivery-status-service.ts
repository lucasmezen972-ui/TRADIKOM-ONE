import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { prepareVerifiedMetaWhatsAppDeliveryStatus } from "@/modules/channels/whatsapp-meta-delivery-status";
import { resolveActiveMetaWhatsAppEndpoint } from "@/modules/channels/provider-endpoints-service";
import { persistVerifiedWhatsAppDeliveryStatus } from "@/modules/channels/whatsapp-twilio-delivery-status-service";

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

  return withSystemDbTransaction(db, async (transaction) => {
    const endpoint = await resolveActiveMetaWhatsAppEndpoint(
      transaction,
      {
        externalAccountId: prepared.event.safeAccountReference,
        phoneNumberId: prepared.event.phoneNumberId,
      },
      configuration.fingerprintSecret,
    );
    if (!endpoint) {
      return {
        accepted: false as const,
        code: "channel_provider_endpoint_not_found" as const,
      };
    }

    return persistVerifiedWhatsAppDeliveryStatus(transaction, prepared.event, {
      provider: "whatsapp_meta",
      endpointId: endpoint.endpointId,
    });
  });
}
