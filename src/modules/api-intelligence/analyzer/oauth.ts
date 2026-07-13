import { isIP } from "node:net";
import { AnalyzerError } from "@/modules/api-intelligence/analyzer/errors";
import {
  oauthMetadataPreviewSchema,
  type OauthMetadataPreview,
} from "@/modules/api-intelligence/analyzer/schemas";
import { isPrivateAddress } from "@/modules/api-intelligence/discovery/security";

const maxDocumentBytes = 256 * 1024;
const maxDepth = 20;
const maxNodes = 5_000;
const maxArrayValues = 100;
const maxStringLength = 2_048;

export function previewOauthMetadataDocument(input: {
  snapshotId: string;
  apiProductId: string;
  sourceHash: string;
  content: string;
  title?: string;
  version?: string;
}): OauthMetadataPreview {
  if (Buffer.byteLength(input.content) > maxDocumentBytes) {
    throw invalid("Metadonnees OAuth trop volumineuses.", "document_too_complex");
  }
  const raw = parseDocument(input.content);
  assertBoundedJson(raw);
  const issuer = parseEndpoint(raw.issuer, "issuer", true);
  const authorizationEndpoint = optionalEndpoint(
    raw.authorization_endpoint,
    "authorization_endpoint",
  );
  const tokenEndpoint = optionalEndpoint(raw.token_endpoint, "token_endpoint");
  const revocationEndpoint = optionalEndpoint(
    raw.revocation_endpoint,
    "revocation_endpoint",
  );
  const responseTypes = stringArray(raw.response_types_supported, {
    field: "response_types_supported",
    required: true,
  });
  const grantTypes = stringArray(raw.grant_types_supported, {
    field: "grant_types_supported",
    fallback: ["authorization_code", "implicit"],
  });
  const scopes = stringArray(raw.scopes_supported, {
    field: "scopes_supported",
    fallback: [],
  });
  const tokenEndpointAuthMethods = stringArray(
    raw.token_endpoint_auth_methods_supported,
    {
      field: "token_endpoint_auth_methods_supported",
      fallback: ["client_secret_basic"],
    },
  );
  const codeChallengeMethods = stringArray(
    raw.code_challenge_methods_supported,
    {
      field: "code_challenge_methods_supported",
      fallback: [],
    },
  );

  if (
    grantTypes.some((grant) =>
      ["authorization_code", "implicit"].includes(grant),
    ) &&
    !authorizationEndpoint
  ) {
    throw invalid("Endpoint d'autorisation OAuth manquant.");
  }
  if (
    grantTypes.some((grant) => grant !== "implicit") &&
    !tokenEndpoint
  ) {
    throw invalid("Endpoint de token OAuth manquant.");
  }

  const oauthMetadata = {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethods,
    codeChallengeMethods,
    pkceSupported: codeChallengeMethods.length > 0,
    pkceS256Supported: codeChallengeMethods.includes("S256"),
    signedMetadataPresent: typeof raw.signed_metadata === "string",
  };
  return oauthMetadataPreviewSchema.parse({
    parserVersion: "oauth-metadata-1",
    snapshotId: input.snapshotId,
    apiProductId: input.apiProductId,
    sourceHash: input.sourceHash,
    title: input.title?.trim() || "Metadonnees OAuth",
    version: input.version?.trim() || "non-specifiee",
    baseUrl: issuer,
    authenticationType: "oauth2",
    oauthMetadata,
    scopes,
    webhookSupport: false,
    rateLimitLocators: [],
    operations: [],
    schemas: [],
    ...oauthMetadata,
  });
}

function parseDocument(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw invalid("JSON de metadonnees OAuth invalide.");
  }
}

function parseEndpoint(value: unknown, field: string, issuer = false) {
  if (typeof value !== "string" || value.length > maxStringLength) {
    throw invalid(`Champ OAuth ${field} invalide.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(`URL OAuth ${field} invalide.`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    (issuer && (url.search || url.hash)) ||
    isPrivateHostname(hostname)
  ) {
    throw invalid(`URL OAuth ${field} non autorisee.`);
  }
  return url.toString().replace(/\/$/, issuer && url.pathname === "/" ? "" : "/");
}

function optionalEndpoint(value: unknown, field: string) {
  return value === undefined ? undefined : parseEndpoint(value, field);
}

function stringArray(
  value: unknown,
  input: { field: string; required?: boolean; fallback?: string[] },
) {
  if (value === undefined) {
    if (input.required) throw invalid(`Champ OAuth ${input.field} manquant.`);
    return input.fallback ?? [];
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxArrayValues ||
    value.some((item) =>
      typeof item !== "string" || !item.trim() || item.length > 240
    )
  ) {
    throw invalid(`Champ OAuth ${input.field} invalide.`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))].sort();
}

function assertBoundedJson(
  value: unknown,
  depth = 0,
  counter = { value: 0 },
) {
  counter.value += 1;
  if (depth > maxDepth || counter.value > maxNodes) {
    throw invalid("Metadonnees OAuth trop complexes.", "document_too_complex");
  }
  if (Array.isArray(value)) {
    value.forEach((child) => assertBoundedJson(child, depth + 1, counter));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((child) =>
      assertBoundedJson(child, depth + 1, counter),
    );
  }
}

function isPrivateHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (isIP(hostname) !== 0 && isPrivateAddress(hostname))
  );
}

function invalid(
  message: string,
  code: "oauth_metadata_invalid" | "document_too_complex" =
    "oauth_metadata_invalid",
) {
  return new AnalyzerError(code, message);
}
