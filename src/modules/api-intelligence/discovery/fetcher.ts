import { createHash } from "node:crypto";
import { request } from "node:https";
import { isIP } from "node:net";
import { DiscoveryError } from "@/modules/api-intelligence/discovery/errors";
import {
  resolvePublicDiscoveryAddress,
  validateDiscoveryUrl,
  type DiscoveryDnsLookup,
} from "@/modules/api-intelligence/discovery/security";
import { evaluateRobots } from "@/modules/api-intelligence/discovery/robots";

export const discoveryUserAgent =
  "TradikomApiScout/1.0 (+https://tradikom.com/api-scout)";
export const discoveryParserVersion = "discovery-1";
const sourceMaxBytes = 1024 * 1024;
const robotsMaxBytes = 128 * 1024;
const requestTimeoutMs = 10_000;

export type DiscoveryResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
};

export type DiscoveryTransport = (
  url: URL,
  input: {
    headers: Record<string, string>;
    maxBytes: number;
    signal: AbortSignal;
    lookupImpl?: DiscoveryDnsLookup;
  },
) => Promise<DiscoveryResponse>;

export async function fetchUnderDiscoveryPolicy(input: {
  url: string;
  approvedDomain: string;
  etag?: string;
  lastModified?: string;
  transport?: DiscoveryTransport;
  lookupImpl?: DiscoveryDnsLookup;
}) {
  const target = validateDiscoveryUrl(input.url, input.approvedDomain);
  const transport = input.transport ?? defaultDiscoveryTransport;
  const robotsUrl = new URL("/robots.txt", target.origin);
  const robots = await timedRequest((signal) =>
    transport(robotsUrl, {
      headers: { "user-agent": discoveryUserAgent, accept: "text/plain" },
      maxBytes: robotsMaxBytes,
      signal,
      lookupImpl: input.lookupImpl,
    }),
  );
  if (robots.status >= 500) {
    throw new DiscoveryError(
      "robots_unavailable",
      "Politique robots indisponible.",
    );
  }
  if (
    robots.status !== 404 &&
    (robots.status < 200 || robots.status >= 300)
  ) {
    throw new DiscoveryError(
      "robots_denied",
      "Acces robots refuse par l'editeur.",
    );
  }
  if (
    robots.status !== 404 &&
    robots.status >= 200 &&
    robots.status < 300 &&
    !evaluateRobots(robots.body, target.pathname || "/")
  ) {
    throw new DiscoveryError("robots_denied", "Analyse refusee par robots.txt.");
  }

  const headers: Record<string, string> = {
    "user-agent": discoveryUserAgent,
    accept:
      "application/json, application/yaml, text/yaml, text/plain;q=0.8, text/html;q=0.5",
    "accept-encoding": "identity",
  };
  if (input.etag) headers["if-none-match"] = input.etag;
  if (input.lastModified) headers["if-modified-since"] = input.lastModified;
  const response = await timedRequest((signal) =>
    transport(target, {
      headers,
      maxBytes: sourceMaxBytes,
      signal,
      lookupImpl: input.lookupImpl,
    }),
  );
  if (response.status === 304) {
    return {
      status: 304 as const,
      notModified: true as const,
      etag: response.headers.etag ?? input.etag,
      lastModified: response.headers["last-modified"] ?? input.lastModified,
    };
  }
  if (response.status >= 300 && response.status < 400) {
    throw new DiscoveryError(
      "redirect_blocked",
      "Redirection de decouverte refusee.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new DiscoveryError(
      "request_failed",
      `Source indisponible (HTTP ${response.status}).`,
    );
  }
  const redactedContent = redactUntrustedContent(response.body);
  return {
    status: response.status,
    notModified: false as const,
    etag: response.headers.etag,
    lastModified: response.headers["last-modified"],
    contentType: response.headers["content-type"] ?? "application/octet-stream",
    content: redactedContent,
    contentHash: createHash("sha256").update(redactedContent).digest("hex"),
    robotsDecision: "allowed" as const,
    accessPolicyDecision: "approved_domain" as const,
    safeMetadata: {
      untrustedContent: true,
      depth: 0,
      pageCount: 1,
      redirectsFollowed: 0,
      bytes: Buffer.byteLength(redactedContent),
    },
  };
}

export function redactUntrustedContent(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    const redact = (value: unknown, parentKey?: string): unknown => {
      if (typeof value === "string") return redactSensitiveText(value);
      if (Array.isArray(value)) {
        return value.map((child) => redact(child, parentKey));
      }
      if (!value || typeof value !== "object") return value;
      const record = value as Record<string, unknown>;
      const keyedValue = typeof record.key === "string" && "value" in record;
      const responseExample =
        "originalRequest" in record || typeof record.code === "number";
      return Object.fromEntries(
        Object.entries(record).map(([key, child]) => {
          const lowerKey = key.toLowerCase();
          if (
            ["example", "examples", "default"].includes(lowerKey) ||
            key === "exec" ||
            (key === "value" && keyedValue) ||
            (key === "body" && responseExample) ||
            (parentKey === "body" && ["raw", "src"].includes(key)) ||
            (isSensitiveUntrustedKey(key) &&
              (child === null || typeof child !== "object"))
          ) {
            return [key, "[REDACTED]"];
          }
          return [key, redact(child, key)];
        }),
      );
    };
    return JSON.stringify(redact(parsed));
  } catch {
    return redactSensitiveText(content);
  }
}

const publicSecurityMetadataKeys = new Set([
  "authorization_endpoint",
  "authorizationurl",
  "device_authorization_endpoint",
  "introspection_endpoint",
  "pushed_authorization_request_endpoint",
  "revocation_endpoint",
  "token_endpoint",
  "token_endpoint_auth_methods_supported",
  "token_endpoint_auth_signing_alg_values_supported",
  "tokenurl",
]);

function isSensitiveUntrustedKey(key: string) {
  const normalized = key.toLowerCase();
  if (publicSecurityMetadataKeys.has(normalized)) return false;
  return /(authorization|cookie|password|secret|token|api[_-]?key|signed_metadata)/i.test(
    key,
  );
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_-]?key|token|secret|password)[ \t]*[:=][ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&\r\n]+)/gi,
      "$1[REDACTED]",
    );
}

async function timedRequest(
  factory: (signal: AbortSignal) => Promise<DiscoveryResponse>,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      factory(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => {
            controller.abort();
            reject(
              new DiscoveryError(
                "request_timed_out",
                "Delai de decouverte depasse.",
              ),
            );
          },
          requestTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function defaultDiscoveryTransport(
  url: URL,
  input: Parameters<DiscoveryTransport>[1],
) {
  const address = await resolvePublicDiscoveryAddress(
    url.hostname,
    input.lookupImpl,
  );
  return new Promise<DiscoveryResponse>((resolve, reject) => {
    const outbound = request(
      {
        protocol: "https:",
        hostname: address.address,
        family: address.family,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { ...input.headers, host: url.host },
        servername: isIP(url.hostname) ? undefined : url.hostname,
        signal: input.signal,
      },
      (response) => {
        const contentEncoding = response.headers["content-encoding"];
        if (contentEncoding && contentEncoding !== "identity") {
          response.destroy();
          reject(
            new DiscoveryError(
              "unsupported_encoding",
              "Encodage compresse refuse.",
            ),
          );
          return;
        }
        const contentLength = Number(response.headers["content-length"] ?? 0);
        if (contentLength > input.maxBytes) {
          response.destroy();
          reject(
            new DiscoveryError(
              "response_too_large",
              "Document trop volumineux.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > input.maxBytes) {
            response.destroy(
              new DiscoveryError(
                "response_too_large",
                "Document trop volumineux.",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers)
                .filter((entry): entry is [string, string | string[]] =>
                  entry[1] !== undefined,
                )
                .map(([key, value]) => [
                  key.toLowerCase(),
                  Array.isArray(value) ? value.join(", ") : value,
                ]),
            ),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outbound.once("error", reject);
    outbound.end();
  });
}
