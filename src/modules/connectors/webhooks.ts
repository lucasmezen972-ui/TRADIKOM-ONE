import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import {
  decryptConnectorSecret,
  encryptConnectorSecret,
  verifyWebhookHmac,
} from "@/modules/connectors/security";

export type WebhookEndpointSecurity = {
  id: string;
  tenantId: string;
  secretHash: string | null;
};

export type WebhookSignatureInput = {
  body: string;
  timestamp?: string | null;
  signature?: string | null;
};

export type WebhookVerificationResult =
  | { ok: true; mode: "unsigned" | "hmac" }
  | { ok: false; error: string };

const genericWebhookConnectorKey = "generic_webhook";

export async function configureWebhookEndpointSecret(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    secret: string;
  },
) {
  if (input.secret.length < 16) {
    throw new Error("Secret webhook trop court.");
  }

  const now = nowIso();

  await db.query(
    "update webhook_endpoints set secret_hash = $1 where tenant_id = $2 and id = $3",
    [hashToken(input.secret), input.tenantId, input.endpointId],
  );
  await db.query(
    `insert into connector_secret_versions (
      id,
      tenant_id,
      connector_key,
      key_version,
      encrypted_payload,
      created_at
    ) values ($1, $2, $3, $4, $5, $6)`,
    [
      id("secret"),
      input.tenantId,
      genericWebhookConnectorKey,
      input.endpointId,
      encryptConnectorSecret(input.secret),
      now,
    ],
  );
}

export async function verifyWebhookEndpointSignature(
  db: DbClient,
  endpoint: WebhookEndpointSecurity,
  signatureInput?: WebhookSignatureInput,
): Promise<WebhookVerificationResult> {
  if (!endpoint.secretHash) {
    return { ok: true, mode: "unsigned" };
  }

  if (!signatureInput?.timestamp || !signatureInput.signature) {
    return { ok: false, error: "Signature webhook manquante." };
  }

  const secret = await getLatestWebhookSecret(db, endpoint);
  if (!secret) {
    return { ok: false, error: "Secret webhook non configure." };
  }

  if (hashToken(secret) !== endpoint.secretHash) {
    return { ok: false, error: "Secret webhook incoherent." };
  }

  const valid = verifyWebhookHmac({
    body: signatureInput.body,
    secret,
    timestamp: signatureInput.timestamp,
    signature: signatureInput.signature,
  });

  if (!valid) {
    return { ok: false, error: "Signature webhook invalide." };
  }

  return { ok: true, mode: "hmac" };
}

async function getLatestWebhookSecret(
  db: DbClient,
  endpoint: WebhookEndpointSecurity,
) {
  const result = await db.query<{ encrypted_payload: string }>(
    `select encrypted_payload
     from connector_secret_versions
     where tenant_id = $1 and connector_key = $2 and key_version = $3
     order by created_at desc
     limit 1`,
    [endpoint.tenantId, genericWebhookConnectorKey, endpoint.id],
  );
  const encryptedPayload = result.rows[0]?.encrypted_payload;

  if (!encryptedPayload) {
    return null;
  }

  return decryptConnectorSecret(encryptedPayload);
}
