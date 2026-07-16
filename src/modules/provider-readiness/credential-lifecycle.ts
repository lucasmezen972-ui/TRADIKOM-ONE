import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { encryptConnectorSecret } from "@/modules/connectors/security";

const allowedCapabilities = new Set([
  "verify_current_token",
  "read_zone_inventory",
  "read_dns_records",
]);

export type ProviderCredentialRecord = {
  id: string;
  tenantId: string;
  providerKey: "cloudflare";
  label: string;
  environment: "test";
  capabilities: string[];
  encryptedSecret: string;
  secretFingerprint: string;
  keyVersion: string;
  version: number;
  status: "active" | "superseded" | "revoked";
  supersedesId: string | null;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
};

export type ProviderCredentialView = Omit<
  ProviderCredentialRecord,
  "encryptedSecret" | "secretFingerprint"
> & {
  credentialPresent: true;
  credentialRedisplayAllowed: false;
};

export type ProviderCredentialContext = {
  encryptionKey: string;
  keyVersion: string;
  now?: string;
  credentialId?: string;
};

export function createProviderCredentialRecord(
  input: {
    tenantId: string;
    providerKey: "cloudflare";
    label: string;
    environment: "test";
    capabilities: string[];
    secret: string;
  },
  context: ProviderCredentialContext,
): ProviderCredentialRecord {
  const tenantId = boundedText(input.tenantId, 96, "tenantId");
  const label = boundedText(input.label, 120, "label");
  const capabilities = normalizeCapabilities(input.capabilities);
  const secret = normalizeSecret(input.secret);
  const encryptionKey = normalizeEncryptionKey(context.encryptionKey);
  const keyVersion = boundedText(context.keyVersion, 64, "keyVersion");
  const createdAt = normalizedTimestamp(context.now);

  return {
    id: normalizeCredentialId(context.credentialId),
    tenantId,
    providerKey: input.providerKey,
    label,
    environment: input.environment,
    capabilities,
    encryptedSecret: encryptConnectorSecret(secret, encryptionKey),
    secretFingerprint: fingerprintSecret({
      tenantId,
      providerKey: input.providerKey,
      secret,
      encryptionKey,
    }),
    keyVersion,
    version: 1,
    status: "active",
    supersedesId: null,
    createdAt,
    rotatedAt: null,
    revokedAt: null,
  };
}

export function rotateProviderCredential(
  current: ProviderCredentialRecord,
  input: { secret: string; capabilities?: string[] },
  context: ProviderCredentialContext,
) {
  if (current.status !== "active") {
    throw new Error("Only an active provider credential can be rotated.");
  }
  const now = normalizedTimestamp(context.now);
  const encryptionKey = normalizeEncryptionKey(context.encryptionKey);
  const secret = normalizeSecret(input.secret);
  const capabilities = input.capabilities
    ? normalizeCapabilities(input.capabilities)
    : [...current.capabilities];

  const previous: ProviderCredentialRecord = {
    ...current,
    status: "superseded",
    rotatedAt: now,
  };
  const next: ProviderCredentialRecord = {
    ...current,
    id: normalizeCredentialId(context.credentialId),
    capabilities,
    encryptedSecret: encryptConnectorSecret(secret, encryptionKey),
    secretFingerprint: fingerprintSecret({
      tenantId: current.tenantId,
      providerKey: current.providerKey,
      secret,
      encryptionKey,
    }),
    keyVersion: boundedText(context.keyVersion, 64, "keyVersion"),
    version: current.version + 1,
    status: "active",
    supersedesId: current.id,
    createdAt: now,
    rotatedAt: null,
    revokedAt: null,
  };

  return { previous, current: next };
}

export function revokeProviderCredential(
  current: ProviderCredentialRecord,
  now?: string,
): ProviderCredentialRecord {
  if (current.status === "superseded") {
    throw new Error("A superseded provider credential cannot be revoked again.");
  }
  if (current.status === "revoked") return current;
  return {
    ...current,
    status: "revoked",
    revokedAt: normalizedTimestamp(now),
  };
}

export function toProviderCredentialView(
  record: ProviderCredentialRecord,
): ProviderCredentialView {
  return {
    id: record.id,
    tenantId: record.tenantId,
    providerKey: record.providerKey,
    label: record.label,
    environment: record.environment,
    capabilities: [...record.capabilities],
    keyVersion: record.keyVersion,
    version: record.version,
    status: record.status,
    supersedesId: record.supersedesId,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    revokedAt: record.revokedAt,
    credentialPresent: true,
    credentialRedisplayAllowed: false,
  };
}

export function sameProviderCredentialSecret(
  record: ProviderCredentialRecord,
  candidateSecret: string,
  encryptionKey: string,
) {
  const candidate = Buffer.from(
    fingerprintSecret({
      tenantId: record.tenantId,
      providerKey: record.providerKey,
      secret: normalizeSecret(candidateSecret),
      encryptionKey: normalizeEncryptionKey(encryptionKey),
    }),
    "hex",
  );
  const expected = /^[a-f0-9]{64}$/.test(record.secretFingerprint)
    ? Buffer.from(record.secretFingerprint, "hex")
    : Buffer.alloc(0);
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

function fingerprintSecret(input: {
  tenantId: string;
  providerKey: string;
  secret: string;
  encryptionKey: string;
}) {
  return createHmac("sha256", input.encryptionKey)
    .update(input.tenantId)
    .update("\u0000")
    .update(input.providerKey)
    .update("\u0000")
    .update(input.secret)
    .digest("hex");
}

function normalizeCapabilities(values: string[]) {
  const capabilities = [...new Set(values.map((value) => value.trim()))].sort();
  if (
    capabilities.length === 0 ||
    capabilities.length > allowedCapabilities.size ||
    capabilities.some((value) => !allowedCapabilities.has(value))
  ) {
    throw new Error("Provider credential capabilities are invalid.");
  }
  return capabilities;
}

function normalizeSecret(value: string) {
  const secret = value.trim();
  if (
    secret.length < 20 ||
    secret.length > 4096 ||
    Array.from(secret).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127;
    })
  ) {
    throw new Error("Provider credential secret is invalid.");
  }
  return secret;
}

function normalizeEncryptionKey(value: string) {
  if (value.length < 32 || value.length > 4096) {
    throw new Error("Provider credential encryption key is invalid.");
  }
  return value.slice(0, 32);
}

function normalizeCredentialId(value?: string) {
  if (value) {
    if (!/^provider_credential_[a-z0-9]{16,64}$/i.test(value)) {
      throw new Error("Provider credential id is invalid.");
    }
    return value;
  }
  return `provider_credential_${randomUUID().replaceAll("-", "")}`;
}

function boundedText(value: string, maximum: number, label: string) {
  const normalized = value.replaceAll("\0", "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Provider credential ${label} is invalid.`);
  }
  return normalized;
}

function normalizedTimestamp(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("Provider credential timestamp is invalid.");
  }
  return date.toISOString();
}
