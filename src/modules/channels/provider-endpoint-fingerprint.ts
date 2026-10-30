import { createHmac } from "node:crypto";
import { z } from "zod";
import type { ExternalChannelProvider } from "@/modules/channels/contracts";

export const channelProviderFingerprintSecretSchema = z
  .string()
  .min(32)
  .max(512);

export function createChannelProviderEndpointFingerprint(
  provider: ExternalChannelProvider,
  externalAccountId: string,
  destinationValue: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`v1:${provider}:${externalAccountId}:${destinationValue}`)
    .digest("hex");
}
