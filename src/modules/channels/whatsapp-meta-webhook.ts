import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const maxPayloadBytes = 512 * 1024;

const metaWebhookInputSchema = z
  .object({
    rawBody: z.string(),
    signature: z.string().trim().min(1).max(256),
  })
  .strict();

export type MetaWebhookVerificationResult =
  | { ok: true; event: { signatureVerified: true; payloadBytes: number } }
  | {
      ok: false;
      code:
        | "not_configured"
        | "payload_too_large"
        | "payload_invalid"
        | "invalid_signature";
    };

/**
 * Vérifie la signature X-Hub-Signature-256 sur le corps brut Meta.
 * Aucun parsing ni effet de bord ne doit précéder cet appel.
 */
export function verifyMetaWhatsAppWebhook(
  input: unknown,
  appSecret: string | undefined,
): MetaWebhookVerificationResult {
  if (!appSecret?.trim()) return { ok: false, code: "not_configured" };

  const parsed = metaWebhookInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "payload_invalid" };

  const payloadBytes = new TextEncoder().encode(parsed.data.rawBody).byteLength;
  if (payloadBytes > maxPayloadBytes) {
    return { ok: false, code: "payload_too_large" };
  }

  const supplied = parseSignature(parsed.data.signature);
  if (!supplied) return { ok: false, code: "invalid_signature" };

  const expected = createHmac("sha256", appSecret.trim())
    .update(parsed.data.rawBody, "utf8")
    .digest();

  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return { ok: false, code: "invalid_signature" };
  }

  return { ok: true, event: { signatureVerified: true, payloadBytes } };
}

function parseSignature(value: string) {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(value);
  return match ? Buffer.from(match[1], "hex") : null;
}
