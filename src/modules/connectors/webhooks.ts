import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso, secureToken } from "@/lib/security";
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
  idempotencyKey?: string | null;
};

export type WebhookVerificationResult =
  | { ok: true; mode: "unsigned" | "hmac" }
  | { ok: false; error: string };

const genericWebhookConnectorKey = "generic_webhook";
const webhookReplayWindowSeconds = 300;

export function generateWebhookEndpointSecretValue() {
  return `whsec_${secureToken(32)}`;
}

export async function ensureWebhookEndpointSecret(
  db: DbClient,
  endpoint: WebhookEndpointSecurity,
) {
  if (endpoint.secretHash) {
    return { ...endpoint, secretHash: endpoint.secretHash };
  }

  const generatedSecret = generateWebhookEndpointSecretValue();
  const result = await persistWebhookEndpointSecret(db, {
    tenantId: endpoint.tenantId,
    endpointId: endpoint.id,
    secret: generatedSecret,
    onlyIfMissing: true,
  });

  return { ...endpoint, secretHash: result.secretHash };
}

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

  await persistWebhookEndpointSecret(db, {
    tenantId: input.tenantId,
    endpointId: input.endpointId,
    secret: input.secret,
    onlyIfMissing: false,
  });
}

async function persistWebhookEndpointSecret(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    secret: string;
    onlyIfMissing: boolean;
  },
) {
  const secretHash = hashToken(input.secret);
  const result = await db.query<{ secret_hash: string }>(
    `update webhook_endpoints
     set secret_hash = $1
     where tenant_id = $2
       and id = $3
       ${input.onlyIfMissing ? "and secret_hash is null" : ""}
     returning secret_hash`,
    [secretHash, input.tenantId, input.endpointId],
  );

  if (!result.rows[0] && input.onlyIfMissing) {
    const existing = await db.query<{ secret_hash: string | null }>(
      "select secret_hash from webhook_endpoints where tenant_id = $1 and id = $2",
      [input.tenantId, input.endpointId],
    );
    const existingHash = existing.rows[0]?.secret_hash;

    if (existingHash) {
      return { secretHash: existingHash };
    }
  }

  if (!result.rows[0]) {
    throw new Error("Webhook invalide.");
  }

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
      nowIso(),
    ],
  );

  return { secretHash };
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

  const timestampStatus = validateWebhookTimestamp(signatureInput.timestamp);
  if (!timestampStatus.ok) {
    return timestampStatus;
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
    toleranceSeconds: webhookReplayWindowSeconds,
  });

  if (!valid) {
    return { ok: false, error: "Signature webhook invalide." };
  }

  return { ok: true, mode: "hmac" };
}

function validateWebhookTimestamp(timestamp: string) {
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false as const, error: "Timestamp webhook invalide." };
  }

  if (Math.abs(Date.now() - timestampMs) > webhookReplayWindowSeconds * 1000) {
    return { ok: false as const, error: "Timestamp webhook expire." };
  }

  return { ok: true as const };
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
