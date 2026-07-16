const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const CLOUDFLARE_API_PREFIX = "/client/v4";
const maxTokenLength = 4096;
const maxResultItems = 50;
const maxDnsContentLength = 4096;

export const cloudflareReadOnlyContract = {
  providerKey: "cloudflare",
  providerLabel: "Cloudflare",
  officialSdkRepository: "cloudflare/cloudflare-typescript",
  environment: "production_api_with_dedicated_test_account",
  activationStatus: "contract_only",
  capabilities: {
    tokenVerification: true,
    zoneListing: true,
    dnsRecordListing: true,
    writes: false,
    dnsChanges: false,
    automaticActivation: false,
  },
  operations: [
    {
      key: "token.verify",
      method: "GET",
      path: "/user/tokens/verify",
      requiredCapability: "verify_current_token",
    },
    {
      key: "zones.list",
      method: "GET",
      path: "/zones",
      requiredCapability: "read_zone_inventory",
    },
    {
      key: "dns.records.list",
      method: "GET",
      path: "/zones/{zone_id}/dns_records",
      requiredCapability: "read_dns_records",
    },
  ],
} as const;

export type CloudflareReadOnlyOperation =
  (typeof cloudflareReadOnlyContract.operations)[number]["key"];

export type CloudflareRequestPlan = {
  providerKey: "cloudflare";
  operation: CloudflareReadOnlyOperation;
  method: "GET";
  url: string;
  timeoutMs: 10_000;
  maxResponseBytes: 512 * 1024;
  safeSummary: {
    operation: CloudflareReadOnlyOperation;
    origin: typeof CLOUDFLARE_API_ORIGIN;
    page: number | null;
    perPage: number | null;
    zoneIdPresent: boolean;
    credentialIncluded: false;
  };
};

export type CloudflareZoneSummary = {
  id: string;
  name: string;
  status: "initializing" | "pending" | "active" | "moved" | "unknown";
  type: "full" | "partial" | "secondary" | "internal" | "unknown";
  accountId: string | null;
};

export type CloudflareDnsRecordSummary = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number | null;
  proxied: boolean | null;
};

export type CloudflareSafeError = {
  classification:
    | "authentication_required"
    | "permission_denied"
    | "not_found"
    | "rate_limited"
    | "provider_unavailable"
    | "invalid_response"
    | "request_rejected";
  retryable: boolean;
  status: number | null;
};

export function createCloudflareRequestPlan(input: {
  operation: CloudflareReadOnlyOperation;
  zoneId?: string;
  zoneName?: string;
  page?: number;
  perPage?: number;
}): CloudflareRequestPlan {
  const operation = cloudflareReadOnlyContract.operations.find(
    (candidate) => candidate.key === input.operation,
  );
  if (!operation) {
    throw new Error("Unsupported Cloudflare read-only operation.");
  }

  const url = new URL(`${CLOUDFLARE_API_PREFIX}${operation.path}`, CLOUDFLARE_API_ORIGIN);
  let page: number | null = null;
  let perPage: number | null = null;
  let zoneIdPresent = false;

  if (input.operation === "zones.list") {
    page = boundedInteger(input.page ?? 1, 1, 10, "page");
    perPage = boundedInteger(input.perPage ?? maxResultItems, 1, maxResultItems, "perPage");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    if (input.zoneName) {
      url.searchParams.set("name", normalizeDomainFilter(input.zoneName));
    }
  }

  if (input.operation === "dns.records.list") {
    const zoneId = normalizeCloudflareIdentifier(input.zoneId, "zoneId");
    url.pathname = url.pathname.replace("{zone_id}", zoneId);
    page = boundedInteger(input.page ?? 1, 1, 10, "page");
    perPage = boundedInteger(input.perPage ?? maxResultItems, 1, maxResultItems, "perPage");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    zoneIdPresent = true;
  }

  assertCloudflareUrl(url);
  return {
    providerKey: "cloudflare",
    operation: input.operation,
    method: "GET",
    url: url.toString(),
    timeoutMs: 10_000,
    maxResponseBytes: 512 * 1024,
    safeSummary: {
      operation: input.operation,
      origin: CLOUDFLARE_API_ORIGIN,
      page,
      perPage,
      zoneIdPresent,
      credentialIncluded: false,
    },
  };
}

export function materializeCloudflareRequest(
  plan: CloudflareRequestPlan,
  apiToken: string,
) {
  const token = normalizeApiToken(apiToken);
  const url = new URL(plan.url);
  assertCloudflareUrl(url);
  if (plan.method !== "GET") {
    throw new Error("Cloudflare provider readiness permits GET requests only.");
  }

  return new Request(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}

export function parseCloudflareTokenVerification(value: unknown) {
  const result = parseEnvelope(value);
  if (!isRecord(result)) throw invalidResponse();
  const id = requiredIdentifier(result.id, "token id");
  const status = result.status;
  if (status !== "active" && status !== "disabled" && status !== "expired") {
    throw invalidResponse();
  }
  return {
    id,
    status,
    expiresOn: optionalIsoDate(result.expires_on),
    notBefore: optionalIsoDate(result.not_before),
  };
}

export function parseCloudflareZones(value: unknown): CloudflareZoneSummary[] {
  const result = parseEnvelope(value);
  if (!Array.isArray(result) || result.length > maxResultItems) {
    throw invalidResponse();
  }
  return result.map((item) => {
    if (!isRecord(item)) throw invalidResponse();
    const account = isRecord(item.account) ? item.account : null;
    return {
      id: requiredIdentifier(item.id, "zone id"),
      name: normalizeDomainFilter(requiredString(item.name, 253)),
      status: zoneStatus(item.status),
      type: zoneType(item.type),
      accountId:
        account && typeof account.id === "string"
          ? requiredIdentifier(account.id, "account id")
          : null,
    };
  });
}

export function parseCloudflareDnsRecords(
  value: unknown,
): CloudflareDnsRecordSummary[] {
  const result = parseEnvelope(value);
  if (!Array.isArray(result) || result.length > maxResultItems) {
    throw invalidResponse();
  }
  return result.map((item) => {
    if (!isRecord(item)) throw invalidResponse();
    const ttl = typeof item.ttl === "number" && Number.isInteger(item.ttl) && item.ttl >= 1
      ? item.ttl
      : null;
    return {
      id: requiredIdentifier(item.id, "record id"),
      type: requiredString(item.type, 16).toUpperCase(),
      name: requiredString(item.name, 253).toLowerCase(),
      content: requiredString(item.content, maxDnsContentLength),
      ttl,
      proxied: typeof item.proxied === "boolean" ? item.proxied : null,
    };
  });
}

export function classifyCloudflareFailure(input: {
  status?: number;
  kind?: "network" | "timeout" | "invalid_response" | "request_rejected";
}): CloudflareSafeError {
  const status = Number.isInteger(input.status) ? input.status! : null;
  if (status === 401) return safeError("authentication_required", false, status);
  if (status === 403) return safeError("permission_denied", false, status);
  if (status === 404) return safeError("not_found", false, status);
  if (status === 429) return safeError("rate_limited", true, status);
  if (status !== null && status >= 500) {
    return safeError("provider_unavailable", true, status);
  }
  if (input.kind === "network" || input.kind === "timeout") {
    return safeError("provider_unavailable", true, status);
  }
  if (input.kind === "request_rejected") {
    return safeError("request_rejected", false, status);
  }
  return safeError("invalid_response", false, status);
}

function parseEnvelope(value: unknown) {
  if (!isRecord(value) || value.success !== true || !("result" in value)) {
    throw invalidResponse();
  }
  return value.result;
}

function normalizeApiToken(value: string) {
  const token = value.trim();
  if (
    token.length < 20 ||
    token.length > maxTokenLength ||
    /[\u0000-\u001f\u007f\s]/.test(token)
  ) {
    throw new Error("Cloudflare API token is invalid.");
  }
  return token;
}

function normalizeCloudflareIdentifier(value: string | undefined, label: string) {
  if (!value || !/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`Cloudflare ${label} is invalid.`);
  }
  return value.toLowerCase();
}

function requiredIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`Cloudflare ${label} is invalid.`);
  }
  return value.toLowerCase();
}

function normalizeDomainFilter(value: string) {
  const domain = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    domain.length < 3 ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !domain.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    throw new Error("Cloudflare zone name is invalid.");
  }
  return domain;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Cloudflare ${label} is outside the allowed range.`);
  }
  return value;
}

function requiredString(value: unknown, maximum: number) {
  if (typeof value !== "string") throw invalidResponse();
  const normalized = value.replaceAll("\0", "").trim();
  if (!normalized || normalized.length > maximum) throw invalidResponse();
  return normalized;
}

function optionalIsoDate(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw invalidResponse();
  }
  return new Date(value).toISOString();
}

function zoneStatus(value: unknown): CloudflareZoneSummary["status"] {
  return value === "initializing" ||
    value === "pending" ||
    value === "active" ||
    value === "moved"
    ? value
    : "unknown";
}

function zoneType(value: unknown): CloudflareZoneSummary["type"] {
  return value === "full" ||
    value === "partial" ||
    value === "secondary" ||
    value === "internal"
    ? value
    : "unknown";
}

function assertCloudflareUrl(url: URL) {
  if (
    url.origin !== CLOUDFLARE_API_ORIGIN ||
    !url.pathname.startsWith(`${CLOUDFLARE_API_PREFIX}/`) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Cloudflare request target is not allowed.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeError(
  classification: CloudflareSafeError["classification"],
  retryable: boolean,
  status: number | null,
): CloudflareSafeError {
  return { classification, retryable, status };
}

function invalidResponse() {
  return new Error("Cloudflare response is invalid.");
}
